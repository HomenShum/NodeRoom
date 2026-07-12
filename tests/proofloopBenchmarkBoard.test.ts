import { describe, expect, it } from "vitest";
import {
  buildProofloopBenchmarkBoard,
  deriveExternalAdapterProductPathStatus,
  renderProofloopBenchmarkBoardMarkdown,
} from "../src/eval/proofloopBenchmarkBoard";

describe("Proof Loop benchmark board", () => {
  it("separates product-path proof from official semantic score claims", () => {
    const board = buildProofloopBenchmarkBoard({ generatedAt: "test" });
    const entries = Object.fromEntries(board.entries.map((entry) => [entry.id, entry]));

    expect(board.policy.join(" ")).toContain("Docker/Harbor isolation can block official score promotion");
    expect(entries.bankertoolbench.productPathCompletion).toMatchObject({
      status: "proven",
      scoreType: "product_path_completion",
    });
    expect(entries.bankertoolbench.officialSemanticScore).toMatchObject({
      status: "proven",
      scoreType: "official_semantic_score",
      metrics: {
        expectedCount: 100,
        executedTaskCount: 100,
        cleanScoredTaskCount: 100,
        meanCleanReward: 0.251875,
        passRate: 0,
      },
    });
    expect(entries.spreadsheetbench.productPathCompletion.status).toBe("proven");
    // C15 regression guard: SpreadsheetBench's official score is "proven" ONLY when
    // an accepted upstream official-scorer receipt exists — NOT off task-coverage /
    // staging readiness (which false-flipped it). It IS backed by the accepted V1/V2
    // receipts, so it is proven, and the evidence must cite those receipts (not the
    // coverage ledger). A low pass rate is still an imported official score.
    expect(entries.spreadsheetbench.officialSemanticScore.status).toBe("proven");
    expect(entries.spreadsheetbench.officialSemanticScore.evidence).toContain(
      "docs/eval/spreadsheetbench-v1-accepted-official-scorer-receipt.json",
    );
    expect(entries.spreadsheetbench.officialSemanticScore.evidence).not.toContain(
      "docs/eval/official-benchmark-task-coverage.json",
    );
    expect(entries["openrouter-convex"].productPathCompletion.status).toBe("proven");
    expect(entries["openrouter-convex"].officialSemanticScore.status).toBe("not_applicable");
  });

  it("lists external finance adapters with separate proven product and official-score receipts", () => {
    const board = buildProofloopBenchmarkBoard({ generatedAt: "test" });
    const entries = Object.fromEntries(board.entries.map((entry) => [entry.id, entry]));

    for (const id of ["finch", "finauditing", "workstreambench"]) {
      expect(entries[id].productPathCompletion.status).toBe("proven");
      expect(entries[id].productPathCompletion.blockers).toEqual([]);
      expect(entries[id].officialSemanticScore.evidence).toContain(`docs/eval/proofloop-adapter-blockers/${id}.json`);
      expect(entries[id].officialSemanticScore.status).toBe("proven");
      expect(entries[id].officialSemanticScore.blockers).toEqual([]);
    }
    expect(entries.finch.officialSemanticScore.evidence).toContain("docs/eval/proofloop-official-score-imports/finch.json");
    expect(entries.finauditing.officialSemanticScore.evidence).toContain("docs/eval/proofloop-official-score-imports/finauditing.json");
    expect(entries.workstreambench.officialSemanticScore.evidence).toContain("docs/eval/proofloop-official-score-imports/workstreambench.json");
    expect(entries.workstreambench.officialSemanticScore.evidence).toContain("docs/eval/proofloop-official-task-bundles/workstreambench.json");
  });

  it("renders a compact markdown status table for users", () => {
    const markdown = renderProofloopBenchmarkBoardMarkdown(buildProofloopBenchmarkBoard({ generatedAt: "test" }));

    expect(markdown).toContain("# Proof Loop Benchmark Board");
    expect(markdown).toContain("| `bankertoolbench` | external_adapter | proven | proven |");
    expect(markdown).toContain("| `finch` | external_adapter | proven | proven |");
    expect(markdown).toContain("| `finauditing` | external_adapter | proven | proven |");
    expect(markdown).toContain("| `workstreambench` | external_adapter | proven | proven |");
    expect(markdown).toContain("Official scores claimed: 5");
    expect(markdown).toContain("Official scores blocked/not claimed: 0");
    expect(markdown).toContain("| `spreadsheetbench` | official_style | proven | proven |");
    expect(markdown).toContain("Product-path completion is useful proof");
  });

  it("keeps story-route proof partial until fresh live-room proof passes", () => {
    expect(deriveExternalAdapterProductPathStatus({
      btbLivePassed: false,
      liveRoomProofStatus: "failed",
      storyRouteProofStatus: "passed",
      readyToRun: true,
    })).toBe("partial");
    expect(deriveExternalAdapterProductPathStatus({
      btbLivePassed: false,
      liveRoomProofStatus: "passed",
      storyRouteProofStatus: "passed",
      readyToRun: true,
    })).toBe("proven");
  });
});
