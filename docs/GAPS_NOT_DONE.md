# Gaps Not Yet Done

Last updated: 2026-06-18

NodeRoom is production-shaped, but it is not yet fully production-proven. The
core harness exists: versioned room artifacts, bounded agent tools, lock/CAS
mutation, draft recovery, unified durable `agentJobs`, room-work reasoning
frames/cache rows, provider adapters, artifact traces, a QA matrix, and
professional workflow eval fixtures. The gaps
below are the remaining work needed before claiming full production scale for
GTM sales, finance, banker, and multi-file research workflows.

2026-06-18 implementation note: the first native-notebook target slice now
exists in Convex: `notebookDirtyEvents`, `notebookProcessingJobs`,
`notebookBlocks`, `notebookClaims`, `notebookMentions`, `markNotebookDirty`,
ACL-gated processing, and the first `agent_work_plan` Agent Artifact approval
by canonical `planHash`. Remaining gaps below are UI/live-proof and broader
production hardening, not absence of the backend contract.

## Operating Principle

Do not claim a feature is production-complete until it has:

- a durable backend contract,
- a UI path a non-developer can operate,
- automated regression coverage,
- live or fixture-backed eval evidence,
- trace evidence for user-visible agent actions,
- security and privacy checks for public/private room boundaries,
- a rollback or recovery story.

## P0: Public Release And Deployment Proof

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Public GitHub readiness | Public repo, license, `.gitignore`, `package.json` non-private flag, README CTA, and CI now exist. | Run a clean-clone secret scan and verify ignored local artifacts remain untracked before each public release. | Public repo exists, no `.env.local`, logs, `node_modules`, `dist`, `.serena`, local-only artifacts, or generated scratch files are tracked. |
| Convex deployment/codegen | Local Convex code is typechecked and `_generated/api.d.ts` is committed, but deployment/codegen has had analyzer fragility in past reviews. | Reproduce clean `npx convex codegen` and deployment smoke from a fresh checkout. | `npx convex codegen`, Convex typecheck, app typecheck, tests, and a live Convex smoke pass without manual edits. |
| Environment docs | `.env.example` exists. | Document required provider keys, Convex env vars, safe demo defaults, and production-only secrets. | A fresh contributor can run demo mode and knows exactly what is needed for live mode. |
| CI | `.github/workflows/ci.yml` now runs `npm run prod:gate` plus deterministic ladder eval on push/PR. | Add secret scanning and optional live-smoke gates with protected secrets. | CI passes from a clean clone and blocks stale QA docs, moderate-or-higher audit failures, stale proofs, broken SLO gate, type/test/browser-memory regressions, or build failures. |
| Dependency audit | `npm audit --omit=dev --audit-level=moderate` now passes. High/moderate Convex/esbuild and ExcelJS/uuid advisories are mitigated with npm overrides plus compatibility tests; 6 low AI SDK provider-utils advisories remain. | Decide whether low advisories should become blocking, or upgrade the AI SDK major line when app compatibility is proven. | Moderate-or-higher `npm audit` remains green in `prod:gate`; low advisories are either accepted with controls or removed. |

