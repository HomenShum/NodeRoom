import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

async function requireJournalLease(ctx: any, jobId: any, leaseId?: string) {
  const job = await ctx.db.get(jobId);
  if (!job) throw new Error("job_not_found");
  const terminal = job.status === "completed"
    || job.status === "failed"
    || job.status === "blocked"
    || job.status === "cancelled";
  if (terminal) throw new Error("job_terminal");
  if (job.leaseId) {
    if (!leaseId || job.leaseId !== leaseId || !job.leaseUntil || job.leaseUntil <= Date.now()) {
      throw new Error("job_lease_invalid");
    }
  } else if (leaseId) {
    throw new Error("job_lease_invalid");
  }
  return job;
}

export const get = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    leaseId: v.optional(v.string()),
    sliceKey: v.string(),
    step: v.number(),
  },
  handler: async (ctx, { jobId, leaseId, sliceKey, step }) => {
    await requireJournalLease(ctx, jobId, leaseId);
    const row = await ctx.db
      .query("agentModelStepJournal")
      .withIndex("by_job_slice_step", (q) => q.eq("jobId", jobId).eq("sliceKey", sliceKey).eq("step", step))
      .order("asc")
      .first();
    return row?.result;
  },
});

export const record = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    leaseId: v.optional(v.string()),
    sliceKey: v.string(),
    step: v.number(),
    model: v.string(),
    inputHash: v.string(),
    outputHash: v.string(),
    result: v.any(),
  },
  handler: async (ctx, a) => {
    await requireJournalLease(ctx, a.jobId, a.leaseId);
    const existing = await ctx.db
      .query("agentModelStepJournal")
      .withIndex("by_job_slice_step", (q) => q.eq("jobId", a.jobId).eq("sliceKey", a.sliceKey).eq("step", a.step))
      .order("asc")
      .first();
    if (existing) {
      if (
        existing.model !== a.model
        || existing.inputHash !== a.inputHash
        || existing.outputHash !== a.outputHash
      ) throw new Error("journal_replay_mismatch");
      return { id: existing._id, reused: true as const };
    }
    const now = Date.now();
    const id = await ctx.db.insert("agentModelStepJournal", {
      jobId: a.jobId,
      leaseId: a.leaseId,
      sliceKey: a.sliceKey,
      step: a.step,
      model: a.model,
      inputHash: a.inputHash,
      outputHash: a.outputHash,
      result: a.result,
      createdAt: now,
      updatedAt: now,
    });
    return { id, reused: false as const };
  },
});
