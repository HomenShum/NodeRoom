#!/usr/bin/env node
/** What is actually on Studio's /edit page? Selectors were guessed three times; measure instead. */
import { chromium } from "playwright";

const VIDEO = process.argv[2];
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30_000 });
const page = await browser.contexts()[0].newPage();
await page.goto(`https://studio.youtube.com/video/${VIDEO}/edit`, { waitUntil: "domcontentloaded", timeout: 90_000 });

// Settle: Studio hydrates late and the details form arrives after the shell.
for (let i = 0; i < 24; i++) {
  await page.waitForTimeout(1000);
  if (await page.locator("#textbox, textarea, input[type=text]").count()) break;
}

console.log(`url: ${page.url()}`);
console.log(`title: ${await page.title()}`);

const fields = await page.evaluate(() =>
  [...document.querySelectorAll('#textbox,[contenteditable="true"],textarea,input[type=text]')]
    .filter((e) => e.getBoundingClientRect().width > 0)
    .map((e) => ({
      tag: e.tagName.toLowerCase(),
      id: e.id || null,
      parentId: e.parentElement?.id || null,
      hostId: e.closest("[id]")?.id || null,
      aria: e.getAttribute("aria-label") || null,
      text: (e.innerText || e.value || "").trim().slice(0, 60),
    })));
console.log(`\neditable fields (${fields.length}):`);
fields.forEach((f) => console.log("  " + JSON.stringify(f)));

const buttons = await page.evaluate(() =>
  [...document.querySelectorAll("button,ytcp-button,[role=button]")]
    .filter((e) => e.getBoundingClientRect().width > 0)
    .map((e) => ({ id: e.id || null, label: (e.innerText || e.getAttribute("aria-label") || "").trim().slice(0, 24) }))
    .filter((x) => x.label || x.id)
    .slice(0, 20));
console.log(`\nbuttons:`);
buttons.forEach((b) => console.log("  " + JSON.stringify(b)));

await page.close();
await browser.close();
