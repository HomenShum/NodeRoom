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
const report = { schema: 'noderoom-mobile-export-observation/v1', startedAt: new Date().toISOString(), baseCommit: '2b3e5bd718b80747f32257a8b8af5f15e2310699', sourceBindings: 'artifacts/*/source-bindings.json', sourceState: 'Uncommitted seven-path candidate; base commit alone does not identify these tested bytes', cells: [], externalRequests: [], errors: [], status: 'RUNNING' };
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
  const run = spawn(process.execPath, [path.join(root,'node_modules/@playwright/test/cli.js'), 'test', 'e2e/mobile-sample-workbook-export.spec.ts', '--workers=1', '--retries=0', '--reporter=list', '--output', path.join(output,'artifacts')], {cwd:root,env:{...env,PLAYWRIGHT_BASE_URL:base,PLAYWRIGHT_PORT:'54431',PLAYWRIGHT_REUSE_SERVER:'1'},windowsHide:true,stdio:'inherit'});
  const exit = await new Promise(resolve=>run.once('exit',resolve));
  report.status=exit===0?'PASSED':'FAILED';report.testExit=exit;

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
