# NodeRoom Work Artifacts Implementation And Dogfood Plan

Status: planning contract

This is the consolidated plan for the next NodeRoom product push: first-class collaborative work artifacts, governed agent edits, proof graphs, deck composition, Hex-like notebooks, and the dogfood system that proves those features work in real NodeRoom rooms.

## Sources Of Truth

- Functional source of truth: current production/main NodeRoom behavior.
- Product thesis source: the market and feature planning note in the 2026-07 attachment.
- Design source:
  - `docs/design/design-source/`
  - `C:/Users/hshum/Downloads/NodeRoom Workspace (standalone).html`
  - `C:/Users/hshum/Downloads/NodeAgent-handoff_07062026/nodeagent/project/mobile/app-terracotta/na-deck.jsx`
- Existing dogfood references:
  - `docs/qa/NODEROOM_DOGFOOD_MATRIX.md`
  - `docs/qa/LIVE_DOGFOOD_RESULTS.md`
  - `docs/audit/E2E_DOGFOOD_DESIGN.md`
  - `docs/eval/proofloop-codegraph-dogfood.md`
- Existing capability references:
  - `docs/AGENT_ARTIFACTS.md`
  - `docs/architecture/NOTEBOOK_AGENT_TRANSFORM.md`
  - `src/nodeagent/traces/`
  - `src/nodeagent/core/`

## Category Thesis

NodeRoom should not compete as a generic AI chat workspace, notebook, deck tool, or graph viewer. The defensible category is a proof-native collaborative AI workroom for high-stakes analytical work.

The broader market already covers search, workflow automation, artifact generation, and agent debugging. NodeRoom should own the combined workflow where a team asks an agent to perform analytical work, sees the work evolve as governed artifacts, reviews evidence, collaborates in-room, exports deliverables, and keeps a traceable proof receipt.

The missing product layer is therefore not one feature. It is the connective tissue between:

- agent proposals,
- workpapers,
- spreadsheet grids,
- notebooks,
- slideshow/storyboard composition,
- proof graphs,
- chat,
- approvals,
- exports,
- benchmark rooms,
- and replayable traces.

## Current Substrate

The repo already appears to have parts of this platform:

- Agent artifacts: proposal-like generated outputs and artifact metadata.
- Notebook operations: block-level editor behavior and agent transformation hooks.
- Semantic graph types/selectors: graph-shaped knowledge and entity relationships.
- NodeAgent frame runner and trace spine: durable proof receipts and evidence provenance.
- Room collaboration surfaces: public/private chat, presence, room traces, shared room state.
- Design prototypes: mobile deck workflow with plan-first generation, slide preview, comments, accept/reject patches, evidence tabs, export, presentation mode, and version history.
- ProofLoop tooling: deterministic certification loop, exploration loop, memory, receipts, and promotion ledger.

The implementation plan should preserve that substrate and add a reusable product layer on top rather than replacing working logic.

## Product Target

NodeRoom should let a team create a room, ask NodeAgent to research or analyze a real task, and receive a set of governed work artifacts:

- a proof graph showing entities, people, companies, evidence, claims, work products, and trace links;
- a notebook with typed blocks, calculations, sources, and agent-generated sections;
- a storyboard that turns findings into a narrative plan before slides are generated;
- a deck/slideshow artifact that can be reviewed, patched, exported, and presented;
- proposal cards/workpapers that show what NodeAgent wants to change and why;
- room traces that replay every material action with evidence and approval state.

## Feature Implementation Plan

### 1. Unified Work Artifact Layer

Purpose: give NodeRoom one product model for notebooks, decks, spreadsheets, traces, graphs, proposals, and exports.

Implementation:

- Define a small artifact view model that wraps existing feature state instead of rewriting each feature.
- Support artifact kinds: `spreadsheet`, `notebook`, `deck`, `graph`, `trace`, `proposal`, `export`.
- Add shared metadata: title, room id, source ids, trace id, version, status, owner, last edited, evidence count, approval state.
- Add common actions: open, pin, comment, ask NodeAgent, propose patch, accept, reject, export, view trace.
- Keep writes behind existing room tools, Convex mutations, and NodeAgent frame boundaries.

