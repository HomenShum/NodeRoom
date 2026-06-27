# Passive Room Intelligence v2 — Redesign

> **Status:** Proposed  
> **Date:** 2026-06-26  
> **Owner:** Homen  

## Problem

The current Passive Room Intelligence (PRI) system saturated the Convex workpool,
starving user-initiated jobs. Root causes (see diagnosis below):

1. **No priority separation** — passive and user jobs share one workpool
   (`maxParallelism: 8`).
2. **Unbounded retry loop** — passive jobs get `maxAttempts: 20` on the free
   route, which has tight spend limits. Each `spend_budget` failure re-enqueues
   via `recordWorkflowComplete`, creating an infinite cycle.
3. **OCC conflicts** — `recordLiveOperation` and `recordStreamEvent` patch the
   same `agentJobs` document concurrently, causing 7,345+ permanent OCC
   failures.
4. **Over-aggressive trigger** — `classifyNoteworthy` fires at score ≥ 0.35,
   creating jobs for any text with entity-like names.
5. **No backpressure** — the system never checks queue depth or workpool pressure
   before creating new passive jobs.

## Design

### Architecture: Three-Layer Separation

Inspired by ambient intelligence best practices (filtering is the product,
confidence gates, backpressure) and production agent systems (Cursor's async
indexer, GitHub Copilot's separate job queue, Notion's dual-path indexing).

```
┌─────────────────────────────────────────────────────┐
│  Layer 1: Observation (existing, unchanged)         │
│  roomActivityOutbox + debounce → scanDueActivity    │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  Layer 2: Filtering (redesigned)                    │
│  classifyNoteworthy → confidence gate → dedupe      │
│  • Threshold raised: 0.35 → 0.60                    │
│  • Hysteresis: require 2 signals before job creation│
│  • Hash-based change detection (skip unchanged)     │
└──────────────────┬──────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────┐
│  Layer 3: Delivery (redesigned)                     │
│  Separate workpool + priority queue + backpressure   │
│  • P0: user-initiated (never shed)                  │
│  • P1: passive research (shed under load)           │
│  • P2: passive enrichment (shed aggressively)       │
└─────────────────────────────────────────────────────┘
```

### Change 1: Separate Workpool for Passive Jobs

**Problem:** Passive and user jobs share `freeAutoWorkflow` with
`maxParallelism: 8`.

**Solution:** Create a second workflow component for passive jobs with its own
parallelism budget.

```typescript
// convex/agentWorkflows.ts
const PASSIVE_WORKFLOW_MAX_PARALLELISM = 2; // vs 8 for user jobs

export const passiveRoomWorkWorkflow = workflow.define(
  components.passiveWorkpool,  // new component
  {
    args: { jobId: v.id("agentJobs") },
    returns: v.null(),
  },
).handler(async (step, { jobId }): Promise<null> => {
  // Same slice logic but capped at 2 concurrent
  ...
});
```

**Why:** GitHub Copilot's architecture isolates "async job queue for all
non-interactive work" from the user request path. Cursor's Async Indexer runs
as a separate background service. This ensures user jobs always have capacity.

### Change 2: Priority Queue with Aging

**Problem:** Naive FIFO queue starves user jobs when passive jobs fill slots.

**Solution:** Add `priority` field to `agentJobs` (already exists but unused)
and implement aging to prevent starvation.

| Priority | Job Type | Shed Policy |
|---|---|---|
| P0 | User-initiated (`entrypoint: "free_auto"` from chat) | Never shed |
| P1 | Passive research (`mode: "research"`) | Shed under heavy load |
| P2 | Passive enrichment (`mode: "enrich"`) | Shed aggressively |

Aging: a P2 job waiting > 5 minutes gets promoted to P1, then P0 after 10
minutes. This prevents indefinite starvation.

**Why:** The DEV.to capacity management article describes this exact pattern:
"Priority queues handle this, but naive priority queues have a starvation
problem. Aging works by promoting requests that have waited longer than the
aging interval."

### Change 3: Backpressure Gate Before Job Creation

**Problem:** `createPassiveRoomWorkJob` never checks system pressure.

**Solution:** Before creating a passive job, check queue depth and reject if
above threshold.

```typescript
async function createPassiveRoomWorkJob(ctx, row, finding, text, now) {
  // Backpressure gate
  const queuedCount = await ctx.db
    .query("agentJobs")
    .withIndex("by_status_nextRunAt", q => q.eq("status", "queued"))
    .take(50);
  const passiveQueued = queuedCount.filter(j => j.mode === "research").length;
  if (passiveQueued >= 10) {
    // Mark outbox row as "deferred" — will be retried on next scan
    await ctx.db.patch(row._id, {
      status: "deferred",
      error: "backpressure: too many passive jobs queued",
      updatedAt: now,
    });
    return { ok: false, error: "backpressure" };
  }
  // ... existing job creation
}
```

**Why:** The backpressure article: "Every buffer between planning and execution
must have a fixed capacity. When the queue is full, the planner blocks." The
ambient intelligence article: "The agent must process far more signal than it
will ever surface. Filtering is the product."

### Change 4: Bounded Retries with Circuit Breaker

**Problem:** `maxAttempts: 20` on free route with `spend_budget` failures
creates infinite retry loops.

**Solution:**

