# Changelog

## 2026-06-18 - Native notebook processing and Agent Work Plan approval

### What changed

- Added the native notebook processing backend slice:
  `notebookDirtyEvents`, `notebookProcessingJobs`, `notebookBlocks`,
  `notebookClaims`, and `notebookMentions`.
- Added `convex/notebookProcessing.ts` with `markNotebookDirty`,
  `processNotebookDirtyEvent`, read-model commit logic, and owner-filtered
  read-model queries.
- Reused the passive classifier path from `convex/roomActivity.ts` so native
  notebook read models and legacy passive activity use one noteworthy
  classifier contract.
- Added `agentArtifacts` and `convex/agentArtifacts.ts` for the first shipped
  Agent Artifact kind: `agent_work_plan`.
- Made approval hash-based: `approveAgentWorkPlan` re-hashes the stored
  structured payload and only starts/reuses a job when the submitted `planHash`
  exactly matches.
- Copied the approved hash to `agentJobs.request.approvedPlanHash` so execution
  can be tied back to the reviewed structured plan.
- Added `tests/notebookProcessingTarget.test.ts` covering dirty-event dedupe,
  ACL/revocation, read-model rows, private isolation, passive classifier reuse,
  and approved-plan job creation.

### Why it matters in plain language

Native notebook sync can move quickly without turning every editor snapshot into
agent work. The durable trigger is now actor-authenticated dirty metadata; the
processor rechecks ACL before reading the latest snapshot; passive intelligence
comes from a processed read model; and the first agent action is an approvable
structured plan, not an invisible write.

## 2026-06-17 - Passive room intelligence and file-processing adapters

### What changed

