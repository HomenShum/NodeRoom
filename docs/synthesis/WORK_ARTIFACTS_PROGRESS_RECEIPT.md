# Work Artifacts Progress Receipt

Date: 2026-07-09

Goal status: blocked only on interactive Azure authentication for the final
Finch judge. Product implementation, live dogfood, SpreadsheetBench coverage,
FinAuditing, and MBABench certification slices are complete; this receipt does
not claim the final ProofLoop gate until Finch is promoted.

## Completed Slices

### M0 Baseline

- Recorded baseline in `docs/synthesis/WORK_ARTIFACTS_BASELINE_RECEIPT.md`.
- Confirmed typecheck, NodeAgent frame smoke, Omnigent compatibility smoke,
  proofloop doctor, manifest, and UI contract commands.
- Full `npm test -- --run` had 4 pre-existing failures before this slice.

### M1 Unified Work-Artifact Layer

- Added `src/ui/workArtifacts/workArtifactTypes.ts`.
- Added `src/ui/workArtifacts/workArtifactAdapters.ts`.
- Added `src/ui/workArtifacts/WorkArtifactsPanel.tsx`.
- Added `src/ui/workArtifacts/work-artifacts.css`.
- Added read-only Artifacts pseudo-tab in `src/ui/panels/Artifact.tsx`.
- Preserved existing artifact open callbacks and existing proposal, trace,
  graph, and export data sources.

### M2 Storyboard-First Deck Slice

- Added `docs/design/DECK_STORYBOARD_CONTRACT.md`.
- Added `src/ui/workArtifacts/deckStoryboard.ts`.
- Derived deck storyboard artifacts from real room artifacts, traces, and
  proposals.
- Unsupported/manual/proposal-backed deck claims are marked `needs_review`.
- No backend, schema, auth, Convex, NodeAgent core, or slide editor behavior was
  changed.

### M3 Notebook Work-Artifact Digest

- Added `docs/design/NOTEBOOK_WORK_ARTIFACT_CONTRACT.md`.
- Added `src/ui/workArtifacts/notebookStructure.ts`.
- Derived notebook block, section, citation, source, trace, and proposal
  metadata from existing note artifacts.
- Supports legacy HTML notes and ProseMirror-like JSON documents.
- Existing notebook editor, keyboard behavior, sync behavior, read-model
  processing, and governed NodeAgent write paths remain untouched.

### M4 Entity Graph Relevant Paths

- Added `src/ui/graph/semanticGraphPaths.ts`.
- Added `SemanticGraphConnectionPath` to the semantic graph selection contract.
- Selection detail now shows ranked `Relevant Paths` for selected graph nodes.
- Semantic graph derivation now uses notebook block digests for note artifacts,
  so graph paths can include notebook blocks, citations, review gaps, and
  source links instead of collapsing a notebook into one doc node.
- No graph storage, backend, Convex, auth, or NodeAgent core behavior changed.

### M6 Proof-Bundle Receipt Model

- Added `src/ui/workArtifacts/proofBundleReceipt.ts`.
- Added deterministic proof-bundle receipt hashes across mixed artifacts.
- Receipt aggregates artifact kind counts, status counts, evidence ids, source
  ids, trace ids, proposal ids, and known gaps.
- Artifacts panel now shows the short receipt hash in the header.
- This is the export sidecar contract; it does not replace existing export
  mechanisms or create backend state.

### M6 Trace Replay Summary Adapter

- Added `src/ui/workArtifacts/traceReplaySummary.ts`.
- Existing trace rows are grouped into room, chat, agent, edit, review, and
  notebook phases.
- Replay summaries aggregate trace ids, proposal ids, artifact ids, critical
  path phases, status rollups, and deterministic replay hash.
- This is read-only and does not alter trace storage, chat behavior, NodeAgent
  runtime, or backend contracts.

### M7 Openable Deck Storyboard Workbench

- Added `src/ui/workArtifacts/DeckStoryboardWorkbench.tsx`.
- Deck work-artifact rows now open a storyboard workbench inside the Artifacts
  surface instead of trying to open a non-existent generated artifact id.
- Source actions inside the storyboard workbench open the real source artifacts
  through the existing artifact-open callback.
- Existing slide editor/export behavior remains untouched; this is a read-only
  storyboard planning surface backed by current room artifacts, traces, and
  proposals.

### M8 Agent Workpaper Review Center

- Added `src/ui/workArtifacts/ProposalReviewCenter.tsx`.
- Mounted a reusable proposal/workpaper review center in the Artifacts surface.
- Review center derives pending workpapers from existing `store.listProposals`,
  artifacts, and traces.
