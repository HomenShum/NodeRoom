#!/usr/bin/env node
/**
 * yt-privatize.mjs — set superseded videos to Private over CDP.
 *
 * DELIBERATELY NOT A DELETE. Private hides a video from everyone including
 * link-holders and is reversible; deletion is not, and YouTube's trash is not a
 * real undo. If these should truly go, that is a human's click.
 *
 * THE GUARD IS THE POINT. Two superseded videos share a title prefix with a
 * KEEPER ("NodeRoom — review every agent change ..."), so any title-matching
 * approach would eventually hide the wrong one. This script targets video IDs
 * only, and refuses outright if an ID appears on the keeper list — a check that
 * can fail, on purpose.
 *
 *   node scripts/yt-privatize.mjs <videoId> [videoId...]
 */
import { chromium } from "playwright";
// The keeper allowlist is imported, never re-typed here: a second copy of the
// roster is a second thing to forget to update, and this one is load-bearing —
// it is the only thing standing between a typo'd id and a hidden keeper.
import { KEEPERS } from "./yt-roster.mjs";

const ids = process.argv.slice(2);
if (!ids.length) {
  console.log("usage: node scripts/yt-privatize.mjs <videoId> [videoId...]");
  process.exit(1);
}
const collisions = ids.filter((id) => KEEPERS.has(id));
if (collisions.length) {
  console.log(`REFUSED — these are keepers, not superseded: ${collisions.join(", ")}`);
  process.exit(1);
}

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30_000 });
const ctx = browser.contexts()[0];
let failed = 0;

for (const id of ids) {
  const page = await ctx.newPage();
  try {
    await page.goto(`https://studio.youtube.com/video/${id}/edit`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    const before = page.locator("#visibility-text").first();
    await before.waitFor({ state: "visible", timeout: 60_000 });
    const wasVisibility = (await before.textContent())?.trim();
    const title = (await page.locator('div#textbox[aria-label^="Add a title"]').first().textContent())?.trim();
    console.log(`\n${id}  "${title}"\n  visibility before: ${wasVisibility}`);

    if (wasVisibility === "Private") { console.log("  already Private — nothing to do"); await page.close(); continue; }

    // Click #visibility-text SPECIFICALLY. A compound selector starting with
    // ytcp-video-metadata-visibility resolves to a wrapper that swallows the
    // click and times out. The panel that opens is inline, not a role=dialog —
    // so there is nothing to wait for except the radio itself.
    await page.waitForTimeout(1500);
    await page.locator("#visibility-text").first().click({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    const privateRadio = page.locator('tp-yt-paper-radio-button[name="PRIVATE"]').first();
    await privateRadio.waitFor({ state: "visible", timeout: 20_000 });
    await privateRadio.click();
    await page.waitForTimeout(1200);

    // The visibility panel's confirm button is #save-button and it is labelled
    // "Done" — not #done-button, which does not exist here. Until it is clicked
    // the page-level #save stays DISABLED, so clicking #save first silently
    // waits forever on an element that will never become actionable.
    const confirm = page.locator("#save-button").first();
    await confirm.waitFor({ state: "visible", timeout: 20_000 });
    await confirm.click({ timeout: 20_000 });
    await page.waitForTimeout(2500);

    const save = page.locator("#save").first();
    await save.waitFor({ state: "visible", timeout: 20_000 });
    await save.click({ timeout: 30_000 });
    await page.waitForTimeout(6000);

    // Verify from a reloaded page, not from the fact that clicks did not throw.
    await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    const after = page.locator("#visibility-text").first();
    await after.waitFor({ state: "visible", timeout: 60_000 });
    const now = (await after.textContent())?.trim();
    console.log(`  visibility after:  ${now}`);
    if (now !== "Private") { failed++; console.log("  MISMATCH — not applied"); }
  } catch (e) {
    failed++;
    console.log(`  FAILED ${e.message.split("\n")[0].slice(0, 120)}`);
  }
  await page.close();
}

// NEVER browser.close() on a connectOverCDP connection: Playwright closes the
// REAL Chrome, taking the user's signed-in windows with it. That is why the CDP
// port kept dying after every script all session and needed relaunching — the
// scripts were killing the browser they depend on. Just let the process exit;
// the CDP socket drops and Chrome keeps running.
console.log(`\n${failed === 0 ? "all targets are Private" : failed + " target(s) failed"}`);
process.exitCode = failed === 0 ? 0 : 1;
