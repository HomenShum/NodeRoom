# NodeRoom Mobile Visual QA Report

Status: local implementation and live-development proof pass; production blocked

Captured: 2026-07-09

## Scope And Lane Boundary

This pass implements the critic-first mobile shell migration on top of the
existing terracotta/work-artifacts lane. The earlier lane already supplied the
live storyboard projection, mobile work-artifact types, and first terracotta
proof recorded in `docs/synthesis/MOBILE_TERRACOTTA_RALPH_RECEIPT.md`. This
pass preserves those edits and adds the semantic shell, stable header,
production/preview frame boundary, honest sheet adapters, governed-deck
structure repair, navigation, accessibility gates, and visual certification.

No backend, NodeAgent core, immutable certification asset, or proof-loop gate
was weakened or reverted. The worktree was already broadly dirty; unrelated
desktop, benchmark, proofloop, graph, and work-artifact changes remain owned by
their existing lanes.

## Sources And Decision

`MOBILE_REFERENCE_INVENTORY.md` records the inspected Terracotta App, regular
Mobile App, At Scale, Gap Pack, and Capture Prototype exports with byte counts
and SHA-256 hashes. The actual exports were inspected; the catalog was not used
as a substitute.

KEEP: light terracotta identity, artifact-card home, serif artifact titles,
bottom navigation, governed deck/evidence sheets, and honest live fallbacks.

REFINE: card density, quick actions, semantic color roles, dark contrast,
settings hierarchy, and narrow-width geometry.

REJECT: production synthetic status chrome, boxed gradient mark, outlined room
pill, dynamic header-action semantics, persistent pulse telemetry, duplicate
FAB navigation, late theme overlays, and primary design-tuning controls.

## Implemented Contract

- `mobile.tokens.css` owns semantic light/dark/accent tokens.
- `mobile.shell.css` owns the full-height shell, stable frame geometry, header,
  navigation, touch targets, and production/preview chrome boundary.
- `MobileHeader.tsx` provides one room-context control, stable Review, stable
  ellipsis Overflow, bounded `9+`, and long-title truncation.
- `MobileFrame.tsx` renders synthetic device chrome only in explicit preview
  mode; production is full bleed.
- `MobileApp.tsx` keeps all six destinations reachable through a persistent,
  layout-reserved bottom navigation and keeps quick actions contextual.
- Jobs, Trace, Review, People, Room activity, Usage, Share, and Settings use
  live context where available and label unavailable data honestly.
- `MobileDeck.tsx` keeps plan, thumbnails, slide preview, element-scoped
  request, proposal decisions, evidence, and export/receipt affordances as
  siblings. Live rooms never substitute the CardioNova fixture for missing
  live storyboard data.
- Mobile settings expose product settings first; visual tuning is under
  Advanced. Light/dark selection resolves through one token layer.

## Behavior Preservation

The preservation ledger remains `MOBILE_BEHAVIOR_INVENTORY.md`. Focused tests
cover route normalization, join/create/demo consent, live sample separation,
all six tabs, stable header actions, proposal accept/reject, live jobs and
trace adapters, public/private/room-agent routing, model selection, governed
deck structure, offline states, and secondary sheets. NodeAgent and Omnigent
smokes pass without mobile code mutating their cores.

Known product limitations remain explicit:

- A governed live storyboard exports real PPTX bytes with filename, slide
  count, timestamp, and integrity receipt. Historical restore/download remains
  desktop-only and is labeled as such.
- Live deck revision requests go through the room agent and land in the real
  proposal/trace path; proposal accept/reject remains in mobile Inbox.
- Live mobile capture/upload is not wired. Empty rooms guide the user into a
  room-visible read-only NodeAgent plan instead of simulating persistence.
- Account-authenticated proof is blocked because the app has no auth provider;
  the passing live test is a room-token development session.
- A 2026-07-10 fresh-origin production recheck proved the public deployment is
  stale: it uses the old abstract H1, exposes no Join/Sample choice, and its
  Create CTA still requests `surface=desktop`. Deployment parity is not claimed.

## Visual Proof

Before captures are in `docs/design/mobile/artifacts/before/`. Final captures,
long-title stress captures, governed-deck proof, videos, and Playwright traces
are in `docs/design/mobile/artifacts/final/`.

The browser contract checks 320x568, 375x812, 390x844, and 430x932 in light
and dark modes. It asserts no body overflow beyond one pixel, no production
synthetic status bar, a 52px header row plus safe area, stable Review and
Overflow actions, at least 44px visible button targets, six reachable bottom
destinations, non-overlapping shell geometry, deck sibling structure, and all
secondary sheets.

## Gate Ledger

| Gate | Result |
|---|---|
| Behavior inventory before code | Pass |
| Source exports and hashes | Pass |
| NodeAgent frame smoke | Pass |
| Omnigent NodeAgent smoke | Pass; external `omni` CLI not installed |
| Typecheck | Pass |
| Production build | Pass; existing chunk-size warning |
| Design audit | Pass |
| Focused Vitest mobile/work-artifact/session suite | Pass, 99 tests; final honesty subset 49/49 |
| Mobile Playwright contract/story/first-run proof | Pass, 28/28 including live Convex development create |
| Four-width light/dark screenshots | Pass |
| Focused mobile release-bar case | Pass |
| ProofLoop doctor | Pass, 11 checks |
| Full Vitest | 2066/2072 pass; six official-score/proofloop expectations remain in the other lane |
| Independent contract judgment | Pass, 10.0 |
| Independent taste judgment | Blocked, 5.5 taste / 6.0 topbar after 3 loops |
| Deployed mobile-shell verification | Fail: stale public landing and desktop-forcing Create CTA; no release was made from the mixed tree |

## Independent Judgments

The exact loop record is `mobile-visual-judge-after.json`.

Gemini taste judgment A scored the successive loops at 6.0, 5.5, and 5.5.
The final response identified one medium navigation-density concern plus two
low concerns, but still scored taste 5.5 and topbar 6.0. The maximum three
loops were exhausted, so no further prompt-tuning or unbounded visual churn was
performed.

A separate Gemini contract judgment B scored taste 8.5, topbar 8.5, contract
10.0, reference similarity 9.5, and `READY`, with no listed issues. The
contract result proves the implementation bar but does not override the
independent taste gate.

## Final Decision

The mobile implementation is locally usable and deterministically proven,
including a real development-room creation. The combined ship gate does not
pass. Release remains blocked on the taste decision, a clean reviewed release,
Convex production alignment, account auth, and post-deploy authenticated proof.
No full-completion claim is made.
