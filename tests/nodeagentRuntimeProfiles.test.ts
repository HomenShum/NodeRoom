import { describe, expect, it } from "vitest";
import {
  NODEAGENT_BUDGET_PROFILE_POLICIES,
  inferNodeAgentBudgetProfile,
  runtimeProfilePolicy,
  shouldAutoRunWithoutApproval,
} from "../src/nodeagent/runtimeProfiles";
import {
  NODEAGENT_BUDGET_PROFILES,
  type NodeAgentBudgetProfile,
} from "../src/nodeagent/core/budgetProfiles";

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

describe("budget policy modules stay consistent (no drift)", () => {
  const ALL: NodeAgentBudgetProfile[] = [
    "instant",
    "standard",
    "background",
    "deep_diligence",
    "benchmark_completion",
  ];

  it("the benchmark completion spend lane requires explicit approval (C1 regression)", () => {
    // The bug: runtimeProfiles hardcoded requiresExplicitApproval:false while
    // budgetProfiles said userFriction:"explicit_approval". A receipt-heavy,
    // high-budget lane must fail closed.
    expect(NODEAGENT_BUDGET_PROFILES.benchmark_completion.userFriction).toBe("explicit_approval");
    expect(runtimeProfilePolicy("benchmark_completion").requiresExplicitApproval).toBe(true);
    expect(shouldAutoRunWithoutApproval("benchmark_completion")).toBe(false);
  });

  it("runtime policy is a faithful derivation of the budgetProfiles source of truth", () => {
    for (const id of ALL) {
      const spec = NODEAGENT_BUDGET_PROFILES[id];
      const policy = NODEAGENT_BUDGET_PROFILE_POLICIES[id];
      // Approval and high-budget follow opt-in-only; approval also equals the
      // "explicit_approval" friction level. These must never diverge again.
      expect(policy.requiresExplicitApproval).toBe(spec.optInOnly);
      expect(policy.highBudget).toBe(spec.optInOnly);
      expect(policy.requiresExplicitApproval).toBe(spec.userFriction === "explicit_approval");
      expect(policy.resumable).toBe(spec.requiresPlanBeforeSpend);
      expect(policy.defaultForPublicAsk).toBe(spec.defaultForPublicAsk);
    }
  });

  it("fail-closed invariant: no opt-in or high-budget lane auto-runs without approval", () => {
    for (const id of ALL) {
      const policy = NODEAGENT_BUDGET_PROFILE_POLICIES[id];
      if (policy.highBudget || policy.requiresExplicitApproval) {
        expect(shouldAutoRunWithoutApproval(id)).toBe(false);
      }
    }
  });
});
