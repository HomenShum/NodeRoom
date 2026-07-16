/** Agent-run telemetry — recorded by the runRoomAgent action, read by the UI / CLI. */
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";
import { findReusableRun } from "../src/nodeagent/core/idempotency";
import { convexPriceRun } from "../src/nodeagent/models/convexModel";
import { agentTraceStepV, recordAgentStepChain } from "./agentStepChain";

const costKindV = v.union(v.literal("exact"), v.literal("estimated"));
const journalClaimV = v.object({
  step: v.number(),
  outputHash: v.string(),
  state: v.union(v.literal("confirmed"), v.literal("pending")),
});

type CostKind = "exact" | "estimated";
type ModelAccounting = {
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  costUsd: number;
  costKind: CostKind;
};
type JobAccounting = ModelAccounting & { toolCalls: number };

const zeroModelAccounting = (): ModelAccounting => ({
  modelCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  costUsd: 0,
  costKind: "exact",
});

function nonNegative(value: unknown, label: string, fallback = 0): number {
  const resolved = value === undefined ? fallback : value;
  if (typeof resolved !== "number" || !Number.isFinite(resolved) || resolved < 0) {
    throw new Error(`agent_run_invalid_${label}`);
  }
  return resolved;
}

function addModelAccounting(target: ModelAccounting, source: ModelAccounting): ModelAccounting {
  target.modelCalls += source.modelCalls;
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
  target.costUsd += source.costUsd;
  if (source.costKind === "estimated") target.costKind = "estimated";
  return target;
}

function journalRowAccounting(row: any): ModelAccounting {
  const usage = row?.result?.usage as Record<string, unknown> | undefined;
  const inputTokens = nonNegative(usage?.inputTokens, "journal_input_tokens");
  const outputTokens = nonNegative(usage?.outputTokens, "journal_output_tokens");
  const cachedInputTokens = nonNegative(usage?.cachedInputTokens, "journal_cached_input_tokens");
  const cacheCreationInputTokens = nonNegative(usage?.cacheCreationInputTokens, "journal_cache_creation_input_tokens");
  const explicitCost = usage?.costUsd;
  const costUsd = explicitCost === undefined
    ? convexPriceRun(String(row.model), inputTokens, outputTokens)
    : nonNegative(explicitCost, "journal_cost");
  return {
    modelCalls: nonNegative(usage?.modelCalls, "journal_model_calls", 1),
    inputTokens,
    outputTokens,
    cachedInputTokens,
    cacheCreationInputTokens,
    costUsd,
    costKind: explicitCost !== undefined && usage?.costKind === "exact" ? "exact" : "estimated",
  };
}

function subtractJournalUsage(total: ModelAccounting, journal: ModelAccounting): ModelAccounting {
  const subtract = (field: keyof Omit<ModelAccounting, "costKind">, epsilon = 0) => {
    const remainder = total[field] - journal[field];
    if (remainder < -epsilon) throw new Error(`agent_run_journal_usage_mismatch:${field}`);
    return Math.max(0, remainder);
  };
  return {
    modelCalls: subtract("modelCalls"),
    inputTokens: subtract("inputTokens"),
    outputTokens: subtract("outputTokens"),
    cachedInputTokens: subtract("cachedInputTokens"),
    cacheCreationInputTokens: subtract("cacheCreationInputTokens"),
    costUsd: subtract("costUsd", 1e-9),
    costKind: total.costKind,
  };
}

function hasModelAccounting(value: ModelAccounting): boolean {
  return value.modelCalls > 0
    || value.inputTokens > 0
    || value.outputTokens > 0
    || value.cachedInputTokens > 0
    || value.cacheCreationInputTokens > 0
    || value.costUsd > 0;
}

