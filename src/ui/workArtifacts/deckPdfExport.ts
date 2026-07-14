import type { DeckSlidePlan, DeckStoryboard } from "./deckStoryboard";

export interface DeckPdfExport {
  exportVersion: 1;
  deckId: string;
  planHash: string;
  title: string;
  generatedAt: number;
  slideCount: number;
  needsReviewCount: number;
  integrityHash: string;
  fileName: string;
  bytes: Uint8Array;
}

const PDF_MIME = "application/pdf";
const PAGE_WIDTH = 960;
const PAGE_HEIGHT = 540;

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "deck";
}

function clip(value: string, limit: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trim()}...`;
}

function pdfText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "?");
}

function wrap(value: string, max = 84): string[] {
  const words = value.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

export function deckPdfFileName(title: string, integrityHash: string): string {
  return `${slug(title)}-deck-${integrityHash}.pdf`;
}

export function deckPdfMimeType(): string {
  return PDF_MIME;
}

function textCommand(text: string, x: number, y: number, size: number, color: [number, number, number], bold = false): string {
  const [r, g, b] = color;
  return `BT ${r} ${g} ${b} rg /F1 ${size} Tf ${bold ? "2 Tr " : ""}${x} ${y} Td (${pdfText(text)}) Tj ${bold ? "0 Tr " : ""}ET`;
}

function slideContent(slide: DeckSlidePlan, index: number): string {
  const commands: string[] = [
    "0.031 0.035 0.043 rg 0 0 960 540 re f",
    "0.063 0.075 0.090 rg 28 28 904 484 re f",
    "0.149 0.165 0.196 RG 28 28 904 484 re S",
    textCommand(String(index + 1).padStart(2, "0"), 44, 480, 13, [0.898, 0.584, 0.475], true),
    textCommand(slide.status.replace("_", " ").toUpperCase(), 86, 480, 10, slide.status === "needs_review" ? [0.898, 0.584, 0.475] : [0.333, 0.831, 0.604], true),
    textCommand(clip(slide.title, 72), 44, 438, 26, [0.953, 0.965, 0.984], true),
  ];

  wrap(slide.purpose, 96).slice(0, 2).forEach((line, lineIndex) => {
    commands.push(textCommand(line, 44, 408 - lineIndex * 18, 12, [0.667, 0.706, 0.769]));
  });

  commands.push(textCommand("Claims", 44, 350, 12, [0.898, 0.584, 0.475], true));
  slide.claims.slice(0, 5).forEach((claim, claimIndex) => {
    const y = 325 - claimIndex * 37;
    const statusColor: [number, number, number] = claim.status === "verified" ? [0.333, 0.831, 0.604] : claim.status === "needs_review" ? [0.898, 0.584, 0.475] : [0.843, 0.871, 0.914];
    commands.push(textCommand(claim.status.replace("_", " "), 58, y, 9, statusColor, true));
    commands.push(textCommand(clip(claim.text, 104), 150, y, 10, [0.843, 0.871, 0.914]));
  });

  commands.push(textCommand("Review gaps", 44, 118, 12, [0.898, 0.584, 0.475], true));
  const gaps = slide.unresolvedGaps.slice(0, 3);
  if (gaps.length === 0) {
    commands.push(textCommand("No unresolved gaps on this slide.", 58, 94, 10, [0.557, 0.596, 0.655]));
  } else {
    gaps.forEach((gap, gapIndex) => {
      commands.push(textCommand(clip(gap, 112), 58, 94 - gapIndex * 18, 10, [0.898, 0.584, 0.475]));
    });
  }

  return commands.join("\n");
}

function buildPdf(pageContents: string[], title: string): Uint8Array {
  const objects: string[] = [];
  const catalogId = 1;
  const pagesId = 2;
  const fontId = 3;
  const pageObjectIds = pageContents.map((_, index) => 4 + index * 2);
  const contentObjectIds = pageContents.map((_, index) => 5 + index * 2);
  const infoId = 4 + pageContents.length * 2;

  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId] = `<< /Type /Pages /Count ${pageContents.length} /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pageContents.forEach((content, index) => {
    const pageId = pageObjectIds[index];
    const contentId = contentObjectIds[index];
    objects[pageId] = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objects[infoId] = `<< /Title (${pdfText(title)}) /Creator (NodeRoom) /Producer (NodeRoom) /CreationDate (D:19700101000000Z) /ModDate (D:19700101000000Z) >>`;

  let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = body.length;
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(body);
}

export function buildDeckPdfExport(storyboard: DeckStoryboard, generatedAt = 0): DeckPdfExport {
  const needsReviewCount = storyboard.slides.reduce(
    (sum, slide) => sum + slide.unresolvedGaps.length + slide.claims.filter((claim) => claim.status !== "verified").length,
    0,
  );
  const hashBase = {
    deckId: storyboard.deckId,
    planHash: storyboard.planHash,
    title: storyboard.title,
    slides: storyboard.slides.map((slide) => ({
      id: slide.slideId,
      title: slide.title,
      purpose: slide.purpose,
      status: slide.status,
      claims: slide.claims.map((claim) => [claim.claimId, claim.text, claim.status, claim.evidenceId, claim.traceId, claim.proposalId]),
      gaps: slide.unresolvedGaps,
    })),
  };
  const integrityHash = stableHash(hashBase);
  const pageContents = storyboard.slides.map((slide, index) => slideContent(slide, index));
  const bytes = buildPdf(pageContents, storyboard.title);
  return {
    exportVersion: 1,
    deckId: storyboard.deckId,
    planHash: storyboard.planHash,
    title: storyboard.title,
    generatedAt,
    slideCount: storyboard.slides.length,
    needsReviewCount,
    integrityHash,
    fileName: deckPdfFileName(storyboard.title, integrityHash),
    bytes,
  };
}
