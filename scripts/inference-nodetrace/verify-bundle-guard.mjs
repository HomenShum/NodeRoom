// Adversarial verification of the TraceSurface malformed-bundle guard.
// Drives the BUILT app (static preview) into the demo-room Trace tab and asserts:
//   1. the surface still RENDERS (not a blank crash) with malformed bundles present
//   2. the missing-source bundle appears, with backfilled source ("NodeAgent")
//   3. the missing-steps bundle is SKIPPED (absent from the list)
//   4. a console.warn named the skipped bundle
//   5. clicking it + Steps + Raw tabs throws NO pageerror (raw backfill works)
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
const BASE = process.env.APP_BASE || 'http://127.0.0.1:5260';
const repo = process.cwd();
const out = path.join(repo, 'scripts/inference-nodetrace/app-shots');
fs.mkdirSync(out, { recursive: true });
const wait = (p, ms) => p.waitForTimeout(ms);

let b; try { b = await chromium.launch(); } catch { b = await chromium.launch({ channel: 'msedge' }); }
const p = await b.newPage({ viewport: { width: 1480, height: 940 }, deviceScaleFactor: 1 });
const warns = [], errs = [];
p.on('console', (m) => { if (m.type() === 'warning') warns.push(m.text()); });
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + String(e).slice(0, 240)));

await p.goto(BASE + '/?mode=memory', { waitUntil: 'networkidle', timeout: 60000 });
await wait(p, 1500);
await p.locator('[data-testid="start-demo-room"]').first().click({ timeout: 15000 });
await wait(p, 4000);
// dismiss the auto tour
for (const sel of ['[data-testid="tour-skip"]', 'button[aria-label="Close"]']) {
  const el = p.locator(sel).first();
  if (await el.count().catch(() => 0)) { try { await el.click({ timeout: 2500 }); break; } catch {} }
}
await p.keyboard.press('Escape').catch(() => {});
await wait(p, 600);
await p.locator('[data-testid="trace-tab"]').first().click({ timeout: 15000 });
await wait(p, 2000);

const state = await p.evaluate(() => {
  const surf = document.querySelector('[data-testid="trace-surface"]');
  const recBtns = [...document.querySelectorAll('[data-testid="trace-record"]')];
  return {
    surfacePresent: !!surf,
    recCount: recBtns.length,
    titles: [...document.querySelectorAll('.r-tracevu-rec-title')].map((e) => e.textContent.trim()),
    metas: [...document.querySelectorAll('.r-tracevu-rec-meta')].map((e) => e.textContent.trim()),
  };
});

// click the missing-source test record, then exercise Steps + Raw tabs (raw backfill path)
let clickedRecMeta = null;
const recs = p.locator('[data-testid="trace-record"]');
const titles = await recs.evaluateAll((els) => els.map((e) => (e.querySelector('.r-tracevu-rec-title')?.textContent || '').trim()));
const tIdx = titles.findIndex((t) => /NO source field/i.test(t));
if (tIdx >= 0) {
  await recs.nth(tIdx).click({ timeout: 8000 });
  await wait(p, 800);
  clickedRecMeta = await p.evaluate(() => document.querySelector('.r-tracevu-rec[data-on="true"] .r-tracevu-rec-meta')?.textContent?.trim() || null);
  for (const t of ['steps', 'raw', 'overview', 'flow']) {
    const tab = p.locator(`[data-testid="trace-tab-${t}"]`).first();
    if (await tab.count()) { try { await tab.click({ timeout: 5000 }); await wait(p, 500); } catch {} }
  }
}
const surfaceStillPresent = await p.evaluate(() => !!document.querySelector('[data-testid="trace-surface"]'));

const result = {
  surfacePresent: state.surfacePresent,
  surfaceStillPresentAfterTabs: surfaceStillPresent,
  recCount: state.recCount,
  missingSourceRendered: state.titles.some((t) => /NO source field/i.test(t)),
  missingSourceMeta: clickedRecMeta,
  malformedSkipped: !state.titles.some((t) => /missing steps/i.test(t)),
  warnNamedMalformed: warns.some((w) => /skipping malformed trace bundle/i.test(w) && /_test-malformed/i.test(w)),
  pageErrors: errs,
  titles: state.titles,
};
console.log(JSON.stringify(result, null, 2));
await p.screenshot({ path: path.join(out, 'verify-guard.png') });

const pass = result.surfacePresent && result.surfaceStillPresentAfterTabs && result.missingSourceRendered &&
  /NodeAgent/.test(result.missingSourceMeta || '') && result.malformedSkipped && result.warnNamedMalformed &&
  result.pageErrors.length === 0;
console.log(pass ? '\nVERIFY: PASS ✓' : '\nVERIFY: FAIL ✗');
await b.close();
process.exit(pass ? 0 : 1);
