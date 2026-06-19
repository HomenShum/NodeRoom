# Intake classifier + preflight planner + scheduler (queue vs parallel subagent vs steering)

Status note after the target implementation pass: the typed deterministic layer
landed as `src/nodeagent/core/intakePreflight.ts` with unit coverage in
`tests/intakePreflightScheduler.test.ts`. It classifies command-like messages,
expands affected sets, and blocks privacy/formula/budget unsafe plans before
provider spend. The UI now renders a deterministic, non-actionable
`IntakePlanPreview`; a first-class Agent Artifact with Authorize / Guide me /
Queue actions and any cheap-LLM scheduler path remain production backlog.

## Decision

Build a three-stage front door for every `/ask` (and command-like chat message): a **cheap intake classifier** that emits exactly one typed proposal, a **deterministic preflight planner** that computes the affected set at PLAN time, and a **deterministic scheduler** that maps a conflict-class to one of the already-built outcomes (CAS-commit / draft / proposal / queue / parallel). The classifier PROPOSES only — it never spawns, locks, or writes; the harness acts. This mirrors the proven "LLM proposes, harness executes" split in `docs/MANAGED_LOCK_PERF.md` and keeps the feature inside the architecture budget (`docs/NODEAGENT_ARCHITECTURE.md:28-37`). Reuse `expandElementIdsWithSpreadsheetDependencies` (already at `convex/locks.ts:22`) for the write-set closure rather than writing new closure code. Map proposed conflict classes onto EXISTING gates (dependency-closure lock + `approvalPolicy=host_review`, `evidencePolicy`) — do NOT add a `formula_protected` table or a second strong-lock level. Ship preflight first (highest leverage, already designed in `docs/architecture/AGENT_SCRATCHPAD_CELL_COLLAB.md` §5), then classifier+scheduler, then the soft Intent-Claim presence level; DEFER true in-flight steering (no inbound channel exists — route `steering_patch` to "cancel + re-enqueue merged goal" via existing idempotency reuse for v1). Gate every part behind a scripted eval rung with a negative control BEFORE any live/UI claim, mirroring `evals/chatIntakeRuntime.ts`.

## Current state (already built — do not re-spec)

- **Exact-goal idempotency / dedupe** — `src/nodeagent/core/idempotency.ts:25-41` (`runIdempotencyKey` FNV-1a over normalized `roomId|artifactId|actorId|goal`; `findReusableRun` reuses in-flight OR <60s-finished). Atomic race-safe claim at `convex/agentRuns.ts:19-34` (`claimOrReuse`); job-level reuse at `convex/agentJobs.ts:79-81` (`createOrReuse`) and `:233-235` (`startFreeAuto`). Covers the EXACT-goal case only.
- **Formula-dependency closure** — `expandElementIdsWithSpreadsheetDependencies(ctx, artifactId, elementIds)` called at `convex/locks.ts:22`; backed by `spreadsheetDependencies` (`convex/schema.ts:551-561`, `by_parent`/`by_child`). Runs at LOCK-GRANT time, formula slice only.
- **Strong reservation (= the "Commit Lease")** — `convex/locks.ts` `proposeLock`/`releaseLock` with `expiresAt = now + LOCK_TTL_MS` (`:42`), janitor `sweepExpiredLocks` (`:116-139`), host `hostForceReleaseLock` "Yoink" (`:147-171`). Managed write acquires+releases inside one tool call (`src/nodeagent/skills/spreadsheet/cellMutator.ts:101-119`). This IS the short, commit-scoped strong lease — do NOT rebuild it.
- **Outcome mechanisms the scheduler selects among** — four-gate `applyCellEdit` (`convex/artifacts.ts`, documented `docs/AGENT_RUNTIME.md:147-174`); blocked → `create_draft` + `mergeBlockedDrafts` deterministic smart-merge (`convex/drafts.ts:39-76`); review-mode → `pendingApproval`/`proposalId` (`roomTools.ts:161`); managed write auto-drafts when blocked (`src/nodeagent/skills/spreadsheet/cellMutator.ts:64-99`).
- **Durable job substrate** — `agentJobs` with full status union, `priority` (always 0 today — `agentJobs.ts:92,254`), `nextRunAt`, `by_status_nextRunAt` index (`schema.ts:245-282`); workflow `maxParallelism: 3` (`convex/agentWorkflows.ts:9`); `cancel`/`retry` controls (`agentJobs.ts:350,372`).
- **Spend enforcement** — `checkSpendCeiling` (`src/nodeagent/core/runtime.ts:249-255`), `roomSpendSince`/`globalSpendSince` (`convex/agentRuns.ts:79-111`), `priceStep` real USD (`runtime.ts:274`). The ESTIMATE + authorize-before-spend UX is missing.
- **Provenance invariant (REUSE, do not rebuild)** — `chatClaimsStayManual` (`evals/chatIntakeRuntime.ts:388`); provenance ladder `user_said > quoted_third_party > room artifact > fetched source > computed` (`docs/eval/FEATURE_EVAL_BACKLOG.md:65`); `fetch_source` "NEVER cite a source you did not fetch" (`src/nodeagent/skills/spreadsheet/cellMutator.ts:427`). Negative control `naiveChatIntakePlan` fabricates a source and MUST fail (`chatIntakeRuntime.ts:187-213`).

