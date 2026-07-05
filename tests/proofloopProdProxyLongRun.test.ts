import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProofloopProdProxyLongRunPlan,
  loadProofloopProdProxyLongRunPlanByRunId,
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
    expect(plan.summary.queuedAttempts).toBe(3516);
    expect(plan.summary.blockedAdapterAttempts).toBe(0);
    expect(plan.summary.blockedBudgetAttempts).toBe(1890);
    expect(plan.budget.runnableQueueFitsBudget).toBe(true);
    expect(plan.budget.fullCurrentModelMatrixFitsBudget).toBe(false);
  });

  it("queues SpreadsheetBench full suites through the generic prod browser adapters", () => {
    const plan = buildProofloopProdProxyLongRunPlan({ runId: "test-longrun" });
    const v1 = plan.attempts.find((attempt) => attempt.familyId === "spreadsheetbench-v1-full-912" && attempt.status === "queued");
    const v2 = plan.attempts.find((attempt) => attempt.familyId === "spreadsheetbench-v2-full-321" && attempt.status === "queued");

    expect(v1?.command?.shell).toBe("npm run proofloop:live:spreadsheetbench-v1");
    expect(v1?.command?.env.SPREADSHEETBENCH_TRACK).toBe("spreadsheetbench-v1");
    expect(v1?.command?.env.SPREADSHEETBENCH_LIVE_PROOF_PATH).toContain(".proofloop/prod-proxy-longrun/test-longrun/receipts/");
    expect(v2?.command?.shell).toBe("npm run proofloop:live:spreadsheetbench-v2");
    expect(v2?.command?.env.SPREADSHEETBENCH_TRACK).toBe("spreadsheetbench-v2");
  });

  it("plans free OpenRouter model probes without paid-spend assumptions", () => {
    const plan = buildProofloopProdProxyLongRunPlan({
      runId: "test-free-longrun",
      models: ["poolside/laguna-xs-2.1:free", "cohere/north-mini-code:free"],
      budgetUsd: 0,
    });

    expect(plan.summary.modelCount).toBe(2);
    expect(plan.summary.totalAttempts).toBe(2708);
    expect(plan.summary.queuedAttempts).toBe(2708);
    expect(plan.summary.blockedAdapterAttempts).toBe(0);
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
    expect(btb?.command?.env.PLAYWRIGHT_RETRIES).toBe("0");
    expect(btb?.command?.env.PLAYWRIGHT_OUTPUT_DIR).toContain(".proofloop/prod-proxy-longrun/test-longrun/receipts/playwright/");
    expect(btb?.memoryModeAllowed).toBe(false);
    expect(finch?.command?.shell).toContain("--real-user");
    expect(finch?.command?.shell).toContain("--model");
  });

  it("queues accounting and Notion through the shared live-browser proof spec with memory profile disabled", () => {
    const plan = buildProofloopProdProxyLongRunPlan({ runId: "test-longrun" });
    const accounting = plan.attempts.find((attempt) => attempt.familyId === "accounting-live-proofloop" && attempt.status === "queued");
    const notion = plan.attempts.find((attempt) => attempt.familyId === "notion-live-proofloop" && attempt.status === "queued");

    expect(accounting?.command?.shell).toBe("npm run proofloop:live:accounting:browser");
    expect(accounting?.command?.env.PROOFLOOP_TASKS_JSON).toBe("proofloop/accounting/live.accounting.config.json");
    expect(accounting?.command?.env.PROOFLOOP_NODEAGENT_RUNTIME_PROFILE).toBe("");
    expect(accounting?.command?.env.PROOFLOOP_SUITE_PROOF_PATH).toContain(".proofloop/prod-proxy-longrun/test-longrun/receipts/");
    expect(notion?.command?.shell).toBe("npm run proofloop:live:notion:browser");
    expect(notion?.command?.env.PROOFLOOP_TASKS_JSON).toBe("proofloop/notion/live.notion.config.json");
    expect(notion?.memoryModeAllowed).toBe(false);
  });

  it("queues Proximitty and multi-user conflict through real-user prod browser adapters", () => {
    const plan = buildProofloopProdProxyLongRunPlan({ runId: "test-longrun" });
    const proximitty = plan.attempts.find((attempt) => attempt.familyId === "proximitty-underwriting-pr0" && attempt.status === "queued");
    const multiUser = plan.attempts.find((attempt) => attempt.familyId === "noderoom-multi-user-conflict" && attempt.status === "queued");

    expect(proximitty?.command?.shell).toBe("npm run proofloop:proximitty:browser");
    expect(proximitty?.command?.env.PROOFLOOP_TASK_IDS).toMatch(/^proximitty-/);
    expect(proximitty?.command?.env.PROOFLOOP_NODEAGENT_RUNTIME_PROFILE).toBe("");
    expect(proximitty?.memoryModeAllowed).toBe(false);
    expect(multiUser?.command?.shell).toBe("npm run proofloop:live:multi-user-conflict");
    expect(multiUser?.command?.env.PROOFLOOP_TASK_IDS).toMatch(/^multi-user-conflict-/);
    expect(multiUser?.command?.env.PROOFLOOP_REAL_USER_MODE).toBe("1");
    expect(multiUser?.memoryModeAllowed).toBe(false);
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
    expect(markdown).toContain("Blocked by missing browser adapters: 0");
    expect(markdown).toContain("Blocked by budget: 1890");
  });

  it("loads a specific long-run state by run id for deterministic resume", () => {
    const dir = mkdtempSync(join(tmpdir(), "proofloop-longrun-runid-"));
    const plan = buildProofloopProdProxyLongRunPlan({
      root: process.cwd(),
      generatedAt: "2026-07-05T00:00:00.000Z",
      runId: "specific-resume-target",
    });

    writeProofloopProdProxyLongRunArtifacts({ root: dir, plan });

    expect(loadProofloopProdProxyLongRunPlanByRunId("specific-resume-target", dir)?.runId).toBe("specific-resume-target");
    expect(loadProofloopProdProxyLongRunPlanByRunId("../specific-resume-target", dir)).toBeUndefined();
  });
});
