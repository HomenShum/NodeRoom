import type { CellPayload, DataframeColumn } from "../engine/types";
import type { UploadedArtifactInput } from "./uploadedArtifact";
import { buildSpreadsheetSemanticIndex, columnLetters } from "./spreadsheetIndex";

type ExcelCell = import("exceljs").Cell;
type ExcelWorkbookCtor = typeof import("exceljs").Workbook;
type ParsedCell = { value: unknown; formula?: string };

const MAX_PARSE_ROWS = 2_000;
const MAX_PARSE_COLUMNS = 80;
// Convex validates v.array() arguments before the mutation body runs; 8,192 is
// the hard upload boundary even though the backend also checks payload size.
const MAX_MUTATION_SEED_CELLS = 8_192;
const MAX_HEADER_SCAN_ROWS = 50;
const MAX_XLSX_ZIP_ENTRIES = 2_000;
const MAX_XLSX_UNCOMPRESSED_BYTES = 50_000_000;
const MAX_STYLE_ENTRIES = 4_000;
const MAX_MERGE_RANGES = 200;

/** Capture the visual style of one cell as a compact entry, or null when fully default.
 *  numFmt strings are dictionary-encoded (workbooks reuse a handful of formats thousands of times). */
function captureCellStyle(
  cell: ExcelCell,
  numFmts: string[],
  numFmtIndex: Map<string, number>,
): import("../engine/types").ExcelCellStyle | null {
  const out: import("../engine/types").ExcelCellStyle = {};
  const fmt = cell.numFmt;
  if (typeof fmt === "string" && fmt && fmt !== "General") {
    let idx = numFmtIndex.get(fmt);
    if (idx === undefined && numFmts.length < 64) { idx = numFmts.length; numFmts.push(fmt); numFmtIndex.set(fmt, idx); }
    if (idx !== undefined) out.f = idx;
  }
  if (cell.font?.bold) out.b = 1;
  if (cell.font?.italic) out.i = 1;
  if (cell.font?.underline) out.u = 1;
  // Font color: explicit ARGB only (theme/indexed colors have no argb and fall back to the
  // renderer's dark-fill light-ink heuristic). Skip default black — it's not a style choice.
  const fontColor = (cell.font?.color as { argb?: string } | undefined)?.argb;
  if (fontColor && fontColor.length === 8 && !["FF000000", "00000000"].includes(fontColor.toUpperCase())) {
    out.fc = `#${fontColor.slice(2)}`;
  }
  const h = cell.alignment?.horizontal;
  if (h === "right") out.a = "r";
  else if (h === "center" || h === "centerContinuous") out.a = "c";
  if (typeof cell.alignment?.indent === "number" && cell.alignment.indent > 0) out.ind = cell.alignment.indent;
  const fill = cell.fill as { type?: string; pattern?: string; fgColor?: { argb?: string } } | undefined;
  if (fill?.type === "pattern" && fill.pattern === "solid" && fill.fgColor?.argb) {
    const argb = fill.fgColor.argb;
    if (argb.length === 8 && argb.toUpperCase() !== "FFFFFFFF") out.bg = `#${argb.slice(2)}`;
  }
  if (cell.border?.top?.style) out.bt = 1;
  if (cell.border?.bottom?.style) out.bb = 1;
  return Object.keys(out).length ? out : null;
}

export type ParseSpreadsheetArgs =
  | { fileName: string; mimeType: string; size: number; text: string; delimiter?: "," | "\t" }
  | { fileName: string; mimeType: string; size: number; arrayBuffer: ArrayBuffer };

export async function parseSpreadsheetArtifacts(args: ParseSpreadsheetArgs): Promise<UploadedArtifactInput[]> {
  if ("text" in args) {
    const delimiter = args.delimiter ?? (args.fileName.toLowerCase().endsWith(".tsv") ? "\t" : ",");
    return [sheetArtifactFromRows({
      fileName: args.fileName,
      mimeType: args.mimeType,
      size: args.size,
      sheetName: "Sheet1",
      sheetNames: ["Sheet1"],
      rows: parseDelimited(args.text, delimiter),
      parser: `csv:${delimiter === "\t" ? "tsv" : "csv"}`,
    })];
  }

  const Workbook = await loadWorkbookCtor();
  preflightXlsxZip(args.arrayBuffer);
  const workbook = new Workbook();
  await workbook.xlsx.load(args.arrayBuffer);
  const names = workbook.worksheets.map((sheet) => sheet.name);
  const artifacts: UploadedArtifactInput[] = [];
  for (const sheet of workbook.worksheets) {
    artifacts.push(sheetArtifactFromWorkbookGrid({
      fileName: args.fileName,
      mimeType: args.mimeType,
      size: args.size,
      sheetName: sheet.name,
      sheetNames: names,
      sheet,
    }));
  }
  if (artifacts.length) return artifacts;
  const emptySheet = workbook.addWorksheet("Sheet1");
  return [sheetArtifactFromWorkbookGrid({
    fileName: args.fileName,
    mimeType: args.mimeType,
    size: args.size,
    sheetName: "Sheet1",
    sheetNames: ["Sheet1"],
    sheet: emptySheet,
  })];
}

