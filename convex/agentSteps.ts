/**
 * Append-only, tamper-evident NodeAgent tool trace.
 * Durable-job callers persist this chain atomically with their run accounting.
 */
import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";
import { agentTraceStepV, recordAgentStepChain, verifyAgentStepChain } from "./agentStepChain";

export const record = internalMutation({
  args: {
    jobId: v.optional(v.id("agentJobs")),
    runId: v.id("agentRuns"),
    roomId: v.id("rooms"),
    agentId: v.string(),
    steps: v.array(agentTraceStepV),
  },
  handler: (ctx, args) => recordAgentStepChain(ctx, args),
});

export const byRun = query({
  args: { runId: v.id("agentRuns"), requester: actorProofV },
  handler: async (ctx, { runId, requester }) => {
    const run = await ctx.db.get(runId);
    if (!run) return [];
    await requireActorProof(ctx, run.roomId, requester);
    return ctx.db.query("agentSteps").withIndex("by_run", (q) => q.eq("runId", runId)).collect();
  },
});

export const byElement = query({
  args: { roomId: v.id("rooms"), elementId: v.string(), requester: actorProofV },
  handler: async (ctx, { roomId, elementId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.query("agentSteps")
      .withIndex("by_room_element", (q) => q.eq("roomId", roomId).eq("elementId", elementId))
      .order("desc")
      .collect();
  },
});

export const verify = query({
  args: { runId: v.id("agentRuns"), requester: actorProofV },
  handler: async (ctx, { runId, requester }) => {
    const run = await ctx.db.get(runId);
    if (!run) return { valid: false as const, steps: 0, reason: "run_not_found" };
    await requireActorProof(ctx, run.roomId, requester);
    const steps = await ctx.db.query("agentSteps")
      .withIndex("by_run", (q) => q.eq("runId", runId))
      .order("asc")
      .collect();
    return verifyAgentStepChain({
      jobId: run.jobId,
      runId,
      roomId: run.roomId,
      agentId: run.agentId,
      expectedCount: run.traceRecordCount,
      rows: steps,
      hashes: steps,
    });
  },
});
