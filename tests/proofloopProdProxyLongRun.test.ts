import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProofloopProdProxyLongRunPlan,
  renderProofloopProdProxyLongRunMarkdown,
  writeProofloopProdProxyLongRunArtifacts,
} from "../src/eval/proofloopProdProxyLongRun";

describe("ProofLoop prod proxy long-run queue", () => {
  it("plans every model-task attempt and preserves blocked adapter families", () => {
    const plan = buildProofloopProdProxyLongRunPlan({
      generatedAt: "2026-07-05T00:00:00.000Z",
      runId: "test-longrun",
      budgetUsd: 100,
    });

    expect(plan.summary.uniqueTaskTargets).toBe(1354);
    expect(plan.summary.modelCount).toBe(4);
    expect(plan.summary.totalAttempts).toBe(5416);
    expect(plan.summary.passedExistingAttempts).toBeGreaterThanOrEqual(10);
    expect(plan.summary.queuedAttempts).toBe(402);
    expect(plan.summary.blockedAdapterAttempts).toBe(5004);
    expect(plan.summary.blockedBudgetAttempts).toBe(0);
    expect(plan.budget.runnableQueueFitsBudget).toBe(true);
    expect(plan.budget.fullCurrentModelMatrixFitsBudget).toBe(false);
  });

  it("keeps SpreadsheetBench full suites blocked until generic prod browser adapters exist", () => {
    const plan = buildProofloopProdProxyLongRunPlan({ runId: "test-longrun" });
    const v1 = plan.adapterGaps.find((gap) => gap.familyId === "spreadsheetbench-v1-full-912");
    const v2 = plan.adapterGaps.find((gap) => gap.familyId === "spreadsheetbench-v2-full-321");

    expect(v1?.attemptCount).toBe(912 * 4);
    expect(v1?.adapterVersion).toBe("0.1.0");
    expect(v1?.adapterPlanPath).toBe("docs/eval/proofloop-prod-browser-adapters.json");
    expect(v1?.requiredAdapter).toBe("spreadsheetbench-v1-official-workbook-prod-browser");
    expect(v1?.firstBlocker).toContain("Generic SpreadsheetBench official workbook upload");
    expect(v2?.attemptCount).toBe(321 * 4);
    expect(v2?.requiredAdapter).toBe("spreadsheetbench-v2-workflow-chart-prod-browser");
  });

  it("plans free OpenRouter model probes without paid-spend assumptions", () => {
    const plan = buildProofloopProdProxyLongRunPlan({
      runId: "test-free-longrun",
      models: ["poolside/laguna-xs-2.1:free", "cohere/north-mini-code:free"],
      budgetUsd: 0,
    });

    expect(plan.summary.modelCount).toBe(2);
    expect(plan.summary.totalAttempts).toBe(2708);
    expect(plan.summary.queuedAttempts).toBe(206);
    expect(plan.summary.blockedAdapterAttempts).toBe(2502);
    expect(plan.budget.queuedEstimatedNewSpendUsd).toBe(0);
    expect(plan.budget.fullMatrixEstimatedUsd).toBe(0);
    expect(plan.modelCosts.every((row) => row.estimatedCostPerAttemptUsd === 0)).toBe(true);
  });

  it("uses real-user prod UI commands for runnable BTB and external proxy attempts", () => {
    const plan = buildProofloopProdProxyLongRunPlan({ runId: "test-longrun" });
    const btb = plan.attempts.find((attempt) => attempt.familyId === "bankertoolbench-full-100" && attempt.status === "queued");
    const finch = plan.attempts.find((attempt) => attempt.familyId === "finch-prod-proxy-task" && attempt.status === "queued");

    expect(btb?.command?.shell).toBe("npm run proofloop:live:btb");
    expect(btb?.command?.env.PROOFLOOP_REAL_USER_MODE).toBe("1");
    expect(btb?.command?.env.PROOFLOOP_FOCUS_MODE).toBe("0");
    expect(btb?.memoryModeAllowed).toBe(false);
    expect(finch?.command?.shell).toContain("--real-user");
    expect(finch?.command?.shell).toContain("--model");
  });

  it("writes resumable state, queue, dashboard, budget, and gap artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "proofloop-longrun-"));
    const plan = buildProofloopProdProxyLongRunPlan({
      root: process.cwd(),
      generatedAt: "2026-07-05T00:00:00.000Z",
      runId: "test-longrun",
    });

    writeProofloopProdProxyLongRunArtifacts({
      root: dir,
      plan,
      jsonOut: "docs/eval/plan.json",
      mdOut: "docs/eval/plan.md",
    });

    const state = JSON.parse(readFileSync(join(dir, ".proofloop/prod-proxy-longrun/test-longrun/state.json"), "utf8")) as typeof plan;
    const queue = readFileSync(join(dir, ".proofloop/prod-proxy-longrun/test-longrun/queue.jsonl"), "utf8").trim().split("\n");
    const dashboard = JSON.parse(readFileSync(join(dir, ".proofloop/prod-proxy-longrun/test-longrun/dashboard.json"), "utf8")) as { schema?: string };
    const markdown = renderProofloopProdProxyLongRunMarkdown(plan);

    expect(state.schema).toBe("proofloop-prod-proxy-longrun-v1");
    expect(queue).toHaveLength(5416);
    expect(dashboard.schema).toBe("proofloop-prod-proxy-longrun-dashboard-v1");
    expect(markdown).toContain("Blocked by missing browser adapters: 5004");
  });
});
