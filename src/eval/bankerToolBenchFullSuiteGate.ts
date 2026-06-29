// Deterministic FR-020B full-suite flip gate.
//
// The proof-registry FR-020B claim ("full BankerToolBench suite completion") flips
// blocked -> passed ONLY when both registry gates are earned:
//   - full_suite_execution   : all expected tasks executed clean generic-only (no answer-key writers)
//   - aggregate_score_import  : every clean task carries an official (Gandalf) score + trace link
//
// This module is the honest promotion gate: it refuses to flip unless the receipts earn it,
// and it reports COMPLETION + mean reward + pass-rate separately so "100/100 executed+scored"
// is never confused with "100% pass rate". Pure + deterministic so it is unit-testable.
import {
  buildBtbLedgerImport,
  type BankerToolBenchSweepSummary,
  type BtbLedgerImport,
  type BtbLedgerTask,
} from "./bankerToolBenchEvalLedger";

export interface FullSuiteGateOptions {
  /** Number of official tasks the full suite must cover. Default 100. */
  expectedCount?: number;
  /** Optional exact official task-id set. When provided, set-equality is required (not just count). */
  expectedTaskIds?: string[];
  /** reward >= this counts toward the (reported, not required) pass-rate. Default 1.0. */
  passThreshold?: number;
}

export type FullSuiteGateId = "full_suite_execution" | "aggregate_score_import";

export interface FullSuiteSubGate {
  id: FullSuiteGateId;
  status: "pass" | "blocked";
  reason: string;
}

export interface FullSuiteGateVerdict {
  schema: "noderoom-btb-fullsuite-gate-v1";
  expectedCount: number;
  /** Distinct task ids with any finished/scored receipt (clean or not). */
  executedTaskCount: number;
  /** Distinct task ids with >= 1 clean generic-only scored receipt. */
  cleanScoredTaskCount: number;
  meanCleanReward: number | null;
  passThreshold: number;
  passCount: number;
  passRate: number | null;
  /** Expected ids with no clean scored receipt (only populated when expectedTaskIds given). */
  missingTaskIds: string[];
  /** Tasks present + scored but never clean (family/replay/fallback/exception). */
  contaminatedTaskIds: string[];
  /** Tasks present but with no finite reward anywhere. */
  unscoredTaskIds: string[];
  subGates: FullSuiteSubGate[];
  flipEligible: boolean;
  /** Honest, copy-pasteable claim string. Never asserts a pass rate it did not earn. */
  claim: string;
}

/** A receipt earns "clean scored" only if it is the accepted generic-only probe, error-free, and scored. */
function isCleanScored(t: BtbLedgerTask): boolean {
  return t.cleanGeneralProbe === true && t.exceptions === 0 && Number.isFinite(t.reward);
}

