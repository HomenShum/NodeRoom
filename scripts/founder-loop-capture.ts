import { chromium } from "@playwright/test";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

// QA + verify lane: drive the LIVE app (read-only) through the post-fix fresh-room
// flow and record it, so gemini-3.5-flash can judge whether issues #1/#4 are resolved.
const OUT = join(process.cwd(), ".tmp-qa", "mp4-review");
const BASE = process.env.QA_BASE_URL ?? "http://localhost:5273";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT, size: { width: 1280, height: 800 } },
});
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.click("[data-testid='create-room']");
  await page.waitForSelector("[data-testid='create-room-submit']", { timeout: 10000 });
  await page.click("[data-testid='create-room-submit']");
  await page.waitForSelector("[data-testid='public-chat-panel']", { timeout: 60000 });
  await page.waitForSelector("text=Company research", { timeout: 60000 });
  await page.waitForTimeout(1800);
  await page.screenshot({ path: join(OUT, "verify-starter-room.png") });
  await page.click("[data-testid='home-tab']");
  await page.click("[data-testid='blank-cta-sheet']");
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(OUT, "verify-scratch-sheet.png") });
  await page.waitForTimeout(800);
  console.log("flow_ok");
} catch (e) {
  console.log("flow_error:", e instanceof Error ? e.message : String(e));
  await page.screenshot({ path: join(OUT, "verify-error.png") }).catch(() => {});
}
const video = page.video();
await ctx.close();
const vpath = video ? await video.path() : null;
if (vpath) {
  const dest = join(OUT, "verify-fresh-room.webm");
  try { renameSync(vpath, dest); console.log("video:", dest); } catch { console.log("video:", vpath); }
}
await browser.close();
console.log("done");
