import type { CellPayload, DataframeColumn } from "../engine/types";

export type SpreadsheetSeedCell = { id: string; value: unknown };

export interface SemanticCellIndexEntry {
  elementId: string;
  coordinate: string;
  rowId: string;
  columnId: string;
  rowIndex: number;
  colIndex: number;
  rowHeader: string;
  columnHeader: string;
  rawValue: string;
  formula?: string;
  semanticSummary: string;
}

export interface SpreadsheetChunkIndexEntry {
  chunkId: string;
  rowStart: number;
  rowEnd: number;
  colStart: number;
  colEnd: number;
  elementIds: string[];
  text: string;
}

export interface SpreadsheetDependencyIndexEntry {
  parentElementId: string;
  childElementId: string;
  parentCoordinate: string;
  childCoordinate: string;
  formula: string;
}

export interface SpreadsheetSemanticIndex {
  cells: SemanticCellIndexEntry[];
  chunks: SpreadsheetChunkIndexEntry[];
  dependencies: SpreadsheetDependencyIndexEntry[];
}

const DEFAULT_ROW_WINDOW = 8;
const DEFAULT_COL_WINDOW = 6;
const DEFAULT_OVERLAP = 2;
const MAX_FORMULA_DEPENDENCIES = 1_000;

export function buildSpreadsheetSemanticIndex(args: {
  title: string;
  columns: DataframeColumn[];
  seed: SpreadsheetSeedCell[];
  rowWindow?: number;
  colWindow?: number;
  overlap?: number;
}): SpreadsheetSemanticIndex {
  const columns = [...args.columns].sort((a, b) => a.order - b.order);
  const colById = new Map(columns.map((col, idx) => [col.id, { col, idx }]));
  const a1Layout = isA1Layout(args.seed);
  const rowIds = orderedRowIds(args.seed, a1Layout);
  const valueByElementId = new Map(args.seed.map((cell) => [cell.id, cell.value]));
  const cells: SemanticCellIndexEntry[] = [];

  for (const rowId of rowIds) {
    const rowIndex = a1Layout ? Number(rowId) : rowIds.indexOf(rowId) + 1;
    const rowHeader = rowHeaderFor(rowId, columns, valueByElementId, a1Layout);
    for (const column of columns) {
      const info = colById.get(column.id);
      if (!info) continue;
      const elementId = elementIdFor(rowId, column.id, info.idx, a1Layout);
      if (!valueByElementId.has(elementId)) continue;
      const raw = payloadRawValue(valueByElementId.get(elementId));
      const formula = payloadFormula(valueByElementId.get(elementId));
      const coordinate = a1Layout ? elementId : `${columnLetters(info.idx)}${rowIndex + 1}`;
      const columnHeader = a1Layout
        ? payloadRawValue(valueByElementId.get(`${columnLetters(info.idx)}1`)).trim() || column.label
        : column.label;
      const formulaText = formula ? ` | Formula: ${formula}` : "";
      cells.push({
        elementId,
        coordinate,
        rowId,
        columnId: column.id,
        rowIndex,
        colIndex: info.idx + 1,
        rowHeader,
        columnHeader,
        rawValue: raw,
        formula,
        semanticSummary: `Sheet: ${args.title} | Cell: ${coordinate} | Row: ${rowHeader} | Column: ${column.label} | Value: ${raw}${formulaText}`,
      });
    }
  }

  return {
    cells,
    chunks: buildChunks({
      title: args.title,
      columns,
      rowIds,
      cells,
      rowWindow: args.rowWindow ?? DEFAULT_ROW_WINDOW,
      colWindow: args.colWindow ?? DEFAULT_COL_WINDOW,
      overlap: args.overlap ?? DEFAULT_OVERLAP,
    }),
    dependencies: buildDependencies(cells),
  };
}

