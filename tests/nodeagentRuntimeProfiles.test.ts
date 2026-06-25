import { describe, expect, it } from "vitest";
import {
  inferNodeAgentBudgetProfile,
  runtimeProfilePolicy,
  shouldAutoRunWithoutApproval,
} from "../src/nodeagent/runtimeProfiles";

describe("NodeAgent budget profiles", () => {
  it("keeps the default public lane conservative", () => {
    expect(runtimeProfilePolicy("standard")).toMatchObject({
      defaultForPublicAsk: true,
      highBudget: false,
      requiresExplicitApproval: false,
    });
    expect(shouldAutoRunWithoutApproval("standard")).toBe(true);
  });

  it("uses the high-budget completion lane only for benchmark/eval work", () => {
    expect(inferNodeAgentBudgetProfile({ goal: "run the BankerToolBench scorecard in a fresh room" })).toBe("benchmark_completion");
    expect(runtimeProfilePolicy("benchmark_completion")).toMatchObject({
      highBudget: true,
      receiptHeavy: true,
      resumable: true,
    });
    expect(shouldAutoRunWithoutApproval("benchmark_completion")).toBe(false);
  });

  it("requires approval for deep diligence but allows safe background continuation before approval", () => {
    expect(inferNodeAgentBudgetProfile({ goal: "deep diligence on the Series B target" })).toBe("background");
    expect(inferNodeAgentBudgetProfile({ goal: "deep diligence on the Series B target", userApprovedDeepRun: true })).toBe("deep_diligence");
    expect(runtimeProfilePolicy("deep_diligence").requiresExplicitApproval).toBe(true);
  });
});
