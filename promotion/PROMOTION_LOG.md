# Promotion log — NodeRoom

Loop state lives here, in git, so any agent can resume cold. One entry per
iteration. Append; never rewrite history, because the list of things that turned
out to be wrong is more useful to the next reader than the current values alone.

Iteration cap: **10** (default). On reaching the cap without a gate pass, stop
and leave the remaining defect ledger below — a documented stop is a valid
outcome; a silent one is not.

## Entry shape

```
### Iteration N — YYYY-MM-DD
- Journey exercised: J<k> <name>
- Observed: <the defect, with its reproduction — inputs, width, state>
- Fixed: <the change, using existing components; file paths>
- Re-proved: <evidence path showing the defect gone in the rendered app>
- Tests: <command and result>
- Conditions newly PASS: <numbers, or "none">
```

---

## Baseline — 2026-08-13

Wave 1 measures; it does not fix. No product code, test, config or asset in this
repo was modified. The only files added are the four `promotion/` documents and
`promotion/evidence/baseline/`. This repo was NOT marked DEFERRED.

Environment: fresh `git clone --depth 50` of `main` at commit `9a7d031`, Windows
11, Node 22.22.2, no `.env.local` — so `VITE_CONVEX_URL` is unset and the app
runs in its keyless in-memory mode, which is the tier a stranger can reach.

- **App started: yes.** `npm run dev -- --port 5260` → Vite ready in 6,638ms;
  `npm run build && npx vite preview --port 4310` also serves the app. Both were
  driven with Playwright/Chromium.
- **Journeys drivable: 3 of 5 fully (J1, J2, J3), 1 partially (J5), 1 blocked (J4).**
- Scorecard at baseline: see [PRODUCT_GOAL.md](PRODUCT_GOAL.md) — **4/12 PASS**
  (conditions 3, 4, 9, 10).

### Commands actually run, with their real exit codes

| Command | Exit | Note |
|---|---|---|
| `git clone --depth 50 https://github.com/HomenShum/NodeRoom.git` | 0 | 6,214 files |
| `npm install --no-audit --no-fund` | 0 | 977 packages, ~4 min, several deprecation warnings |
| `npm run dev -- --host 127.0.0.1 --port 5260 --strictPort` | (served) | ready in 6,638ms; noisy `Failed to load source map` warnings for `vendor/nodegraph-live/dist/*.js.map` (maps not shipped in the vendored tarball) |
| `npm test -- --run` | **1** | 2 failed / 385 passed files; 2 failed / 2,713 passed tests; 568s |
| `npm run build` | 0 | `tsc --noEmit` + `vite build` (2m) + `verify-build-provenance` → `{"status":"pass","expectedSha":"9a7d031…"}`; warns `main-*.js` is 1,223kB |
| `npx vite preview --host 127.0.0.1 --port 4310` | (served) | used for all production-build timings |
| axe-core 4.x via `@axe-core/playwright`, tags wcag2a/2aa/21a/21aa | — | room: 1 critical + 5 serious; landing: 4 serious |

The two test failures, verbatim:

- `tests/proofStaleness.test.ts` › *keeps every marketed proof on disk fresh RIGHT
  NOW* — `docs/eval/noderoom-fresh-user-vertical-proof.json: stale: 31.6 days old
  (window 30d) — rerun the proof batch or pull the claim`. This is the repo's own
  decay gate firing correctly on a marketed proof, not a broken test.
- `tests/proofloopStandaloneRunnerDogfood.test.ts` › *emits the merged standalone
  runner plan schema and resume command* — `Test timed out in 5000ms`. Not
  re-run, so flake versus real is undetermined.

### What was deliberately NOT done

No Convex deployment was created, no secret was set or rotated, nothing was
published, and production was not touched. Every condition that needed the live
tier (J4 proposals, the agent failure card, real-provider timing) is recorded as
UNVERIFIED with that reason rather than assumed.

## Defect ledger

