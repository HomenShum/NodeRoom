import type { ArtifactMeta } from "../engine/types";
import { documentParsePlan, guessDocumentMimeType } from "./documentParserPlan";
import { isExcelWorkbook, isSpreadsheetFile, parseSpreadsheetArtifacts, spreadsheetArtifactFromRows } from "./spreadsheetParser";

export type UploadedSourceFile = {
  blob: Blob;
  fileName: string;
  mimeType: string;
  size: number;
};

export type UploadedArtifactInput = {
  kind: "sheet" | "note";
  title: string;
  seed: Array<{ id: string; value: unknown }>;
  meta?: ArtifactMeta;
  sourceFile?: UploadedSourceFile;
};

export const MAX_INLINE_PREVIEW_BYTES = 750_000;
export const MAX_INLINE_PDF_PREVIEW_BYTES = 0;
export const MAX_RAW_UPLOAD_BYTES = 25_000_000;
export const MAX_SPREADSHEET_BYTES = 5_000_000;
export const UPLOAD_TIMEOUT_MS = 12 * 60_000;

type UploadDoc = {
  upload: true;
  fileName: string;
  mimeType: string;
  size: number;
  text?: string;
  dataUrl?: string;
  parse?: ReturnType<typeof documentParsePlan>;
};

// Reject as soon as `signal` aborts even when the underlying file read or upload never settles.
export function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Aborted"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => { signal.removeEventListener("abort", onAbort); resolve(v); },
      (e) => { signal.removeEventListener("abort", onAbort); reject(e); },
    );
  });
}

export async function parseUploadedFiles(files: Iterable<File>, signal?: AbortSignal): Promise<UploadedArtifactInput[]> {
  const parsed: UploadedArtifactInput[] = [];
  const fileList = Array.from(files);
  for (const file of fileList) assertUploadFileWithinLimit(file);
  for (const file of fileList) {
    try {
      parsed.push(...(await (signal ? abortable(artifactsFromFile(file, signal), signal) : artifactsFromFile(file, signal))));
    } catch (e) {
      if (signal?.aborted) throw signal.reason ?? e;
      throw new Error(`${file.name}: ${e instanceof Error ? e.message : "could not be read"}`);
    }
  }
  return parsed;
}

export async function artifactsFromFile(file: File, signal?: AbortSignal): Promise<UploadedArtifactInput[]> {
  const lower = file.name.toLowerCase();
  const mimeType = file.type || guessMimeType(lower);
  if (isSpreadsheetFile(file.name, mimeType)) {
    if (isExcelWorkbook(file.name, mimeType)) {
      return withSourceFile(await parseSpreadsheetArtifacts({ fileName: file.name, mimeType, size: file.size, arrayBuffer: await file.arrayBuffer() }), file, mimeType);
    }
    const text = await file.text();
    return withSourceFile(await parseSpreadsheetArtifacts({ fileName: file.name, mimeType, size: file.size, text, delimiter: lower.endsWith(".tsv") ? "\t" : "," }), file, mimeType);
  }
  const textLike = mimeType.startsWith("text/") || /(\.txt|\.md|\.json|\.log)$/i.test(file.name);
  const parse = documentParsePlan(file.name, mimeType);
  const doc: UploadDoc = { upload: true, fileName: file.name, mimeType, size: file.size, parse };
  if (textLike && file.size <= MAX_INLINE_PREVIEW_BYTES) {
    const text = await file.text();
    const structuredRows = isPlainTextKeyValueSource(file.name, mimeType) ? keyValueRows(text) : null;
    if (structuredRows) {
      return withSourceFile([spreadsheetArtifactFromRows({
        fileName: file.name,
        mimeType,
        size: file.size,
        rows: structuredRows,
        parser: "text:key-value",
      })], file, mimeType);
    }
    doc.text = text;
  } else if (!textLike && file.size <= inlinePreviewLimitFor(file.name, mimeType)) {
    doc.dataUrl = await readAsDataUrl(file, signal);
  }
  return withSourceFile([{ kind: "note", title: file.name, seed: [{ id: "doc", value: doc }], meta: { upload: { fileName: file.name, mimeType, size: file.size, parsedAt: Date.now() }, document: parse } }], file, mimeType);
}

