// Nav-timing probe: node perf-probe.mjs <url> <label> — median of 5 cold loads.
import { chromium } from 'playwright';
const [url, label] = process.argv.slice(2);
const browser = await chromium.launch();
const rows = [];
for (let i = 0; i < 5; i++) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const paint = performance.getEntriesByType('paint').find(p => p.name === 'first-contentful-paint');
    return { dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd), fcp: paint ? Math.round(paint.startTime) : null, transfer: Math.round(performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), 0) / 1024) };
  });
  rows.push(m);
  await ctx.close();
}
const med = k => rows.map(r => r[k]).sort((a, b) => a - b)[2];
console.log(`${label}: FCP ${med('fcp')}ms | DCL ${med('dcl')}ms | load ${med('load')}ms | resources ~${med('transfer')}KB (median of 5)`);
await browser.close();
