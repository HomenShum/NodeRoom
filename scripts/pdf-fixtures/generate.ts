/**
 * Generate varied PDF fixtures for the citation-box visual check + probe LiteParse's raw output per
 * case, so we learn what coords/geometry the producer actually reports BEFORE normalizing. Output:
 * public/pdf-fixtures/*.pdf. Prints each case's page geometry + text items to stdout for inspection.
 *
 * Cases: normal · rotated90 (/Rotate 90) · cropbox-offset (CropBox != MediaBox) · multipage (2 pages,
 * differing sizes). We know the EXPECTED on-screen location of each "TARGET" string; the visual check
 * confirms the normalized box lands on it.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { parseWithLiteParse } from "../../src/app/liteparseAdapter";

const OUT = "public/pdf-fixtures";
mkdirSync(OUT, { recursive: true });

/** Build a minimal one-content-stream PDF with exact xref offsets. */
function buildPdf(opts: {
  mediaBox: [number, number, number, number];
  cropBox?: [number, number, number, number];
  rotate?: 0 | 90 | 180 | 270;
  pages?: Array<{ mediaBox: [number, number, number, number]; cropBox?: [number, number, number, number]; rotate?: 0 | 90 | 180 | 270; texts: Array<{ x: number; y: number; size: number; text: string }> }>;
}): Buffer {
  const ps = opts.pages ?? [{
    mediaBox: opts.mediaBox, cropBox: opts.cropBox, rotate: opts.rotate, texts: [],
  }];
  const objs: string[] = [];
  // 1: Catalog
  const pageIds = ps.map((_, i) => `${3 + i * 2} 0 R`).join(" ");
  objs.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  // 2: Pages
  objs.push(`<< /Type /Pages /Kids [${pageIds}] /Count ${ps.length} >>`);
  // per page: Page object + Contents stream
  ps.forEach((p, i) => {
    const pageObjNum = 3 + i * 2;
    const contentObjNum = pageObjNum + 1;
    let dict = `<< /Type /Page /Parent 2 0 R /MediaBox [${p.mediaBox.join(" ")}]`;
    if (p.cropBox) dict += ` /CropBox [${p.cropBox.join(" ")}]`;
    if (p.rotate) dict += ` /Rotate ${p.rotate}`;
    dict += ` /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 ${3 + ps.length * 2} 0 R >> >> >>`;
    objs.push(dict);
    const stream = p.texts.map((t) => `BT /F1 ${t.size} Tf ${t.x} ${t.y} Td (${t.text}) Tj ET`).join("\n");
    objs.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  // Font
  objs.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`);

  // Assemble with byte offsets.
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf);
  const size = objs.length + 1;
  let xref = `xref\n0 ${size}\n0000000000 65535 f \n`;
  for (let i = 1; i < size; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `${xref}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

interface Fixture { name: string; desc: string; bytes: Buffer; expectNote: string }

const fixtures: Fixture[] = [
  {
    name: "normal",
    desc: "MediaBox [0 0 400 200]; TARGET at PDF (40,100) baseline, decoy elsewhere",
    expectNote: "TARGET glyph sits near top-left third; box should cover 'TARGET'",
    bytes: buildPdf({
      mediaBox: [0, 0, 400, 200],
      pages: [{
        mediaBox: [0, 0, 400, 200],
        texts: [
          { x: 40, y: 100, size: 20, text: "TARGET" },
          { x: 250, y: 40, size: 14, text: "decoy value here" },
          { x: 40, y: 40, size: 12, text: "Revenue 2024" },
        ],
      }],
    }),
  },
  {
    name: "rotated90",
    desc: "MediaBox [0 0 400 200] /Rotate 90; renders 200x400. Tests rotation remap seam.",
    expectNote: "page renders tall (200x400); does a LiteParse box still land on TARGET?",
    bytes: buildPdf({
      mediaBox: [0, 0, 400, 200],
      pages: [{
        mediaBox: [0, 0, 400, 200], rotate: 90,
        texts: [
          { x: 40, y: 100, size: 20, text: "TARGET" },
          { x: 250, y: 40, size: 14, text: "decoy" },
        ],
      }],
    }),
  },
  {
    name: "cropbox-offset",
    desc: "MediaBox [0 0 400 200] CropBox [80 60 360 170]; renders crop (280x110). Tests offset.",
    expectNote: "crop origin shifts; TARGET at PDF(120,110) appears at crop(40,50)",
    bytes: buildPdf({
      mediaBox: [0, 0, 400, 200],
      pages: [{
        mediaBox: [0, 0, 400, 200], cropBox: [80, 60, 360, 170],
        texts: [
          { x: 120, y: 110, size: 20, text: "TARGET" },
          { x: 30, y: 30, size: 12, text: "outside crop (hidden)" },
        ],
      }],
    }),
  },
  {
    name: "multipage",
    desc: "page1 400x200 'PAGE1 TARGET', page2 300x150 'PAGE2 TARGET'. Tests per-page dims.",
    expectNote: "box on page2 must normalize against page2 dims (300x150), not page1",
    bytes: buildPdf({
      mediaBox: [0, 0, 400, 200],
      pages: [
        { mediaBox: [0, 0, 400, 200], texts: [{ x: 40, y: 100, size: 20, text: "PAGE1 TARGET" }, { x: 200, y: 60, size: 12, text: "row a" }] },
        { mediaBox: [0, 0, 300, 150], texts: [{ x: 30, y: 80, size: 18, text: "PAGE2 TARGET" }, { x: 160, y: 40, size: 11, text: "row b" }] },
      ],
    }),
  },
];

for (const f of fixtures) {
  writeFileSync(`${OUT}/${f.name}.pdf`, f.bytes);
  console.log(`\n=== ${f.name} ===  ${f.desc}`);
  console.log(`  expect: ${f.expectNote}`);
  const res = await parseWithLiteParse({ file: { storageId: f.name, fileName: `${f.name}.pdf`, mimeType: "application/pdf", size: f.bytes.length }, bytes: f.bytes, ocrEnabled: false, maxPages: 5 });
  for (const p of res.pages) {
    console.log(`  page ${p.pageNum}: ${p.width}x${p.height}`);
    for (const it of p.textItems) console.log(`    item x=${it.x.toFixed(1)} y=${it.y.toFixed(1)} w=${it.width.toFixed(1)} h=${it.height.toFixed(1)}  "${it.text}"`);
  }
}
console.log(`\nwrote ${fixtures.length} fixtures to ${OUT}/`);
