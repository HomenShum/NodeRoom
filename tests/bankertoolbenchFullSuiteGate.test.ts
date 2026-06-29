import { describe, it, expect } from "vitest";
import {
  evaluateFullSuiteGate,
  type FullSuiteGateOptions,
} from "../src/eval/bankerToolBenchFullSuiteGate";
import type {
  BtbLedgerImport,
  BtbLedgerRun,
  BtbLedgerTask,
} from "../src/eval/bankerToolBenchEvalLedger";

// --- builders -------------------------------------------------------------

function mkTask(
  taskId: string,
  opts: { clean?: boolean; reward?: number; exceptions?: number } = {},
): BtbLedgerTask {
  const clean = opts.clean ?? true;
  const reward = opts.reward ?? 1;
  return {
    taskId,
    reward,
    exceptions: opts.exceptions ?? 0,
    firedWriter: clean ? "general" : "write_family_package",
    cleanGeneralProbe: clean,
    modelCalls: 1,
    verdict: clean ? "accept" : "reject",
    source: { status: "finished", jobName: `job-${taskId}` },
    boundary: { supported: 2, total: 2, fullySupported: true },
    rejectionReasons: clean ? [] : ["not_generic_only_materializer"],
  };
}

function mkRun(tasks: BtbLedgerTask[], iterationLabel = "run-1"): BtbLedgerRun {
  return {
    iterationLabel,
    benchmark: "bankertoolbench",
    materializerMode: "generic-only",
    taskCount: tasks.length,
    notes: "test",
    summary: {
      selectedTasks: tasks.length,
      completedTasks: tasks.length,
      erroredTasks: 0,
      missingTasks: 0,
      meanReward: null,
      cleanAcceptedTasks: 0,
      cleanMeanReward: null,
      normalizedCleanAcceptedTasks: 0,
      normalizedCleanMeanReward: null,
    },
    tasks,
  };
}

function mkLedger(runs: BtbLedgerRun[]): BtbLedgerImport {
  return {
    schema: "noderoom-btb-ledger-import-v1",
    generatedAt: "TEST",
    runs,
    totals: { runs: runs.length, tasks: runs.reduce((s, r) => s + r.tasks.length, 0), cleanAcceptedTasks: 0, cleanMeanReward: null },
  };
}

function ids(n: number, prefix = "t"): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
}

function evalIds(n: number, taskOpts: Parameters<typeof mkTask>[1] = {}, options?: FullSuiteGateOptions) {
  return evaluateFullSuiteGate(mkLedger([mkRun(ids(n).map((id) => mkTask(id, taskOpts)))]), options);
}

// --- scenarios ------------------------------------------------------------

describe("BTB full-suite gate (FR-020B) — honest promotion gate", () => {
  it("A. earns the flip when all 100 are clean + scored", () => {
    const v = evalIds(100, { reward: 1 });
    expect(v.cleanScoredTaskCount).toBe(100);
    expect(v.flipEligible).toBe(true);
    expect(v.subGates.every((g) => g.status === "pass")).toBe(true);
    expect(v.passRate).toBe(1);
  });

  it("B. blocks on a partial run (47/100) with an explicit reason", () => {
    const v = evalIds(47, { reward: 1 });
    expect(v.flipEligible).toBe(false);
    const exec = v.subGates.find((g) => g.id === "full_suite_execution");
    expect(exec?.status).toBe("blocked");
    expect(exec?.reason).toContain("47/100");
  });

  it("C. excludes contaminated (non-generic) tasks from the count and names them", () => {
    const clean = ids(95).map((id) => mkTask(id, { reward: 1 }));
    const dirty = ids(5, "x").map((id) => mkTask(id, { clean: false, reward: 0.5 }));
    const v = evaluateFullSuiteGate(mkLedger([mkRun([...clean, ...dirty])]));
    expect(v.cleanScoredTaskCount).toBe(95);
    expect(v.contaminatedTaskIds).toHaveLength(5);
    expect(v.flipEligible).toBe(false);
  });

  it("D. treats unscored tasks (no finite reward) as not-proven", () => {
    const clean = ids(97).map((id) => mkTask(id, { reward: 1 }));
    const unscored = ids(3, "u").map((id) => mkTask(id, { reward: Number.NaN }));
    const v = evaluateFullSuiteGate(mkLedger([mkRun([...clean, ...unscored])]));
    expect(v.cleanScoredTaskCount).toBe(97);
    expect(v.unscoredTaskIds).toHaveLength(3);
    expect(v.flipEligible).toBe(false);
  });

  it("E. (the honest distinction) flips on COMPLETION even when pass-rate is 0", () => {
    const v = evalIds(100, { reward: 0.3 }); // all complete + scored, none meet reward>=1.0
    expect(v.flipEligible).toBe(true);
    expect(v.meanCleanReward).toBeCloseTo(0.3, 5);
    expect(v.passCount).toBe(0);
    expect(v.passRate).toBe(0);
    expect(v.claim).toContain("not a 100% pass rate");
  });

  it("F. requires exact task-id set when expectedTaskIds is supplied", () => {
    const present = ids(99).map((id) => mkTask(id, { reward: 1 }));
    const v = evaluateFullSuiteGate(mkLedger([mkRun(present)]), { expectedTaskIds: ids(100) });
    expect(v.missingTaskIds).toEqual(["t100"]);
    expect(v.flipEligible).toBe(false);
  });

  it("G. a task proven clean in any run is not double-counted or marked contaminated", () => {
    const run1 = mkRun([mkTask("t1", { clean: false, reward: 0.4 })], "run-1");
    const run2 = mkRun([mkTask("t1", { clean: true, reward: 0.9 })], "run-2");
    const v = evaluateFullSuiteGate(mkLedger([run1, run2]), { expectedCount: 1 });
    expect(v.cleanScoredTaskCount).toBe(1);
    expect(v.contaminatedTaskIds).toHaveLength(0);
    expect(v.flipEligible).toBe(true);
  });

  it("H. empty ledger blocks (no silent pass)", () => {
    const v = evaluateFullSuiteGate(mkLedger([]));
    expect(v.cleanScoredTaskCount).toBe(0);
    expect(v.flipEligible).toBe(false);
  });
});
