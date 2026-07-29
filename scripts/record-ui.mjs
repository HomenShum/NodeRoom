#!/usr/bin/env node
/**
 * record-ui.mjs — record real video of the running apps.
 *
 * GIFs are fine in a README; YouTube needs video. Playwright records webm
 * natively via recordVideo, so this needs no ffmpeg, no screen recorder, and no
 * network. It drives the same dev servers the GIF frames came from.
 *
 * As with capture-ui.mjs: a proof selector, not a timeout. If a page does not
 * actually render, the run FAILS for that target rather than producing a video
 * of a blank screen — which would look like evidence and be the opposite.
 *
 *   node scripts/record-ui.mjs
 */

import { chromium } from "playwright";
import { mkdir, readdir, rename } from "node:fs/promises";
import path from "node:path";

const OUT = "C:/Users/hshum/Downloads/Interview items/brain/media/video";

const TARGETS = [
  {
    name: "noderoom",
    url: "http://localhost:5260/",
    proof: "text=Review every change",
    tour: async (page) => {
      await page.waitForTimeout(1800);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(1400);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(1400);
      await page.mouse.wheel(0, -1000);
      await page.waitForTimeout(1600);
    },
  },
  {
    name: "nodeslide",
    url: "http://localhost:5180/",
    proof: "text=What presentation should we build",
    tour: async (page) => {
      await page.waitForTimeout(1800);
      // Type into the composer so the video shows the product being used, not
      // just a static landing page.
      const box = page.locator("textarea, [contenteditable=true]").first();
      if (await box.count()) {
        await box.click();
        await box.type("A deck on agent evaluation: what ground truth means", { delay: 45 });
        await page.waitForTimeout(1500);
      }
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(1400);
    },
  },
];

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const made = [];
  const failed = [];

  for (const t of TARGETS) {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      recordVideo: { dir: OUT, size: { width: 1280, height: 720 } },
    });
    const page = await ctx.newPage();
    let ok = false;
    try {
      await page.goto(t.url, { waitUntil: "networkidle", timeout: 30_000 });
      await page.waitForSelector(t.proof, { timeout: 20_000 });
      await t.tour(page);
      ok = true;
    } catch (e) {
      failed.push(`${t.name}: ${e.message.split("\n")[0]}`);
      console.log(`  FAILED    ${t.name} - ${e.message.split("\n")[0]}`);
    }
    const video = page.video();
    await ctx.close(); // the video is only finalised on context close
    if (ok && video) {
      const src = await video.path();
      const dst = path.join(OUT, `${t.name}.webm`);
      await rename(src, dst);
      made.push(dst);
      console.log(`  recorded  ${path.basename(dst)}`);
    } else if (video) {
      // Discard a video of a page that never rendered.
      try { await video.delete(); } catch { /* already gone */ }
    }
  }

  await browser.close();
  const left = (await readdir(OUT)).filter((f) => f.endsWith(".webm"));
  console.log(`\n  ${made.length} video(s) in ${OUT}`);
  console.log(`  files: ${left.join(", ") || "none"}`);
  if (failed.length) console.log(`  ${failed.length} target(s) failed; no video was kept for them.`);
  process.exitCode = made.length === 0 ? 1 : 0;
};

await run();
