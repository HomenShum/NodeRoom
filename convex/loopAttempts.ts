import { v } from "convex/values";

export const loopModeV = v.union(v.literal("quick"), v.literal("standard"), v.literal("deep"), v.literal("benchmark"));

export const loopPatternV = v.union(
  v.literal("generate_critique_rewrite"),
  v.literal("score_retry"),
  v.literal("multi_critic"),
  v.literal("adversarial_critique"),
  v.literal("judge_ensemble"),
  v.literal("reflexion"),
  v.literal("memory_update"),
  v.literal("error_library"),
  v.literal("success_pattern"),
  v.literal("memory_compression"),
  v.literal("plan_execute_replan"),
  v.literal("dynamic_workflow"),
  v.literal("goal_decomposition"),
  v.literal("progress_evaluation"),
  v.literal("constraint_satisfaction"),
  v.literal("branch_explore"),
  v.literal("tree_search"),
  v.literal("debate"),
  v.literal("prompt_optimization"),
  v.literal("workflow_optimization"),
);

export const loopAttemptV = v.object({
  attemptId: v.string(),
  roomId: v.string(),
  jobId: v.string(),
  traceId: v.string(),
  taskKind: v.string(),
  mode: loopModeV,
  loopsUsed: v.array(loopPatternV),
  modelRoute: v.array(v.string()),
  toolsUsed: v.array(v.string()),
  costUsd: v.number(),
  latencyMs: v.number(),
  outputRefs: v.array(v.string()),
  evidenceRefs: v.array(v.string()),
  visualRefs: v.array(v.string()),
  score: v.number(),
  passed: v.boolean(),
  failureCategories: v.array(v.string()),
  strategyDelta: v.optional(v.string()),
  createdAt: v.number(),
});

export const loopAttemptIndexes = ["by_room", "by_job", "by_trace", "by_task_kind", "by_created_at"] as const;