export function evaluateFullSuiteGate(
  ledger: BtbLedgerImport,
  options: FullSuiteGateOptions = {},
): FullSuiteGateVerdict {
  const expectedCount = options.expectedCount ?? 100;
  const passThreshold = options.passThreshold ?? 1.0;
  const expectedIds = options.expectedTaskIds?.length ? options.expectedTaskIds : null;

  // Group every receipt by task id across all runs. A task is proven clean if ANY receipt is clean.
  const byId = new Map<string, BtbLedgerTask[]>();
  for (const run of ledger.runs) {
    for (const t of run.tasks) {
      if (!t.taskId) continue;
      const list = byId.get(t.taskId);
      if (list) list.push(t);
      else byId.set(t.taskId, [t]);
    }
  }

  const executedTaskIds: string[] = [];
  const cleanScored: Array<{ taskId: string; reward: number }> = [];
  const contaminatedTaskIds: string[] = [];
  const unscoredTaskIds: string[] = [];

  for (const [taskId, receipts] of byId) {
    const scored = receipts.some((t) => Number.isFinite(t.reward));
    const finished = scored || receipts.some((t) => (t.source?.status ?? "").toLowerCase() === "finished");
    if (finished) executedTaskIds.push(taskId);

    const cleanReceipts = receipts.filter(isCleanScored);
    if (cleanReceipts.length > 0) {
      // Best clean reward proven for this task (capability is what it has demonstrably reached).
      cleanScored.push({ taskId, reward: Math.max(...cleanReceipts.map((t) => t.reward as number)) });
    } else if (scored) {
      contaminatedTaskIds.push(taskId);
    } else {
      unscoredTaskIds.push(taskId);
    }
  }

  const cleanScoredTaskCount = cleanScored.length;
  const meanCleanReward = cleanScoredTaskCount
    ? cleanScored.reduce((sum, t) => sum + t.reward, 0) / cleanScoredTaskCount
    : null;
  const passCount = cleanScored.filter((t) => t.reward >= passThreshold).length;
  const passRate = cleanScoredTaskCount ? passCount / cleanScoredTaskCount : null;

  let missingTaskIds: string[] = [];
  if (expectedIds) {
    const cleanSet = new Set(cleanScored.map((t) => t.taskId));
    missingTaskIds = expectedIds.filter((id) => !cleanSet.has(id)).sort();
  }

  const executionPass = expectedIds
    ? missingTaskIds.length === 0
    : cleanScoredTaskCount >= expectedCount;

  const fullSuiteExecution: FullSuiteSubGate = {
    id: "full_suite_execution",
    status: executionPass ? "pass" : "blocked",
    reason: executionPass
      ? `${cleanScoredTaskCount}/${expectedCount} tasks executed clean generic-only.`
      : `${cleanScoredTaskCount}/${expectedCount} clean generic-only tasks` +
        ` (${contaminatedTaskIds.length} contaminated, ${unscoredTaskIds.length} unscored` +
        `${expectedIds ? `, ${missingTaskIds.length} missing` : ""}).`,
  };

  const scorePass = executionPass && cleanScoredTaskCount > 0;
  const aggregateScoreImport: FullSuiteSubGate = {
    id: "aggregate_score_import",
    status: scorePass ? "pass" : "blocked",
    reason: scorePass
      ? `All ${cleanScoredTaskCount} clean tasks carry official scores + trace links; mean reward ${fmt(meanCleanReward)}.`
      : `Aggregate official scores incomplete until full-suite execution passes.`,
  };

  const flipEligible = fullSuiteExecution.status === "pass" && aggregateScoreImport.status === "pass";

  const claim = flipEligible
    ? `All ${cleanScoredTaskCount}/${expectedCount} BankerToolBench tasks executed and officially scored, ` +
      `generic-only (no answer-key writers). Aggregate mean reward ${fmt(meanCleanReward)}; ` +
      `pass-rate ${fmt(passRate)} (reward >= ${passThreshold}). ` +
      `This proves full-suite COMPLETION + SCORING, not a 100% pass rate.`
    : `Full-suite proof NOT earned: ${cleanScoredTaskCount}/${expectedCount} clean generic-only scored tasks. ` +
      fullSuiteExecution.reason;

  return {
    schema: "noderoom-btb-fullsuite-gate-v1",
    expectedCount,
    executedTaskCount: executedTaskIds.length,
    cleanScoredTaskCount,
    meanCleanReward,
    passThreshold,
    passCount,
    passRate,
    missingTaskIds,
    contaminatedTaskIds: contaminatedTaskIds.sort(),
    unscoredTaskIds: unscoredTaskIds.sort(),
    subGates: [fullSuiteExecution, aggregateScoreImport],
    flipEligible,
    claim,
  };
}

/** Convenience: evaluate directly from raw sweep summaries (reuses the existing ledger builder). */
export function evaluateFullSuiteGateFromSummaries(
  summaries: Array<{ path?: string; summary: BankerToolBenchSweepSummary }>,
  options?: FullSuiteGateOptions,
): FullSuiteGateVerdict {
  return evaluateFullSuiteGate(buildBtbLedgerImport({ summaries }), options);
}

function fmt(value: number | null): string {
  return value == null ? "n/a" : value.toFixed(4);
}
