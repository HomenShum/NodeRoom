#!/usr/bin/env node
/**
 * trust-surface-selftest.mjs — probe the gate in BOTH directions.
 *
 * An audit that cannot fail is not a gate; one that cannot pass is not one
 * either. Until a check has been shown to do both, it is a candidate instance
 * of the vacuous-pass class rather than a defence against it.
 *
 * Three fixtures, three required outcomes:
 *   PASS     a compliant proposal surface — declared state, static affordances
 *   FAIL     the same surface with the defects the gate exists to catch
 *   NOT_RUN  a page with no trust surface at all — must NOT report PASS
 *
 * Fixtures are injected with setContent, so this needs no server and no app.
 */
import { requireChromium } from "./playwright-peer.mjs";
const chromium = await requireChromium("trust-surface-selftest");
import { PROBE, verdict, describe } from "./trust-surface-core.mjs";

const GOOD = `
<main>
  <section data-testid="proposal-card" data-state="pending">
    <h2>Proposed change — review before accepting</h2>
    <p>The agent rewrote three cells. Nothing is applied yet.</p>
    <button class="btn-neutral">Accept</button>
    <button class="btn-neutral">Reject</button>
  </section>
</main>`;

const BAD = `
<style>
  /* Both defects the gate exists to catch. */
  .a { transition: transform 220ms ease, background-color 220ms ease; }
  @keyframes pulse { from { opacity: .6 } to { opacity: 1 } }
  .b { animation: pulse 1.2s infinite; }
</style>
<main>
  <!-- no state attribute anywhere: clause 1 -->
  <section data-testid="proposal-card">
    <h2>Proposed change — review before accepting</h2>
    <button class="a success-cta">Accept</button>
    <button class="b">Reject</button>
  </section>
</main>`;

const EMPTY = `<main><section><h2>Quarterly revenue</h2><p>Nothing to decide here.</p></section></main>`;

const CASES = [
  { name: "compliant proposal surface", html: GOOD, expect: "PASS" },
  { name: "proposal surface with motion + no declared state", html: BAD, expect: "FAIL" },
  { name: "page containing no trust surface", html: EMPTY, expect: "NOT_RUN" },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
let bad = 0;

for (const c of CASES) {
  await page.setContent(c.html, { waitUntil: "load" });
  await page.waitForTimeout(250);
  const v = verdict(await page.evaluate(PROBE));
  const ok = v.status === c.expect;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.name}`);
  console.log(`      expected ${c.expect}, got ${describe(v)}`);
  for (const f of v.failures) console.log(`        clause ${f.clause}: ${f.why}`);
}

await browser.close();
console.log(`\n  ${bad === 0 ? "GATE PROBED IN BOTH DIRECTIONS — it can pass, fail, and abstain" : bad + " case(s) wrong"}`);
process.exitCode = bad === 0 ? 0 : 1;
