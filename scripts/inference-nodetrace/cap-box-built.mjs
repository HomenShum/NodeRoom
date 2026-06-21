// Drive the BUILT app (static `vite preview`, no file-watcher → immune to .tmp churn)
// into the demo-room Trace tab, select the WBD boxed-citation record, open Steps, and
// capture the red box drawn over the cited 10-K source line. Exact selectors verified
// against src/ui/panels/Artifact.tsx + TraceSurface.tsx + TraceStepRow.tsx.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const BASE = process.env.APP_BASE || 'http://127.0.0.1:5260';
const repo = process.cwd();
const out = path.join(repo, 'scripts/inference-nodetrace/app-shots');
fs.mkdirSync(out, { recursive: true });
const wait = (p, ms) => p.waitForTimeout(ms);

let b; try { b = await chromium.launch(); } catch { b = await chromium.launch({ channel: 'msedge' }); }

// 0) (re)render the WBD 10-K source -> the exact PNG the box overlays, into BOTH dist (served)
//    and public, so coordinates match the rendered page deterministically.
const srcHtml = pathToFileURL(path.join(repo, 'scripts/inference-nodetrace/banking-source.html')).href;
const p0 = await b.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 });
await p0.goto(srcHtml, { waitUntil: 'networkidle' });
for (const dest of ['dist/qa-trace/btb-source.png', 'public/qa-trace/btb-source.png']) {
  const f = path.join(repo, dest); fs.mkdirSync(path.dirname(f), { recursive: true });
  await p0.locator('.page').screenshot({ path: f });
  console.log('rendered', dest);
}
await p0.close();

// 1) load the built app (static → fast; networkidle is safe here)
const p = await b.newPage({ viewport: { width: 1480, height: 940 }, deviceScaleFactor: 2 });
p.on('console', (m) => { const t = m.text(); if (/error|warn/i.test(m.type())) console.log('[page]', m.type(), t.slice(0, 160)); });
console.log('loading', BASE + '/?mode=memory');
await p.goto(BASE + '/?mode=memory', { waitUntil: 'networkidle', timeout: 60000 });
await wait(p, 1500);

// 2) enter the demo room (non-BTB → QA_BUNDLES render here)
await p.locator('[data-testid="start-demo-room"]').first().click({ timeout: 15000 });
await wait(p, 4000);

// 2b) dismiss the auto-start guided tour (it overlays the work surface)
const dismissTour = async () => {
  for (const sel of ['[data-testid="tour-skip"]', '[data-testid="guided-tour"] button:has-text("Skip")', '.r-tour-close', 'button[aria-label="Close"]']) {
    const el = p.locator(sel).first();
    if (await el.count().catch(() => 0)) { try { await el.click({ timeout: 2500 }); console.log('dismissed tour via', sel); return true; } catch {} }
  }
  return false;
};
await dismissTour();
await wait(p, 800);
await p.keyboard.press('Escape').catch(() => {});
await wait(p, 500);

// 3) open the Trace work-surface tab
await p.locator('[data-testid="trace-tab"]').first().click({ timeout: 15000 });
await wait(p, 1500);
await dismissTour(); // in case it re-shows after tab switch
await wait(p, 600);

// 4) select the WBD boxed-citation record by its title text
const recs = p.locator('[data-testid="trace-record"]');
await p.waitForSelector('[data-testid="trace-record"]', { timeout: 15000 });
const titles = await recs.evaluateAll((els) => els.map((e) => (e.textContent || '').trim()));
console.log('records:', JSON.stringify(titles.map((t) => t.slice(0, 46))));
let idx = titles.findIndex((t) => /WBD|cited & boxed/i.test(t));
if (idx < 0) idx = 0;
await recs.nth(idx).click({ timeout: 10000 });
await wait(p, 1200);

// 5) open the Steps detail tab (where the attachment image + box render)
await p.locator('[data-testid="trace-tab-steps"]').first().click({ timeout: 10000 });
await wait(p, 1500);

// 6) wait for the red box, then capture
let boxed = false;
try { await p.waitForSelector('.r-tracevu-box', { timeout: 20000 }); boxed = true; } catch {}
const probe = await p.evaluate(() => ({
  box: document.querySelectorAll('.r-tracevu-box').length,
  shot: document.querySelectorAll('.r-tracevu-shot').length,
  srcs: [...document.querySelectorAll('.r-tracevu-shot')].map((i) => i.getAttribute('src')).slice(0, 4),
  recTitle: document.querySelector('.r-tracevu-detail-head strong')?.textContent || null,
}));
console.log('BOX present:', boxed, '| probe:', JSON.stringify(probe));

await p.screenshot({ path: path.join(out, 'live-box-full.png') });
const box = p.locator('.r-tracevu-box').first();
if (await box.count()) {
  // scope the closeup to the screenshot frame that holds the box
  const frame = box.locator('xpath=ancestor::*[contains(@class,"shotframe") or contains(@class,"shotlink")][1]');
  const tgt = (await frame.count()) ? frame : box;
  await tgt.scrollIntoViewIfNeeded().catch(() => {});
  await tgt.screenshot({ path: path.join(out, 'live-box-closeup.png') });
  // also a medium crop: the detail panel, so the record title + metrics + box read together
  const detail = p.locator('.r-tracevu-detail').first();
  if (await detail.count()) await detail.screenshot({ path: path.join(out, 'live-box-detail.png') }).catch(() => {});
  console.log('CAPTURED live-box-closeup.png + live-box-detail.png + live-box-full.png');
} else {
  console.log('NO BOX — wrote live-box-full.png only');
}
await b.close();
