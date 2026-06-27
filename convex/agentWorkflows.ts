import { v } from "convex/values";
import { WorkflowManager, getStatus, vWorkflowId } from "@convex-dev/workflow";
import { vResultValidator } from "@convex-dev/workpool";
import { components, internal } from "./_generated/api";
import { internalMutation, query } from "./_generated/server";

const FREE_AUTO_WORKFLOW_MAX_PARALLELISM = 8;
// P0: Passive jobs get a separate workpool with maxParallelism=1 so they
// can never starve user-initiated foreground jobs in the main workpool.
const PASSIVE_WORKFLOW_MAX_PARALLELISM = 1;

export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    maxParallelism: FREE_AUTO_WORKFLOW_MAX_PARALLELISM,
    retryActionsByDefault: false,
    defaultRetryBehavior: {
      maxAttempts: 2,
      initialBackoffMs: 2_000,
      base: 2,
    },
  },
});

export const passiveWorkflow = new WorkflowManager(components.passiveWorkflow, {
  workpoolOptions: {
    maxParallelism: PASSIVE_WORKFLOW_MAX_PARALLELISM,
    retryActionsByDefault: false,
    defaultRetryBehavior: {
      maxAttempts: 1,
      initialBackoffMs: 5_000,
      base: 2,
    },
  },
});

const MAX_WORKFLOW_SLICES = 200;

export const freeAutoWorkflow = workflow.define({
  args: { jobId: v.id("agentJobs") },
  returns: v.null(),
}).handler(async (step, { jobId }): Promise<null> => {
  // One workflow invocation owns one long-running slice. Continuation is started
  // from `recordWorkflowComplete`, otherwise the workflow handler itself can hit
  // Convex's 600s cap after a valid near-ceiling slice.
  const slice = Math.min(0, MAX_WORKFLOW_SLICES - 1);
  const before = await step.runMutation(internal.agentJobs.workflowState, { jobId }, { name: `free-auto-state-before-${slice}` });
  if (before.terminal) return null;
  const delayMs = Math.max(0, (before.nextRunAt ?? before.now) - before.now);
  if (delayMs > 0) await step.sleep(delayMs, { name: `free-auto-delay-${slice}` });
  await step.runAction(internal.agentJobRunner.runFreeAutoJobSlice, { jobId }, { name: `free-auto-slice-${slice + 1}`, retry: false });
  return null;
});

// P0: Passive jobs use a separate workflow + workpool (maxParallelism=1).
export const passiveRoomWorkWorkflow = passiveWorkflow.define({
  args: { jobId: v.id("agentJobs") },
  returns: v.null(),
}).handler(async (step, { jobId }): Promise<null> => {
  const slice = Math.min(0, MAX_WORKFLOW_SLICES - 1);
  const before = await step.runMutation(internal.agentJobs.workflowState, { jobId }, { name: `passive-state-before-${slice}` });
  if (before.terminal) return null;
  const delayMs = Math.max(0, (before.nextRunAt ?? before.now) - before.now);
  if (delayMs > 0) await step.sleep(delayMs, { name: `passive-delay-${slice}` });
  await step.runAction(internal.agentJobRunner.runFreeAutoJobSlice, { jobId }, { name: `passive-slice-${slice + 1}`, retry: false });
  return null;
});

export const freeAutoWorkflowComplete = internalMutation({
  args: {
    workflowId: vWorkflowId,
    result: vResultValidator,
    context: v.object({ jobId: v.id("agentJobs") }),
  },
  handler: async (ctx, { workflowId, result, context }) => {
    await ctx.runMutation(internal.agentJobs.recordWorkflowComplete, {
      jobId: context.jobId,
      workflowId,
      resultKind: result.kind,
      error: result.kind === "failed" ? result.error : undefined,
    });
  },
});

export const status = query({
  args: { workflowId: v.string() },
  handler: async (ctx, { workflowId }) => getStatus(ctx, components.workflow, workflowId as never),
});
