# NodeRoom Component Map

Captured: 2026-07-08

Purpose: map the Cloud Design visual contract onto the current production app
without changing behavior. `src/features` is not a distinct folder in this repo;
today the behavior-bearing UI lives mostly under `src/ui`, `src/app`, `convex`,
and `src/engine`. During the migration, shared primitives and shell wrappers
should absorb presentation changes before feature files are touched.

## Migration Boundaries

- Behavior source of truth: latest production/main app.
- Visual source of truth: `docs/design/UI_CONTRACT.md` plus the source
  screenshots under `docs/design/ui-contract/`.
- Preferred migration pattern: add wrapper/adaptor components that preserve
  current props, callbacks, state transitions, store calls, Convex calls, and
  DOM test contracts.
- Do not change `convex/**`, `backend/**`, `src/engine/**`, `src/nodeagent/**`,
  auth/session logic, database schemas, or durable trace/proofloop contracts for
  visual parity work.

## Component Map

| Current owner | Current surface | Target primitive/adaptor | Behavior to preserve | Visual changes allowed |
|---|---|---|---|---|
| `src/app/styles.css` | Global tokens, shell, grid, chat, landing, modal, mobile-adjacent classes. | `tokens.css`, `theme.css`, shared utility layers. | Existing class contracts, dark/light theme variables, focus visibility, design audit invariants. | Token consolidation, lower-noise background, radius/spacing scale cleanup, hairline dividers, hover/focus states. |
| `src/ui/App.tsx` | Hash/query router, live vs memory app, Convex session entry. | RouteShell only if needed; otherwise no visual primitive. | All routes, lazy-loading, mobile URL normalization, create/join/demo semantics, local session restore, leave cleanup. | Loading fallback styling only. Do not refactor routing for design parity. |
| `src/ui/RoomShell.tsx` | Room top bar, workspace layout, panel state, Copilot tabs, status rail, tweaks, guided tour. | `AppShell`, `TopBar`, `WorkspaceLayout`, `StatusStrip`, `SettingsPopover`. | Panel defaults, compact/mid/wide behavior, resizing, split view, invite copy, auto-allow, focus mode, tour anchors, command palette actions. | Calm top bar, flatter brand mark, quieter room code pill, cleaner rail toggles, status rail density, reduced background glow. |
| `src/ui/LeftRail.tsx` | Room Binder, artifact tree, people/agent snippets, search, review queue. | `LeftRail`, `BinderTree`, `TreeSection`, `TreeRow`, `SearchField`. | Artifact open callbacks, proposal open, person/agent focus, collapsed counts, search filtering, data-testid contracts. | Nested tree polish, active selection, count chips, section spacing, less card-like grouping. |
| `src/ui/Chat.tsx` | Public/private chat, composer, mention menu, uploads, job controls, receipts, run stream. | `ChatPanel`, `ChatMessage`, `ChatComposer`, `AgentReceiptCard`, `RunProgressCard`. | Send/edit/retry, `@nodeagent`, lane semantics, attachments, cancel/retry/regenerate, job details, stream/reasoning/progress states, artifact reference opening. | Message density, day dividers, collapsed receipt styling, pinned composer polish, segmented controls, source/version/lock receipt presentation. |
| `src/ui/panels/Artifact.tsx` | Work surface tabs, sheets, notebook/wall/report/trace entry points, source/cell affordances. | `WorkSurface`, `SurfaceTabs`, `DataGrid`, `ArtifactCard`, `EvidenceChip`. | Tab switching, grid editing, CAS-safe store calls, selected cell focus, row/source navigation, render windowing, upload/source metadata, loading/error/empty states. | Grid density, tab underline, filter/toolbar styling, cell focus ring, calm provenance chips, stable row heights. |
| `src/ui/panels/TraceSurface.tsx` and trace panels | Evidence capture, trace records, observability, flow, filmstrip. | `TraceDrawer`, `ReceiptList`, `EvidencePanel`, `TraceStepRow`. | Capture mode, SEC/web inputs, honesty gate, tab switching, downloads, trace record selection, artifact open callbacks. | Receipt hierarchy, compact rows, clearer evidence classes, less log-like chrome. |
| `src/ui/PeoplePanel.tsx` | People dialog, follow mode, live location, grouped members. | `PeoplePanel`, `PresenceRow`, `FollowPill`. | Open/close behavior, outside click handling, follow polling, artifact tab activation, group expansion. | Panel shell, row density, status chips, focus-visible state. |
| `src/ui/NotificationsInbox.tsx` and `src/ui/insights/**` | Bell, passive room intelligence, noteworthy inbox. | `Popover`, `InboxList`, `InsightChip`, `BatchActionBar`. | Watch toggles, mark-read actions, research/add/practice/dismiss flows, cost preview, policy controls. | Popover surface, chip tone hierarchy, row density, batch bar styling. |
| `src/ui/CommandPalette.tsx` | Keyboard command launcher. | `CommandPalette`, `CommandItem`. | Keyboard navigation, commands, artifact opening, chat focusing, existing ARIA roles. | Overlay styling, item spacing, active row state, token-aligned shadows. |
| `src/ui/primitives/FocusTrapDialog.tsx` | Shared modal behavior. | `Modal`, `DialogPanel`, `Scrim`. | Focus trap, Escape/scrim close, ARIA modal semantics, restore path where provided. | Modal radius/shadow/backdrop tokens only. |
| `src/ui/mobile/**` | Mobile shell, live bootstrap, sheets, chat, grid, settings. | `MobileShell`, `BottomSheet`, `MobileTabs`, `MobileComposer`, `MobileGrid`. | Mobile router, live create/join consent, room URL semantics, gestures, sheets, mobile-only state handling. | Translate desktop rails to bottom sheets/tabs, improve density, preserve real-phone constraints. |
| `src/alwayson/**` | Public read-only room, cards, tabs, subscribe modal. | `PublicRoomFrame`, `PublicRoomTabs`, `SubscribeDialog`, `PublicCard`. | Demo/live source stamp, read-only state, tabs, ops gate, unknown slug, double opt-in honesty, modal dismissal. | Public-room chrome, cards, mobile card surfaces, focus states. |
| `src/ui/artifacts/**` | Banker coach and artifact-specific visual cards. | `ArtifactCard`, `CoachCard`, `EvidenceCarousel`. | Export, draft-to-notebook, evidence open callbacks, severity/data attributes. | Card radius, chip styling, grid spacing, lower visual noise. |

