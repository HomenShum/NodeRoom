import { v } from "convex/values";

export const proofloopRewardV = v.object({
  taskCompletion: v.number(),
  evidenceGrounding: v.number(),
  artifactCorrectness: v.number(),
  visualClarity: v.number(),
  humanAcceptance: v.number(),
  costEfficiency: v.number(),
  latencyEfficiency: v.number(),
  safety: v.number(),
  total: v.number(),
});

export const loopRewardV = v.object({
  rewardId: v.string(),
  attemptId: v.string(),
  traceId: v.string(),
  taskKind: v.string(),
  modelRoute: v.array(v.string()),
  reward: proofloopRewardV,
  failureCategories: v.array(v.string()),
  receiptRefs: v.array(v.string()),
  createdAt: v.number(),
});

export const loopRewardIndexes = ["by_attempt", "by_trace", "by_task_kind", "by_created_at"] as const;

