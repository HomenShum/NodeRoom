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
  const desc = (el) =>
    `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}` +
    `${el.className ? "." + (el.className.toString().split(/\s+/).slice(0, 3).join(".")) : ""}` +
    `${el.getAttribute("data-testid") ? "[testid=" + el.getAttribute("data-testid") + "]" : ""}` +
    `${el.getAttribute("aria-live") ? "[LIVE=" + el.getAttribute("aria-live") + "]" : ""}` +
    `${el.getAttribute("role") ? "[role=" + el.getAttribute("role") + "]" : ""}`;

  const path = [];
  let node = document.getElementById("root");
  for (let i = 0; i < 30 && node; i++) {
    const kids = [...node.children];
    const marked = kids.filter((k) => k.hasAttribute("data-aria-hidden"));
    // continue into the unmarked child that still contains marked descendants
    const next = kids.find((k) => !k.hasAttribute("data-aria-hidden") && k.querySelector("[data-aria-hidden]"));
    path.push({
      at: desc(node),
      children: kids.length,
      markedSiblingsHere: marked.map(desc),
      unmarkedNoDescMark: kids.filter((k) => !k.hasAttribute("data-aria-hidden") && !k.querySelector("[data-aria-hidden]")).map(desc).slice(0, 8),
    });
    if (!next) break;
    node = next;
  }
  return path;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
