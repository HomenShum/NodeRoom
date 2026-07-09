# Cloud Design Migration Proof

Captured: 2026-07-08

## Changed Files

Presentation and documentation:

- `docs/design/UI_CONTRACT.md`
- `docs/design/COMPONENT_MAP.md`
- `docs/design/ui-contract/20260708-standalone-workspace/*`
- `docs/design/ui-contract/20260708-migration-proof/*`
- `src/ui/tokens.css`
- `src/ui/primitives/designSystem.tsx`
- `src/ui/primitives/primitives.css`
- `src/ui/panels/notebook-paper.css`
- `src/ui/panels/trace-run.css`
- `src/ui/mobile/mobile.css`
- `src/ui/mobile/mobileFrame.css`
- `tests/notebookPaper.test.tsx`

Behavior-preserving component adopters:

- `src/app/main.tsx`
- `src/engine/demoRoom.ts`
- `src/ui/RoomShell.tsx`
- `src/ui/LeftRail.tsx`
- `src/ui/Chat.tsx`
- `src/ui/panels/Artifact.tsx`

No backend, Convex schema/function, auth, NodeAgent, or durable trace logic was
modified for this migration. The in-memory demo seed in `src/engine/demoRoom.ts`
was updated to exercise the standalone Q3 diligence visual state.

## Validation

| Command | Result |
|---|---|
| `npm run typecheck -- --pretty false` | Pass |
| `npm test -- --run tests/runTrace.test.ts tests/traceObservability.test.ts tests/notebookPaper.test.tsx tests/chatScale.test.ts tests/designSystemManifest.test.ts tests/cellHistoryUi.test.tsx tests/sheetVirtualization.test.ts` | Pass: 7 files, 104 tests |
| `npm run build` | Pass |
| `git diff --check` | Pass; emitted an unrelated CRLF normalization warning for `docs/architecture-budget.json` |
| `lint` | Not available: `package.json` has no `lint` script |

## Gemini Parity Pass

The final comparison used the repo-local Gemini review path. The review compared
the supplied standalone HTML target (`C:\Users\hshum\Downloads\NodeRoom Workspace (standalone).html`)
captured at `.fx-frame` against a fresh Playwright capture of:

`/?mode=memory&surface=desktop&demo=1&name=Homen`

Final artifacts:

- `standalone-room-frame-reference.png`
- `after-gemini-standalone-company-research-1456x940.png`
- `gemini-parity-standalone-final-review.json`
- `standalone-room-frame-reference-metrics.json`
- `gemini-standalone-live-metrics.json`

Final Gemini verdict: `close`, visual similarity score `0.98`.

Gemini summary: layout, typography, color contrast, component styling, and
spacing are highly accurate. Remaining P2 differences are seed-data inventory
only: exact open tab list, sidebar counts/pinned items, dataframe version, event
count, and timestamps.

## Interior Visual Judge Loop

Additional loop requested for chat live performance, trace view, notebook, and
entity graph, using the standalone HTML as the reference.

Final interior artifacts:

- Chat: `standalone-interior-chat.png`, `after-interior-chat.png`,
  `gemini-chat-final4.json`
- Trace: `standalone-interior-trace.png`, `after-interior-trace.png`,
  `gemini-interior-trace-final.json`
- Notebook: `standalone-interior-notebook.png`, `after-interior-notebook.png`,
  `gemini-interior-notebook-final.json`
- Entity graph: `standalone-interior-graph.png`, `after-interior-graph.png`,
  `gemini-graph-final11.json`, `gemini-graph-final13.json`

Gemini results:

- Chat: `close`, score `0.98`. Remaining notes are dynamic state/content:
  version transitions, active sidebar data, and participant seed differences.
- Trace: `close`, score `0.92`. Remaining notes are left-rail icon mapping,
  chat version badge data, and bottom status metadata.
- Notebook: treated as a manual interior pass after Gemini produced a noisy
  contradictory shell verdict. The document interior now includes breadcrumb,
  paper gutter, claim/status pills, citations, quote treatment, and embedded
  sheet preview while preserving the production room shell.
- Entity graph: best judge pass `close`, score `0.94`; latest full-frame
  judge pass `partial`, score `0.88`, with remaining flags limited to
  seed-data/sidebar hierarchy, topbar open-tab inventory, and chat version
  badge content. The graph interior now uses standalone entity labels,
  radial node distribution, Cloud-reference dot colors, directional side-aware
  arrows, local draggable node correction, neutral pills, and a Cloud-style
  control group in `after-interior-graph.png`.

## Mind Map / Canvas Research Applied

Sources reviewed:

- React Flow performance guidance: memoized custom nodes/functions, avoid broad
  state churn during drags, and render only the useful graph surface.
  Source: https://reactflow.dev/learn/advanced-use/performance
- React Flow layout guidance: keep layout strategy pluggable; Dagre/ELK are
  appropriate for tree-like or heavily structured diagrams, but the room graph
  can stay on the existing React Flow dependency for this scope.
  Source: https://reactflow.dev/learn/layouting/layouting