## Net-new work (sequenced)

### 1. Preflight planner — `computeAffectedSet` at plan time (effort: L)
- **Files:** new `src/nodeagent/core/intakePreflight.ts`; new optional fields on `agentJobs` (`convex/schema.ts`): `intendedReadSet?: string[]`, `intendedWriteSet?: string[]`, `expandedAffectedSet?: string[]`, `affectedSetVersion?: number`.
- **Do:** `computeAffectedSet(ctx, { roomId, artifactId, writeSet })` = reuse `expandElementIdsWithSpreadsheetDependencies` for formula closure, then read `locks.activeLocks`, `drafts` (`by_room_status`), `proposals` (`by_room_status`), and per-cell presence (step 4) and union them. Keep it CHEAP + DETERMINISTIC — no model call here.
- **DoD:** given a fixed room fixture, `computeAffectedSet` returns a sorted, deduped element-id set whose formula slice equals the lock-grant expansion for the same write-set; persisted on the job; covered by a unit test asserting byte-identical output across two runs (DETERMINISTIC).

### 2. Intake classifier — typed proposal only (effort: L)
- **Files:** new `src/nodeagent/core/intakePreflight.ts` (Zod union + cheap-LLM call); called from `convex/agent.ts:runRoomAgent` entry and `src/app/store.tsx:askAgent` BEFORE `createOrReuseAgentJob`.
- **Do:** a deterministic prefilter first (regex/command heuristics — `/ask`, `/enrich`, imperative verbs) so non-command chatter NEVER triggers a model call (cost open-question below). When the prefilter passes, one cheap model call returns an `IntakeDecision` (union below). The LLM maps intent → target/read/write set; it does NOT spawn/lock/write. Classifier model calls count against `roomSpendSince`/`globalSpendSince`.
- **DoD:** classifier output validates against the Zod schema or the run fails closed (HONEST_STATUS); a scripted plan covers each union variant; off-target output (e.g. emitting `parallel_subagent` for an overlapping write-set) is REJECTED by the scheduler, not the classifier.

### 3. Scheduler — conflict-class → existing outcome (effort: L)
- **Files:** new `src/nodeagent/core/intakePreflight.ts`; drives `agentJobs.priority`, `nextRunAt`, new `dependsOnJobId?: Id<"agentJobs">`.
- **Do:** consume preflight + classifier output; map conflict-class to an action (table below) using ONLY existing mechanisms. `formula_protected` → dependency-closure lock + `approvalPolicy=host_review` (NOT a new class/table). `privacy_boundary` → existing `evidencePolicy` (`schema.ts:37`) + chat-intake `privateChannelOnly`. `queue_after_dependency` sets `dependsOnJobId` + `nextRunAt`.
- **DoD:** for each conflict-class, the scheduler emits the documented outcome and NEVER a weakened/parallel gate (`NODEAGENT_ARCHITECTURE.md:37`); negative-control plan (spawns parallel on overlap / writes a human-active cell / queues an independent job) MUST fail the rung.

### 4. Soft Intent-Claim presence level (effort: L) — ADVISORY ONLY
- **Files:** new `cellPresence` table (`roomId`, `artifactId`, `elementIds`, `holder`, `expiresAt ≈ now+90s`), distinct from `locks`; render via existing lock-flag cell-outline grammar (`src/ui/panels/Artifact.tsx`).
- **Do:** NEVER blocks a human keystroke (`AGENT_SCRATCHPAD_CELL_COLLAB.md:122`). Feeds `computeAffectedSet`. TTL-swept by the existing janitor pattern (BOUND).
- **DoD:** a human edit to a cell with a live agent intent-claim succeeds with NO gate; presence row auto-expires; a test asserts presence is never read by the four write gates.