## P0: Long-Running Agent Job Reliability

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Atomic continuation | `/free` starts through `@convex-dev/workflow`/Workpool, interactive `/ask` pauses can start the same continuation runner, and legacy scheduler fallback remains for old jobs. | Prove a forced crash/cancel between checkpoint and continuation still resumes, including the legacy scheduler fallback path or a watchdog for due jobs. | Forced crash-after-checkpoint test resumes without operator intervention. |
| Idempotent enqueue | `agentJobs` and `agentRuns` idempotency keys exist and are covered by runtime/source tests. | Browser double-click/live retry smoke that proves no duplicate final writes or duplicate billing paths. | Same room/request id enqueues once or dedupes safely in the live UI. |
| Stale lease handling | Job slice leases are checked before `finishSlice`, and `agentJobs.sweepExpiredJobLeases` now moves abandoned `running` jobs to a fenced failed state with unit coverage. | Live duplicate-worker simulation at the workflow boundary plus deployed cron monitoring. | Duplicate scheduled slice with stale lease exits without writes, and abandoned running jobs cannot remain wedged indefinitely. |
| Slice budget clamps | Per-run/per-slice token and USD clamps exist with reserve time for checkpointing. | Live tiny-budget multi-slice smoke through Workflow/Workpool. | Multi-slice test with tiny budgets completes through resume, not timeout. |
| Provider-step journal | `agentModelStepJournal` records and replays completed model steps. | Adapter-level idempotency keys where providers support them, plus crash-before-record behavior documented as retryable. | Crash-after-provider-call recovery does not call the provider again when a completed response was journaled. |
| Frame-claimed slices | Durable jobs with materialized reasoning frames now claim one frame at a time, run through `runReasoningFrame`, record attempt `frameId`, checkpoint by frame id, and persist frame delta/evidence/status on finish. | Live multi-slice proof with forced tiny budgets plus route/provider evidence. | A deployed multi-slice room-work job resumes from a frame id, not just from raw cursor messages. |
| Model health/quarantine | Free-auto discovery and fallback exist. | Track latency, rate limits, failures, fallback count, and quarantine unhealthy free models. | Router avoids unhealthy free models and records why. |
| Live `/free` eval | Manual live ladder evidence exists. | Add a polling evaluator that starts a real `/free` job, polls attempts, and asserts terminal state plus trace evidence. | Live `openrouter/free-auto` smoke records resolved model, attempts, final artifact state, and no clobber. |

## P0: Native Notebook And Agent Artifact Readiness

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Native notebook target processing | Backend slice is implemented and covered by `tests/notebookProcessingTarget.test.ts`: `onSnapshot` remains registry-only; dirty events store metadata only; processor rechecks membership/visibility before reading the latest ProseMirror snapshot; read-model rows feed one passive item. | Wire the UI save/idle path to `markNotebookDirty`, add deployed smoke evidence, and expose read-model/processing receipts in review surfaces. | One ProseMirror edit creates one dirty event per actor/lane, one read-model update, and one passive item; `elements["doc"]` is not hot-written; private read model never feeds public jobs. |
| Agent Work Plan artifact | First backend slice is implemented in `convex/agentArtifacts.ts`: structured `agent_work_plan` rows store `payloadHash`/`planHash`, approval requires an exact hash, and approved plans create/reuse a queued `agentJobs` row carrying `approvedPlanHash`. | Build the allowlisted renderer/action buttons and planned-vs-actual artifact from receipts/traces/costs. | The user approves a canonical plan hash, execution receives that hash, rendered MDX/HTML cannot change the approved payload, and a planned-vs-actual artifact shows divergences. |

## P0: Files, Parser, OCR, And Evidence

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Canonical file storage | Convex-mode uploads now generate a Convex File Storage upload URL, register an `uploadedFiles` row, and link parsed artifacts back to `sourceStorageId` / `uploadedFileId`; provider file ids remain cache metadata only. | Live browser/Convex upload smoke, private-file visibility policy, and parser worker consumption of `sourceStorageId`. | Raw file id is durable, provider file id can be dropped and rebuilt, and every parsed artifact can retrieve its source file without client state. |
| File upload/view E2E | Spreadsheet and file references are part of the product story. | Browser E2E for upload, file list, click-to-view, drag file to chat, and agent reference selection. | User can upload, view, cite, and drag files into chat across public and private contexts. |
| Provider file adapters | Gemini/OpenAI/Claude/OpenRouter parser adapters exist as design direction; provider extraction now preserves provider id, source storage/artifact id, page, bbox, and optional table/row/column scope in `CellEvidence`. Live provider parser calls now pass through provider-route and file-egress gates. | Live binary upload/cache adapters for PDFs, DOCX/PPTX, images, screenshots, and spreadsheets. | Adapter returns structured evidence with provider id, file id, page/sheet/row/box metadata, and provenance from a live provider run. |
| Local parser lane | LiteParse dependency is installed. | Production worker lane for PDF, DOCX/PPTX, images, OCR, screenshots, layout, and bounding boxes. | Redacted fixture tests prove local extraction writes evidence-bearing artifacts without provider egress. |
| Evidence-bearing cells | `CellPayload` writes and provider parser adapter tests exist; evidence now includes optional source storage/artifact id, provider file id, page, and bbox. | Ensure every ENRICH/CLASSIFY/RESOLVE live workflow writes value, status, confidence, source artifact, and citation/evidence. | Spreadsheet agent writes are never bare scalars in production workflows. |

