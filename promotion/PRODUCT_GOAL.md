# Product goal — NodeRoom

## Who opens this, and what they are trying to finish

Someone is closing a deal review this week. The numbers live in a spreadsheet
that three people keep editing, the supporting documents are scattered, and the
partner will ask "where did this figure come from?" in two days. They want help
finishing the work — an assistant that can fill in the variance column, pull the
funding history, and draft the memo — but they have been burned by the obvious
failure: an assistant that quietly overwrites the row a colleague just fixed, and
that cannot say afterwards which cell it changed or why. So they open NodeRoom,
which is a shared room on the web: a spreadsheet, notes, a wall of sticky notes,
and a chat where both their colleagues and an AI assistant work in the same
place. They ask the assistant in that chat, watch the cells change while their
colleague is still typing in the next row, and when it is done they can point at
any number and see who put it there and what it came from. What they walk away
holding is a sheet they are willing to send, plus a record of every edit — human
or machine — that they can show to somebody who did not watch it happen.

In this repo's own vocabulary the assistant is a **NodeAgent** (a public one that
acts in the shared room, and a private one whose drafts stay yours until you
promote them), the no-overwrite mechanism is **compare-and-swap versioning with
locks, drafts and proposals**, and the record is the **room trace**.

Paper note: NodeRoom is a shared web room where people and an AI assistant edit
the same spreadsheet and notes without silently overwriting each other, and every
change keeps a visible record of who made it and where it came from.

## The gate

This repo is judged by the twelve-condition PROMOTION gate, which lives in one
place and is not restated here:

**https://github.com/HomenShum/NodeKit/blob/main/templates/promotion/GATE.md**

Gate variant: `full`

Scoring vocabulary is PASS / FAIL / **UNVERIFIED**, and UNVERIFIED is never PASS.

## Canonical journeys

The work queue lives in [PRODUCT_JOURNEYS.md](PRODUCT_JOURNEYS.md). A journey
without browser evidence is unfinished, however green the tests are.

## Loop state

Every iteration is recorded in [PROMOTION_LOG.md](PROMOTION_LOG.md) — journey
exercised, defect fixed, evidence path, conditions newly passing. Loop state
lives in git, never in an agent's memory, so any agent can resume the loop cold.

## Current scorecard

