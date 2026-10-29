// Scenario: a credit analyst exports the committee comparison table for the Q3 2026 deck.
// The rows below are synthetic test rows (not the diligence companies) with awkward text on purpose.
import assert from "node:assert/strict";
import test from "node:test";
import { exportReport } from "../src/export.mjs";

const cite = (n) => `[src:sources/example/metrics.md#L${n}]`;
const metric = (value, ...lines) => ({ value, citations: lines.map(cite) });

function row(company, runway, risk = "Warehouse renewal pending") {
  return {
    company,
    arrUsdM: metric(10.5, 11),
    yoyGrowthPct: metric(42, 13),
    grossMarginPct: metric(51, 24),
    monthlyBurnUsdM: metric(1.25, 36),
    cashUsdM: metric(runway * 1.25, 37),
    runwayMonths: metric(runway, 37, 36),
    topRisk: { text: risk, citations: [cite(41)] },
  };
}

const sample = () => [
  row("Short Runway Co", 6),
  row("Long Runway Co", 30, 'Top customer "Acme, Inc." is 45% of ARR'),
  row("Middle Co", 12, "Line one\nline two | piped"),
];

const HEADER = "Company,ARR ($M),YoY growth (%),Gross margin (%),Monthly burn ($M),Cash ($M),Runway (months),Top risk,Sources";
const SOURCES = [11, 13, 24, 36, 37, 41].map(cite).join(" ");

test("csv: header, row order by runway (longest first) and de-duplicated sources", () => {
  const lines = exportReport(sample(), { format: "csv" }).split("\n");
  assert.equal(lines[0], HEADER);
  assert.equal(lines.at(-1), "", "output ends with a trailing newline");
  assert.equal(lines[1], `Long Runway Co,10.5,42,51,1.25,37.5,30,"Top customer ""Acme, Inc."" is 45% of ARR",${SOURCES}`);
  assert.match(lines[2], /^"?Middle Co/);
  assert.equal(lines.at(-2), `Short Runway Co,10.5,42,51,1.25,7.5,6,Warehouse renewal pending,${SOURCES}`);
});

test("csv: fields with commas, quotes and newlines are RFC 4180 quoted", () => {
  const csv = exportReport([row('Comma, "Quote" Lending', 9, "multi\nline")], { format: "csv" });
  assert.equal(csv, `${HEADER}\n"Comma, ""Quote"" Lending",10.5,42,51,1.25,11.25,9,"multi\nline",${SOURCES}\n`);
});

test("csv: ties on runway are broken by company name and the input is not mutated", () => {
  const input = [row("Zeta Credit", 10), row("Alpha Credit", 10), row("Beta Credit", 20)];
  const before = JSON.stringify(input);
  const companies = exportReport(input, { format: "csv" }).trim().split("\n").slice(1).map((l) => l.split(",")[0]);
  assert.deepEqual(companies, ["Beta Credit", "Alpha Credit", "Zeta Credit"]);
  assert.equal(JSON.stringify(input), before);
});

test("markdown: table with a Sources column, escaped pipes and line breaks", () => {
  const lines = exportReport(sample(), { format: "markdown" }).split("\n");
  assert.equal(lines[0], "| Company | ARR ($M) | YoY growth (%) | Gross margin (%) | Monthly burn ($M) | Cash ($M) | Runway (months) | Top risk | Sources |");
  assert.equal(lines[1], "|---|---|---|---|---|---|---|---|---|");
  assert.equal(lines.length, 2 + 3 + 1);
  assert.equal(lines[2], `| Long Runway Co | 10.5 | 42 | 51 | 1.25 | 37.5 | 30 | Top customer "Acme, Inc." is 45% of ARR | ${SOURCES} |`);
  assert.equal(lines[3], `| Middle Co | 10.5 | 42 | 51 | 1.25 | 15 | 12 | Line one<br>line two \\| piped | ${SOURCES} |`);
  assert.equal(lines[5], "");
});

test("markdown: CRLF and CR line breaks are also flattened", () => {
  const md = exportReport([row("Windows Notes Co", 8, "a\r\nb\rc")], { format: "markdown" });
  assert.ok(md.includes("| a<br>b<br>c |"), md);
});

test("json: stable key order regardless of input key order", () => {
  const a = row("Order Co", 14);
  const b = Object.fromEntries(Object.entries(row("Order Co", 14)).reverse());
  const outA = exportReport([a], { format: "json" });
  assert.equal(outA, exportReport([b], { format: "json" }));
  assert.ok(outA.endsWith("}\n"));
  const parsed = JSON.parse(outA);
  assert.deepEqual(Object.keys(parsed), ["schema", "rows"]);
  assert.equal(parsed.schema, "diligence.report/v1");
  assert.deepEqual(Object.keys(parsed.rows[0]), ["company", "arrUsdM", "yoyGrowthPct", "grossMarginPct", "monthlyBurnUsdM", "cashUsdM", "runwayMonths", "topRisk", "sources"]);
  assert.deepEqual(parsed.rows[0], {
    company: "Order Co",
    arrUsdM: 10.5,
    yoyGrowthPct: 42,
    grossMarginPct: 51,
    monthlyBurnUsdM: 1.25,
    cashUsdM: 17.5,
    runwayMonths: 14,
    topRisk: "Warehouse renewal pending",
    sources: [11, 13, 24, 36, 37, 41].map(cite),
  });
});

test("json: rows sorted by runway months descending", () => {
  const parsed = JSON.parse(exportReport(sample(), { format: "json" }));
  assert.deepEqual(parsed.rows.map((r) => r.runwayMonths), [30, 12, 6]);
});

test("rejects a row whose metric has no citation, naming company and field", () => {
  const rows = sample();
  rows[2].grossMarginPct.citations = [];
  for (const format of ["csv", "markdown", "json"]) {
    assert.throws(() => exportReport(rows, { format }), (e) => /citation/i.test(e.message) && e.message.includes("Middle Co") && e.message.includes("grossMarginPct"));
  }
});

test("rejects missing top-risk citations and malformed citation tokens", () => {
  const noRisk = row("Risky Co", 10);
  delete noRisk.topRisk.citations;
  assert.throws(() => exportReport([noRisk], { format: "csv" }), (e) => /citation/i.test(e.message) && e.message.includes("Risky Co") && e.message.includes("topRisk"));
  const bad = row("Malformed Co", 10);
  bad.cashUsdM.citations = ["sources/example/metrics.md line 37"];
  assert.throws(() => exportReport([bad], { format: "markdown" }), (e) => /citation/i.test(e.message) && e.message.includes("Malformed Co") && e.message.includes("cashUsdM"));
  const zero = row("Zero Line Co", 10);
  zero.arrUsdM.citations = ["[src:sources/example/metrics.md#L0]"];
  assert.throws(() => exportReport([zero], { format: "json" }), (e) => /citation/i.test(e.message) && e.message.includes("arrUsdM"));
});

test("rejects an unknown format and accepts an empty table", () => {
  assert.throws(() => exportReport(sample(), { format: "xlsx" }), /format/i);
  assert.equal(exportReport([], { format: "csv" }), `${HEADER}\n`);
});