## P0: Professional Workflow QA

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Official BankerToolBench / SpreadsheetBench readiness | A generated official-readiness report now tracks BankerToolBench, SpreadsheetBench V1, and SpreadsheetBench V2 contracts and is wired into HALO / `agent:improve`. BankerToolBench now has local `tasks.jsonl` ingest, weighted rubric parsing, sandbox staging that keeps final prompts/input files separate from evaluator-only prompt context, formatting context, canary, rubric, golden outputs, and expected deliverable package metadata, contamination-gate proof over staged agent manifests, a local runner that emits candidate deliverables from an agent-only workspace before opening evaluator-only rubric/golden metadata, exact expected package-shape validation for supported spreadsheet/deck/document/PDF/CSV/image deliverables, a negative copy-input smoke that records 0/6 weighted points with missing/extra package accounting, a positive `apply-agent-output` smoke that records 6/6 weighted points, 1/1 pass, candidate-before-evaluator trajectory, and 0 leaks across 4 checked files, and a HALO-proof-gated local exact-package/exact-or-workbook-semantic weighted-rubric smoke verifier for Excel deliverables. SpreadsheetBench V1/V2 now have local official-bundle ingest, sandbox staging that writes separate agent/evaluator manifests, a copy-input baseline runner, an `apply-agent-patch` runner that reads `agent/edit-plan.json`, a `model-edit-plan` runner that asks a configured model for the edit plan before evaluator scoring, fair per-sheet workbook snapshots with a larger bounded context budget, agent-visible table block summaries, visible `aggregate_section` operations for section-level grouping/summing/sorting, raw model-output audit capture, unsupported-op repair, aggregate-last operation ordering, deterministic local formula result caching for arithmetic, same-sheet refs/ranges, `SUM`/`AVERAGE`/`MIN`/`MAX`/`COUNT`/`COUNTA`, `ABS`, `ROUND`/`ROUNDUP`/`ROUNDDOWN`, `IF`/`IFERROR`, single-criteria `SUMIF`/`COUNTIF`/`AVERAGEIF`, multi-criteria `SUMIFS`/`COUNTIFS`/`AVERAGEIFS`, exact `MATCH`/`INDEX`/`VLOOKUP`/`XLOOKUP`, `SUMPRODUCT`, text extraction/search (`LEFT`/`RIGHT`/`MID`/`LEN`/`FIND`/`SEARCH`/`REPLACE`), `TEXT`/`DATE`, `VALUE`, `CONCATENATE`, and `TRIM`, expected-formula-only scoring with scalar-gold/formula-candidate equivalence when values match, repeated-run accounting (`caseCount`, `attemptCount`, `passRate`, p50/p95/max latency, failure taxonomy, model calls, tokens, cost), explicit retry accounting (`--retry-failed`, optional `--retry-score-failures`, case-level retry exhaustion/pass-after-retry stats), per-attempt agent-workspace manifests proving copied agent-visible files before candidate generation, candidate-output contamination-gate proof, a local Node permission subprocess smoke proving evaluator-only reads are denied outside an agent workspace, a local workbook scorer for values, formulas, optional cell style fingerprints, answer-range column/row layout, and merge ranges, and a static SpreadsheetBench V2 chart-package scorer wired into workbook score/run reports to compare normalized `xl/charts/*.xml` plus `xl/drawings/*.xml` parts for matched/missing/extra/mismatched chart evidence. Smoke reports cover a BTB-shaped fixture, a BTB proof command that enforces staged isolation, candidate-before-evaluator trajectory, negative and positive weighted-rubric/package accounting, supported deliverable policy, and zero artifact leaks, plus an Excel deliverable fixture that accepts semantically matching workbooks despite package hash drift, a passing SpreadsheetBench deterministic edit-plan fixture, a one-task passing live `gpt-5.4-nano` model-edit fixture smoke, an official V1 N=5 live smoke that records 5/5 pass, average overall 1.0, p95 4.593s, $0.01059125 spend, zero failure counts, and 0 candidate-output leaks after section-operation/scorer repair, an official V1 retry live smoke that records 3/3 scored attempts, full 302-cell snapshots, best overall 0.616667, p95 11.033s, $0.0095201 spend, and 0/3 pass, V2 score/run smokes that surface missing chart/drawing package parts as `chartPackage: 0`, a full verified-400 V1 stage proof that records 400/400 tasks staged, 800 agent-facing files, 400 evaluator gold files, clean isolation counters, and 0 leaks across 800 checked files, a V2 public-example stage proof that records 3 paired input/gold tasks staged from 26 example tasks with clean isolation, and 0-leak contamination smokes for staged/N=5/retry/BTB/V2 outputs including agent-workspace manifests. The gate still reports 0/3 ready by design. | Run model-edit-plan across larger official held-out bundles, add full official formula/format policy, run larger held-out model/route executions including official chart tasks, adapt BTB MCP tool servers, wire Harbor/Gandalf official execution, import Gandalf verifier scores, and finish production weighted-rubric scoring. | `npm run benchmark:official:readiness -- --strict` passes and at least one official adapter records model, harness, tool policy, budget, verifier, trajectory, retries/failures, route, and final deliverables without answer lookup or evaluator mutation. |
| GTM sales workflows | Local CSV/XLSX corpus has been profiled and converted into eval backlog. | Row-level evals for company classification, enrichment, CRM preservation, source citation, and PII masking. | Fixture evals pass and one live provider smoke completes with trace evidence. |
| Finance/banker workflows | Finance and timesheet workbook shapes are identified. | Reconciliation evals for formulas, locked cells, source rows, rounding, and sensitive-value redaction. | Agent preserves formulas/layout and only writes bounded evidence-bearing cells. |
| Semantic Rebase runtime | A pure CRS policy classifier and tests now exist for safe auto-merge, formula overwrite rejection, banker assumption review, private-evidence blocking, and evaluator artifact immutability. | Durable conflict packets/resolutions, triggers from stale patch bundles/draft conflicts/proposal CAS conflicts, LLM resolver action, validators, semantic proposal UI, and final CAS application. | Conflicts over formulas, assumptions, evidence, and memo meaning route to deterministic merge, validated model proposal, human review, or rejection without bypassing CAS. |
| Multi-file research | Cross-file workflow need is documented. | Eval for using several uploaded artifacts as context without leaking private files into room public traces. | Public/private source boundaries are asserted in tests. |
| QA matrix continuity | `docs/qa/production-matrix.json` and generated docs exist. | Require every new feature to append/update the QA matrix and generated README visualization. | CI fails if matrix docs are stale. |

