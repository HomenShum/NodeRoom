import { describe, expect, it } from "vitest";
import {
  buildProofloopProdProxyBenchmarkMatrix,
  renderProofloopProdProxyBenchmarkMatrixMarkdown,
} from "../src/eval/proofloopProdProxyBenchmarkMatrix";

describe("ProofLoop prod proxy benchmark matrix", () => {
  it("keeps the full task denominator instead of collapsing to the 3-task adapter smoke", () => {
    const report = buildProofloopProdProxyBenchmarkMatrix({ generatedAt: "2026-07-05T00:00:00.000Z" });

    expect(report.summary.uniqueTaskTargets).toBe(1354);
    expect(report.summary.matrixAttemptTargets).toBe(5416);
    expect(report.summary.prodLiveBrowserVerifiedTaskTargets).toBe(3);
    expect(report.summary.runnableProdBrowserTaskTargets).toBe(1344);
    expect(report.summary.blockedTaskTargets).toBe(10);
  });

  it("does not name a full all-task winner from the adapter-only model sweep", () => {
    const report = buildProofloopProdProxyBenchmarkMatrix();

    expect(report.recommendation.currentProdAdapterSmokeWinner).toBe("poolside/laguna-xs-2.1");
    expect(report.recommendation.allTaskWinner).toBeNull();
    expect(report.recommendation.basis).toContain("No all-task model winner is claimed");
  });

  it("marks SpreadsheetBench full bundles as runnable through the generic prod browser workbook adapter", () => {
    const report = buildProofloopProdProxyBenchmarkMatrix();
    const v1 = report.families.find((family) => family.id === "spreadsheetbench-v1-full-912");
    const v2 = report.families.find((family) => family.id === "spreadsheetbench-v2-full-321");

    expect(v1?.taskCount).toBe(912);
    expect(v1?.runnableProdBrowserTasks).toBe(912);
    expect(v1?.blockedTasks).toBe(0);
    expect(v1?.tasks[0]?.runner.command).toBe("npm run proofloop:live:spreadsheetbench-v1");
    expect(v1?.tasks[0]?.blockers[0]).toMatch(/local live-browser only|lacks a passing prod receipt/);
    expect(v2?.taskCount).toBe(321);
    expect(v2?.runnableProdBrowserTasks).toBe(321);
    expect(v2?.blockedTasks).toBe(0);
    expect(v2?.tasks[0]?.runner.command).toBe("npm run proofloop:live:spreadsheetbench-v2");
  });

  it("promotes accounting and Notion configs to real-user prod browser commands without claiming passes", () => {
    const report = buildProofloopProdProxyBenchmarkMatrix();
    const accounting = report.families.find((family) => family.id === "accounting-live-proofloop");
    const notion = report.families.find((family) => family.id === "notion-live-proofloop");

    expect(accounting?.taskCount).toBe(4);
    expect(accounting?.runnableProdBrowserTasks).toBe(4);
    expect(accounting?.tasks[0]?.runner.command).toBe("npm run proofloop:live:accounting:browser");
    expect(accounting?.tasks[0]?.runner.env?.PROOFLOOP_FOCUS_MODE).toBe("0");
    expect(accounting?.tasks[0]?.runner.env?.PROOFLOOP_NODEAGENT_RUNTIME_PROFILE).toBe("");
    expect(notion?.taskCount).toBe(4);
    expect(notion?.runnableProdBrowserTasks).toBe(4);
    expect(notion?.tasks[0]?.runner.command).toBe("npm run proofloop:live:notion:browser");
    expect(notion?.tasks[0]?.prodLiveBrowserPassed).toBe(false);
  });

  it("renders the not-done section and runnable command examples", () => {
    const markdown = renderProofloopProdProxyBenchmarkMatrixMarkdown(buildProofloopProdProxyBenchmarkMatrix());

    expect(markdown).toContain("## Not Done");
    expect(markdown).toContain("spreadsheetbench-v1-full-912: 912 task target(s) still lack prod live-browser proof");
    expect(markdown).toContain("BENCH_BASE_URL=https://noderoom.live");
    expect(markdown).toContain("npm run proofloop:live:spreadsheetbench-v1");
    expect(markdown).toContain("npm run proofloop:live:btb");
  });
});
