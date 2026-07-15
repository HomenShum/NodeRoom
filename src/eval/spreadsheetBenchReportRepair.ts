import { resolve } from "node:path";
import type {
  SpreadsheetBenchRunnerCaseRun,
  SpreadsheetBenchRunnerReport,
  SpreadsheetBenchRunnerTaskResult,
  SpreadsheetBenchSidecarFileEvidence,
} from "./spreadsheetBenchRunner";

export type SpreadsheetBenchRepairMergedReport = SpreadsheetBenchRunnerReport & {
  composed: true;
  repairMerge: {
    schema: 1;
    baseReportSha256: string;
    repairReportSha256: string;
    replacementTaskIds: string[];
  };
};

export function assertSpreadsheetBenchMergeOutputPaths(args: {
  reportOutput: string;
  receiptOutput: string;
  protectedPaths: string[];
}): void {
  const reportOutput = normalizedAbsolutePath(args.reportOutput);
  const receiptOutput = normalizedAbsolutePath(args.receiptOutput);
  if (reportOutput === receiptOutput) throw new Error("merge report and receipt outputs must be distinct files");
  const protectedPaths = new Set(args.protectedPaths.map(normalizedAbsolutePath));
  if (protectedPaths.has(reportOutput)) throw new Error("merge report output aliases an input or verified artifact");
  if (protectedPaths.has(receiptOutput)) throw new Error("merge receipt output aliases an input or verified artifact");
}

export function mergeSpreadsheetBenchRepairReport(args: {
  base: SpreadsheetBenchRunnerReport;
  repair: SpreadsheetBenchRunnerReport;
  replacementTaskIds: string[];
  generatedAt: string;
  outputRoot: string;
  baseReportSha256: string;
  repairReportSha256: string;
}): SpreadsheetBenchRepairMergedReport {
  assertCompatibleReports(args.base, args.repair);
  const replacementTaskIds = uniqueTaskIds(args.replacementTaskIds, "replacement task IDs");
  const replacementSet = new Set(replacementTaskIds);
  const baseResults = uniqueByTaskId(args.base.results, "base results");
  const repairResults = uniqueByTaskId(args.repair.results, "repair results");
  const baseCaseRuns = uniqueByTaskId(args.base.caseRuns, "base case runs");
  const repairCaseRuns = uniqueByTaskId(args.repair.caseRuns, "repair case runs");

  if (args.base.results.length !== args.base.taskCount || args.base.caseRuns.length !== args.base.taskCount) {
    throw new Error("base report must contain exactly one result and one case run per task");
  }
  if (args.repair.results.length !== replacementTaskIds.length || args.repair.caseRuns.length !== replacementTaskIds.length) {
    throw new Error("repair report must contain exactly one result and one case run per replacement task");
  }
  if (repairResults.size !== replacementSet.size || [...repairResults.keys()].some((taskId) => !replacementSet.has(taskId))) {
    throw new Error("repair report task IDs must exactly match the replacement task IDs");
  }

  for (const taskId of replacementTaskIds) {
    if (!baseResults.has(taskId) || !baseCaseRuns.has(taskId)) {
      throw new Error(`replacement task is absent from the base report: ${taskId}`);
    }
    const result = repairResults.get(taskId);
    const caseRun = repairCaseRuns.get(taskId);
    if (!result || !caseRun) throw new Error(`repair result or case run is missing: ${taskId}`);
    assertAuthenticRepairResult(result);
  }

  const results = args.base.results.map((result) => repairResults.get(result.taskId) ?? result);
  const caseRuns = args.base.caseRuns.map((caseRun) => repairCaseRuns.get(caseRun.taskId) ?? caseRun);
  const passCount = results.filter((result) => result.score?.pass).length;
  const casePassCount = caseRuns.filter((caseRun) => caseRun.pass).length;
  const usage = aggregateUsage(results);
  const { chunked: _chunked, chunkSize: _chunkSize, chunks: _chunks, ...base } = args.base as SpreadsheetBenchRunnerReport & {
    chunked?: boolean;
    chunkSize?: number;
    chunks?: unknown[];
  };

  return {
    ...base,
    generatedAt: args.generatedAt,
    outputRoot: args.outputRoot,
    composed: true,
    taskCount: results.length,
    passCount,
    averageOverall: results.length
      ? Number((results.reduce((sum, result) => sum + (result.score?.scores.overall ?? 0), 0) / results.length).toFixed(6))
      : 0,
    caseCount: caseRuns.length,
    caseRunCount: caseRuns.length,
    casePassCount,
    casePassRate: caseRuns.length ? Number((casePassCount / caseRuns.length).toFixed(6)) : 0,
    attemptCount: results.length,
    passRate: results.length ? Number((passCount / results.length).toFixed(6)) : 0,
    retryStats: aggregateRetryStats(caseRuns),
    stats: aggregateStats(results),
    harness: {
      toolPolicy: "agent_dir_only_until_candidate",
      evaluatorAccess: "after_candidate_emit_only",
      ...(args.base.harness.modelContextPolicy
        ? {
            modelContextPolicy: {
              ...args.base.harness.modelContextPolicy,
              selectedTaskCount: results.length,
            },
          }
        : {}),
      budget: {
        modelCalls: usage.calls,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        providerCostUsd: usage.costUsd,
      },
    },
    warnings: [...new Set([...args.base.warnings, ...args.repair.warnings])],
    caseRuns,
    results,
    repairMerge: {
      schema: 1,
      baseReportSha256: args.baseReportSha256,
      repairReportSha256: args.repairReportSha256,
      replacementTaskIds,
    },
  };
}

