import { describe, expect, it } from "vitest";
import {
  assertSpreadsheetBenchMergeOutputPaths,
  mergeSpreadsheetBenchRepairReport,
} from "../src/eval/spreadsheetBenchReportRepair";
import type {
  SpreadsheetBenchRunnerCaseRun,
  SpreadsheetBenchRunnerReport,
  SpreadsheetBenchRunnerTaskResult,
} from "../src/eval/spreadsheetBenchRunner";

describe("SpreadsheetBench NodeAgent repair report merge", () => {
  it("replaces only allowlisted tasks and recomputes aggregate proof fields", () => {
    const baseOne = taskResult("Debugging/01_01", "openrouter/free-auto", 0, 0.1);
    const baseTwo = taskResult("Debugging/01_02", "cohere/north-mini-code:free", 2, 0.2);
    const repaired = taskResult("Debugging/01_01", "gemini-3-flash-preview", 3, 0.8);
    const merged = mergeSpreadsheetBenchRepairReport({
      base: report([baseOne, baseTwo], "base-run"),
      repair: report([repaired], "repair-run"),
      replacementTaskIds: ["Debugging/01_01"],
      generatedAt: "2026-07-14T00:00:00.000Z",
      outputRoot: "merged-run",
      baseReportSha256: "a".repeat(64),
      repairReportSha256: "b".repeat(64),
    });

    expect(merged.composed).toBe(true);
    expect(merged.results.map((result) => result.model?.name)).toEqual([
      "gemini-3-flash-preview",
      "cohere/north-mini-code:free",
    ]);
    expect(merged.results[1]).toBe(baseTwo);
    expect(merged.averageOverall).toBe(0.5);
    expect(merged.harness.budget).toEqual({
      modelCalls: 5,
      inputTokens: 50,
      outputTokens: 10,
      providerCostUsd: 0.05,
    });
    expect(merged.repairMerge.replacementTaskIds).toEqual(["Debugging/01_01"]);
  });

  it("rejects a repair report that does not exactly match the replacement allowlist", () => {
    expect(() => mergeSpreadsheetBenchRepairReport({
      base: report([taskResult("Debugging/01_01", "openrouter/free-auto", 0, 0.1)], "base-run"),
      repair: report([taskResult("Debugging/01_02", "gemini-3-flash-preview", 1, 0.8)], "repair-run"),
      replacementTaskIds: ["Debugging/01_01"],
      generatedAt: "2026-07-14T00:00:00.000Z",
      outputRoot: "merged-run",
      baseReportSha256: "a".repeat(64),
      repairReportSha256: "b".repeat(64),
    })).toThrow(/exactly match/);
  });

  it("rejects replacement results with no authentic model call", () => {
    const taskId = "Debugging/01_01";
    expect(() => mergeSpreadsheetBenchRepairReport({
      base: report([taskResult(taskId, "openrouter/free-auto", 0, 0.1)], "base-run"),
      repair: report([taskResult(taskId, "openrouter/free-auto", 0, 0.8)], "repair-run"),
      replacementTaskIds: [taskId],
      generatedAt: "2026-07-14T00:00:00.000Z",
      outputRoot: "merged-run",
      baseReportSha256: "a".repeat(64),
      repairReportSha256: "b".repeat(64),
    })).toThrow(/no authentic model call/);
  });

  it("rejects malformed NodeAgent sidecar evidence before claiming authentic calls", () => {
    const taskId = "Debugging/01_01";
    const repaired = taskResult(taskId, "gemini-3-flash-preview", 1, 0.8);
    repaired.sidecarEvidence!.nodeAgentReceipt = {} as never;
    expect(() => mergeSpreadsheetBenchRepairReport({
      base: report([taskResult(taskId, "openrouter/free-auto", 0, 0.1)], "base-run"),
      repair: report([repaired], "repair-run"),
      replacementTaskIds: [taskId],
      generatedAt: "2026-07-14T00:00:00.000Z",
      outputRoot: "merged-run",
      baseReportSha256: "a".repeat(64),
      repairReportSha256: "b".repeat(64),
    })).toThrow(/missing NodeAgent receipt evidence/);
  });

  it("rejects repair execution-policy drift that a merged base policy would conceal", () => {
    const taskId = "Debugging/01_01";
    const base = report([taskResult(taskId, "openrouter/free-auto", 0, 0.1)], "base-run");
    const repair = report([taskResult(taskId, "gemini-3-flash-preview", 1, 0.8)], "repair-run");
    repair.harness.modelContextPolicy!.snapshotMaxCells = 1_200;
    expect(() => mergeSpreadsheetBenchRepairReport({
      base,
      repair,
      replacementTaskIds: [taskId],
      generatedAt: "2026-07-14T00:00:00.000Z",
      outputRoot: "merged-run",
      baseReportSha256: "a".repeat(64),
      repairReportSha256: "b".repeat(64),
    })).toThrow(/model-context policies differ/);

    const retryDrift = report([taskResult(taskId, "gemini-3-flash-preview", 1, 0.8)], "repair-run");
    retryDrift.retryPolicy.maxRetries = 1;
    expect(() => mergeSpreadsheetBenchRepairReport({
      base,
      repair: retryDrift,
      replacementTaskIds: [taskId],
      generatedAt: "2026-07-14T00:00:00.000Z",
      outputRoot: "merged-run",
      baseReportSha256: "a".repeat(64),
      repairReportSha256: "b".repeat(64),
    })).toThrow(/retry policies differ/);
  });

  it("rejects output aliases against receipts, reports, and verified artifacts", () => {
    expect(() => assertSpreadsheetBenchMergeOutputPaths({
      reportOutput: "proof/merged.json",
      receiptOutput: "proof/merged.json",
      protectedPaths: [],
    })).toThrow(/must be distinct/);
    expect(() => assertSpreadsheetBenchMergeOutputPaths({
      reportOutput: "proof/merged.json",
      receiptOutput: "proof/receipt.json",
      protectedPaths: ["proof/merged.json"],
    })).toThrow(/aliases an input or verified artifact/);
  });
});