- Host approve/reject buttons call the existing `store.resolveProposal`
  callback and preserve the current conflict/host-required feedback semantics.
- Source actions open real source artifacts through the existing artifact-open
  callback.
- No proposal schemas, Convex functions, RoomEngine contracts, or NodeAgent
  runtime paths were changed.

### M9 Proof-Bundle Export Sidecar

- Added `src/ui/workArtifacts/proofBundleExport.ts`.
- Added a `Receipt JSON` action to the Artifacts panel.
- The downloaded manifest includes the deterministic proof-bundle receipt, trace
  replay summary, artifact refs/actions, export intent, known gaps, and a
  manifest integrity hash.
- The browser download is client-side only and does not create backend state.
- Existing XLSX/file export paths remain untouched.

### M10 Openable Notebook Digest Workbench

- Added `src/ui/workArtifacts/NotebookDigestWorkbench.tsx`.
- Notebook work-artifact rows now open a digest workbench inside the Artifacts
  surface before handing off to the editor.
- The digest renders existing notebook block, section, authorship, source,
  trace, proposal, and review metadata from `buildNotebookArtifactStructure`.
- The `Open editor` action routes to the real notebook artifact through the
  existing artifact-open callback.
- Existing notebook editor, sync, keyboard, read-model, and NodeAgent-governed
  write behavior remain untouched.

### M11 Openable Trace Replay Workbench

- Added `src/ui/workArtifacts/TraceReplayWorkbench.tsx`.
- Trace work-artifact rows now open a read-only replay workbench inside the
  Artifacts surface.
- The replay renders existing trace phases, critical path, recent events,
  replay hash, proposal counts, and artifact counts from
  `buildTraceReplaySummary`.
- Artifact actions inside replay phases/events route through the existing
  artifact-open callback when trace refs include artifact ids.
- Existing trace storage, trace strip behavior, Run trace tab, chat behavior,
  and NodeAgent runtime paths remain untouched.

### M12 Live Performance Center

- Added `src/ui/workArtifacts/livePerformanceSummary.ts`.
- Added `src/ui/workArtifacts/LivePerformanceCenter.tsx`.
- Mounted a public-room chat and NodeAgent live-performance summary in the
  Artifacts surface.
- The center derives message counts, agent message counts, grouped run ids,
  trace counts, last-run telemetry, long-job telemetry, attempt telemetry, and
  stream/detail receipt counts from existing store APIs.
- The center reads public room chat only; it does not read private chat or
  create new backend subscriptions.
- The `Trace replay` action opens the latest trace replay workbench through
  existing Artifacts-panel state.

### M13 Deck Preview HTML Export

- Added `src/ui/workArtifacts/deckPreviewExport.ts`.
- Added an HTML preview/export action and preview card to
  `DeckStoryboardWorkbench`.
- The preview/export is derived from the structured storyboard plan, includes a
  deterministic integrity hash, and does not become collaborative state.
- Deck storyboard claim extraction now strips legacy note HTML before creating
  deck claims, so the workbench and exported preview do not display raw tags.
- Existing slide editor/export code paths remain untouched.

### M14 Notebook Patch Preview Section

- Added notebook block-level patch preview derivation in
  `NotebookDigestWorkbench`.
- Patch previews match existing proposals to notebook blocks by element id,
  block id, or digest id and display the proposed value without applying it.
- Empty patch state is visible in the notebook digest side rail when the room
  has no notebook proposals.
- Selected deck/notebook/trace workbenches now render above the artifact grid
  and reserve flex height, preventing active interiors from overlapping later
  sections.
- Existing proposal resolver, notebook editor, sync, keyboard, and NodeAgent
  write paths remain untouched.

### M15 Typed Notebook Block Adapter

- Added `src/ui/workArtifacts/notebookTypedBlocks.ts`.
- Notebook digest blocks are classified as typed analytical blocks such as
  text, insight, calculation, evidence, decision, open question, table, chart,
  SQL, and agent proposal.
- Notebook digest UI now shows per-block type chips and a side-rail block type
  summary.
- Fixed notebook digest identity for HTML blocks without `data-blockid` by
  generating stable per-block ids instead of reusing the parent element id.
- Existing notebook editor document values, keyboard behavior, and sync behavior
  remain unchanged.

### M16 Storyboard-Backed Proof Graph Paths

- Added deck, deck-slide, and deck-claim node kinds to the derived semantic
  proof graph.
- Storyboard claims now connect back to source artifacts, evidence facts, trace
  steps, proposal nodes, and notebook blocks through existing graph refs.
- The live Entity graph route now receives the same storyboard-derived graph
  input as the Work Artifacts proof bundle, so graph users can search and select
  deck/storyboard nodes directly.