function runRowAccounting(row: any): JobAccounting {
  const inputTokens = nonNegative(row.inputTokens, "row_input_tokens");
  const outputTokens = nonNegative(row.outputTokens, "row_output_tokens");
  const costUsd = nonNegative(row.costUsd, "row_cost");
  return {
    modelCalls: nonNegative(row.modelCalls, "row_model_calls", inputTokens || outputTokens || costUsd ? 1 : 0),
    toolCalls: nonNegative(row.toolCalls, "row_tool_calls"),
    inputTokens,
    outputTokens,
    cachedInputTokens: nonNegative(row.cachedInputTokens, "row_cached_input_tokens"),
    cacheCreationInputTokens: nonNegative(row.cacheCreationInputTokens, "row_cache_creation_input_tokens"),
    costUsd,
    costKind: row.costKind === "exact" ? "exact" : "estimated",
  };
}

const MAX_JOB_ACCOUNTING_RUNS = 100;

async function loadJobRunAccounting(ctx: any, jobId: any): Promise<JobAccounting> {
  const rows = await ctx.db.query("agentRuns")
    .withIndex("by_job", (q: any) => q.eq("jobId", jobId))
    .order("asc")
    .take(MAX_JOB_ACCOUNTING_RUNS + 1);
  if (rows.length > MAX_JOB_ACCOUNTING_RUNS) throw new Error("agent_job_run_accounting_overflow");
  const total: JobAccounting = { ...zeroModelAccounting(), toolCalls: 0 };
  for (const row of rows) {
    const accounting = runRowAccounting(row);
    addModelAccounting(total, accounting);
    total.toolCalls += accounting.toolCalls;
  }
  return total;
}

async function syncJobRunAccounting(ctx: any, jobId: any): Promise<JobAccounting> {
  const total = await loadJobRunAccounting(ctx, jobId);
  const job = await ctx.db.get(jobId);
  if (!job) throw new Error("job_not_found");
  await ctx.db.patch(jobId, {
    modelCallCount: Math.max(job.modelCallCount ?? 0, total.modelCalls),
    toolCallCount: Math.max(job.toolCallCount ?? 0, total.toolCalls),
    inputTokens: Math.max(job.inputTokens ?? 0, total.inputTokens),
    outputTokens: Math.max(job.outputTokens ?? 0, total.outputTokens),
    cachedInputTokens: Math.max(job.cachedInputTokens ?? 0, total.cachedInputTokens),
    cacheCreationInputTokens: Math.max(job.cacheCreationInputTokens ?? 0, total.cacheCreationInputTokens),
    costUsd: Math.max(job.costUsd ?? 0, total.costUsd),
    costKind: job.costKind === "estimated" || total.costKind === "estimated" ? "estimated" : "exact",
  });
  return total;
}

/** Claim a run row up-front (idempotency layer 1): a concurrent duplicate sees this in-flight row
 *  (no stopReason yet) via byKey and bails before racing the same locks/CAS. Finished by `finish`. */
export const claim = internalMutation({
  args: { jobId: v.optional(v.id("agentJobs")), roomId: v.id("rooms"), agentId: v.string(), model: v.string(), goal: v.string(), idempotencyKey: v.optional(v.string()) },
  handler: (ctx, a) => ctx.db.insert("agentRuns", {
    ...a, steps: 0, toolCalls: 0, conflictsSurvived: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, ms: 0, exhausted: false, createdAt: Date.now(),
  } as any),
});

/** ATOMIC claim-or-reuse (race-safe): in ONE serializable mutation, reuse an existing in-flight/recent
 *  run with this key, else insert a fresh claimed row. Closes the TOCTOU window a separate query+insert
 *  would have — two truly-simultaneous submits serialize, so the 2nd sees the 1st's row and reuses it. */
