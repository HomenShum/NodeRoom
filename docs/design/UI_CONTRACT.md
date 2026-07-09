# NodeRoom UI Contract

Captured: 2026-07-08

This contract is the first migration artifact for a behavior-preserving visual
refresh. Product behavior remains sourced from the current production/main app.
The Cloud Design artifacts are visual references only: they define shell,
surface, token, and component direction, not new product logic.

## Source Artifacts

Primary standalone workspace supplied for this slice:

- Source: `C:/Users/hshum/Downloads/NodeRoom Workspace (standalone).html`
- Title: `NodeRoom - Workspace`
- Size: `3386754` bytes
- SHA-256: `C8EE4877E6CF5914AF29B6FDC411D33AA43DA8C8EAB200D530A633E4206A976B`
- Captured screenshots: `docs/design/ui-contract/20260708-standalone-workspace/`
- Manifest: `docs/design/ui-contract/20260708-standalone-workspace/manifest.json`

Earlier bundle already present in this repo:

- Source root: `C:/Users/hshum/Downloads/NodeAgent-handoff_07062026/nodeagent/project`
- Primary index: `NodeRoom - Index.html`
- Parity checklist: `cross/feature-map/feature-map.html`
- Build handoff: `cross/handoff/PROD-PARITY-HANDOFF.md`
- Existing screenshot root: `docs/design/ui-contract/20260707-design-source/`
- Design-system kernel: `shared/colors_and_type.css`, `shared/page-shell.css`,
  `shared/chrome.css`, `shared/badges.css`, `shared/density.css`,
  `shared/nav.css`

The `20260707-design-source` bundle remains the broad parity reference. The
`20260708-standalone-workspace` captures the user-supplied all-surfaces
workspace and is the immediate source for this migration slice.

## Standalone Workspace Surfaces

The standalone file mounts a persistent workspace rail and swaps these surfaces
inside the stage. These are references for visual coverage; production routes
must remain the source of behavior.

| Surface key | Label | Contract role | Screenshot |
|---|---|---|---|
| `rooms` | Rooms | Main diligence room: binder, grid, public chat, receipts, live presence. | `rooms-1456x940.png` |
| `console` | Console | Single-mission runtime and operator shell. | Not recaptured in this slice. |
| `memoryWall` | Memory Wall | Optimistic multiplayer canvas. | Not recaptured in this slice. |
| `alwaysOn` | Always-On Rooms | Recurring rooms and digest/operator UX. | Not recaptured in this slice. |
| `trace` | Trace UI | Run receipts, spans, evidence, provenance. | `trace-1456x940.png` |
| `notebook` | Notebook | Saved-report paper and reading surface. | Not recaptured in this slice. |
| `states` | States & Scale | Dense states, scale behavior, binder/grid/chat stress cases. | `states-scale-1456x940.png` |
| `fixPack` | Prod UI Fix Pack | Corrected grid and calm-mode annotations. | `fix-pack-1456x940.png` |
| `knowledgeMap` | Knowledge Map | Findings and relationship graph. | `knowledge-map-1456x940.png` |

## Behavior Baseline

Current app entry points observed in `src/ui/App.tsx`:

| Entry point | Current behavior to preserve |
|---|---|
| root with no hash/query | Landing. Uses Convex-backed live app when configured; falls back to in-memory demo otherwise. |
| `?room=<code>&name=<name>` | Join existing live room, restoring a local live session when available. |
| `?create=<code>&name=<name>&title=<title>` | Create an atomic starter room through Convex, then convert URL to join mode. |
| `?demo=<code>&name=<name>` | Create the startup banking diligence demo room through the same server-side starter mutation. |
| `#mobile` / `#/mobile` | Mobile surface and mobile query router. |
| `#room-tour` / `#/room-tour` | Lazy-loaded room tour. |
| `#rooms/<slug>` / `#/rooms/<slug>` | Lazy-loaded Always-On public room page. |
| `#story` / `#/story` | Landing story, then normal live or memory room entry. |
| `#btb` / `#/btb` | BankerToolBench seeded room plus live ledger panel when Convex is present. |
| `#hackwithbay` / `#/hackwithbay` | HackwithBay seeded room. |
| `#upscalex` / `#/upscalex` | UpScaleX seeded room. |
| `#frontier` / `#/frontier` | Frontier observations panel outside the room store bootstrap. |

Major user actions to preserve:

- Create, join, demo, and leave room flows.
- Live URL rewriting, session persistence, local/session token handling, and
  friendly join/create errors.
- Copy invite URL from the room code control.
- Panel open/close, compact/mid/wide defaults, split view, resizing, and
  artifact focus.
