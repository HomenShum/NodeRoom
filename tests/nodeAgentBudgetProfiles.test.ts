import { describe, expect, it } from "vitest";
import {
  NODEAGENT_BUDGET_PROFILES,
  budgetProfileDisplay,
  chooseNodeAgentBudgetProfile,
  type NodeAgentBudgetProfile,
} from "../src/nodeagent/core/budgetProfiles";

describe("NodeAgent budget profiles", () => {
  it("keeps normal public asks conservative by default", () => {
    const defaults = Object.values(NODEAGENT_BUDGET_PROFILES).filter((profile) => profile.defaultForPublicAsk);
    expect(defaults.map((profile) => profile.id)).toEqual(["standard"]);
    expect(NODEAGENT_BUDGET_PROFILES.benchmark_completion.defaultForPublicAsk).toBe(false);
    expect(NODEAGENT_BUDGET_PROFILES.deep_diligence.defaultForPublicAsk).toBe(false);
    expect(NODEAGENT_BUDGET_PROFILES.benchmark_completion.optInOnly).toBe(true);
    expect(NODEAGENT_BUDGET_PROFILES.deep_diligence.optInOnly).toBe(true);
  });

  it("uses benchmark completion only for an explicit benchmark lane", () => {
    expect(chooseNodeAgentBudgetProfile({ goal: "fill the company research row" })).toBe("standard");
    expect(chooseNodeAgentBudgetProfile({ goal: "run official SpreadsheetBench", benchmarkMode: true })).toBe("benchmark_completion");
    expect(chooseNodeAgentBudgetProfile({ goal: "simple prompt", explicitProfile: "benchmark_completion" })).toBe("benchmark_completion");
  });

  it("routes risky or expensive work to approval lanes", () => {
    expect(chooseNodeAgentBudgetProfile({ goal: "deep diligence on five startups" })).toBe("background");
    expect(chooseNodeAgentBudgetProfile({ goal: "send the memo to Slack", downstreamSend: true })).toBe("deep_diligence");
    expect(chooseNodeAgentBudgetProfile({ goal: "use private notes in public output", touchesPrivateContext: true })).toBe("deep_diligence");
    expect(chooseNodeAgentBudgetProfile({ goal: "source-backed research", estimatedCostUsd: 2 })).toBe("deep_diligence");
  });

  it("has visible labels for every profile", () => {
    const expected: NodeAgentBudgetProfile[] = ["instant", "standard", "background", "deep_diligence", "benchmark_completion"];
    expect(Object.keys(NODEAGENT_BUDGET_PROFILES).sort()).toEqual([...expected].sort());
    for (const profile of expected) {
      expect(NODEAGENT_BUDGET_PROFILES[profile].label.length).toBeGreaterThan(3);
      expect(budgetProfileDisplay(profile, { minutes: "4-8 min", capUsd: 1.5 })).toContain("cap $1.50");
    }
  });
});
