import { describe, expect, it } from "vitest";
import { buildProofloopBenchmarkBoard, renderProofloopBenchmarkBoardMarkdown } from "../src/eval/proofloopBenchmarkBoard";

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
      status: "blocked",
      scoreType: "official_semantic_score",
    });
    expect(entries.spreadsheetbench.productPathCompletion.status).toBe("proven");
    expect(entries["openrouter-convex"].productPathCompletion.status).toBe("proven");
    expect(entries["openrouter-convex"].officialSemanticScore.status).toBe("blocked");
  });

  it("lists the registered future finance benchmarks without claiming they are live-proven", () => {
    const board = buildProofloopBenchmarkBoard({ generatedAt: "test" });
    const entries = Object.fromEntries(board.entries.map((entry) => [entry.id, entry]));

    for (const id of ["finch", "finauditing", "workstreambench"]) {
      expect(entries[id].productPathCompletion.status).toBe("registered");
      expect(entries[id].officialSemanticScore.status).toBe("not_claimed");
      expect(entries[id].productPathCompletion.blockers.join(" ")).toContain("missing implementation file");
    }
  });

  it("renders a compact markdown status table for users", () => {
    const markdown = renderProofloopBenchmarkBoardMarkdown(buildProofloopBenchmarkBoard({ generatedAt: "test" }));

    expect(markdown).toContain("# Proof Loop Benchmark Board");
    expect(markdown).toContain("| `bankertoolbench` | external_adapter | proven | blocked |");
    expect(markdown).toContain("| `finch` | external_adapter | registered | not_claimed |");
    expect(markdown).toContain("Product-path completion is useful proof");
  });
});