- Graph controls now expose `Deck`, `Slide`, and `Claim` node filters/labels.
- This remains a read-only graph derivation; no backend graph storage, Neo4j
  sync, Convex schema, auth, or NodeAgent runtime behavior changed.

### M17 Portable PPTX Deck Export

- Added `src/ui/workArtifacts/deckPptxExport.ts`.
- Deck storyboard workbench now offers a `PPTX` export alongside the HTML preview
  export.
- The PPTX export is a deterministic client-side OpenXML package built with the
  existing `jszip` dependency.
- Exported slides use the existing storyboard titles, purposes, claim status,
  unresolved gaps, plan hash, and receipt metadata.
- The export does not create collaborative deck state, does not alter slide
  editor behavior, and does not write to backend/storage.

### M18 Portable PDF Deck Export

- Added `src/ui/workArtifacts/deckPdfExport.ts`.
- Deck storyboard workbench now offers a deterministic `PDF` export alongside
  HTML and PPTX.
- The PDF export is a self-contained client-side PDF writer over the storyboard
  slides, claims, and review gaps.
- It does not add runtime dependencies, backend render jobs, collaborative deck
  state, or storage writes.

### M19 Notebook Patch Diff Preview

- Added `src/ui/workArtifacts/notebookPatchDiff.ts`.
- Notebook patch previews now include a deterministic word-level before/after
  diff model for proposal-backed notebook block changes.
- The digest renders removed and added tokens in the patch preview surface when
  a pending notebook proposal exists.
- This does not touch the ProseMirror editor internals, notebook sync, proposal
  resolution, or NodeAgent write path.

### M20 Deck Patch Plan

- Added `src/ui/workArtifacts/deckPatchPlan.ts`.
- Deck storyboard workbench now derives a deterministic reviewer patch plan from
  storyboard claims, unresolved gaps, linked proposals, traces, and source
  artifact ids.
- The workbench renders patch counts, before/after patch rows, source handoff
  buttons, and a `Patch JSON` client-side export.
- This does not apply deck edits, create collaborative slide state, resolve
  proposals, or mutate backend/storage state.

### M21 Graph Relationship Review

- Added `src/ui/workArtifacts/graphRelationshipReview.ts` and
  `src/ui/workArtifacts/GraphRelationshipReviewWorkbench.tsx`.
- The Proof graph work-artifact row now opens a relationship review surface that
  classifies graph edges as source-backed confirmations or relationships needing
  reviewer confirmation.
- The workbench renders relationship counts, review rows, source handoff
  buttons, and a `Review JSON` client-side export.
- This remains derived from the existing semantic graph and does not create
  graph storage, Neo4j/Cognee sync state, or backend mutations.

### M22 Notebook Execution Preview

- Added `src/ui/workArtifacts/notebookExecutionPreview.ts`.
- Notebook digest now includes an `Execution Preview` card for typed
  calculation, SQL, and chart-like blocks.
- Calculation previews use a small safe arithmetic parser; SQL previews parse
  `SELECT ... FROM ...` intent; chart previews parse chart intent and
  source/series readiness.
- This is a read-only preview layer. It does not execute arbitrary code, run
  backend kernels, mutate notebook editor state, or change notebook sync.

### M23 NodeGraph Public Package Parity

- Updated the sibling public repo `D:/VSCode Projects/cafecorner_nodebench/nodebench_ai4/NodeGraph`.
- Added `src/relationshipReview.ts`, exporting the same deterministic graph
  relationship confirmation model used by NodeRoom.
- Updated `src/index.ts`, `tests/semanticGraph.test.ts`, and `README.md` in
  NodeGraph so public package consumers can build source-backed vs
  needs-confirmation relationship review receipts.
- Committed and pushed NodeGraph branch
  `codex/nodegraph-relationship-review` at commit `c419f34`.
- Opened public NodeGraph PR:
  `https://github.com/HomenShum/NodeGraph/pull/1`.
- This mirrors the reusable graph confirmation primitive only; NodeRoom-specific
  deck storyboard graph inputs remain in NodeRoom until the public package
  accepts deck/storyboard contracts.

### M24 Collaborative Deck State

- Added `src/ui/workArtifacts/collaborativeDeck.ts` and upgraded
  `DeckStoryboardWorkbench.tsx` from derived preview to a CAS-backed deck
  editor adaptor.
- Decks persist through the existing note/artifact path with tag
  `noderoom:deck` and element kind `deck_storyboard`; no static mock store was
  introduced.
- Create, save, duplicate, delete, reorder, presence, patch-request, HTML,
  PPTX, PDF, and patch-plan actions retain their existing source and export
  contracts.
