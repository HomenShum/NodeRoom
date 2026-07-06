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
    expect(entries["openrouter-convex"].productPathCompletion.status).toBe("proven");
    expect(entries["openrouter-convex"].officialSemanticScore.status).toBe("not_applicable");
  });

  it("lists external finance adapters without upgrading partial product proof to live-proven", () => {
    const board = buildProofloopBenchmarkBoard({ generatedAt: "test" });
    const entries = Object.fromEntries(board.entries.map((entry) => [entry.id, entry]));

    for (const id of ["finch", "workstreambench"]) {
      expect(entries[id].productPathCompletion.status).toBe("proven");
      expect(entries[id].productPathCompletion.blockers).toEqual([]);
      expect(entries[id].officialSemanticScore.evidence).toContain(`docs/eval/proofloop-adapter-blockers/${id}.json`);
      expect(entries[id].officialSemanticScore.blockers.join(" ")).toContain(`${id}: official scorer receipt`);
    }
    expect(["partial", "proven"]).toContain(entries.finauditing.productPathCompletion.status);
    if (entries.finauditing.productPathCompletion.status === "partial") {
      expect(entries.finauditing.productPathCompletion.blockers).toContain("finauditing: live-room browser scenario failed");
    } else {
      expect(entries.finauditing.productPathCompletion.blockers).not.toContain("finauditing: live-room browser scenario failed");
    }
    expect(entries.finauditing.officialSemanticScore.evidence).toContain("docs/eval/proofloop-adapter-blockers/finauditing.json");
    expect(entries.finauditing.officialSemanticScore.blockers.join(" ")).toContain("finauditing: official scorer receipt");
    expect(entries.finch.officialSemanticScore.status).toBe("needs_scaffold_or_run");
    expect(entries.finauditing.officialSemanticScore.status).toBe("needs_scaffold_or_run");
    expect(entries.workstreambench.officialSemanticScore.status).toBe("blocked");
    expect(entries.finch.officialSemanticScore.blockers.join(" ")).toContain("content_parts rendering");
    expect(entries.finch.officialSemanticScore.blockers.join(" ")).toContain("missing official scorer");
    expect(entries.workstreambench.officialSemanticScore.blockers.join(" ")).toContain("no public official bundle/scorer/rubric URL");
  });

  it("renders a compact markdown status table for users", () => {
    const markdown = renderProofloopBenchmarkBoardMarkdown(buildProofloopBenchmarkBoard({ generatedAt: "test" }));

    expect(markdown).toContain("# Proof Loop Benchmark Board");
    expect(markdown).toContain("| `bankertoolbench` | external_adapter | proven | proven |");
    expect(markdown).toContain("| `finch` | external_adapter | proven | needs_scaffold_or_run |");
    expect(markdown).toContain("| `finauditing` | external_adapter |");
    expect(markdown).toContain("FinAuditing scorer output");
    expect(markdown).toContain("content_parts rendering");
    expect(markdown).toContain("NodeRoom model-output artifacts are complete");
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
