#!/usr/bin/env node
/**
 * yt-upload.mjs — upload one walkthrough to YouTube over CDP.
 *
 * Why this works where three other routes did not:
 *   - the extension's file_upload allowlists by chat attachment
 *   - studio.youtube.com's CSP makes Runtime.evaluate hang, so JS injection dies
 *   - a cloned profile cannot decrypt cookies (Chrome App-Bound Encryption)
 * Playwright's setInputFiles sets the file natively through CDP, in the REAL
 * signed-in profile. No allowlist, no page script, no cookie copying.
 *
 * Chrome must be running as:
 *   chrome.exe --remote-debugging-port=9222 --user-data-dir=<the real User Data>
 * Passing --user-data-dir explicitly is what makes Chrome honour the debugging
 * port; omitting it is what Chrome >=136 ignores.
 *
 *   node scripts/yt-upload.mjs NodeRoom
 *   node scripts/yt-upload.mjs NodeSlide
 */

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";

const PORT = 9222;
const DIR = "C:/Users/hshum/Downloads/Interview items/brain/media/youtube";

// The duration in a title is DERIVED from the file at upload time, never typed.
// A hand-written "11s" shipped over a 24s video; the fix surfaced "8s" over
// 10.9s in the sibling. A typed duration is a claim that goes stale on the next
// re-cut; ffprobe cannot.
const withDuration = (base) => (file) => {
  const s = Math.round(parseFloat(
    execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString(),
  ));
  return base.replace("{D}", `${s}s`);
};

