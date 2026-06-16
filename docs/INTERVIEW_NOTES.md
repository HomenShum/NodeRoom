# NodeRoom Tech Retro Interview Notes

Use this as the runbook for a 45-minute engineering interview or technical retro. The goal is not to give a polished pitch for 45 minutes. The goal is to give a structured walkthrough, invite technical questions, and show that you can connect product workflow, system design, implementation, and evaluation.

## Title And Thesis

**Title:** NodeRoom / NodeAgent: Collaborative AI Workflows, Safe Tools, and Evaluation Harnesses

**Thesis:**

> My career has been moving toward the same problem LiveFlow is solving: how do you turn messy professional workflows into AI-assisted systems that users can trust. NodeRoom is my current attempt to make that concrete across room collaboration, spreadsheet updates, file-grounded context, agent-managed memory, and feature-level eval harnesses.

Repeat this design principle throughout:

> The agent can reason and propose, but bounded tools own mutation, versioning, permissions, traces, and evals.

Core thesis to defend under technical questioning:

> NodeRoom is not a prompt wrapper. The model is only one component inside an agent harness. The engineering work is the runtime around it: durable state, bounded tools, context compaction, access control, cost controls, traceability, file evidence, and regression evals.

What that means in practice:

- Model output is treated as a proposal until a tool validates permission, schema, version, and lock state.
- Long-running work is sliced into checkpointed steps instead of trusting one serverless invocation.
- Files remain durable room artifacts; provider file ids are cache metadata only.
- The wiki, traces, and evals are part of the product, not afterthoughts.

## 45-Minute Plan

Keep prepared material to roughly 25 minutes and let engineers interrupt.

```text
0:00-2:00      Opening thesis
2:00-8:00      Chapter 1: Professional workflows and why this problem matters
8:00-23:00     Chapter 2: NodeRoom demo and code walkthrough
23:00-38:00    Chapter 3: How every feature is evaluated
38:00-45:00    Q&A / technical drill-down
```

## Opening Script

Say this almost directly:

> I structured this Tech Retro around three chapters. First, I will explain the professional workflow problem I care about and how finance, applied AI, and QA automation led me here. Second, I will demo NodeRoom with NodeAgent as the current version of that thinking: a collaborative room where public and private agents can gather context, reference files, safely update artifacts, and leave traces. Third, I will walk through how I think each feature should be evaluated, because for agent products, the core question is not just "does it work once," but "can it be trusted across state, users, tools, and failure cases."

Then say:

> The main design principle is: the agent can reason and propose, but bounded tools own mutation, versioning, permissions, traces, and evals.

## Chapter 1: Professional Workflow Fit

**Goal:** Make them see why this repo is relevant to finance workflow agents.

Narrative:

```text
Finance workflows
  -> users live in spreadsheets, documents, diligence, reporting, reconciliation

Applied AI / agent systems
  -> agents need context, tools, structured outputs, and UI surfaces

QA automation / eval mindset
  -> long-running agents need traces, state recovery, and regression harnesses

NodeRoom
  -> a public demo combining those lessons into one collaborative workflow system
```

Talk track:

> Finance users do not just need answers. They need numbers, sources, explanations, status, approvals, and confidence that the output can be trusted. That is why spreadsheets stay central. They are not just tables; they are collaboration surfaces and audit surfaces.

> A useful agent cannot just chat. It needs to gather the right context, call the right tools, preserve state, update artifacts safely, and leave traces that a human can inspect.

Bridge to LiveFlow:

> A Flow ERP agent is valuable only if finance users can trust what it did: what data it used, what changed, whether it touched the right artifact, and whether the result can be reviewed or rolled back.

### Professional Workflow Evidence

Say:

> I reviewed a real local corpus of 70 CSV/XLSX files and converted it into a redacted eval backlog. I did not commit private rows. I extracted workflow shape: company lists, PitchBook uploads, ParselyFi outputs, healthtech/JPM classification, spend exports, timecards, timesheets, old agent outputs, and eval templates.

What the file profile showed:

```text
70 files total
23 CSV / 47 XLSX
46 GTM or company-research files
11 finance/ops files
47 files with header-level PII signals
16 files with sampled formulas
18 files with merged cells
```

Interview point:

> This is why the harness matters. These workflows need schema detection, source references, evidence-bearing `CellPayload` writes, formula-safe mutation, privacy boundaries, and long-running checkpoints. The eval catalog in `docs/eval/PROFESSIONAL_WORKFLOW_EVALS.md` turns that into concrete cases.

Product support map: `docs/PROFESSIONAL_SPREADSHEET_WORKFLOWS.md`.

Guarantee matrix: `docs/PRODUCTION_GUARANTEE_MATRIX.md`.

## Chapter 2: Demo NodeRoom

**Goal:** Show the product and code path in one coherent loop.

Demo order:

```text
1. Open the NodeRoom UI
2. Explain the room layout
3. Show public room chat and private NodeAgent
4. Click files/artifacts in the left rail
5. Upload or select a spreadsheet/file artifact
6. Drag a file/artifact into chat as a reference
7. Run a spreadsheet collaboration flow
8. Show the note/wall/wiki surfaces
9. Show trace, telemetry, and source evidence
10. Transition into evals
```

### 1. Room Layout

Say:

> This starts as a collaborative room. The room is the shared context. The public NodeAgent works in the room. A private NodeAgent can also sit on the right as a personal assistant.

Mental map:

```text
2 panels: [ public room chat ] [ artifact ]
3 panels: [ public room chat ] [ artifact ] [ private NodeAgent ]
4 panels: [ left rail ] [ public room chat ] [ artifact ] [ private NodeAgent ]
```

Relevant files:

- `src/ui/RoomShell.tsx` - resizable multi-panel layout.
- `src/ui/LeftRail.tsx` - files/artifacts, uploads, drag refs.
- `src/ui/Chat.tsx` - public/private chat and artifact references.
- `src/ui/panels/Artifact.tsx` - sheet, note, wall, file metadata, trace.

### 2. Public And Private Agents

Say:

> The public NodeAgent can use public room context. The private NodeAgent can help me personally. The boundary matters: public outputs should not silently use private chat.

Code anchors:

- `src/engine/types.ts` - `Channel = "public" | { private: string }`.
- `src/app/store.tsx` - public/private `listMessages`, `askAgent`, and `askResearch`.
- `convex/messages.ts` and `convex/lib.ts` - member proof and channel access.

### 3. Files And Artifact References

Say:

> A finance or GTM user can upload source material, open it, drag it into the agent conversation as evidence, and later click back to the source artifact.

Reference format:

```text
References: [Q3 variance](noderoom-artifact:<artifact-id>)
```

Code anchors:

- `src/ui/artifactRefs.ts` - encode/parse artifact reference links.
- `src/ui/LeftRail.tsx` - drag artifact refs and upload files.
- `src/ui/Chat.tsx` - composer chips and sent reference chips.
- `src/app/store.tsx` - canonicalizes refs before agent runs.

### 4. Spreadsheet Flow

Say:

> This is the most finance-relevant artifact. The agent does not directly mutate the spreadsheet. It calls bounded tools that read, lock, write through CAS, and release.

Core protocol:

```text
read -> propose_lock -> edit_cell(baseVersion) -> release
if locked -> read locked range -> create_draft -> merge on unlock
if stale -> conflict as data -> re-read -> retry
```

Code anchors:

- `src/engine/types.ts` - uniform artifact element model.
- `src/engine/roomEngine.ts` - deterministic in-memory engine.
- `src/engine/merge.ts` - deterministic draft resolver.
- `src/nodeagent/skills/spreadsheet/cellMutator.ts` - `read_range`, `propose_lock`, `edit_cell`, `write_cell_result`, `create_draft`.
- `convex/artifacts.ts` - production CAS write path.
- `convex/locks.ts` and `convex/drafts.ts` - lock/release/draft merge.

Key line:

> Lock prevents races; CAS catches races. Convex OCC alone is not enough because it protects transaction conflicts, not stale intent.

### 5. Agent Runtime

Say:

> The runtime is intentionally small: context in, model step out, tool calls executed by the backend, tool results fed back into the model, bounded by a step budget.

Code anchors:

- `src/nodeagent/core/runtime.ts` - the loop.
- `src/nodeagent/core/types.ts` - three seams: model, tools, backend.
- `src/nodeagent/core/worldModel.ts` - just-in-time state and awareness.
- `src/nodeagent/models/prompts/systemPrompt.ts` - protocol rules.
- `src/nodeagent/models/adapter.ts` - provider model seam.
- `convex/agent.ts` - live `"use node"` action running the same loop.
- `convex/convexRoomTools.ts` - Convex implementation of `RoomTools`.

Talking point:

> The same harness runs in no-key mode with a scripted model and in live mode with real providers. That is how I can test the system deterministically without changing the agent runtime.

### 6. Notes, Wall, And Wiki

Say:

> The artifacts are deliberately uniform. A spreadsheet cell, note block, and wall sticky are all elements with versions. That means locks, CAS, drafts, and traces do not need separate implementations per surface.

Current status:

- Notes are note artifacts rendered through the artifact panel.
- Wall cards are versioned sticky-note elements.
- The wiki is currently deterministic from room-visible state.
- A future LLM wiki agent must follow `docs/skills/self-updating-wiki/SKILL.md`.

Code anchors:

- `src/engine/demoRoom.ts` - seeded wiki, note, wall, research, and Q3 variance artifacts.
- `docs/AGENT_WIKI.md` - wiki generation rules.
- `docs/skills/self-updating-wiki/SKILL.md` - reusable wiki skill contract.

### 7. Trace And Audit

Say:

> Every serious agent product needs traces. For me, the trace answers: what context did the agent use, what tool did it call, what artifact did it touch, what version changed, and what evaluation passed or failed?

Code anchors:

- `convex/agentRuns.ts` - run telemetry.
- `convex/agentSteps.ts` - append-only hash-chained step trace.
- `docs/AUDIT.md` - audit and trace story.

## Code Walkthrough Order

Use this exact order if they ask to see code.

1. `README.md`
   - Show the product, architecture diagram, and quickstart.
   - Say: "This is the product overview and the map of the system."

2. `src/engine/types.ts`
   - Show `ArtifactKind`, `Element`, `CellPayload`, `Lock`, `Draft`.
   - Say: "The uniform element model is the architecture."

3. `src/engine/roomEngine.ts`
   - Show `applyEdit`, `proposeLock`, `releaseLock`, `createDraft`.
   - Say: "The deterministic engine proves the collaboration model before live infra."

4. `src/nodeagent/core/types.ts`
   - Show `AgentModel`, `AgentTool`, `RoomTools`.
   - Say: "These are the three seams that make the agent testable."

5. `src/nodeagent/core/runtime.ts`
   - Show the bounded loop.
   - Say: "Conflicts come back as data, so the model can re-read and recover."

6. `src/nodeagent/skills/spreadsheet/cellMutator.ts`
   - Show bounded tool definitions and `write_cell_result`.
   - Say: "The agent writes evidence-bearing `CellPayload`s instead of loose scalars."

7. `convex/artifacts.ts`
   - Show CAS and lock checks.
   - Say: "This is where mutation safety lives."

8. `convex/agent.ts`
   - Show live action constructing `ConvexRoomTools` and calling `runAgent`.
   - Say: "The production action runs the same loop."

9. `src/app/store.tsx`
   - Show the memory vs Convex store seam.
   - Say: "The UI does not care which backend is active."

10. `src/ui/RoomShell.tsx`, `src/ui/LeftRail.tsx`, `src/ui/Chat.tsx`, `src/ui/panels/Artifact.tsx`
    - Show panels, upload, drag refs, artifact rendering.
    - Say: "This is where the agent becomes visible and inspectable."

11. `src/app/spreadsheetParser.ts`, `src/app/providerParserAdapter.ts`, `src/nodeagent/models/providerParserLive.ts`
    - Show spreadsheet ingest, provider extraction, and evidence artifacts.
    - Say: "Files become durable artifacts, not ephemeral prompt text."

12. `evals/ladder.ts`, `tests/agentRuntime.test.ts`, `tests/openRouterFreeModels.test.ts`
    - Show the eval ladder and regression tests.
    - Say: "The claim is not that it works once. The claim is that the harness can catch regressions."

## Chapter 3: Evaluation And Trust

**Goal:** Differentiate yourself by showing how you would evaluate the system.

Say:

> The third chapter is the most important one. I think every agent feature needs a harness. A harness means: starting state, task, allowed tools, expected trace, expected final state, deterministic checks, and semantic judgment when needed.