Open defects, most-impactful first. A defect is only listed once it has a
reproduction; a hunch is not a defect.

| # | Severity | Journey | Reproduction | Status |
|---|----------|---------|--------------|--------|
| D-1 | Major | J3 | Chromium 1440×900, `/?mode=memory` → **Try sample room** → type `@nodeagent recompute the Q3 variance column` → **Send**. The message posts in 5ms and the agent replies in ~1.7s, but both land at feed indices **0 and 1**, above the seeded transcript (indices 2–8, timestamps 9:38–9:46), because the seeded messages carry fixed wall-clock times and the run happened at 02:15 local. The chat is pinned to the bottom, so the user sees the seeded conversation ending at "Homen 9:46" and no reply at all — the receipt for the edit that just changed their sheet is off-screen. Trigger condition: local clock earlier than 09:38. Evidence: `evidence/baseline/prod-agent-receipt.png` (sheet filled, chat tail unchanged), `evidence/baseline/j3-agent-reply.png`. | **FIXED — iteration 1** |
| D-2 | Major | J3 | Same room, 1440×900. The work surface shows a button titled *"Undo last applied room edit (Ctrl+Z)"*. It is `disabled` on arrival, still `disabled` after the agent commits four variance cells, and still `disabled` after a human edits a cell. Measured as three `isEnabled()` reads across those three states — all `false`. The one control a stranger would reach for to reverse an agent's change never becomes usable. Evidence: `evidence/baseline/j4-after-agent-edit.png`, `evidence/baseline/j4-after-human-edit.png`. | OPEN |
| D-3 | Major | J3 | Same room, 1440×900. Click the first `data-testid="cell-edit-control"` (row 1 VARIANCE, showing `+24%`), type `human note baseline` into `data-testid="cell-editor"`, press Enter. The cell commits **empty** — `+24%` → `""` — rather than the typed text or a rejection message. Silent data loss on a hand edit, on the surface whose entire promise is that edits are never silently lost. Evidence: `evidence/baseline/j4-after-human-edit.png`. Not yet root-caused; the editor may be typed (percentage) and swallowing an invalid value. | OPEN |
| D-4 | Major | J4 | `DEMO.md` §4.2 tells a demo audience that auto-allow is off by default and agent edits arrive as reviewable proposals. In the keyless sample room the review queue reads **"no pending proposals"** and no UI control produces one, so the product's central trust claim cannot be seen by anyone who has not stood up a Convex deployment with a model key. Evidence: `evidence/baseline/j4-review-queue.png`. | OPEN |
| D-5 | Major (a11y) | all | axe-core (wcag2a/2aa/21a/21aa) on the sample room at 1440×900 returns critical `aria-allowed-attr`: the chat `textarea` carries `aria-expanded="false"`, unsupported on that element, so screen readers get a control that claims a state it cannot have. Plus 5 serious `color-contrast` nodes, worst `.r-walkdock-pace` at **1.55:1** against 4.5:1 required. | OPEN |
| D-6 | Minor (a11y) | J1 | From a fresh load of the sample room, 25 consecutive Tab presses never leave the left binder rail and there is no skip link (`SKIP_LINKS=[]`). A keyboard user cannot reach the sheet or the chat composer without tabbing through every binder item. One focused input (the binder search box) has neither an outline nor a box-shadow, so its focus is invisible. **Iteration 2 re-measured this at 40 Tab presses and raises the severity from Minor to Major**: 40 presses focus 40 elements and reach neither `chat-composer` nor `cell-edit-control`, so a keyboard user cannot reach *either* control the canonical journeys are about — not merely "not without effort". The ringless control is confirmed as the binder search box by its placeholder `Find in binder...` inside `LABEL.r-rail-search r-binder-search`. Guidelines: *Interactions — Keyboard works everywhere*, *Interactions — Clear focus*. Evidence: `evidence/iteration-2/wig-review.json`. | OPEN — severity raised to Major in iteration 2 |
| D-8 | Major | J1, J3 | Chromium 1440×900, production build on port 4903. `/?mode=memory&surface=desktop` → **Try sample room** → the room opens and the URL does not change: it is still `/?mode=memory&surface=desktop`, byte for byte. Two consequences, both measured. **Refresh** (F5) drops the visitor back on the marketing landing page — `roomVisible: false`, `landingCtaVisible: true` — with the same URL in the bar, so nothing about the address explains why the page is different. **Back** leaves the application entirely: `history.length` is still 2 inside the room, so entering pushed no entry, and `goBack()` lands on `about:blank`. A link to the room cannot be sent to a colleague. Guidelines: *Interactions — URL as state*, *Interactions — Deep-link everything*. Evidence: `evidence/iteration-2/wig-after-reload.png`, `evidence/iteration-2/wig-review.json`. | OPEN |
| D-9 | Major | J1 | Same room. The room renders **zero** landmark elements — no `main`, `nav`, `header`, `footer`, `aside` or ARIA equivalent (`roomLandmarks: 0`, `roomMainLandmarks: 0`) — and the landing route offers no skip link (`landingSkipLinks: []`). A screen-reader or keyboard user has no region to jump between and nothing to skip to, which is the mechanism that would have made D-6 survivable. axe reports the landing half of this independently as `region`. Guideline: *Content — Headings & skip link*. Evidence: `evidence/iteration-2/wig-review.json`, `evidence/iteration-2/axe-cli-landing.json`. | OPEN |
| D-10 | Major | J3, J5 | Same room, 1440×900. **30 of 85** visible interactive controls are under 24px on one axis. Among them the primary work control: every `data-testid="cell-edit-control"` is 21px high, so the buttons a person uses to edit the sheet by hand are below the minimum on every row. Also the file-tab close buttons `.r-filetab-x` at 16×16, and the panel resize handle `.r-resize` at 6px wide. Guideline: *Interactions — Match visual & hit targets* (expand to ≥24px; 44px on mobile). Evidence: `evidence/iteration-2/wig-review.json` → `Interactions — Match visual & hit targets`, `evidence/iteration-2/wig-room-1440.png`. | OPEN |
| D-11 | Major (perf) | J5 | Lighthouse 13.4.1 mobile preset (Moto G Power class, 4x CPU slowdown, 1,638Kbps) against `/?mode=memory` on the production build — the phone shell a real phone visitor gets. First contentful paint **6,717ms**, largest contentful paint **10,169ms**, time to interactive **10,643ms**, performance **0.47**. The same build on the desktop preset scores 0.91 with LCP 1,431ms, so this is the phone shell's cost, not a machine artefact. The build ships a 1,909kB `mermaid` chunk and a 1,038kB `workbook-vendor` chunk. Evidence: `evidence/iteration-2/lighthouse-landing-mobile.json` (and `-desktop.json` for the contrast). | OPEN |
| D-12 | Minor | J1 | The `<title>` is `NodeRoom - live collaborative AI rooms with NodeAgents` on the landing page and the identical string inside the room, so a tab strip, a bookmark and a browser history entry cannot tell the marketing page from the workspace. Same root cause as D-8 — no route changes when the app does. Guideline: *Content — Accurate page titles*. Evidence: `evidence/iteration-2/wig-review.json` → `Content — Accurate page titles`. | OPEN |
| D-7 | Minor (docs) | J1 | `DEMO.md` is the repo's stage script and is stale against the shipped UI: it instructs the presenter to click **"Enter the Q3 diligence room"** and then **"Run collaboration"**. The current landing CTA is **"Try sample room"** (`data-testid="start-demo-room"`), and the string "Run collaboration" exists only in `src/landing/roomTour/RoomTourArtifact.tsx` (the `#room-tour` marketing artifact), not in the room. Anyone following DEMO.md live will hunt for controls that are not there. | OPEN |