## Primitive Backlog

Build these before region migrations:

| Primitive | Intended owner | Notes |
|---|---|---|
| `Button` / `IconButton` | `src/ui/primitives/` | Wrap current `r-btn`/`r-iconbtn` patterns without changing click behavior. Use icons for icon-only commands. |
| `Panel` / `Surface` | `src/ui/primitives/` | Shared hairline surface for rails, work panes, popovers, and dialogs. Avoid nested cards. |
| `Input` / `SearchField` | `src/ui/primitives/` | Preserve current native input behavior and test IDs. |
| `Badge` / `StatusPill` / `Chip` | `src/ui/primitives/` | Separate selection, status, warning, danger, source, and receipt tones. |
| `SegmentedControl` / `Tabs` | `src/ui/primitives/` | Used for Copilot lanes, private modes, artifact tabs, trace tabs, and mobile tabs. |
| `Switch` / `Checkbox` | `src/ui/primitives/` | Used by auto-allow, focus mode, digest/watch controls, and settings. |
| `Modal` / `Popover` | `src/ui/primitives/` | Built on `FocusTrapDialog` for dialogs; non-modal popovers keep explicit close paths. |
| `EmptyState` / `LoadingState` / `ErrorState` | `src/ui/primitives/` | Preserve current honest state language and actions; only presentation changes. |

Implemented primitive files in this slice:

| Primitive file | Components/classes | Current adopters |
|---|---|---|
| `src/ui/tokens.css` | Cloud token aliases for surfaces, hairlines, accent, radius, and elevation. | Imported globally from `src/app/main.tsx`. |
| `src/ui/primitives/designSystem.tsx` | `Button`, `IconButton`, `Switch`, `Panel`, `Badge`, `Tabs`, `TextInput`, `SearchField`, `EmptyState`, `LoadingState`, `ErrorState`, `Popover`, `Modal`. | `RoomShell`, `LeftRail`, `Chat`, `Artifact`; available for remaining feature slices. |
| `src/ui/primitives/primitives.css` | Late-loaded visual skin for shell, panels, overlays, forms, popovers, trace, chat, artifact, mobile-adjacent, and Always-On states. | Global presentation layer; keeps existing data-testid and behavior classes. |

Migrated component mappings in this slice:

| Legacy surface | New layer | Files changed | Behavior preserved |
|---|---|---|---|
| Room top bar/settings/modal shell | `Panel`, `Badge`, `Button`, `IconButton`, `Switch`, `Modal`, Cloud CSS tokens | `src/ui/RoomShell.tsx`, `src/ui/primitives/*`, `src/ui/tokens.css` | Panel toggles, resize, auto-allow confirmation, focus mode, tour, invite copy, leave, command palette actions. |
| Wide desktop room shell composition | Maximized `RoomFrame` CSS adaptor | `src/ui/RoomShell.tsx`, `src/ui/primitives/primitives.css` | Existing room route, artifact selection, panel toggles, resize handles, chat lanes, status strip, guided tour, and all data/store calls. |
| Binder rail rows/search/upload/review/person groups | Cloud panel and row skin | `src/ui/LeftRail.tsx`, `src/ui/primitives/primitives.css` | Artifact open, proposal open, search filtering, people/agent data rendering. |
| Chat composer/messages/run receipts | Cloud message and composer skin | `src/ui/Chat.tsx`, `src/ui/primitives/primitives.css` | Send/edit/retry, mentions, attachments, agent job controls, artifact refs, lane behavior. |
| Work surface tabs/grid/notebook/trace entry | Cloud work-surface skin | `src/ui/panels/Artifact.tsx`, `src/ui/primitives/primitives.css` | Tab switching, grid editing, selected cells, trace/notebook/wall/report surfaces, inline rename. |
| Spreadsheet, proposal, coach, and specialized trace interiors | Cloud interior skin | `src/ui/primitives/primitives.css`, `src/ui/panels/trace-run.css` | Cell editing, selected cells, render windowing, proposal approval/rejection, trace record tabs, flow selection, observability export, run span expansion. |
| Desktop notebook paper, intelligence, and artifact-detail interior | `CloudNotebookSurface`, deferred `NotebookIntelligenceTray`, dense `NotebookDigestWorkbench` | `src/ui/panels/Artifact.tsx`, `src/ui/panels/notebook-paper.css`, `src/ui/workArtifacts/WorkArtifactsPanel.tsx`, `src/ui/workArtifacts/NotebookDigestWorkbench.tsx`, `src/ui/workArtifacts/work-artifacts.css` | ProseMirror/legacy editing, blur commits, typed block read model, kernel run/cancel/output persistence, patch review/approval, citations, provenance, hashes, loading/error/empty states. Visual changes may remove cream/serif paper, compact typography and whitespace, flatten rows, and defer intelligence behind a 34px disclosure. |
| Command palette, people panel, guided tour, dialogs, form states | Shared overlay/form/state skin | `src/ui/primitives/primitives.css`, `src/ui/RoomShell.tsx` | Keyboard navigation, focus trap, outside click/Escape close, follow behavior, ARIA/test contracts. |
| Standalone mobile surface | Cloud mobile token overlay and frame chrome | `src/ui/mobile/mobile.css`, `src/ui/mobile/mobileFrame.css` | Mobile router, sample/live modes, sheets, gestures, composer, note capture, join/consent mechanics. |
| Always-On public room modal/forms/errors | Shared public-room/overlay skin | `src/ui/primitives/primitives.css` | Public tabs, subscribe form validation, double-opt-in honesty, modal close/focus behavior. |

## PR-Sized Build Order

1. Contract and component map only. This file is that slice.
2. Add primitive wrappers and token aliases while keeping existing CSS class
   contracts working.
3. Migrate global app shell/background/top bar/status rail.
4. Migrate left binder and navigation.
5. Migrate Copilot/chat panel and receipts.
6. Migrate work-surface tabs/grid/artifact cards.
7. Migrate empty/loading/error/offline/mobile/public-room states.
8. Run visual QA, before/after screenshots, focused tests, typecheck, and
   design audit.

## File Touch Policy

Allowed in visual slices:

- `src/app/styles.css` token/class refinements.
- New files under `src/ui/primitives/` or a future `src/ui/layout/`.
- Presentation wrappers that pass existing props and callbacks through.
- Focus/hover/responsive CSS that does not alter state transitions.

Needs extra review:

- Any edit to `src/ui/App.tsx`, `src/app/store.tsx`, `src/app/roomStore.ts`,
  `src/ui/Chat.tsx`, `src/ui/panels/Artifact.tsx`, or `src/ui/RoomShell.tsx`
  that changes control flow, state shape, store calls, Convex calls, route
  handling, keyboard behavior, or test IDs.

Not allowed for design parity:

- Backend/schema/auth/session/runtime/proofloop changes.
- Replacing live data with static design data.
- Removing a state because it is not present in the Cloud Design artifact.
- Weakening design, proof, trace, or NodeAgent gates to make visual work pass.