export function spreadsheetArtifactFromRows(args: {
  fileName: string;
  mimeType: string;
  size: number;
  rows: unknown[][];
  sheetName?: string;
  parser?: string;
}): UploadedArtifactInput {
  const sheetName = args.sheetName ?? "Sheet1";
  return sheetArtifactFromRows({
    fileName: args.fileName,
    mimeType: args.mimeType,
    size: args.size,
    sheetName,
    sheetNames: [sheetName],
    rows: args.rows,
    parser: args.parser ?? "rows",
  });
}

function sheetArtifactFromWorkbookGrid(args: {
  fileName: string;
  mimeType: string;
  size: number;
  sheetName: string;
  sheetNames: string[];
  sheet: import("exceljs").Worksheet;
}): UploadedArtifactInput {
  const rawRows = Math.max(args.sheet.rowCount, args.sheet.actualRowCount, 1);
  const rawColumns = Math.max(args.sheet.columnCount, args.sheet.actualColumnCount, 1);
  const columnLimit = Math.max(1, Math.min(rawColumns, MAX_PARSE_COLUMNS, MAX_MUTATION_SEED_CELLS));
  const rowLimit = Math.max(1, Math.min(rawRows, MAX_PARSE_ROWS, Math.floor(MAX_MUTATION_SEED_CELLS / columnLimit)));
  const columns = excelColumns(columnLimit);
  const warnings: string[] = [];
  if (rawRows > rowLimit) warnings.push(`Parsed first ${rowLimit} worksheet rows to stay within ${MAX_MUTATION_SEED_CELLS} cells.`);
  if (rawColumns > columnLimit) warnings.push(`Parsed first ${columnLimit} worksheet columns.`);

  const seed: Array<{ id: string; value: unknown }> = [];
  // Style layer (render-only): non-default cells only, hard-capped (BOUND) — a pathological
  // workbook must degrade to unstyled rendering, never to an unbounded meta blob.
  const styles: Record<string, import("../engine/types").ExcelCellStyle> = {};
  const numFmts: string[] = [];
  const numFmtIndex = new Map<string, number>();
  let styleCount = 0;
  for (let row = 1; row <= rowLimit; row++) {
    const excelRow = args.sheet.getRow(row);
    for (let col = 1; col <= columnLimit; col++) {
      const letter = columnLetters(col - 1);
      const cell = excelRow.getCell(col);
      seed.push({
        id: `${letter}${row}`,
        value: excelCellPayload(cellToScalar(cell), args, row, letter),
      });
      if (styleCount < MAX_STYLE_ENTRIES) {
        const style = captureCellStyle(cell, numFmts, numFmtIndex);
        if (style) { styles[`${letter}${row}`] = style; styleCount++; }
      }
    }
  }
  if (styleCount >= MAX_STYLE_ENTRIES) warnings.push(`Captured first ${MAX_STYLE_ENTRIES} cell styles; remaining cells render unstyled.`);
  const colWidths = Array.from({ length: columnLimit }, (_, i) => {
    const w = args.sheet.getColumn(i + 1)?.width;
    return typeof w === "number" && w > 0 ? Math.round(w * 7 + 5) : 0;
  });
  const merges = (((args.sheet as { model?: { merges?: string[] } }).model?.merges) ?? []).slice(0, MAX_MERGE_RANGES);

  const multi = args.sheetNames.length > 1;
  const title = multi ? `${args.fileName} / ${args.sheetName}` : args.fileName;
  return {
    kind: "sheet",
    title,
    seed,
    meta: {
      upload: { fileName: args.fileName, mimeType: args.mimeType, size: args.size, parsedAt: Date.now() },
      excelGrid: {
        sourceFile: args.fileName,
        sheetName: args.sheetName,
        sheetNames: args.sheetNames,
        parser: "exceljs:xlsx-grid",
        rows: rowLimit,
        columns: columnLimit,
        truncated: warnings.length > 0,
        warnings,
        ...(styleCount > 0 ? { styles, numFmts } : {}),
        ...(colWidths.some((w) => w > 0) ? { colWidths } : {}),
        ...(merges.length ? { merges } : {}),
      },
      dataframe: {
        columns,
        rowCount: rowLimit,
        sourceFile: args.fileName,
        sheetName: args.sheetName,
        sheetNames: args.sheetNames,
        parser: "exceljs:xlsx-grid",
        truncated: warnings.length > 0,
        warnings,
        semanticIndex: {
          cellCount: seed.length,
          chunkCount: 0,
          dependencyCount: 0,
          indexedAt: Date.now(),
        },
      },
    },
  };
}

