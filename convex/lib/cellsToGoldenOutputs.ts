/**
 * Convex-safe adapter: turn a room's `elements` rows into the grader's `GoldenOutputs` shape.
 *
 * The Python harness reads `<output_dir>/outputs.json` keyed `{ key: { value, formula, cite } }`.
 * In NodeRoom the agent writes CELLS into an artifact, not a JSON file — so this adapter is the
 * "outputs.json equivalent" for in-app live runs. It's the ONLY new piece besides the rubric loader;
 * the scoring (`gradeGolden`) is unchanged and shared verbatim with the vitest self-test gate.
 *
 * Honesty rules (the grader reads ONLY the artifact state — never the agent's prompt / intermediate state):
 *   1. We look at one source of truth: the `elements` rows for the artifact.
 *   2. The KEY → cell mapping uses the artifact's agent-governed `meta.dataframe.columns` (PR #57's
 *      define_columns schema). A column whose `id` OR `label` matches the rubric key is the value column.
 *      Optional companion columns `<key>__formula` and `<key>__cite` carry formula + citation, OR they
 *      live nested on the value cell as `{ value, formula, cite }` (matches the agent's cell payload).
 *   3. Allowed-key fabrication is naturally surfaced — any element whose resolved key is not in
 *      `rubric.allowed_keys` gets emitted under that key so the grader's fabrication branch fires.
 *   4. We do NOT invent values. Missing keys stay missing; the grader flags them.
 */

import type { GoldenOutputs, GoldenRubric, OutputCite, OutputRecord } from "../../src/benchmarks/golden/grader";

/** Shape of a single element row coming out of `ctx.db.query("elements")` (kept loose so this
 *  module stays pure and trivially mockable in tests — no Convex types required). */
export interface CellElement {
  elementId: string;
  value: unknown;
}

/** Per-row keyed cells — used for unit tests that don't want to construct elementIds at all. */
export interface KeyedCell {
  key: string;
  value?: unknown;
  formula?: unknown;
  cite?: OutputCite | null;
}

type DataframeColumn = { id?: unknown; label?: unknown; order?: unknown };
type ArtifactMetaLike = { dataframe?: { columns?: DataframeColumn[] } } | null | undefined;

function objectRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function columnIdFromElementId(elementId: string): string {
  // Agent-governed columns use `${rowId}__${columnId}`. Fall back to a numeric-suffix strip
  // for legacy single-column rows ("revenue_growth_pct1" → "revenue_growth_pct").
  if (elementId.includes("__")) return elementId.split("__").slice(1).join("__");
  return elementId.replace(/\d+$/, "");
}

function normalizeScalarValue(v: unknown): string | number | boolean | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const trimmed = v.trim();
    if (trimmed !== "") {
      const numeric = Number(trimmed);
      if (Number.isFinite(numeric)) return numeric;
    }
    return v;
  }
  return typeof v === "boolean" ? v : undefined;
}

/** Resolve a value-cell payload to grader's `{ value, formula, cite }`.
 *  Accepts both:
 *    (a) nested cell payload `{ value, formula, cite }` — what the agent writes today, and
 *    (b) a bare scalar value with optional sibling `<key>__formula` / `<key>__cite` rows. */
function recordFromValue(rawValue: unknown): OutputRecord {
  if (rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)) {
    const obj = rawValue as { value?: unknown; formula?: unknown; cite?: unknown };
    const cite = obj.cite && typeof obj.cite === "object" ? (obj.cite as OutputCite) : undefined;
    const inner = "value" in obj ? obj.value : undefined;
    return {
      value: normalizeScalarValue(inner),
      formula: typeof obj.formula === "string" ? obj.formula : undefined,
      cite: cite ?? undefined,
    };
  }
  return { value: normalizeScalarValue(rawValue) };
}

/** Convert a list of elements + the artifact's column schema into the grader's expected shape. */
export function cellsToGoldenOutputs(
  rubric: GoldenRubric,
  artifactMeta: ArtifactMetaLike,
  elements: CellElement[],
): GoldenOutputs {
  const dataframeColumns = artifactMeta?.dataframe?.columns ?? [];
  const labelToId = new Map<string, string>();
  const knownColumnIds = new Set<string>();
  for (const c of dataframeColumns) {
    const id = typeof c.id === "string" ? c.id : undefined;
    if (id) {
      knownColumnIds.add(id);
      if (typeof c.label === "string") labelToId.set(c.label, id);
    }
  }

  // Map allowed rubric keys → the column id we'll look for. If the agent declared a column by label
  // ("revenue_growth_pct") we use its id; otherwise the key IS the column id (the agent named the
  // column with the rubric key directly, which is the recommended flow).
  const keyToColumnId = new Map<string, string>();
  for (const key of rubric.allowed_keys) {
    if (knownColumnIds.has(key)) keyToColumnId.set(key, key);
    else if (labelToId.has(key)) keyToColumnId.set(key, labelToId.get(key)!);
    else keyToColumnId.set(key, key); // last-resort: try the literal key as column id
  }
  const columnIdToKey = new Map<string, string>();
  for (const [k, cid] of keyToColumnId) columnIdToKey.set(cid, k);

  // First pass — pick up value cells, sibling formula cells, sibling cite cells.
  const out: GoldenOutputs = {};
  const formulaByKey = new Map<string, string>();
  const citeByKey = new Map<string, OutputCite>();

  for (const el of elements) {
    const colId = columnIdFromElementId(el.elementId);
    if (colId.endsWith("__formula")) {
      const baseCol = colId.slice(0, -"__formula".length);
      const key = columnIdToKey.get(baseCol) ?? baseCol;
      if (typeof el.value === "string") formulaByKey.set(key, el.value);
      continue;
    }
    if (colId.endsWith("__cite")) {
      const baseCol = colId.slice(0, -"__cite".length);
      const key = columnIdToKey.get(baseCol) ?? baseCol;
      const obj = objectRecord(el.value);
      const file = typeof obj.file === "string" ? obj.file : undefined;
      const locator = typeof obj.locator === "string" ? obj.locator : undefined;
      if (file !== undefined || locator !== undefined) citeByKey.set(key, { file, locator });
      continue;
    }
    // Value cell — resolve which rubric key (if any) this column represents.
    const key = columnIdToKey.get(colId) ?? colId;
    const rec = recordFromValue(el.value);
    // If the column is the key column we keep the record; if it's a fabricated key we still keep
    // it (under its own column id), so the grader's fabrication path fires honestly.
    out[key] = { ...(out[key] ?? {}), ...rec };
  }

  // Merge sibling formula / cite rows in.
  for (const [key, formula] of formulaByKey) {
    out[key] = { ...(out[key] ?? {}), formula: out[key]?.formula ?? formula };
  }
  for (const [key, cite] of citeByKey) {
    const existing = out[key] ?? {};
    const existingCite = existing.cite && typeof existing.cite === "object" ? (existing.cite as OutputCite) : undefined;
    out[key] = { ...existing, cite: existingCite ?? cite };
  }

  // Strip placeholder records that have neither value nor formula nor cite — those are empty rows,
  // not a submitted answer. Lets "missing key" fire correctly instead of "wrong value undefined".
  for (const [k, rec] of Object.entries(out)) {
    if (rec.value === undefined && rec.formula === undefined && rec.cite === undefined) delete out[k];
  }

  return out;
}