- Live proof created the persisted deck and completed a second CAS save at
  version 3.

### M25 Safe Notebook Kernel Receipts

- Added `src/notebook/notebookKernel.ts`, `convex/notebookKernel.ts`, the store
  adapter, and notebook work-artifact controls.
- The kernel supports bounded arithmetic, read-only SQL intent, and chart
  intent. It does not use `eval`, arbitrary Python, shell execution, or
  unrestricted database writes.
- Kernel results persist as traceable receipt state while the existing
  notebook editor remains the content source of truth.
- Live proof appended `Calculation: 12 + 8 * 2`, ran it through the product
  editor/kernel path, returned `28`, and persisted receipt hash `3aafe06e`.

### M26 Graph Cluster Exploration and Dragging

- Added `src/ui/graph/semanticGraphClusters.ts` and cluster/focus controls to
  `KnowledgeGraph.tsx`.
- Users can select semantic clusters, expand zero/one/two hops, focus the top
  one/two/three relevant paths, and drag nodes without shifting the overall
  work surface.
- React Flow measurements are retained across controlled-node updates, which
  removes the prior drag warning without changing graph derivation or source
  paths.
- Live proof selected the Evidence cluster, expanded to 14 nodes and 7 links,
  focused three paths, opened the Butterbase source path, and moved a node by
  approximately 73 by 37 pixels.

### M27 Scoped Chat Composer Context

- Added `src/ui/artifactRefs.ts` and a context picker in `Chat.tsx` for current
  artifacts, deck slides, proposals, and traces.
- Selected context is sent through the existing message path and rendered as
  an openable message reference; public/private lanes, NodeAgent mentions,
  streaming, retry, attachment, and cancellation behavior are unchanged.
- Live proof sent a public message scoped to `HackwithBay Demo Brief` and
  verified the resulting `.r-msg-ref` embed with no new console warnings or
  errors.

### M28 Official Benchmark Harness Reliability

- Added resumable, concurrent, receipt-preserving SpreadsheetBench chunk runs
  and selective repair of only tasks missing model candidate/scorer-attempt
  evidence.
- Replaced JavaScript `TypeError` crashes for malformed structural plans with
  deterministic validation and reused the scorer's safe workbook reader for
  unsupported XLSX package parts.
- Scoring-phase errors count as a completed model/scorer attempt only when the
  generated plan, raw model output, workspace manifest, candidate manifest,
  and candidate workbook receipts all exist. Candidate-generation failures
  remain incomplete.
- Added reproducible Finch content-parts recovery/merge and corrected the
  exporter so non-Excel bytes are never mislabeled as `.xlsx`.
- Added an MBABench compatibility launcher that preserves non-empty credential
  environment variables while keeping the pinned upstream checkout clean.

### M29 Official Score Coverage Closure

- Completed exact model/scorer-attempt coverage for SpreadsheetBench V1
  (`912/912`), the Verified400 projection (`400/400`), and SpreadsheetBench V2
  (`321/321`). The strict ledger now reports `1,739/1,739` staged official
  tasks across all five tracked coverage slices.
- Added hash-verified cross-route repair, exact task-id resume, raw model-output
  preservation before parsing, JSON formula-quote repair, and explicit paid
  route cost ceilings to the chunked SpreadsheetBench runner.
- Promoted the accepted FinAuditing receipt after all `332/332` FinMR rows were
  judged by the pinned path. The receipt records `116,783` input tokens,
  `6,308` output tokens, and estimated provider cost `$0.04181175`.
- Promoted the accepted MBABench receipt after all `38/38` locked public cases
  completed through the pinned upstream Gemini judge. The receipt records mean
  score `11.51315789`, `12,630,780` total tokens, and provider cost `$6.67212`.
- Replaced stale tests that expected those completed lanes to remain blocked
  with exact positive assertions for coverage, scorer identity, cost, and
  accepted-receipt status.
- Finch model-output and `content_parts.jsonl` coverage is complete at
  `172/172`. Added a resumable pinned-Azure judge runner with a one-row probe,
  whole-run cost cap, per-call reserve, raw JSONL, `results.xlsx`, and a strict
  promotion contract that rejects partial or non-Azure receipts.

## Validation

