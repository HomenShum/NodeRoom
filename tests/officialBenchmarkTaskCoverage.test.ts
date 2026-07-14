import { describe, expect, it } from "vitest";
import { buildOfficialBenchmarkTaskCoverageReport, modelRunReceiptStats } from "../src/eval/officialBenchmarkTaskCoverage";

describe("official benchmark task coverage ledger", () => {
  it("records exact full-suite model coverage separately from subset and fixture evidence", () => {
    const report = buildOfficialBenchmarkTaskCoverageReport({ generatedAt: "test" });
    const tracks = Object.fromEntries(report.tracks.map((track) => [track.id, track]));

    expect(report.summary.strictFullCoverageReady).toBe(true);
    expect(report.summary.totalOfficialExpectedTasks).toBe(1739);
    expect(report.summary.totalStagedTasks).toBe(1739);
    expect(tracks["spreadsheetbench-v1-full-912"]).toMatchObject({
      officialExpectedTasks: 912,
      stagedTasks: 912,
      deterministicRunTasks: 912,
      modelRunCases: 912,
      localProxyOutputReceipts: 912,
      passRate: 0.097588,
      status: "complete",
    });
    expect(tracks["spreadsheetbench-v1-verified-400"]).toMatchObject({
      officialExpectedTasks: 400,
      stagedTasks: 400,
      deterministicRunTasks: 400,
      modelRunCases: 400,
      status: "complete",
    });
    expect(tracks["spreadsheetbench-v2-full-321"]).toMatchObject({
      officialExpectedTasks: 321,
      stagedTasks: 321,
      modelRunCases: 321,
      localProxyOutputReceipts: 321,
      status: "complete",
    });
    expect(report.summary.totalLocalProxyOutputReceipts).toBeGreaterThanOrEqual(1233);
    expect(tracks["bankertoolbench-full-100"]).toMatchObject({
      officialExpectedTasks: 100,
      stagedTasks: 100,
      modelRunCases: 100,
      modelRunAttempts: 100,
      passRate: 0,
      status: "complete",
    });
  });

  it("treats NodeRoom multi-user conflicts as an internal complete suite, not an official substitute", () => {
    const report = buildOfficialBenchmarkTaskCoverageReport({ generatedAt: "test" });
    const multiUser = report.tracks.find((track) => track.id === "noderoom-multi-user-conflict");

    expect(multiUser).toMatchObject({
      benchmark: "NodeRoom",
      status: "complete",
      stagedTasks: 6,
      deterministicRunTasks: 6,
    });
    expect(multiUser?.stagedTasks).toBeGreaterThan(0);
    expect(multiUser?.deterministicRunTasks).toBe(multiUser?.stagedTasks);
    expect(multiUser?.officialExpectedTasks).toBe(multiUser?.stagedTasks);
    expect(report.policy.join(" ")).toContain("complement SpreadsheetBench/BankerToolBench but do not replace them");
  });

  it("counts only unique model runs with generated-plan, candidate, workspace, raw-output, and scorer-attempt receipts", () => {
    const file = { path: "receipt.json", sha256: "a".repeat(64), bytes: 12 };
    const valid = {
      taskId: "task-1",
      mode: "model-edit-plan",
      candidateWorkbook: "task-1/candidate.xlsx",
      model: { calls: 1 },
      scorerReceipt: file,
      sidecarEvidence: {
        candidateManifest: file,
        agentWorkspaceManifest: file,
        editPlan: { ...file, kind: "generated" },
        rawModelOutput: file,
      },
    };
    expect(modelRunReceiptStats({ results: [valid, valid, { ...valid, taskId: "task-2", scorerReceipt: undefined }] })).toEqual({
      cases: 1,
      attempts: 2,
      taskIds: ["task-1"],
    });

    const scoringError = {
      ...valid,
      taskId: "task-2",
      scorerReceipt: undefined,
      error: { phase: "scoring" as const, message: "invalid evaluator range" },
    };
    const candidateError = {
      ...valid,
      taskId: "task-3",
      scorerReceipt: undefined,
      error: { phase: "candidate_generation" as const, message: "invalid model plan" },
    };
    expect(modelRunReceiptStats({ results: [valid, scoringError, candidateError] })).toEqual({
      cases: 2,
      attempts: 2,
      taskIds: ["task-1", "task-2"],
    });
  });
});