- Public/private Copilot lanes, private coach mode, slash-to-chat keyboard jump,
  command palette actions, and guided tour anchors.
- Chat send/edit/retry, `@nodeagent` mention menu, model preset controls, file
  attachment, upload status, cancel/retry/regenerate job controls, and public
  room-visible/private reply separation.
- Artifact tabs, spreadsheet editing, selected-cell focus, row/source
  navigation, notebook/report/wall/trace surfaces, and side-by-side artifact
  opening.
- Agent proposals, auto-allow/review policy, Focus Mode, passive intelligence
  inbox, notifications, people/presence/follow, trace lens, receipts, loading,
  error, empty, and offline-held states.
- Always-On public room tabs, read-only proof footer, subscribe modal, ops gate,
  missing-room state, and mobile public-room controls.

High-risk files and folders for visual migration:

- Do not change backend or durable behavior: `convex/**`, `backend/**`,
  `src/engine/**`, `src/nodeagent/**`, `src/security/**`, `src/notifications/**`,
  `src/app/store.tsx`, `src/app/roomStore.ts`, or API/auth/session contracts.
- Treat these as behavior-bearing UI files: `src/ui/App.tsx`,
  `src/ui/RoomShell.tsx`, `src/ui/Chat.tsx`, `src/ui/panels/Artifact.tsx`,
  `src/ui/LeftRail.tsx`, `src/ui/PeoplePanel.tsx`,
  `src/ui/NotificationsInbox.tsx`, `src/ui/CommandPalette.tsx`,
  `src/ui/primitives/FocusTrapDialog.tsx`, `src/ui/mobile/**`, and
  `src/alwayson/**`.
- Prefer wrappers, token changes, and shared primitives over rewrites inside
  feature state machines.

## Baseline Validation

Run before this documentation update:

| Command | Result |
|---|---|
| `npm run design:audit` | Pass. Token drift reported `473` warnings; warnings are guidance only. The canonical bundle `design-reference/assets/colors_and_type.css` was absent, so the audit reported `token-canonical-missing`. |
| `npm test -- --run tests/designSystemManifest.test.ts` | Pass: 1 file, 8 tests. |
| `npm run typecheck -- --pretty false` | Pass. |

## Visual Contract

Direction:

- Calm, work-focused, dense, and legible.
- Data and work surface lead by default; apparatus appears on hover, focus,
  expansion, or when a receipt matters.
- Fewer boxed containers. Use hairline dividers, quiet surfaces, and stable
  layout regions instead of stacked cards.
- Less saturated page background. Prefer flat near-black/default app surfaces
  over decorative glows. Subtle source-artifact gradients are references, not a
  requirement for production default.
- Larger central work surface, with binder and Copilot behaving as supporting
  rails.
- Clear focus and active states, especially for keyboard users.

Tokens extracted from the standalone artifact:

| Token area | Contract |
|---|---|
| Fonts | UI/display: Inter/system stack. Mono: JetBrains Mono. Notebook paper may use Lora/serif. |
| Accent | Terracotta selection/focus: `#D97757`; hover: `#C76648`; warm ink: `#E59579`/`#AD5F45`. |
| Secondary signal | Indigo `#5E6AD2`/`#8C92E0` for non-primary status or agent metadata, not as a page-wide theme. |
| Semantic colors | Success green only for completed/healthy states. Warning amber for held/review states. Danger red only for errors/failures. |
| Backgrounds | Dark workspace base around `#101317`, app surface around `#09090b` to `#111418`, secondary surface around `#171b20`. Light theme remains white/gray tokenized. |
| Typography scale | 11, 12, 13, 14, 15, 17, 20, 26, 31, 40 px. |
| Radius scale | 4, 6, 8, 10, 12, 16, pill. Compact controls should stay near 8 px; large shell/panel frames may use 12-16 px when matching the source. |
| Shadows | Default to flat or low elevation. Use strong shadows only for overlays, dialogs, popovers, or dragged/floating surfaces. |
| Spacing | 4 px base. Dense controls should use 6-12 px internal gaps; page/shell regions use 10-18 px rails; major sections use 24-32 px. |

Layout rules:

- Root app shell owns the global background and height. Feature screens should
  not create their own page backgrounds unless they are standalone routes.
- Room shell has stable regions: top bar, left binder, center work surface,
  right Copilot/chat, optional bottom status rail.
- Side rails are structural, not content cards. Avoid cards inside cards.
- Work surfaces should preserve stable dimensions for grids, tab strips,
  status rails, icon buttons, counters, and cells so state changes do not
  resize the layout.
- Mobile routes translate rails into sheets/tabs and keep desktop hover details
  available through explicit controls.

Interaction-state rules:

- Active tabs use clear underlines or quiet filled states, not bulky blocks.
- Hover/focus should reveal hidden affordances without shifting layout.
- Focus rings must be visible in dark and light themes.
- Receipts are product objects: source count, version transition, lock release,
  row/cell target, and trace link must stay visible through compact cards or
  drawers.
- Empty, loading, error, offline, failed, cancelled, blocked, pending, running,
  and completed states must remain first-class UI states.

Non-goals for this migration:

- Do not rewrite the app.
- Do not replace dynamic product state with static mockups.
- Do not remove a route, action, state, callback, API call, mutation, query,
  auth/session behavior, realtime behavior, proof receipt, or evidence state
  because it is absent from the design artifact.
- Do not weaken proofloop, NodeAgent, Convex, backend, or trace contracts to
  make a visual gate pass.

## Migration Rule

Every changed file must be classifiable as one of these:

- Presentation only: tokens, CSS variables, class names, layout wrappers,
  visual primitives, responsive structure, focus/hover styling.
- Adapter only: a new component wraps existing props/callbacks/state without
  changing the underlying behavior.
- Tiny compatibility fix: only if a compile/type error directly requires it.

Any change to API calls, state shape, routing, persistence, auth/session,
backend functions, Convex functions, agent runtime, or tool behavior is outside
this visual migration unless explicitly approved.

## Migration Status

Implemented in the 2026-07-08 visual slice:

- Added shared Cloud tokens and reusable UI primitives for button, icon button,
  panel, badge, tabs, switch, modal, popover, search/input, loading, empty, and
  error states.
- Migrated the app shell region: background, top bar, left rail, work surface,
  right Copilot panel, bottom status rail, settings controls, and modal chrome.
- Migrated shared feature styling for artifact tabs, spreadsheet/grid chrome,
  notebook/proof cards, chat messages, run receipts, trace/observability rows,
  command palette, people panel, guided tour, form inputs, empty/error/loading
  states, and Always-On public room subscribe states.
- Completed the deeper feature-interior follow-up for spreadsheet grids,
  notebook editor paper/read-model chrome, proposal review cards, coach cards,
  trace record details, trace flow, trace observability, and trace run trees.
  This pass keeps the same data, edit, proposal, and trace handlers while
  reducing boxed surfaces, parchment color, heavy shadows, and log-like chrome.
- Added a composition parity correction after visual review against the
  standalone workspace screenshots. The production UI should use only the
  live-room frame from the reference, not the standalone gallery page wrapper:
  no page-level hero/context band, one maximized rounded room frame, flatter
  side/work/chat panes, quieter binder rows, and a darker app canvas.
- Migrated the standalone mobile surface from the old warm paper palette to
  Cloud dark tokens while preserving the mobile router, sheets, gestures,
  composer, and join/consent flows.
- Preserved the honest absence of notifications on in-memory rooms:
  `NotificationsInbox` still renders only for Convex rooms with proof.

Proof screenshots written under
`docs/design/ui-contract/20260708-migration-proof/`:

- `after-shell-desktop-1456x940.png`
- `after-shell-mobile-390x844.png`
- `after-feature-skin-home-1456x940.png`
- `after-feature-skin-sheet-1456x940.png`
- `after-feature-skin-trace-1456x940.png`
- `after-feature-skin-alwayson-1280x900.png`
- `after-shared-states-room-1456x940.png`
- `after-shared-states-command-palette-1456x940.png`
- `after-shared-states-room-controls-1456x940.png`
- `after-shared-states-auto-accept-modal-1456x940.png`
- `after-shared-states-people-panel-1456x940.png`
- `after-shared-states-mobile-390x844.png`
- `after-shared-states-alwayson-subscribe-1280x900.png`
- `after-shared-states-alwayson-error-1280x900.png`
- `after-interiors-spreadsheet-grid-1456x940.png`
- `after-interiors-notebook-editor-1456x940.png`
- `after-interiors-proposal-cards-1456x940.png`
- `after-interiors-trace-flow-1456x940.png`
- `after-interiors-trace-observability-1456x940.png`
- `after-interiors-trace-runs-1456x940.png`
- `after-composition-parity-home-1456x940.png`
- `after-composition-parity-trace-1456x940.png`
- `after-composition-parity-company-research-1456x940.png`

## Proof Requirements

Design parity is not complete until all are true:

- Source-design screenshots exist and are referenced from the contract.
- Current production behavior has a baseline route/action checklist.
- Each migrated region has before/after screenshots.
- `npm run typecheck -- --pretty false`, focused tests, and `npm run design:audit`
  pass or failures are documented as pre-existing baseline failures.
- Browser verification uses normal product paths. Do not claim completion from
  static screenshots or worker assertions alone.