Tests/proof:

- Typecheck artifact adapters.
- Unit test artifact status transitions.
- Add fixture coverage for each artifact kind.
- Add a smoke path where a room renders mixed artifact types without replacing feature logic.

Dogfood hook:

- Every dogfood run must produce at least one artifact bundle with notebook, deck, graph, trace, and export entries.

### 2. Agent Workpapers And Proposal Review Center

Purpose: make NodeAgent changes visible, reviewable, and auditable before they mutate user work.

Implementation:

- Convert existing proposal cards into reusable workpaper cards.
- Show proposed changes with evidence, affected artifacts, confidence, reviewer state, and trace receipt.
- Add a review center panel that filters proposals by status: pending, accepted, rejected, needs evidence, failed.
- Preserve all existing proposal action callbacks and mutation flows.
- Link every accepted/rejected proposal to a trace id.

Tests/proof:

- Proposal accept/reject regression tests.
- Trace receipt tests for accepted and rejected proposals.
- Browser test for filtering and reviewing proposal cards.

Dogfood hook:

- Dogfood must include at least three proposal types: notebook edit, deck patch, graph relationship confirmation.

### 3. Governed Deck And Slideshow Composition

Purpose: turn NodeRoom findings into a board-ready narrative artifact without becoming a generic slide editor.

Implementation:

- Extract the deck contract from `na-deck.jsx`: storyboard first, sandboxed slide preview, thumbnail rail, comments, NodeAgent patch requests, accept/reject, evidence, export, present mode, version history.
- Add a first-class `deck` artifact adapter.
- Implement a storyboard phase before slide generation:
  - objective,
  - audience,
  - narrative arc,
  - section outline,
  - claims,
  - required evidence,
  - unresolved gaps.
- Add slide components that are generated from room artifacts, not static mock data.
- Let users request NodeAgent changes at storyboard, slide, and element levels.
- Keep exports traceable: PPTX/PDF export should include a proof receipt or receipt sidecar.

Tests/proof:

- Storyboard creation test.
- Deck render smoke test.
- Accept/reject slide patch test.
- Export smoke test.
- Visual regression against the Cloud Design direction.

Dogfood hook:

- A vertical dogfood run must produce a storyboard, then a deck, then a reviewer-requested patch, then an export.

### 4. Hex-Like Work Notebooks

Purpose: make notebooks a serious analytical work surface rather than just text blocks.

Implementation:

- Preserve existing notebook block behavior.
- Add typed blocks through adapters:
  - text,
  - insight,
  - table,
  - chart,
  - calculation,
  - SQL/data query,
  - evidence,
  - decision,
  - open question,
  - agent proposal.
- Add block-level provenance and trace links.
- Add NodeAgent actions: summarize evidence, create calculation, turn table into chart, convert notebook section to storyboard.
- Support review states per block where appropriate.

Tests/proof:

- Existing notebook tests must continue to pass.
- Add block transform tests for at least three block types.
- Add browser smoke for editing, agent patching, and trace linking.

Dogfood hook:

- The dogfood room must use a notebook to record assumptions, analysis, evidence, and final decisions before deck generation.

### 5. Proof Graph And NodeGraph Integration

Purpose: show why conclusions are connected, not just what the answer is.

Implementation:

- Keep graph components reusable enough for the public NodeGraph repo.
- Add NodeRoom-specific adapters for room entities, claims, companies, people, documents, tasks, traces, notebook blocks, deck slides, and proposals.
- Highlight relevant connections:
  - person researched company,
  - person authored or approved workpaper,
  - company has evidence clusters,
  - person has project and achievement clusters,
  - claim is supported by source,
  - slide uses claim,
  - notebook block derives from evidence,
  - proposal modified artifact.
