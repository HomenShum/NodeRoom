import { describe, it, expect } from "vitest";
import {
  evaluateLiveSuiteGate,
  type LiveTaskResult,
} from "../src/eval/bankerToolBenchLiveSuiteGate";

function results(n: number, passed: boolean, prefix = "t"): LiveTaskResult[] {
  return Array.from({ length: n }, (_, i) => ({ taskId: `${prefix}${i + 1}`, passed }));
}
function ids(n: number, prefix = "t"): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

describe("BTB live-suite gate (FR-020C) — live-UI completion gate", () => {
  it("A. earns the flip when all 100 live receipts pass", () => {
    const v = evaluateLiveSuiteGate(results(100, true));
    expect(v.passedTaskCount).toBe(100);
    expect(v.flipEligible).toBe(true);
    expect(v.claim).toContain("not a 100% rubric pass rate");
  });

  it("B. blocks when only 1 task is proven live (today's reality)", () => {
    const v = evaluateLiveSuiteGate(results(1, true));
    expect(v.flipEligible).toBe(false);
    expect(v.passedTaskCount).toBe(1);
    expect(v.claim).toContain("1/100");
  });

  it("C. counts failed tasks and names them", () => {
    const v = evaluateLiveSuiteGate([...results(95, true), ...results(5, false, "x")]);
    expect(v.passedTaskCount).toBe(95);
    expect(v.failedTaskIds).toHaveLength(5);
    expect(v.flipEligible).toBe(false);
  });

  it("D. a task passing in any run is proven (re-run/repair counts)", () => {
    const v = evaluateLiveSuiteGate(
      [
        { taskId: "t1", passed: false, reason: "first attempt timed out" },
        { taskId: "t1", passed: true },
      ],
      { expectedCount: 1 },
    );
    expect(v.passedTaskCount).toBe(1);
    expect(v.failedTaskIds).toHaveLength(0);
    expect(v.flipEligible).toBe(true);
  });

  it("E. requires the exact official id set when provided", () => {
    const present = results(99, true);
    const v = evaluateLiveSuiteGate(present, { expectedTaskIds: ids(100) });
    expect(v.missingTaskIds).toEqual(["t100"]);
    expect(v.flipEligible).toBe(false);
  });

  it("F. empty input blocks (no silent pass)", () => {
    const v = evaluateLiveSuiteGate([]);
    expect(v.passedTaskCount).toBe(0);
    expect(v.flipEligible).toBe(false);
  });
});
