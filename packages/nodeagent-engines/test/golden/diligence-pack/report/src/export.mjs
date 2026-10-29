/**
 * exportReport(rows, { format }) -> string. Golden implementation of the contract documented in the
 * template's report/src/export.mjs (csv | markdown | json, runway-desc order, citations required).
 */
import { CITED_FIELDS, COLUMNS, cellValue, citationsOf, parseCitation } from "./table.mjs";

const FORMATS = new Set(["csv", "markdown", "json"]);

function sourcesOf(row) {
  const out = [];
  for (const { key } of COLUMNS) for (const c of citationsOf(row, key)) if (!out.includes(c)) out.push(c);
  return out;
}

function assertCited(row) {
  for (const key of CITED_FIELDS) {
    const tokens = citationsOf(row, key);
    if (tokens.length === 0) throw new Error(`${row.company}: ${key} has no citation`);
    const bad = tokens.find((t) => !parseCitation(t));
    if (bad !== undefined) throw new Error(`${row.company}: ${key} has an invalid citation ${JSON.stringify(bad)}`);
  }
}

const csvField = (v) => {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const mdCell = (v) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r\n|\r|\n/g, "<br>");

export function exportReport(rows, { format } = {}) {
  if (!FORMATS.has(format)) throw new Error(`unknown format ${JSON.stringify(format)}; expected csv, markdown or json`);
  rows.forEach(assertCited);
  const sorted = [...rows].sort((a, b) => b.runwayMonths.value - a.runwayMonths.value || String(a.company).localeCompare(String(b.company)));
  const labels = [...COLUMNS.map((c) => c.label), "Sources"];
  const cells = (r) => [...COLUMNS.map((c) => cellValue(r, c.key)), sourcesOf(r).join(" ")];

  if (format === "csv") return [labels, ...sorted.map(cells)].map((line) => line.map(csvField).join(",")).join("\n") + "\n";
  if (format === "markdown") {
    const line = (cs) => `| ${cs.map(mdCell).join(" | ")} |`;
    return [line(labels), `|${labels.map(() => "---").join("|")}|`, ...sorted.map((r) => line(cells(r)))].join("\n") + "\n";
  }
  const out = sorted.map((r) => {
    const o = {};
    for (const { key } of COLUMNS) o[key] = cellValue(r, key);
    o.sources = sourcesOf(r);
    return o;
  });
  return `${JSON.stringify({ schema: "diligence.report/v1", rows: out }, null, 2)}\n`;
}
