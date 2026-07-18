import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/noderoom/.qa/evidence/20260717-postmerge/before-after";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();

// 1) SSR shell header at 375px, JS disabled = true first paint
{
  const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:5260/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/after-ssr-mobile-header.png`, clip: { x: 0, y: 0, width: 375, height: 300 } });
  await ctx.close();
}

// 2) Landing trust chips (hydrated, desktop)
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:5260/?mode=memory&surface=desktop", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  const trust = page.locator(".r-land2-trust").first();
  await trust.waitFor({ state: "visible", timeout: 15000 });
  const box = await trust.boundingBox();
  if (box) {
    await page.screenshot({
      path: `${OUT}/after-trust-chips.png`,
      clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 20), width: Math.min(760, box.width + 48), height: box.height + 40 },
    });
  }
  await ctx.close();
}

// 3) Mobile recents cards (meta on its own row)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto("http://127.0.0.1:5260/#mobile?mode=memory", { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/after-mobile-recents.png`, clip: { x: 0, y: 90, width: 390, height: 560 } });
  await ctx.close();
}

await browser.close();
console.log("after shots captured");
