#!/usr/bin/env node
/** Why will #save not click after choosing Private? Measure, do not guess. */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30_000 });
const page = await browser.contexts()[0].newPage();
await page.goto("https://studio.youtube.com/video/YUpSMEkkK4Q/edit", { waitUntil: "domcontentloaded", timeout: 90_000 });
await page.locator("#visibility-text").first().waitFor({ timeout: 60_000 });
await page.waitForTimeout(2000);
await page.locator("#visibility-text").first().click({ timeout: 15_000 });
await page.waitForTimeout(2500);
await page.locator('tp-yt-paper-radio-button[name="PRIVATE"]').first().click({ timeout: 15_000 });
await page.waitForTimeout(2000);

const info = await page.evaluate(() => {
  const el = document.querySelector("#save");
  if (!el) return { save: "absent" };
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  const buttons = [...document.querySelectorAll("ytcp-button, button")]
    .filter((e) => e.getBoundingClientRect().width > 0 && /done|save|apply|publish/i.test(e.innerText || ""))
    .map((e) => ({ id: e.id || null, text: (e.innerText || "").trim().slice(0, 18), disabled: e.hasAttribute("disabled") }));
  return {
    save: { w: Math.round(r.width), h: Math.round(r.height), disabled: el.hasAttribute("disabled"), aria: el.getAttribute("aria-disabled") },
    coveredBy: top ? `${top.tagName.toLowerCase()}#${top.id || ""}` : null,
    buttons,
  };
});
console.log(JSON.stringify(info, null, 1));
await page.close();
// Do NOT browser.close() a connectOverCDP connection — Playwright closes the
// user's REAL Chrome and the debugging port dies with it.
