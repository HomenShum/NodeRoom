import type { LoopMode, LoopPolicy } from "./types";

export const DEFAULT_LOOP_POLICIES: LoopPolicy[] = [
  {
    taskKind: "accounting_reconciliation",
    mode: "benchmark",
    requiredLoops: ["goal_decomposition", "constraint_satisfaction", "score_retry", "progress_evaluation", "memory_update"],
    optionalLoops: ["multi_critic", "workflow_optimization"],
    forbiddenLoops: ["tree_search"],
    maxAttempts: 3,
    maxCostUsd: 5,
    maxTimeMs: 20 * 60_000,
    stopConditions: ["official_or_task_verifier_passed", "budget_cap_reached", "human_review_required"],
    verifier: ["formula_recompute", "export_reopen", "evidence_fact_check", "visual_browser_proof"],
    memoryWrites: ["success_pattern", "failure_pattern", "source_fact"],
    escalation: "human_review",
  },
  {
    taskKind: "profile_research_packet",
    mode: "standard",
    requiredLoops: ["goal_decomposition", "plan_execute_replan", "score_retry", "memory_update"],
    optionalLoops: ["adversarial_critique", "multi_critic", "workflow_optimization"],
    forbiddenLoops: ["tree_search"],
    maxAttempts: 3,
    maxCostUsd: 2.5,
    maxTimeMs: 12 * 60_000,
    stopConditions: ["evidence_backed_packet_ready", "budget_cap_reached", "needs_human_review"],
    verifier: ["evidence_fact_check", "notebook_dossier_check", "spreadsheet_row_check"],
    memoryWrites: ["success_pattern", "failure_pattern", "source_fact"],
    escalation: "human_review",
  },
  {
    taskKind: "live_user_benchmark",
    mode: "benchmark",
    requiredLoops: ["progress_evaluation", "constraint_satisfaction", "score_retry", "judge_ensemble", "workflow_optimization"],
    optionalLoops: ["adversarial_critique", "success_pattern"],
    forbiddenLoops: ["tree_search", "debate"],
    maxAttempts: 2,
    maxCostUsd: 10,
    maxTimeMs: 30 * 60_000,
    stopConditions: ["strict_live_user_contract_passed", "official_score_recorded", "budget_cap_reached"],
    verifier: ["live_user_contract", "visual_browser_proof", "export_reopen", "official_or_task_verifier"],
    memoryWrites: ["success_pattern", "failure_pattern", "route_reward"],
    escalation: "operator",
  },
  {
    taskKind: "generic",
    mode: "quick",
    requiredLoops: ["progress_evaluation"],
    optionalLoops: ["score_retry", "memory_update"],
    forbiddenLoops: ["tree_search", "debate"],
    maxAttempts: 1,
    maxCostUsd: 1,
    maxTimeMs: 3 * 60_000,
    stopConditions: ["task_complete", "budget_cap_reached"],
    verifier: ["task_verifier"],
    memoryWrites: ["failure_pattern"],
    escalation: "none",
  },
];

export function selectLoopPolicy(taskKind: string, mode?: LoopMode): LoopPolicy {
  const exact = DEFAULT_LOOP_POLICIES.find((policy) => policy.taskKind === taskKind && (!mode || policy.mode === mode));
  if (exact) return exact;
  const byTask = DEFAULT_LOOP_POLICIES.find((policy) => policy.taskKind === taskKind);
  return byTask ?? DEFAULT_LOOP_POLICIES[DEFAULT_LOOP_POLICIES.length - 1];
}

export function assertBoundedPolicy(policy: LoopPolicy): string[] {
  const errors: string[] = [];
  if (policy.maxAttempts < 1) errors.push("maxAttempts must be at least 1");
  if (policy.maxAttempts > 5) errors.push("maxAttempts must stay bounded at 5 or fewer");
  if (policy.maxCostUsd <= 0) errors.push("maxCostUsd must be positive");
  if (policy.maxTimeMs <= 0) errors.push("maxTimeMs must be positive");
  const forbidden = new Set(policy.forbiddenLoops);
  for (const loop of policy.requiredLoops) {
    if (forbidden.has(loop)) errors.push(`loop cannot be both required and forbidden: ${loop}`);
  }
  if (!policy.stopConditions.length) errors.push("at least one stop condition is required");
  if (!policy.verifier.length) errors.push("at least one verifier is required");
  return errors;
}

