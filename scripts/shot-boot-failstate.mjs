#!/usr/bin/env node
/** Screenshot the boot shell in both states, side by side as evidence. */
import { chromium } from "playwright";

const OUT = "C:/Users/hshum/Downloads/Interview items/brain/media/proof";
const ROUTE = "http://localhost:5260/?demo=1";
const APP_CHUNK = /\/src\/app\/main|assets\/main-.*\.js/;

const shot = async (browser, { file, blockChunk, waitMs }) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  if (blockChunk) await page.route(APP_CHUNK, (r) => r.abort("failed"));
  await page.goto(ROUTE, { waitUntil: "commit", timeout: 60_000 });
  await page.locator(".nr-ssr-private").waitFor({ state: "attached", timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(waitMs);
  // The shell is GONE once React mounts — that is the happy path, not an error.
  const shell = page.locator(".nr-ssr-private");
  const state = (await shell.count()) ? await shell.getAttribute("data-boot-state") : "shell-removed (React mounted)";
  await page.screenshot({ path: `${OUT}/${file}`, animations: "disabled" });
  await ctx.close();
  console.log(`  ${file}  state=${state}`);
};

const browser = await chromium.launch();
await shot(browser, { file: "boot-loading.png", blockChunk: false, waitMs: 2500 });
await shot(browser, { file: "boot-failed.png", blockChunk: true, waitMs: 5000 });
await browser.close();