function taskResult(taskId: string, modelName: string, calls: number, overall: number): SpreadsheetBenchRunnerTaskResult {
  const artifact = taskId.replaceAll("/", "_");
  return {
    taskId,
    track: "spreadsheetbench-v2",
    category: "Debugging",
    mode: "nodeagent-workbook",
    attemptIndex: 1,
    repeatIndex: 1,
    tryIndex: 1,
    taskDir: `tasks/${artifact}`,
    agentManifest: `tasks/${artifact}/agent/task.json`,
    evaluatorManifest: `tasks/${artifact}/evaluator/task.json`,
    candidateWorkbook: `${artifact}/candidate.xlsx`,
    sidecarEvidence: {
      candidateManifest: evidence(`${artifact}/candidate-manifest.json`),
      nodeAgentReceipt: evidence(`${artifact}/nodeagent-workbook-receipt.json`),
      nodeAgentTrace: evidence(`${artifact}/nodeagent-workbook-trace.json`),
    },
    scorerReceipt: evidence(`${artifact}/scorer-receipt.json`),
    score: { pass: overall === 1, scores: { overall } } as SpreadsheetBenchRunnerTaskResult["score"],
    model: {
      name: modelName,
      calls,
      usage: { inputTokens: calls * 10, outputTokens: calls * 2, cachedInputTokens: 0 },
      costUsd: calls * 0.01,
    },
    timingsMs: { candidateGeneration: 10, scoring: 5, total: 15 },
    trajectory: [],
  };
}

function report(results: SpreadsheetBenchRunnerTaskResult[], outputRoot: string): SpreadsheetBenchRunnerReport {
  const caseRuns: SpreadsheetBenchRunnerCaseRun[] = results.map((result) => ({
    taskId: result.taskId,
    taskDir: result.taskDir,
    repeatIndex: 1,
    attempts: [1],
    finalAttemptIndex: 1,
    pass: result.score?.pass ?? false,
    stopReason: result.score?.pass ? "passed" : "failed_score",
    bestOverall: result.score?.scores.overall ?? 0,
  }));
  return {
    schema: 1,
    generatedAt: "2026-07-14T00:00:00.000Z",
    stageRoot: "staged-v2-full",
    outputRoot,
    mode: "nodeagent-workbook",
    taskCount: results.length,
    passCount: results.filter((result) => result.score?.pass).length,
    averageOverall: 0,
    caseCount: caseRuns.length,
    caseRunCount: caseRuns.length,
    casePassCount: 0,
    casePassRate: 0,
    repeatCount: 1,
    attemptCount: results.length,
    passRate: 0,
    retryPolicy: { maxRetries: 0, retryOn: ["candidate_generation", "scoring"], stopOnPass: true },
    retryStats: {
      retriedCaseRunCount: 0,
      retryAttemptCount: 0,
      passedAfterRetryCount: 0,
      exhaustedCaseRunCount: 0,
    },
    stats: { latencyMs: { p50: 0, p95: 0, max: 0 }, failureCounts: {} },
    harness: {
      toolPolicy: "agent_dir_only_until_candidate",
      evaluatorAccess: "after_candidate_emit_only",
      modelContextPolicy: {
        batchSize: 1,
        snapshotMaxCells: 6000,
        snapshotMaxCellChars: null,
        instructionMaxChars: null,
        repairAttempts: 2,
        selectedTaskCount: results.length,
      },
      budget: { modelCalls: 0, inputTokens: 0, outputTokens: 0, providerCostUsd: 0 },
    },
    warnings: [],
    caseRuns,
    results,
  };
}

function evidence(path: string) {
  return { path, sha256: "c".repeat(64), bytes: 1 };
}