- Installed and registered
  [`@ikhrustalev/convex-debouncer`](https://www.convex.dev/components/ikhrustalev/convex-debouncer)
  in `convex/convex.config.ts`.
- Added `roomActivityOutbox` as the quiet-window queue for passive note,
  spreadsheet, file, artifact, and message activity.
- Added `convex/roomActivity.ts` with a shared enqueue helper, manual enqueue
  mutation, debounced scheduler call, and deterministic scan/classification
  mutation.
- Hooked successful cell edits into the passive activity outbox without changing
  the CAS/no-clobber result path.
- Added `fileProcessingJobs` and `convex/fileProcessing.ts` so Convex storage,
  Transloadit, and future ConvexFS processing ids are tracked as adapter
  metadata.
- Hooked file registration into `fileProcessingJobs` and the passive activity
  outbox.
- Added `sourceCaptures`, `evidenceFacts`, and `convex/evidence.ts` for the
  Evidence Accountant lane.
- Extended the Firecrawl `recordCapture` port so source captures can also write
  source/evidence rows, not only trace-facing capture rows.
- Added `tests/roomActivityEvidenceAdapters.test.ts` covering dedupe/scan,
  Transloadit external id separation, and source/evidence rows.

### Why it matters in plain language

The core product flow is now represented in durable state:

1. A user types a note, edits a row, or uploads a file.
2. The fast user mutation saves the work and returns immediately.
3. Passive activity is debounced so rapid edits do not trigger expensive work.
4. A later scanner decides whether to ignore, index, create backlinks, or start
   a durable agent job.
5. File and source processing ids are attached to the room without replacing
   the canonical Convex storage id.

### Side-by-side

| Question | Without this change | With this change |
|---|---|---|
| What happens when a user types quickly? | Every edit can become a possible scan/job trigger. | Repeated edits collapse into one debounced `roomActivityOutbox` row. |
| What happens when a file is uploaded? | The raw storage id exists, but processing status and external ids are ad hoc. | `uploadedFiles.storageId` stays canonical; `fileProcessingJobs` tracks Convex/Transloadit/ConvexFS processing metadata. |
| What happens when Firecrawl extracts a fact? | The trace can show a capture, but downstream cells need a stronger evidence target. | `sourceCaptures` and `evidenceFacts` give CellPayloads and OKF concepts stable evidence refs. |
| What happens if Transloadit or ConvexFS is introduced later? | They risk becoming a second source of truth for files. | They fit behind the adapter ledger; external ids remain cache/runtime metadata. |
| What happens if Durable Agents is adopted too early? | A new runtime competes with NodeAgent's lock/CAS/evidence contract and adds a Zod 4 peer conflict. | It remains a researched reference until stable; NodeRoom's durable path stays `agentJobs` + Workflow/Workpool. |

### Component decisions

| Component | Decision |
|---|---|
| Convex Debouncer | Adopted now. Compatible and useful for quiet-window passive scans. |
| Convex File Storage | Already canonical for raw files; keep it as the durable file source of truth. |
| Transloadit Convex component | Wrap first through `fileProcessingJobs`; direct install waits for credentials/runtime confirmation. |
| ConvexFS | Future CDN/path adapter; direct install waits because the component is alpha and requires Bunny.net envs. |
| Durable Agents | Reference only for now; its docs mark it early/not production-ready and it peers on Zod 4. |

## 2026-06-17 - Firecrawl capture_source adaptation for Convex

### What changed

- Added a server-only NodeAgent tool registry:
  `SERVER_PRODUCTION_ROOM_TOOLS` in
  `src/nodeagent/skills/server/productionTools.ts`.
- Kept the browser and memory-mode registry, `PRODUCTION_ROOM_TOOLS`,
  free of server-only capture tools.
- Wired Convex agent runners to the server registry, so server-side jobs can
  call `capture_source` without pulling browser or Playwright dependencies into
  the client bundle.
- Implemented `capture_source` for the Convex action path with Firecrawl:
  `src/nodeagent/skills/search/captureSourceFirecrawlTool.ts`.
- Preserved Browserbase as the exact-browser worker substrate for walkthroughs,
  pixel/box capture, and external worker lanes.
- Made the capture URL guard Convex-bundle safe by keeping the private-host/IP
  checks in pure TypeScript instead of importing Node-only network helpers.
- Set the required provider keys in Convex dev and production environments
  without committing secrets.

### Why it matters in plain language

NodeRoom has two very different places where capture can run:

- The **browser/demo path**, where the app must stay light and bundle-safe.
- The **server agent path**, where a Convex action can call outside services and
  save evidence back to the room.

Browserbase is powerful because it can drive a real browser, but that power
comes with heavy runtime dependencies. Those dependencies are a bad fit for the
shared browser-safe tool registry and can also confuse Convex bundling when they
are imported by server functions that do not actually need a full browser.

Firecrawl is the right default for the Convex action lane because it is an HTTP
scrape/capture service. The agent can fetch a public source, extract structured
evidence, and write trace data back to Convex without bundling Playwright.

### Side-by-side

| Question | Without the adaptation | With the Firecrawl adaptation |
|---|---|---|
| Can a server NodeAgent capture a web source from a Convex action? | Risky. The capture tool would drag browser/worker-only dependencies into paths that should stay bundle-safe. | Yes. Convex imports the server registry and runs a Firecrawl-backed `capture_source` tool. |
| Does the browser demo stay light? | No guarantee. A shared registry can accidentally pull server capture code into memory-mode or client paths. | Yes. Browser-safe tools stay in `PRODUCTION_ROOM_TOOLS`; server-only tools live in `SERVER_PRODUCTION_ROOM_TOOLS`. |
| Do we lose Browserbase? | It either leaks into the wrong place or has to be removed. | No. Browserbase remains the exact-browser worker option for visual walkthroughs and pixel/box evidence. |
| Can evidence show up in traces? | Inconsistent. The agent may only have cheap text snippets or a failed capture path. | Yes. The Firecrawl tool records capture steps, extracted data, screenshots/boxes when available, and source URLs through the room port. |
| Is the design explainable in interviews? | Harder: one generic capture path tries to satisfy browser, worker, and Convex constraints at once. | Easier: Firecrawl is the Convex HTTP capture lane; Browserbase is the external real-browser lane. |

### Verification recorded

- Convex dev environment accepted the Firecrawl, Browserbase, OpenAI, and
  Anthropic environment variables.
- Convex production deploy succeeded after the server-tool split.
- Live smoke verified Browserbase plus the reasoning model on `example.com`.
- Live smoke verified the Firecrawl-backed `capture_source` tool on
  `example.com`.
- GitHub CI passed after the deploy with `prod:gate` and ladder checks green.

### Convex components reviewed

NodeRoom uses externally authored Convex components as infrastructure pieces,
not as a replacement for the NodeAgent harness:

| Component | What the official component provides | How NodeRoom adapts it |
|---|---|---|
| [`@convex-dev/workflow`](https://www.convex.dev/components/workflow) | Durable multi-step execution with persisted state, delays, retries, cancellation, and reactive status. | Runs long agent jobs in slices while `agentJobs` remains the user-facing system of record. |
| [`@convex-dev/workpool`](https://www.convex.dev/components/workpool) | Queued action/mutation execution with parallelism limits, retries/backoff, and completion callbacks. | Caps and schedules background agent slices through the named `agentWorkpool`. |
| [`@convex-dev/persistent-text-streaming`](https://www.convex.dev/components/persistent-text-streaming) | Streams generated text while persisting chunks to Convex for recovery and later reads. | Powers private text streaming; structured room writes still go through CAS/proposal/job tools. |
| [`@convex-dev/agent`](https://www.convex.dev/components/agent) | Agent building blocks: message threads, vector search, and long-running workflows. | Researched as an adjacent reference. NodeRoom keeps NodeAgent as canonical because the app needs custom lock/CAS/evidence/proposal semantics. |

Convex Components are safe to install because they are isolated mini-backends:
they do not read app tables or call app functions unless explicitly wired. That
matches NodeRoom's rule: third-party components provide durable substrate, while
NodeAgent owns collaboration intent and evidence-bearing writes.
