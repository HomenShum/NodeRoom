import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";

// ---- Honest-lane eval ledger (Solo Founder Agent Builder) ----
// Append-only: each iteration is one immutable `evalRuns` row; its `taskResults` are the (~100) children.
// The eval harness (NodeAgent adapter / sweep) writes via these INTERNAL mutations; the UI reads via the
// paginated public queries so iterations can be flipped like pages while Trace Lens inspects each snapshot.

const taskResultFields = {
  taskId: v.string(),
  family: v.optional(v.string()),
  reward: v.number(),
  raw: v.optional(v.string()),
  exceptions: v.number(),
  // which materializer produced the deliverable: "generic-quartet" | "general_teaser" | "replay:<family>" | ...
  firedWriter: v.string(),
  // generic-only writer fired AND the model was genuinely in the loop
  cleanGeneralProbe: v.boolean(),
  modelCalls: v.number(),
  tokensUsed: v.optional(v.number()),
  plannerTransport: v.optional(v.string()),
  trialId: v.optional(v.string()),
  verdict: v.optional(v.string()),
};

export const startRun = internalMutation({
  args: {
    roomId: v.id("rooms"),
    iterationLabel: v.string(),
    benchmark: v.string(),
    model: v.optional(v.string()),
    materializerMode: v.string(),
    taskCount: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    // Idempotent: one run per (room, iterationLabel).
    const existing = await ctx.db
      .query("evalRuns")
      .withIndex("by_room", (q) => q.eq("roomId", a.roomId))
      .filter((q) => q.eq(q.field("iterationLabel"), a.iterationLabel))
      .first();
    if (existing) return existing._id;
    return ctx.db.insert("evalRuns", {
      roomId: a.roomId,
      iterationLabel: a.iterationLabel,
      benchmark: a.benchmark,
      model: a.model,
      materializerMode: a.materializerMode,
      status: "running",
      taskCount: a.taskCount,
      notes: a.notes,
      startedAt: Date.now(),
    });
  },
});

export const recordTaskResult = internalMutation({
  args: { roomId: v.id("rooms"), evalRunId: v.id("evalRuns"), ...taskResultFields },
  handler: async (ctx, a) => {
    // The honest gate: a row counts toward the headline ONLY if it was a clean generic probe with the
    // model in the loop. Family-writer / model-off rows are recorded but excluded — never headlined.
    const countsTowardHeadline = a.cleanGeneralProbe && a.modelCalls > 0;
    const doc = {
      roomId: a.roomId,
      evalRunId: a.evalRunId,
      taskId: a.taskId,
      family: a.family,
      reward: a.reward,
      raw: a.raw,
      exceptions: a.exceptions,
      firedWriter: a.firedWriter,
      cleanGeneralProbe: a.cleanGeneralProbe,
      modelCalls: a.modelCalls,
      tokensUsed: a.tokensUsed,
      plannerTransport: a.plannerTransport,
      countsTowardHeadline,
      trialId: a.trialId,
      verdict: a.verdict,
      createdAt: Date.now(),
    };
    // Idempotent per (run, task): re-recording a task overwrites its prior row.
    const prior = await ctx.db
      .query("taskResults")
      .withIndex("by_run_task", (q) => q.eq("evalRunId", a.evalRunId).eq("taskId", a.taskId))
      .unique();
    if (prior) {
      await ctx.db.patch(prior._id, doc);
      return prior._id;
    }
    return ctx.db.insert("taskResults", doc);
  },
});

export const finishRun = internalMutation({
  args: {
    evalRunId: v.id("evalRuns"),
    status: v.union(v.literal("completed"), v.literal("failed")),
  },
  handler: async (ctx, a) => {
    // Recompute the honest headline = mean reward over rows that count (clean probe + model in loop).
    // Bounded by run size (~100 BTB tasks); a single run's children only.
    const rows = await ctx.db
      .query("taskResults")
      .withIndex("by_run", (q) => q.eq("evalRunId", a.evalRunId))
      .collect();
    const counted = rows.filter((r) => r.countsTowardHeadline);
    const mean = counted.length
      ? counted.reduce((s, r) => s + r.reward, 0) / counted.length
      : undefined;
    await ctx.db.patch(a.evalRunId, {
      status: a.status,
      completedAt: Date.now(),
      headlineCleanProbeMean: mean,
      headlineN: counted.length,
    });
    return { headlineCleanProbeMean: mean, headlineN: counted.length };
  },
});

// ---- UI reads (paginated; flip iterations like pages) ----

export const listRuns = query({
  args: { roomId: v.id("rooms"), requester: actorProofV, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { roomId, requester, paginationOpts }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db
      .query("evalRuns")
      .withIndex("by_room_started", (q) => q.eq("roomId", roomId))
      .order("desc")
      .paginate(paginationOpts);
  },
});

export const runDetail = query({
  args: { evalRunId: v.id("evalRuns"), requester: actorProofV },
  handler: async (ctx, { evalRunId, requester }) => {
    const run = await ctx.db.get(evalRunId);
    if (!run) return null;
    await requireActorProof(ctx, run.roomId, requester);
    return run;
  },
});

export const taskResultsForRun = query({
  args: { evalRunId: v.id("evalRuns"), requester: actorProofV, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { evalRunId, requester, paginationOpts }) => {
    const run = await ctx.db.get(evalRunId);
    if (!run) throw new Error("eval run not found");
    await requireActorProof(ctx, run.roomId, requester);
    // Room-scope in the query (by_room_run), not just via the upstream run lookup — defense in depth.
    return ctx.db
      .query("taskResults")
      .withIndex("by_room_run", (q) => q.eq("roomId", run.roomId).eq("evalRunId", evalRunId))
      .order("asc")
      .paginate(paginationOpts);
  },
});

// Cascade-delete an iteration and all its task results (admin/agent only).
export const deleteRun = internalMutation({
  args: { evalRunId: v.id("evalRuns") },
  handler: async (ctx, { evalRunId }) => {
    const run = await ctx.db.get(evalRunId);
    if (!run) return { deleted: 0 };
    const rows = await ctx.db
      .query("taskResults")
      .withIndex("by_run", (q) => q.eq("evalRunId", evalRunId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    await ctx.db.delete(evalRunId);
    return { deleted: rows.length + 1 };
  },
});