function assertCompatibleReports(base: SpreadsheetBenchRunnerReport, repair: SpreadsheetBenchRunnerReport): void {
  if (base.schema !== 1 || repair.schema !== 1) throw new Error("SpreadsheetBench reports must use schema 1");
  if (base.mode !== "nodeagent-workbook" || repair.mode !== "nodeagent-workbook") {
    throw new Error("repair merging requires nodeagent-workbook reports");
  }
  if (base.stageRoot !== repair.stageRoot) throw new Error("base and repair stage roots differ");
  if (base.repeatCount !== 1 || repair.repeatCount !== 1) throw new Error("repair merging requires single-repeat reports");
  if (base.harness.toolPolicy !== "agent_dir_only_until_candidate" || repair.harness.toolPolicy !== base.harness.toolPolicy) {
    throw new Error("base and repair tool policies differ");
  }
  if (base.harness.evaluatorAccess !== "after_candidate_emit_only" || repair.harness.evaluatorAccess !== base.harness.evaluatorAccess) {
    throw new Error("base and repair evaluator-access policies differ");
  }
  if (canonicalJson(base.retryPolicy) !== canonicalJson(repair.retryPolicy)) {
    throw new Error("base and repair retry policies differ");
  }
  if (canonicalJson(contextPolicyWithoutSelection(base.harness.modelContextPolicy))
    !== canonicalJson(contextPolicyWithoutSelection(repair.harness.modelContextPolicy))) {
    throw new Error("base and repair model-context policies differ");
  }
}

function assertAuthenticRepairResult(result: SpreadsheetBenchRunnerTaskResult): void {
  if (result.error) throw new Error(`repair result still has an execution error: ${result.taskId}`);
  if (!result.candidateWorkbook || !isFileEvidence(result.scorerReceipt)) {
    throw new Error(`repair result is missing a candidate or scorer receipt: ${result.taskId}`);
  }
  if (!isFileEvidence(result.sidecarEvidence?.candidateManifest)
    || !isFileEvidence(result.sidecarEvidence?.nodeAgentReceipt)
    || !isFileEvidence(result.sidecarEvidence?.nodeAgentTrace)) {
    throw new Error(`repair result is missing NodeAgent receipt evidence: ${result.taskId}`);
  }
  if (!result.model?.name.trim() || result.model.calls < 1) {
    throw new Error(`repair result has no authentic model call: ${result.taskId}`);
  }
}

function isFileEvidence(value: unknown): value is SpreadsheetBenchSidecarFileEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const evidence = value as Partial<SpreadsheetBenchSidecarFileEvidence>;
  return typeof evidence.path === "string"
    && evidence.path.trim().length > 0
    && typeof evidence.sha256 === "string"
    && /^[a-f0-9]{64}$/i.test(evidence.sha256)
    && Number.isSafeInteger(evidence.bytes)
    && (evidence.bytes ?? -1) >= 0;
}

function contextPolicyWithoutSelection(policy: SpreadsheetBenchRunnerReport["harness"]["modelContextPolicy"]): unknown {
  if (!policy) return null;
  const { selectedTaskCount: _selectedTaskCount, ...contract } = policy;
  return contract;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function normalizedAbsolutePath(path: string): string {
  return resolve(path).replace(/\\/g, "/").toLowerCase();
}

function uniqueTaskIds(values: string[], label: string): string[] {
  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => !value)) throw new Error(`${label} contain an empty task ID`);
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} contain duplicates`);
  return normalized;
}

function uniqueByTaskId<T extends { taskId: string }>(values: T[], label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    if (!value.taskId.trim()) throw new Error(`${label} contain an empty task ID`);
    if (result.has(value.taskId)) throw new Error(`${label} contain duplicate task ID ${value.taskId}`);
    result.set(value.taskId, value);
  }
  return result;
}

function aggregateUsage(results: SpreadsheetBenchRunnerTaskResult[]) {
  return {
    calls: results.reduce((sum, result) => sum + (result.model?.calls ?? 0), 0),
    inputTokens: results.reduce((sum, result) => sum + (result.model?.usage.inputTokens ?? 0), 0),
    outputTokens: results.reduce((sum, result) => sum + (result.model?.usage.outputTokens ?? 0), 0),
    costUsd: Number(results.reduce((sum, result) => sum + (result.model?.costUsd ?? 0), 0).toFixed(8)),
  };
}

function aggregateRetryStats(caseRuns: SpreadsheetBenchRunnerCaseRun[]): SpreadsheetBenchRunnerReport["retryStats"] {
  return {
    retriedCaseRunCount: caseRuns.filter((run) => run.attempts.length > 1).length,
    retryAttemptCount: caseRuns.reduce((sum, run) => sum + Math.max(0, run.attempts.length - 1), 0),
    passedAfterRetryCount: caseRuns.filter((run) => run.pass && run.attempts.length > 1).length,
    exhaustedCaseRunCount: caseRuns.filter((run) => run.stopReason === "retry_exhausted").length,
  };
}

function aggregateStats(results: SpreadsheetBenchRunnerTaskResult[]): SpreadsheetBenchRunnerReport["stats"] {
  const latencies = results.map((result) => result.timingsMs.total).sort((a, b) => a - b);
  const failureCounts: Record<string, number> = {};
  for (const result of results) {
    if (!result.error) continue;
    failureCounts[result.error.phase] = (failureCounts[result.error.phase] ?? 0) + 1;
  }
  return {
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.at(-1) ?? 0,
    },
    failureCounts,
  };
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1);
  return values[index] ?? 0;
}
