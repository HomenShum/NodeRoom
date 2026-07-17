# Mobile Terracotta Work Artifact Contract

Status: active build contract
Date: 2026-07-09

This contract scopes the mobile terracotta + governed work-artifact push. The
mobile source design is a product reference, not a static mock replacement:
production mobile must remain backed by the live room store, proposal state,
trace rows, evidence, and work-artifact adapters.

## Source References

- Source design root: `C:/Users/hshum/Downloads/NodeAgent-handoff_07062026/nodeagent/project/mobile/app-terracotta/`
- Main prototype controller: `na-app.jsx`
- Governed deck workbench: `na-deck.jsx`
- Prototype data model: `na-data.js`
- Prototype skin: `na.css`
- Captured reference screenshot: `docs/design/ui-contract/20260707-design-source/mobile-terracotta-390x844.png`
- Current production mobile proof screenshot: `docs/design/ui-contract/20260708-migration-proof/after-feature-skin-mobile-390x844.png`
- Work-artifact plan: `docs/synthesis/WORK_ARTIFACTS_IMPLEMENTATION_AND_DOGFOOD_PLAN.md`
- Work-artifact progress receipt: `docs/synthesis/WORK_ARTIFACTS_PROGRESS_RECEIPT.md`

## Product Rule

Mobile is the review and approval surface for governed artifacts. Deep
composition can remain desktop-first, but mobile must let a reviewer understand
what changed, inspect evidence, ask for a scoped patch, accept or reject the
patch, and audit the trace or receipt.

## Visual Contract

The target mobile skin is the light terracotta design:

- Cream app and sheet surfaces.
- Terracotta primary accent and selection color.
- Warm ink text, muted clay borders, and restrained shadows.
- Serif display accents for room and artifact titles.
- iOS-style bottom navigation, floating action, sheet handles, and safe-area
  spacing.
- Artifact-card home with compact type signatures: deck filmstrip, sheet grid,
  plan checklist, evidence source stack.
- Deck sheet with thumbnail strip, sandboxed slide preview, scoped composer,
  patch tray, evidence tab, export tab, and present overlay.

Dark mobile mode may remain available as a setting, but the default terracotta
reference is light.

## Governed Deck Contract

The deck flow must stay review-first:

1. Plan first: show goal, reads, non-reads, creates, cost, and guardrails.
2. Preview only: slide rendering is sandboxed and does not mutate room state.
3. Scoped request: tapping/clicking a slide element scopes the composer to that
   element.
4. Patch proposal: NodeAgent returns before/after text plus evidence and risk.
5. Human gate: the slide changes only after accept; rejection keeps the original
   and records the request.
6. Evidence tab: sources and gaps come from live room evidence where available.
7. Export tab: export state is honest; real files require a receipt, and
   unavailable export stays labeled as pending or preview-only.
8. Receipt: planned-vs-actual data, trace ids, proposal ids, source gaps, and
   versions are visible.

## Live Data Contract

Production mobile may use sample data only in standalone/demo mode. In a live
room:

- `MobileAppLive` is the source for room name/code, members, public/private
  chat, recents, proposals, jobs, plan, evidence, coach, pipeline, trace rows,
  people groups, invite code, watches, and offline holds.
- `MobileDeck` should prefer live deck/work-artifact input when present.
- If no live deck exists, the deck sheet must show an honest empty/review state
  or derived storyboard preview, not the CardioNova sample deck as if it were
  the room output.
- Proposal accept/reject must use existing proposal callbacks where possible.
- Agent writes must remain proposal-first and behind existing room tools.

## Current Gap

As of this contract, `src/ui/mobile/MobileDeck.tsx` is still primarily backed by
`D.DECK` from `src/ui/mobile/mobileData.ts`. `MobileAppLive.tsx` already derives
live plan, evidence, proposals, jobs, recents, trace rows, and pipeline data,
but the deck workbench does not yet consume a live deck/storyboard payload.

## Non-Goals

- Do not rewrite mobile routing, join/create flow, session handling, or store
  boot behavior.
- Do not change Convex/backend schemas for this slice.
- Do not change NodeAgent core/frame behavior unless a focused test requires it.
- Do not revert existing proofloop/eval/work-artifact lane changes.
- Do not fake export success, source coverage, or proposal resolution.

## Acceptance Gates

- Focused tests pass:
  - `npm test -- --run tests/mobileGapScreens.test.tsx tests/mobileAgentModelRouting.test.tsx tests/workArtifacts.test.ts tests/semanticGraph.test.ts`
- Typecheck passes:
  - `npm run typecheck -- --pretty false`
- NodeAgent smoke gates pass:
  - `npm run nodeagent:frame:smoke`
  - `npm run omnigent:nodeagent:smoke`
- Mobile browser proof shows the light terracotta shell at 390x844.
- Mobile deck proof shows governed plan/preview/patch/evidence/export behavior
  with honest live or fallback state.
- Receipts list baseline failures, screenshots, known gaps, and resume commands.
