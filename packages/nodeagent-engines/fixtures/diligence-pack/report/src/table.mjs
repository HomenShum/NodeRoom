/**
 * Row model for analysis/comparison.json (schema "diligence.comparison/v1").
 *
 * {
 *   "schema": "diligence.comparison/v1", "asOf": "2026-06-30", "currency": "USD",
 *   "rows": [{
 *     "company": "Example Lending",
 *     "arrUsdM":         { "value": 12.5, "citations": ["[src:sources/financials/example-financials.md#L11]"] },
 *     "yoyGrowthPct":    { "value": 40,   "citations": ["[src:...#L13]"] },
 *     "grossMarginPct":  { "value": 52,   "citations": ["[src:...#L24]"] },
 *     "monthlyBurnUsdM": { "value": 1.2,  "citations": ["[src:...#L36]"] },
 *     "cashUsdM":        { "value": 18.0, "citations": ["[src:...#L37]"] },
 *     "runwayMonths":    { "value": 15.0, "citations": ["<cash citation>", "<burn citation>"] },
 *     "topRisk":         { "text": "...", "citations": ["[src:sources/diligence-calls/example-call-notes.md#L41]"] }
 *   }]
 * }
 *
 * Units: USD millions for ARR, burn and cash; percent for growth and margin.
 * runwayMonths = cashUsdM / monthlyBurnUsdM and cites the cash and burn lines it is derived from.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Numeric metrics taken directly from a source line: the cited line must contain the value. */
export const CITED_METRICS = ["arrUsdM", "yoyGrowthPct", "grossMarginPct", "monthlyBurnUsdM", "cashUsdM"];

/** Every field that must carry at least one valid citation. */
export const CITED_FIELDS = [...CITED_METRICS, "runwayMonths", "topRisk"];

/** Export column order and labels. */
export const COLUMNS = [
  { key: "company", label: "Company" },
  { key: "arrUsdM", label: "ARR ($M)" },
  { key: "yoyGrowthPct", label: "YoY growth (%)" },
  { key: "grossMarginPct", label: "Gross margin (%)" },
  { key: "monthlyBurnUsdM", label: "Monthly burn ($M)" },
  { key: "cashUsdM", label: "Cash ($M)" },
  { key: "runwayMonths", label: "Runway (months)" },
  { key: "topRisk", label: "Top risk" },
];

/** One whole citation token: [src:<workspace-relative path>#L<n>] or [src:<path>#L<a>-L<b>]. */
export const CITATION = /^\[src:([^\]#\r\n]+)#L(\d+)(?:-L(\d+))?\]$/;

export const COMPARISON_PATH = fileURLToPath(new URL("../../analysis/comparison.json", import.meta.url));

/** Parses one token; null when it is not a well-formed citation. */
export function parseCitation(token) {
  const m = typeof token === "string" ? token.trim().match(CITATION) : null;
  if (!m) return null;
  const start = Number(m[2]);
  const end = m[3] ? Number(m[3]) : start;
  if (start < 1 || end < start) return null;
  return { path: m[1].trim(), start, end };
}

/** Citations attached to one field of a row ([] when absent). */
export function citationsOf(row, key) {
  const c = row?.[key]?.citations;
  return Array.isArray(c) ? c : [];
}

/** Display value of a cell: company name, a metric's value, or the top-risk text. */
export function cellValue(row, key) {
  if (key === "company") return row.company;
  if (key === "topRisk") return row.topRisk?.text;
  return row[key]?.value;
}

/** Reads analysis/comparison.json and returns its rows (no validation beyond shape). */
export function loadComparison(file = COMPARISON_PATH) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  if (!doc || !Array.isArray(doc.rows)) throw new Error(`${file}: expected an object with a "rows" array`);
  return doc.rows;
}
