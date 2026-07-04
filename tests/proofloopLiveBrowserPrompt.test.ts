import { describe, expect, it } from "vitest";
import {
  filterProofloopTasksByIds,
  parseProofloopTaskIds,
  providerForAgentModelPolicy,
  withNodeAgentMention,
} from "../src/eval/proofloopLiveBrowserPrompt";
import { classifyAgentCompletion } from "../src/eval/proofloopLiveBrowserCompletion";

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

  it("does not treat a recoverable failed progress card as terminal while the job is running", () => {
    const active = classifyAgentCompletion({
      jobStatus: "running 1/1000",
      progressStatus: "failed",
      peopleText: "Public agent · idle",
      streamText: "NodeAgent needs attention after fetch_source failed",
      latestStreamText: "",
    });
    expect(active.failed).toBe(false);
    expect(active.completed).toBe(false);

    const paused = classifyAgentCompletion({
      jobStatus: "paused 2/1000",
      progressStatus: "failed",
      peopleText: "Public agent · done",
      streamText: "NodeAgent needs attention after a recoverable slice",
      latestStreamText: "",
    });
    expect(paused.failed).toBe(false);
    expect(paused.completed).toBe(false);

    const terminal = classifyAgentCompletion({
      jobStatus: "failed",
      progressStatus: "failed",
      peopleText: "Public agent · failed",
      streamText: "NodeAgent needs attention",
      latestStreamText: "",
    });
    expect(terminal.failed).toBe(true);
  });
});
