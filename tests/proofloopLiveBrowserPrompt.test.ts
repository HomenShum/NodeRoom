import { describe, expect, it } from "vitest";
import {
  filterProofloopTasksByIds,
  parseProofloopTaskIds,
  providerForAgentModelPolicy,
  withNodeAgentMention,
} from "../src/eval/proofloopLiveBrowserPrompt";

describe("Proof Loop live browser prompt normalization", () => {
  it("invokes the public room NodeAgent for task goals", () => {
    expect(withNodeAgentMention("Compute the variance")).toBe("@nodeagent Compute the variance");
    expect(withNodeAgentMention("@nodeagent Compute the variance")).toBe("@nodeagent Compute the variance");
    expect(withNodeAgentMention("  @NodeAgent compute")).toBe("  @NodeAgent compute");
  });

  it("attributes OpenRouter model ids to the OpenRouter provider", () => {
    expect(providerForAgentModelPolicy("deepseek/deepseek-v4-pro")).toBe("openrouter");
    expect(providerForAgentModelPolicy("z-ai/glm-5.2")).toBe("openrouter");
    expect(providerForAgentModelPolicy("nebius/deepseek-ai/DeepSeek-V4-Pro")).toBe("nebius");
    expect(providerForAgentModelPolicy("gpt-5.4-mini")).toBe("openai");
  });

  it("filters live browser task ids deterministically", () => {
    expect(parseProofloopTaskIds(" variance-calc,runway-calc,variance-calc ,, ")).toEqual(["variance-calc", "runway-calc"]);

    const tasks = [
      { id: "variance-calc", name: "Variance" },
      { id: "research-enrich", name: "Research" },
      { id: "runway-calc", name: "Runway" },
    ];
    expect(filterProofloopTasksByIds(tasks, ["runway-calc"]).map((task) => task.id)).toEqual(["runway-calc"]);
    expect(() => filterProofloopTasksByIds(tasks, ["missing-task"])).toThrow(/missing-task/);
  });
});
