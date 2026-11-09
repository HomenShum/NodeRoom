// Scenario: the committee secretary pastes the comparison table into the HTML board pack. A risk note
// copied from a borrower's email carries markup and ampersands; it must render as text, never as markup.
import assert from "node:assert/strict";
import test from "node:test";
import { exportReport } from "./src/export.mjs";

const cite = (n) => `[src:sources/example/metrics.md#L${n}]`;
const metric = (value, ...lines) => ({ value, citations: lines.map(cite) });
const row = (company, runway, risk) => ({
  company,
  arrUsdM: metric(10.5, 11),
  yoyGrowthPct: metric(42, 13),
  grossMarginPct: metric(51, 24),
  monthlyBurnUsdM: metric(1.25, 36),
  cashUsdM: metric(runway * 1.25, 37),
  runwayMonths: metric(runway, 37, 36),
  topRisk: { text: risk, citations: [cite(41)] },
});

test("html: a table with the column labels and a Sources header", () => {
  const html = exportReport([row("Plain Co", 12, "Warehouse renewal")], { format: "html" });
  assert.match(html, /^<table>/);
  assert.ok(html.trimEnd().endsWith("</table>"));
  for (const label of ["Company", "ARR ($M)", "Runway (months)", "Top risk", "Sources"]) assert.ok(html.includes(`<th>${label}</th>`), label);
  assert.ok(html.includes(`<td>${[11, 13, 24, 36, 37, 41].map(cite).join(" ")}</td>`), "Sources cell lists the de-duplicated citations");
});

test("html: markup and ampersands in data are escaped, rows sorted by runway", () => {
  const html = exportReport([row("R&D <b>Lending</b>", 9, `Email said <script>alert("x")</script> & 'urgent'`), row("Long Co", 30, "ok")], { format: "html" });
  assert.ok(!/<script|<b>/i.test(html), html);
  assert.ok(html.includes("R&amp;D &lt;b&gt;Lending&lt;/b&gt;"));
  assert.ok(html.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;urgent&#39;"));
  assert.ok(html.indexOf("Long Co") < html.indexOf("R&amp;D"), "longest runway first");
});

test("html: line breaks become <br> and uncited rows are still refused", () => {
  assert.ok(exportReport([row("Lines Co", 10, "a\r\nb\nc")], { format: "html" }).includes("<td>a<br>b<br>c</td>"));
  const bad = row("Uncited Co", 10, "x");
  bad.cashUsdM.citations = [];
  assert.throws(() => exportReport([bad], { format: "html" }), (e) => /citation/i.test(e.message) && e.message.includes("Uncited Co"));
});