1. Reduce passive `maxAttempts` from 20 → **3**.
2. Add a circuit breaker: if 3 consecutive passive jobs fail with
   `spend_budget` or rate-limit errors, pause passive job creation for 5
   minutes.

```typescript
// Before creating a passive job, check circuit breaker
const recentFailures = await ctx.db
  .query("agentJobs")
  .withIndex("by_status_nextRunAt", q => q.eq("status", "failed"))
  .take(10);
const passiveFailures = recentFailures.filter(
  j => j.mode === "research" &&
       (j.error?.includes("spend_budget") || j.error?.includes("rate_limit"))
);
if (passiveFailures.length >= 3) {
  return { ok: false, error: "circuit_open" };
}
```

**Why:** The backpressure article: "If a particular tool or external API starts
failing or responding slowly, stop calling it. A circuit breaker tracks the
error rate over a rolling window."

### Change 5: Raise Classification Threshold + Hysteresis

**Problem:** `classifyNoteworthy` fires at score ≥ 0.35, creating jobs for
marginal entity mentions.

**Solution:**

1. Raise threshold from 0.35 → **0.60** for auto-job-creation.
2. Below 0.60 but above 0.35: record the finding in the outbox row but **do not
   create a job** — surface as a dismissable chip only.
3. Hysteresis: require the entity to appear in **2 separate content commits**
   before creating a research job. This prevents one-off mentions from
   triggering research.

**Why:** The ambient AI article: "A confidence threshold below which the agent
acts but does not interrupt. It can take a note, update internal state, or queue
for batch review — but it should not surface low-confidence observations as
real-time interruptions." The Code Worm article: "Fix with hysteresis, minimum
dwell time, and merging bursts into windows."

### Change 6: Move Live Operations to a Separate Table

**Problem:** `recordLiveOperation` and `recordStreamEvent` patch the same
`agentJobs` document, causing 7,345+ OCC failures.

**Solution:** Write live operation events to a new `agentJobLiveEvents` table
instead of patching `agentJobs`. The job's counters (`modelCallCount`,
`toolCallCount`, etc.) get updated once at slice finish, not on every event.

```typescript
// Before (OCC-prone):
await ctx.db.patch(jobId, {
  modelCallCount: (job.modelCallCount ?? 0) + 1,
  updatedAt: now,
});

// After (no conflict):
await ctx.db.insert("agentJobLiveEvents", {
  jobId,
  kind: "model_call",
  sequence: liveSequence++,
  ts: now,
});
// Counters reconciled at slice finish in a single patch
```

**Why:** The ambient intelligence article: "Partition by place: shard inference
by building/floor/zone to keep state local and reduce cross-talk." The OCC
conflicts are fundamentally a hot-document problem — splitting writes across
rows eliminates the contention.

## Implementation Order

1. **Change 4** (bounded retries + circuit breaker) — immediate relief, ~20 LOC
2. **Change 3** (backpressure gate) — prevents future saturation, ~15 LOC
3. **Change 1** (separate workpool) — structural fix, requires new component
4. **Change 6** (separate live events table) — eliminates OCC storms
5. **Change 5** (threshold + hysteresis) — reduces noise at the source
6. **Change 2** (priority queue with aging) — fairness guarantee

## Inspirational References

| Reference | Key Insight Applied |
|---|---|
| [Ambient AI Architecture](https://tianpan.co/blog/2026-04-17-ambient-ai-architecture-always-on-agents) | "Filtering is the product" — process far more signal than surfaced; confidence gates below which agent acts but doesn't interrupt |
| [Backpressure in Agent Pipelines](https://tianpan.co/blog/2026-04-12-backpressure-in-agent-pipelines-when-ai-generates-work-faster-than-it-can-execute) | Bounded work queues, budget-aware planning, circuit breakers, load shedding with priority queues |
| [Capacity Management in Agent Networks](https://dev.to/agentensemble/capacity-management-in-agent-networks-rate-limiting-priority-queues-and-backpressure-33ce) | Priority queues with aging to prevent starvation; three layers: reactive, priority, proactive |
| [Ambient Intelligence That Doesn't Break in Production](https://www.codeworm.dev/2026/02/ambient-intelligence-that-doesnt-break.html) | Hysteresis, minimum dwell time, merging bursts; partition to reduce cross-talk; progressive rollout |
| [GitHub Copilot Agent Architecture](https://markaicode.com/architecture/github-copilot-agent-architecture/) | Separate async job queue for non-interactive work; prioritize user-triggered over periodic reindexes |
| [Cursor Architecture](https://julien-riel.com/en/case-studies/cursor/) | Async Indexer as separate background service; Merkle tree change detection to skip unchanged files |
| [Notion Vector Search at Scale](https://www.engineering.fyi/article/two-years-of-vector-search-at-notion-10x-scale-1-10th-cost) | Dual-path indexing (batch + real-time); hash-based change detection to avoid reprocessing |
| [Linear Similar Issues](https://linear.app/now/using-ai-to-detect-similar-issues) | Push detection to the edge; vector embeddings for semantic similarity; progressive surfacing |
| [Anthropic Building Effective Agents](https://resources.anthropic.com/hubfs/Building%20Effective%20AI%20Agents-%20Architecture%20Patterns%20and%20Implementation%20Frameworks.pdf) | Start simple, scale intelligently; guard against repeated/invalid tool calls with iteration limits |