export const claimOrReuse = internalMutation({
  args: { jobId: v.optional(v.id("agentJobs")), roomId: v.id("rooms"), agentId: v.string(), model: v.string(), goal: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, a) => {
    const prior = await ctx.db.query("agentRuns").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", a.idempotencyKey)).order("desc").take(5);
    const reuse = findReusableRun(prior.map((r) => ({ runId: String(r._id), idempotencyKey: r.idempotencyKey, stopReason: r.stopReason, finishedAt: r.createdAt })), a.idempotencyKey, { now: Date.now() });
    if (reuse) {
      const row = prior.find((r) => String(r._id) === reuse.runId)!;
      return { runId: row._id, reused: true as const, row };
    }
    const runId = await ctx.db.insert("agentRuns", {
      jobId: a.jobId, roomId: a.roomId, agentId: a.agentId, model: a.model, goal: a.goal, idempotencyKey: a.idempotencyKey,
      steps: 0, toolCalls: 0, conflictsSurvived: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, ms: 0, exhausted: false, createdAt: Date.now(),
    } as any);
    return { runId, reused: false as const, row: null };
  },
});

/** Patch the claimed row with final telemetry (success or failure). */
export const finish = internalMutation({
  args: {
    runId: v.id("agentRuns"), model: v.string(), steps: v.number(), modelCalls: v.optional(v.number()), toolCalls: v.number(), conflictsSurvived: v.number(),
    inputTokens: v.number(), outputTokens: v.number(), cachedInputTokens: v.optional(v.number()), cacheCreationInputTokens: v.optional(v.number()),
    costUsd: v.number(), costKind: v.optional(costKindV), ms: v.number(), exhausted: v.boolean(),
    stopReason: v.optional(v.string()), remainingMs: v.optional(v.number()), deadlineAt: v.optional(v.number()), handoff: v.optional(v.any()),
  },
  handler: async (ctx, { runId, ...patch }) => {
    const doc: Record<string, unknown> = { ...patch, costKind: patch.costKind ?? "estimated" };
    for (const key of ["modelCalls", "cachedInputTokens", "cacheCreationInputTokens", "remainingMs", "deadlineAt", "handoff"]) {
      if (doc[key] === undefined) delete doc[key];
    }
    await ctx.db.patch(runId, doc as any);
    return runId;
  },
});

/** Recent runs with this idempotency key (for the dedup guard). */
export const byKey = internalQuery({
  args: { idempotencyKey: v.string() },
  handler: (ctx, { idempotencyKey }) =>
    ctx.db.query("agentRuns").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey)).order("desc").take(5),
});

export const record = internalMutation({
  args: {
    jobId: v.optional(v.id("agentJobs")),
    idempotencyKey: v.optional(v.string()),
    roomId: v.id("rooms"), agentId: v.string(), model: v.string(), goal: v.string(),
    steps: v.number(), modelCalls: v.optional(v.number()), toolCalls: v.number(), conflictsSurvived: v.number(),
    inputTokens: v.number(), outputTokens: v.number(), cachedInputTokens: v.optional(v.number()), cacheCreationInputTokens: v.optional(v.number()),
    costUsd: v.number(), costKind: v.optional(costKindV), ms: v.number(), exhausted: v.boolean(),
    stopReason: v.optional(v.string()), remainingMs: v.optional(v.number()), deadlineAt: v.optional(v.number()), handoff: v.optional(v.any()),
  },
  handler: (ctx, a) => {
    const doc: Record<string, unknown> = { ...a, costKind: a.costKind ?? "estimated", createdAt: Date.now() };
    for (const key of ["modelCalls", "cachedInputTokens", "cacheCreationInputTokens", "stopReason", "remainingMs", "deadlineAt", "handoff"]) {
      if (doc[key] === undefined) delete doc[key];
    }
    return ctx.db.insert("agentRuns", doc as any);
  },
});

/**
 * Persist a durable-job run while claiming each journaled model response exactly once.
 * Replayed journal rows are removed from this run's accounting, while provider failures
 * that never reached the journal remain as a per-invocation residual. The claim, run row,
 * and cumulative job totals are one serializable transaction.
 */
