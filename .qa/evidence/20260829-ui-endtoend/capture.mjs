// Evidence capture: node capture.mjs <base-url> <out-dir> [surfaceFilter]
// Shoots each surface full-page into <out-dir>/<name>.png + notes.json (console errors, title, testid sample).
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const [base, outDir, filter] = process.argv.slice(2);
if (!base || !outDir) { console.error('usage: node capture.mjs <base-url> <out-dir> [filter]'); process.exit(1); }
mkdirSync(outDir, { recursive: true });

const SURFACES = [
  { name: 'landing', path: '/', scroll: true },
  { name: 'story', path: '/#story', scroll: true },
  { name: 'mobile', path: '/#mobile', viewport: { width: 390, height: 844 }, scroll: true },
  { name: 'room-tour', path: '/#room-tour', scroll: true },
  { name: 'memory-room', path: '/?mode=memory', actions: [
    { click: '[data-testid="start-demo-room"]', optional: true },
    { click: '[data-testid="tour-skip"]', optional: true },
  ] },
  { name: 'memory-room-trace', path: '/?mode=memory', actions: [
    { click: '[data-testid="start-demo-room"]', optional: true },
    { click: '[data-testid="tour-skip"]', optional: true },
    { click: '[data-testid="trace-tab"]', optional: true },
  ] },
];

const browser = await chromium.launch();
const notes = {};
for (const s of SURFACES) {
  if (filter && !s.name.includes(filter)) continue;
  const ctx = await browser.newContext({ viewport: s.viewport ?? { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', e => errors.push('pageerror: ' + String(e).slice(0, 300)));
  try {
    await page.goto(base + s.path, { waitUntil: 'networkidle', timeout: 45000 });
    for (const a of s.actions ?? []) {
      try { await page.click(a.click, { timeout: 8000 }); await page.waitForTimeout(800); }
      catch (e) { if (!a.optional) throw e; notes[s.name + ':missed'] = a.click; }
    }
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(outDir, s.name + '.png') });
    // body never grows here (inner scroll container) — segment-scroll the real container
    if (s.scroll) {
      const segs = await page.evaluate(() => {
        const cands = [document.scrollingElement, ...document.querySelectorAll('*')]
          .filter(el => el && el.scrollHeight > el.clientHeight + 100 && el.clientHeight > 300);
        const el = cands.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
        if (!el) return 0;
        el.setAttribute('data-cap-scroll', '1');
        return Math.min(8, Math.ceil(el.scrollHeight / el.clientHeight) - 1);
      });
      for (let i = 1; i <= segs; i++) {
        await page.evaluate(i => { const el = document.querySelector('[data-cap-scroll]'); el.scrollTop = i * el.clientHeight; }, i);
        await page.waitForTimeout(900);
        await page.screenshot({ path: join(outDir, `${s.name}.seg${i}.png`) });
      }
    }
    const testids = await page.$$eval('[data-testid]', els => [...new Set(els.map(e => e.getAttribute('data-testid')))].slice(0, 40));
    notes[s.name] = { title: await page.title(), errors: errors.slice(0, 10), testids };
    console.log('captured', s.name, '| errors:', errors.length);
  } catch (e) {
    notes[s.name] = { failed: String(e).slice(0, 300), errors };
    console.log('FAILED', s.name, String(e).slice(0, 160));
  }
  await ctx.close();
}
await browser.close();
writeFileSync(join(outDir, 'notes.json'), JSON.stringify(notes, null, 2));
console.log('done ->', outDir);
