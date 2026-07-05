import { describe, expect, it } from "vitest";
import {
  buildProofloopFullProxyBenchmarkSweep,
  renderProofloopFullProxyBenchmarkSweepMarkdown,
} from "../src/eval/proofloopFullProxyBenchmarkSweep";

describe("ProofLoop full proxy benchmark sweep", () => {
  it("keeps full benchmark task counts separate from the three-task adapter smoke sweep", () => {
    const report = buildProofloopFullProxyBenchmarkSweep({ generatedAt: "test" });
    const families = Object.fromEntries(report.families.map((family) => [family.id, family]));

    expect(families["spreadsheetbench-v1-full-912"]).toMatchObject({
      taskTargetCount: 912,
      countedInUniqueProxyTargetTotal: true,
      prodLiveBrowserVerifiedTaskCount: 0,
    });
    expect(families["spreadsheetbench-v1-verified-400"]).toMatchObject({
      taskTargetCount: 400,
      countedInUniqueProxyTargetTotal: false,
    });
    expect(families["spreadsheetbench-v2-full-321"].taskTargetCount).toBe(321);
    expect(families["bankertoolbench-full-100"].taskTargetCount).toBe(100);
    expect(report.summary.uniqueProxyTaskTargets).toBeGreaterThan(1000);
    expect(report.summary.prodLiveBrowserVerifiedTaskTargets).toBeLessThan(report.summary.uniqueProxyTaskTargets);
    expect(report.summary.fullProdLiveBrowserCoverageReady).toBe(false);
  });

  it("selects only the current prod adapter-smoke winner, not a full-suite winner", () => {
    const report = buildProofloopFullProxyBenchmarkSweep({ generatedAt: "test" });

    expect(report.modelRecommendation.modelId).toBe("poolside/laguna-xs-2.1");
    expect(report.modelRecommendation.status).toBe("current_prod_proxy_winner");
    expect(report.modelRecommendation.basis).toContain("not yet proven across SpreadsheetBench/BTB");
  });

  it("renders a user-facing table with the prod coverage denominator", () => {
    const markdown = renderProofloopFullProxyBenchmarkSweepMarkdown(buildProofloopFullProxyBenchmarkSweep({ generatedAt: "test" }));

    expect(markdown).toContain("# ProofLoop Full Proxy Benchmark Sweep");
    expect(markdown).toContain("Unique proxy task targets");
    expect(markdown).toContain("Prod live-browser verified task targets");
    expect(markdown).toContain("spreadsheetbench-v1-full-912");
    expect(markdown).toContain("not a prod noderoom.live model matrix");
  });
});
