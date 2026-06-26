import JSZip from "jszip";
import type { DocumentParseMeta } from "../../engine/types";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export type OfficePreviewDoc = {
  upload: true;
  fileName: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  text?: string;
  parse?: DocumentParseMeta;
};

export type OfficePreviewKind = "presentation" | "document";

export type OfficePreviewSection = {
  title: string;
  lines: string[];
};

export type OfficePreview = {
  kind: OfficePreviewKind;
  title: string;
  subtitle: string;
  sections: OfficePreviewSection[];
};

export function isOfficePreviewDoc(doc: OfficePreviewDoc): boolean {
  if (!doc.dataUrl?.startsWith("data:")) return false;
  const lowerName = doc.fileName.toLowerCase();
  return doc.mimeType === PPTX_MIME
    || doc.mimeType === DOCX_MIME
    || lowerName.endsWith(".pptx")
    || lowerName.endsWith(".docx");
}

export async function officePreviewFromDataUrl(doc: OfficePreviewDoc): Promise<OfficePreview | null> {
  if (!isOfficePreviewDoc(doc) || !doc.dataUrl) return null;
  const zip = await JSZip.loadAsync(arrayBufferFromDataUrl(doc.dataUrl));
  if (isPresentationDoc(doc)) return pptxPreview(zip, doc.fileName);
  return docxPreview(zip, doc.fileName);
}

function isPresentationDoc(doc: OfficePreviewDoc): boolean {
  return doc.mimeType === PPTX_MIME || doc.fileName.toLowerCase().endsWith(".pptx");
}

async function docxPreview(zip: JSZip, fileName: string): Promise<OfficePreview> {
  const documentXml = await zip.file("word/document.xml")?.async("text");
  const lines = documentXml ? extractWordParagraphs(documentXml) : [];
  return {
    kind: "document",
    title: fileName,
    subtitle: `${lines.length} preview line${lines.length === 1 ? "" : "s"}`,
    sections: [{
      title: "Document text",
      lines: lines.length ? lines : ["No previewable document text found."],
    }],
  };
}

async function pptxPreview(zip: JSZip, fileName: string): Promise<OfficePreview> {
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((left, right) => slideNumber(left) - slideNumber(right));
  const sections: OfficePreviewSection[] = [];
  for (const path of slidePaths) {
    const xml = await zip.file(path)?.async("text");
    const lines = xml ? extractDrawingText(xml) : [];
    sections.push({
      title: `Slide ${slideNumber(path)}`,
      lines: lines.length ? lines : ["No previewable slide text found."],
    });
  }
  return {
    kind: "presentation",
    title: fileName,
    subtitle: `${sections.length} slide${sections.length === 1 ? "" : "s"}`,
    sections: sections.length ? sections : [{
      title: "Slides",
      lines: ["No previewable slide text found."],
    }],
  };
}

function extractWordParagraphs(xml: string): string[] {
  const paragraphs = Array.from(xml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/gi))
    .map((match) => extractTaggedText(match[0], "w:t").join("").trim())
    .filter(Boolean);
  return paragraphs.length ? normalizeLines(paragraphs) : normalizeLines(extractTaggedText(xml, "w:t"));
}

function extractDrawingText(xml: string): string[] {
  return normalizeLines(extractTaggedText(xml, "a:t"));
}

function extractTaggedText(xml: string, tagName: "w:t" | "a:t"): string[] {
  const [prefix, localName] = tagName.split(":");
  const pattern = new RegExp(`<${prefix}:${localName}\\b[^>]*>([\\s\\S]*?)<\\/${prefix}:${localName}>`, "gi");
  return Array.from(xml.matchAll(pattern))
    .map((match) => decodeXml(match[1]).replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function normalizeLines(lines: string[]): string[] {
  return lines
    .map((line) => humanizePackageLine(line.replace(/\s+/g, " ").trim()))
    .filter(Boolean)
    .slice(0, 80);
}

function humanizePackageLine(line: string): string {
  const match = /^([^:]{1,96}):\s+(.+=.+)$/.exec(line);
  const label = match?.[1]?.trim();
  const body = match?.[2]?.trim() ?? line;
  const fields = body
    .split(/\s*;\s*/)
    .map((part) => {
      const field = /^([A-Za-z0-9_ -]{1,48})=(.*)$/.exec(part.trim());
      return field ? `${titleCase(field[1])}: ${field[2].trim()}` : "";
    })
    .filter(Boolean);
  if (fields.length < 2) return line;
  return label ? `${label} — ${fields.join(" · ")}` : fields.join(" · ");
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function slideNumber(path: string): number {
  const match = /slide(\d+)\.xml$/i.exec(path);
  return match ? Number(match[1]) : 0;
}

function arrayBufferFromDataUrl(dataUrl: string): ArrayBuffer {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("Office preview data URL is invalid.");
  if (match[2]) {
    const atobFn = globalThis.atob;
    if (typeof atobFn !== "function") throw new Error("Base64 decoding is unavailable.");
    const binary = atobFn(match[3]);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }
  return new TextEncoder().encode(decodeURIComponent(match[3])).buffer;
}