SpreadsheetBench addendum: the harness now has a broader official V1 three-task
repeated live smoke on the locally staged corpus. `gpt-5.4-nano` records 15/15
pass across 3 cases and 5 repeats, average overall 1.0, p95 5.080s,
$0.0462905 spend, zero failure counts, zero retry attempts, and
0 candidate-output leaks across 75 checked files in
`docs/eval/spreadsheetbench-v1-model-edit-plan-3task-n5-live-smoke.json` plus
`docs/eval/spreadsheetbench-v1-run-3task-n5-contamination-smoke.json`. The new
`filter_rows` and `sort_unique_rows` structural operators cover visible date
filtering and visible duplicate-removal/sort tables without evaluator-gold
access, repeatedly under live model variance. Each result now records SHA-256
sidecar evidence for the candidate manifest, agent-workspace manifest,
generated edit plan, and raw model output. `npm run
benchmark:spreadsheetbench:proof` now enforces the recorded run/leak/sidecar
thresholds and candidate-before-evaluator trajectory order, and is part of
HALO. Remaining gap stays focused on official execution: run larger held-out
official bundles, finish full route execution/scoring, and wire BankerToolBench
production verifier integration before claiming official benchmark readiness.
Route selection itself is now a checked artifact:
`docs/eval/spreadsheetbench-v1-route-selection.json` classifies 400 staged V1
tasks as 41 deterministic table transforms, 218 formula edits, 33 format edits,
and 108 general edits with `blocked_chart_visual=0`, while
`docs/eval/spreadsheetbench-v2-route-selection.json` classifies the staged V2
public examples as 2 formula edits and 1 general edit.

