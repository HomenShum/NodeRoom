import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packet = path.dirname(fileURLToPath(import.meta.url));
const root = 'D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/.portfolio-worktrees/noderoom-current-consumer-20260905';
const require = createRequire(path.join(root, 'package.json'));
const { chromium } = require('playwright');
const output = path.join(packet, process.argv[2] || 'work-before-02');
await mkdir(output);
const base = 'http://127.0.0.1:54431';
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(VITE_|VERCEL_|CONVEX_|OPENAI_|OPENROUTER_|ANTHROPIC_|GOOGLE_GENERATIVE_|GITHUB_SHA)/.test(key)) delete env[key];
const stream = createWriteStream(path.join(output, 'server.log'));
const server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '54431', '--strictPort'], { cwd: root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.pipe(stream); server.stderr.pipe(stream);
let ownedReady = false;
server.stdout.on('data', chunk => { if (String(chunk).includes(base)) ownedReady = true; });
const report = { schema: 'noderoom-entry-observation/v1', startedAt: new Date().toISOString(), sourceCommit: '2b3e5bd718b80747f32257a8b8af5f15e2310699', sourceBindings: '../source-before.json', cells: [], externalRequests: [], errors: [], status: 'RUNNING' };
let browser;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function capture(page, name) {
  await page.evaluate(() => Promise.race([Promise.allSettled(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished)), new Promise(r => setTimeout(r, 1500))]));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await page.screenshot({ path: path.join(output, `${name}.png`), caret: 'initial' });
  const html = await page.content();
  await writeFile(path.join(output, `${name}.html`), html);
  const dom = await page.evaluate(() => ({ url: location.href, title: document.title, body: document.body.innerText, horizontalOverflow: document.documentElement.scrollWidth - innerWidth, viewport: { width: innerWidth, height: innerHeight }, build: document.querySelector('meta[name="noderoom-build-sha"]')?.getAttribute('content'), buttons: [...document.querySelectorAll('button,a,input,textarea')].filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height).map(e => ({ tag: e.tagName, testId: e.getAttribute('data-testid'), label: e.getAttribute('aria-label'), text: (e.textContent || '').trim().slice(0, 120), placeholder: e.getAttribute('placeholder'), disabled: e.disabled })) }));
  await writeFile(path.join(output, `${name}.json`), JSON.stringify(dom, null, 2));
  return { name, pngSha256: hash(png), domSha256: hash(html), url: dom.url, horizontalOverflow: dom.horizontalOverflow, build: dom.build };
}
try {
  const deadline = Date.now() + 30000;
  while (true) {
    if (server.exitCode !== null) throw new Error(`Owned preview exited ${server.exitCode}`);
    if (ownedReady) try { const response = await fetch(base, { signal: AbortSignal.timeout(1000) }); if (response.ok) break; } catch {}
    if (Date.now() >= deadline) throw new Error('Owned preview timeout');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ headless: true });
  for (const width of [320, 390]) {
    for (const [routeName, route] of [['natural-memory', '/?mode=memory']]) {
      const context = await browser.newContext({ viewport: { width, height: width <= 390 ? 844 : 960 } });
      await context.route('**/*', request => { const u = new URL(request.request().url()); if (u.origin === base || ['data:', 'blob:'].includes(u.protocol)) return request.continue(); report.externalRequests.push({ width, routeName, url: u.origin + u.pathname, action: 'blocked' }); return request.abort('blockedbyclient'); });
      const page = await context.newPage(); const cell = { width, routeName, captures: [], console: [], pageErrors: [] };
      page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) cell.console.push({ type: msg.type(), text: msg.text() }); });
      page.on('pageerror', error => cell.pageErrors.push(error.message));
      try {
        await page.goto(base + route, { waitUntil: 'domcontentloaded' });
        if (routeName === 'landing') await page.getByRole('heading', { name: /Work with AI/i }).waitFor({ timeout: 30000 });
        else await page.locator('[data-testid="mobile-bottom-nav"], [data-testid="start-demo-room"], [data-testid="artifact-panel"]').first().waitFor({ timeout: 30000 });
        cell.captures.push(await capture(page, `${routeName}-${width}-entry`));
        const sample = page.getByTestId('start-demo-room');
        if (routeName !== 'landing' && await sample.isVisible()) {
          await sample.click();
          await page.getByTestId('artifact-panel').waitFor({ timeout: 30000 });
          cell.captures.push(await capture(page, `${routeName}-${width}-sample`));
        }
        cell.downloads = [];
        page.on('download', d => cell.downloads.push({ name: d.suggestedFilename() }));
        if (await page.getByTestId('mobile-bottom-nav').isVisible()) {
          await page.locator('.na-rcard[data-kind="sheet"]').first().click();
          await page.getByRole('dialog', {name:'Spreadsheet', exact:true}).waitFor();
          cell.captures.push(await capture(page, `${routeName}-${width}-sheet`));
          await page.getByRole('dialog', {name:'Spreadsheet', exact:true}).locator('.na-art-tab').filter({hasText:'Export'}).click();
          cell.captures.push(await capture(page, `${routeName}-${width}-sheet-export`));
          const exportButtons = await page.getByRole('dialog', {name:'Spreadsheet', exact:true}).getByRole('button').allTextContents();
          cell.exportButtons = exportButtons;
          await page.getByRole('button', {name:'Download XLSX',exact:true}).click();
          const deadline = Date.now()+2000;
          while (!cell.downloads.length && Date.now()<deadline) await new Promise(r=>setTimeout(r,100));
          cell.captures.push(await capture(page, `${routeName}-${width}-after-download`));
          cell.downloadToast = await page.locator('.na-toast').innerText();
          cell.downloadCountAfterWait = cell.downloads.length;
          await page.getByRole('dialog', {name:'Spreadsheet', exact:true}).getByRole('button', {name:'Close', exact:true}).click();
          await page.getByTestId('mobile-nav-room').click();
          cell.captures.push(await capture(page, `${routeName}-${width}-room`));
          await page.getByTestId('mobile-nav-inbox').click();
          await page.getByRole('button', {name:/CardioNova research plan/}).click();
          cell.captures.push(await capture(page, `${routeName}-${width}-review-plan`));
          await page.getByRole('button', {name:'Approve research', exact:true}).click();
          await page.getByRole('button', {name:'Review evidence', exact:true}).waitFor({timeout:7000});
          cell.captures.push(await capture(page, `${routeName}-${width}-review-completed`));
          await page.getByRole('button', {name:'Review evidence', exact:true}).click();
          cell.captures.push(await capture(page, `${routeName}-${width}-evidence`));
          await page.reload({waitUntil:'domcontentloaded'});
          await page.getByTestId('mobile-bottom-nav').waitFor();
          await page.getByTestId('mobile-nav-inbox').click();
          cell.captures.push(await capture(page, `${routeName}-${width}-review-after-reload`));
        }
        cell.status = 'OBSERVED';
      } catch (error) { cell.status = 'FAILED'; cell.error = String(error); cell.captures.push(await capture(page, `${routeName}-${width}-failure`)); }
      report.cells.push(cell); await context.close();
      await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    }
  }
  report.status = report.cells.some(c => c.status === 'FAILED') ? 'OBSERVED_WITH_FAILURES' : 'OBSERVED';
} catch (error) { report.status = 'FAILED'; report.errors.push(String(error)); }
finally {
  if (browser) await browser.close();
  if (server.exitCode === null) spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { windowsHide: true });
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else server.once('exit', resolve); });
  stream.end(); report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ status: report.status, cells: report.cells.length, output }));
process.exitCode = report.status === 'FAILED' ? 1 : 0;
