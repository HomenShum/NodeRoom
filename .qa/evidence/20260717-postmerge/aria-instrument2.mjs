import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 812 } });

await page.addInitScript(() => {
  window.__markerLog = [];
  const origSet = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (name === "data-aria-hidden") {
      const desc = `${this.tagName.toLowerCase()}#${this.id || ""}.${(this.className || "").toString().slice(0, 30)}[slot=${this.getAttribute("data-slot") || ""}]`;
      window.__markerLog.push({
        el: desc,
        insideRoot: !!document.getElementById("root")?.contains(this),
        stack: (new Error().stack || "").split("\n").slice(2, 5).map(s => s.trim().slice(0, 90)),
      });
    }
    return origSet.call(this, name, value);
  };
});

await page.goto("http://127.0.0.1:5260/?mode=memory&surface=desktop", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1000);
const start = page.getByTestId("start-demo-room");
if (await start.count().catch(() => 0)) { await start.first().click(); await page.waitForTimeout(1500); }
const skip = page.getByTestId("tour-skip");
if (await skip.count().catch(() => 0)) { await skip.first().click().catch(() => {}); await page.waitForTimeout(500); }
await page.evaluate(() => { window.__markerLog.length = 0; });

await page.keyboard.press("Control+K");
await page.waitForTimeout(1200);

const log = await page.evaluate(() => window.__markerLog);
console.log(JSON.stringify(log, null, 1));
await browser.close();