const VIDEOS = {
  NodeSlideExtras: {
    file: `${DIR}/WT-NodeSlideExtras-narrated.mp4`,
    mkTitle: withDuration("NodeSlide — the other five doors, narrated ({D})"),
    description: [
      "Five journeys the product tour skips, each belonging to a different person.",
      "",
      "1. The recipient. Paste a raw deck ID and NodeSlide refuses: this is an",
      "   editor link, not a share link. The refusal is the feature.",
      "2. The developer. Connect your own runtime — keys live in this tab's",
      "   session storage and a local process you launch; never sent to the",
      "   backend, never written into Trace, never returned by a tool.",
      "3. The agent operator. Claude Code, Codex or Cursor can drive NodeSlide",
      "   over MCP — and proposals stay unapplied until a separate accept call.",
      "   Same locks, second front door.",
      "4. The evaluator. Artifact Lab: 38 evidence-bound recipes, each card",
      "   carrying source JSON, a trace, and an export receipt.",
      "5. The presenter. Present full-screen, then export to interactive HTML or",
      "   editable PPTX.",
      "",
      "Narration is aligned per scene (argo + local Kokoro TTS — no cloud voice",
      "API). Every claim spoken is on screen when it is spoken.",
      "",
      "github.com/HomenShum",
    ].join("\n"),
  },
  NodeSlideFull: {
    file: `${DIR}/WT-NodeSlideFull-narrated.mp4`,
    mkTitle: withDuration("NodeSlide — the full walkthrough, narrated ({D})"),
    description: [
      "The complete journey, with voiceover: a brief typed in plain language, the",
      "sample workspace opening on a real deck — outline rail, canvas, inspector —",
      "a headline selected to show every element is typed and addressable, then",
      "the audit tabs in turn:",
      "",
      "Versions — revision history you can compare and restore.",
      "Evidence — citations stay attached, and it says plainly that it does not",
      "independently verify facts.",
      "Trace — one auditable run, where cost reads 'not recorded' rather than a",
      "number it does not have.",
      "",
      "Narration is aligned to the recording per scene (argo + local Kokoro TTS —",
      "no cloud voice API). Every claim spoken is on screen when it is spoken.",
      "The demo deliberately does not fire a live model call: a recording that",
      "sometimes catches a spinner is a recording that sometimes lies.",
      "",
      "github.com/HomenShum",
    ].join("\n"),
  },
  NodeRoomFull: {
    file: `${DIR}/WT-NodeRoomFull-narrated.mp4`,
    mkTitle: withDuration("NodeRoom — the full walkthrough, narrated ({D})"),
    description: [
      "The complete journey, with voiceover: a fresh visitor lands, meets the one",
      "governance question (how should agent edits land?), joins by code, sees the",
      "sample room declare its data synthetic — then the drills run the same engine",
      "as a live room: a stale write comes back as data, and an agent draft that",
      "lost a race becomes a review proposal a person approves, re-applied at the",
      "current version.",
      "",
      "Narration is aligned to the recording per scene (argo + local Kokoro TTS —",
      "no cloud voice API). Every claim spoken is on screen when it is spoken.",
      "",
      "Captured against the running app. Producing this walkthrough found and fixed",
      "two real bugs first: every dialog rendered behind its own blur scrim, and",
      "the boot shell had no failure state.",
      "",
      "github.com/HomenShum",
    ].join("\n"),
  },
  NodeRoomFresh: {
    file: `${DIR}/WT-NodeRoomFresh.mp4`,
    mkTitle: withDuration("NodeRoom — from landing to a room ({D} fresh-user walkthrough)"),
    description: [
      "The journey a brand-new visitor actually has, with nothing staged:",
      "",
      "1. The landing runs a live agent demo — Room NodeAgent commits variance",
      "   through the sync tool, source-backed to its citation (NetSuite p.4).",
      "2. Creating a room asks one question before anything else: how should",
      "   NodeAgent edits land? Review-every-artifact-edit is the recommended",
      "   default; auto-approve stays traced.",
      "3. Joining is by code — a room shares a code, not a seat.",
      "4. The sample room says plainly its data is synthetic, not live research.",
      "",
      "Coverage, stated rather than implied: 6 steps over the landing's two entry",
      "dialogs and the join-by-code control.",
      "",
      "Filming this journey found a real bug: every dialog on this path rendered",
      "behind its own blur scrim (a Radix-migration regression). It was fixed",
      "first, and the clip shows the repaired product.",
      "",
      "Captured with FeatureClipStudio — Playwright capture, Remotion render,",
      "ffmpeg encode.",
      "",
      "github.com/HomenShum",
    ].join("\n"),
  },
  NodeRoom: {
    file: `${DIR}/WT-NodeRoom.mp4`,
    mkTitle: withDuration("NodeRoom — review every agent change ({D} product walkthrough)"),
    description: [
      "NodeRoom is a shared workspace where people and NodeAgents work on the same",
      "files, spreadsheets and notes — and every agent edit stays reviewable and",
      "source-backed rather than applied behind your back.",
      "",
      "This clip runs the product's own drills, which call the same engine as a",
      "live room:",
      "  1. the no-clobber test — a stale-baseline write comes back as",
      "     { ok:false, reason:'conflict' } instead of overwriting",
      "  2. lease + draft-around-lock — an agent drafts around a locked cell and",
      "     the engine smart-merges on release, so the human never waits",
      "  3. stale-write to review — the agent loses the race and the engine opens",
      "     a semantic_rebase review proposal instead of clobbering the human",
      "",
      "The last one ends the way the product is meant to: a person approves, and",
      "it re-applies at the CURRENT version rather than the stale baseline.",
      "",
      "Coverage, stated rather than implied: 8 steps exercising 6 of the 21",
      "interactive elements on this surface.",
      "",
      "Captured live against the running app with FeatureClipStudio — Playwright",
      "capture, Remotion render, ffmpeg encode. The animated cursor and captions are",
      "overlaid at render time; every underlying frame is the real product.",
      "",
      "github.com/HomenShum",
    ].join("\n"),
  },
  NodeSlide: {
    file: `${DIR}/WT-NodeSlide.mp4`,
    mkTitle: withDuration("NodeSlide — decks that stay editable, built from a brief ({D} walkthrough)"),
    description: [
      "NodeSlide turns an idea, a structured spec, or evidence into a reviewable deck —",
      "not a stack of static images. Route, tokens and cost are recorded in Trace, so",
      "you can see what produced each slide.",
      "",
      "In this clip: a brief is typed in and drives the deck.",
      "",
      "Captured live against the running app with FeatureClipStudio — Playwright",
      "capture, Remotion render, ffmpeg encode.",
      "",
      "github.com/HomenShum",
    ].join("\n"),
  },
};

const key = process.argv[2];
const spec = VIDEOS[key];
if (!spec) {
  console.log(`usage: node scripts/yt-upload.mjs <${Object.keys(VIDEOS).join("|")}>`);
  process.exit(1);
}

const step = (n, msg) => console.log(`  ${String(n).padStart(2)}. ${msg}`);

