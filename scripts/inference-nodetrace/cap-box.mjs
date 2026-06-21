// Render the banking source -> /public/qa-trace, then drive the LIVE app's DEMO room
// (where QA_BUNDLES render) to the WBD trace bundle and capture the red box on the source.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const BASE = process.env.APP_BASE || 'http://127.0.0.1:5174';
const repo = process.cwd();
const out = path.join(repo, 'scripts/inference-nodetrace/app-shots');
fs.mkdirSync(out, { recursive: true });
const pubShot = path.join(repo, 'public/qa-trace/btb-source.png');
fs.mkdirSync(path.dirname(pubShot), { recursive: true });
let b; try { b = await chromium.launch(); } catch { b = await chromium.launch({ channel: 'msedge' }); }

const p1 = await b.newPage({ viewport: { width: 1100, height: 720 }, deviceScaleFactor: 2 });
await p1.goto(pathToFileURL(path.join(repo, 'scripts/inference-nodetrace/banking-source.html')).href, { waitUntil: 'networkidle' });
await p1.locator('.page').screenshot({ path: pubShot });
await p1.close();
console.log('wrote', pubShot);

const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
async function clickAny(sels, timeout = 2500) { for (const s of sels) { const el = p.locator(s).first(); if (await el.count()) { try { await el.click({ timeout }); return s; } catch {} } } return null; }
await p.goto(BASE + '/?mode=memory', { waitUntil: 'domcontentloaded', timeout: 45000 });
await p.waitForTimeout(5000);
await clickAny(['[data-testid="start-demo-room"]', 'button:has-text("Start")', 'button:has-text("demo")']);
await p.waitForTimeout(5000);
const traceTab = await clickAny(['[data-testid="trace-tab"]', '[role="tab"]:has-text("Trace")', 'button:has-text("Trace")', 'text=Trace']);
await p.waitForTimeout(1800);
const recs = await p.evaluate(() => [...document.querySelectorAll('[class*="rec-title"], .r-tracevu-rec')].map((e) => (e.textContent || '').trim().slice(0, 50)).filter(Boolean).slice(0, 16));
console.log('traceTab:', traceTab, '| records:', JSON.stringify(recs));
const wbd = await clickAny([':text("source screenshot + box")', ':text("Web retrieval")', '.r-tracevu-rec:has-text("source screenshot")', ':text("Q3-2025 ledger")']);
await p.waitForTimeout(1300);
await clickAny(['[role="tab"]:has-text("Steps")', 'button:has-text("Steps")', 'text=Steps']);
await p.waitForTimeout(1800);
const probe = await p.evaluate(() => ({ box: document.querySelectorAll('.r-tracevu-box').length, shot: document.querySelectorAll('.r-tracevu-shot').length, srcs: [...document.querySelectorAll('.r-tracevu-shot')].map((i) => i.getAttribute('src')).slice(0, 4) }));
console.log('clicked wbd:', wbd, '| probe:', JSON.stringify(probe));
await p.screenshot({ path: path.join(out, 'app-box-trace.png') });
const box = p.locator('.r-tracevu-box').first();
if (await box.count()) {
  const frame = box.locator('xpath=ancestor::*[contains(@class,"shotframe") or contains(@class,"shotlink")][1]');
  const tgt = (await frame.count()) ? frame : box;
  await tgt.screenshot({ path: path.join(out, 'app-box-closeup.png') });
  console.log('CAPTURED boxed source closeup');
}
await b.close();
console.log('done ->', out);
