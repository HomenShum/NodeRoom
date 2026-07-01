import { classifyLoopFailure } from "./failureTaxonomy";
import type { LoopAttempt, LoopPolicy } from "./types";

export type LoopEvaluation = {
  passed: boolean;
  score: number;
  failureCategories: string[];
  stopReason: string;
};

export function evaluateLoopAttempt(attempt: LoopAttempt, policy: LoopPolicy): LoopEvaluation {
  const failureCategories = new Set(attempt.failureCategories);
  if (attempt.costUsd > policy.maxCostUsd) failureCategories.add("cost_budget");
  if (attempt.latencyMs > policy.maxTimeMs) failureCategories.add("latency");
  for (const loop of attempt.loopsUsed) {
    if (policy.forbiddenLoops.includes(loop)) failureCategories.add(classifyLoopFailure(`forbidden loop ${loop}`));
  }
  const evidenceRequired = policy.verifier.some((verifier) => /evidence|live_user|visual|export/.test(verifier));
  if (evidenceRequired && attempt.evidenceRefs.length === 0) failureCategories.add("context_pack");
  const score = Math.max(0, Math.min(1, attempt.score));
  const passed = attempt.passed && failureCategories.size === 0 && score >= 0.75;
  return {
    passed,
    score,
    failureCategories: [...failureCategories].sort(),
    stopReason: passed ? "verifier_passed" : "repair_or_escalate",
  };
}