export const recordJournaled = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    leaseId: v.string(),
    attempt: v.number(),
    recordKey: v.string(),
    journalSliceKey: v.string(),
    journalClaims: v.array(journalClaimV),
    traceSteps: v.array(agentTraceStepV),
    roomId: v.id("rooms"), agentId: v.string(), model: v.string(), goal: v.string(),
    steps: v.number(), modelCalls: v.number(), toolCalls: v.number(), conflictsSurvived: v.number(),
    inputTokens: v.number(), outputTokens: v.number(), cachedInputTokens: v.number(), cacheCreationInputTokens: v.number(),
    costUsd: v.number(), costKind: costKindV, ms: v.number(), exhausted: v.boolean(),
    stopReason: v.optional(v.string()), remainingMs: v.optional(v.number()), deadlineAt: v.optional(v.number()), handoff: v.optional(v.any()),
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job) throw new Error("agent_run_job_not_found");
    if (String(job.roomId) !== String(a.roomId)) throw new Error("agent_run_room_mismatch");
    if (job.attempts !== a.attempt) throw new Error("agent_run_attempt_mismatch");
    if (
      job.status !== "running"
      || job.leaseId !== a.leaseId
      || !job.leaseUntil
      || job.leaseUntil <= Date.now()
    ) {
      throw new Error("agent_run_lease_invalid");
    }
    if (a.traceSteps.length === 0) throw new Error("agent_run_trace_empty");

    const existing = await ctx.db.query("agentRuns")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", a.recordKey))
      .order("desc")
      .first();
    if (existing) {
      if (String(existing.jobId ?? "") !== String(a.jobId) || String(existing.roomId) !== String(a.roomId)) {
        throw new Error("agent_run_record_key_collision");
      }
      await recordAgentStepChain(ctx, {
        jobId: a.jobId,
        runId: existing._id,
        roomId: a.roomId,
        agentId: a.agentId,
        steps: a.traceSteps,
      });
      return {
        runId: existing._id,
        reused: true as const,
        accounting: runRowAccounting(existing),
        jobAccounting: await syncJobRunAccounting(ctx, a.jobId),
      };
    }

    const seenSteps = new Set<number>();
    const journalRows: any[] = [];
    for (const claim of a.journalClaims) {
      if (seenSteps.has(claim.step)) throw new Error("agent_run_duplicate_journal_claim");
      seenSteps.add(claim.step);
      const row = await ctx.db.query("agentModelStepJournal")
        .withIndex("by_job_slice_step", (q) => q.eq("jobId", a.jobId).eq("sliceKey", a.journalSliceKey).eq("step", claim.step))
        .order("asc")
        .first();
      if (!row || row.outputHash !== claim.outputHash) {
        if (claim.state === "confirmed") throw new Error("agent_run_journal_claim_mismatch");
        // A pending claim means journal.record may have failed before commit. Its provider usage
        // remains in the aggregate and is accounted below as an unjournaled residual.
        continue;
      }
      journalRows.push(row);
    }

    const total: ModelAccounting = {
      modelCalls: nonNegative(a.modelCalls, "total_model_calls"),
      inputTokens: nonNegative(a.inputTokens, "total_input_tokens"),
      outputTokens: nonNegative(a.outputTokens, "total_output_tokens"),
      cachedInputTokens: nonNegative(a.cachedInputTokens, "total_cached_input_tokens"),
      cacheCreationInputTokens: nonNegative(a.cacheCreationInputTokens, "total_cache_creation_input_tokens"),
      costUsd: nonNegative(a.costUsd, "total_cost"),
      costKind: a.costKind,
    };
    const allJournalAccounting = zeroModelAccounting();
    const newlyClaimedAccounting = zeroModelAccounting();
    const rowsToClaim: any[] = [];
    for (const row of journalRows) {
      const accounting = journalRowAccounting(row);
      addModelAccounting(allJournalAccounting, accounting);
      if (!row.accountedRunId) {
        addModelAccounting(newlyClaimedAccounting, accounting);
        rowsToClaim.push(row);
      }
    }
    const residual = subtractJournalUsage(total, allJournalAccounting);
    const accounting = addModelAccounting(zeroModelAccounting(), newlyClaimedAccounting);
    if (hasModelAccounting(residual)) addModelAccounting(accounting, residual);

    const doc = {
      jobId: a.jobId,
      roomId: a.roomId,
      agentId: a.agentId,
      model: a.model,
      goal: a.goal,
      steps: a.steps,
      traceRecordCount: a.traceSteps.length,
      modelCalls: accounting.modelCalls,
      toolCalls: a.toolCalls,
      conflictsSurvived: a.conflictsSurvived,
      inputTokens: accounting.inputTokens,
      outputTokens: accounting.outputTokens,
      cachedInputTokens: accounting.cachedInputTokens,
      cacheCreationInputTokens: accounting.cacheCreationInputTokens,
      costUsd: accounting.costUsd,
      costKind: accounting.costKind,
      ms: a.ms,
      exhausted: a.exhausted,
      stopReason: a.stopReason,
      remainingMs: a.remainingMs,
      deadlineAt: a.deadlineAt,
      handoff: a.handoff,
      idempotencyKey: a.recordKey,
      createdAt: Date.now(),
    };
    const runId = await ctx.db.insert("agentRuns", doc as any);
    await recordAgentStepChain(ctx, {
      jobId: a.jobId,
      runId,
      roomId: a.roomId,
      agentId: a.agentId,
      steps: a.traceSteps,
    });
    const accountingClaimedAt = Date.now();
    for (const row of rowsToClaim) {
      await ctx.db.patch(row._id, { accountedRunId: runId, accountingClaimedAt });
    }
    return {
      runId,
      reused: false as const,
      accounting: { ...accounting, toolCalls: a.toolCalls },
      jobAccounting: await syncJobRunAccounting(ctx, a.jobId),
    };
  },
});

