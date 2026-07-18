import { chromium } from "@playwright/test";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";

const OUT = "D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/noderoom/.qa/evidence/20260717-postmerge/clip";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: { dir: OUT, size: { width: 1440, height: 900 } },
});
const page = await ctx.newPage();
const t0 = Date.now();
await page.goto("http://127.0.0.1:5260/?mode=memory&surface=desktop", { waitUntil: "networkidle", timeout: 60000 });

const card = page.locator('[data-testid="landing-demo-loop"]');
await card.waitFor({ state: "visible", timeout: 15000 });
const box = await card.boundingBox();

// Align to the start of a loop: wait until the loop wraps into its first frame ("lock").
await page.waitForFunction(
  () => document.querySelector('[data-testid="landing-demo-loop"]')?.getAttribute("data-frame") === "v43",
  null, { timeout: 20000 },
);
await page.waitForFunction(
  () => document.querySelector('[data-testid="landing-demo-loop"]')?.getAttribute("data-frame") === "lock",
  null, { timeout: 20000 },
);
const tLock = Date.now();

// One full loop = 1400+1600+1800+1500+1800+2000 = 10100ms, plus settle tail.
await page.waitForTimeout(10500);
const video = page.video();
await ctx.close();
const path = await video.path();
await browser.close();

// Playwright names the file with a hash; normalize it.
const finalPath = join(OUT, "raw.webm");
renameSync(path, finalPath);
console.log(JSON.stringify({
  raw: finalPath,
  offsetSec: ((tLock - t0) / 1000).toFixed(2),
  crop: box ? { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.width), h: Math.round(box.height) } : null,
}));
