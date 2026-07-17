import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";

export const agentTraceStepV = v.object({
  idx: v.number(),
  tool: v.string(),
  args: v.string(),
  result: v.string(),
  status: v.union(v.literal("ok"), v.literal("conflict"), v.literal("locked"), v.literal("error")),
  ms: v.number(),
  elementId: v.optional(v.string()),
  affectedObjectIds: v.optional(v.array(v.string())),
  mutationReceiptIds: v.optional(v.array(v.id("agentMutationReceipts"))),
});

export type AgentTraceStepInput = {
  idx: number;
  tool: string;
  args: string;
  result: string;
  status: "ok" | "conflict" | "locked" | "error";
  ms: number;
  elementId?: string;
  affectedObjectIds?: string[];
  mutationReceiptIds?: Id<"agentMutationReceipts">[];
};

type ChainIdentity = {
  jobId?: Id<"agentJobs">;
  runId: Id<"agentRuns">;
  roomId: Id<"rooms">;
  agentId: string;
};

type StoredAgentTraceStepInput = AgentTraceStepInput & ChainIdentity;

async function sha256hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonical(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = value[key];
    return result;
  }, {}));
}

function chainCore(identity: ChainIdentity, step: AgentTraceStepInput, prevStepHash: string): Record<string, unknown> {
  return {
    jobId: identity.jobId ? String(identity.jobId) : "",
    runId: String(identity.runId),
    roomId: String(identity.roomId),
    agentId: identity.agentId,
    idx: step.idx,
    tool: step.tool,
    args: step.args,
    result: step.result,
    status: step.status,
    ms: step.ms,
    elementId: step.elementId ?? "",
    affectedObjectIds: step.affectedObjectIds ?? [],
    mutationReceiptIds: (step.mutationReceiptIds ?? []).map(String),
    prevStepHash,
  };
}

export async function recordAgentStepChain(
  ctx: MutationCtx,
  args: ChainIdentity & { steps: AgentTraceStepInput[] },
): Promise<{ reused: boolean; inserted: number }> {
  if (args.steps.length === 0) throw new Error("agent_step_chain_empty");
  const run = await ctx.db.get(args.runId);
  if (!run) throw new Error("agent_run_not_found");
  if (String(run.jobId ?? "") !== String(args.jobId ?? "")
    || String(run.roomId) !== String(args.roomId)
    || run.agentId !== args.agentId) {
    throw new Error("agent_step_chain_identity_mismatch");
  }
  if (run.traceRecordCount !== undefined && run.traceRecordCount !== args.steps.length) {
    throw new Error("agent_step_chain_count_mismatch");
  }

  const ts = Date.now();
  let prevStepHash = `genesis:${args.runId}`;
  const prepared = [] as Array<AgentTraceStepInput & ChainIdentity & { ts: number; recordHash: string; prevStepHash: string }>;
  for (const step of args.steps) {
    const recordHash = await sha256hex(canonical(chainCore(args, step, prevStepHash)));
    prepared.push({
      jobId: args.jobId,
      runId: args.runId,
      roomId: args.roomId,
      agentId: args.agentId,
      ...step,
      ts,
      recordHash,
      prevStepHash,
    });
    prevStepHash = recordHash;
  }

  const existing = await ctx.db.query("agentSteps")
    .withIndex("by_run", (query) => query.eq("runId", args.runId))
    .order("asc")
    .collect();
  if (existing.length > 0) {
    const same = existing.length === prepared.length && existing.every((row, index) => {
      const expected = prepared[index];
      return row.recordHash === expected.recordHash && row.prevStepHash === expected.prevStepHash;
    });
    if (!same) throw new Error("agent_steps_replay_mismatch");
    if (run.traceRecordCount === undefined) await ctx.db.patch(args.runId, { traceRecordCount: prepared.length });
    return { reused: true, inserted: 0 };
  }

  for (const row of prepared) {
    await ctx.db.insert("agentSteps", {
      jobId: row.jobId,
      runId: row.runId,
      roomId: row.roomId,
      agentId: row.agentId,
      idx: row.idx,
      tool: row.tool,
      args: row.args,
      result: row.result,
      status: row.status,
      ms: row.ms,
      elementId: row.elementId,
      affectedObjectIds: row.affectedObjectIds,
      mutationReceiptIds: row.mutationReceiptIds,
      ts: row.ts,
      recordHash: row.recordHash,
      prevStepHash: row.prevStepHash,
    });
  }
  if (run.traceRecordCount === undefined) await ctx.db.patch(args.runId, { traceRecordCount: prepared.length });
  return { reused: false, inserted: prepared.length };
}

export async function verifyAgentStepChain(args: {
  jobId?: Id<"agentJobs">;
  runId: Id<"agentRuns">;
  roomId: Id<"rooms">;
  agentId: string;
  expectedCount?: number;
  rows: StoredAgentTraceStepInput[];
  hashes: Array<{ recordHash: string; prevStepHash: string }>;
}): Promise<{ valid: true; steps: number } | { valid: false; brokenAt?: number; steps?: number; reason: string }> {
  if (args.expectedCount === undefined) return { valid: false, steps: args.rows.length, reason: "trace_count_unavailable" };
  if (args.expectedCount === 0) return { valid: false, steps: args.rows.length, reason: "trace_empty" };
  if (args.rows.length !== args.expectedCount || args.hashes.length !== args.expectedCount) {
    return { valid: false, steps: args.rows.length, reason: "trace_count_mismatch" };
  }
  let prevStepHash = `genesis:${args.runId}`;
  for (let index = 0; index < args.rows.length; index += 1) {
    const row = args.rows[index];
    const stored = args.hashes[index];
    if (String(row.jobId ?? "") !== String(args.jobId ?? "")
      || String(row.runId) !== String(args.runId)
      || String(row.roomId) !== String(args.roomId)
      || row.agentId !== args.agentId) {
      return { valid: false, brokenAt: row.idx, reason: "trace_identity_mismatch" };
    }
    if (stored.prevStepHash !== prevStepHash) return { valid: false, brokenAt: row.idx, reason: "chain link mismatch" };
    const expected = await sha256hex(canonical(chainCore(row, row, prevStepHash)));
    if (expected !== stored.recordHash) return { valid: false, brokenAt: row.idx, reason: "record hash mismatch - tampered" };
    prevStepHash = stored.recordHash;
  }
  return { valid: true, steps: args.rows.length };
}
