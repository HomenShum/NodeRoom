import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

/**
 * Live agent streaming telemetry probe.
 * Creates a fresh live demo room on prod Convex (/?demo=CODE), sends a real
 * @nodeagent request, and instruments the public chat feed with a
 * MutationObserver to timestamp every streamed mutation. Outputs a JSON
 * timeline + summary stats (TTFT, inter-chunk gaps, stalls, terminal latency)
 * plus a provenance audit (job result, receipts, sources, trace count).
 */
const OUT = "D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/noderoom/.qa/evidence/20260718-live-agent";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 860 } });
page.setDefaultTimeout(90_000);

const code = `TL${Date.now().toString(36).toUpperCase()}`;
await page.goto(`http://127.0.0.1:5221/?demo=${code}&name=Probe&confirmed=1`, { waitUntil: "domcontentloaded" });
const chat = page.getByTestId("public-chat-panel");
await chat.getByTestId("chat-composer").waitFor({ state: "visible", timeout: 60_000 });

// Instrument the feed BEFORE sending.
await page.evaluate(() => {
  const feed = document.querySelector('[data-testid="public-chat-panel"] [data-testid="chat-feed"]');
  window.__tl = { t0: 0, events: [] };
  const push = (kind, info = "") =>
    window.__tl.events.push({ t: performance.now(), kind, info: String(info).slice(0, 80) });
  const describe = (el) => {
    if (!(el instanceof HTMLElement)) return "";
    return el.getAttribute?.("data-testid") || el.className?.toString().slice(0, 40) || el.tagName;
  };
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "characterData") {
        push("text", `+${m.target.textContent?.length ?? 0}ch`);
      } else if (m.type === "childList") {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) push("node", describe(n));
          else if (n.nodeType === 3) push("textnode", `+${n.textContent?.length ?? 0}ch`);
        }
      }
    }
  });
  mo.observe(feed, { subtree: true, childList: true, characterData: true });
});

const prompt = "@nodeagent recompute the remaining Q3 variance cells and write the visible sheet cells only";
await chat.getByTestId("chat-composer").fill(prompt);
const tSend = Date.now();
await page.evaluate(() => { window.__tl.t0 = performance.now(); });
await chat.getByTestId("chat-send").click();

// Wait for a terminal signal: job result, research receipt, or error.
const terminal = page.locator(
  '[data-testid="agent-job-result"], [data-testid="agent-research-receipt"], [data-testid="agent-lock-released-receipt"], [data-testid="agent-error"]',
);
let terminalKind = "timeout";
try {
  await terminal.first().waitFor({ state: "visible", timeout: 240_000 });
  terminalKind = (await terminal.first().getAttribute("data-testid")) ?? "unknown";
} catch { /* keep timeout */ }
const tTerminal = Date.now();
await page.waitForTimeout(1500); // trailing mutations

const timeline = await page.evaluate(() => window.__tl);

// Provenance audit from the DOM.
const provenance = await page.evaluate(() => {
  const q = (sel) => document.querySelector(sel);
  const text = (sel) => q(sel)?.textContent?.trim().slice(0, 160) ?? null;
  return {
    jobResult: text('[data-testid="agent-job-result"]'),
    researchReceipt: text('[data-testid="agent-research-receipt"]'),
    lockReceipt: text('[data-testid="agent-lock-released-receipt"]'),
    jobStatus: text('[data-testid="job-status"]'),
    error: text('[data-testid="agent-error"]'),
    progressCard: text('[data-testid="agent-progress-card"]'),
    sourceChips: document.querySelectorAll('[data-testid*="source"], [data-testid*="cite"]').length,
    varianceRev: text('[data-cell-key="r_rev__variance"]'),
    varianceCogs: text('[data-cell-key="r_cogs__variance"]'),
    traceLabel: [...document.querySelectorAll("button, span")].map((e) => e.textContent?.trim() ?? "")
      .find((t) => /Room trace · \d+/.test(t)) ?? null,
  };
});

// Stats from the mutation timeline.
const t0 = timeline.t0;
const rel = timeline.events.map((e) => ({ ...e, t: Math.round(e.t - t0) })).filter((e) => e.t >= 0);
const textEvents = rel.filter((e) => e.kind === "text" || e.kind === "textnode");
const gaps = [];
for (let i = 1; i < textEvents.length; i++) gaps.push(textEvents[i].t - textEvents[i - 1].t);
gaps.sort((a, b) => a - b);
const pct = (p) => (gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor((p / 100) * gaps.length))] : null);
const summary = {
  roomCode: code,
  terminalKind,
  totalMs: tTerminal - tSend,
  firstDomEventMs: rel[0]?.t ?? null,
  firstTextMutationMs: textEvents[0]?.t ?? null,
  textMutations: textEvents.length,
  interChunkGapMs: { p50: pct(50), p90: pct(90), max: gaps.length ? gaps[gaps.length - 1] : null },
  stallsOver2s: gaps.filter((g) => g > 2000).length,
  nodeEventsFirst10: rel.filter((e) => e.kind === "node").slice(0, 10),
  provenance,
};
writeFileSync(`${OUT}/stream-telemetry.json`, JSON.stringify({ summary, timeline: rel.slice(0, 400) }, null, 2));
console.log(JSON.stringify(summary, null, 1));
await page.screenshot({ path: `${OUT}/final-state.png`, fullPage: false });
await browser.close();