function sheetArtifactFromRows(args: {
  fileName: string;
  mimeType: string;
  size: number;
  sheetName: string;
  sheetNames: string[];
  rows: unknown[][];
  parser: string;
}): UploadedArtifactInput {
  const nonEmptyRows = args.rows.filter((row) => row.some((cell) => String(cell ?? "").trim()));
  const headerIndex = chooseHeaderIndex(nonEmptyRows);
  const header = nonEmptyRows[headerIndex]?.length ? nonEmptyRows[headerIndex] : ["Column 1"];
  const columns = uniqueColumns(header.slice(0, MAX_PARSE_COLUMNS).map((h, i) => String(h ?? "").trim() || `Column ${i + 1}`));
  const rowLimit = Math.max(1, Math.min(MAX_PARSE_ROWS, Math.floor(MAX_MUTATION_SEED_CELLS / Math.max(columns.length, 1))));
  const dataRows = nonEmptyRows.slice(headerIndex + 1, headerIndex + 1 + rowLimit);
  const warnings: string[] = [];
  if (headerIndex > 0) warnings.push(`Skipped ${headerIndex} banner row${headerIndex === 1 ? "" : "s"} before the detected header.`);
  if (nonEmptyRows.length - headerIndex - 1 > rowLimit) warnings.push(`Parsed first ${rowLimit} data rows to stay within ${MAX_MUTATION_SEED_CELLS} cells.`);
  if (header.length > MAX_PARSE_COLUMNS) warnings.push(`Parsed first ${MAX_PARSE_COLUMNS} columns.`);

  const seed: Array<{ id: string; value: unknown }> = [];
  const rowsToSeed = dataRows.length ? dataRows : [columns.map(() => "")];
  rowsToSeed.forEach((row, idx) => {
    const rid = `u${idx + 1}`;
    columns.forEach((col, colIdx) => {
      seed.push({
        id: `${rid}__${col.id}`,
        value: cellPayload(row[colIdx] ?? "", args, idx + headerIndex + 2, col),
      });
    });
  });

  const multi = args.sheetNames.length > 1;
  const title = multi ? `${args.fileName} / ${args.sheetName}` : args.fileName;
  const semanticIndex = buildSpreadsheetSemanticIndex({ title, columns, seed });
  return {
    kind: "sheet",
    title,
    seed,
    meta: {
      upload: { fileName: args.fileName, mimeType: args.mimeType, size: args.size, parsedAt: Date.now() },
      dataframe: {
        columns,
        rowCount: rowsToSeed.length,
        sourceFile: args.fileName,
        sheetName: args.sheetName,
        sheetNames: args.sheetNames,
        parser: args.parser,
        truncated: warnings.length > 0,
        warnings,
        semanticIndex: {
          cellCount: semanticIndex.cells.length,
          chunkCount: semanticIndex.chunks.length,
          dependencyCount: semanticIndex.dependencies.length,
          indexedAt: Date.now(),
        },
      },
    },
  };
}

function chooseHeaderIndex(rows: unknown[][]): number {
  if (!rows.length) return 0;
  const candidates = rows.slice(0, MAX_HEADER_SCAN_ROWS);
  let best = 0, bestScore = Number.NEGATIVE_INFINITY;
  candidates.forEach((row, idx) => {
    const labels = row.map((cell) => String(cell ?? "").trim()).filter(Boolean);
    const distinct = new Set(labels.map((label) => label.toLowerCase())).size;
    const nonEmpty = labels.length;
    const textLike = labels.filter((label) => /[A-Za-z]/.test(label)).length;
    const score = nonEmpty * 4 + distinct * 2 + textLike - idx * 0.01;
    if (score > bestScore) { best = idx; bestScore = score; }
  });
  return best;
}

function cellPayload(value: unknown, args: { fileName: string; sheetName: string }, row: number, column: DataframeColumn): CellPayload {
  const parsed = parsedCell(value);
  const empty = parsed.value === null || parsed.value === undefined || String(parsed.value).trim() === "";
  return {
    value: parsed.value,
    status: empty ? "empty" : "complete",
    confidence: 1,
    formula: parsed.formula,
    evidence: [{
      id: `upload:${args.sheetName}:${row}:${column.id}`,
      kind: "upload",
      label: `${args.fileName} ${args.sheetName}!${column.label}${row}`,
      source: args.fileName,
      sheetName: args.sheetName,
      row,
      column: column.label,
      confidence: 1,
    }],
  };
}

