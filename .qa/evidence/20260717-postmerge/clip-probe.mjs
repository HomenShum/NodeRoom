import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 812 } });
await page.goto("http://127.0.0.1:5260/?mode=memory&surface=desktop", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(1000);
const start = page.getByTestId("start-demo-room");
if (await start.count().catch(() => 0)) { await start.first().click(); await page.waitForTimeout(1500); }
const skip = page.getByTestId("tour-skip");
if (await skip.count().catch(() => 0)) { await skip.first().click().catch(() => {}); await page.waitForTimeout(500); }

const result = await page.evaluate(() => {
  const out = {};
  // 1. Tab labels: find any tab whose text is visually clipped (scrollWidth > clientWidth)
  const tabs = [...document.querySelectorAll('[data-testid="artifact-tabs"] button, [data-testid="artifact-tabs"] [role="tab"]')];
  out.tabs = tabs.map((t) => {
    const clipped = [...t.querySelectorAll("*"), t].some((el) => el.scrollWidth > el.clientWidth + 1);
    return { text: t.textContent.trim().slice(0, 30), clipped };
  });
  // 2. Composer placeholder
  const inputs = [...document.querySelectorAll("textarea[placeholder], input[placeholder]")]
    .filter((i) => /message the room/i.test(i.placeholder));
  out.composer = inputs.map((i) => {
    const cs = getComputedStyle(i);
    // measure placeholder text width vs input width
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    const textW = ctx.measureText(i.placeholder).width;
    const boxW = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return { placeholder: i.placeholder, textWidthPx: Math.round(textW), boxWidthPx: Math.round(boxW), clipped: textW > boxW };
  });
  // 3. Binder duplicate entries
  const binderLabels = [...document.querySelectorAll('[class*="binder"] button, aside button')]
    .map((b) => b.textContent.trim()).filter((t) => t && t.length < 40);
  const counts = {};
  for (const l of binderLabels) counts[l] = (counts[l] || 0) + 1;
  out.duplicates = Object.entries(counts).filter(([, n]) => n > 1).map(([l, n]) => ({ label: l, count: n }));
  return out;
});
console.log(JSON.stringify(result, null, 1));
await browser.close();
