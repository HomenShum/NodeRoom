import { describe, expect, it } from "vitest";
import { runMultiUserCoordinationProof } from "../evals/multiUserCoordinationProof";

describe("multi-user coordination proof", () => {
  it("proves managed locks, CAS, drafts, and release cleanup across multiple actors", async () => {
    const proof = await runMultiUserCoordinationProof();

    expect(proof.summary.passed).toBe(true);
    expect(proof.summary.scenarios).toBe(6);
    expect(proof.summary.failedScenarios).toEqual([]);
    for (const scenario of proof.scenarios) {
      expect(scenario.passed, scenario.id).toBe(true);
      expect(scenario.checks.noLockLeak, scenario.id).toBe(true);
    }

    const c2Scenario = proof.scenarios.find((scenario) => scenario.id === "human_c2_vs_agent_a1_c5_stale_range_no_clobber");
    expect(c2Scenario?.checks).toMatchObject({
      humanC2WriteSucceeded: true,
      agentRangeWriteRejected: true,
      conflictReturnedForC2: true,
      canonicalHumanC2Preserved: true,
      staleRangeDidNotPartiallyApplyAfterC2Conflict: true,
      releaseRecorded: true,
      noLockLeak: true,
    });
  });
});
