import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const dir = path.join(process.cwd(), 'docs/pitch/noderoom-deck/fs');
const url = pathToFileURL(path.join(dir, 'index.html')).href;
const shots = path.join(dir, 'shots');
fs.mkdirSync(shots, { recursive: true });
let b; try { b = await chromium.launch(); } catch { b = await chromium.launch({ channel: 'msedge' }); }
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(800);
const n = await p.evaluate(() => document.querySelectorAll('.slide').length);
for (let k = 0; k < n; k++) {
  if (k > 0) await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(shots, `slide-${String(k + 1).padStart(2, '0')}.png`) });
}
await b.close();
console.log('shot', n, 'slides ->', shots);
