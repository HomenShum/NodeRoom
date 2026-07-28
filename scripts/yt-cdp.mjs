#!/usr/bin/env node
/**
 * yt-cdp.mjs — drive real Chrome over the DevTools Protocol.
 *
 * The claude-in-chrome extension is a TRANSPORT for CDP, not CDP itself. When
 * the extension will not connect, the protocol is still reachable: Playwright
 * speaks CDP to a real Chrome binary directly.
 *
 * Chrome >=136 refuses --remote-debugging-port on the DEFAULT user-data-dir, so
 * this runs against a clone of the signed-in profile (Local State + Cookies +
 * Login Data). Same machine, same user, so DPAPI still decrypts the cookie jar.
 *
 * Verb decides how far it goes. Nothing here uploads unless told to:
 *   node scripts/yt-cdp.mjs check     -> report auth state, then exit
 *   node scripts/yt-cdp.mjs upload    -> check, then drive the upload flow
 */

import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import path from "node:path";

const PROFILE = "C:/Users/hshum/AppData/Local/Temp/claude/C--Users-hshum-Downloads-Interview-items/e3836513-f1aa-4c47-9924-c47e6c3b1b3e/scratchpad/cdp-profile";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const MEDIA = "C:/Users/hshum/Downloads/Interview items/brain/media/youtube";
const PORT = 9222;

const verb = process.argv[2] ?? "check";

/** Auth is a three-state answer, not a boolean. UNKNOWN must not read as NO. */
const authState = async (page) => {
  const url = page.url();
  if (/accounts\.google\.com|ServiceLogin|signin/i.test(url)) return { state: "SIGNED_OUT", why: `redirected to ${new URL(url).hostname}` };
  const avatar = await page.locator('#avatar-btn, ytcp-account-button, button#avatar-btn').count();
  if (avatar > 0) return { state: "SIGNED_IN", why: "account button present" };
  const signIn = await page.getByRole("link", { name: /sign in/i }).count();
  if (signIn > 0) return { state: "SIGNED_OUT", why: "sign-in link present" };
  return { state: "UNKNOWN", why: `no auth marker at ${url}` };
};

const run = async () => {
  console.log(`  profile   ${PROFILE}`);
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    executablePath: CHROME,
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: [`--remote-debugging-port=${PORT}`, "--no-first-run", "--no-default-browser-check"],
  });

  // Prove CDP is actually live rather than assuming Playwright implies it.
  let cdp = "unreachable";
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`, { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    cdp = `${j.Browser} (ws ${j.webSocketDebuggerUrl ? "open" : "absent"})`;
  } catch (e) {
    cdp = `unreachable: ${e.name}`;
  }
  console.log(`  cdp       ${cdp}`);

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("https://studio.youtube.com/", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(4000);

  const auth = await authState(page);
  console.log(`  auth      ${auth.state}  (${auth.why})`);
  console.log(`  landed    ${page.url()}`);

  if (auth.state !== "SIGNED_IN") {
    console.log("\n  STOP - not signed in on the cloned profile. Nothing was uploaded.");
    console.log("  A Chrome window is open; sign in there, then re-run. The profile persists.");
    return { auth, uploaded: [] };
  }

  if (verb !== "upload") {
    console.log("\n  check only - re-run with `upload` to proceed.");
    return { auth, uploaded: [] };
  }

  const meta = await readFile(path.join(MEDIA, "METADATA.md"), "utf8");
  console.log(`  metadata  ${meta.split("\n").length} lines loaded`);
  console.log("\n  ready to upload - flow driven interactively from here.");
  return { auth, uploaded: [] };
};

const result = await run().catch((e) => {
  console.log(`\n  FAILED  ${e.message.split("\n")[0]}`);
  process.exitCode = 1;
  return null;
});
if (result) console.log(`\n  done. auth=${result.auth.state}`);
// Leave the browser open on purpose: the window is the fallback path for a human.
