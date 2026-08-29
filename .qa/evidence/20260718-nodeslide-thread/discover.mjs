import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT = "D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/noderoom/.qa/evidence/20260718-nodeslide-thread";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 120)));
page.on("pageerror", (e) => errors.push("PAGEERR " + String(e).slice(0, 120)));

await page.goto("http://127.0.0.1:4184/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/00-boot.png` });

const state = await page.evaluate(() => ({
  url: location.href,
  title: document.title,
  testids: [...document.querySelectorAll("[data-testid]")].slice(0, 25).map((e) => e.getAttribute("data-testid")),
  buttons: [...document.querySelectorAll("button")].slice(0, 20).map((b) => b.textContent?.trim().slice(0, 30)).filter(Boolean),
  bodyHead: document.body.innerText.slice(0, 250),
}));
console.log(JSON.stringify({ ...state, consoleErrors: errors.slice(0, 5) }, null, 1));
await browser.close();
