import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/noderoom/.qa/evidence/20260717-postmerge/before-after";
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:5260/?mode=memory&surface=desktop", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(600);

// Full hero with the new type scale
await page.locator(".r-land2-grid").first().screenshot({ path: `${OUT}/after-hero-rescaled.png` });

// Filmstrip: wait for specific frames via the data-frame attribute, shoot mid-animation
const shot = page.locator('[data-testid="landing-demo-loop"]');
for (const frame of ["lock", "cite", "commit", "smart-merge"]) {
  await page.waitForFunction(
    (f) => document.querySelector('[data-testid="landing-demo-loop"]')?.getAttribute("data-frame") === f,
    frame,
    { timeout: 15000 },
  );
  await page.waitForTimeout(260); // catch the settle, not the blank
  await shot.screenshot({ path: `${OUT}/after-signature-${frame}.png` });
  console.log(`frame ${frame} captured`);
}
await browser.close();