| Command | Status | Notes |
| --- | --- | --- |
| `npm run typecheck -- --pretty false` | pass | TypeScript clean after M28 benchmark-harness reliability work. |
| `npm test -- --run tests/workArtifacts.test.ts` | pass | 27 adapter/storyboard/notebook/live-performance/export/patch-plan/graph-review/execution-preview tests passed. |
| `npm test -- --run tests/workArtifacts.test.ts tests/semanticGraph.test.ts tests/artifactRefs.test.ts` | pass | 40 tests passed after notebook execution preview. |
| `npm run typecheck` in `NodeGraph` | pass | Public package typecheck passed after adding `relationshipReview`. |
| `npm test` in `NodeGraph` | pass | 2 test files, 9 tests passed. |
| `npm run build` in `NodeGraph` | pass | Public package build completed. |
| `npm run nodeagent:frame:smoke` | pass | Reran after implementation; frame `rf_adopt_minimal_write_note` completed in 5 steps. |
| `npm run omnigent:nodeagent:smoke` | pass | Reran after implementation; YAML compatibility passed, outer Omnigent CLI still not installed locally. |
| `npm run proofloop -- doctor --json` | pass | 11 checks passed, 0 warnings, 0 failures. |
| `npm run proofloop -- manifest --dense` | pass | Reported status `official-scores:needs_scaffold_or_run`; live/gate/resume commands available. |
| `npm run proofloop -- ui contract --dense` | pass | Printed stable UI selector/action contract surface. |
| `npm run proofloop -- supervise --goal official-scores --dense` | blocked external | Every command task passes; Finch is the only remaining external scorer task. |
| `npm run benchmark:proofloop:official-preflight -- --strict` | pass | Official-score preflight wrote receipts and passed 7/7 checks without paid provider calls. |
| `npm run benchmark:official:task-coverage -- --strict` | pass | All 5 tracks complete: `1,739/1,739` staged official tasks and `1,733` exact model-run cases. V1 reports `89/912` pass (`0.097588`) and average `0.335084`; Verified400 reports `14/400` pass and average `0.259266`; V2 reports `0/321` pass and average `0.523337`. |
| `npm run proofloop -- gate --goal official-scores` | pending Finch | Completion authority remains the persisted gate; it is not claimed while the accepted Finch Azure receipt is absent. |
| `npm test -- --run` | pass | 305 test files and 2,055 tests passed after score-state, cost-guard, and stale-fixture repairs. |
| `npm run build` | pass | Typecheck and Vite production build passed; Vite reported the existing main-chunk size warning (`1246.58 kB` versus `1100 kB`). |
| lint | unavailable | `package.json` has no lint script; no lint result is claimed. |
| `python -m py_compile scripts/finch-official-judge.py scripts/finauditing-official-judge.py scripts/mbabench-official-sweep.py scripts/finch-content-parts-recovery.py` | pass | All official judge/recovery launchers compile. |
| Finch cost/promotion guard tests | pass | Failed/retried calls consume reserve and call ceilings; promotion rejects partial, non-Azure, parse-error, under-call, and over-cap receipts. |
| FinAuditing official judge | pass | Accepted pinned receipt covers `332/332` FinMR rows at estimated provider cost `$0.04181175`. |
| MBABench official judge | pass | Accepted pinned Gemini receipt covers `38/38` cases, mean score `11.51315789`, provider cost `$6.67212`. |

## Live Browser Proof

Local dev server:

- `http://127.0.0.1:5173/#hackwithbay`

Captured screenshots:

- `docs/synthesis/proof/work-artifacts-tab.png`
- `docs/synthesis/proof/work-artifacts-storyboard-tab.png`
- `docs/synthesis/proof/work-artifacts-hackwithbay-storyboard-tab.png`
- `docs/synthesis/proof/work-artifacts-hackwithbay-notebook-digest.png`
- `docs/synthesis/proof/entity-graph-relevant-paths.png`
- `docs/synthesis/proof/work-artifacts-proof-receipt.png`
- `docs/synthesis/proof/deck-storyboard-workbench.png`
- `docs/synthesis/proof/proposal-review-center.png`
- `docs/synthesis/proof/proof-bundle-export-json.png`
- `docs/synthesis/proof/notebook-digest-workbench.png`
- `docs/synthesis/proof/trace-replay-workbench.png`
- `docs/synthesis/proof/live-performance-center.png`
- `docs/synthesis/proof/deck-preview-export.png`
- `docs/synthesis/proof/notebook-patch-preview-empty-visible.png`
- `docs/synthesis/proof/notebook-typed-blocks.png`
- `docs/synthesis/proof/m24-deck-collaboration-proof.png`
- `docs/synthesis/proof/m25-notebook-kernel-proof.png`
- `docs/synthesis/proof/m26-graph-cluster-drag-proof.png`
- `docs/synthesis/proof/m27-chat-context-proof.png`
- `docs/synthesis/proof/deck-claim-graph-paths.png`
- `docs/synthesis/proof/deck-pptx-export.png`
- `docs/synthesis/proof/hackwithbay-deck-export.pptx`
- `docs/synthesis/proof/deck-pdf-export.png`
- `docs/synthesis/proof/hackwithbay-deck-export.pdf`
- `docs/synthesis/proof/notebook-patch-diff-empty.png`
- `docs/synthesis/proof/deck-patch-plan.png`
- `docs/synthesis/proof/deck-patch-plan-header.png`
- `docs/synthesis/proof/deck-patch-plan-detail.png`
- `docs/synthesis/proof/hackwithbay-deck-patch-plan.json`
- `docs/synthesis/proof/graph-relationship-review.png`
- `docs/synthesis/proof/hackwithbay-graph-relationship-review.json`
- `docs/synthesis/proof/notebook-execution-preview-empty.png`
- `docs/synthesis/proof/notebook-execution-preview-empty-detail.png`
- `docs/synthesis/proof/hackwithbay-proof-bundle.json`