### 5. planHash dedupe extension (effort: M) — requires #1 persisted
- **Files:** extend `src/nodeagent/core/idempotency.ts` with `planHash(intent, targetArtifacts, normalizedTargets, sourceRefs, policy)` + an overlap check against in-flight jobs' `expandedAffectedSet`.
- **DoD:** two semantically-equal goals with different wording collapse to one job; an overlapping (not identical) write-set routes to `queue_after_dependency`; sorted-key hashing → deterministic (DETERMINISTIC).

### 6. PlanPreview / authorize-before-spend card (effort: M)
- **Files:** `src/ui/Chat.tsx` + `src/ui/panels/Artifact.tsx` (Copilot), fed by preflight estimate.
- **Do:** show a RANGE with explicit uncertainty derived from recorded `agentRuns` telemetry (ms/costUsd/steps), not a guessed number (HONEST_STATUS). Default to `queue`/`draft_only` when estimate confidence is low. Authorize action aligns with existing host-review/`approvalPolicy` surface (open-question below).
- **DoD:** the card renders `[Authorize] [Guide me] [Queue]`; quoted estimate is a range tagged with sample size; low-confidence path defaults to queue, not authorize.

### 7. Steering (effort: XL) — DEFERRED to follow-up
- **v1:** route `steering_patch` to "cancel current job + re-enqueue with merged goal" via existing idempotency reuse + `cancel` (`agentJobs.ts:350`). True in-flight patch draining (new `agentSteeringPatches` table + runtime turn-boundary hook) ships only after #1-#3 prove value (the runtime loop has no inbound channel today).

## Interfaces / types

```ts
// src/nodeagent/core/intakePreflight.ts — classifier output. LLM PROPOSES; harness acts.
export type IntakeKind =
  | "new_command" | "steering_patch" | "parallel_subagent"
  | "wait_for_unlock" | "clarification_needed" | "note_only"
  | "cancel_or_priority_change";

export interface IntakeDecision {
  kind: IntakeKind;
  goal: string;                 // normalized intent text
  targetArtifactId?: string;
  intendedReadSet: string[];    // element ids the agent expects to read
  intendedWriteSet: string[];   // element ids the agent expects to write
  sourceRefs: string[];         // cited room artifacts / fetched sources
  targetJobId?: string;         // for steering_patch / cancel_or_priority_change
  confidence: number;           // 0..1; low → scheduler defaults to queue/draft
  reason: string;               // one-line rationale (for trace + PlanPreview)
}
// Zod union mirrors this; runtime fails CLOSED if parse fails.

// src/nodeagent/core/intakePreflight.ts
export type ConflictClass =
  | "independent" | "formula_protected" | "human_edit_overlap"
  | "agent_claim_overlap" | "privacy_boundary" | "pending_proposal_overlap";

export interface PreflightResult {
  expandedAffectedSet: string[];   // formula closure ∪ refs ∪ presence ∪ drafts/proposals (sorted)
  conflicts: ConflictClass[];
  costEstimate: { minUsd: number; maxUsd: number; sampleSize: number };   // RANGE, from agentRuns telemetry
  runtimeEstimate: { minMs: number; maxMs: number; sampleSize: number };
}

// src/nodeagent/core/intakePreflight.ts — maps conflict → EXISTING outcome
export type ScheduleAction =
  | { kind: "spawn_parallel" }                                  // provably-disjoint affected sets only
  | { kind: "cas_commit" }
  | { kind: "proposal_only" }                                   // formula_protected → host_review path
  | { kind: "draft_only" }                                      // human_edit_overlap
  | { kind: "queue_after_dependency"; dependsOnJobId: string }  // agent_claim_overlap
  | { kind: "ask"; redact?: boolean }                           // privacy_boundary → evidencePolicy
  | { kind: "queue" };                                          // default / low confidence

export interface ScheduleDecision {
  action: ScheduleAction;
  priority: number;     // writes agentJobs.priority
  nextRunAt?: number;
}
```

| ConflictClass | ScheduleAction | Backed by (existing) |
|---|---|---|
| independent (disjoint) | spawn_parallel | workflow `maxParallelism:3` |
| formula_protected | proposal_only | dep-closure lock + `approvalPolicy=host_review` |
| human_edit_overlap | draft_only / human_wins | `create_draft` + `mergeBlockedDrafts` |
| agent_claim_overlap | queue_after_dependency | `dependsOnJobId` + `nextRunAt` |
| privacy_boundary | ask / redact | `evidencePolicy` + `privateChannelOnly` |
| pending_proposal_overlap | queue | proposals `by_room_status` |

