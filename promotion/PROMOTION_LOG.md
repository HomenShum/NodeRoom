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
| D-6 | Minor (a11y) | J1 | From a fresh load of the sample room, 25 consecutive Tab presses never leave the left binder rail and there is no skip link (`SKIP_LINKS=[]`). A keyboard user cannot reach the sheet or the chat composer without tabbing through every binder item. One focused input (the binder search box) has neither an outline nor a box-shadow, so its focus is invisible. | OPEN |
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
