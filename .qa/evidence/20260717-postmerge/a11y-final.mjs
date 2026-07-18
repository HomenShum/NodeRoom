import { chromium } from "@playwright/test";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 812 } });
await page.goto("http://127.0.0.1:5260/?mode=memory&surface=desktop", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1000);
const start = page.getByTestId("start-demo-room");
if (await start.count().catch(() => 0)) { await start.first().click(); await page.waitForTimeout(1500); }
const skip = page.getByTestId("tour-skip");
if (await skip.count().catch(() => 0)) { await skip.first().click().catch(() => {}); await page.waitForTimeout(500); }
const closed = (await page.locator("body").ariaSnapshot()).split("\n").filter((l) => l.trim()).length;
await page.keyboard.press("Control+K");
await page.waitForTimeout(1200);
const openLines = (await page.locator("body").ariaSnapshot()).split("\n").filter((l) => l.trim());
const bg = openLines.filter((l) => /people panel|binder|Pinned|invite|status-strip|Homen 9:|Copy message/i.test(l)).length;
console.log(JSON.stringify({ closedLines: closed, openLines: openLines.length, backgroundLeakLines: bg, sample: openLines.slice(0, 10) }, null, 1));
await browser.close();
