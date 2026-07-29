#!/usr/bin/env node
/**
 * yt-cdp-attach.mjs — attach to an ALREADY-RUNNING Chrome over CDP.
 *
 * chromium.connectOverCDP is the honest version of "use chrome cdp": it does not
 * launch anything, it speaks the DevTools Protocol to a browser that is already
 * there, holding the real signed-in session.
 *
 * Writes its report to a FILE rather than stdout, because a piped stdout can
 * buffer and an empty pipe looks exactly like a hung script.
 */

import { chromium } from "playwright";
import { writeFile } from "node:fs/promises";

const PORT = 9222;
const REPORT = "C:/Users/hshum/AppData/Local/Temp/claude/C--Users-hshum-Downloads-Interview-items/e3836513-f1aa-4c47-9924-c47e6c3b1b3e/scratchpad/cdp-report.txt";

const lines = [];
const say = (s) => { lines.push(s); };

/** Three-state. UNKNOWN must never be reported as SIGNED_OUT. */
const authState = async (page) => {
  const url = page.url();
  if (/accounts\.google\.com|ServiceLogin|\/signin/i.test(url)) {
    return { state: "SIGNED_OUT", why: `redirected to ${new URL(url).hostname}` };
  }
  const avatar = await page.locator("#avatar-btn, ytcp-account-button").count();
  if (avatar > 0) return { state: "SIGNED_IN", why: "account button present" };
  const signIn = await page.getByRole("link", { name: /^sign in$/i }).count();
  if (signIn > 0) return { state: "SIGNED_OUT", why: "sign-in link present" };
  return { state: "UNKNOWN", why: `no auth marker at ${url}` };
};

const run = async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 15_000 });
  say(`attached   ${browser.version?.() ?? "chrome"} over CDP :${PORT}`);

  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error("CDP attached but no browser context exists");
  say(`contexts   ${browser.contexts().length}, pages ${ctx.pages().length}`);

  const page = ctx.pages().find((p) => /youtube/.test(p.url())) ?? ctx.pages()[0] ?? (await ctx.newPage());
  if (!/studio\.youtube/.test(page.url())) {
    await page.goto("https://studio.youtube.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
  }
  await page.waitForTimeout(5000);

  const auth = await authState(page);
  say(`url        ${page.url()}`);
  say(`title      ${await page.title()}`);
  say(`auth       ${auth.state}  (${auth.why})`);

  if (auth.state === "SIGNED_IN") {
    const create = await page.locator("#create-icon, ytcp-button#create-icon").count();
    say(`create-btn ${create > 0 ? "present" : "NOT FOUND"}`);
  }

  // Do NOT browser.close() a connectOverCDP connection — it kills the real Chrome. // detaches CDP; does NOT kill the Chrome window
  return auth;
};

let auth = { state: "UNKNOWN", why: "run did not complete" };
try {
  auth = await run();
} catch (e) {
  say(`FAILED     ${e.message.split("\n")[0]}`);
}
say(`RESULT     ${auth.state}`);
await writeFile(REPORT, lines.join("\n") + "\n", "utf8");
console.log(lines.join("\n"));
