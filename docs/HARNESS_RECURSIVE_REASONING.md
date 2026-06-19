# Harness-Native Recursive Reasoning

Last updated: 2026-06-16

This is the canonical decision record for the "Fable-like reasoning" upgrade in
NodeRoom. The capability is implemented as a NodeAgent harness layer, not as a
dependency on a specific frontier model.

## Decision

NodeRoom uses:

```text
Omnigent outside, NodeAgent inside, Convex underneath.

Omnigent -> optional meta-harness for model/harness choice, policies, sessions,
and sandboxing.
NodeAgent -> room-native reasoning kernel: frames, context packs, cache policy,
verification, OKF evidence, and managed writes.
Convex -> durable source of truth for jobs, frames, cache rows, receipts, traces,
locks, and artifact state.
```

The user-facing story is a high-pressure room, not a lab benchmark. A banker,
operator, or teammate needs progress on many rows, sources, or claims while the
room stays collaborative and auditable. The harness turns that request into
visible frames so the user can see what is being planned, executed, verified,
and synthesized.

Do not describe this as a model feature. The harness owns memory, continuation,
verification, and budget control. Models remain swappable workers behind
`runAgent`.

## Core Flow

```text
user command (/ask, /free, or room-work intake)
  -> optional Agent Work Plan approval by canonical planHash
  -> agentJobs create/reuse with idempotency key
  -> normalize entities, facets, artifact target, and visibility
  -> lookup entityResearchCache and OKF where available
  -> buildRoomWorkReasoningPlan(...)
  -> materialize agentReasoningFrames + entityWorkItems
  -> run immediate slice or Workflow/Workpool continuation
  -> runAgent executes bounded model/tool turns through RoomTools
  -> managed writes enforce lock/CAS/proposal/evidence gates
  -> finish/checkpoint updates job, frame statuses, receipts, trace, UI detail
  -> planned-vs-actual report shows what matched or diverged from the plan
```

The speed-to-fill rule is cache-first:

1. Fresh cache hit: reuse immediately and mark the matching work item completed.
2. Stale cache hit: let the room show the known value, then schedule refresh work.
3. Cache miss: create narrow child work for the missing entity/facet.
4. Contradiction or weak evidence: mark review-needed; do not silently promote.

## Implemented Surfaces

| Concern | Implementation |
|---|---|
| Frame types and deterministic plan builder | `src/nodeagent/core/reasoningFrames.ts` |
| Frame context envelope helpers | `src/nodeagent/core/contextPack.ts` |
| Frame result reducer | `src/nodeagent/core/frameReducer.ts` |
| Frame verifier | `src/nodeagent/core/frameVerifier.ts` |
| Frame runner above `runAgent` | `src/nodeagent/core/frameRunner.ts` |
| Durable frame rows | `convex/schema.ts` table `agentReasoningFrames` |
| Entity/facet child work | `convex/schema.ts` table `entityWorkItems` |
| Entity/facet cache | `convex/schema.ts` table `entityResearchCache` |
| Room-work admission and materialization | `convex/agentJobs.ts` |
| Browser-visible job detail | `convex/agentJobs.ts` query `detail` |
| UI frame tree | `src/ui/Chat.tsx` (`reasoning-frame-tree`) |
| Store detail shape | `src/app/store.tsx` (`lastLongFreeJobDetail`) |
| Minimal adoption smoke | `examples/nodeagent-frame-runner/minimal.ts` |

## Frame Model

Every room-work plan uses five phase frames:

1. `intake` - normalize the request and entity/facet signatures.
2. `plan` - choose cache reuse vs stale refresh vs missing research.
3. `execute` - run bounded entity/facet work and child frames.
4. `verify` - check evidence, freshness, no-op writes, and unsupported claims.
5. `synthesize` - summarize the result for room trace, UI, and handoff drafts.

Child frames are not permanent agents. They are bounded work items under one
harnessed Room Agent, usually for one stale or missing entity/facet.

## Current Boundary

The landed contract materializes frames during room-work admission, exposes them
through job detail, updates frame status as slices start, finish, cancel, or
expire, and provides `runReasoningFrame(...)` for executing one explicit frame
through the existing `runAgent` loop. The durable job runner now claims one
runnable frame at a time, records the attempt `frameId`, checkpoints cursors with
the frame id, invokes `runReasoningFrame`, and persists the frame delta/evidence
receipt through `finishSlice`.

Do not overclaim that every fast inline/private `/ask` path is forced through
frames. The frame-claimed runner is for durable jobs that have materialized
reasoning frames, strongest today in room-work/entity-facet flows.

## Relationship To OKF

OKF remains the portable evidence graph. `entityResearchCache` is not a second
knowledge graph; it is the room-local operational lookup layer for speed. Cache
rows point back to evidence refs and can be refreshed or invalidated without
rewriting the OKF contract.

## Relationship To Omnigent

Omnigent is the optional outer meta-harness. Use it for:

- model/harness routing,
- policy gates,
- sandbox and terminal rules,
- cross-agent review or session sharing.

Do not use Omnigent YAML as the durable memory store. YAML can start or govern a
NodeAgent run; Convex rows store the cognition state.

## Non-Goals

- No permanent agent per company, person, source, or spreadsheet column.
- No model-specific "Fable mode" prompt promise.
- No memory hidden only in model transcripts.
- No bypass around Convex auth, CAS, locks, proposals, or evidence write gates.

## Verification Pointers

- Runnable adoption proof: `npm run nodeagent:frame:smoke` executes a complete
  read/lock/CAS/release frame and fails if the frame receipt or artifact state is
  wrong. The current proof artifact is
  `docs/eval/nodeagent-frame-smoke.json`.
- Source-shape coverage: `tests/agentJobsSource.test.ts` checks job detail,
  reasoning-frame UI markers, and server-side execution boundaries.
- Frame-runner coverage: `tests/frameRunner.test.ts` checks context envelopes,
  tool allowlists, deltas, verifier status, and handoff classification.
- Runtime/job coverage remains in `tests/agentJobsRuntime.test.ts` and the HALO
  job-context telemetry gates.
- UI coverage: `tests/chatReasoningFrames.test.tsx` checks the job-detail frame
  tree.
- Before shipping frame-runner changes, run app typecheck, Convex typecheck, the
  focused frame/job/UI tests, the full test suite, and build.
