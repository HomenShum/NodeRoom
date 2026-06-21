// Drive the LIVE NodeRoom app into the BTB Trace tab's Steps/Evidence detail and probe
// broadly for the cited-source box. Read-only navigation.
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
const BASE = process.env.APP_BASE || 'http://127.0.0.1:5174';
const out = path.join(process.cwd(), 'scripts/inference-nodetrace/app-shots');
fs.mkdirSync(out, { recursive: true });
let b; try { b = await chromium.launch(); } catch { b = await chromium.launch({ channel: 'msedge' }); }
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await p.goto(BASE + '/?mode=memory#btb', { waitUntil: 'networkidle' });
await p.waitForTimeout(3000);

const boxProbe = () => p.evaluate(() => {
  const c = (s) => { try { return document.querySelectorAll(s).length; } catch { return -1; } };
  const classesWith = (kw) => [...new Set([...document.querySelectorAll('[class]')].flatMap((e) => [...e.classList]).filter((cl) => cl.toLowerCase().includes(kw)))].slice(0, 12);
  return {
    tracevuBox: c('.r-tracevu-box'), tracevuAny: c('[class*="tracevu"]'), boxAny: c('[class*="box"]'),
    overlay: c('[class*="overlay"]'), locator: c('[class*="locator"]'), highlight: c('[class*="highlight"]'),
    svgRect: c('svg rect'), imgs: c('img'), canvas: c('canvas'),
    boxClasses: classesWith('box'), tracevuClasses: classesWith('tracevu'),
  };
});
async function clickAny(sels) { for (const s of sels) { const el = p.locator(s).first(); if (await el.count()) { try { await el.click({ timeout: 2500 }); return s; } catch {} } } return null; }

console.log('INIT box probe:', JSON.stringify(await boxProbe()));
await clickAny(['[data-testid="trace-tab"]', '[role="tab"]:has-text("Trace")', 'text=Trace']);
await p.waitForTimeout(1500);

// STEPS
const stepsTab = await clickAny(['[role="tab"]:has-text("Steps")', 'button:has-text("Steps")', 'text=Steps']);
await p.waitForTimeout(1500);
await p.screenshot({ path: path.join(out, 'app-02-steps.png') });
console.log('STEPS tab:', stepsTab, '| box probe:', JSON.stringify(await boxProbe()));
// click first step-ish row
const stepRow = await clickAny(['[class*="step"]:not([class*="steps"])', '[data-testid*="step"]', 'li:has-text("step")', '[class*="r-tracevu"] li']);
await p.waitForTimeout(1500);
await p.screenshot({ path: path.join(out, 'app-03-step-detail.png') });
console.log('STEP row:', stepRow, '| box probe:', JSON.stringify(await boxProbe()));

// EVIDENCE
const evTab = await clickAny(['[role="tab"]:has-text("Evidence")', 'button:has-text("Evidence")', 'text=Evidence']);
await p.waitForTimeout(1500);
await p.screenshot({ path: path.join(out, 'app-04-evidence.png') });
const evRow = await clickAny(['[class*="evidence"] [class*="row"]', '[data-testid*="evidence"]', '[class*="evidence"] li', '[class*="cite"]']);
await p.waitForTimeout(1800);
await p.screenshot({ path: path.join(out, 'app-05-evidence-detail.png') });
console.log('EVIDENCE tab/row:', evTab, evRow, '| box probe:', JSON.stringify(await boxProbe()));

await b.close();
console.log('shots ->', out);