## Iterations

### Iteration 1 — 2026-08-13 — D-1, the reply you asked for lands off-screen

- **Journey exercised:** J3 — the receipt journey. Ask the assistant to fill the
  variance column, then check its work.

- **Observed:** Reproduced exactly as the ledger describes, on a fresh clone of
  `6a1deaa`, Chromium 1440×900, dev server on port 4305, browser clock pinned to
  **04:00 local** so the run is the same at any hour. `/?mode=memory&surface=desktop`
  → **Try sample room** → type `@nodeagent recompute the Q3 variance column` →
  **Send**. The assistant does the work — the VARIANCE column fills — but the
  visitor's own message lands at feed index **0** and the assistant's
  `Committed r_rev +24% … Lock released.` receipt at index **1**, above all seven
  seeded messages (indices 2–8), and both are outside the chat's scrollport. The
  screen the visitor is actually looking at ends at the seeded "Homen 9:46" with no
  reply of any kind. Evidence: `evidence/iteration-1/j3-chat-order-before.png`,
  `evidence/iteration-1/j3-chat-order-before.json`
  (`orderingCorrect: false`, `sentMessageInView: false`, `agentReplyInView: false`,
  `consoleErrors: 0`). That capture was produced by the same committed script as the
  after-capture, run against the pre-fix tree — to reproduce the defect state from a
  fresh clone, `git checkout <this commit>~1 -- src/engine/demoRoom.ts`, restart the
  dev server, and re-run the producer with `--label before`.

