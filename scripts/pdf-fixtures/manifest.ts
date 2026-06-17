/**
 * Build the visual-check manifest: for each fixture, run LiteParse, find the TARGET item(s), union
 * their boxes, and normalize. LiteParse is a PRE-NORMALIZING producer (verified by the probe): it
 * reports rendered-frame dims — post-rotation, post-CropBox — with top-left y-down coords. So the
 * adapter profile here is origin=top-left with NO rotation/cropBox (LiteParse already applied them);
 * normalizeBox reduces to a plain divide by the reported page dims. The CropBox/rotation code paths
 * in pdfBox.ts serve the raw PDF.js text-layer producer (unit-tested separately).
 *
 * For rotated90, LiteParse splits "TARGET" into "TA"+"RGET" (rotation broke the glyph run); we union
 * all items whose text is a substring of the target phrase into one bounding box.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { parseWithLiteParse } from "../../src/app/liteparseAdapter";
import { normalizeBox, type PageGeometry } from "../../src/nodeagent/capture/pdfBox";

const OUT = "public/pdf-fixtures";
const SRC = "src/pdf-fixtures";
mkdirSync(OUT, { recursive: true });
mkdirSync(SRC, { recursive: true });

interface Case { name: string; desc: string; url: string; page: number; boxes: Array<{ x: number; y: number; w: number; h: number; page?: number }>; note: string; targetPhrase: string }

const cases: Array<{ name: string; desc: string; targetPhrase: string; page: number; note: string }> = [
  { name: "normal", desc: "MediaBox 400x200, TARGET top-left third", targetPhrase: "TARGET", page: 1, note: "plain divide, top-left" },
  { name: "rotated90", desc: "/Rotate 90 -> renders 200x400; LiteParse pre-rotated + split TARGET", targetPhrase: "TARGET", page: 1, note: "LiteParse pre-rotated; union TA+RGET; NO re-rotation" },
  { name: "cropbox-offset", desc: "CropBox [80 60 360 170] -> 280x110; LiteParse pre-shifted to crop space", targetPhrase: "TARGET", page: 1, note: "LiteParse pre-applied crop offset; NO re-subtract" },
  { name: "multipage", desc: "page2 300x150 'PAGE2 TARGET' (diff dims from page1)", targetPhrase: "PAGE2 TARGET", page: 2, note: "per-page dims; box on page 2" },
];

const manifest: Case[] = [];
for (const c of cases) {
  const bytes = readFileSync(`${OUT}/${c.name}.pdf`);
  const res = await parseWithLiteParse({ file: { storageId: c.name, fileName: `${c.name}.pdf`, mimeType: "application/pdf", size: bytes.length }, bytes, ocrEnabled: false, maxPages: 5 });
  const page = res.pages.find((p) => p.pageNum === c.page)!;
  // Items whose text is a non-empty substring of the target phrase (handles rotation splits).
  const targets = page.textItems.filter((it) => it.text.trim() && c.targetPhrase.includes(it.text.trim()));
  if (!targets.length) throw new Error(`${c.name}: no target items for "${c.targetPhrase}" (got: ${page.textItems.map((t) => `"${t.text}"`).join(", ")})`);
  const minX = Math.min(...targets.map((t) => t.x));
  const minY = Math.min(...targets.map((t) => t.y));
  const maxX = Math.max(...targets.map((t) => t.x + t.width));
  const maxY = Math.max(...targets.map((t) => t.y + t.height));
  const geom: PageGeometry = { page: page.pageNum, width: page.width, height: page.height }; // pre-normalized: no rotation/cropBox
  const box = normalizeBox({ x: minX, y: minY, w: maxX - minX, h: maxY - minY }, geom, "top-left");
  manifest.push({ name: c.name, desc: c.desc, url: `/pdf-fixtures/${c.name}.pdf`, page: c.page, boxes: [{ x: box.x, y: box.y, w: box.w, h: box.h, page: box.page }], note: c.note, targetPhrase: c.targetPhrase });
  console.log(`${c.name}: page ${page.width}x${page.height}, unioned ${targets.length} item(s) -> box x=${box.x.toFixed(3)} y=${box.y.toFixed(3)} w=${box.w.toFixed(3)} h=${box.h.toFixed(3)}  [${c.note}]`);
}

writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
writeFileSync(`${SRC}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`\nwrote ${OUT}/manifest.json + ${SRC}/manifest.json (${manifest.length} cases)`);
