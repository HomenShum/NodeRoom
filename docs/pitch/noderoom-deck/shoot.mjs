import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const deck = pathToFileURL(path.resolve('docs/pitch/noderoom-deck/deck/index.html')).href;
const outDir = path.resolve('docs/pitch/noderoom-deck/shots');
fs.mkdirSync(outDir, { recursive: true });

let browser;
try { browser = await chromium.launch(); }
catch { browser = await chromium.launch({ channel: 'msedge' }); }

const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await page.goto(deck, { waitUntil: 'networkidle' });

const n = await page.evaluate(() => document.querySelectorAll('.slide').length);
for (let k = 0; k < n; k++) {
  if (k > 0) await page.keyboard.press('ArrowRight'); // drive the real show() so the page counter updates
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(outDir, `slide-${String(k + 1).padStart(2, '0')}.png`) });
}

await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: path.resolve('docs/pitch/noderoom-deck/NodeRoom-Pitch.pdf'),
  printBackground: true,
  width: '1280px',
  height: '720px',
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});

await browser.close();
console.log('Shot', n, 'slides + PDF to docs/pitch/noderoom-deck/');
