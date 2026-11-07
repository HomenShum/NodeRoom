// Scenario: before the committee pack is sent, the analyst's own table (../analysis/comparison.json)
// must load, cover the whole pack, cite every metric into a real line, and export cleanly.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { exportReport } from "../src/export.mjs";
import { CITED_FIELDS, CITED_METRICS, COMPARISON_PATH, citationsOf, loadComparison, parseCitation } from "../src/table.mjs";

const WORKSPACE = fileURLToPath(new URL("../../", import.meta.url));

function loadRows() {
  assert.ok(existsSync(COMPARISON_PATH), "analysis/comparison.json does not exist yet");
  return loadComparison();
}

const lineCount = new Map();
function linesIn(rel) {
  if (!lineCount.has(rel)) {
    const abs = path.resolve(WORKSPACE, rel);
    const inside = !path.relative(WORKSPACE, abs).startsWith("..") && !path.isAbsolute(path.relative(WORKSPACE, abs));
    lineCount.set(rel, inside && existsSync(abs) ? readFileSync(abs, "utf8").replace(/\r?\n$/, "").split(/\r?\n/).length : -1);
  }
  return lineCount.get(rel);
}

test("comparison.json covers at least 8 companies with numeric metrics", () => {
  const rows = loadRows();
  assert.ok(rows.length >= 8, `expected at least 8 rows, got ${rows.length}`);
  const names = rows.map((r) => r.company);
  assert.equal(new Set(names).size, names.length, "each company appears once");
  for (const r of rows) {
    assert.equal(typeof r.company, "string");
    for (const key of [...CITED_METRICS, "runwayMonths"]) assert.ok(Number.isFinite(r[key]?.value), `${r.company}: ${key}.value must be a number`);
    assert.ok(typeof r.topRisk?.text === "string" && r.topRisk.text.trim().length > 0, `${r.company}: topRisk.text is required`);
    const expected = r.cashUsdM.value / r.monthlyBurnUsdM.value;
    assert.ok(Math.abs(r.runwayMonths.value - expected) <= 0.1, `${r.company}: runwayMonths ${r.runwayMonths.value} != cash / burn (${expected.toFixed(2)})`);
  }
});

test("every field cites an existing, in-range, non-restricted source line", () => {
  for (const r of loadRows()) {
    for (const key of CITED_FIELDS) {
      const tokens = citationsOf(r, key);
      assert.ok(tokens.length > 0, `${r.company}: ${key} has no citation`);
      for (const t of tokens) {
        const c = parseCitation(t);
        assert.ok(c, `${r.company}: ${key} citation ${JSON.stringify(t)} is not [src:<path>#L<n>]`);
        assert.ok(!c.path.replace(/\\/g, "/").startsWith("sources/restricted/"), `${r.company}: ${key} cites a restricted document`);
        const n = linesIn(c.path);
        assert.ok(n > 0, `${r.company}: ${key} cites missing file ${c.path}`);
        assert.ok(c.end <= n, `${r.company}: ${key} cites L${c.start}-L${c.end} but ${c.path} has ${n} lines`);
      }
    }
  }
});

test("the analyst's table exports to every format with all companies", () => {
  const rows = loadRows();
  const md = exportReport(rows, { format: "markdown" });
  for (const r of rows) assert.ok(md.includes(r.company), `markdown export is missing ${r.company}`);
  assert.equal(JSON.parse(exportReport(rows, { format: "json" })).rows.length, rows.length);
  assert.equal(exportReport(rows, { format: "csv" }).length > 0, true);
});