Observed on `http://127.0.0.1:5175/#hackwithbay`:

- Artifacts panel rendered from real seeded room state.
- Proof bundle summary rendered.
- Deck storyboard row rendered as a `deck` work artifact.
- Deck row status was `needs_review` when claims lacked evidence.
- Notebook row rendered as a `notebook` work artifact with derived block/section
  summary: `5 blocks - 1 section`.
- Browser proof after M3 observed 8 rows: deck, export, graph, notebook, two
  spreadsheets, and two traces.
- Entity graph opened from the trace-strip action on a sheet route.
- Selecting a graph node rendered `Relevant Paths` in the detail panel.
- Browser proof after M4 observed 22 visible graph nodes, 47 visible links, and
  8 ranked path rows.
- Artifacts panel showed proof receipt hash `5715baf1` in the live UI.
- Browser proof after M6 observed 8 work-artifact rows and receipt id
  `room_52:proof-bundle:5715baf1`.
- Browser proof after M7 opened the deck storyboard workbench from the deck row,
  observed 3 storyboard slides, and found 3 source buttons.
- Clicking a storyboard source button opened the real `HackwithBay Demo Brief`
  notebook artifact and closed the storyboard workbench via the existing
  artifact-open callback.
- Browser proof after M8 observed the `proposal-review-center` surface mounted
  in the Artifacts panel with pending/agent-edit/semantic-rebase/all filters and
  the zero-pending workpaper state on the HackwithBay room.
- Focused tests cover pending proposal item derivation, semantic rebase
  filtering, value previews, conflict feedback, and host-required feedback.
- Browser proof after M9 clicked `Receipt JSON`, downloaded
  `hackwithbay-3-0-btb-graph-agent-proof-bundle-baf347df.json`, and showed a
  success status in the Artifacts panel.
- The downloaded sidecar was copied to
  `docs/synthesis/proof/hackwithbay-proof-bundle.json`; it contains
  `manifestVersion: 1`, receipt id `room_52:proof-bundle:5715baf1`, manifest id
  `room_52:proof-bundle:5715baf1:manifest:baf347df`, 8 artifacts, 2 trace ids,
  and 10 source ids.
- Browser proof after M10 opened the notebook digest workbench from the
  `HackwithBay Demo Brief` notebook row, observed 5 digest blocks, 1 section,
  and the selected notebook row state.
- Clicking `Open editor` closed the digest/proof panel and returned to the real
  `note-editor` surface for `HackwithBay Demo Brief`.
- Browser proof after M11 opened a trace replay workbench from a trace row,
  observed 2 replay phases, 2 critical path entries, 2 recent events, replay
  hash `c08a86e1`, and the selected trace row state.
- The HackwithBay seeded trace events currently have 0 artifact refs in the
  replay; artifact-open buttons are available for trace phases/events that carry
  artifact ids.
- Browser proof after M12 observed the `live-performance-center` with 2 public
  messages, 1 human message, 1 agent message, 1 agent trace, 2 total traces, 0
  tools, and `$0.000` cost for the seeded room.
- The live center's `Trace replay` action opened the trace replay workbench and
  selected the latest trace row.
- Browser proof after M13 opened the deck storyboard workbench, observed 3
  slides, the preview card, export hash `be6ecf65`, and no raw `<h1>/<p>/<b>`
  tags in the visible storyboard text.
- Clicking `HTML` showed a success status for
  `hackwithbay-3-0-btb-graph-agent-readout-deck-preview-be6ecf65.html`.
- Browser proof after M14 opened the notebook digest workbench, observed the
  visible `Patch Previews` section, confirmed 0 patch cards and the honest
  `No pending notebook patches.` empty state on HackwithBay.
