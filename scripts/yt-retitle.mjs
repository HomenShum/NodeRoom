#!/usr/bin/env node
/**
 * yt-retitle.mjs — correct a published video's title/description over CDP.
 *
 * Re-uploading to fix a caption leaves a duplicate behind; editing in place is
 * the honest repair.
 *
 * THE DURATION IS DERIVED FROM THE FILE, NEVER TYPED. This script exists because
 * a title read "11s walkthrough" over a 24-second video, and the moment that was
 * fixed the sibling clip was found saying "8s" over 10.9s. A duration written by
 * hand is a claim that goes stale the next time the spec changes; ffprobe cannot.
 *
 * TWO THINGS THAT COST FOUR FAILED ATTEMPTS:
 *
 * 1. These are NOT the upload flow's selectors. The upload dialog uses
 *    #title-textarea #textbox; /edit uses a bare div#textbox distinguished only
 *    by aria-label. Guessing three times cost more than probing once.
 *
 * 2. Launch Chrome with --disable-extensions. A real profile loads ~13 extension
 *    service workers as CDP targets and connectOverCDP stalls attaching to them
 *    — the websocket connects, then times out. Cookies live in the profile, not
 *    the extensions, so the signed-in session survives:
 *
 *      chrome.exe --remote-debugging-port=9222
 *                 --user-data-dir="%LOCALAPPDATA%\Google\Chrome\User Data"
 *                 --disable-extensions about:blank
 *
 *   node scripts/yt-retitle.mjs <videoId> <NodeRoom|NodeSlide>
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const DIR = "C:/Users/hshum/Downloads/Interview items/brain/media/youtube";

const VIDEOS = {
  NodeRoom: {
    file: `${DIR}/WT-NodeRoom.mp4`,
    kind: "product walkthrough",
    base: "NodeRoom — review every agent change",
    coverage: "8 steps exercising 6 of the 21 interactive elements on this surface",
    body: [
      "NodeRoom is a shared workspace where people and NodeAgents work on the same files,",
      "spreadsheets and notes — and every agent edit stays reviewable and source-backed",
      "rather than applied behind your back.",
      "",
      "This clip runs the product's own drills, which call the same engine as a live room:",
      "",
      "1. The no-clobber test — a stale-baseline write comes back as { ok:false, reason:'conflict' }",
      "   instead of overwriting.",
      "2. Lease + draft-around-lock — an agent drafts around a locked cell and the engine",
      "   smart-merges on release, so the human never waits.",
      "3. Stale-write to review — the agent loses the race, and the engine opens a",
      "   semantic_rebase review proposal instead of clobbering the human.",
      "",
      "The last one ends the way the product is meant to: a person approves, and it",
      "re-applies at the CURRENT version rather than the stale baseline.",
    ],
  },
  NodeSlide: {
    file: `${DIR}/WT-NodeSlide.mp4`,
    kind: "walkthrough",
    base: "NodeSlide — decks that stay editable, built from a brief",
    coverage: "8 steps exercising 8 of the 91 interactive elements across the landing and the deck editor",
    body: [
      "NodeSlide turns an idea, a structured spec, or evidence into a reviewable deck —",
      "not a stack of static images. Route, tokens and cost are recorded in Trace, so you",
      "can see what produced each slide.",
      "",
      "In this clip: a brief is typed in, the sample workspace opens on a real deck, a",
      "slide element is selected to show the deck is a typed structure rather than a",
      "picture, and the inspector's Versions, Evidence and Trace tabs are opened in turn.",
      "",
      "Two details worth pausing on, both the product being honest about its own limits:",
      "Evidence says plainly that it checks citation attachment and disclosure but does",
      "NOT independently verify facts. Trace reports cost as 'not recorded' rather than",
      "printing a number it does not have.",
      "",
      "The coverage line below is deliberate. The deck editor alone carries 78 controls",
      "this clip never opens; a tour that skips them is fine, implying it didn't is not.",
    ],
  },
};

const [videoId, key] = process.argv.slice(2);
const spec = VIDEOS[key];
if (!videoId || !spec) {
  console.log(`usage: node scripts/yt-retitle.mjs <videoId> <${Object.keys(VIDEOS).join("|")}>`);
  process.exit(1);
}

const durationS = Math.round(
  parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", spec.file])
    .toString().trim()),
);
const TITLE = `${spec.base} (${durationS}s ${spec.kind})`;
const DESC = [
  ...spec.body,
  "",
  `Coverage, stated rather than implied: ${spec.coverage}.`,
  "",
  "Captured with FeatureClipStudio — Playwright capture, Remotion render, ffmpeg encode.",
  "",
  "github.com/HomenShum",
].join("\n");
console.log(`  ffprobe duration: ${durationS}s -> "${TITLE}"`);

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222", { timeout: 30_000 });
const page = await browser.contexts()[0].newPage();
await page.goto(`https://studio.youtube.com/video/${videoId}/edit`, { waitUntil: "domcontentloaded", timeout: 90_000 });

const title = page.locator('div#textbox[aria-label^="Add a title"]').first();
const desc = page.locator('div#textbox[aria-label^="Tell viewers"]').first();
await title.waitFor({ state: "visible", timeout: 60_000 });
console.log(`  before: ${(await title.textContent())?.trim()}`);

const retype = async (el, text) => {
  await el.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  await page.keyboard.insertText(text); // insertText, not type(): one event, no per-char latency
  await page.waitForTimeout(600);
};

await retype(title, TITLE);
if (await desc.count()) await retype(desc, DESC);

const save = page.locator("#save").first();
await save.waitFor({ state: "visible", timeout: 30_000 });
await save.click();
await page.waitForTimeout(8000);

// Verify from the reloaded page, not from the fact that a click did not throw.
await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
await title.waitFor({ state: "visible", timeout: 60_000 });
const after = (await title.textContent())?.trim();
console.log(`  after:  ${after}`);
console.log(after === TITLE ? "  SAVED — title matches" : "  MISMATCH — not saved");
await page.close();
await browser.close();
process.exitCode = after === TITLE ? 0 : 1;
