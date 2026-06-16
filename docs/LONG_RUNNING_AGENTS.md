# Long-Running Agent Jobs

This is the interview-ready story for long-running NodeRoom jobs in a Convex environment.

## Constraint

Convex actions are the right place for provider calls because they can make network calls, but they have a hard action execution limit of 10 minutes. Actions also have side effects, so Convex cannot automatically retry them safely after errors. Official references:

- Actions: https://docs.convex.dev/functions/actions
- Limits: https://docs.convex.dev/production/state/limits
- Workflows: https://docs.convex.dev/agents/workflows

## What NodeRoom Does Now

The live agent action (`convex/agent.ts`) runs inside that 10-minute window with an explicit reserve:

```text
deadlineAt = action start + AGENT_ACTION_BUDGET_MS
reserveMs  = AGENT_ACTION_RESERVE_MS
```

The runtime (`src/nodeagent/core/runtime.ts`) checks the deadline before each model turn and before tool execution. If there is not enough usable time left, it returns a resumable `handoff` instead of pushing the action into Convex's hard timeout.

Deployment note:

```text
Convex action module -> standard action runtime
  -> src/nodeagent/models/convexModel.ts direct provider HTTP adapter
  -> same AgentModel interface as local evals
```

The local eval/provider-parser path can still use the Vercel AI SDK. Convex function modules avoid that dependency boundary so `npx convex codegen` exercises the same deploy analyzer path that production uses.

Persisted run telemetry now records:

```text
stopReason: done | step_budget | time_budget | error
remainingMs
deadlineAt
handoff
```

The handoff is also written as a trace event (`tool: "handoff"`), so it participates in the same append-only, hash-chained `agentSteps` audit path as normal tool calls.

Current direction: `/ask` is no longer a separate persistence path. Every
durable public or Room-lane request creates or reuses an `agentJobs` row first,
then runs the first slice immediately. Private read-only advise is still a
one-call private reply path and does not create a job. If a durable slice
exhausts its step/time budget, it checkpoints cursor state and starts the same
Workflow/Workpool continuation path. The current ledger records bounded
job-level and aggregate slice events; per-query and per-mutation operation rows
remain the target contract. `/free` remains only the explicit slow/free model
policy.
See
[`docs/NODEAGENT_ARCHITECTURE.md`](NODEAGENT_ARCHITECTURE.md).

For room-work/entity-facet flows, job creation also materializes the selected
recursive-reasoning state: `agentReasoningFrames` for phase/child lineage,
`entityWorkItems` for bounded child work, and `entityResearchCache` for
cache-first speed-to-fill. The durable runner claims one runnable frame at a
time, executes it with its `ContextPack` through `runReasoningFrame`, records the
attempt `frameId`, and updates frame status/delta/evidence when slices finish,
cancel, retry, or expire.

## Free-Auto Model Policy

NodeRoom also has an explicit free-auto command for demos and low-cost
background work:

```text
/free <goal>
  -> agentJobs.start(routePolicy=free_auto, runtimePolicy=workflow_sliced)
  -> durable agentJobs row
  -> @convex-dev/workflow freeAutoWorkflow
  -> Workpool-limited internal action agentJobRunner.runFreeAutoJobSlice
  -> runAgent with modelPolicy=openrouter/free-auto
  -> checkpoint or complete
  -> workflow sleep/resume when work remains
```

This is not a second agent architecture. It is the same durable job route with
`entrypoint=free`, `routePolicy=free_auto`, and
`modelPolicy=openrouter/free-auto`. Normal `/ask`, research, collaboration, and
top-model jobs use the same `agentJobs.start` route with different policies.

Durable tables:

```text
agentJobs
  roomId, artifactId, goal, status
  modelPolicy = AGENT_MODEL for /ask, openrouter/free-auto for /free
  runtime = workflow
  workflowId, workId
  cursor, handoff
  attempts, maxAttempts
  leaseId, leaseUntil
  nextRunAt, latestRunId

agentJobAttempts
  jobId, runId, attempt
  resolvedModel, stopReason
  ms, tokens, cost
  error, scheduledNextAt

agentReasoningFrames
  jobId, framePlanId, frameId, parentFrameId, phase, status
  contextPack, toolAllowlist, evidenceState, stateDelta

entityWorkItems
  jobId, entityType, entityKey, facet, cachePolicy, status, cacheId

entityResearchCache
  roomId, visibility, entityType, entityKey, facet
  resultHash, evidenceRefs, status, validUntil, staleAfter
```

Runtime knobs:

```text
FREE_AUTO_JOB_MODEL=openrouter/free-auto
FREE_AUTO_JOB_SLICE_BUDGET_MS=540000
FREE_AUTO_JOB_RESERVE_MS=30000
FREE_AUTO_JOB_MAX_STEPS_PER_SLICE=3
FREE_AUTO_JOB_CONTEXT_MAX_CHARS=24000
FREE_AUTO_JOB_CONTEXT_KEEP_RECENT=10
```