SpreadsheetBench full-bundle baseline addendum: `npm run
benchmark:spreadsheetbench:run-chunked` now runs the V1 staged bundle in fresh
child processes and recursively splits failed chunks so one pathological
workbook does not abort the full smoke. The checked-in
`docs/eval/spreadsheetbench-v1-copy-input-full-smoke.json` records 400/400
attempted tasks, 15/400 pass, average overall 0.257472, and zero failure counts
after malformed answer-position, unsupported XLSX package-part, and
external-link cell-read repair. This is harness-throughput and failure-taxonomy
evidence for the copy-input baseline; the remaining gap is still full
model/route execution and official scoring parity across the bundle.

Docker/Harbor addendum: `npm run benchmark:docker-sandbox:probe` now writes
`docs/eval/docker-sandbox-probe.json` and is part of HALO. The current artifact
records `container_isolation_proven` with Docker `28.5.1`, `node:22-alpine`,
`--network=none`, `--read-only`, an agent-workspace-only mount, and denied
evaluator reads. That closes the local Docker tool blocker. Remaining official
work is Harbor/Gandalf-backed benchmark runs that execute the full runner under
the official policy.

BankerToolBench official-contract addendum: `npm run
benchmark:bankertoolbench:official-contract` now writes
`docs/eval/bankertoolbench-official-contract.json` and is part of HALO. The
current artifact is `blocked_external_requirements`: it requires dataset
revision and manifest-lock hashes, Harbor/Docker execution evidence, SEC /
market-data / logo / document / web MCP adapters, and Gandalf verifier score
import before any BTB readiness claim can turn green.

BankerToolBench provenance addendum: `npm run
benchmark:bankertoolbench:manifest-lock` now hashes `tasks.jsonl`,
`task-data/**`, and `golden-outputs/**` into a lockfile. HALO runs it against
the local BTB-shaped fixture and writes
`docs/eval/bankertoolbench-manifest-lock-smoke.json`; an official claim still
requires the same lock format over the real dataset revision.

SpreadsheetBench V2 rendered-chart addendum: `npm run
benchmark:spreadsheetbench:chart-visual:probe` now writes
`docs/eval/spreadsheetbench-chart-visual-probe.json` and is part of HALO. The
current artifact records `chart_visual_grade_proven`: Excel exported a real
SpreadsheetBench V2 Visualization chart sheet, Poppler rasterized the PNGs, and
Gemini 3.5 Flash accepted the matching oracle candidate while rejecting the raw
input negative control. The checked-in evidence includes candidate/gold PNG
hashes, dimensions, and `docs/eval/spreadsheetbench-chart-visual/task-126/vlm-report.json`.
That closes rendered/VLM chart grading infrastructure; remaining official
SpreadsheetBench work is full route execution and model solving over held-out
official chart tasks.