- **Root cause:** `src/engine/demoRoom.ts:289` — `chatBase.setHours(9, 38, 0, 0)`.
  The seeded transcript was stamped at a fixed **wall-clock hour** so the bubbles
  would read like a plausible morning (9:38 → 9:46), while every live message is
  stamped with the real clock and the feed sorts strictly on that stamp. For any
  visitor whose local time is before 09:38, the entire demo transcript is in the
  future, so everything they send sorts before it — and because the feed is pinned
  to its newest line, their message and the receipt scroll off the top. The bug
  existed because an absolute time was used to express a relative fact ("this is
  history"), and nothing in the data or the tests stated that relation. The same
  hard-coded base also ignored the engine's injectable clock, so the transcript was
  ~55 years in the future under the default test clock and no unit test could have
  noticed. This was the only backdating site in `src/` (`grep -rn "\.createdAt = "`),
  and `buildDemoRoom` has one caller, `src/app/roomStore.ts:59`.

- **Fixed:** `src/engine/demoRoom.ts` — the transcript is now anchored to whatever
  clock the engine itself stamps messages with (`Date.now` in the app, the injected
  clock in tests) and ends one minute in the past, keeping the same 0/0/1/3/4/6/8
  minute spacing. Existing data, no new component, no new dependency.
  `e2e/design-baseline.spec.ts` gains `.r-msg .time` in its existing volatile-region
  mask, because those clock labels are now deliberately relative.

- **Re-proved:** Dev server restarted on the fixed tree before capturing. Same
  script, same pinned 04:00 clock, exit **0**:
  `evidence/iteration-1/j3-chat-order-after.png` shows the seeded transcript running
  3:51 → 3:59 with the visitor's 4:00 message and the assistant's
  `Committed r_rev +24%, r_cogs +27.5%, r_gp +21.7%, r_ni +22.4%. Lock released.`
  as the last two lines, both in view, with the VARIANCE column filled behind them.
  `evidence/iteration-1/j3-chat-order-after.json`: `orderingCorrect: true`,
  `sentMessageIndex: 7`, `agentReplyIndex: 8`, both `inView: true`,
  `consoleErrors: 0`.
  Producer, committed and re-runnable from a fresh clone:
  `node scripts/promotion-chat-order-proof.mjs --base-url http://127.0.0.1:4305 --out promotion/evidence/iteration-1 --label after`
  (exit 1 if the defect returns).

- **Regression check:** `tests/demoRoomChatOrder.test.ts` — two cases, one pinning
  `Date` to 04:00 local, one on the engine's injected clock, so they fail on the old
  code at **any** hour rather than only before breakfast. **Confirmed failing on the
  pre-fix tree**: `git stash push src/engine/demoRoom.ts` → `npx vitest run
  tests/demoRoomChatOrder.test.ts` → `Test Files 1 failed, Tests 2 failed`
  (`expected 'seed-07-homen-memo' to be 'live-02'`); restored → 2 passed.

- **Tests:** `npm test -- --run` → exit **1**, 2 failed / 386 passed files, **2 failed
  / 2,715 passed tests** in 420s (baseline: 2 failed / 2,713 passed — the +2 are the
  new regression cases). Neither failure is this change, and neither file imports
  `demoRoom`: (a) `tests/proofStaleness.test.ts` is the repo's own decay gate firing
  correctly on a marketed proof, the same one the baseline hit, now
  "31.7 days old (window 30d)"; (b) `tests/dockerSandboxProbe.test.ts` times out at
  5,000ms under the full parallel run and **passes when run alone on the pristine
  pre-fix tree** (`git stash` → `npx vitest run tests/dockerSandboxProbe.test.ts
  tests/proofStaleness.test.ts` → 1 failed / 4 passed, the staleness one) — a
  load-dependent probe timeout, the same class as the baseline's
  `proofloopStandaloneRunnerDogfood` timeout, on a different file.
  So condition 11 stays FAIL for the reasons it already failed.
  `npm run build` → exit **0** (`tsc --noEmit` + `vite build` 1m08s +
  `verify-build-provenance` `{"status":"pass"}`).
  Not run: `npm run test:e2e` (the Playwright visual/journey suites), which was not
  part of the baseline's measurement either and needs its own QA server; the mask
  edit above is the defensive change for the one baseline that photographs a clock.

- **Conditions newly PASS:** **12**. Condition 2 stays FAIL — D-2 and D-3 are still
  open, and a condition that names "no major defect" cannot pass while two remain.
  Condition 1 stays UNVERIFIED: J4 is still not drivable keyless. Scorecard 4/12 →
  **5/12**.

### Iteration 2 — 2026-08-13 — the two audits, and the review that is not an audit

This wave **measures; it does not fix**. No product code, test, config or asset was
modified. The files added are two producer scripts under `scripts/` and
`promotion/evidence/iteration-2/`. Its job was the two conditions earlier waves
could not close: **7** (Web Interface Guidelines review) and **8** (web-quality
audit), plus any adjacent row the same runs gave real evidence for.

Environment: fresh `git clone` of `main` at commit `81504b0`, Windows 11, Node
22.22.2, no `.env.local` — the keyless in-memory tier a stranger reaches.
`npm install` exit 0. `npm run build` exit 0 (`tsc --noEmit` + `vite build` 2m11s
+ `verify-build-provenance` `{"status":"pass","expectedSha":"81504b0c…"}`). Served
with `npx vite preview --host 127.0.0.1 --port 4903 --strictPort`. Every number
below came from that production build in a rendered Chromium, started after the
build so nothing was measured against a stale process.

#### Condition 8 — the web-quality audit. FAIL, now with both halves of its evidence.

Producer: `scripts/promotion-web-quality-audit.mjs`, exit **1** while a major
stands. It runs, and records verbatim, the commands it ran:

    npx --yes lighthouse@13.4.1 <url> --output=json --output-path=<file> --chrome-flags="--headless" [--preset=desktop]
    npx --yes @axe-core/cli@4.13.0 <url> --load-delay 8000 --dir <out> --save axe-cli-landing.json

plus an axe-core pass through Playwright for the room. Artifacts, all committed:
`lighthouse-landing-mobile.json`, `lighthouse-landing-desktop.json`,
`axe-cli-landing.json`, `axe-room.json`, `room-1440-audited.png`,
`web-quality-summary.json`.

| Surface | Perf | A11y | LCP | FCP | TTI | CLS |
|---|---|---|---|---|---|---|
| phone shell, `/?mode=memory`, mobile preset | **0.47** | 0.95 | **10,169ms** | 6,717ms | 10,643ms | 0.000 |
| desktop surface, `surface=desktop`, desktop preset | 0.91 | 0.93 | 1,431ms | 1,109ms | 1,668ms | 0.013 |

Three majors, all in `web-quality-summary.json` under `majors`:

1. `lighthouse/landing-mobile`: LCP 10,169ms against Google's 4,000ms "poor" line.
2. `axe-room`: **critical** `aria-allowed-attr` on the chat `textarea` — 1 node.
3. `axe-room`: **serious** `color-contrast` — 4 nodes (`.r-live-count`, `.on`, two
   `.r-spine-step[data-state="next"]`).

axe CLI on the landing route found 2 moderate issues (`heading-order`, `region`),
below the major line, which feed defect D-9.

**The baseline row for condition 8 said "Core Web Vitals were not measured." They
are now.** That is the substantive change here: the verdict did not move, but it
stopped resting on a partial measurement whose tool was gone.

One trap worth keeping: `@axe-core/cli` with no `--load-delay` reported
**"0 violations found!"** — a perfect score, because NodeRoom boots into a shimmer
and axe graded the skeleton. Every axe run in the producer now waits, and the
summary records what proved the app was actually up.

#### Condition 7 — the Web Interface Guidelines review. UNVERIFIED → **FAIL**.

Guidelines fetched 2026-08-13 from https://vercel.com/design/guidelines (reachable;
no fallback needed). Producer: `scripts/promotion-wig-review.mjs`, exit **1** while
a major stands. **19 rules reviewed: 9 major, 4 minor, 6 clean.** Every verdict is
a measurement taken from the rendered page, stored beside the rule it belongs to in
`evidence/iteration-2/wig-review.json`.