- Support focus mode, neighborhood expansion, path finding, cluster grouping, search, pinning, and drag interactions.
- Preserve live updates where existing room state supports them.

Tests/proof:

- NodeGraph example app runs locally.
- NodeRoom graph route renders from real room data.
- Browser smoke covers drag, expand, search, and selection.
- Streamlit bridge remains a showcase path, not the production NodeRoom graph implementation.

Dogfood hook:

- Dogfood must include a graph review task where a user asks NodeAgent why a deck claim exists and the graph highlights the source path.

### 6. Collaboration, Chat, And Mobile Review

Purpose: make artifact work feel live and governed across desktop and mobile.

Implementation:

- Preserve public/private chat behavior and NodeAgent mentions.
- Add artifact-aware chat references: comment on slide, notebook block, graph node, trace event, proposal.
- Show presence on artifacts and focused elements.
- Support mobile review for deck comments, proposal accept/reject, evidence checks, and lightweight chat.
- Preserve keyboard behavior and existing message send semantics.

Tests/proof:

- Chat send/receive smoke.
- NodeAgent mention smoke.
- Presence regression where available.
- Mobile viewport screenshot and interaction test for review flows.

Dogfood hook:

- Include a mobile reviewer persona that comments on a slide and rejects one unsupported claim.

### 7. Export, Replay, And Receipts

Purpose: make outputs portable while preserving proof.

Implementation:

- Export deck, notebook, and room proof bundle.
- Add a receipt index for exported artifacts:
  - artifact id,
  - version,
  - trace id,
  - evidence ids,
  - accepted proposals,
  - unresolved gaps,
  - generated file paths,
  - model/cost metadata where available.
- Reopen exported or archived artifacts when possible.

Tests/proof:

- Export generation smoke.
- Receipt schema test.
- Reopen/import fixture test where supported.

Dogfood hook:

- Every dogfood completion gate should require an export bundle and receipt.

### 8. Vertical Room Templates

Purpose: make NodeRoom immediately useful for repeatable high-value workflows.

Implementation:

- Add templates for:
  - startup diligence,
  - accounting reconciliation,
  - underwriting review,
  - product/market research,
  - incident or audit review,
  - benchmark evaluation room.
- Each template should define default artifacts, starter tasks, graph schema hints, notebook sections, deck storyboard outline, and proof requirements.
- Templates must be data-backed and editable, not static marketing demos.

Tests/proof:

- Template creation smoke.
- Route-level smoke for opening each template.
- Fixture test that required artifacts are created.

Dogfood hook:

- The main dogfood run should use at least one template end to end and compare it against a blank room baseline.

### 9. Customer Benchmark Rooms And NodeTasks

Purpose: turn evaluation and customer onboarding into a product surface.

Implementation:

- Integrate NodeTasks as searchable benchmark tasks.
- Rank tasks by steps, cost, difficulty, domain, tags, required artifacts, and expected proof.
- Let users create a benchmark room from a task.
- Run NodeAgent against the task and produce scorecards, traces, clips, and receipts.
- Keep certification fixtures locked and exploration proposals separate.

Tests/proof:

- Task search test.
- Task-to-room creation smoke.
- ProofLoop gate integration for at least one benchmark room.

Dogfood hook:

- Use NodeRoom to manage NodeRoom's own benchmark tasks and publish selected proof clips.

### 10. Narrow Enterprise Connectors

Purpose: support the minimum real data paths needed for high-value rooms without becoming a broad connector company.

Implementation:

- Prioritize connector targets by room workflow need:
  - docs and uploaded files,
  - spreadsheet data,
  - CRM/account context,
  - accounting exports,
  - issue/project trackers,
  - cloud drive files.
- Each connector should land data into artifacts with evidence/provenance.
- Do not let connector work block the artifact layer; use fixture-backed adapters first.

Tests/proof:

- Connector fixture ingest tests.
- Evidence provenance tests.
- Failure state tests for missing permissions and stale data.

Dogfood hook:

- Dogfood should include at least one messy intake source and one connector-like fixture import.

