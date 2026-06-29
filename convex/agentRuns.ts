/** Agent-run telemetry — recorded by the runRoomAgent action, read by the UI / CLI. */
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";
import { findReusableRun } from "../src/nodeagent/core/idempotency";

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
    runId: v.id("agentRuns"), model: v.string(), steps: v.number(), toolCalls: v.number(), conflictsSurvived: v.number(),
    inputTokens: v.number(), outputTokens: v.number(), cachedInputTokens: v.optional(v.number()), costUsd: v.number(), ms: v.number(), exhausted: v.boolean(),
    stopReason: v.optional(v.string()), remainingMs: v.optional(v.number()), deadlineAt: v.optional(v.number()), handoff: v.optional(v.any()),
  },
  handler: async (ctx, { runId, ...patch }) => {
    const doc: Record<string, unknown> = { ...patch };
    for (const key of ["remainingMs", "deadlineAt", "handoff"]) if (doc[key] === undefined) delete doc[key];
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
    roomId: v.id("rooms"), agentId: v.string(), model: v.string(), goal: v.string(),
    steps: v.number(), toolCalls: v.number(), conflictsSurvived: v.number(),
    inputTokens: v.number(), outputTokens: v.number(), cachedInputTokens: v.optional(v.number()), costUsd: v.number(), ms: v.number(), exhausted: v.boolean(),
    stopReason: v.optional(v.string()), remainingMs: v.optional(v.number()), deadlineAt: v.optional(v.number()), handoff: v.optional(v.any()),
  },
  handler: (ctx, a) => {
    const doc: Record<string, unknown> = { ...a, createdAt: Date.now() };
    for (const key of ["stopReason", "remainingMs", "deadlineAt", "handoff"]) {
      if (doc[key] === undefined) delete doc[key];
    }
    return ctx.db.insert("agentRuns", doc as any);
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
