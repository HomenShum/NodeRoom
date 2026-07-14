import { describe, expect, it } from "vitest";
import type { SpreadsheetBenchRunnerReport } from "../src/eval/spreadsheetBenchRunner";
import { projectSpreadsheetBenchRunnerReport } from "../src/eval/spreadsheetBenchReportProjection";

describe("SpreadsheetBench model report projection", () => {
  it("projects exact task ids and recomputes attempts, usage, and failure aggregates", () => {
    const source = reportFixture();
    const projected = projectSpreadsheetBenchRunnerReport({
      source,
      taskIds: ["task-b"],
      sourceReport: "docs/eval/full.json",
      sourceSha256: "a".repeat(64),
      stageRoot: "staged-verified",
      generatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(projected).toMatchObject({
      stageRoot: "staged-verified",
      taskCount: 2,
      caseCount: 1,
      attemptCount: 2,
      passCount: 1,
      casePassCount: 1,
      retryStats: { retriedCaseRunCount: 1, retryAttemptCount: 1, passedAfterRetryCount: 1 },
      harness: { budget: { modelCalls: 2, inputTokens: 14, outputTokens: 5, providerCostUsd: 0 } },
      projection: {
        sourceReport: "docs/eval/full.json",
        sourceSha256: "a".repeat(64),
        requestedTaskCount: 1,
        projectedTaskCount: 1,
        policy: "exact_task_id_subset_no_additional_model_calls",
      },
    });
    expect(projected.results.map((result) => result.taskId)).toEqual(["task-b", "task-b"]);
  });

  it("refuses a subset task that is absent from the source report", () => {
    expect(() => projectSpreadsheetBenchRunnerReport({
      source: reportFixture(),
      taskIds: ["missing"],
      sourceReport: "full.json",
      sourceSha256: "b".repeat(64),
      stageRoot: "stage",
    })).toThrow("source report is missing 1 projected task");
  });
});

function reportFixture(): SpreadsheetBenchRunnerReport {
  const result = (taskId: string, attemptIndex: number, pass: boolean) => ({
    taskId,
    track: "spreadsheetbench-v1" as const,
    mode: "model-edit-plan" as const,
    attemptIndex,
    repeatIndex: 1,
    tryIndex: attemptIndex,
    taskDir: `tasks/${taskId}`,
    agentManifest: `tasks/${taskId}/agent/task.json`,
    evaluatorManifest: `tasks/${taskId}/evaluator/evaluator.json`,
    score: { pass, scores: { overall: pass ? 1 : 0 } } as never,
    model: { name: "free-model", calls: 1, usage: { inputTokens: 7, outputTokens: attemptIndex + 1 }, costUsd: 0 },
    timingsMs: { candidateGeneration: 10, scoring: 5, total: 15 * attemptIndex },
    trajectory: [],
  });
  return {
    schema: 1,
    generatedAt: "source",
    stageRoot: "full-stage",
    outputRoot: "full-output",
    mode: "model-edit-plan",
    taskCount: 3,
    passCount: 2,
    averageOverall: 2 / 3,
    caseCount: 2,
    caseRunCount: 2,
    casePassCount: 2,
    casePassRate: 1,
    repeatCount: 1,
    attemptCount: 3,
    passRate: 2 / 3,
    retryPolicy: { maxRetries: 1, retryOn: ["candidate_generation", "scoring"], stopOnPass: true },
    retryStats: { retriedCaseRunCount: 1, retryAttemptCount: 1, passedAfterRetryCount: 1, exhaustedCaseRunCount: 0 },
    stats: { latencyMs: { p50: 15, p95: 30, max: 30 }, failureCounts: {} },
    harness: {
      toolPolicy: "agent_dir_only_until_candidate",
      evaluatorAccess: "after_candidate_emit_only",
      budget: { modelCalls: 3, inputTokens: 21, outputTokens: 8, providerCostUsd: 0 },
    },
    warnings: [],
    caseRuns: [
      { taskId: "task-a", taskDir: "tasks/task-a", repeatIndex: 1, attempts: [1], finalAttemptIndex: 1, pass: true, stopReason: "passed", bestOverall: 1 },
      { taskId: "task-b", taskDir: "tasks/task-b", repeatIndex: 1, attempts: [1, 2], finalAttemptIndex: 2, pass: true, stopReason: "passed", bestOverall: 1 },
    ],
    results: [result("task-a", 1, true), result("task-b", 1, false), result("task-b", 2, true)],
  };
}
