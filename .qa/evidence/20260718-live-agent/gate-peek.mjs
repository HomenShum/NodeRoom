import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
await p.goto(`http://127.0.0.1:5221/?demo=PEEK${Date.now().toString(36)}&name=Probe`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(8000);
await p.screenshot({ path: ".qa/evidence/20260718-live-agent/gate-peek.png" });
const state = await p.evaluate(() => ({
  url: location.href,
  gate: document.querySelector('[data-testid*="account"], [data-testid*="gate"], [data-testid*="sign"]')?.getAttribute("data-testid") ?? null,
  bodyText: document.body.innerText.slice(0, 300),
}));
console.log(JSON.stringify(state, null, 1));
await b.close();
