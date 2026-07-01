import type { LoopAttempt, ProofloopReward } from "./types";

export type LoopMemoryRecord = {
  schema: 1;
  kind: "success_pattern" | "failure_pattern";
  attemptId: string;
  traceId: string;
  taskKind: string;
  mode: string;
  modelRoute: string[];
  costUsd: number;
  latencyMs: number;
  reward: ProofloopReward;
  failureCategories: string[];
  strategyDelta: string;
  receiptRefs: string[];
};

export function buildLoopMemoryRecord(attempt: LoopAttempt, reward: ProofloopReward, strategyDelta: string): LoopMemoryRecord {
  return {
    schema: 1,
    kind: attempt.passed ? "success_pattern" : "failure_pattern",
    attemptId: attempt.attemptId,
    traceId: attempt.traceId,
    taskKind: attempt.taskKind,
    mode: attempt.mode,
    modelRoute: attempt.modelRoute,
    costUsd: attempt.costUsd,
    latencyMs: attempt.latencyMs,
    reward,
    failureCategories: attempt.failureCategories,
    strategyDelta,
    receiptRefs: [...attempt.outputRefs, ...attempt.evidenceRefs, ...attempt.visualRefs],
  };
}

export function serializeLoopMemoryRecord(record: LoopMemoryRecord): string {
  return `${JSON.stringify(record)}\n`;
}

