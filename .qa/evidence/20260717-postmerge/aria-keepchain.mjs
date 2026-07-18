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
    `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${(el.className || "").toString().slice(0, 50)}` +
    `${el.getAttribute("data-testid") ? "[testid=" + el.getAttribute("data-testid") + "]" : ""}` +
    `${el.getAttribute("aria-live") ? "[aria-live=" + el.getAttribute("aria-live") + "]" : ""}`;

  // Walk down from #root following unmarked children (the keep chain) to its terminus/termini.
  const terminals = [];
  const walk = (el, depth) => {
    if (depth > 25) return;
    const kids = [...el.children];
    const unmarked = kids.filter((k) => !k.hasAttribute("data-aria-hidden"));
    if (unmarked.length === 0) { terminals.push({ terminus: desc(el), reason: "no unmarked children", depth }); return; }
    for (const k of unmarked) walk(k, depth + 1);
  };
  const root = document.getElementById("root");
  walk(root, 0);

  const markedInsideRoot = root.querySelectorAll("[data-aria-hidden]").length;
  return { markedInsideRoot, terminalCount: terminals.length, terminals: terminals.slice(0, 12) };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
