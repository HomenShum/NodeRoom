import { chromium } from "@playwright/test";
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 768, height: 1024 } });
await p.goto("http://127.0.0.1:5260/?mode=memory&surface=desktop", { waitUntil: "networkidle", timeout: 60000 });
await p.waitForTimeout(1000);
const r = await p.evaluate(() => {
  const el = document.querySelector(".r-land2-trust");
  if (!el) return { found: false };
  const cs = getComputedStyle(el);
  const succ = getComputedStyle(document.documentElement).getPropertyValue("--success-ink").trim();
  return { found: true, color: cs.color, fontSize: cs.fontSize, gap: cs.gap, successInkToken: succ };
});
console.log(JSON.stringify(r)); await b.close();
