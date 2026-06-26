import { isExcelWorkbook, parseSpreadsheetArtifacts } from "../../app/spreadsheetParser";
import type { Actor, Artifact as Art, DocumentParseMeta } from "../../engine/types";

export type WorkbookPreviewDoc = {
  upload: true;
  fileName: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  parse?: DocumentParseMeta;
};

export function isWorkbookPreviewDoc(doc: WorkbookPreviewDoc): boolean {
  return !!doc.dataUrl && doc.dataUrl.startsWith("data:") && isExcelWorkbook(doc.fileName, doc.mimeType);
}

export async function workbookPreviewArtifactFromDataUrl(
  doc: WorkbookPreviewDoc,
  roomId: string,
  actor: Actor,
  now = Date.now(),
): Promise<Art | null> {
  if (!isWorkbookPreviewDoc(doc) || !doc.dataUrl) return null;
  const parsed = await parseSpreadsheetArtifacts({
    fileName: doc.fileName,
    mimeType: doc.mimeType,
    size: doc.size,
    arrayBuffer: arrayBufferFromDataUrl(doc.dataUrl),
  });
  const sheet = parsed.find((artifact) => artifact.kind === "sheet");
  if (!sheet) return null;
  const elements = Object.fromEntries(sheet.seed.map((cell) => [
    cell.id,
    {
      id: cell.id,
      value: cell.value,
      version: 1,
      updatedAt: now,
      updatedBy: actor,
    },
  ]));
  return {
    id: `workbook-preview:${doc.fileName}:${sheet.title}`,
    roomId,
    kind: "sheet",
    title: sheet.title,
    version: 1,
    elements,
    order: sheet.seed.map((cell) => cell.id),
    updatedAt: now,
    createdBy: actor,
    visibility: "room",
    meta: sheet.meta,
  };
}

function arrayBufferFromDataUrl(dataUrl: string): ArrayBuffer {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("Workbook preview data URL is invalid.");
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
