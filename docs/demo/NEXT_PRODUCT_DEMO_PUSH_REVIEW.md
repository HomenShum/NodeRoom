# Next Product/Demo Push Review

Date: 2026-06-14

Input reviewed: `C:\Users\hshum\.codex\attachments\e50dd9ed-9005-4f70-87d1-42a8d5462c1a\pasted-text.txt`

## Findings

### P0: Local app was not renderable

The browser initially showed a Vite import error from `src/app/store.tsx` importing deleted `src/agent/*` modules. The repo had finished the `src/nodeagent/**` migration in docs, but the Vite client still referenced the old tree.

Fix landed in this pass:

- `src/app/store.tsx` now imports canonical NodeAgent modules directly.
- `src/eval/haloSelfImprovement.ts` and `src/eval/spreadsheetBenchRunner.ts` now use `src/nodeagent/**`.
- `src/ui/IntakePlanPreview.tsx` now uses `src/nodeagent/core/intakePreflight`.

### P0: Source-of-truth linked to missing demo artifacts

`docs/SOURCE_OF_TRUTH.md` linked to:

- `docs/demo/STARTUP_DILIGENCE_PROOF_LEDGER.md`
- `docs/WEDGE.md`
- `docs/showcase/noderoom-diligence-deck.html`

Those files were absent. This pass restores the linked artifacts and adds the demo plan, skill, and live-eval plan.

### P1: Startup-diligence media is now captured, but still split across two clips

This pass adds and captures `startup-diligence-live-join` in `scripts/walkthroughs/specs.ts`. The feature starts at the landing page, creates a fresh live startup-diligence room, exposes the share code, joins a second user by code, and records a coordination message.

This pass also captures `startup-diligence-war-room` as the broader synthesis clip: research enrichment, concurrent public agent work, private banker lane, trace receipts, and draft-only downstream handoff. The final capture uses a focused two-panel layout so the sheet and Copilot read better in README-sized media.

### P1: Live root needs a bad-session guard

The review found `https://noderoom.live/` could blank because a room-scoped Convex query received `roomId: "undefined"`. This pass rejects poisoned persisted live sessions in `src/ui/App.tsx` and makes `src/app/store.tsx` skip all room-scoped Convex subscriptions unless the live session has usable room, actor, and token strings.

### P1: Live Convex deployment had stale functions

Playwright initially showed `FunctionPathNotFound` while loading `?create=...`; the frontend was newer than the dev Convex deployment. Running `npx convex dev --once` synced the functions, after which direct live create loaded the Startup Banking Diligence War Room with seeded research, memo, wall, Q3 sheet, and downstream handoff buttons.

### P1: Downstream handoff must stay draft-labeled

The code supports downstream draft cards, not live OAuth side effects. Demo copy must say "downstream-ready drafts" until user-authorized connector adapters exist and pass live tests.

### P1: Handoff draft card overflowed the Copilot panel

Saved visual evidence showed the handoff card clipped into the right edge of the Copilot column. This pass adds bounded Copilot handoff CSS so the card stacks below chat and the buttons grid within the panel. Build passes after the fix.

Follow-up: the latest live-join frame shows the handoff card contained in the Copilot panel and includes Gmail, Notion, Slack, Linear, LinkedIn, and CRM CSV.

### P2: War-room media still has presentation-only density polish

Startup media is split by asset. Live-join remains publishable in run
`20260614T233419Z` (`10.9/16`, one P2 transition note). The current war-room
asset is publishable in run `20260617T2015Z` (`10.4/16`, no defects reported).
The trace font/spacing and walkthrough holds have been increased since the
older combined review.

### P2: Live-join media still benefits from an explicit transition

The combined media judge rates the live-join clip publishable, and the script now labels browser switches to Priya and Alex. If it becomes the primary hero media, add a visible transition treatment between browser perspectives.

### Closed: `docs/diagrams/01-architecture.drawio` is tracked

`git ls-files docs/diagrams/01-architecture.drawio` confirms the architecture diagram is tracked. Keep it only if it stays aligned with the current NodeAgent/Convex architecture; otherwise replace it with a generated README-safe diagram in a follow-up.

## Verification Run

- `npm run typecheck -- --pretty false`: pass.
- `npx tsc --noEmit --project convex\tsconfig.json --pretty false`: pass.
- `npm run build`: pass, with only existing Vite chunk-size warnings.
- `npm test -- --run`: 89 files, 501 tests pass.
- `npm run test:product:memory`: 27 browser tests pass.
- `npm run media:gemini-judge -- --only startup-diligence --include-ignored`:
  live-join publish evidence is run `20260614T233419Z`; current war-room publish
  evidence is run `20260617T2015Z`.

## Next Product Push

1. Repeat the provider-produced startup eval N=5 and promote only if p95 latency, route/path drift, and pass rate meet the live collaboration SLO.
2. Add a visible user-perspective transition and public/private lane transition to the walkthrough renderer if we want to clear the remaining media P2 notes.
3. Keep official benchmark claims yellow until official fixtures/runs are recorded.

## 2026-06-14 Target Alignment Update

- README now leads with the startup-diligence war-room and live-join GIFs instead of burying them behind generic clips.
- `startup-diligence-war-room` now invokes a startup-specific `/demo multi-agent` scenario: CardioNova intake, five-company bulk diligence, runway/milestone chart work, no-clobber proof, private banker lane, and draft-only handoff.
- `startup-diligence-live-join` now scripts Maya, Priya, and Alex in the same live room with CardioNova/bulk diligence and runway/milestone ownership.
- `docs/eval/startup-diligence-war-room-live.json` now records the proof boundary so deterministic UI evidence, Convex contract evidence, and one provider-produced proof are distinguishable from repeated N=5/p95 route-stability evidence.
- Startup media evidence is split: live-join `publish 10.9/16` in Gemini run
  `20260614T233419Z`, and current war-room `publish 10.4/16` in run
  `20260617T2015Z` with no defects reported.