function excelCellPayload(value: unknown, args: { fileName: string; sheetName: string }, row: number, column: string): CellPayload {
  const parsed = parsedCell(value);
  const empty = parsed.value === null || parsed.value === undefined || String(parsed.value).trim() === "";
  return {
    value: parsed.value,
    status: empty ? "empty" : "complete",
    confidence: 1,
    formula: parsed.formula,
    evidence: [{
      id: `upload:${args.sheetName}:${column}${row}`,
      kind: "upload",
      label: `${args.fileName} ${args.sheetName}!${column}${row}`,
      source: args.fileName,
      sheetName: args.sheetName,
      row,
      column,
      confidence: 1,
    }],
  };
}

function parsedCell(value: unknown): ParsedCell {
  if (value && typeof value === "object" && "value" in value) {
    const parsed = value as ParsedCell;
    return { value: parsed.value, formula: parsed.formula };
  }
  const formula = typeof value === "string" && value.trim().startsWith("=") ? value.trim() : undefined;
  return { value, formula };
}

async function loadWorkbookCtor(): Promise<ExcelWorkbookCtor> {
  let lastError: unknown;
  const delaysMs = [80, 160, 320, 640, 1_000, 1_000];
  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      const mod = await import("exceljs");
      return mod.Workbook ?? mod.default.Workbook;
    } catch (err) {
      lastError = err;
      const delay = delaysMs[attempt];
      if (delay === undefined) break;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function preflightXlsxZip(buffer: ArrayBuffer | ArrayBufferView) {
  const bytes = buffer instanceof ArrayBuffer
    ? new Uint8Array(buffer)
    : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let entries = 0;
  let uncompressed = 0;
  for (let offset = 0; offset <= view.byteLength - 46; offset++) {
    if (view.getUint32(offset, true) !== 0x02014b50) continue;
    entries++;
    const size = view.getUint32(offset + 24, true);
    if (size === 0xffffffff) throw new Error("XLSX uses ZIP64; server parsing is required.");
    uncompressed += size;
    if (entries > MAX_XLSX_ZIP_ENTRIES || uncompressed > MAX_XLSX_UNCOMPRESSED_BYTES) {
      throw new Error("XLSX expands beyond the browser parser limit; use server parsing.");
    }
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    offset += 45 + nameLen + extraLen + commentLen;
  }
}

function cellToScalar(cell: ExcelCell): unknown {
  const value = cell.value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return value;
  if ("formula" in value && typeof value.formula === "string") {
    return { value: "result" in value && value.result !== undefined ? value.result : "", formula: `=${value.formula}` };
  }
  if ("result" in value && value.result !== undefined) return value.result;
  if ("text" in value && value.text !== undefined) return value.text;
  if ("hyperlink" in value && value.hyperlink !== undefined) return value.text ?? value.hyperlink;
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
  return JSON.stringify(value);
}

export function parseDelimited(text: string, delimiter: "," | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], next = text[i + 1];
    if (quoted && ch === "\"" && next === "\"") { cell += "\""; i++; continue; }
    if (ch === "\"") { quoted = !quoted; continue; }
    if (!quoted && ch === delimiter) { row.push(cell); cell = ""; continue; }
    if (!quoted && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && next === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = ""; continue;
    }
    cell += ch;
  }
  row.push(cell); rows.push(row);
  return rows;
}

function uniqueColumns(labels: string[]): DataframeColumn[] {
  const seen = new Map<string, number>();
  return labels.map((label, order) => {
    const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 28) || "col";
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return { id: n ? `${base}_${n + 1}` : base, label, order, mode: "manual", type: "text", agentWritable: true };
  });
}

function excelColumns(count: number): DataframeColumn[] {
  return Array.from({ length: count }, (_, order) => {
    const label = columnLetters(order);
    return { id: label, label, order, mode: "manual", type: "text", agentWritable: true };
  });
}

export function isSpreadsheetFile(fileName: string, mimeType = ""): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".csv") || lower.endsWith(".tsv") || lower.endsWith(".xlsx") || lower.endsWith(".xlsm")
    || mimeType === "text/csv"
    || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || mimeType === "application/vnd.ms-excel.sheet.macroEnabled.12";
}

export function isExcelWorkbook(fileName: string, mimeType = ""): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".xlsx") || lower.endsWith(".xlsm")
    || mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    || mimeType === "application/vnd.ms-excel.sheet.macroEnabled.12";
}
