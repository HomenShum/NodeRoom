#!/usr/bin/env node
/**
 * trust-surface-live.mjs — run the probed gate against REAL app DOM.
 *
 * The self-test proves the gate can pass, fail and abstain on fixtures. This
 * proves it says something true about the product — including the boot failure
 * state, which is a genuine trust surface reachable only by breaking the app.
 */
import { requireChromium } from "./playwright-peer.mjs";
const chromium = await requireChromium("trust-surface-live");
import { PROBE, verdict, describe } from "./trust-surface-core.mjs";

const APP_CHUNK = /\/src\/app\/main|assets\/main-.*\.js/;

const CASES = [
  { name: "NodeRoom landing", url: "http://localhost:5260/", proof: "Review every change", block: false },
  { name: "NodeRoom boot FAILED state", url: "http://localhost:5260/?demo=1", proof: null, block: true },
  { name: "NodeSlide landing", url: "http://localhost:5180/", proof: "What presentation should we build", block: false },
];

const browser = await chromium.launch();
for (const c of CASES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  if (c.block) await page.route(APP_CHUNK, (r) => r.abort("failed"));
  try {
    await page.goto(c.url, { waitUntil: "commit", timeout: 60_000 });
    if (c.proof) await page.getByText(c.proof, { exact: false }).first().waitFor({ timeout: 25_000 });
    await page.waitForTimeout(c.block ? 6000 : 2500);
    const v = verdict(await page.evaluate(PROBE));
    console.log(`\n${c.name}`);
    console.log(`  ${describe(v)}`);
    for (const f of v.failures.slice(0, 6)) console.log(`    clause ${f.clause} @ ${f.surface}: ${f.why}`);
  } catch (e) {
    console.log(`\n${c.name}\n  NOT_RUN — ${e.message.split("\n")[0].slice(0, 120)}`);
  }
  await ctx.close();
}
await browser.close();
