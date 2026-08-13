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

Baseline wave, measured 2026-08-13 against commit `9a7d031` on a fresh clone.
Product code was NOT changed in this wave; this row set is a starting line, not a
result. Evidence paths are relative to this file's directory.

| # | Condition | Status | Evidence / reason |
|---|-----------|--------|-------------------|
| 1 | Journeys succeed end-to-end in a real browser | UNVERIFIED | J1, J2, J3 driven and passing (`evidence/baseline/j1-room-desktop.png`, `j2-story-after.png`, `prod-agent-receipt.png`). J4 could not be driven: the sample room's review queue reads "no pending proposals" and no control in the keyless build produces one (`evidence/baseline/j4-review-queue.png`). J5 reached the mobile shell but no task was completed on it. A conjunction with an undriven member is not a PASS. |
| 2 | No critical or major usability defect open | FAIL | Three defects open, all reproduced in the browser: D-1 new chat messages and the agent's reply sort ABOVE the seeded transcript; D-2 the "Undo last applied room edit (Ctrl+Z)" control never enables; D-3 hand-editing a Variance cell clears it. See PROMOTION_LOG.md. |
| 3 | Mobile and desktop both intentional | PASS | Not one layout squeezed: at 412px the app renders a purpose-built mobile shell with its own header, bottom navigation (`mobile-nav-home/room/agent/inbox/files`) and card home (`evidence/baseline/landing-mobile.png`), while 768px and 1440px render the three-pane room (`room-tablet.png`, `j1-room-desktop.png`). |
| 4 | No horizontal overflow at supported widths | PASS | `document.documentElement.scrollWidth === window.innerWidth` measured at 320, 360, 412, 768, 1280 and 1440 on the landing route, the sample room and `#story`. Captures: `landing-w320.png`, `landing-w360.png`, `landing-mobile.png`, `room-tablet.png`, `j1-room-desktop.png`, `j2-story-after.png`. |
| 5 | Loading/empty/success/error/agent-running designed | UNVERIFIED | Loading observed (`.nr-ssr-private[data-boot-state="loading"]` skeleton with a three-step progress rail), empty observed ("Review queue — no pending proposals", `j4-review-queue.png`), success observed (agent receipt chips, `prod-agent-receipt.png`). Error and agent-running were NOT reproduced: the keyless build has no failing model call, and the agent finished in 1.7s without any `agent-progress-card` appearing. |
| 6 | Keyboard and basic accessibility pass | FAIL | axe-core (wcag2a/2aa/21a/21aa) on the sample room returns a CRITICAL `aria-allowed-attr` violation — the chat `textarea` carries `aria-expanded="false"`, which that role does not allow. 25 consecutive Tab presses from page load never leave the left binder rail, and there is no skip link (`SKIP_LINKS=[]`); one focused input has neither an outline nor a box-shadow. |
| 7 | Web Interface Guidelines: no major unresolved | UNVERIFIED | No Web Interface Guidelines review was run in this wave. |
| 8 | Web-quality audit: no major unresolved | FAIL | axe-core on the sample room: 1 critical (`aria-allowed-attr`) + 5 serious `color-contrast` nodes (`.r-live-count` 3.3:1, `.r-walkdock-pace` 1.55:1, `.on` 3.78:1, two `.r-spine-step[data-state="next"]` at 3.08:1 — all below 4.5:1). Landing: 4 serious contrast nodes. Core Web Vitals were not measured. |
| 9 | No unexplained console errors or failed requests | PASS | Zero console errors, zero `pageerror`, zero failed or 4xx/5xx requests across every run in this wave: landing, sample room, `#story`, the agent journey, and 320/360/412/768/1280/1440 widths — on both the dev server and the production preview. |
| 10 | Performance does not obstruct interaction | PASS | Production build served by `vite preview`: landing CTA interactive 3,519ms after `goto` (DOMContentLoaded 3,065ms, load 3,437ms); room fully rendered 184ms after clicking "Try sample room"; the agent's committed edits plus its "Lock released" receipt land 1,719ms after send. Caveat: localhost, warm cache; the build warns that `main` is 1,223kB. |
| 11 | Tests and build green | FAIL | `npm run build` → exit 0 (`tsc --noEmit` + `vite build` + provenance check `{"status":"pass"}`). `npm test -- --run` → **exit 1**: 2 failed / 385 passed files, 2 failed / 2,713 passed tests. `tests/proofStaleness.test.ts` fails honestly — "noderoom-fresh-user-vertical-proof.json: stale: 31.6 days old (window 30d)"; `tests/proofloopStandaloneRunnerDogfood.test.ts` times out at 5,000ms. |
| 12 | Verified in the rendered app, not inferred from code | UNVERIFIED | This wave made no product change, so there is no improvement to have verified. Every row above that says PASS or FAIL was observed in a rendered browser; every row that was not observed says UNVERIFIED. |

**Status: NOT PROMOTED** — 4/12 PASS.
