import { describe, expect, it } from "vitest";
import {
  buildProofloopBenchmarkNormalizationReport,
  renderProofloopBenchmarkNormalizationMarkdown,
} from "../src/eval/proofloopBenchmarkNormalization";

describe("Proof Loop benchmark normalization", () => {
  it("declares a common NodeRoom product shape without claiming blocked official scores", () => {
    const report = buildProofloopBenchmarkNormalizationReport({ generatedAt: "test" });
    const entries = Object.fromEntries(report.entries.map((entry) => [entry.id, entry]));

    expect(report.schema).toBe("proofloop-benchmark-normalization-v1");
    expect(report.policy.join(" ")).toContain("Do not normalize away official scorer semantics");
    expect(report.summary.entries).toBeGreaterThanOrEqual(9);
    expect(report.summary.everyBenchmarkHasNodeRoomShape).toBe(true);
    expect(report.summary.officialScoresBlocked).toBeGreaterThan(0);

    expect(entries.bankertoolbench).toMatchObject({
      productFit: "proven",
      officialFit: "claimed",
      officialScorerSemantics: "preserved",
    });
    expect(entries.bankertoolbench.stages.officialScorer.status).toBe("proven");
  });

  it("keeps SpreadsheetBench partially normalized until full model-run official outputs exist", () => {
    const report = buildProofloopBenchmarkNormalizationReport({ generatedAt: "test" });
    const spreadsheet = report.entries.find((entry) => entry.id === "spreadsheetbench");

    expect(spreadsheet).toBeTruthy();
    expect(spreadsheet?.productFit).toBe("partial");
    expect(spreadsheet?.officialFit).toBe("blocked");
    expect(spreadsheet?.stages.productTaskManifest.contract).toContain("staged task targets");
    expect(spreadsheet?.stages.nodeRoomRunSpec.blockers.join(" ")).toContain("Only");
    expect(spreadsheet?.stages.officialSubmission.status).toBe("blocked");
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
    expect(entries.finch.officialFit).toBe("blocked");

    expect(entries.finauditing.stages.officialTaskBundle.status).toBe("ready");
    expect(entries.finauditing.stages.artifactExport.status).toBe("proven");
    expect(entries.finauditing.stages.artifactExport.evidence).toContain("docs/eval/proofloop-official-outputs/finauditing.json");

    expect(entries.workstreambench.stages.officialTaskBundle.status).toBe("blocked");
    expect(entries.workstreambench.stages.productTaskManifest.blockers.join(" ")).toContain("official WorkstreamBench task bundle");
    expect(entries.workstreambench.stages.officialScorer.blockers.join(" ")).toContain("no public official bundle/scorer/rubric URL");
  });

  it("renders a compact normalization table", () => {
    const markdown = renderProofloopBenchmarkNormalizationMarkdown(
      buildProofloopBenchmarkNormalizationReport({ generatedAt: "test" }),
    );

    expect(markdown).toContain("# Proof Loop Benchmark Normalization");
    expect(markdown).toContain("| `bankertoolbench` | proven | claimed |");
    expect(markdown).toContain("| `finch` | partial | blocked |");
    expect(markdown).toContain("Stage Detail");
  });
});