- Miro mind map guidance: start from a parent node, create branches quickly,
  and allow drag-and-drop rearrangement.
  Source: https://help.miro.com/hc/en-us/articles/360017730753-Mind-map
- Obsidian Canvas guidance: infinite canvas, mixed cards/files, and visible
  connections are the primary mental model.
  Source: https://help.obsidian.md/Plugins/Canvas
- MindMeister layout guidance: auto-layout is useful, but manual drag/drop is
  an explicit supported mode when users need control.
  Source: https://support.mindmeister.com/hc/en-us/articles/360017549439-Customize-Your-Map-s-Layout
- Whimsical guidance: fast flow, keyboard shortcuts, automatic layout/color,
  multiplayer editing, and infinite canvas are table-stakes for modern
  mind-map UX.
  Source: https://whimsical.com/mind-maps
- tldraw performance guidance: smooth canvas performance depends on rendering
  strategies that still hold up with many shapes.
  Source: https://tldraw.dev/sdk-features/performance

Design decisions from that research:

- First load is auto-arranged into a sparse constellation so the graph is useful
  without manual work.
- Nodes are draggable in the entity view, but positions are local React UI state
  only; no backend, schema, trace, or artifact data changes.
- Edges attach to left/right/top/bottom invisible handles based on node
  positions, reducing line/label collisions during drag.
- Direction arrows remain quiet and visible; the best Gemini pass preferred
  subtle arrows over heavier connector lines.
- Canvas chrome is limited to zoom/fit controls and mode tabs so the graph area
  stays dominant.
- Existing React Flow performance choices remain: memoized node type,
  `onlyRenderVisibleElements`, capped default entity nodes, and no new layout
  engine dependency.

## Browser Proof

Receipts:

- `receipt.json`
- `feature-skin-receipt.json`
- `shared-states-receipt.json`
- `feature-interiors-receipt.json`
- `composition-parity-receipt.json`

Source/reference screenshots:

- `../20260708-standalone-workspace/rooms-1456x940.png`
- `../20260708-standalone-workspace/states-scale-1456x940.png`
- `../20260708-standalone-workspace/fix-pack-1456x940.png`
- `../20260708-standalone-workspace/trace-1456x940.png`
- `../20260708-standalone-workspace/knowledge-map-1456x940.png`

After screenshots:

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
- `after-gemini-parity-company-research-1456x940.png`
- `after-gemini-standalone-company-research-1456x940.png`
- `standalone-room-frame-reference.png`
- `standalone-interior-chat.png`
- `after-interior-chat.png`
- `standalone-interior-trace.png`
- `after-interior-trace.png`
- `standalone-interior-notebook.png`
- `after-interior-notebook.png`
- `standalone-interior-graph.png`
- `after-interior-graph.png`

## Preserved Functionality Checklist

- Routes remain unchanged: root, live query routes, `#mobile`, `#room-tour`,
  `#rooms/<slug>`, `#story`, `#btb`, `#hackwithbay`, `#upscalex`, and
  `#frontier`.
- Room create/join/demo/leave behavior, URL rewriting, and local session
  handling were not changed.
- Convex calls, store calls, mutations, queries, auth/session proof handling,
  realtime behavior, and backend contracts were not changed.
- Shell actions remain wired: panel toggles, resizing, invite copy,
  auto-allow confirmation, focus mode, guided tour, command palette, people
  panel, and status strip.
- Wide desktop shell composition now mirrors the live-room area from the
  standalone design: no page-level hero/context band, one maximized rounded
  room frame, quieter binder rows, and no separate card shadows around the
  left/work/right panes.
- Chat actions remain wired: send/edit/retry, mentions, attachments, public and
  private lanes, agent run controls, receipts, and artifact references.
- Artifact actions remain wired: tab switching, grid editing, selected-cell
  focus, notebook/report/wall/trace surfaces, inline rename, and source
  navigation.
- Deeper feature interiors remain wired: spreadsheet filters/density/column
  menu/windowing, notebook ProseMirror sync or blur commit, proposal
  approve/reject actions, trace flow node selection, observability export, and
  trace run span expansion.
- Mobile actions remain wired: mobile router, memory/live split, sheets,
  gestures, composer, note capture, and join/consent mechanics.
- Always-On actions remain wired: public room tabs, subscribe modal validation,
  double-opt-in honesty copy, focus trap, and dismiss paths.

## Known Gaps

- `docs/design/design-source/` is absent in this checkout. The migration used
  the supplied standalone HTML and existing `20260707-design-source` captures.
- Notifications are not screenshotted on the deterministic in-memory route
  because `NotificationsInbox` intentionally renders only for Convex rooms with
  requester proof.
- The final Gemini pass only flags seed-data inventory differences: tab names,
  sidebar counts/pinned items, dataframe version, event count, and timestamps.
  It no longer reports material layout, typography, contrast, spacing, or
  component-styling gaps.
- Interior shell differences remain where the standalone product-surface page
  omits the production live-room frame; the app keeps top tabs, Room Binder,
  right chat, and bottom status to preserve existing room functionality.