export function columnLetters(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1;
  let out = "";
  while (n > 0) {
    const mod = (n - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    n = Math.floor((n - mod) / 26);
  }
  return out;
}

export function columnLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function orderedRowIds(seed: SpreadsheetSeedCell[], a1Layout: boolean): string[] {
  const rowIds: string[] = [];
  for (const cell of seed) {
    const rowId = a1Layout ? cell.id.match(/^\$?[A-Z]{1,3}\$?([0-9]+)$/i)?.[1] : cell.id.split("__")[0];
    if (rowId && !rowIds.includes(rowId)) rowIds.push(rowId);
  }
  return a1Layout ? rowIds.sort((a, b) => Number(a) - Number(b)) : rowIds;
}

function rowHeaderFor(rowId: string, columns: DataframeColumn[], valueByElementId: Map<string, unknown>, a1Layout: boolean): string {
  for (const [index, column] of columns.entries()) {
    const elementId = elementIdFor(rowId, column.id, index, a1Layout);
    const raw = payloadRawValue(valueByElementId.get(elementId)).trim();
    if (raw) return raw.slice(0, 120);
  }
  return rowId;
}

function elementIdFor(rowId: string, columnId: string, columnIndex: number, a1Layout: boolean): string {
  return a1Layout ? `${columnLetters(columnIndex)}${rowId}` : `${rowId}__${columnId}`;
}

function isA1Layout(seed: SpreadsheetSeedCell[]): boolean {
  return seed.length > 0 && seed.every((cell) => /^\$?[A-Z]{1,3}\$?[0-9]+$/i.test(cell.id));
}

function payloadRawValue(value: unknown): string {
  const raw = isCellPayload(value) ? value.value : value;
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  return JSON.stringify(raw);
}

function payloadFormula(value: unknown): string | undefined {
  const payload = isCellPayload(value) ? value : undefined;
  const formula = payload?.formula;
  if (formula?.trim()) return formula.trim();
  const raw = payloadRawValue(value).trim();
  return raw.startsWith("=") ? raw : undefined;
}

function isCellPayload(value: unknown): value is CellPayload {
  return !!value && typeof value === "object" && "value" in value;
}

function buildChunks(args: {
  title: string;
  columns: DataframeColumn[];
  rowIds: string[];
  cells: SemanticCellIndexEntry[];
  rowWindow: number;
  colWindow: number;
  overlap: number;
}): SpreadsheetChunkIndexEntry[] {
  const byRowCol = new Map(args.cells.map((cell) => [`${cell.rowIndex}:${cell.colIndex}`, cell]));
  const rowStep = Math.max(1, args.rowWindow - args.overlap);
  const colStep = Math.max(1, args.colWindow - args.overlap);
  const chunks: SpreadsheetChunkIndexEntry[] = [];
  for (let rowStart = 1; rowStart <= args.rowIds.length; rowStart += rowStep) {
    const rowEnd = Math.min(args.rowIds.length, rowStart + args.rowWindow - 1);
    for (let colStart = 1; colStart <= args.columns.length; colStart += colStep) {
      const colEnd = Math.min(args.columns.length, colStart + args.colWindow - 1);
      const elementIds: string[] = [];
      const lines = [
        `Spreadsheet: ${args.title}`,
        `Global columns: ${args.columns.map((c) => c.label).join(" | ")}`,
        `Sub-grid rows ${rowStart}-${rowEnd}, columns ${colStart}-${colEnd}`,
      ];
      for (let r = rowStart; r <= rowEnd; r++) {
        const values: string[] = [];
        for (let c = colStart; c <= colEnd; c++) {
          const cell = byRowCol.get(`${r}:${c}`);
          if (!cell) continue;
          elementIds.push(cell.elementId);
          values.push(`${cell.columnHeader}: ${cell.rawValue}`);
        }
        if (values.length) lines.push(`Row ${r}: ${values.join(" | ")}`);
      }
      if (!elementIds.length) continue;
      chunks.push({
        chunkId: `r${rowStart}-${rowEnd}_c${colStart}-${colEnd}`,
        rowStart,
        rowEnd,
        colStart,
        colEnd,
        elementIds,
        text: lines.join("\n"),
      });
    }
  }
  return chunks;
}

function buildDependencies(cells: SemanticCellIndexEntry[]): SpreadsheetDependencyIndexEntry[] {
  const byCoordinate = new Map(cells.map((cell) => [cell.coordinate, cell]));
  const dependencies: SpreadsheetDependencyIndexEntry[] = [];
  for (const child of cells) {
    if (!child.formula) continue;
    const parentCoordinates = expandFormulaReferences(child.formula);
    for (const parentCoordinate of parentCoordinates) {
      const parent = byCoordinate.get(parentCoordinate);
      if (!parent || parent.elementId === child.elementId) continue;
      dependencies.push({
        parentElementId: parent.elementId,
        childElementId: child.elementId,
        parentCoordinate,
        childCoordinate: child.coordinate,
        formula: child.formula,
      });
    }
  }
  return dependencies;
}

function expandFormulaReferences(formula: string): string[] {
  const refs = new Set<string>();
  const re = /\$?([A-Z]{1,3})\$?([0-9]{1,7})(?::\$?([A-Z]{1,3})\$?([0-9]{1,7}))?/gi;
  for (const match of formula.matchAll(re)) {
    const startCol = columnLettersToIndex(match[1]);
    const startRow = Number(match[2]);
    const endCol = match[3] ? columnLettersToIndex(match[3]) : startCol;
    const endRow = match[4] ? Number(match[4]) : startRow;
    for (let c = Math.min(startCol, endCol); c <= Math.max(startCol, endCol); c++) {
      for (let r = Math.min(startRow, endRow); r <= Math.max(startRow, endRow); r++) {
        refs.add(`${columnLetters(c)}${r}`);
        if (refs.size >= MAX_FORMULA_DEPENDENCIES) return [...refs];
      }
    }
  }
  return [...refs];
}
