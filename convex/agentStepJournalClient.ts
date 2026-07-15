import { makeFunctionReference } from "convex/server";
import type { Id } from "./_generated/dataModel";
import type { AgentStep } from "../src/nodeagent/core/types";
import type { StepJournal } from "../src/nodeagent/core/journal";
import { stableJournalHash } from "../src/nodeagent/core/journal";

const agentStepJournalGetRef = makeFunctionReference<"mutation">("agentStepJournal:get") as any;
const agentStepJournalRecordRef = makeFunctionReference<"mutation">("agentStepJournal:record") as any;

export type ConvexStepJournal = StepJournal & {
  accountingClaims(): Array<{ step: number; outputHash: string; state: "confirmed" | "pending" }>;
};

export function makeConvexStepJournal(args: {
  ctx: {
    runMutation: (ref: any, args: Record<string, unknown>) => Promise<unknown>;
  };
  jobId: Id<"agentJobs">;
  leaseId?: string;
  sliceKey: string;
  inputHash?: string;
  modelName: () => string;
}): ConvexStepJournal {
  const inputHash = args.inputHash ?? args.sliceKey;
  const accounted = new Map<number, { outputHash: string; state: "confirmed" | "pending" }>();
  const remember = (step: number, result: AgentStep, state: "confirmed" | "pending") => {
    accounted.set(step, {
      outputHash: stableJournalHash(result),
      state,
    });
  };
  return {
    async get(step: number) {
      const result = await args.ctx.runMutation(agentStepJournalGetRef, {
        jobId: args.jobId,
        leaseId: args.leaseId,
        sliceKey: args.sliceKey,
        step,
      }) as AgentStep | undefined;
      if (result) remember(step, result, "confirmed");
      return result;
    },
    async record(step: number, result: AgentStep) {
      // The mutation may commit and then lose its response. Track the uncertain claim before
      // awaiting so run accounting can reconcile a matching durable row without double charging.
      remember(step, result, "pending");
      await args.ctx.runMutation(agentStepJournalRecordRef, {
        jobId: args.jobId,
        leaseId: args.leaseId,
        sliceKey: args.sliceKey,
        step,
        model: args.modelName(),
        inputHash,
        outputHash: stableJournalHash(result),
        result,
      });
      remember(step, result, "confirmed");
    },
    accountingClaims() {
      return [...accounted.entries()]
        .sort(([left], [right]) => left - right)
        .map(([step, value]) => ({ step, outputHash: value.outputHash, state: value.state }));
    },
  };
}
