import type {
  SpreadsheetBenchRunnerReport,
  SpreadsheetBenchRunnerTaskResult,
} from "./spreadsheetBenchRunner";

export type SpreadsheetBenchReportProjection = SpreadsheetBenchRunnerReport & {
  projection: {
    schema: 1;
    sourceReport: string;
    sourceSha256: string;
    requestedTaskCount: number;
    projectedTaskCount: number;
    policy: "exact_task_id_subset_no_additional_model_calls";
  };
};

export function projectSpreadsheetBenchRunnerReport(args: {
  source: SpreadsheetBenchRunnerReport;
  taskIds: string[];
  sourceReport: string;
  sourceSha256: string;
  stageRoot: string;
  generatedAt?: string;
}): SpreadsheetBenchReportProjection {
  const requested = [...new Set(args.taskIds)];
  if (requested.length !== args.taskIds.length) throw new Error("projection task ids must be unique");
  const wanted = new Set(requested);
  const available = new Set(args.source.results.map((result) => result.taskId));
  const missing = requested.filter((taskId) => !available.has(taskId));
  if (missing.length) {
    throw new Error(`source report is missing ${missing.length} projected task(s): ${missing.slice(0, 12).join(", ")}`);
  }

  const results = args.source.results.filter((result) => wanted.has(result.taskId));
  const caseRuns = args.source.caseRuns.filter((run) => wanted.has(run.taskId));
  const projectedIds = new Set(results.map((result) => result.taskId));
  if (projectedIds.size !== requested.length) {
    throw new Error(`projection produced ${projectedIds.size}/${requested.length} unique task ids`);
  }
  const passCount = results.filter((result) => result.score?.pass).length;
  const casePassCount = caseRuns.filter((run) => run.pass).length;
  const usage = aggregateUsage(results);
  const latencies = results.map((result) => result.timingsMs.total).sort((a, b) => a - b);
  const failureCounts: Record<string, number> = {};
  for (const result of results) {
    if (!result.error) continue;
    failureCounts[result.error.phase] = (failureCounts[result.error.phase] ?? 0) + 1;
  }
  const warnings = results.flatMap((result) => result.error ? [`${result.taskId}: ${result.error.message}`] : []);

  return {
    ...args.source,
    generatedAt: args.generatedAt ?? args.source.generatedAt,
    stageRoot: args.stageRoot,
    taskOffset: 0,
    taskCount: results.length,
    passCount,
    averageOverall: results.length
      ? Number((results.reduce((sum, result) => sum + (result.score?.scores.overall ?? 0), 0) / results.length).toFixed(6))
      : 0,
    caseCount: requested.length,
    caseRunCount: caseRuns.length,
    casePassCount,
    casePassRate: caseRuns.length ? Number((casePassCount / caseRuns.length).toFixed(6)) : 0,
    attemptCount: results.length,
    passRate: results.length ? Number((passCount / results.length).toFixed(6)) : 0,
    retryStats: {
      retriedCaseRunCount: caseRuns.filter((run) => run.attempts.length > 1).length,
      retryAttemptCount: caseRuns.reduce((sum, run) => sum + Math.max(0, run.attempts.length - 1), 0),
      passedAfterRetryCount: caseRuns.filter((run) => run.pass && run.attempts.length > 1).length,
      exhaustedCaseRunCount: caseRuns.filter((run) => run.stopReason === "retry_exhausted").length,
    },
    stats: {
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p95: percentile(latencies, 0.95),
        max: latencies.at(-1) ?? 0,
      },
      failureCounts,
    },
    harness: {
      ...args.source.harness,
      budget: usage,
    },
    warnings,
    caseRuns,
    results,
    projection: {
      schema: 1,
      sourceReport: args.sourceReport,
      sourceSha256: args.sourceSha256,
      requestedTaskCount: requested.length,
      projectedTaskCount: projectedIds.size,
      policy: "exact_task_id_subset_no_additional_model_calls",
    },
  };
}

function aggregateUsage(results: SpreadsheetBenchRunnerTaskResult[]) {
  return {
    modelCalls: results.reduce((sum, result) => sum + (result.model?.calls ?? 0), 0),
    inputTokens: results.reduce((sum, result) => sum + (result.model?.usage.inputTokens ?? 0), 0),
    outputTokens: results.reduce((sum, result) => sum + (result.model?.usage.outputTokens ?? 0), 0),
    providerCostUsd: Number(results.reduce((sum, result) => sum + (result.model?.costUsd ?? 0), 0).toFixed(8)),
  };
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * quantile) - 1));
  return values[index];
}