**This is not a Lighthouse score wearing a different label.** The three most
important findings are things no audit tool tests, and Lighthouse scored this app
0.91 on desktop while all three were true.

| Guideline | Measurement | Verdict |
|---|---|---|
| Interactions — URL as state | Entering the room leaves the URL byte-identical; F5 then shows the marketing page (`roomVisible: false`, `landingCtaVisible: true`) | **major** — D-8 |
| Interactions — Deep-link everything | `history.length` still 2 inside the room; `goBack()` lands on `about:blank` | **major** — D-8 |
| Content — Accurate page titles | landing and room `<title>` identical | **major** — D-12 |
| Content — Headings & skip link | room renders 0 landmarks and 0 `main`; landing has no skip link | **major** — D-9 |
| Content — Semantics before ARIA | `aria-expanded="false"` on a `TEXTAREA` | **major** — same node as D-5 |
| Interactions — Match visual & hit targets | 30 of 85 visible controls under 24px, including every `cell-edit-control` at 21px | **major** — D-10 |
| Interactions — Confirm destructive actions / Undo | the Undo control is `disabled` on arrival | **major** — D-2, independently reproduced |
| Interactions — Keyboard works everywhere | 40 Tabs; `chat-composer` and `cell-edit-control` both unreached | **major** — D-6 |
| Interactions — Clear focus | 1 of 40 focused controls has no outline and no box-shadow | **major** — D-6 |
| Design — theme-color / color-scheme | `meta[name=theme-color]` absent; `color-scheme: dark` present | minor |
| Content — Tabular numbers | 26 numeric cells, 25 use `tabular-nums`; one overflow chip does not | minor |
| Animations — Never `transition: all` | 2 elements animate with `transition-property: all` | minor |
| Forms — Textarea behavior | Enter submits and clears the composer rather than inserting a newline | minor — chat convention differs from the guideline; recorded, not charged |
| Interactions — Respect zoom | `width=device-width, initial-scale=1.0, viewport-fit=cover` — nothing disabled | clean |
| Interactions — Don't block paste | paste event on the composer, `defaultPrevented: false` | clean |
| Interactions — Mobile input size | Pixel 7, every visible input at least 16px | clean |
| Content — Icon-only buttons are named | 8 icon-only buttons visible, 0 unnamed | clean |
| Animations — Honor `prefers-reduced-motion` | 0 elements still animating under `reducedMotion: reduce` | clean |
| Layout — Responsive coverage / No excessive scrollbars | six widths, no overflow, shell switches at the breakpoint | clean |