Formula:

```text
Harness = environment + task + tools + expected state + expected trace + judge
```

### Evaluation Table

| Feature | What can go wrong | Harness |
|---|---|---|
| Room lifecycle | bad join state, wrong permissions | room/session harness |
| Public/private chat | private context leaks into public answer | visibility boundary harness |
| Spreadsheet | duplicate apply, stale update, wrong range | spreadsheet sync harness |
| Lock/draft/merge | agent edits locked range or stale draft clobbers | collaboration harness |
| File references | agent loses source artifact or copies stale content | artifact reference harness |
| Parsing | extracted values lack evidence or wrong source id | parser adapter harness |
| Wiki | uncited/invented room memory | wiki rules harness |
| Model routing | paid model used unnecessarily or weak model fails tools | model routing harness |
| Search/research | wrong entity, fabricated specifics | retrieval/evidence harness |
| Audit trail | trace says ok when write failed | honest-status harness |

### Agent Ladder

Use this as the concise eval story:

```text
L1: read-only, no mutation
L2: single CAS edit
L3: conflict recovery
L4: blocked range must draft
L5: large-sheet range discipline
L6: long-horizon compaction + repeated recovery
```

Talk track:

> A cheap model can pass simple read/write tasks and still fail collaboration. The ladder makes that visible. The right routing question is not "which model sounds smartest," but "what is the cheapest model that safely clears the required rung?"

Code anchors:

- `evals/ladder.ts` - L1-L6.
- `tests/agentRuntime.test.ts` - lock, CAS, draft, partial trace.
- `tests/researchHarness.test.ts` - evidence-bearing `CellPayload`.
- `tests/providerParserLive.test.ts` - provider parser fallback and redaction.
- `tests/openRouterFreeModels.test.ts` - free model routing.

## Technical Drill-Down Cards

Use these if interviewers ask for depth.

### Card 1: Why Not Let The Agent Edit Directly?

Answer:

> Because the agent is probabilistic and the mutation layer should be deterministic. The agent can propose an operation, but the tool validates schema, permissions, version, affected range, idempotency, and trace before committing.

### Card 2: Why CAS If Convex Has OCC?

Answer:

> Convex OCC protects physical transaction conflicts. It does not know the agent's semantic baseline. If a human commits after the agent read but before the agent writes, the agent's write can be a new clean transaction unless the app checks `baseVersion`. App-level CAS protects intent.

### Card 3: File Upload And Parsing Strategy

Production parser shape:

```text
upload -> Convex file -> provider file/cache -> extraction -> CellPayload/evidence -> artifact/wiki update
```

Invariant:

```text
raw Convex file id != provider file id
```

Current implementation:

- Browser MVP parses CSV/TSV/XLSX/XLSM through `src/app/spreadsheetParser.ts`; CSV/TSV becomes dataframe artifacts, while XLSX/XLSM preserves Excel coordinates for grid rendering and agent tool calls.
- Cells become `{ value, status, evidence[], confidence }`.
- Provider parser adapter normalizes Gemini/OpenAI/Claude/OpenRouter extraction into evidence-bearing artifacts.
- Provider extraction tries native structured output first, then falls back to text JSON extraction and records a `Structured output fallback used` warning.
- Gemini live smoke works through that fallback; do not describe it as guaranteed native structured extraction.

Production recommendation:

- ExcelJS for exact spreadsheet-cell ingest.
- Provider-native multimodal extraction for PDFs, screenshots, images, decks, and messy diligence material.
- LiteParse as local/provider-independent grounding for layout, OCR, screenshots, page text, and bounding boxes.
- Heavier Docling/MarkItDown/PyMuPDF workers only when fidelity or OCR requirements justify the runtime.

Verification:

```bash
npm run provider-parser:smoke
```

### Card 4: Free Model Auto Routing

Say:

> `openrouter/free-auto` is a NodeRoom route, not raw OpenRouter auto. It fetches the current OpenRouter model list, keeps zero-priced text models, requires tool support for agent runs, ranks by capability signals, and falls back through the ranked list.

Why this matters:

- `openrouter/auto` can route to paid models.
- `openrouter/free` is free but random.
- `openrouter/free-auto` is free, discovered, ranked, and auditable.

