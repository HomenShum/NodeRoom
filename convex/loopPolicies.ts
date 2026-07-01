import { v } from "convex/values";
import { loopModeV, loopPatternV } from "./loopAttempts";

export const loopPolicyV = v.object({
  policyId: v.string(),
  taskKind: v.string(),
  mode: loopModeV,
  requiredLoops: v.array(loopPatternV),
  optionalLoops: v.array(loopPatternV),
  forbiddenLoops: v.array(loopPatternV),
  maxAttempts: v.number(),
  maxCostUsd: v.number(),
  maxTimeMs: v.number(),
  stopConditions: v.array(v.string()),
  verifier: v.array(v.string()),
  memoryWrites: v.array(v.string()),
  escalation: v.union(v.literal("none"), v.literal("human_review"), v.literal("strong_model"), v.literal("operator")),
  updatedAt: v.number(),
});

export const loopPolicyIndexes = ["by_task_kind", "by_mode", "by_updated_at"] as const;

export const boundedLoopPolicyDefaults = {
  maxAttemptsCeiling: 5,
  requiresMaxCost: true,
  requiresMaxTime: true,
  requiresVerifier: true,
  requiresStopCondition: true,
} as const;

