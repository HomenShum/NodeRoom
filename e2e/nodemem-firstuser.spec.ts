/**
 * FIRST-USER end-to-end journey on the LIVE UI — the "real user lands" measured walkthrough.
 * Drives the actual served production build (not memory mode): land -> create room -> ask the agent
 * -> watch it fill the sheet, capturing screenshots at each stage. The full stack is live:
 * orchestrator/worker per-phase routing (AGENT_ORCHESTRATOR_MODEL / AGENT_WORKER_MODEL) + cache
 * observability (cachedInputTokens on agentRuns). Metrics are read from agentRuns after the run.
 */
import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { createScratchSheetFromStarterHome } from "./liveStarter";

const BASE = process.env.BENCH_BASE_URL ?? "http://127.0.0.1:5273";
const CONVEX_URL = process.env.VITE_CONVEX_URL ?? "";
const SECRET = process.env.NODEMEM_ROOM_CONFIG_SECRET ?? "";
const SHOTDIR = pathResolve(process.cwd(), "docs/eval/firstuser-e2e");
const TASK =
  "@nodeagent Research UpscaleX: find their latest funding round, investors, and key team members, " +
  "and write the findings into the sheet (one row per fact). Mark anything you cannot verify as needs_review.";

test("first-user journey on the live UI", async ({ page }) => {
  test.setTimeout(12 * 60_000);
  mkdirSync(SHOTDIR, { recursive: true });
  const t0 = Date.now();

  // 1) LAND (cold first visit)
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTDIR}/01-landing.png` });

  // 2) CREATE ROOM (starter room), then add a scratch sheet through Room Home
  await page.locator('[data-testid="create-room"]').click({ timeout: 60_000 });
  await page.locator('[data-testid="create-room-submit"]').waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('[data-testid="create-room-submit"]').click();
  await createScratchSheetFromStarterHome(page);
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTDIR}/02-room-starter-scratch.png` });

  const roomCode = (() => { try { return new URL(page.url()).searchParams.get("room") ?? ""; } catch { return ""; } })();
  const convex = new ConvexHttpClient(CONVEX_URL);
  const info = await convex.query(api.rooms.byCode, { code: roomCode });
  const roomId = info?.roomId;

  // 3) ASK (the agent starts working)
  await page.locator('textarea[data-testid="chat-composer"]').first().fill(TASK, { timeout: 30_000 });
  await page.locator('[data-testid="chat-send"]').first().click();
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${SHOTDIR}/03-agent-working.png` });

  // 4) WAIT for completion (authoritative, via the DB), then capture the filled sheet
  let answer = "", done = false;
  const deadline = Date.now() + 9 * 60_000;
  while (Date.now() < deadline && roomId) {
    await page.waitForTimeout(4000);
    try {
      const a = await convex.query(api.nodemem.benchRoomAnswer, { roomId, secret: SECRET });
      if (a) { answer = a.text; if (a.done && a.text.trim().length > 0) { done = true; break; } }
    } catch { /* transient */ }
  }
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTDIR}/04-sheet-filled.png`, fullPage: true });

  const latencyMs = Date.now() - t0;
  writeFileSync(`${SHOTDIR}/result.json`, JSON.stringify({
    roomCode, roomId: roomId ? String(roomId) : null, done, latencyMs,
    answerPreview: answer.replace(/\s+/g, " ").slice(0, 1200),
  }, null, 2) + "\n");
  console.log(`FIRSTUSER roomId=${String(roomId)} roomCode=${roomCode} done=${done} latencyMs=${latencyMs}`);
  expect(roomId, "room should resolve").toBeTruthy();
});
