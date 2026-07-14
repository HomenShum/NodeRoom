import { describe, expect, it } from "vitest";
import {
  buildProofloopBenchmarkNormalizationReport,
  renderProofloopBenchmarkNormalizationMarkdown,
} from "../src/eval/proofloopBenchmarkNormalization";

describe("Proof Loop benchmark normalization", () => {
  it("declares a common NodeRoom product shape and reflects accepted official scores", () => {
    const report = buildProofloopBenchmarkNormalizationReport({ generatedAt: "test" });
    const entries = Object.fromEntries(report.entries.map((entry) => [entry.id, entry]));

    expect(report.schema).toBe("proofloop-benchmark-normalization-v1");
    expect(report.policy.join(" ")).toContain("Do not normalize away official scorer semantics");
    expect(report.summary.entries).toBeGreaterThanOrEqual(9);
    expect(report.summary.everyBenchmarkHasNodeRoomShape).toBe(true);
    expect(report.summary.officialScoresClaimed).toBeGreaterThan(0);
    expect(report.summary.officialScoresBlocked).toBe(0);

    expect(entries.bankertoolbench).toMatchObject({
      productFit: "proven",
      officialFit: "claimed",
      officialScorerSemantics: "preserved",
    });
    expect(entries.bankertoolbench.stages.officialScorer.status).toBe("proven");
  });

  it("marks SpreadsheetBench outputs and accepted upstream scorer receipts proven", () => {
    const report = buildProofloopBenchmarkNormalizationReport({ generatedAt: "test" });
    const spreadsheet = report.entries.find((entry) => entry.id === "spreadsheetbench");

    expect(spreadsheet).toBeTruthy();
    expect(spreadsheet?.productFit).toBe("proven");
    expect(spreadsheet?.officialFit).toBe("claimed");
    expect(spreadsheet?.stages.productTaskManifest.contract).toContain("1633/1633 staged task targets");
    expect(spreadsheet?.stages.nodeRoomRunSpec.status).toBe("proven");
    expect(spreadsheet?.stages.nodeRoomRunSpec.blockers).toEqual([]);
    expect(spreadsheet?.stages.officialSubmission.status).toBe("proven");
    expect(spreadsheet?.stages.officialSubmission.blockers).toEqual([]);
    expect(spreadsheet?.stages.officialScorer.status).toBe("proven");
    expect(spreadsheet?.stages.officialScorer.blockers).toEqual([]);
    expect(spreadsheet?.stages.officialScorer.evidence).toEqual(expect.arrayContaining([
      "docs/eval/spreadsheetbench-v1-accepted-official-scorer-receipt.json",
      "docs/eval/spreadsheetbench-v2-accepted-official-scorer-receipt.json",
    ]));
  });

  it("normalizes external adapters as local product paths while naming official task expansion/export blockers", () => {
    const report = buildProofloopBenchmarkNormalizationReport({ generatedAt: "test" });
    const entries = Object.fromEntries(report.entries.map((entry) => [entry.id, entry]));

    expect(entries.finch.productFit).toBe("partial");
    expect(entries.finch.stages.officialTaskBundle.status).toBe("ready");
    expect(entries.finch.stages.nodeRoomRunSpec.status).toBe("proven");
    expect(entries.finch.stages.productTaskManifest.blockers.join(" ")).toContain("172 official Finch task ids");
    expect(entries.finch.stages.artifactExport.status).toBe("proven");
    expect(entries.finch.stages.artifactExport.evidence).toContain("docs/eval/proofloop-official-outputs/finch.json");
    expect(entries.finch.officialFit).toBe("claimed");
    expect(entries.finch.stages.officialSubmission.status).toBe("proven");
    expect(entries.finch.stages.officialScorer.status).toBe("proven");

    expect(entries.finauditing.stages.officialTaskBundle.status).toBe("ready");
    expect(entries.finauditing.stages.artifactExport.status).toBe("proven");
    expect(entries.finauditing.stages.artifactExport.evidence).toContain("docs/eval/proofloop-official-outputs/finauditing.json");

    expect(entries.workstreambench.stages.officialTaskBundle.status).toBe("ready");
    expect(entries.workstreambench.stages.officialTaskBundle.evidence).toContain("docs/eval/proofloop-official-task-bundles/workstreambench.json");
    expect(entries.workstreambench.stages.productTaskManifest.blockers.join(" ")).toContain("38 locked public MBABench ModelOff task ids");
    expect(entries.workstreambench.stages.artifactExport.status).toBe("proven");
    expect(entries.workstreambench.stages.artifactExport.evidence).toContain("docs/eval/proofloop-official-outputs/workstreambench.json");
    expect(entries.workstreambench.officialFit).toBe("claimed");
    expect(entries.workstreambench.stages.officialSubmission.status).toBe("proven");
    expect(entries.workstreambench.stages.officialScorer.status).toBe("proven");
    expect(entries.workstreambench.stages.officialScorer.blockers).toEqual([]);
  });

  it("renders a compact normalization table", () => {
    const markdown = renderProofloopBenchmarkNormalizationMarkdown(
      buildProofloopBenchmarkNormalizationReport({ generatedAt: "test" }),
    );

    expect(markdown).toContain("# Proof Loop Benchmark Normalization");
    expect(markdown).toContain("| `bankertoolbench` | proven | claimed |");
    expect(markdown).toContain("| `finch` | partial | claimed |");
    expect(markdown).toContain("Stage Detail");
  });
});