Verification:

```bash
npm run openrouter:free
npm run openrouter:free -- --smoke
npm run openrouter:free -- --agent-smoke
```

### Card 5: Self-Updating Wiki

Say:

> The wiki is the room memory surface. Today it is generated deterministically from room-visible state. The future LLM wiki agent has a written skill contract: use only room-visible sources, keep a stable table of contents, link files back to artifacts, and never leak private content unless promoted.

Code/docs anchors:

- `docs/AGENT_WIKI.md`
- `docs/skills/self-updating-wiki/SKILL.md`
- `src/engine/demoRoom.ts`

### Card 6: Audit And Trace

Say:

> Finance workflows need not only an answer but a provenance chain. The trace should answer who changed what, from which version, using which model and tool, with what result status.

Code/docs anchors:

- `convex/agentRuns.ts`
- `convex/agentSteps.ts`
- `docs/AUDIT.md`

### Card 7: Long-Running Jobs In Convex

Say:

> Convex actions are the right place for provider calls, but they have a 10-minute execution limit and side effects are not automatically retried. I treated that as a product constraint: use the full envelope, reserve time for audit writes, and hand off before the platform kills the action.

Current implementation:

```text
Convex action budget -> runtime deadline/reserve -> compact context -> run tools/model
if budget gets tight -> handoff trace + agentRuns stopReason + resumable nextGoal
```

Default `/free` cap math:

```text
Convex action hard cap      = 10 minutes
free-auto slice budget      = 9 minutes
free-auto reserve           = 30 seconds
lease extra                 = 60 seconds
```

Say:

> We do not beat the Convex 10-minute limit. Each `/free` slice voluntarily hands off around 8.5 minutes, checkpoints by roughly 9 minutes, and leaves margin for trace and attempt persistence. Workflow then sleeps and resumes the next slice.

Featured durable route:

```text
/ask, /free, research, collaboration, top-model job
-> agentJobs.start(entrypoint, routePolicy, runtimePolicy, modelPolicy)
-> freeAutoWorkflow (historical name for the shared sliced workflow)
-> Workpool-limited runFreeAutoJobSlice
-> provider slice -> checkpoint/handoff -> workflow sleep/resume
```

`/free` is just `routePolicy=free_auto` and
`modelPolicy=openrouter/free-auto`; `/ask` is `routePolicy=fast_default`;
paid benchmarking can use `routePolicy=top_paid` or `explicit`. The durable job
route, leases, journal, operation ledger, attempts, and UI job strip stay the
same.

Deployment proof detail:

> I hit a Convex remote analyzer failure on Node actions (`markAsUncloneable`). The fix was to stop importing AI SDK / Node-runtime dependencies through Convex function modules. Convex actions now use the standard action runtime with a direct HTTP `AgentModel` adapter, while local evals and parser helpers can still use the AI SDK. Codegen is part of the acceptance suite because deployment analyzers catch a different class of failure than TypeScript.

What to show:

- `convex/agent.ts` - `AGENT_ACTION_BUDGET_MS`, `AGENT_ACTION_RESERVE_MS`, default compaction, and persisted `stopReason`.
- `convex/agentJobs.ts` / `convex/agentWorkflows.ts` / `convex/agentJobRunner.ts` - async free-auto job, Workflow/Workpool wrapper, lease, checkpoint, and resume path.
- `src/nodeagent/core/runtime.ts` - deadline checks before model/tool work and `handoff` result.
- `convex/agentRuns.ts` / `convex/schema.ts` - durable `stopReason`, `remainingMs`, `deadlineAt`, `handoff`.
- `src/ui/Chat.tsx` - `/free` command and latest job status chip.
- `evals/ladder.ts` - `--rung-timeout-ms` for live model budget testing.
- `docs/LONG_RUNNING_AGENTS.md` - interview runbook.

Live proof point:

> On 2026-06-08, the dev deployment completed a real `/free` smoke in one attempt using `nvidia/nemotron-3-super-120b-a12b:free`; `agentJobAttempts` recorded `resolvedModel`, `stopReason=done`, and roughly 10s latency. That proves the deployed Workflow/Workpool path can run with a real provider. It does not prove live multi-slice resume because the smoke completed in one slice; the next live proof should force tiny slice budgets.