## P1: UI Operations

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Job controls | Status chips, cancel/retry, attempts, job detail, reasoning-frame tree, receipts, latest steps, and operation rows are browser-visible for the latest job. | Add deeper drilldown, filter/search, frame-level retry/cancel controls, and live browser coverage. | A host can operate a long-running job without reading logs. |
| Auto-accept UX | Accept/reject proposal flow exists. | Host opt-in modal for auto-accept/accept-all, scoped to safe proposal classes, with remember-my-preference. | Auto-accept never applies blocked, stale, or policy-failed proposals. |
| Spreadsheet/agent interaction | Spreadsheet, trace, notes, and chat are wired. | Browser E2E for spreadsheet row selection -> ask agent -> proposed cells -> accept -> trace -> note/wiki reference. | Agent and spreadsheet remain synchronized under concurrent human edits. |
| June 2026 workroom shell | Binder -> Work Surface -> Copilot -> Signal Tape/Status Strip is implemented in the MVP shell; center-stage split mode now has memory-mode browser proof. Remaining work: richer binder click-throughs, live/Convex shell proof, Gemini UI judge proof, and status drilldown tests. | Add live browser specs, media judge walkthrough, richer binder source/proof/policy click-throughs, and status drilldown tests. | Browser specs prove binder navigation, center split source/proof mode, right-side Copilot steering, thin bottom status, no overflow, and no private-data leakage in ambient events. |
| Wall operations | Wall exists. | Create/delete/edit post-it E2E, including multi-user conflict handling. | Two users can create/delete without ghost posts or stale UI. |
| Resizable containers | Desired by user. | Persist panel widths per user/room and keep accessible keyboard reset. | Users can give more space to spreadsheet or chat without breaking layout. |

## P1: Workflow/Workpool Productionization

Workflow/Workpool is wired for the durable job path. The remaining work is no
longer "add Workflow"; it is production hardening around live frame-claimed
multi-slice evidence, backpressure, retries, crash recovery, and deployed
monitoring.

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Workflow adapter | `@convex-dev/workflow` and `@convex-dev/workpool` are wired while `agentJobs` remains the user-facing system of record. | Deployed crash/retry/backpressure proof, plus docs that keep Workflow ids as runtime metadata. | Workflow ids are runtime metadata; NodeRoom artifact/job ids remain durable. |
| Retry/backoff/concurrency | Basic attempts exist. | Centralize retry policy, concurrency limits, and crash recovery. | Backpressure protects providers and Convex while jobs still make progress. |
| Step journal | `agentModelStepJournal` records provider steps; mutation receipts and operation rows record commits. | Extend journal/idempotency coverage where provider/parser adapters expose safe request ids. | Replays are explainable and exactly-once where side effects matter. |

## P1: Algorithm Artifacts And Calculation Promotion

The first formula/DSL runner is now implemented, tested, and HALO-wired:
`run_algorithm_artifact` validates a deterministic `spreadsheet_formula`
artifact, reads versioned cells, executes fixture tests, returns an
evidence-bearing patch bundle, and hands off ready-to-pass
`write_locked_cell_results` arguments. The checked smoke
`docs/eval/algorithm-artifact-smoke.json` proves a reusable revenue variance
artifact can rerun over room cells and commit only through managed lock/CAS.

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Durable artifact storage | Formula/DSL artifacts run in memory through the agent tool and smoke script. | Persist algorithm artifacts and runs in Convex with spec hash, runner version, input snapshot refs, output patch bundle refs, and promotion status. | A user can reopen, inspect, rerun, deprecate, and compare algorithm versions from durable state. |
| Artifact promotion UI | README/docs describe the contract; no product UI yet. | Copilot/stage view for draft -> validated -> promoted artifacts, fixture failures, source refs, and ready-to-apply patches. | Host can approve or reject a calculation artifact without reading logs or raw JSON. |
| CAS rebase integration | Runner returns base versions and managed-write args; write tool commits safely. | End-to-end browser eval where an artifact is produced, a human edits a target before commit, and the runtime drafts/conflicts instead of clobbering. | Artifact patch bundles never bypass no-clobber behavior under live multi-user edits. |
| Wider calculation coverage | Runner supports safe numeric formula DSL only. | Add workbook-range/table transforms, formula-preservation checks, source extraction rules, and benchmark-backed route selection before sandboxed code. | Finance/SpreadsheetBench cases use reusable artifacts where deterministic logic beats one-off model edits. |
| Sandboxed code lane | Not implemented by design. | Only add after process isolation, resource limits, network denial, package policy, and promotion review are proven. | No arbitrary LLM-authored code can become product truth without sandbox and promotion proof. |

