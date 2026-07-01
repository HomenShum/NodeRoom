import type { LoopAttempt, ProofloopReward } from "./types";

export function buildStrategyDelta(attempt: LoopAttempt, reward: ProofloopReward): string {
  if (attempt.passed && reward.total >= 0.85) return "Keep route; record success pattern and shadow cheaper alternatives.";
  if (reward.evidenceGrounding < 1) return "Capture source-backed evidence before synthesis and mark unsupported facts needs_review.";
  if (reward.costEfficiency < 0.5) return "Route mechanical extraction to a cheaper worker and escalate only after verifier failure.";
  if (reward.latencyEfficiency < 0.5) return "Split the workflow into bounded stages with progress checks.";
  if (reward.visualClarity < 1) return "Add browser-visible proof before finalizing.";
  return "Use the first verifier failure to add a deterministic regression, then rerun.";
}