## Milestone Plan

### M0: Contract And Baseline

- Inventory current routes, panels, user actions, NodeAgent flows, notebook flows, graph flows, export flows, and trace flows.
- Extract deck and mobile artifact contract from design prototypes.
- Lock baseline typecheck, lint, test, and smoke status.
- Create fixture rooms for startup diligence, accounting reconciliation, and product research.

Exit gate:

- Baseline status recorded.
- Artifact contract documented.
- No feature code changed yet.

### M1: Artifact Shell And Workpaper Inbox

- Add unified artifact adapters and shared artifact shell UI.
- Migrate proposal cards into workpaper cards.
- Add artifact review center.
- Preserve existing action handlers.

Exit gate:

- Existing proposal flows still work.
- Mixed artifact list renders from real room state.
- Tests/typecheck pass or pre-existing failures are documented.

### M2: Deck Vertical Slice

- Implement storyboard-first deck artifact.
- Render deck workbench with thumbnails, slide preview, evidence, comments, and NodeAgent patch requests.
- Wire accept/reject patch flow through existing proposal/trace patterns.
- Add export stub or real export depending on existing export infrastructure.

Exit gate:

- User can generate or open a storyboard, render slides, request a patch, accept/reject it, and export with a receipt.

### M3: Notebook Interior Upgrade

- Add typed notebook block adapters.
- Add block-level provenance and trace links.
- Add NodeAgent block transforms.
- Preserve keyboard and editing behavior.

Exit gate:

- Existing notebook editing still works.
- At least three typed block transforms work in a live room.

### M4: Proof Graph Interior Upgrade

- Integrate NodeGraph components where appropriate.
- Add room graph adapters and connection highlighting.
- Add focus, cluster, search, drag, and path explanation interactions.

Exit gate:

- A claim can be traced from deck slide to notebook block to evidence to source through the graph.

### M5: Collaboration And Mobile Review

- Add artifact-aware comments/references.
- Validate live chat and NodeAgent mentions.
- Add mobile review flow for comments and approvals.

Exit gate:

- Two users/personas can collaborate on one artifact and leave traceable review actions.

### M6: Export And Replay

- Produce deck/notebook/proof bundle exports.
- Add receipt sidecar.
- Add replay summary from trace events.

Exit gate:

- Exported bundle can be inspected and mapped back to room evidence and trace ids.

### M7: Templates And Benchmark Rooms

- Add vertical room templates.
- Add NodeTasks search/ranking room flow.
- Connect ProofLoop gate output to benchmark room artifacts.

Exit gate:

- A user can start from a benchmark task, run the room, inspect artifacts, and view a proof receipt.

### M8: Production Dogfood Gate

- Run the full vertical dogfood scenario.
- Capture screenshots and clips.
- Record failures, repairs, costs, and trace receipts.
- Publish a concise proof report.

Exit gate:

- Deterministic gate passes, or failures are documented as known blockers with linked repair tasks.

## Full Vertical Dogfood Run

The dogfood run should use NodeRoom to build NodeRoom.

### Room Setup

- Product command room: owns roadmap, market thesis, decisions, and proof report.
- Feature build rooms: deck, notebook, graph, workpapers, templates, NodeTasks.
- Certification rooms: locked scenarios that verify finished behavior.
- Exploration rooms: messy scenarios and red-team tasks that propose future tests.

### Required Inputs

- Market planning note.
- Cloud Design artifact.
- Mobile deck prototype.
- Existing NodeRoom routes and current production behavior.
- Existing proofloop suites.
- NodeGraph and NodeTasks public repo artifacts where applicable.

### Required Sequence

1. Ingest inputs into a room.
2. Ask NodeAgent to summarize the market gap and missing feature map.
3. Create a proof graph of products, personas, features, claims, and evidence.
4. Create a notebook with assumptions, analysis, calculations, and open questions.
5. Generate a storyboard before slides.
6. Review and edit storyboard with a human.
7. Generate a deck from the approved storyboard.
8. Ask NodeAgent to patch a slide based on reviewer feedback.
9. Accept one patch and reject one patch.
10. Show graph path from a slide claim back to evidence.
11. Collaborate through public chat and at least one artifact comment.
12. Export deck/notebook/proof bundle.
13. Replay trace summary.
14. Run the deterministic gate and publish the proof report.

