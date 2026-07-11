# NodeRoom Component Map

Captured: 2026-07-08

Purpose: map the approved UI contract onto the current production app without
changing behavior. Design artifacts are evidence to critique, not visual
authority to reproduce. `src/features` is not a distinct folder in this repo;
today the behavior-bearing UI lives mostly under `src/ui`, `src/app`, `convex`,
and `src/engine`. During the migration, shared primitives and shell wrappers
should absorb presentation changes before feature files are touched.

## Migration Boundaries

- Behavior source of truth: latest production/main app.
- Visual source of truth: `docs/design/UI_CONTRACT.md` and its approved
  surface-specific contracts. Source screenshots and standalone exports are
  evidence that may be kept, refined, or rejected; similarity is not approval.
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

## Mobile Shell Map

The detailed mobile contract lives in
`docs/design/mobile/MOBILE_COMPONENT_MAP.md`. The shell boundary is:

| Region | Production owner | Approved adapter | Preserved behavior |
|---|---|---|---|
| Route/bootstrap | `src/ui/App.tsx`, `src/ui/mobile/MobileRoot.tsx` | No visual rewrite | Universal phone routing, memory/live split, create/join/demo/leave, consent, session restore. |
| Theme | `src/ui/mobile/mobile.tokens.css` | Semantic light/dark selectors | Light canonical default, explicit dark opt-in, terracotta/attention/success/danger semantics. |
| Header | `src/ui/mobile/shell/MobileHeader.tsx` | `MobileHeader` | Room switching, Review, Jobs, People, Trace, Share, Settings, activity/usage access; stable command meanings. |
| Safe area/frame | `src/ui/mobile/MobileFrame.tsx`, `mobile.shell.css`, `mobileFrame.css` | Production bleed plus explicit preview frame | Real safe-area insets in production; synthetic status chrome only in explicit device preview. |
| Navigation/composer | `src/ui/mobile/MobileApp.tsx` | Existing bottom navigation and contextual composer/FAB | Every tab, composer mode, agent route, attachment, model, voice, and quick action remains reachable. |
| Sheets | `MobileSheets.tsx`, `MobileGapSheets.tsx`, `MobileDeck.tsx`, `MobileFiles.tsx` | Existing bottom-sheet contracts | Review, jobs, trace, people, share, settings, rooms, governed artifacts, approvals, receipts, and honest fallbacks. |
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
| `src/ui/workArtifacts/workArtifactTypes.ts` | `WorkArtifactViewModel`, receipt/action/ref contracts for spreadsheet, notebook, wall, deck, graph, trace, proposal, and export artifacts. | Unified artifact proof bundle; read-only adapter layer over existing room state. |
| `src/ui/workArtifacts/workArtifactAdapters.ts` | Engine artifact, proposal, trace, semantic graph, deck, and export mappers. | `WorkArtifactsPanel`; preserves existing artifact/proposal/trace data and callbacks. |
| `src/ui/workArtifacts/deckStoryboard.ts` | Storyboard-first deck plan and deck artifact input conversion. | `WorkArtifactsPanel`; first deck slice, no backend/schema changes. |
| `src/ui/workArtifacts/deckPatchPlan.ts` | Deterministic reviewer patch plan for storyboard gaps, unsupported claims, and linked proposals. | `DeckStoryboardWorkbench`; read-only review/export artifact, no deck mutation. |
| `src/ui/workArtifacts/deckPreviewExport.ts` | Deterministic storyboard-to-HTML deck preview/export. | `DeckStoryboardWorkbench`; derived preview file, no collaborative state changes. |
| `src/ui/workArtifacts/deckPdfExport.ts` | Deterministic storyboard-to-PDF export. | `DeckStoryboardWorkbench`; client-side binary download, no backend render job. |
| `src/ui/workArtifacts/deckPptxExport.ts` | Deterministic storyboard-to-PPTX OpenXML export. | `DeckStoryboardWorkbench`; client-side binary download, no backend writes. |
| `src/ui/workArtifacts/graphRelationshipReview.ts` | Deterministic source-backed vs needs-confirmation relationship review over semantic graph edges. | `GraphRelationshipReviewWorkbench`; read-only review/export artifact, no graph storage mutation. |
| `src/ui/workArtifacts/livePerformanceSummary.ts` | Public chat and NodeAgent live-performance summary model. | `LivePerformanceCenter`; derives from existing messages, traces, run/job telemetry, attempts, and stream detail receipts. |
| `src/ui/workArtifacts/notebookExecutionPreview.ts` | Read-only calculation/SQL/chart execution preview for typed notebook blocks. | `NotebookDigestWorkbench`; safe arithmetic/parser preview only, no kernel or editor mutation. |
| `src/ui/workArtifacts/notebookStructure.ts` | Notebook block/section/source digest for legacy HTML and ProseMirror-like note documents. | Notebook work-artifact receipts; read-only, no editor/sync mutation changes. |
| `src/ui/workArtifacts/notebookPatchDiff.ts` | Word-level before/after notebook patch diff model. | `NotebookDigestWorkbench`; proposal preview only, no editor mutation. |
| `src/ui/workArtifacts/notebookTypedBlocks.ts` | Typed analytical notebook block classification. | `NotebookDigestWorkbench`; read-only text/evidence/calculation/decision/open-question/etc. chips over existing notebook blocks. |
| `src/ui/workArtifacts/proofBundleReceipt.ts` | Deterministic proof-bundle receipt sidecar model. | `WorkArtifactsPanel`; future export flows should reuse this receipt contract. |
| `src/ui/workArtifacts/traceReplaySummary.ts` | Deterministic trace replay phase summary. | Future trace/export receipts; groups existing trace rows without changing trace storage. |
| `src/ui/workArtifacts/DeckStoryboardWorkbench.tsx` | Openable storyboard-first deck review surface. | `WorkArtifactsPanel`; opens generated deck plans in-place and routes source actions back to real artifacts. |
| `src/ui/workArtifacts/NotebookDigestWorkbench.tsx` | Openable notebook digest and patch-preview surface. | `WorkArtifactsPanel`; opens derived notebook block/section/source receipts in-place, shows proposal-backed patch previews, and routes `Open editor` back to the real notebook artifact. |
| `src/ui/workArtifacts/ProposalReviewCenter.tsx` | Agent workpaper review center and proposal filter model. | `WorkArtifactsPanel`; derives review cards from existing proposals and calls existing proposal resolver callbacks. |
| `src/ui/workArtifacts/proofBundleExport.ts` | Proof-bundle JSON sidecar manifest. | `WorkArtifactsPanel`; downloads receipt/replay/artifact manifest without backend writes. |
| `src/ui/workArtifacts/TraceReplayWorkbench.tsx` | Openable trace replay and live-performance summary surface. | `WorkArtifactsPanel`; opens trace phases/critical path/recent events in-place and routes artifact refs back to real artifacts. |
| `src/ui/workArtifacts/LivePerformanceCenter.tsx` | Public chat, NodeAgent job/run telemetry, and stream receipt strip. | `WorkArtifactsPanel`; summarizes public messages and existing telemetry, and opens trace replay. |
| `src/ui/workArtifacts/WorkArtifactsPanel.tsx` | Room proof bundle panel. | `src/ui/panels/Artifact.tsx` Artifacts pseudo-tab. |
| `src/ui/graph/semanticGraphPaths.ts` | Ranked relevant connection paths for selected graph nodes. | `EntityGraphDetailPanel`; highlights person/company/evidence/project/source relationships without changing graph storage. |
| `src/ui/graph/semanticGraph.ts` | Derived semantic proof graph for artifacts, people, evidence, traces, proposals, decks, slides, and claims. | `KnowledgeGraph`, `WorkArtifactsPanel`; remains read-only over current room state. |
| `../NodeGraph/src/relationshipReview.ts` | Public package mirror of graph relationship confirmation review. | `NodeGraph` npm/public repo consumers; same source-backed vs needs-confirmation receipt model outside NodeRoom. |