Production pattern:

```text
intent mutation -> durable job row -> workflow/workpool step -> idempotent unit
-> checkpoint + trace -> schedule next unit or complete
```

Scheduler fallback versus Workflow/Workpool:

- The original scheduler MVP proved the state-machine shape: mutation creates a job, action runs a bounded slice, mutation checkpoints and schedules the next slice.
- The current `/free` path is Workflow/Workpool-backed: the workflow sleeps between slices, records component status, and runs each action slice under Workpool parallelism controls.
- Scheduler continuation remains only as a compatibility fallback for legacy `runtime="scheduler"` jobs.
- `agentJobs` stays the user-facing system of record either way; Workflow ids are runtime metadata, not the durable product identity.

Remaining reliability layer:

- **Duplicate enqueue idempotency:** a lease prevents two workers from running the same job, but it does not stop a double-click from creating two independent jobs.
- **Budget clamp + per-tool abort:** defaults are safe; production hardening should clamp misconfiguration and pass deadline abort signals into tools, not only model calls.
- **Provider request idempotency:** the Convex model-step journal replays completed provider responses after a crash, but provider-level idempotency keys would further reduce duplicate billing if a process dies before the response is committed.
- **Model health/quarantine:** current free-auto routing has static ranking and fallback, not a `modelHealth` table with latency, failure, rate-limit, fallback, and quarantine windows.
- **Job-runner evals:** add forced multi-slice, crash-after-provider-call replay, stale lease, retry backoff, duplicate enqueue, and resolved-model failure-path assertions.

LiveFlow bridge:

> The same idea carries to ERP agents: never let one long model call become the system of record. Persist intent, chunk work, keep cursors, make side effects idempotent, and evaluate whether the agent finishes safely inside the runtime budget.

### Card 7.5: Production Layer By Access Pattern

60-second version:

> If I productionized NodeAgent, I would separate the system by access pattern. Convex or a realtime database owns canonical room state, artifact versions, messages, traces, and permissions. Object storage owns large files like uploaded spreadsheets, PDFs, screenshots, exports, and benchmark artifacts. CDN serves static assets and explicitly public artifacts, but never active private room data. Redis or KV caches hot data such as presence, room tails, semantic answer cache, recent sheet ranges, idempotency windows, and active agent sessions. Serverless actions handle bursty async jobs like parsing files, calling models, generating exports, and running evals. I would add explicit load balancing only once I own custom websocket gateways, MCP servers, or long-running worker fleets.

15-second version:

> CDN delivers, object storage holds blobs, Convex/realtime DB holds truth, Redis/KV holds hot ephemeral state, serverless runs bursty work, and load balancing matters once we own a service fleet.

Spreadsheet-specific line:

> The uploaded workbook can live in object storage, but the working spreadsheet should be structured collaborative state: rows, cells, versions, formula dependencies, locks, drafts, and deltas. Cache recent ranges by artifact id and version; do not cache private finance data blindly.

### Card 8: Event Journaling And Provider File Identity

Interviewer challenge:

> What if an action calls a provider successfully, then crashes before saving the result?

Answer:

> A workflow can resume from checkpoints, but exact-once provider side effects need a journal at the model-step boundary. NodeRoom persists completed model steps in `agentModelStepJournal`, keyed by job id, stable slice key, and step index. On retry, `runAgent` checks the journal before calling the provider; if the step is present, it replays the recorded `AgentStep`, does not call the model, and does not count new tokens. The honest boundary is a crash before the provider response is committed; for that, provider request idempotency keys are the next adapter-level hardening where supported.

Interviewer challenge:

> Why not make the provider file id the source of truth?

Answer:

> Provider file ids are caches. The durable system of record is the Convex file/artifact id because it is permissioned, versioned, room-visible, and survives provider cache expiry. The extraction adapter can attach provider ids as metadata, but every `CellPayload.evidence` points back to the canonical room artifact.

## Built Versus Roadmap

Be explicit if asked.

Built:

- Deterministic in-memory collaboration engine.
- Live Convex backend path with member proof, room state, messages, artifacts, locks, drafts, traces, and agent action.
- Public and private room UI with resizable panels.
- Spreadsheet, research, note, wall, and wiki artifacts.
- Upload/view path for spreadsheets, text, images, PDFs, and document parser metadata.
- Drag-to-chat artifact references.
- Agent runtime with bounded tools, context, compaction, lock/CAS/draft workflow.
- Budget-aware runtime handoff for Convex action limits.
- Durable `/free` path for long-running free-auto jobs across Workflow/Workpool-backed Convex action slices.
- Workflow sleep/resume for current jobs, with scheduler continuation retained only for legacy scheduler-runtime jobs.
- Cancel/retry controls and latest-attempt telemetry for the featured long-running free-auto job.
- Convex codegen/deployment proof for the standard-runtime action path with direct provider HTTP calls.
- Evidence-bearing dataframe writes via `CellPayload`.
- Provider parser adapter and live provider smoke for Gemini/OpenAI/Claude/OpenRouter.
- LiteParse Node fallback adapter and smoke script for local PDF spatial text extraction.
- Spreadsheet semantic cell index, sub-grid chunks, and dependency-expanded locks.
- Free-first OpenRouter model discovery/routing.
- L1-L6 spreadsheet/collaboration ladder and regression tests.

Roadmap:

- Production hardening: stricter budget clamps, per-tool abort propagation, provider request idempotency keys where supported, model health/quarantine, and forced multi-slice Convex job-runner tests.
- Convex File Storage as the full raw-file system of record for all uploads.
- Long-lived provider Files API uploads behind the same adapter when reuse/retention justifies it.
- Provider-specific Convex Storage -> provider Files API binary upload actions for PDFs/images/decks.
- Full production LiteParse/OCR/layout worker deployment for Office/image conversion at scale.
- LLM-backed wiki agent; current wiki is deterministic and rule-bound.
- Broader notebook, cross-collaboration, and risk-attack harnesses.
- More audit provenance fields: explicit edit-to-read step links, `valueBefore`, prompt/model version hashes, OTel export.

## Likely Questions And Answers

### What Part Is Actually Built Versus Conceptual?

> The core collaboration engine, agent loop, UI surfaces, file references, parser normalization, free model routing, and spreadsheet/collaboration eval ladder are built and tested. Production file storage, heavier OCR/layout parsing, and LLM-backed wiki generation are roadmap. I try to keep those distinctions explicit because trust depends on honest system boundaries.

### Why Spreadsheets?

> Finance users already use spreadsheets as collaboration and audit surfaces. If an agent can safely update a spreadsheet with source evidence, versioning, and traceability, that maps naturally to ERP-backed workflows.

### Why Not Just Overwrite The Sheet?

> Because overwrite hides intent. A versioned delta preserves auditability, limits write scope, enables conflict detection, and explains exactly what changed.

### What Does Idempotency Solve?

> It prevents the same intended operation from applying twice if a provider, client, or agent retries.

### What Does Versioning Solve?

> It prevents stale updates from applying to the wrong state after another user already changed the artifact.

### How Does This Apply To LiveFlow?

> A Flow ERP agent may update a reconciliation, reporting sheet, close checklist, or ERP-backed artifact. I would want that update represented as a versioned operation with source, actor, prior version, next version, affected range, and audit trail.

### What Was The Main Learning?

> Agent product quality is mostly about system boundaries. The hard part is not only prompting. It is context selection, tool design, durable state, evals, and making failure visible.

### What Would You Build Next?

> I would keep extending the evaluation ladder: spreadsheet, notebook/note, cross-collaboration, parser, model-routing, and risk-attack harnesses. That would let me compare agents by whether they safely complete increasingly complex tasks, not just whether they produce plausible answers.

## Closing Script

Say:

> The reason I think this is relevant to LiveFlow is that Flow ERP agents will face the same product shape: multiple users, structured artifacts, financial context, agent assistance, and high trust requirements. The user experience should feel fast and collaborative, but the backend should remain deterministic, auditable, and safe. That is the kind of engineering problem I want to grow into.

Finish with:

> NodeRoom is not about making chat smarter. It is about turning collaborative context into safe, evaluated action.

## Verification Commands

Use these if asked how you know it works.

```bash
npm run typecheck -- --pretty false
npx tsc --noEmit --project convex\tsconfig.json --pretty false
npm test
npm run build
npm run provider-parser:smoke
npm run openrouter:free -- --agent-smoke
```