#### Conditions 3, 4, 9 — same verdict, real evidence underneath it now

The baseline recorded these PASS from measurements whose tool was not retained. The
width sweep inside `scripts/promotion-wig-review.mjs` re-measures all three in one
pass and commits both the readout and the pictures. It loads `/?mode=memory` with
**no `surface=` override**, so the app picks its own shell — an earlier draft of
this script pinned `surface=desktop` and would have "proved" the phone layout was
intentional while forcing the desktop one.

| width | scrollWidth | shell | console errors | failed requests |
|---|---|---|---|---|
| 320 | 320 | phone | 0 | 0 |
| 360 | 360 | phone | 0 | 0 |
| 412 | 412 | phone | 0 | 0 |
| 768 | 768 | desktop | 0 | 0 |
| 1280 | 1280 | desktop | 0 | 0 |
| 1440 | 1440 | desktop | 0 | 0 |

#### Condition 10 — PASS → **FAIL**

The baseline's PASS was a localhost desktop measurement with a warm cache and no
throttling. Under Lighthouse's mobile emulation the phone shell takes **10,643ms**
to become interactive. J5 is explicitly a phone journey, so this is in scope, and
ten seconds is obstruction by any reading. Desktop is unaffected (TTI 1,668ms).
Nothing regressed between iteration 1 and iteration 2 — the app had simply never
been measured under these conditions.