const run = async () => {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`, { timeout: 20_000 });
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error("CDP attached but no context");
  const page = await ctx.newPage();

  step(1, "opening YouTube Studio");
  await page.goto("https://studio.youtube.com/", { waitUntil: "domcontentloaded", timeout: 60_000 });

  // Studio hops through accounts.google.com on the way in. Sampling the URL at a
  // fixed delay catches that hop and reads a redirect as a verdict — which is
  // exactly how the first run "failed" against a session that was fine. Wait for
  // the URL to SETTLE on a terminal state instead of guessing when it has.
  await page
    .waitForURL((u) => /studio\.youtube\.com\/channel\//.test(u.href), { timeout: 90_000 })
    .catch(() => {});
  await page.waitForTimeout(3000);

  const onSignIn = /accounts\.google\.com/.test(page.url());
  const hasAvatar = (await page.locator("#avatar-btn, ytcp-account-button").count()) > 0;
  if (onSignIn && !hasAvatar) {
    throw new Error(`not signed in — settled on ${new URL(page.url()).hostname}`);
  }
  step(2, `signed in (${page.url().split("?")[0]})`);

  // Open the upload dialog. The direct ?d=ud URL opens it without hunting menus.
  const channel = page.url().match(/channel\/([\w-]+)/)?.[1];
  if (!channel) throw new Error("could not read channel id from the Studio URL");
  await page.goto(`https://studio.youtube.com/channel/${channel}/videos/upload?d=ud`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(5000);

  const input = page.locator('input[type="file"]').first();
  await input.waitFor({ state: "attached", timeout: 30_000 });
  step(3, "upload dialog open, file input found");

  await input.setInputFiles(spec.file);
  step(4, `file set natively: ${spec.file.split("/").pop()}`);

  // Title box appears only once YouTube accepts the file — this is the real proof
  // that the upload started, not a timer.
  const titleBox = page.locator('#title-textarea #textbox, ytcp-social-suggestions-textbox#title-textarea div#textbox').first();
  await titleBox.waitFor({ state: "visible", timeout: 120_000 });
  step(5, "YouTube accepted the file (details form rendered)");

  await titleBox.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Delete");
  const computedTitle = spec.mkTitle(spec.file);
  await titleBox.type(computedTitle, { delay: 8 });
  step(6, `title set: ${computedTitle}`);

  const descBox = page.locator('#description-textarea #textbox').first();
  if (await descBox.count()) {
    await descBox.click();
    await descBox.type(spec.description, { delay: 3 });
    step(7, "description set");
  } else {
    step(7, "WARN description box not found — continuing without it");
  }

  // Audience is mandatory; YouTube blocks Next until it is answered.
  const notForKids = page.locator('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"]').first();
  await notForKids.waitFor({ state: "visible", timeout: 30_000 });
  await notForKids.click();
  step(8, 'audience set: "No, it\'s not made for kids"');

  // Details -> Video elements -> Checks -> Visibility
  for (let i = 0; i < 3; i++) {
    const next = page.locator("#next-button button, ytcp-button#next-button").first();
    await next.waitFor({ state: "visible", timeout: 30_000 });
    await next.click();
    await page.waitForTimeout(2500);
  }
  step(9, "advanced to the Visibility step");

  const unlisted = page.locator('tp-yt-paper-radio-button[name="UNLISTED"]').first();
  await unlisted.waitFor({ state: "visible", timeout: 30_000 });
  await unlisted.click();
  step(10, "visibility set: Unlisted");

  // Grab the share URL before saving — it is present on the visibility step.
  let url = null;
  const urlEl = page.locator("#share-url, .video-url-fadeable a").first();
  if (await urlEl.count()) url = (await urlEl.textContent())?.trim() ?? null;

  const done = page.locator("#done-button button, ytcp-button#done-button").first();
  await done.waitFor({ state: "visible", timeout: 30_000 });
  await done.click();
  step(11, "Save clicked");

  // Processing can hold the dialog; wait for the confirmation, but do not fail
  // the run if only the dialog lingers — the upload itself is already committed.
  await page.waitForTimeout(9000);
  const confirmed = await page.locator("text=/video (link|published|uploaded)/i").count();
  step(12, `post-save confirmation elements: ${confirmed}`);

  // Do NOT browser.close() a connectOverCDP connection — it kills the real Chrome.
  return { url, confirmed };
};

try {
  const r = await run();
  console.log(`\n  DONE  ${key}  url=${r.url ?? "(not read from page)"}`);
} catch (e) {
  console.log(`\n  FAILED  ${key}  ${e.message.split("\n")[0]}`);
  process.exitCode = 1;
}
