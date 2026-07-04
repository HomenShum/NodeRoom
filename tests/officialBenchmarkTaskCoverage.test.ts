import { describe, expect, it } from "vitest";
import { buildOfficialBenchmarkTaskCoverageReport } from "../src/eval/officialBenchmarkTaskCoverage";

describe("official benchmark task coverage ledger", () => {
  it("keeps full official coverage separate from subset and fixture evidence", () => {
    const report = buildOfficialBenchmarkTaskCoverageReport({ generatedAt: "test" });
    const tracks = Object.fromEntries(report.tracks.map((track) => [track.id, track]));

    expect(report.summary.strictFullCoverageReady).toBe(false);
    expect(tracks["spreadsheetbench-v1-full-912"]).toMatchObject({
      officialExpectedTasks: 912,
      stagedTasks: 912,
      deterministicRunTasks: 912,
      modelRunCases: 0,
      status: "partial",
    });
    expect(tracks["spreadsheetbench-v1-verified-400"]).toMatchObject({
      officialExpectedTasks: 400,
      stagedTasks: 400,
      deterministicRunTasks: 400,
      modelRunCases: 3,
      status: "partial",
    });
    expect(tracks["spreadsheetbench-v2-full-321"]).toMatchObject({
      officialExpectedTasks: 321,
      stagedTasks: 321,
      status: "partial",
    });
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
});
