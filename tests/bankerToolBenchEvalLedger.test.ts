import { describe, expect, it } from "vitest";
import {
  buildBtbLedgerImport,
  normalizeBtbSweepSummary,
  toConvexBtbLedgerPayload,
  type BankerToolBenchSweepSummary,
} from "../src/eval/bankerToolBenchEvalLedger";

describe("BankerToolBench eval ledger normalization", () => {
  it("preserves the clean-gated headline and excludes verifier exceptions", () => {
    const summary = fixtureSummary();
    const run = normalizeBtbSweepSummary(summary, { sourcePath: "docs/eval/btb-clean-capability-fixture.json" });

    expect(run.iterationLabel).toBe("btb-fixture-run");
    expect(run.summary.normalizedCleanAcceptedTasks).toBe(1);
    expect(run.summary.normalizedCleanMeanReward).toBe(0.94);

    const clean = run.tasks.find((task) => task.taskId === "btb-clean")!;
    expect(clean.cleanGeneralProbe).toBe(true);
    expect(clean.modelCalls).toBe(1);
    expect(clean.raw).toBe("94 / 100");
    expect(clean.firedWriter).toBe("generic-quartet");
    expect(clean.boundary).toEqual({ supported: 4, total: 4, fullySupported: true });

    const verifierException = run.tasks.find((task) => task.taskId === "btb-verifier-exception")!;
    expect(verifierException.reward).toBe(0.96);
    expect(verifierException.cleanGeneralProbe).toBe(false);
    expect(verifierException.exceptions).toBe(1);
    expect(verifierException.verdict).toContain("verifier_exception");

    const missingReward = run.tasks.find((task) => task.taskId === "btb-missing-reward")!;
    expect(missingReward.reward).toBe(0);
    expect(missingReward.verdict).toContain("not_finished_with_reward");
  });

  it("converts a run into the narrow Convex ingest payload", () => {
    const run = normalizeBtbSweepSummary(fixtureSummary());
    const payload = toConvexBtbLedgerPayload(run);

    expect(payload.iterationLabel).toBe("btb-fixture-run");
    expect(payload.tasks).toHaveLength(3);
    expect(payload.tasks[0]).toMatchObject({
      taskId: "btb-clean",
      reward: 0.94,
      cleanGeneralProbe: true,
      modelCalls: 1,
    });
    expect(JSON.stringify(payload)).not.toContain("jobDir");
    expect(JSON.stringify(payload)).not.toContain("resultPath");
  });

  it("aggregates multiple summaries without counting rejected rows", () => {
    const ledger = buildBtbLedgerImport({
      generatedAt: "2026-06-21T00:00:00.000Z",
      summaries: [
        { path: "a.json", summary: fixtureSummary({ jobNamePrefix: "run-a", cleanReward: 0.5 }) },
        { path: "b.json", summary: fixtureSummary({ jobNamePrefix: "run-b", cleanReward: 0.7 }) },
      ],
    });

    expect(ledger.totals.runs).toBe(2);
    expect(ledger.totals.tasks).toBe(6);
    expect(ledger.totals.cleanAcceptedTasks).toBe(2);
    expect(ledger.totals.cleanMeanReward).toBe(0.6);
  });
});

function fixtureSummary(overrides: { jobNamePrefix?: string; cleanReward?: number } = {}): BankerToolBenchSweepSummary {
  const cleanReward = overrides.cleanReward ?? 0.94;
  return {
    schema: "noderoom-btb-nodeagent-full-sweep-summary-v1",
    generatedAt: "2026-06-21T00:00:00.000Z",
    jobNamePrefix: overrides.jobNamePrefix ?? "btb-fixture-run",
    modelId: "gpt-4.1-mini",
    materializerMode: "generic-only",
    allowFallbackPlan: false,
    forceModelPlanner: true,
    selectedTasks: 3,
    completedTasks: 2,
    erroredTasks: 1,
    missingTasks: 0,
    meanReward: 0.95,
    cleanCapabilityAcceptedTasks: 1,
    cleanCapabilityMeanReward: cleanReward,
    tasks: [
      {
        taskId: "btb-clean",
        status: "finished",
        reward: cleanReward,
        rawScore: cleanReward * 100,
        maximumScore: 100,
        erroredTrials: 0,
        trialId: "btb-clean__trial",
        plannerTransport: "json-text",
        modelCalls: 1,
        materializerModeReceipt: "generic-only",
        genericWriterOnly: true,
        generalFamilyMaterializersEnabled: false,
        replayMaterializersEnabled: false,
        boundaryReceiptCount: 4,
        supportedBoundaryReceipts: 4,
        cleanCapabilityAccepted: true,
        cleanCapabilityRejectionReasons: [],
      },
      {
        taskId: "btb-verifier-exception",
        status: "errored",
        reward: 0.96,
        rawScore: 96,
        maximumScore: 100,
        erroredTrials: 1,
        plannerTransport: "json-text",
        modelCalls: 1,
        materializerModeReceipt: "generic-only",
        genericWriterOnly: true,
        generalFamilyMaterializersEnabled: false,
        replayMaterializersEnabled: false,
        boundaryReceiptCount: 3,
        supportedBoundaryReceipts: 3,
        cleanCapabilityAccepted: false,
        cleanCapabilityRejectionReasons: ["not_finished_with_reward", "verifier_exception"],
      },
      {
        taskId: "btb-missing-reward",
        status: "errored",
        reward: null,
        rawScore: null,
        maximumScore: null,
        erroredTrials: 1,
        modelCalls: null,
        boundaryReceiptCount: null,
        supportedBoundaryReceipts: null,
        cleanCapabilityAccepted: false,
        cleanCapabilityRejectionReasons: ["not_finished_with_reward"],
      },
    ],
  };
}