Migrated component mappings in this slice:

| Legacy surface | New layer | Files changed | Behavior preserved |
|---|---|---|---|
| Room top bar/settings/modal shell | `Panel`, `Badge`, `Button`, `IconButton`, `Switch`, `Modal`, Cloud CSS tokens | `src/ui/RoomShell.tsx`, `src/ui/primitives/*`, `src/ui/tokens.css` | Panel toggles, resize, auto-allow confirmation, focus mode, tour, invite copy, leave, command palette actions. |
| Wide desktop room shell composition | Maximized `RoomFrame` CSS adaptor | `src/ui/RoomShell.tsx`, `src/ui/primitives/primitives.css` | Existing room route, artifact selection, panel toggles, resize handles, chat lanes, status strip, guided tour, and all data/store calls. |
| Binder rail rows/search/upload/review/person groups | Cloud panel and row skin | `src/ui/LeftRail.tsx`, `src/ui/primitives/primitives.css` | Artifact open, proposal open, search filtering, people/agent data rendering. |
| Chat composer/messages/run receipts | Cloud message and composer skin | `src/ui/Chat.tsx`, `src/ui/primitives/primitives.css` | Send/edit/retry, mentions, attachments, agent job controls, artifact refs, lane behavior. |
| Work surface tabs/grid/notebook/trace entry | Cloud work-surface skin | `src/ui/panels/Artifact.tsx`, `src/ui/primitives/primitives.css` | Tab switching, grid editing, selected cells, trace/notebook/wall/report surfaces, inline rename. |
| Spreadsheet, notebook, proposal, coach, and specialized trace interiors | Cloud interior skin | `src/ui/primitives/primitives.css`, `src/ui/panels/notebook-paper.css`, `src/ui/panels/trace-run.css`, `tests/notebookPaper.test.tsx` | Cell editing, selected cells, render windowing, proposal approval/rejection, notebook ProseMirror sync/blur commit, trace record tabs, flow selection, observability export, run span expansion. |
| Command palette, people panel, guided tour, dialogs, form states | Shared overlay/form/state skin | `src/ui/primitives/primitives.css`, `src/ui/RoomShell.tsx` | Keyboard navigation, focus trap, outside click/Escape close, follow behavior, ARIA/test contracts. |
| Standalone mobile surface (the 2026-07-08 Cloud overlay is superseded) | Approved semantic terracotta shell and explicit device-preview frame | `src/ui/mobile/mobile.tokens.css`, `src/ui/mobile/mobile.shell.css`, `src/ui/mobile/MobileFrame.tsx` | Mobile router, sample/live modes, sheets, gestures, composer, note capture, join/consent mechanics. |
| Always-On public room modal/forms/errors | Shared public-room/overlay skin | `src/ui/primitives/primitives.css` | Public tabs, subscribe form validation, double-opt-in honesty, modal close/focus behavior. |
| Mixed work-artifact proof bundle | `WorkArtifactsPanel`, `WorkArtifactViewModel`, artifact receipts | `src/ui/workArtifacts/**`, `src/ui/panels/Artifact.tsx` | Existing artifacts, proposals, traces, semantic graph, exports, and artifact-open callbacks remain data-backed. |
| Storyboard-first deck artifact | `DeckStoryboard`, `DeckArtifactInput`, contract doc | `src/ui/workArtifacts/deckStoryboard.ts`, `docs/design/DECK_STORYBOARD_CONTRACT.md` | Storyboard derives from room artifacts/traces/proposals and flags unsupported claims as review, without replacing slide/editor behavior. |
| Storyboard-derived deck patch plan | `DeckPatchPlan`, patch counts, before/after review rows, Patch JSON action | `src/ui/workArtifacts/deckPatchPlan.ts`, `src/ui/workArtifacts/DeckStoryboardWorkbench.tsx`, `src/ui/workArtifacts/work-artifacts.css`, `tests/workArtifacts.test.ts` | Patch plans derive from existing storyboard gaps, unverified claims, source refs, traces, and proposals; they do not apply edits, resolve proposals, or create collaborative deck state. |
| Storyboard-derived deck preview/export | `DeckPreviewExport`, HTML preview action, cleaned claim text | `src/ui/workArtifacts/deckPreviewExport.ts`, `src/ui/workArtifacts/deckStoryboard.ts`, `src/ui/workArtifacts/DeckStoryboardWorkbench.tsx`, `src/ui/workArtifacts/work-artifacts.css` | Preview/export derives from the deck plan and does not become collaborative state; existing slide/editor paths remain untouched. |
| Storyboard-derived portable PPTX export | `DeckPptxExport`, PPTX download action, deterministic OpenXML package | `src/ui/workArtifacts/deckPptxExport.ts`, `src/ui/workArtifacts/DeckStoryboardWorkbench.tsx`, `tests/workArtifacts.test.ts` | PPTX export derives from existing storyboard claims/gaps/receipts, downloads client-side, and does not create backend deck state or alter slide editor behavior. |
| Storyboard-derived portable PDF export | `DeckPdfExport`, PDF download action, deterministic PDF package | `src/ui/workArtifacts/deckPdfExport.ts`, `src/ui/workArtifacts/DeckStoryboardWorkbench.tsx`, `tests/workArtifacts.test.ts` | PDF export derives from existing storyboard claims/gaps/receipts, downloads client-side, and does not create backend render jobs, storage writes, or deck editor state. |
| Notebook work artifact digest | `NotebookArtifactStructure`, notebook contract doc | `src/ui/workArtifacts/notebookStructure.ts`, `docs/design/NOTEBOOK_WORK_ARTIFACT_CONTRACT.md` | Existing notebook ProseMirror/legacy editor, keyboard, sync, read-model, and governed NodeAgent write paths remain untouched. |
| Typed notebook block adapter | `NotebookTypedBlock`, type summary chips, unique digest block ids | `src/ui/workArtifacts/notebookTypedBlocks.ts`, `src/ui/workArtifacts/notebookStructure.ts`, `src/ui/workArtifacts/NotebookDigestWorkbench.tsx` | Type labels derive from existing block text/source/proposal state and do not create executable notebook runtimes or mutate editor content. |
| Entity graph relevant paths | `SemanticGraphConnectionPath`, `rankSemanticConnectionPaths`, detail panel path rows | `src/ui/graph/semanticGraphPaths.ts`, `src/ui/graph/semanticGraphSelectors.ts`, `src/ui/graph/EntityGraphDetailPanel.tsx`, `src/ui/graph/semanticGraph.ts` | Graph remains derived from current room artifacts/traces/proposals; selected people/companies now surface ranked source-backed paths and notebook-block citations. |
| Proof-bundle receipt sidecar | `ProofBundleReceipt`, `buildProofBundleReceipt` | `src/ui/workArtifacts/proofBundleReceipt.ts`, `src/ui/workArtifacts/WorkArtifactsPanel.tsx` | Receipt hashes and known gaps derive from current work artifacts; no backend export or durable state changes. |
| Trace replay summary | `TraceReplaySummary`, `buildTraceReplaySummary` | `src/ui/workArtifacts/traceReplaySummary.ts` | Existing trace rows are grouped into room, chat, agent, edit, review, and notebook phases; no trace schema/runtime changes. |
| Openable storyboard-first deck workbench | `DeckStoryboardWorkbench`, selected deck rows, source buttons | `src/ui/workArtifacts/DeckStoryboardWorkbench.tsx`, `src/ui/workArtifacts/WorkArtifactsPanel.tsx`, `src/ui/workArtifacts/workArtifactAdapters.ts`, `src/ui/workArtifacts/work-artifacts.css` | Deck plans remain derived/read-only; row opens in-place, and source buttons use existing artifact-open callbacks to real artifacts. |
| Openable notebook digest workbench | `NotebookDigestWorkbench`, selected notebook rows, editor handoff, patch previews | `src/ui/workArtifacts/NotebookDigestWorkbench.tsx`, `src/ui/workArtifacts/WorkArtifactsPanel.tsx`, `src/ui/workArtifacts/notebookStructure.ts`, `src/ui/workArtifacts/work-artifacts.css` | Notebook digests and patch previews remain derived/read-only; row opens in-place, `Open editor` uses the existing artifact-open callback, and proposals remain governed by existing resolver behavior. |
| Notebook patch diff previews | `NotebookPatchDiff`, before/after added/removed token rows | `src/ui/workArtifacts/notebookPatchDiff.ts`, `src/ui/workArtifacts/NotebookDigestWorkbench.tsx`, `src/ui/workArtifacts/work-artifacts.css`, `tests/workArtifacts.test.ts` | Diffs derive from existing proposal values and block text, render only in the digest preview, and do not alter ProseMirror editor state or proposal resolution. |
| Notebook execution preview | `NotebookExecutionPreview`, safe arithmetic results, SQL/chart intent cards | `src/ui/workArtifacts/notebookExecutionPreview.ts`, `src/ui/workArtifacts/NotebookDigestWorkbench.tsx`, `src/ui/workArtifacts/work-artifacts.css`, `tests/workArtifacts.test.ts` | Execution previews derive from typed notebook blocks and never run arbitrary code, start kernels, mutate editor content, or write backend state. |
| Agent workpaper review center | `ProposalReviewCenter`, proposal review filters, host approve/reject buttons | `src/ui/workArtifacts/ProposalReviewCenter.tsx`, `src/ui/workArtifacts/WorkArtifactsPanel.tsx`, `src/ui/panels/Artifact.tsx`, `src/ui/workArtifacts/work-artifacts.css` | Proposal cards derive from existing `store.listProposals`; approve/reject delegates to `store.resolveProposal`; source buttons open real artifacts. |
| Proof-bundle export sidecar | `ProofBundleExportManifest`, Receipt JSON action | `src/ui/workArtifacts/proofBundleExport.ts`, `src/ui/workArtifacts/WorkArtifactsPanel.tsx`, `src/ui/workArtifacts/work-artifacts.css` | JSON export derives from current artifacts, receipt, and replay summary; no backend state or existing XLSX/file export behavior changes. |
| Openable trace replay workbench | `TraceReplayWorkbench`, selected trace rows, critical path/event summaries | `src/ui/workArtifacts/TraceReplayWorkbench.tsx`, `src/ui/workArtifacts/WorkArtifactsPanel.tsx`, `src/ui/workArtifacts/traceReplaySummary.ts`, `src/ui/workArtifacts/work-artifacts.css` | Trace replay remains derived/read-only; row opens in-place, and artifact refs use existing artifact-open callbacks when present. |
| Public chat/live performance summary | `LivePerformanceCenter`, `LivePerformanceSummary`, trace replay handoff | `src/ui/workArtifacts/livePerformanceSummary.ts`, `src/ui/workArtifacts/LivePerformanceCenter.tsx`, `src/ui/workArtifacts/WorkArtifactsPanel.tsx`, `src/ui/workArtifacts/work-artifacts.css` | Public message counts, NodeAgent run/job telemetry, stream/detail receipts, and trace counts derive from existing store APIs; private chat and backend behavior are untouched. |
| Storyboard-backed proof graph paths | `deck`, `deck_slide`, `deck_claim` semantic nodes; claim-source paths | `src/ui/graph/semanticGraph.ts`, `src/ui/graph/semanticGraphTypes.ts`, `src/ui/graph/semanticGraphPaths.ts`, `src/ui/graph/semanticGraphSelectors.ts`, `src/ui/graph/semanticGraphLayout.ts`, `src/ui/panels/KnowledgeGraph.tsx` | Deck/storyboard graph nodes derive from room artifacts/traces/proposals and connect back to real source artifacts, notebook blocks, evidence facts, trace steps, and proposal nodes without backend graph mutations. |
| Graph relationship confirmation review | `GraphRelationshipReviewPlan`, graph row open state, Review JSON action | `src/ui/workArtifacts/graphRelationshipReview.ts`, `src/ui/workArtifacts/GraphRelationshipReviewWorkbench.tsx`, `src/ui/workArtifacts/WorkArtifactsPanel.tsx`, `src/ui/workArtifacts/work-artifacts.css`, `tests/workArtifacts.test.ts` | Relationship review derives from the current semantic graph and classifies source-backed versus inferred/proposal-linked edges without writing graph storage, Neo4j/Cognee state, or backend mutations. |
| Public NodeGraph relationship review | `buildGraphRelationshipReviewPlan` exported from NodeGraph | `../NodeGraph/src/relationshipReview.ts`, `../NodeGraph/src/index.ts`, `../NodeGraph/tests/semanticGraph.test.ts`, `../NodeGraph/README.md` | Public repo receives the same pure relationship-review receipt primitive while NodeRoom-specific deck/storyboard contracts stay in NodeRoom. |
| Collaborative deck adaptor | `CollaborativeDeck`, CAS version receipt, deck presence, create/save/duplicate/delete/reorder | `src/ui/workArtifacts/collaborativeDeck.ts`, `src/ui/workArtifacts/DeckStoryboardWorkbench.tsx`, `src/ui/workArtifacts/WorkArtifactsPanel.tsx` | Persist through the existing note/artifact store, retain source actions and all exports, and never replace room data with static slides. |
| Safe notebook kernel adaptor | `NotebookKernelRequest`, calculation/SQL/chart result receipts | `src/notebook/notebookKernel.ts`, `convex/notebookKernel.ts`, `src/ui/workArtifacts/notebookKernelAdapter.ts`, notebook workbench files | Keep the editor as source of truth; allow only bounded arithmetic, read-only SQL intent, and chart intent; persist traceable outputs without arbitrary execution. |
| Semantic graph cluster controls | cluster selector, hop depth, relevant-path focus, controlled drag measurements | `src/ui/graph/semanticGraphClusters.ts`, `src/ui/panels/KnowledgeGraph.tsx` | Derive clusters from the current semantic graph, preserve source-backed paths and node dragging, and do not mutate graph/backend state. |
| Scoped chat context picker | artifact, deck-slide, proposal, and trace references | `src/ui/artifactRefs.ts`, `src/ui/Chat.tsx` | Preserve public/private lanes, send/edit/retry/stream/attachment/NodeAgent behavior; route selected context through the existing message path as an openable reference. |

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