function inlinePreviewLimitFor(fileName: string, mimeType: string): number {
  const lower = fileName.toLowerCase();
  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) return MAX_INLINE_PDF_PREVIEW_BYTES;
  return MAX_INLINE_PREVIEW_BYTES;
}

function assertUploadFileWithinLimit(file: File): void {
  const mimeType = file.type || guessMimeType(file.name.toLowerCase());
  if (isSpreadsheetFile(file.name, mimeType)) {
    if (file.size > MAX_SPREADSHEET_BYTES) throw new Error(`${file.name} is too large for browser spreadsheet parsing (${formatBytes(MAX_SPREADSHEET_BYTES)} max).`);
    return;
  }
  if (file.size > MAX_RAW_UPLOAD_BYTES) throw new Error(`${file.name} is too large for room source upload (${formatBytes(MAX_RAW_UPLOAD_BYTES)} max).`);
}

function withSourceFile(artifacts: UploadedArtifactInput[], file: File, mimeType: string): UploadedArtifactInput[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    sourceFile: { blob: file, fileName: file.name, mimeType, size: file.size },
  }));
}

function isPlainTextKeyValueSource(fileName: string, mimeType: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".txt") || mimeType === "text/plain";
}

function keyValueRows(text: string): unknown[][] | null {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return null;
  const rows: unknown[][] = [["field", "value"]];
  for (const line of lines) {
    const match = /^([^:=\t]{1,120}?)\s*[:=]\s*(.+)$/.exec(line);
    if (!match) return null;
    const key = match[1].trim();
    const value = match[2].trim();
    if (!key || !/[A-Za-z0-9]/.test(key) || !value) return null;
    rows.push([key, structuredScalar(value)]);
  }
  return rows.length > 1 ? rows : null;
}

function structuredScalar(value: string): unknown {
  const unquoted = value.replace(/^(['"])(.*)\1$/, "$2").trim();
  const compactNumber = unquoted.replace(/,/g, "");
  if (/^[+-]?(?:\d+|\d*\.\d+)$/.test(compactNumber)) return Number(compactNumber);
  return unquoted;
}

async function readAsDataUrl(file: File, signal?: AbortSignal): Promise<string> {
  if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
  if (typeof file.arrayBuffer !== "function") return readAsDataUrlWithFileReader(file, signal);
  const buffer = await (signal ? abortable(file.arrayBuffer(), signal) : file.arrayBuffer());
  return `data:${file.type || guessMimeType(file.name)};base64,${bytesToBase64(new Uint8Array(buffer))}`;
}

type FileReaderLike = {
  result: unknown;
  error: unknown;
  onload: (() => void) | null;
  onerror: (() => void) | null;
  abort: () => void;
  readAsDataURL: (file: File) => void;
};

function readAsDataUrlWithFileReader(file: File, signal?: AbortSignal): Promise<string> {
  const Reader = (globalThis as typeof globalThis & { FileReader?: new () => FileReaderLike }).FileReader;
  if (!Reader) throw new Error("File data URL reading is unavailable in this runtime.");
  return new Promise((resolve, reject) => {
    const reader = new Reader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    if (signal) {
      if (signal.aborted) { reject(signal.reason ?? new Error("Aborted")); return; }
      signal.addEventListener("abort", () => { try { reader.abort(); } catch { /* already settled */ } reject(signal.reason ?? new Error("Aborted")); }, { once: true });
    }
    reader.readAsDataURL(file);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  const btoaFn = (globalThis as typeof globalThis & { btoa?: (value: string) => string }).btoa;
  if (!btoaFn) throw new Error("Base64 encoding is unavailable in this runtime.");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoaFn(binary);
}

function guessMimeType(name: string) {
  const documentMime = guessDocumentMimeType(name);
  if (documentMime) return documentMime;
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".gif")) return "image/gif";
  if (name.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104_857.6) / 10} MB`;
}
