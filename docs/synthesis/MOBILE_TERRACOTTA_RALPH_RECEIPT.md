# Mobile Terracotta RALPH Receipt

Date: 2026-07-09
Loop id: `loop_f2f59c09-fa51-4a37-a8d6-d4c908b89b48`
Goal status: active

This receipt tracks the mobile terracotta + governed work-artifact push. It
does not claim completion until the proof gates pass.

## R - Reality / Research

### Dirty Worktree Boundary

The worktree was dirty before this mobile loop started. Existing changes span:

- `.proofloop/lanes/**`
- benchmark/eval docs and scripts
- `src/ui/workArtifacts/**`
- `src/ui/graph/**`
- `src/ui/mobile/MobileGapSheets.tsx`
- `src/ui/mobile/mobile.css`
- `src/ui/App.tsx`, `src/ui/RoomShell.tsx`, `src/ui/panels/Artifact.tsx`
- mobile/e2e/proofloop tests

Execution rule: this loop must preserve and integrate those changes, not revert
them. New mobile edits should be scoped to mobile UI, mobile tests, design/docs,
work-artifact adapters only when needed, and proof receipts.

### Source Design Inventory

- `app-terracotta/na-app.jsx`: mobile controller and sheet routing.
- `app-terracotta/na-deck.jsx`: governed deck artifact workbench.
- `app-terracotta/na-data.js`: CardioNova seed model and deck data.
- `app-terracotta/na.css`: light terracotta skin.
- `docs/design/ui-contract/20260707-design-source/mobile-terracotta-390x844.png`: captured reference.
- `docs/design/ui-contract/20260708-migration-proof/after-feature-skin-mobile-390x844.png`: current migrated mobile proof, currently dark Cloud-token oriented.

### Current Implementation Inventory

- `src/ui/mobile/MobileApp.tsx` owns mobile routing, tabs, sheets, composer,
  theme/density/accent attributes, and `ArtifactSheet` mounting.
- `src/ui/mobile/MobileAppLive.tsx` maps live store state into `MobileLive`:
  recents, proposals, jobs, plan, evidence, coach, pipeline, trace rows,
  people groups, invite code, watches, offline holds, and proposal resolution.
- `src/ui/mobile/MobileDeck.tsx` is a strict TSX port of the prototype deck
  workbench, but still consumes `D.DECK` and `D.EVIDENCE` directly.
- `src/ui/mobile/mobileData.ts` contains the seed deck, evidence, plan, inbox,
  recents, and CardioNova sample data.
- `src/ui/mobile/mobile.css` contains the terracotta token system and deck
  workbench styles, but the current captured production proof is dark.
- `src/ui/workArtifacts/**` already contains a read-only work-artifact layer,
  deck storyboard derivation, and notebook digest layer.

### Baseline Commands

| Command | Status |
| --- | --- |
| `npm run proofloop -- doctor --json` | pass |
| `npm run typecheck -- --pretty false` | pass |
| `npm run nodeagent:frame:smoke` | pass |
| `npm run omnigent:nodeagent:smoke` | pass, with Omnigent CLI noted as not locally installed |
| `npm test -- --run tests/mobileGapScreens.test.tsx tests/mobileAgentModelRouting.test.tsx tests/workArtifacts.test.ts tests/semanticGraph.test.ts` | pass, 54 tests |
| `npm run proofloop -- manifest --dense` | pass |
| `npm run proofloop -- ui contract --dense` | pass |

## A - Acceptance Bar

The loop passes only when:

1. Mobile default visual target is the light terracotta reference, especially
   artifact-card home and governed deck sheet.
2. Mobile deck review is live/proof-backed where live data exists:
   plan -> slide preview -> element-scoped request -> sourced patch proposal ->
   accept/reject -> evidence -> export/receipt.
3. Live rooms do not present sample-only CardioNova success as real output.
4. Existing NodeAgent, Omnigent, proofloop, mobile routing, join/create,
   proposal, trace, and collaboration behavior remains intact.
5. Other-lane work is preserved and integrated.

## L - Live Build Plan

Initial safe build order:

1. Add the mobile contract doc.
2. Add live deck/work-artifact input shapes to mobile types.
3. Derive a mobile deck/storyboard payload from live artifacts/proposals/traces
   in `MobileAppLive.tsx`.
4. Update `MobileDeck.tsx` to prefer live payloads and show honest empty state
   when no deck/storyboard exists.
5. Keep standalone/demo behavior backed by `D.DECK`.
6. Tighten terracotta default proof without breaking optional dark mode.
7. Add focused tests for live vs sample deck behavior.

## P - Proof Run Plan

Required proof before completion:

- `npm run nodeagent:frame:smoke`
- `npm run omnigent:nodeagent:smoke`
- `npm run typecheck -- --pretty false`
- `npm test -- --run tests/mobileGapScreens.test.tsx tests/mobileAgentModelRouting.test.tsx tests/workArtifacts.test.ts tests/semanticGraph.test.ts`
- Mobile browser screenshot at 390x844.
- Mobile deck interaction proof or a narrower Playwright/Vitest test if full
  browser automation is blocked.
- ProofLoop doctor/manifest status in this receipt.

## H - Harden Plan

Before claiming done:

- Record changed files.
- Record screenshots and commands.
- Record known gaps and blockers.
- Record whether full ProofLoop gate passed, or why it remains out of scope.
- Preserve resume command:
  `npm run sfn -- loop resume --loop-id loop_f2f59c09-fa51-4a37-a8d6-d4c908b89b48`

## L - Live Build Result

Implemented:

- Added `MobileLive.deck` / `MobileCtx.liveDeck` as an optional live-derived
  mobile deck artifact.
- Derived `liveDeck` in `MobileAppLive.tsx` from the existing
  `buildDeckStoryboardFromRoom` work-artifact adapter using live artifacts,
  proposals, and traces.
- Updated `MobileDeck.tsx` to use live deck/evidence payloads in live rooms.
- Added an honest live empty state when no deck/storyboard exists; sample
  CardioNova slides stay hidden in live rooms.
- Kept standalone/memory demo mode backed by `D.DECK`.
- Changed live deck export to "intent recorded" only until a real file receipt
  exists.
- Restored light terracotta defaults for app and route chrome while preserving
  dark mode behind settings.
- Set the default mobile surface to Home and aligned Settings accent options to
  supported CSS accents.

Focused tests added/updated:

- `tests/mobileDeckLive.test.tsx`
- `tests/mobileAgentModelRouting.test.tsx`
- `e2e/mobile-story-surfaces.spec.ts`

## P - Proof Run Result

| Command | Status |
| --- | --- |
| `npm run nodeagent:frame:smoke` | pass |
| `npm run omnigent:nodeagent:smoke` | pass; Omnigent CLI still not installed locally |
| `npm run typecheck -- --pretty false` | pass |
| `npm test -- --run tests/mobileGapScreens.test.tsx tests/mobileAgentModelRouting.test.tsx tests/mobileDeckLive.test.tsx tests/workArtifacts.test.ts tests/semanticGraph.test.ts` | pass, 61 tests |
| `npx playwright test e2e/mobile-story-surfaces.spec.ts -g "#mobile\|mobile universal"` | pass, 3 passed and live Convex mobile proof skipped by env gate |
| `npm run proofloop -- doctor --json` | pass, 11 checks |
| `npm run proofloop -- manifest --dense` | pass; official-scores status `needs_scaffold_or_run` |
| `npm run proofloop -- gate --goal official-scores` | blocked; broader official score lanes still need model-run/judge/scorer receipts |
| `npm run sfn -- loop verify --milestone P` | blocked; `official_upload`, `real_export`, and `official_scorer` must pass for the global verifier |

Screenshot proof:

- `docs/design/ui-contract/20260709-mobile-terracotta-proof/source-app-terracotta-home-390x844.png`
- `docs/design/ui-contract/20260709-mobile-terracotta-proof/source-app-terracotta-deck-390x844.png`
- `docs/design/ui-contract/20260709-mobile-terracotta-proof/current-mobile-memory-home-390x844.png`
- `docs/design/ui-contract/20260709-mobile-terracotta-proof/current-mobile-memory-deck-390x844.png`
- `docs/design/ui-contract/20260709-mobile-terracotta-proof/screenshot-receipt.json`

Both source and current screenshots report:

- `--bg-app: #FBF4E7`
- `--accent-primary: #C56A3C`
- `overflowX: 0`

## H - Harden Result

RALPH receipts written:

- `.solo/receipts/L-live-build/agent-layer-delta.json`
- `.solo/receipts/L-live-build/app-ui-delta.json`
- `.solo/receipts/L-live-build/transfer-plan.json`
- `.solo/receipts/P-proof-run/live-ui-proof.json`
- `.solo/receipts/P-proof-run/scorer-receipt.json`
- `.solo/proof-verdict.json`
- `.solo/receipts/H-harden/cost-ledger.json`
- `.solo/receipts/H-harden/improvement-candidates.json`

Known gaps:

- RALPH loop status is blocked at P. L is verified; H receipts are written but
  H is not started because P cannot verify without global proof gates.
- Live mobile export is still intent-only until a real PPTX/file export job
  returns a receipt.
- Live deck patch accept/reject is preview-local; persistent deck patch writes
  need a proposal/work-artifact mutation path.
- Full live Convex mobile Playwright proof was not run because
  `PLAYWRIGHT_EXPECT_MOBILE_LIVE=1` was not set.
- Global ProofLoop `official-scores` gate is blocked by benchmark scoring lanes
  outside this mobile slice.
