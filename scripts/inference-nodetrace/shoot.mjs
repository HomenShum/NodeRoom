import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = path.join(process.cwd(), process.argv[2] || 'scripts/inference-nodetrace/out');
const name = process.argv[3] || 'slide.html';
const png = name.replace(/\.html$/, '.png');
const url = pathToFileURL(path.join(dir, name)).href;
let b; try { b = await chromium.launch(); } catch { b = await chromium.launch({ channel: 'msedge' }); }
const p = await b.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(3500);
await p.screenshot({ path: path.join(dir, png) });
await b.close();
console.log('wrote', path.join(dir, png));
