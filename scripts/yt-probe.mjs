#!/usr/bin/env node
/** What does the CDP-attached Chrome actually see? Facts, not theories. */
import { chromium } from "playwright";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 20_000 });
const ctx = browser.contexts()[0];
console.log(`contexts=${browser.contexts().length} pages=${ctx.pages().length}`);
for (const p of ctx.pages()) console.log(`  open: ${p.url()}`);

const page = await ctx.newPage();
await page.goto("https://www.youtube.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForTimeout(7000);
console.log(`youtube url:   ${page.url()}`);
console.log(`avatar btn:    ${await page.locator("#avatar-btn").count()}`);
console.log(`sign-in link:  ${await page.locator('a[href*="accounts.google.com"]').count()}`);
const cookies = await ctx.cookies("https://www.youtube.com");
console.log(`cookies for youtube.com: ${cookies.length}`);
console.log(`  names: ${cookies.slice(0, 12).map((c) => c.name).join(", ")}`);
await page.close();
// Do NOT browser.close() a connectOverCDP connection — Playwright closes the
// user's REAL Chrome and the debugging port dies with it.
