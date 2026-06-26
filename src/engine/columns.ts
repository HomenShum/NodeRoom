/**
 * Single source of truth for tabular-artifact COLUMN rules — used by createArtifact, the demo/Convex
 * seeds, and the agent's `define_columns` tool (RoomEngine.setColumns / convex setColumnsByAgent), so
 * the id/order/BOUND rules can never drift between lanes. (docs/architecture/AGENT_GOVERNED_COLUMNS.md)
 */
import type { DataframeColumn, DataframeColumnMode } from "./types";

export const MAX_COLUMNS = 64;

export type ColumnType = "text" | "number" | "date" | "currency" | "boolean" | "json";
export interface ColumnInput { id?: string; label: string; type?: ColumnType; mode?: DataframeColumnMode; agentWritable?: boolean }

/** Stable column id from a human label: lowercase slug, ≤64 chars, never empty. */
export function slugColumnId(s: string, max = 64): string {
  const out = s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, max);
  return out || "col";
}

/**
 * Normalize agent/seed-supplied columns into canonical DataframeColumn[]:
 * BOUND the count (MAX_COLUMNS), slug + dedupe ids, clamp labels, and ASSIGN order by position
 * (the model never hand-numbers order — the PR #39 cheap-model hardening lesson).
 * `merge` upserts onto `existing` by id; `replace` uses only `input`.
 */
export function normalizeColumns(input: ColumnInput[], existing: DataframeColumn[] = [], mode: "replace" | "merge" = "merge"): DataframeColumn[] {
  const byId = new Map<string, DataframeColumn>(mode === "merge" ? existing.map((c) => [c.id, c]) : []);
  for (const c of input.slice(0, MAX_COLUMNS)) {
    let id = c.id ? slugColumnId(c.id) : slugColumnId(c.label);
    // dedupe colliding ids within this call (append -2, -3, …) so two labels can't clobber one column
    if (byId.has(id) && !existing.some((e) => e.id === id)) { let n = 2; while (byId.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
    byId.set(id, { id, label: (c.label ?? id).slice(0, 80), order: 0, type: c.type ?? "text", mode: c.mode, agentWritable: c.agentWritable ?? true });
  }
  return [...byId.values()].slice(0, MAX_COLUMNS).map((c, i) => ({ ...c, order: i }));
}

/** The column id encoded in an element id `${rowId}__${colId}` (cols may themselves contain no `__`). */
export function columnIdOfElement(elementId: string): string | null {
  const i = elementId.indexOf("__");
  return i < 0 ? null : elementId.slice(i + 2);
}
