import { randomUUID } from "node:crypto";
import type { LoopAttempt, LoopMode, LoopPattern } from "./types";

export function createLoopAttempt(args: {
  roomId: string;
  jobId: string;
  traceId: string;
  taskKind: string;
  mode: LoopMode;
  loopsUsed: LoopPattern[];
  modelRoute?: string[];
  toolsUsed?: string[];
  costUsd?: number;
  latencyMs?: number;
  outputRefs?: string[];
  evidenceRefs?: string[];
  visualRefs?: string[];
  score?: number;
  passed?: boolean;
  failureCategories?: string[];
  strategyDelta?: string;
}): LoopAttempt {
  return {
    attemptId: `loop-${randomUUID()}`,
    roomId: args.roomId,
    jobId: args.jobId,
    traceId: args.traceId,
    taskKind: args.taskKind,
    mode: args.mode,
    loopsUsed: args.loopsUsed,
    modelRoute: args.modelRoute ?? [],
    toolsUsed: args.toolsUsed ?? [],
    costUsd: args.costUsd ?? 0,
    latencyMs: args.latencyMs ?? 0,
    outputRefs: args.outputRefs ?? [],
    evidenceRefs: args.evidenceRefs ?? [],
    visualRefs: args.visualRefs ?? [],
    score: args.score ?? 0,
    passed: args.passed ?? false,
    failureCategories: args.failureCategories ?? [],
    strategyDelta: args.strategyDelta,
  };
}

export function summarizeAttempt(attempt: LoopAttempt): string {
  return `${attempt.taskKind}:${attempt.mode}:${attempt.passed ? "pass" : "fail"} score=${attempt.score} cost=${attempt.costUsd} trace=${attempt.traceId}`;
}

export function appendAttemptLedger(ledger: LoopAttempt[], attempt: LoopAttempt): LoopAttempt[] {
  return [...ledger, attempt];
}

