#!/usr/bin/env node
/**
 * capture-ui.mjs — drive the real apps in headless Chromium and write frames.
 *
 * WHY THIS EXISTS
 *
 * The browser-automation surface in the agent harness could screenshot but not
 * record: starting a GIF recording wedged the renderer every time, and the
 * screenshot tool's save-to-disk wrote nowhere findable. So visual evidence
 * existed only inside a chat transcript, which is not evidence anyone else can
 * check.
 *
 * Playwright is already a dependency of all three apps and Chromium is already
 * cached, so this drives the real browser directly and writes real files.
 *
 * Frames are written as PNGs and assembled into a GIF by assemble-gif.mjs.
 * Nothing here is simulated: if a page fails to load, the run FAILS rather than
 * emitting a frame that implies it rendered.
 *
 *   node capture-ui.mjs
 */

import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OUT = "C:/Users/hshum/Downloads/Interview items/brain/media/frames";

/** Each app: a name, a URL, and a selector that PROVES it actually rendered. */
const TARGETS = [
  {
    name: "noderoom",
    url: "http://localhost:5260/",
    proof: "text=Review every change",
    steps: [{ label: "landing" }, { label: "scrolled", scroll: 600 }],
  },
  {
    name: "nodeslide",
    url: "http://localhost:5180/",
    proof: "text=What presentation should we build",
    steps: [{ label: "composer" }, { label: "scrolled", scroll: 400 }],
  },
];

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const failures = [];
  const written = [];

  for (const t of TARGETS) {
    const page = await browser.newPage({ viewport: { width: 900, height: 620 } });
    try {
      await page.goto(t.url, { waitUntil: "networkidle", timeout: 30_000 });
      // A proof selector, not a timeout. A screenshot of a blank page is worse
      // than no screenshot: it looks like evidence and is not.
      await page.waitForSelector(t.proof, { timeout: 20_000 });

      for (const [i, step] of t.steps.entries()) {
        if (step.scroll) {
          await page.mouse.wheel(0, step.scroll);
          await page.waitForTimeout(700);
        }
        const file = path.join(OUT, `${t.name}-${String(i).padStart(2, "0")}-${step.label}.png`);
        await page.screenshot({ path: file });
        written.push(file);
        console.log(`  captured  ${path.basename(file)}`);
      }
    } catch (e) {
      failures.push(`${t.name}: ${e.message.split("\n")[0]}`);
      console.log(`  FAILED    ${t.name} - ${e.message.split("\n")[0]}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  console.log(`\n  ${written.length} frame(s) written to ${OUT}`);
  if (failures.length) {
    console.log(`  ${failures.length} target(s) FAILED - no frame was faked for them:`);
    for (const f of failures) console.log(`    ${f}`);
  }
  process.exitCode = written.length === 0 ? 1 : 0;
};

await run();