- Layout proof after M14 confirmed the notebook workbench no longer overlaps
  the live-performance section (`overlaps: false` in browser check).
- Browser proof after M15 observed the typed block summary `text 1` and
  `evidence 4`, with the heading block labeled `text` after the unique block id
  fix.
- Browser proof after M16 opened Entity graph through the existing command
  palette action (`Open Graph`) after the tab was hidden in the current layout.
- The graph UI reported `Deck 1`, `Slide 3`, and `Claim 7` filter counts for
  the HackwithBay room.
- Searching `readout` rendered the storyboard deck and 3 slide nodes in the
  React Flow canvas.
- Searching `Demo claim` rendered a deck-claim node beside the real notebook
  block source.
- Selecting the deck claim opened `Relevant Paths` showing the chain from deck
  claim to `HackwithBay Demo Brief`, to the source notebook block, and back to
  storyboard slide/deck context.
- Browser proof after M17 opened the deck storyboard workbench, observed both
  `HTML` and `PPTX` export controls, clicked `PPTX`, and showed success status
  for `hackwithbay-3-0-btb-graph-agent-readout-deck-67eac2c8.pptx`.
- The downloaded PPTX was copied to
  `docs/synthesis/proof/hackwithbay-deck-export.pptx`.
- Local package validation confirmed the copied PPTX has `PK` magic, 28 ZIP
  entries, `ppt/presentation.xml`, `ppt/slides/slide1.xml`, and slide 1 contains
  `HackwithBay Demo Brief`.
- Browser proof after M18 observed `HTML`, `PPTX`, and `PDF` export controls,
  clicked `PDF`, and showed success status for
  `hackwithbay-3-0-btb-graph-agent-readout-deck-67eac2c8.pdf`.
- The downloaded PDF was copied to
  `docs/synthesis/proof/hackwithbay-deck-export.pdf`.
- Local PDF validation confirmed `%PDF-1.4`, 3 page objects for the 3-slide
  HackwithBay storyboard, and slide text containing `HackwithBay Demo Brief`.
- Browser proof after M19 reopened the notebook digest and confirmed the route
  is healthy with 0 patch cards and the honest `No pending notebook patches.`
  empty state in the current HackwithBay seed.
- The non-empty notebook patch diff path is covered by deterministic tests that
  assert removed text (`needs source`) and added text (`now cites`) for a pending
  notebook proposal.
- Browser proof after M20 opened the deck storyboard workbench, observed the
  `Patch JSON` export control, the meta chip `patches 7`, and the `Patch Plan`
  card with 7 patch rows, 0 ready-for-review patches, and 7 source-needed
  patches for the current HackwithBay seed.
- Clicking `Patch JSON` showed a success status for
  `hackwithbay-3-0-btb-graph-agent-readout-deck-patch-plan-6097d2b7.json`.
- The downloaded patch plan was copied to
  `docs/synthesis/proof/hackwithbay-deck-patch-plan.json`; local validation
  confirmed `patchVersion: 1`, `patchCount: 7`, `needsSourceCount: 7`,
  `readyForReviewCount: 0`, and integrity hash `6097d2b7`.
- Browser proof after M21 opened the Proof graph work-artifact row and observed
  the `Graph relationship review` workbench with 89 nodes, 199 edges, 199
  relationships, 55 confirmed relationships, 144 relationships needing
  confirmation, and review hash `de2f8659`.
- Clicking `Review JSON` showed a success status for
  `room-52-semantic-graph-relationship-review-de2f8659.json`.
- The downloaded relationship review was copied to
  `docs/synthesis/proof/hackwithbay-graph-relationship-review.json`; local
  validation confirmed `reviewVersion: 1`, `nodeCount: 89`, `edgeCount: 199`,
  `relationshipCount: 199`, `confirmedCount: 55`, `needsConfirmationCount:
  144`, and integrity hash `de2f8659`.
- Browser proof after M22 opened the `HackwithBay Demo Brief` notebook digest and
  observed the new `Execution Preview` card with the honest current seed state:
  0 executable blocks, 0 ready previews, and 0 blocked previews.
- Deterministic tests cover the non-empty preview paths: safe arithmetic
  calculation (`12 + 8 * 2 -> 28`), SQL intent parsing
  (`select company, funding from diligence`), and line chart intent parsing.

## Preserved Functionality Checklist

- [x] Backend additions are limited to the explicitly requested notebook
  kernel receipt path; existing API, data, auth, and realtime contracts were
  not replaced.
