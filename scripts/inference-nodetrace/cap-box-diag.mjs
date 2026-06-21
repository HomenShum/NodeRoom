// Diagnostic: walk the built app and dump testids / trace-surface state at each step.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
const BASE = process.env.APP_BASE || 'http://127.0.0.1:5260';
const repo = process.cwd();
const out = path.join(repo, 'scripts/inference-nodetrace/app-shots');
fs.mkdirSync(out, { recursive: true });
const wait = (p, ms) => p.waitForTimeout(ms);
const tids = (p) => p.evaluate(() => [...new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('testid') || e.getAttribute('data-testid')))].slice(0, 60));

let b; try { b = await chromium.launch(); } catch { b = await chromium.launch({ channel: 'msedge' }); }
const p = await b.newPage({ viewport: { width: 1480, height: 940 }, deviceScaleFactor: 1 });
const errs = [];
p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + String(e).slice(0, 240)));

await p.goto(BASE + '/?mode=memory', { waitUntil: 'networkidle', timeout: 60000 });
await wait(p, 1500);
console.log('STEP load · testids:', JSON.stringify(await tids(p)));
await p.screenshot({ path: path.join(out, 'diag-1-load.png') });

await p.locator('[data-testid="start-demo-room"]').first().click({ timeout: 15000 });
await wait(p, 4500);
console.log('STEP enter · testids:', JSON.stringify(await tids(p)));
await p.screenshot({ path: path.join(out, 'diag-2-room.png') });

const traceTab = p.locator('[data-testid="trace-tab"]');
console.log('trace-tab count:', await traceTab.count());
await traceTab.first().click({ timeout: 15000 });
await wait(p, 2500);
const state = await p.evaluate(() => {
  const surf = document.querySelector('[data-testid="trace-surface"]');
  return {
    traceSurface: !!surf,
    surfHtmlLen: surf ? surf.innerHTML.length : -1,
    recs: document.querySelectorAll('[data-testid="trace-record"]').length,
    recTitles: [...document.querySelectorAll('.r-tracevu-rec-title')].map((e) => e.textContent.trim().slice(0, 46)),
    detailTabs: [...document.querySelectorAll('[data-testid^="trace-tab-"]')].map((e) => e.getAttribute('data-testid')),
  };
});
console.log('STEP trace · state:', JSON.stringify(state, null, 0));
await p.screenshot({ path: path.join(out, 'diag-3-trace.png') });
console.log('console errors:', JSON.stringify(errs.slice(0, 8)));
await b.close();
