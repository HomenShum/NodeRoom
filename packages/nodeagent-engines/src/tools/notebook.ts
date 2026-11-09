/** Minimal nbformat 4.5 writer: create a notebook or append one cell. */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export type CellType = "markdown" | "code";

interface Cell {
  cell_type: string;
  id?: string;
  metadata: Record<string, unknown>;
  source: string | string[];
  execution_count?: number | null;
  outputs?: unknown[];
}

interface Notebook {
  cells: Cell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

/** nbformat stores multi-line source as lines that keep their trailing "\n". */
export function toSourceLines(source: string): string[] {
  const lines = source.split(/(?<=\n)/);
  return lines.length === 1 && lines[0] === "" ? [] : lines;
}

const cellId = () => randomUUID().replace(/-/g, "").slice(0, 16);

/**
 * Append a cell to `absPath`, creating the notebook when missing. Refuses
 * (throws) on an existing file that is not nbformat 4 JSON, so it never clobbers.
 */
export function addNotebookCell(absPath: string, cellType: CellType, source: string): { created: boolean; cells: number; cellId: string; json: string } {
  let nb: Notebook;
  const created = !existsSync(absPath);
  if (created) {
    nb = { cells: [], metadata: {}, nbformat: 4, nbformat_minor: 5 };
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(absPath, "utf8"));
    } catch {
      throw new Error("existing file is not valid notebook JSON; refusing to overwrite");
    }
    const p = parsed as Partial<Notebook>;
    if (!p || typeof p !== "object" || p.nbformat !== 4 || !Array.isArray(p.cells)) {
      throw new Error("existing file is not an nbformat 4 notebook; refusing to overwrite");
    }
    nb = { cells: p.cells, metadata: p.metadata ?? {}, nbformat: 4, nbformat_minor: p.nbformat_minor ?? 0 };
    // 4.5 requires a unique id on every cell.
    if (nb.nbformat_minor < 5) {
      for (const c of nb.cells) c.id ??= cellId();
      nb.nbformat_minor = 5;
    }
  }
  const id = cellId();
  const cell: Cell =
    cellType === "code"
      ? { cell_type: "code", id, metadata: {}, source: toSourceLines(source), execution_count: null, outputs: [] }
      : { cell_type: "markdown", id, metadata: {}, source: toSourceLines(source) };
  nb.cells.push(cell);
  const json = `${JSON.stringify(nb, null, 1)}\n`;
  mkdirSync(path.dirname(absPath), { recursive: true });
  writeFileSync(absPath, json);
  return { created, cells: nb.cells.length, cellId: id, json };
}