- [x] No auth/session logic changed.
- [x] No NodeAgent runtime/frame/core files changed.
- [x] Existing artifact tabs remain available.
- [x] Existing notebook editor code remains the editor source of truth.
- [x] Existing proposal objects remain pending/approved/rejected source of
  truth.
- [x] Existing trace events remain the proof receipt source.
- [x] Existing read-only receipt/review workbenches remain derived; the deck
  and notebook kernel slices write only through their scoped store/Convex
  adaptors and preserve CAS/version receipts.
- [x] Unsupported deck and notebook claims stay visible as review work instead
  of being hidden.
- [x] Entity graph remains derived from current room state and now exposes
  ranked relevant paths for selected nodes.
- [x] Proof-bundle receipt model is deterministic and read-only.
- [x] Trace replay summary model is deterministic and read-only.
- [x] Deck storyboard workbench is openable and source actions route to real
  artifacts instead of synthetic storyboard ids.
- [x] Proposal review center preserves existing `resolveProposal` behavior and
  source artifact opening paths.
- [x] Proof-bundle export sidecar downloads a manifest built from the same
  receipt and trace replay contracts shown in the Artifacts panel.
- [x] Notebook digest workbench is openable and preserves the real notebook
  editor handoff through the existing artifact-open callback.
- [x] Trace replay workbench is openable and preserves artifact-open callbacks
  for trace refs that include artifact ids.
- [x] Live performance center derives from existing public messages, run/job
  telemetry, traces, and stream/detail receipts without reading private chat or
  mutating state.
- [x] Deck preview/export derives from the storyboard plan, strips legacy HTML
  text before rendering claims, and does not change slide/editor state.
- [x] Notebook patch previews derive from existing proposal objects and do not
  apply or resolve proposal changes.
- [x] Typed notebook block classification derives from existing block text,
  source ids, role, status, and proposals without changing editor state.
- [x] Storyboard proof graph nodes derive from the deck plan and connect back to
  existing source artifacts, notebook blocks, trace steps, proposal nodes, and
  evidence refs without mutating graph/backend state.
- [x] PPTX deck export derives from the storyboard plan and downloads as a
  client-side file without creating backend state or replacing the slide editor.
- [x] PDF deck export derives from the storyboard plan and downloads as a
  client-side file without backend render jobs or storage writes.
- [x] Notebook patch previews now include before/after word diffs for pending
  notebook proposals without changing editor sync or proposal resolution.
- [x] Deck patch plans derive from storyboard gaps, unverified claims, linked
  proposals, source artifact ids, and trace refs without applying deck edits or
  resolving proposals.
- [x] Graph relationship review derives from the current semantic graph and
  classifies source-backed vs inferred/proposal-linked relationships without
  changing graph storage or backend state.
- [x] Notebook execution preview derives from typed notebook blocks and safely
  previews calculation/SQL/chart intent without arbitrary code execution,
  backend kernels, or editor mutations.
- [x] Collaborative deck edits persist through the existing artifact contract
  and preserve create/save/duplicate/delete/reorder/export callbacks.
- [x] Notebook kernel execution is bounded to calculation, read-only SQL, and
  chart intent and links persisted outputs to receipt state.
- [x] Graph cluster/focus controls remain derived from room state and preserve
  draggable React Flow behavior and source-backed relevant paths.
- [x] Chat context selection preserves the existing composer/send/stream path
  and adds openable artifact/proposal/trace references.

## Known Gaps

- Deck patch plans are review/export artifacts only; applying those patches to a
  deck still requires reviewer action through the governed request path.
- Notebook block-level patch previews and digest-level word diffs are
  implemented; inline visual diffs inside the ProseMirror editor are still
  future work.
- The safe notebook kernel intentionally does not provide arbitrary Python,
  shell, package installation, or unrestricted SQL execution.
- Proof graph cluster/focus controls are complete locally; persisted
  Neo4j/Cognee synchronization and public deck/storyboard graph contracts are
  separate integration work.
- Chat context migration is complete for artifact/deck/proposal/trace refs;
  visual parity for every legacy receipt subtype remains iterative design work.
- The full vertical product dogfood passed for the four new feature slices and
  every non-Finch official-score lane is complete. The separate
  `official-scores` gate remains pending only the accepted Finch Azure receipt.

## Next Required Gate

Before claiming this goal complete:

1. Complete Microsoft device authentication and discover an existing Azure
   OpenAI deployment without creating cloud resources.
2. Run the capped one-row Finch transport/parser probe, then resume the pinned
   judge to accepted `172/172` coverage.
3. Promote that exact receipt, regenerate derived ledgers, and rerun the full
   validation/build pass.
4. Run `npm run proofloop -- gate --goal official-scores` and claim completion
   only when it exits zero with status `passed`.