## P1: HALO Self-Improvement Depth

HALO now has the repo-controlled self-improvement loop wired into
`npm run agent:improve`: `npm run halo:self-improve:smoke` repeats runtime
cases N=5, `npm run halo:variant:select` scores competing harness variants and
writes `selectedParent`, `npm run halo:convex-context:smoke` mirrors Convex
`agentJobs.detail` into the same context metric shape, and
`npm run halo:live-path:calibrate` records real-provider path thresholds. The
checked artifacts are `docs/eval/halo-self-improvement-smoke.json`,
`docs/eval/halo-variant-selection.json`,
`docs/eval/halo-convex-context-telemetry.json`, and
`docs/eval/halo-live-path-calibration.json`.

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Harness variant selection | Implemented. `halo-variant-selection.json` compares `explicit-agent-lock-v1` and `runtime-managed-lock-v1`; the selected parent is `runtime-managed-lock-v1`. | Keep adding variants as declarative candidates, never as directly executed model-authored code. | `npm run halo:variant:select` passes and records `selectedParent` plus safety boundary. |
| Live-provider path calibration | Implemented for the managed-write path. `halo-live-path-calibration.json` records `deepseek/deepseek-v4-flash`, 5 live runs, 2 accepted fingerprints, p95 3 tool calls, p95 4 model calls. | Extend the same calibration to additional champion/free routes before promoting them. | `npm run halo:live-path:calibrate -- --real <route> --repeats 5` passes for any route promoted into README charts. |
| Convex job-context telemetry | Implemented for local Convex runtime. `halo-convex-context-telemetry.json` is generated through `convex-test`, `agentJobs.detail`, attempts, operation events, model journal rows, hash-chained steps, and compacted cursor data. | Mirror the same report from deployed Convex once production telemetry export is enabled. | `npm run halo:convex-context:smoke` passes; deployed export becomes an additional live gate, not a missing local contract. |
| Sandboxed autonomous patching | Deliberately constrained. HALO can select variants and hand off the selected patch target; arbitrary model-authored code still cannot execute as product truth. | Only add after process isolation, architecture-budget ownership, commit-message path coverage, and human review policy are proven. | No model-authored patch can execute or merge without sandbox and deterministic gate proof. |

## P1: Observability, Audit, And Retention

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Trace size limits | Traces exist, and a bounded telemetry-retention cron now prunes old `traces`, `agentSteps`, and `agentOperationEvents` without touching product data or spend ledgers. | Add per-run trace size caps, summarization/compaction for oversized payloads, and export hooks. | Long jobs do not bloat Convex documents or UI payloads, and retained/exported traces remain explainable. |
| Provider telemetry | Resolved model is recorded in key paths, direct provider calls emit/persist provider route receipts in the model-step journal, and `/free` claim slices carry artifact metadata into egress checks. | Add fallback count, provider error class, retry reason, and live provider-health quarantine reports. | Model routing decisions can be audited after the fact. |
| Provenance fields | Evidence direction exists. | Add `valueBefore`, `contextSnapshotRef`, `promptHash`, `modelVersion`, and `harnessVersion` where appropriate. | A disputed cell can be traced back to source, prompt, model, and room state. |
| SLO dashboard | `npm run slo:gate` now enforces a deterministic concurrent room-agent SLO/load floor and writes `docs/eval/slo-gate.json` when requested. | Add deployed operational dashboard for pass rate, p95 latency, job completion, provider health, and queue age. | Demo and production health are visible without opening logs. |

