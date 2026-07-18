import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 812 } });
await page.goto("http://127.0.0.1:5260/?mode=memory&surface=desktop", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1000);
const start = page.getByTestId("start-demo-room");
if (await start.count().catch(() => 0)) { await start.first().click(); await page.waitForTimeout(1500); }
const skip = page.getByTestId("tour-skip");
if (await skip.count().catch(() => 0)) { await skip.first().click().catch(() => {}); await page.waitForTimeout(500); }
await page.keyboard.press("Control+K");
await page.waitForTimeout(1200);
const lives = await page.evaluate(() =>
  [...document.getElementById("root").querySelectorAll("[aria-live]")].map((el) => ({
    el: `${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 40)}`,
    live: el.getAttribute("aria-live"),
    role: el.getAttribute("role"),
    testid: el.getAttribute("data-testid"),
    textPreview: el.textContent.trim().slice(0, 60),
    childCount: el.querySelectorAll("*").length,
  })),
);
console.log(JSON.stringify(lives, null, 1));
await browser.close();