Baseline wave measured 2026-08-13 against commit `9a7d031` on a fresh clone.
Rows carry that measurement unless an iteration below re-measured them; iteration 1
(2026-08-13, defect D-1) re-measured rows 2 and 12. Iteration 2 (2026-08-13, the
audit wave) re-measured rows 3, 4, 6, 7, 8, 9 and 10 against the production build
of commit `81504b0`. Evidence paths are relative to this file's directory.

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | UNVERIFIED | J1, J2, J3 driven and passing (`evidence/baseline/j1-room-desktop.png`, `j2-story-after.png`, `prod-agent-receipt.png`). J4 could not be driven: the sample room's review queue reads "no pending proposals" and no control in the keyless build produces one (`evidence/baseline/j4-review-queue.png`). J5 reached the mobile shell but no task was completed on it. A conjunction with an undriven member is not a PASS. |
| 2 | No critical or major usability defect open | FAIL | Two defects still open, both reproduced in the browser: D-2 the "Undo last applied room edit (Ctrl+Z)" control never enables; D-3 hand-editing a Variance cell clears it. D-1 (new chat messages and the agent's reply sorting ABOVE the seeded transcript) was fixed and re-proved in iteration 1 — `evidence/iteration-1/j3-chat-order-after.png`. See PROMOTION_LOG.md. |
| 3 | Mobile and desktop both intentional | PASS | Re-measured in iteration 2 with a committed producer, because the baseline's captures had no retained tool. Six widths loaded at `/?mode=memory` with NO `surface=` override, so the app chose its own shell: 320, 360 and 412 render the phone shell (a `mobile-nav-*` control present, the desktop CTA absent); 768, 1280 and 1440 render the desktop surface (CTA present, no mobile nav). Not one layout squeezed — the shell switches. Readout: `evidence/iteration-2/wig-review.json` → `Layout — Responsive coverage`, field `sweep`. Captures `evidence/iteration-2/wig-width-{320,360,412,768,1280,1440}.png`. Producer: `scripts/promotion-wig-review.mjs`. |
| 4 | No horizontal overflow at supported widths | PASS | Re-measured in iteration 2 with a committed producer. `document.documentElement.scrollWidth === window.innerWidth` at all six widths above — 320/320, 360/360, 412/412, 768/768, 1280/1280, 1440/1440, `overflowingWidths: []`. Same readout, captures and producer as row 3. |
| 5 | Loading/empty/success/error/agent-running designed | UNVERIFIED | Loading observed (`.nr-ssr-private[data-boot-state="loading"]` skeleton with a three-step progress rail), empty observed ("Review queue — no pending proposals", `j4-review-queue.png`), success observed (agent receipt chips, `prod-agent-receipt.png`). Error and agent-running were NOT reproduced: the keyless build has no failing model call, and the agent finished in 1.7s without any `agent-progress-card` appearing. |
| 6 | Keyboard and basic accessibility pass | FAIL | Re-measured in iteration 2 with committed producers; the baseline's conclusion holds and got worse under a longer sweep. axe-core 4.12.1 (wcag2a/2aa/21a/21aa) on the sample room still returns the CRITICAL `aria-allowed-attr` — the chat `textarea` carries `aria-expanded="false"`, a state that element cannot have (`evidence/iteration-2/axe-room.json`). **40** consecutive Tab presses from a fresh room reach 40 elements and never reach either control the journeys are about: `reachedChatComposer: false`, `reachedSheetCell: false`. One focused control still shows no ring at all — the binder search box (placeholder `Find in binder...`, `outline: … none 0px`, `box-shadow: none`). Readouts: `evidence/iteration-2/wig-review.json` → `Interactions — Keyboard works everywhere` and `— Clear focus`. Producers: `scripts/promotion-web-quality-audit.mjs`, `scripts/promotion-wig-review.mjs`. |
| 7 | Web Interface Guidelines: no major unresolved | FAIL | **Moved from UNVERIFIED in iteration 2: the review was performed.** 19 rules from Vercel's Web Interface Guidelines (https://vercel.com/design/guidelines, fetched 2026-08-13) were each decided by a measurement taken from the rendered app — **9 major, 4 minor, 6 clean**. This is a rule-by-rule review, not a re-labelled tool score; the majors include three things no audit tool tests (the URL never changes when you enter the room, Back leaves the app, the page title never changes). Full readout with the measurement behind every rule: `evidence/iteration-2/wig-review.json`. Screenshot proving the headline finding: `evidence/iteration-2/wig-after-reload.png` — refreshing while in the room lands back on the marketing page at the identical URL. Producer: `scripts/promotion-wig-review.mjs` (exit 1 while any major stands). Detail per finding in PROMOTION_LOG.md, iteration 2. **Coverage is partial and the row says so**: 19 of roughly 120 published rules — the ones decidable by a measurement on the rendered page. Rules needing human judgement (optical alignment, easing choice, copy voice) or a device lab (iOS Low Power Mode, macOS Safari) were not reviewed and are not clean, just unreviewed; they are named in `wig-review.json` → `coverage`. The row is FAIL on the 9 majors that were found, so wider coverage can only make it worse, never better. |
| 8 | Web-quality audit: no major unresolved | FAIL | Re-measured in iteration 2 with committed artifacts and a committed producer, and **Core Web Vitals are now measured** — the baseline row said they were not. Lighthouse 13.4.1 on the phone shell (`/?mode=memory`, mobile preset): performance **0.47**, LCP **10,169ms**, FCP 6,717ms, TTI 10,643ms, CLS 0.000, accessibility 0.95. Desktop preset on the desktop surface: performance 0.91, LCP 1,431ms, TTI 1,668ms, CLS 0.013, accessibility 0.93. axe-core in the sample room: 1 critical `aria-allowed-attr` (`textarea`) + 1 serious `color-contrast` covering 4 nodes (`.r-live-count`, `.on`, two `.r-spine-step[data-state="next"]`). axe CLI 4.13.0 on the landing route: 2 moderate (`heading-order`, `region`). Three majors stand, listed in `evidence/iteration-2/web-quality-summary.json` → `majors`. Artifacts: `lighthouse-landing-mobile.json`, `lighthouse-landing-desktop.json`, `axe-cli-landing.json`, `axe-room.json`, `room-1440-audited.png`. Producer: `scripts/promotion-web-quality-audit.mjs` (exit 1 while any major stands). |
| 9 | No unexplained console errors or failed requests | PASS | Re-measured in iteration 2 with a committed producer, because the baseline's runs had no retained tool. Zero console errors, zero `pageerror`, zero failed requests and zero 4xx/5xx across the six-width landing sweep (`wig-review.json` → `widthsWithConsoleErrorsOrFailedRequests: []`) and across the full click-into-the-room journey used for the axe run (`web-quality-summary.json` → `axeRoom.consoleErrors: []`, `axeRoom.failedRequests: []`). Both on the production build served by `vite preview`. |
| 10 | Performance does not obstruct interaction | FAIL | **Moved from PASS in iteration 2, on the first measurement of this app under phone conditions.** The baseline's PASS rested on localhost desktop timings with a warm cache and no throttling. Lighthouse 13.4.1's mobile preset (Moto G Power class device, 4x CPU slowdown, 1,638Kbps) on the shell a phone visitor actually gets, `/?mode=memory`: first contentful paint **6,717ms**, largest contentful paint **10,169ms**, time to interactive **10,643ms**, performance score **0.47**. Ten seconds before the page responds is obstruction, and J5 is explicitly a phone journey. Desktop remains fine (LCP 1,431ms, TTI 1,668ms, score 0.91), so this is a phone-shell finding, not a whole-app one. Caveat kept from the baseline and still true: the server is localhost, so this is CPU and bundle cost, not network distance — the build ships a 1,909kB mermaid chunk and a 1,038kB workbook chunk. Artifact: `evidence/iteration-2/lighthouse-landing-mobile.json`. Producer: `scripts/promotion-web-quality-audit.mjs`. |
| 11 | Tests and build green | FAIL | Re-measured in iteration 1. `npm run build` → exit 0 (`tsc --noEmit` + `vite build` + provenance check `{"status":"pass"}`). `npm test -- --run` → **exit 1**: 2 failed / 386 passed files, 2 failed / 2,715 passed tests (the +2 passing are iteration 1's regression cases). `tests/proofStaleness.test.ts` fails honestly, as at baseline — "noderoom-fresh-user-vertical-proof.json: stale: 31.7 days old (window 30d)". The second failure is a 5,000ms timeout on an environment probe that passes when run alone on the pristine tree — `tests/dockerSandboxProbe.test.ts` this wave, `tests/proofloopStandaloneRunnerDogfood.test.ts` at baseline. |
| 12 | Verified in the rendered app, not inferred from code | PASS | Iteration 2 added nothing that was read off the source: every one of its 19 guideline verdicts and every audit number came out of a rendered Chromium driving the production build on port 4903, and the two rows that moved are backed by pictures of the running app (`evidence/iteration-2/wig-after-reload.png`, `wig-width-*.png`). Two of iteration 2's own checks were wrong on first run and were corrected against the rendered page rather than argued away — see PROMOTION_LOG.md, "Two checks this wave got wrong". Iteration 1's fix (D-1) was likewise observed in a rendered Chromium at 1440×900, before and after, not read off the diff: `evidence/iteration-1/j3-chat-order-before.png` shows the chat tail ending at the seeded "Homen 9:46" with the visitor's message and the agent's receipt at feed indices 0 and 1, both off-screen; `j3-chat-order-after.png` shows them last and in view. The machine-readable readouts are `j3-chat-order-before.json` / `-after.json`, and the producer is committed at `scripts/promotion-chat-order-proof.mjs` — re-runnable from a fresh clone against `npm run dev -- --port 4305`, exit 0 on pass and 1 on the defect. |

**Status: NOT PROMOTED** — 4/12 PASS (3, 4, 9, 12).

The count went **down**, from 5 to 4, and that is the wave working. Iteration 2 ran
the two audits the earlier waves could not, and reviewed the app against a
published guideline list for the first time. Condition 7 left UNVERIFIED and
landed on FAIL with nine majors. Condition 10 left PASS and landed on FAIL,
because its PASS had only ever been measured on a desktop with a warm cache and
no throttling, and the first phone-conditions measurement reads ten seconds to
interactive. Nothing regressed in the product between iteration 1 and iteration 2
— no product code was changed in this wave at all. What changed is that four rows
now rest on a committed artifact **and** a committed producer, where before they
rested on captures whose tool no longer existed.