## P1: Security And Privacy

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Secret hygiene | `.gitignore` excludes local env and logs. | Run secret scan before every public push. | No provider keys or local tokens are committed. |
| Public/private boundaries | Product has public room and private agent lanes, and production-preview memory-mode Playwright now covers the main no-leak browser path. | Add live Convex browser coverage for no private chat/file leakage into room trace, wiki, wall, public artifacts, exports, and downstream handoffs. | Privacy boundary failures block release. |
| Provider egress policy | Central provider route/artifact egress policy exists; public `/ask`, `/free`, blocking private agent, private streaming, and live provider-parser file egress all gate model/provider egress. Production can fail closed on missing provider allowlists. | Add live OpenRouter no-training audit and full public/private file visibility policy across exports and downstream handoffs. | Sensitive files cannot be sent to external providers accidentally. |
| Upload abuse limits | Browser parsing has file-size caps and Convex registration rejects invalid names, MIME lengths, and raw files over 25MB. | Add count/rate limits, malware/content scanning policy, and live abuse tests. | Bad uploads fail safely and visibly. |

## P2: Agent-Generated Wiki And Documentation Loop

| Gap | Current state | Needed proof | Acceptance gate |
|---|---|---|---|
| Self-updating wiki | Deterministic wiki/update rules and skill docs exist. | LLM-backed wiki agent that updates only from room-visible evidence and preserves a fixed TOC. | Wiki update eval proves stable TOC, clickable artifact refs, and no private leakage. |
| Interview notes freshness | Interview notes and README are strong learning artifacts. | Keep new production lessons appended as the system evolves. | Every major harness/context engineering change updates README, interview notes, or the gap register. |
| Architecture diagram freshness | Architecture docs and diagrams exist. | Keep diagrams regenerated when provider/parser/job architecture changes. | README architecture stays accurate after code changes. |
| Audience-fluency proof artifacts | Audience context YAML, an affluent/private-investment episode brief, rendered episode, deterministic content-fluency gate, and Gemini media judge output exist. | Close current media-judge P1 defects, run trust-signal/content-fluency review, and keep the checklist in the generated QA matrix. | `npm run content:fluency:check` passes, media judge has no unresolved P0/P1 defects, and review output verifies context accuracy, restraint, discretion, provenance, and proof quality. |
| Demo/media evidence quality | Episode-level Gemini judges exist, and a batch media judge now covers README GIFs, workflow previews, and episode renders. | Run the batch judge after every capture/render refresh and feed P0/P1 findings into the QA matrix or gap register. | `npm run media:gemini-judge -- --all` produces a current `docs/eval/MEDIA_JUDGE.md` with no unresolved P0 media defects. |

## Release Checklist

- Run `npm run qa:matrix:check`.
- Run `npm run typecheck -- --pretty false`.
- Run `npx tsc --noEmit --project convex/tsconfig.json --pretty false`.
- Run `npm test`.
- Run `npm run ladder`.
- Run `npm run build`.
- Run `npm run media:gemini-judge -- --all` when walkthrough/demo media changes.
- Run `npm run benchmark:official:readiness`; require
  `npm run benchmark:official:readiness -- --strict` only when claiming
  BankerToolBench or SpreadsheetBench readiness.
- Run a secret scan excluding ignored local files.
- Verify public repo contents from a clean clone.
- Run a live Convex smoke before claiming production deployment.

## Summary Verdict

The most important remaining work is not adding more prompts. It is hardening
the harness around the model: durable workflow steps, atomic continuation,
file/provider evidence, public/private data boundaries, live evals, and
operator-facing job controls. Once those gates pass, NodeRoom can credibly claim
production-scale support for GTM sales, finance, banker, and multi-file research
workflows.