`FREE_AUTO_JOB_MODEL` only overrides jobs whose saved policy is
`openrouter/free-auto`. A handed-off `/ask` job keeps the model policy selected
for the interactive slice, so Workflow continuation does not silently switch a
Gemini/OpenAI/Claude run into the free-auto lane.

Default cap math:

```text
Convex hard action cap       = 10 minutes
default slice budget         = 9 minutes
default reserve              = 30 seconds
default lease extra          = 60 seconds
default model-call handoff   = before usable time reaches zero
```

At the defaults, a slice voluntarily hands off around 8.5 minutes and has a
full persistence margin before Convex's hard cap. That is the correct product
claim: NodeRoom does not beat the 10-minute limit; it leaves margin, writes a
checkpoint, and lets Workflow sleep/resume the next slice. The remaining
hardening is to clamp misconfigured budgets so they cannot erase that margin.

Lease behavior:

```text
claimSlice(jobId, leaseId)
  - refuses terminal jobs
  - refuses currently leased running jobs
  - increments attempt
  - records leaseUntil

finishSlice(...)
  - records agentJobAttempts
  - updates job status
  - stores cursor/handoff
  - releases lease
  - stores nextRunAt for workflow-runtime jobs
  - only schedules a next slice directly for legacy scheduler-runtime jobs

sweepExpiredJobLeases()
  - runs from cron
  - finds running jobs whose leaseUntil is in the past
  - marks active agentLeases as expired
  - records a failed attempt with stopReason=lease_expired
  - clears the job lease token and moves the job to failed
  - fences any late old slice because finishSlice requires the matching leaseId
```

The cursor stores compacted `AgentMessage[]` plus any `remainingToolCalls` from a mid-turn handoff. On the next slice, `runAgent` resumes from those messages instead of rebuilding the task from scratch.

Job controls:

```text
cancel(jobId)
  - terminal state = cancelled
  - clears lease so a still-running slice cannot overwrite the user's cancel

retry(jobId)
  - moves failed/blocked/cancelled/paused jobs back to queued
  - extends maxAttempts without erasing prior attempt history
  - starts a fresh workflow id
```

Workflow/Workpool behavior:

```text
freeAutoWorkflow (historical name for the shared durable slice workflow)
  - polls agentJobs.workflowState
  - sleeps until nextRunAt without consuming action runtime
  - runs one bounded action slice per workflow step
  - disables provider-call retries at the Workpool layer because each slice owns
    its own retry/attempt accounting and provider calls must not double-bill
```

## Durable Provider-Step Journal

Workflow retry alone is not enough for provider calls. The expensive failure
case is:

```text
slice starts
  -> calls provider
  -> provider returns a valid model step
  -> process crashes before the job checkpoint mutation
  -> retry starts from the old cursor
  -> without a journal, the retry calls and bills the provider again
```

NodeRoom closes that gap at the model-step boundary:

```text
runAgent step N
  -> journal.get(jobId, sliceKey, N)
  -> if found: replay AgentStep, do not call provider, do not count new tokens
  -> if missing: call provider
  -> immediately journal.record(jobId, sliceKey, N, AgentStep)
  -> execute tool calls
  -> checkpoint cursor/handoff at slice end
```

The durable table is `agentModelStepJournal`, indexed by
`(jobId, sliceKey, step)`. The `sliceKey` is intentionally not the attempt
number. Attempts increment on retries; the slice key is derived from the
semantic slice input:

- Initial slice: entrypoint, job id, artifact id/version, goal, mode, model
  policy, and step cap.
- Continuation slice: entrypoint, job id, artifact id, goal, mode, model policy,
  cursor, handoff, and step cap.

That means a retry before checkpoint sees the same key and replays the model
step, while a successful checkpoint writes a new cursor and naturally starts a
new slice journal. Tools may re-execute on replay, which is acceptable because
writes are still guarded by locks, CAS baselines, and mutation receipts.

Honest boundary: if the process dies before the provider response is received
or before `journal.record` commits, there is no completed result to replay. The
next retry may call the provider again. Where providers expose request
idempotency keys, those can be added as a further adapter-level optimization,
but the durable journal solves the common crash-after-response/before-checkpoint
double-bill case.

## Remaining Hardening

The durable shape is built: `agentJobs`, `agentJobAttempts`,
idempotent `agentJobs.start` (with `startFreeAuto` as a compatibility wrapper),
`freeAutoWorkflow`,
Workpool-limited slices, leases, cursor/handoff resume, cancel/retry,
resolved-model attempt telemetry, and durable provider-step journaling. What
remains is the reliability layer that turns it from a
demo-compatible background path into a production worker:

| Gap | Why it matters | Direction |
|---|---|---|
| Stricter budget clamps | Defaults leave margin, but env overrides can shrink the reserve too far. | Cap slice budgets below the platform limit and enforce a larger reserve floor. |
| Per-tool abort propagation | The runtime checks time before each tool, and model calls are abortable, but a slow tool started near the deadline can still run to completion. | Thread a deadline `AbortSignal` into tools and long I/O helpers. |
| Provider idempotency keys | The durable journal replays after a response is recorded, but cannot replay a response that never committed. | Add provider request idempotency keys where supported and store provider request ids on journal rows. |
| Model health and quarantine | Static free-model ranking plus fallback is not the same as production routing. | Track latency, timeouts, failures, rate limits, fallback count, and quarantine windows. |
| Failure-path model provenance | A successful call records the concrete resolved model, but an all-candidates-failed path can still report the alias. | Store attempted models and final attempted model on each attempt. |
| Real job-runner tests | Current deterministic coverage proves the shape, and live smoke covers `/ask` handoff; deeper crash injection still needs dedicated fixtures. | Add forced multi-slice Convex tests for resume, stale leases, crash-after-provider-call replay, retry backoff, and duplicate enqueue. |

## Context Management

Long runs do not keep appending full stale reads forever. The runtime accepts compaction options, and the Convex action enables them by default:

```text
AGENT_CONTEXT_MAX_CHARS=24000
AGENT_CONTEXT_KEEP_RECENT=10
```

Compaction keeps the task, recent turns, and message envelopes intact while eliding old bulky `read_range` results. That preserves provider tool-call history without letting context size drift.

## Evaluation Pattern

The ladder runner supports per-rung runtime budgets:

```bash
npm run ladder:real -- openrouter/free-auto --rung-timeout-ms=540000 --reserve-ms=30000
```

That makes "does the model finish safely inside the operational budget?" part of the eval, not a subjective demo judgment. The `openrouter/free-auto` result is recorded in `docs/eval/free-auto-ladder.md`: L1-L3 were functionally correct but slow; L4 did not finish in the run budget. That is why free-auto remains opt-in and the live collaboration default is a faster ladder-proven model.

Verification commands:

```bash
npm run typecheck -- --pretty false
npx tsc --noEmit --project convex\tsconfig.json --pretty false
npx convex codegen --dry-run --typecheck disable
npm test
npm run ladder
npm run free-job:smoke
npm run liteparse:smoke
```

`npm run free-job:smoke` is optional because it needs real deployment env:

```text
CONVEX_URL or VITE_CONVEX_URL
FREE_JOB_ROOM_ID
FREE_JOB_ARTIFACT_ID
FREE_JOB_ACTOR_ID
FREE_JOB_ACTOR_TOKEN
```

Live deployment smoke (2026-06-08):

```text
dev deployment: zealous-goshawk-766
goal: say "free job smoke complete" and stop
result: completed
attempts: 1/1
resolvedModel: nvidia/nemotron-3-super-120b-a12b:free
stopReason: done
latency: 10055ms
```

This proves the deployed Workflow/Workpool path can run with a real provider.
It does not prove live multi-slice resume because this smoke completed in one
attempt. The next live proof should force tiny slice budgets and assert resume,
lease, attempt, resolved-model, and final artifact state across multiple slices.

The first run failed with a provider 401 because `OPENROUTER_API_KEY` was not set in
the Convex dev environment. After setting that env var, the same live path completed.

The regression test `resumes a long-running job across multiple step-budget slices` in `tests/agentRuntime.test.ts` forces a read -> checkpoint -> edit -> checkpoint -> final answer sequence with a fresh model instance per slice.

## Production Pattern

For short interactive collaboration, one action can use the full 10-minute envelope with a reserve and handoff. For durable production jobs such as multi-document parsing, bulk enrichment, or ERP reconciliation, split the work:

```text
user intent mutation
  -> durable job row / artifact cursor
  -> workflow/workpool step
  -> idempotent unit of work
  -> checkpoint result + trace
  -> schedule next unit or complete
```

Convex Workflows / Workpool are the production direction when the job must survive server restarts, retry individual steps, limit concurrency, and resume from recorded state. NodeRoom's handoff object is intentionally shaped like a workflow checkpoint: it carries the original goal, pending tool calls, message count, trace count, latest assistant text, and budget reason.

## LiveFlow Carryover

The same pattern applies to Flow ERP-style agents:

- Do not make one giant unrecoverable agent call.
- Persist user intent before side effects.
- Chunk work into idempotent steps with cursors.
- Record model, cost, latency, stop reason, and evidence.
- Leave enough runtime reserve to write the audit trail.
- Evaluate with both outcome checks and trajectory checks.

The soundbite:

> We do not try to beat the 10-minute serverless limit. We engineer around it: budget-aware runs, compacted context, durable checkpoints, idempotent steps, and evals that measure whether the agent finishes safely inside the envelope.