/** Production gate: a room's total agent spend (USD) since `since`. Bounded read — the by_room index
 *  is [roomId, createdAt], so a rolling-day window scans only that room's recent runs. The cross-run
 *  cumulative cap that the per-run/per-slice ceilings cannot provide (one run is bounded; the SUM
 *  across many /ask runs on a public surface is what this bounds). */
const MAX_ROOM_SPEND_ROWS = 2000;
export const roomSpendSince = internalQuery({
  args: { roomId: v.id("rooms"), since: v.number() },
  handler: async (ctx, { roomId, since }) => {
    const rows = await ctx.db.query("agentRuns")
      .withIndex("by_room", (q) => q.eq("roomId", roomId).gte("createdAt", since))
      .order("desc")
      .take(MAX_ROOM_SPEND_ROWS);
    // FAIL-CLOSED + BOUND: a day-window with more runs than the cap row-count is an unambiguous
    // runaway — trip the daily cap instead of silently undercounting via an unbounded .collect()
    // (HONEST_STATUS). The previous .collect() could grow without ceiling and fail OPEN.
    if (rows.length === MAX_ROOM_SPEND_ROWS) return Number.MAX_SAFE_INTEGER;
    return rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0);
  },
});

/** Experiment gate: total agent spend across ALL rooms since `since`, with distinct-room attribution
 *  so a cap breach is diagnosable as growth (many rooms) vs runaway (one room). Bounded read: takes at
 *  most MAX_GLOBAL_SPEND_ROWS newest-first; if the window holds more rows than that, `truncated:true`
 *  is returned and the caller must FAIL CLOSED (treat as breached) — an undercounted sum silently
 *  waving runs through would defeat the cap (HONEST_STATUS). 5000 runs/month at even free-route scale
 *  means the experiment phase is over anyway. */
const MAX_GLOBAL_SPEND_ROWS = 5000;
export const globalSpendSince = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const rows = await ctx.db.query("agentRuns")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
      .order("desc")
      .take(MAX_GLOBAL_SPEND_ROWS);
    const distinct = new Set(rows.map((r) => String(r.roomId)));
    return {
      totalUsd: rows.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
      runCount: rows.length,
      distinctRooms: distinct.size,
      truncated: rows.length === MAX_GLOBAL_SPEND_ROWS,
    };
  },
});

export const list = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.query("agentRuns").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(20);
  },
});
