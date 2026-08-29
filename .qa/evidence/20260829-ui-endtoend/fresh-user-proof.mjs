// Fresh-user vertical proof runner — drives the LIVE prod demo-room path anonymously
// (NODEROOM_REQUIRE_CONVEX_IDENTITY=0) and extracts measured receipts.
// Usage: node fresh-user-proof.mjs <base> <roomCode> <outDir>
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

const [base, code, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const receipts = { schemaVersion: 1, generatedAt: new Date().toISOString(), environment: { kind: 'live-prod', baseUrl: base, roomCode: code, roomData: 'synthetic-guided-sample', joinPath: 'anonymous demo join (?demo=CODE&name=...)' } };
const shot = (n) => page.screenshot({ path: join(outDir, n + '.png') });

// 1) fresh anonymous entry through the visible demo path
const t0 = Date.now();
await page.goto(`${base}/?demo=${code}&name=Homen&confirmed=1`, { waitUntil: 'domcontentloaded', timeout: 90000 });
// the demo path may still present the consent dialog — complete it through the visible flow
try {
  await page.getByTestId('chat-composer').first().waitFor({ timeout: 20000 });
} catch {
  const submit = page.getByTestId('sample-room-submit');
  if (await submit.count()) { await submit.click(); receipts.consentDialog = 'submitted via visible flow'; }
  await page.getByTestId('chat-composer').first().waitFor({ timeout: 90000 });
}
receipts.entry = { msToComposer: Date.now() - t0 };
try { await page.click('[data-testid="tour-skip"]', { timeout: 4000 }); } catch {}
await shot('01-room-entered');

// 2) route control — pick the free/zero-cost preset if a picker is exposed
let route = 'default';
try {
  const picker = page.getByTestId('chat-model-preset').first();
  await picker.waitFor({ timeout: 6000 });
  route = (await picker.innerText()).replace(/\s+/g, ' ').trim().slice(0, 80);
} catch {}
receipts.routeControl = route;

// 3) the read-only agent ask (same contract as the 2026-07-12 proof)
const PROMPT = '@nodeagent read the Open questions / workplan notebook and summarize its existing human blocks without changing anything. Cite exact block IDs.';
const t1 = Date.now();
await page.getByTestId('chat-composer').first().click();
await page.keyboard.type(PROMPT);
await page.getByTestId('chat-send').first().click();
// wait for a run to complete: agent job result card or unified stream settling
let outcome = null;
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(5000);
  const result = await page.locator('[data-testid="agent-job-result"], [data-testid="agent-research-receipt"]').count();
  const err = await page.locator('[data-testid="agent-error"]').count();
  if (err) { outcome = 'error'; break; }
  if (result) { outcome = 'completed'; break; }
}
receipts.agentRun = { outcome, wallMs: Date.now() - t1, prompt: PROMPT };
await shot('02-agent-run');

// last agent message text (summary evidence)
try {
  const feed = page.getByTestId('chat-feed').first();
  const text = (await feed.innerText()).slice(-1500);
  receipts.agentRun.feedTail = text;
} catch {}

// 4) run trace — spans, model, cost rows
try {
  await page.getByTestId('trace-tab').click({ timeout: 8000 });
  await page.waitForTimeout(2500);
  const traceText = (await page.getByTestId('trace-surface').innerText().catch(() => ''))
    .replace(/\s+/g, ' ').slice(0, 1200);
  receipts.trace = { open: true, excerpt: traceText };
  await shot('03-run-trace');
} catch (e) { receipts.trace = { open: false, error: String(e).slice(0, 120) }; }

// 5) artifacts proof bundle counts
try {
  await page.getByTestId('work-artifacts-tab').click({ timeout: 8000 });
  await page.waitForTimeout(2000);
  const wa = (await page.locator('[data-testid="work-surface"]').innerText()).replace(/\s+/g, ' ');
  const m = wa.match(/(\d+) artifacts (\d+) evidence (\d+) review (\d+) traces/);
  receipts.proofBundle = m ? { artifacts: +m[1], evidence: +m[2], review: +m[3], traces: +m[4] } : { raw: wa.slice(0, 300) };
  await shot('04-artifacts');
} catch (e) { receipts.proofBundle = { error: String(e).slice(0, 120) }; }

// 6) entity graph rail
try {
  await page.click('[aria-label*="live session graph" i], button:has-text("Open live session graph")', { timeout: 6000 });
  await page.waitForTimeout(2500);
  const g = (await page.locator('aside').last().innerText()).replace(/\s+/g, ' ').slice(0, 400);
  receipts.entityGraph = { open: true, excerpt: g };
  await shot('05-entity-graph');
} catch (e) { receipts.entityGraph = { open: false, error: String(e).slice(0, 120) }; }

writeFileSync(join(outDir, 'receipts.json'), JSON.stringify(receipts, null, 2));
console.log(JSON.stringify({ entryMs: receipts.entry.msToComposer, route, outcome: receipts.agentRun.outcome, wallMs: receipts.agentRun.wallMs, bundle: receipts.proofBundle, graph: receipts.entityGraph?.open }, null, 1));
await browser.close();