### Required Outputs

- Work artifact bundle.
- Storyboard.
- Deck.
- Notebook.
- Proof graph.
- Proposal/workpaper review log.
- Chat transcript excerpt.
- Export bundle.
- Trace receipt.
- Cost ledger.
- Screenshots and clips.
- Known gaps and repair queue.

## Persona Test Matrix

| Persona | Task | Pass Criteria |
| --- | --- | --- |
| Founder | Turn market note into board-ready story | Storyboard and deck reflect evidence-backed thesis |
| Analyst | Build notebook and graph from messy inputs | Claims link to sources and calculations |
| Banker | Review diligence room under time pressure | Can find risks, companies, and evidence quickly |
| Reviewer | Accept/reject NodeAgent edits | Proposal state, comments, and trace receipts are correct |
| Mobile collaborator | Review slides from phone | Can comment, ask for patch, and approve/reject |
| Auditor | Inspect why a decision was made | Trace and proof graph reconstruct the chain |
| New user | Start from template or benchmark task | Room creates expected artifacts without manual setup |
| Admin | Verify cost and run quality | Cost ledger, model routes, and completion gate are inspectable |

## Acceptance Gates

Functionality:

- Existing routes and user actions continue to work.
- Existing NodeAgent frame and trace tests continue to pass.
- Notebook, graph, chat, proposal, and export behavior remain data-backed.

Evidence:

- Material claims link to evidence.
- Agent mutations link to trace ids.
- Accepted and rejected proposals remain visible.
- Unsupported claims are flagged rather than hidden.

Collaboration:

- Public chat and NodeAgent mentions work.
- Comments can target artifacts or artifact elements.
- Presence does not break artifact state.

Export:

- Deck/notebook/proof bundle can be exported.
- Receipt sidecar identifies artifacts, evidence, versions, proposals, trace ids, and known gaps.

Visual/design:

- Work artifacts follow the Cloud Design direction.
- Interiors are calm, dense, clear, and less boxy.
- Spreadsheet grid, notebook editor, proposal cards, graph, traces, and chat all receive region-by-region visual migration.

Benchmarks:

- Dogfood tasks are searchable and ranked.
- Certification loop remains locked.
- Exploration loop can propose new scenarios but cannot self-promote.

## Metrics

- Time from messy input to reviewable artifact.
- Number of material claims with evidence links.
- Number of unsupported claims detected.
- Proposal acceptance/rejection rate.
- Export success rate.
- Trace completeness.
- Graph path explanation success.
- Mobile review completion rate.
- Run cost by model route.
- Human review time saved.

## Engineering Policy

- Do not rewrite the application.
- Do not replace working product logic with static mock data.
- Do not remove functionality because the design prototype omits it.
- Keep backend, auth, schema, Convex, and business logic unchanged unless a small compatibility change is required for a first-class artifact.
- Prefer adapters and wrappers over feature rewrites.
- Add deterministic tests or smokes for every behavior-changing artifact migration.
- Keep generated proofloop memory and local run outputs out of git unless explicitly promoted.

## First PR-Sized Slice

1. Land this plan as the canonical contract.
2. Extract a deck-specific UI/product contract from `na-deck.jsx`.
3. Add read-only artifact adapters for existing proposals, notebooks, spreadsheets, traces, and graph entries.
4. Render a mixed artifact review surface from real room state.
5. Add a storyboard-first deck artifact behind a feature flag or fixture-backed route.
6. Wire one NodeAgent patch proposal into deck or notebook review.
7. Add tests for artifact adapter status transitions and proposal trace linking.
8. Run typecheck, relevant tests, and a browser dogfood smoke.

