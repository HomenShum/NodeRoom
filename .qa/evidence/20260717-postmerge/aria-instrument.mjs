import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 812 } });

await page.addInitScript(() => {
  window.__ariaLog = [];
  const origSet = Element.prototype.setAttribute;
  const origRemove = Element.prototype.removeAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (name === "aria-hidden" && this.id === "root") {
      window.__ariaLog.push({ op: "set", value, stack: (new Error().stack || "").split("\n").slice(2, 6).join(" | ") });
    }
    return origSet.call(this, name, value);
  };
  Element.prototype.removeAttribute = function (name) {
    if (name === "aria-hidden" && this.id === "root") {
      window.__ariaLog.push({ op: "remove", stack: (new Error().stack || "").split("\n").slice(2, 6).join(" | ") });
    }
    return origRemove.call(this, name);
  };
});

await page.goto("http://127.0.0.1:5260/?mode=memory&surface=desktop", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1000);
const start = page.getByTestId("start-demo-room");
if (await start.count().catch(() => 0)) { await start.first().click(); await page.waitForTimeout(1500); }
const skip = page.getByTestId("tour-skip");
if (await skip.count().catch(() => 0)) { await skip.first().click().catch(() => {}); await page.waitForTimeout(500); }

const preOpen = await page.evaluate(() => window.__ariaLog.length);
await page.keyboard.press("Control+K");
await page.waitForTimeout(1200);

const log = await page.evaluate(() => ({
  entries: window.__ariaLog,
  rootAriaHidden: document.getElementById("root")?.getAttribute("aria-hidden") ?? null,
}));
console.log(JSON.stringify({ preOpenEvents: preOpen, ...log }, null, 1));
await browser.close();
