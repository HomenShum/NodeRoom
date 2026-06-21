// Render the banking source, then drive a CLEAN Vite instance to the WBD boxed-citation
// bundle in the live app's demo-room Trace tab, and capture the red box. Robust: long
// cold-start timeout, record retry loop, explicit wait for .r-tracevu-box.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const BASE = process.env.APP_BASE || 'http://127.0.0.1:5198';
const repo = process.cwd();
const out = path.join(repo, 'scripts/inference-nodetrace/app-shots');
fs.mkdirSync(out, { recursive: true });
const pubShot = path.join(repo, 'public/qa-trace/btb-source.png');
fs.mkdirSync(path.dirname(pubShot), { recursive: true });
const wait = (p, ms) => p.waitForTimeout(ms);
let b; try { b = await chromium.launch(); } catch { b = await chromium.launch({ channel: 'msedge' }); }

// 1) banking source -> /public/qa-trace/btb-source.png
const p1 = await b.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 });
await p1.goto(pathToFileURL(path.join(repo, 'scripts/inference-nodetrace/banking-source.html')).href, { waitUntil: 'networkidle' });
await p1.locator('.page').screenshot({ path: pubShot });
await p1.close();
console.log('wrote', pubShot);

// 2) drive the clean app
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
async function clickAny(sels, timeout = 3000) { for (const s of sels) { const el = p.locator(s).first(); if (await el.count()) { try { await el.click({ timeout }); return s; } catch {} } } return null; }
const recTitles = () => p.evaluate(() => [...document.querySelectorAll('[class*="rec-title"], .r-tracevu-rec')].map((e) => (e.textContent || '').trim().slice(0, 48)).filter(Boolean));

console.log('loading app (cold start may take ~30-60s)...');
await p.goto(BASE + '/?mode=memory', { waitUntil: 'domcontentloaded', timeout: 180000 });
await wait(p, 14000);
await clickAny(['[data-testid="start-demo-room"]', 'button:has-text("Start")', 'button:has-text("demo")']);
await wait(p, 6000);
await clickAny(['[data-testid="trace-tab"]', '[role="tab"]:has-text("Trace")', 'button:has-text("Trace")', 'text=Trace']);
await wait(p, 2500);

let recs = [];
for (let i = 0; i < 10; i++) {
  recs = await recTitles();
  if (recs.some((r) => /WBD|cited & boxed/i.test(r))) break;
  await wait(p, 2500);
}
console.log('records:', JSON.stringify(recs));

await clickAny([':text("cited & boxed")', ':text("WBD take-private")', '.r-tracevu-rec:has-text("WBD")', ':text("WBD")']);
await wait(p, 2000);
await clickAny(['[role="tab"]:has-text("Steps")', 'button:has-text("Steps")', 'text=Steps']);
await wait(p, 2500);
let boxed = false;
try { await p.waitForSelector('.r-tracevu-box', { timeout: 20000 }); boxed = true; } catch {}
const probe = await p.evaluate(() => ({ box: document.querySelectorAll('.r-tracevu-box').length, shot: document.querySelectorAll('.r-tracevu-shot').length,
  srcs: [...document.querySelectorAll('.r-tracevu-shot')].map((i) => i.getAttribute('src')).slice(0, 4) }));
console.log('BOX present:', boxed, '| probe:', JSON.stringify(probe));
await p.screenshot({ path: path.join(out, 'live-box-full.png') });
const box = p.locator('.r-tracevu-box').first();
if (await box.count()) {
  const frame = box.locator('xpath=ancestor::*[contains(@class,"shotframe") or contains(@class,"shotlink")][1]');
  const tgt = (await frame.count()) ? frame : box;
  await tgt.scrollIntoViewIfNeeded().catch(() => {});
  await tgt.screenshot({ path: path.join(out, 'live-box-closeup.png') });
  console.log('CAPTURED live-box-closeup.png + live-box-full.png');
} else { console.log('NO BOX — wrote live-box-full.png only'); }
await b.close();
