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

const info = await page.evaluate(() => {
  const attrs = (el) => Object.fromEntries([...el.attributes].map((a) => [a.name, a.value.slice(0, 60)]));
  return {
    paletteOpen: !!document.querySelector('[data-testid="command-palette"]'),
    bodyAttrs: attrs(document.body),
    bodyKids: [...document.body.children].map((c) => ({
      tag: c.tagName.toLowerCase(),
      id: c.id || null,
      attrs: attrs(c),
      containsRoot: c.id === "root",
    })),
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