#### Two checks this wave got wrong, and how they were caught

Recorded because the next reader will otherwise re-derive them, and because a
review that never fails its own checks is not a review:

1. **`transition-property: all` flags the whole document.** `all` is the CSS
   *initial value*, so testing `getComputedStyle(el).transitionProperty === "all"`
   matched 926 elements including `<head>`, `<meta>` and `<title>`. Corrected to
   also require a non-zero `transition-duration`: the real count is **2**.
2. **The tabular-numbers rule scored a sample of zero.** It read
   `[data-testid="cell-edit-control"]`, which says "add"/"note" while the VARIANCE
   column is empty, found no digits, and returned a clean verdict on nothing.
   Corrected to scan numeric leaf nodes in the work panel: 26 figures, 25 already
   `tabular-nums`. The rule really is nearly clean — but it was clean by luck, not
   by measurement, until the selector was fixed.

A third correction was methodological: both Lighthouse presets initially ran
against `surface=desktop`, which reported the desktop layout's cost as the phone
experience. Each preset now audits the surface it corresponds to.

#### What was deliberately NOT done

No Convex deployment, no secret set or rotated, nothing published, production not
touched. `npm test -- --run` was **not** re-run this wave — condition 11 therefore
keeps iteration 1's FAIL and its reasons unchanged rather than borrowing a fresh
claim; `npm run build` was run and was green. Conditions 1 and 5 were not
re-measured: J4 is still not drivable keyless, and the error and agent-running
states still have no way to be triggered in this tier, so both keep their
UNVERIFIED and their reason.

- **Conditions newly PASS:** none.
- **Conditions moved:** **7** UNVERIFIED → FAIL (review performed, 9 majors);
  **10** PASS → FAIL (first measurement under phone conditions).
- **Rows re-evidenced without changing verdict:** 3, 4, 6, 8, 9 — each now names a
  committed artifact and a committed, re-runnable producer.
- Scorecard 5/12 → **4/12**.