## Risks & mitigations (8-point checklist)

- **BOUND** — `cellPresence` and any in-flight affected-set cache MUST have TTL + janitor eviction (reuse the `sweepExpiredLocks` pattern, `locks.ts:116-139`). No unbounded Map of pending classifications.
- **HONEST_STATUS** — classifier parse failure fails CLOSED (no fake `new_command`); PlanPreview never shows a 2xx-style "authorized" before the spend gate clears. Off-route classifier output is rejected by the scheduler, surfaced as a conflict, not silently corrected.
- **HONEST_SCORES** — `confidence` and cost/runtime estimates come from recorded `agentRuns` telemetry with explicit `sampleSize`; NO hardcoded confidence floor. Low confidence → queue, not authorize.
- **TIMEOUT** — the classifier model call uses an `AbortController` + a tight budget gate; on timeout, fall back to the deterministic prefilter result (treat as `new_command` queued), never hang the intake.
- **SSRF** — preflight does NOT fetch; only `fetch_source` (existing URL validation) touches the network. The classifier must not be allowed to trigger a fetch.
- **BOUND_READ** — affected-set reads (locks/drafts/proposals/presence) use indexed `by_room_status` queries with a cap; never a full-table scan that grows with room age.
- **ERROR_BOUNDARY** — every new Convex mutation/action (presence upsert, scheduler dispatch, planHash claim) wraps its handler; a failed classification cannot wedge the job loop — it degrades to the existing exact-goal path.
- **DETERMINISTIC** — `planHash` and `computeAffectedSet` use sorted-key hashing / sorted element-id output; same inputs → byte-identical output (asserted in the rung). The classifier is the only non-deterministic stage and it PROPOSES only.

## Definition of done (scenario-based)

1. **Scripted rung (gate before any live claim)** — mirror `evals/chatIntakeRuntime.ts`: a deterministic happy-path plan satisfying the scheduler contract, PLUS a negative-control plan that does every wrong thing at once (spawns `parallel_subagent` on an overlapping write-set; writes a human-active cell instead of drafting; queues an independent job; emits a `new_command` for a `steering_patch` target) — the grader MUST fail it.
2. **Independent vs overlapping (concurrent)** — two agents with provably-disjoint affected sets run in parallel (≤ `maxParallelism:3`); two with overlapping write-sets → the second gets `queue_after_dependency` with `dependsOnJobId` set, verified via job rows.
3. **Human-wins under load (sustained)** — a human edits a cell while an agent holds an intent-claim on it: the human edit commits with no gate; the agent's write routes to `draft_only`; presence row expires by TTL. No accumulated presence rows after the run (BOUND).
4. **Dedupe (burst)** — double-clicked `/ask` and a reworded-but-equivalent `/ask` both collapse to one job via `planHash`; exact-goal path still works (regression).
5. **Cost gate honesty** — PlanPreview shows a range with sample size; a low-confidence preflight defaults to `queue`/`draft_only`, NOT `authorize`; classifier model calls are counted against `roomSpendSince`.
6. **Provenance preserved (regression)** — the existing `chatClaimsStayManual` invariant still passes unchanged; intake/scheduler additions never upgrade a chat-tier claim.

## Open questions

- Classifier on a PUBLIC anonymously-joinable room: deterministic prefilter on EVERY message, model call only on command-like ones? Confirm classifier spend counts against `roomSpendSince`/`globalSpendSince`.
- Reservation-model migration (`NODEAGENT_ARCHITECTURE.md:786-797`, Option A keep locks canonical vs B generalize into `agentLeases`) must be decided before adding `cellPresence`, or it becomes a third overlapping concept.
- `parallel_subagent` semantics: a second concurrent `agentJobs` row on the same artifact (relying on lock/CAS, two visible cursors) — or only allowed when affected sets are provably disjoint? (Requires #1 shipped first.)
- Steering scope: may a `steering_patch` change the TARGET artifact/write-set (invalidates leases + slice `sliceKey`, `LONG_RUNNING_AGENTS.md:201-213`), or only refine goal text? Needs a re-keying rule.
- Who authors the PlanPreview Authorize action on a multi-user room — requester or host? Align with existing host-review/`approvalPolicy`/Yoink surface to avoid a new permission concept.
