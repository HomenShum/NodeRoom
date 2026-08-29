import { chromium } from "@playwright/test";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

/**
 * Founder-roadshow drive: landing → sample workspace → AI tab → live Kimi K3
 * run rendered by the NEW AgentThread → inline patch accept. Records video +
 * staged stills. Fails honestly: every stage logs what it actually saw.
 */
const OUT = "D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/noderoom/.qa/evidence/20260718-nodeslide-thread";
mkdirSync(OUT, { recursive: true });
const log = (stage, info) => console.log(JSON.stringify({ stage, ...info }));

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1512, height: 900 },
  recordVideo: { dir: OUT, size: { width: 1512, height: 900 } },
});
const page = await ctx.newPage();
page.setDefaultTimeout(60_000);

await page.goto("http://127.0.0.1:4184/", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);

// 1) Enter the editable sample workspace
await page.getByRole("button", { name: /Explore the editable sample/i }).click();
await page.waitForTimeout(3000);
await page.screenshot({ path: join(OUT, "01-workspace.png") });
log("workspace", { url: page.url() });

// 2) Open the AI tab
const aiTab = page.getByRole("button", { name: /^AI$/ }).first();
const aiTabAlt = page.locator('button:has-text("AI")').first();
if (await aiTab.count()) await aiTab.click();
else await aiTabAlt.click();
await page.waitForTimeout(1200);
await page.screenshot({ path: join(OUT, "02-ai-tab-initial.png") });

// 3) Send a real instruction to the live Kimi agent
const composer = page.locator('[data-testid="ai-composer"] textarea').first();
await composer.waitFor({ state: "visible" });
await composer.click();
await composer.fill("Tighten the title slide headline to eight words or fewer and make the subtitle one crisp sentence.");
const t0 = Date.now();
await page.getByTestId("ai-submit").click();
log("sent", { t: 0 });

// 4) Watch the thread: turn appears, steps tick, patch card lands
const turn = page.locator('[data-testid="agent-thread-turn"]').last();
await turn.waitFor({ state: "visible", timeout: 30_000 }).catch(() => log("turn", { visible: false }));
await page.screenshot({ path: join(OUT, "03-thread-working.png") });
log("turn-visible", { ms: Date.now() - t0 });

// Wait for the inline patch card (awaiting_review) or failure — Kimi reasons, be patient.
const patchCard = page.locator('[data-testid="agent-thread-patch"]');
const errorState = page.locator('[data-testid="agent-thread-error"]');
let outcome = "timeout";
try {
  await Promise.race([
    patchCard.waitFor({ state: "visible", timeout: 300_000 }).then(() => { outcome = "patch"; }),
    errorState.waitFor({ state: "visible", timeout: 300_000 }).then(() => { outcome = "error"; }),
  ]);
} catch { /* keep timeout */ }
log("outcome", { outcome, ms: Date.now() - t0 });
await page.screenshot({ path: join(OUT, "04-thread-outcome.png") });

// 5) Accept the patch in place
if (outcome === "patch") {
  await page.waitForTimeout(1200);
  await page.getByTestId("agent-thread-patch-accept").click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: join(OUT, "05-accepted.png") });
  const settled = await page.locator('[data-testid="agent-thread-patch-settled"]').textContent().catch(() => null);
  const status = await page.locator('[data-testid="agent-thread-status"]').last().textContent().catch(() => null);
  log("accepted", { settled, status });
}

// Trailing beat for the recording, then close.
await page.waitForTimeout(2500);
const video = page.video();
await ctx.close();
const path = await video.path();
renameSync(path, join(OUT, "raw-demo.webm"));
await browser.close();
log("done", { video: "raw-demo.webm" });
