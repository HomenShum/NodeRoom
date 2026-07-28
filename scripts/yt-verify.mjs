#!/usr/bin/env node
/**
 * yt-verify.mjs — confirm the uploads exist on YouTube, from the live page.
 *
 * A script that printed "DONE" is not evidence. This loads each watch URL and
 * the Studio content list and reports what the DOM actually says.
 */
import { chromium } from "playwright";

const TARGETS = [
  { key: "NodeRoom", url: "https://youtu.be/YUpSMEkkK4Q", expect: "review every agent change" },
  { key: "NodeSlide", url: "https://youtu.be/q1CL1hCO_0Q", expect: "decks that stay editable" },
];

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 20_000 });
const ctx = browser.contexts()[0];
let bad = 0;

for (const t of TARGETS) {
  const page = await ctx.newPage();
  await page.goto(t.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(6000);
  const title = (await page.title()) ?? "";
  const h1 = (await page.locator("h1 yt-formatted-string, h1").first().textContent().catch(() => "")) ?? "";
  const player = await page.locator("video").count();
  const ok = new RegExp(t.expect, "i").test(title + " " + h1) && player > 0;
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${t.key}`);
  console.log(`      url    ${page.url()}`);
  console.log(`      title  ${title.replace(/ - YouTube$/, "")}`);
  console.log(`      <video> elements: ${player}`);
  await page.close();
}

// Cross-check visibility from Studio, where "Unlisted" is stated explicitly.
const s = await ctx.newPage();
await s.goto("https://studio.youtube.com/channel/UCTsBmSJ6a2_IwP9f-svxR3Q/videos/upload", {
  waitUntil: "domcontentloaded",
  timeout: 60_000,
});
await s.waitForTimeout(8000);
const rows = await s.evaluate(() =>
  [...document.querySelectorAll("ytcp-video-row")].slice(0, 4).map((r) => {
    const txt = (sel) => r.querySelector(sel)?.textContent?.trim() ?? "";
    return {
      title: txt("#video-title") || txt("h3"),
      visibility: txt("#visibility-text") || txt('[id*="visibility"]'),
    };
  }),
);
console.log("\nStudio content list (top 4):");
for (const r of rows) console.log(`  ${(r.visibility || "?").padEnd(10)} ${r.title.slice(0, 72)}`);

await s.close();
await browser.close();
process.exitCode = bad === 0 ? 0 : 1;
