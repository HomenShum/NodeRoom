import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/noderoom/.qa/evidence/20260717-postmerge/before-after";
mkdirSync(OUT, { recursive: true });

const TARGETS = [
  { label: "before", base: "http://127.0.0.1:5291" },
  { label: "after", base: "http://127.0.0.1:5260" },
];

const browser = await chromium.launch();
for (const t of TARGETS) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();

  // 1) Landing hero incl. trust line — clipped to the hero block for a readable crop
  await page.goto(`${t.base}/?mode=memory&surface=desktop`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1200);
  const trust = page.locator(".r-land2-trust").first();
  await trust.waitFor({ state: "visible", timeout: 15000 });
  const hero = page.locator(".r-land2-grid").first();
  if (await hero.count()) {
    await hero.screenshot({ path: `${OUT}/${t.label}-landing-hero.png` });
  } else {
    await page.screenshot({ path: `${OUT}/${t.label}-landing-hero.png` });
  }
  // tight crop of the trust line itself with padding
  const box = await trust.boundingBox();
  if (box) {
    await page.screenshot({
      path: `${OUT}/${t.label}-trust-line.png`,
      clip: { x: Math.max(0, box.x - 24), y: Math.max(0, box.y - 20), width: Math.min(720, box.width + 48), height: box.height + 40 },
    });
  }

  // 2) Room chat composer placeholder
  const start = page.getByTestId("start-demo-room");
  if (await start.count()) { await start.first().click(); await page.waitForTimeout(1500); }
  const skip = page.getByTestId("tour-skip");
  if (await skip.count()) { await skip.first().click().catch(() => {}); await page.waitForTimeout(500); }
  const composer = page.locator('textarea[placeholder*="Message the room"], input[placeholder*="Message the room"]').first();
  await composer.waitFor({ state: "visible", timeout: 15000 });
  const cbox = await composer.boundingBox();
  if (cbox) {
    await page.screenshot({
      path: `${OUT}/${t.label}-composer.png`,
      clip: { x: Math.max(0, cbox.x - 16), y: Math.max(0, cbox.y - 16), width: Math.min(520, cbox.width + 32), height: cbox.height + 60 },
    });
  }
  await ctx.close();
  console.log(`[${t.label}] captured`);
}
await browser.close();
