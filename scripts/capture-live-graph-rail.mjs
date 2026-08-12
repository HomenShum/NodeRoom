/**
 * capture-live-graph-rail.mjs — evidence gate for the Live session graph rail.
 *
 * Drives the keyless memory-mode demo room, runs the real collaboration script
 * (window.__runCollab — locks, edits, drafts, proposals through the engine),
 * opens the rail, waits until it reports >0 entities from those REAL room
 * events, and screenshots it. Exits nonzero if the rail stays empty.
 *
 *   node scripts/capture-live-graph-rail.mjs
 */
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const PORT = 5272;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = "docs/release/media/live-graph-rail.png";

async function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`vite dev server did not answer at ${url}`);
}

const server = spawn("npm", ["run", "dev", "--", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
  stdio: "ignore",
  shell: true,
});
const stopServer = () => { try { server.kill(); } catch { /* already gone */ } };
process.on("exit", stopServer);

let failed = null;
try {
  await waitForServer(BASE);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1720, height: 960 } });
  await page.goto(`${BASE}/?mode=memory&surface=desktop`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ } });

  // Enter the demo room (same path as e2e/fixtures.ts enterDemoRoom).
  const inRoom = await page.getByTestId("artifact-panel").waitFor({ state: "visible", timeout: 2_000 }).then(() => true, () => false);
  if (!inRoom) {
    await page.getByTestId("start-demo-room").click({ timeout: 60_000 });
    const nameInput = page.locator(".r-landing input").first();
    if (await nameInput.isVisible().catch(() => false)) {
      await nameInput.fill("Host");
      await page.keyboard.press("Enter");
    }
    await page.getByTestId("artifact-panel").waitFor({ state: "visible", timeout: 60_000 });
  }

  // Run the REAL collaboration scenario through the engine (locks, edits, drafts, proposals).
  await page.waitForFunction(() => typeof window.__runCollab === "function", undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__runCollab());

  // Open the rail and require entities that came from real room events.
  await page.getByTestId("live-graph-rail-toggle").click({ timeout: 30_000 });
  const rail = page.getByTestId("live-graph-rail");
  await rail.waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="live-graph-rail"]');
    return el !== null && Number(el.getAttribute("data-entities")) > 0;
  }, undefined, { timeout: 30_000 });
  await page.locator('[data-testid="live-graph-rail"] canvas').first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(3_000); // let the ForceAtlas2 layout settle before the shot

  const entities = Number(await rail.getAttribute("data-entities"));
  const edges = Number(await rail.getAttribute("data-edges"));
  mkdirSync("docs/release/media", { recursive: true });
  await page.screenshot({ path: OUT });
  console.log(`live-graph-rail: ${entities} entities, ${edges} edges from real room events -> ${OUT}`);
  if (!(entities > 0)) throw new Error("rail is empty: 0 entities");
  await browser.close();
} catch (err) {
  failed = err;
} finally {
  stopServer();
}

if (failed) {
  console.error("capture-live-graph-rail FAILED:", failed);
  process.exit(1);
}
