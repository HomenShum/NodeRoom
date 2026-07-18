import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
const errors = [];
p.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 140)));
p.on("pageerror", (e) => errors.push("PAGEERR " + String(e).slice(0, 140)));
await p.goto(`http://127.0.0.1:5221/?demo=PK${Date.now().toString(36)}&name=Probe&confirmed=1`, { waitUntil: "domcontentloaded" });
await p.waitForTimeout(12000);
await p.screenshot({ path: ".qa/evidence/20260718-live-agent/peek2.png" });
console.log(JSON.stringify({
  url: await p.url(),
  testids: await p.evaluate(() => [...document.querySelectorAll("[data-testid]")].slice(0, 12).map((e) => e.getAttribute("data-testid"))),
  bodyHead: await p.evaluate(() => document.body.innerText.slice(0, 200)),
  errors: errors.slice(0, 5),
}, null, 1));
await b.close();
