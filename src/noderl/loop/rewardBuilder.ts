import type { LoopAttempt, ProofloopReward } from "./types";

export function buildProofloopReward(args: {
  attempt: LoopAttempt;
  artifactCorrectness?: number;
  humanAcceptance?: number;
  safety?: number;
  maxCostUsd: number;
  latencyTargetMs: number;
}): ProofloopReward {
  const taskCompletion = args.attempt.passed ? 1 : clamp01(args.attempt.score);
  const evidenceGrounding = args.attempt.evidenceRefs.length > 0 ? 1 : 0;
  const artifactCorrectness = args.artifactCorrectness ?? (args.attempt.outputRefs.length > 0 ? taskCompletion : 0);
  const visualClarity = args.attempt.visualRefs.length > 0 ? 1 : 0;
  const humanAcceptance = args.humanAcceptance ?? taskCompletion;
  const costEfficiency = clamp01(1 - args.attempt.costUsd / Math.max(args.maxCostUsd, 0.01));
  const latencyEfficiency = clamp01(1 - args.attempt.latencyMs / Math.max(args.latencyTargetMs, 1));
  const safety = args.safety ?? (args.attempt.failureCategories.some((category) => /safety|private|leak/i.test(category)) ? 0 : 1);
  const parts = [taskCompletion, evidenceGrounding, artifactCorrectness, visualClarity, humanAcceptance, costEfficiency, latencyEfficiency, safety];
  return {
    taskCompletion: round3(taskCompletion),
    evidenceGrounding: round3(evidenceGrounding),
    artifactCorrectness: round3(artifactCorrectness),
    visualClarity: round3(visualClarity),
    humanAcceptance: round3(humanAcceptance),
    costEfficiency: round3(costEfficiency),
    latencyEfficiency: round3(latencyEfficiency),
    safety: round3(safety),
    total: round3(parts.reduce((sum, value) => sum + value, 0) / parts.length),
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

