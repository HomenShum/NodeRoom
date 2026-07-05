import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildProofloopStandaloneRunnerPlan,
  readProofloopRunnerDogfoodReceipt,
  renderProofloopStandaloneRunnerPlanMarkdown,
  writeProofloopStandaloneRunnerPlanArtifacts,
} from "../src/eval/proofloopStandaloneRunnerPlan";

describe("ProofLoop standalone runner dogfood plan", () => {
  it("emits the merged standalone runner plan schema and resume command", () => {
    const plan = buildProofloopStandaloneRunnerPlan({
      generatedAt: "2026-07-05T00:00:00.000Z",
      planId: "test-standalone-runner",
      budgetUsd: 100,
    });

    expect(plan.schema).toBe("proofloop-runner-plan-v1");
    expect(plan.mode).toBe("two-layer-certification-v1");
    expect(plan.standaloneRunner.command).toBe(
      "npx --yes github:HomenShum/proofloop runner run --plan docs/eval/proofloop-standalone-runner-dogfood-plan.json --budget-usd 100",
    );
    expect(plan.standaloneRunner.resumeCommand).toBe("npx --yes github:HomenShum/proofloop runner resume --run-id latest");
    expect(plan.source.localProofloopVendored).toBe(false);
    expect(plan.source.liveModelSweepsExecuted).toBe(false);
    expect(plan.resume.regeneratePlanCommand).toBe(
      "npm run benchmark:proofloop:standalone-runner-plan -- --budget-usd 100",
    );
  });

  it("summarizes current unfinished proxy and benchmark work without dropping the denominator", () => {
    const plan = buildProofloopStandaloneRunnerPlan({
      generatedAt: "2026-07-05T00:00:00.000Z",
      planId: "test-standalone-runner",
      budgetUsd: 100,
    });

    expect(plan.summary.uniqueTaskTargets).toBe(1354);
    expect(plan.summary.modelTaskAttempts).toBe(5416);
    expect(plan.summary.queuedAttempts).toBe(3516);
    expect(plan.summary.blockedAdapterAttempts).toBe(0);
    expect(plan.summary.capabilityHeadlessTasks).toBe(7);
    expect(plan.summary.browserCertificationTasks).toBe(9);
    expect(plan.summary.browserRequiredForAllCapabilityTasks).toBe(false);
    expect(plan.summary.adapterGapTasks).toBe(0);
    expect(plan.summary.guardedLiveRunBatchTasks).toBe(9);
    expect(plan.summary.officialScoreGapTasks).toBe(3);
    expect(plan.summary.tasks).toBe(19);
    expect(plan.summary.currentAllTaskWinner).toBeNull();
  });

  it("creates compact tasks for guarded live batches and official score blockers", () => {
    const plan = buildProofloopStandaloneRunnerPlan({
      generatedAt: "2026-07-05T00:00:00.000Z",
      planId: "test-standalone-runner",
      budgetUsd: 100,
    });
    const ids = plan.tasks.map((task) => task.id);

    expect(ids).toContain("capability.prod-proxy-denominator");
    expect(ids).toContain("capability.free-openrouter-longrun-plan");
    expect(ids).toContain("capability.accounting-proofloop");
    expect(ids).toContain("capability.multi-user-coordination");
    expect(ids).toContain("live-run.proximitty-underwriting-pr0");
    expect(ids).toContain("live-run.noderoom-multi-user-conflict");
    expect(ids).toContain("live-run.spreadsheetbench-v1-full-912");
    expect(ids).toContain("live-run.spreadsheetbench-v2-full-321");
    expect(ids).toContain("live-run.bankertoolbench-full-100");
    expect(ids).toContain("official-score.finch");

    const btb = plan.tasks.find((task) => task.id === "live-run.bankertoolbench-full-100");
    expect(btb?.layer).toBe("browser-certification");
    expect(btb?.command).toBe("npm run benchmark:proofloop:prod-proxy-longrun -- status");
    expect(btb?.estimatedCostUsd).toBe(0);
    expect(btb?.status).toBe("guarded-spend");
    expect(btb?.paidModelRequired).toBe(true);
    expect(btb?.commands.some((command) => command.command.includes("--max-attempts 1"))).toBe(true);

    const proximitty = plan.tasks.find((task) => task.id === "live-run.proximitty-underwriting-pr0");
    expect(proximitty?.layer).toBe("browser-certification");
    expect(proximitty?.command).toBe("npm run benchmark:proofloop:prod-proxy-longrun -- status");
    expect(proximitty?.estimatedCostUsd).toBe(0);
    expect(proximitty?.paidModelRequired).toBe(true);
    expect(proximitty?.commands.some((command) => command.command.includes("--max-attempts 1"))).toBe(true);

    const spreadsheet = plan.tasks.find((task) => task.id === "live-run.spreadsheetbench-v1-full-912");
    expect(spreadsheet?.layer).toBe("browser-certification");
    expect(spreadsheet?.command).toBe("npm run benchmark:proofloop:prod-proxy-longrun -- status");
    expect(spreadsheet?.status).toBe("guarded-spend");
    expect(spreadsheet?.paidModelRequired).toBe(true);
  });

  it("keeps generation cheap and avoids broad paid sweep commands", () => {
    const plan = buildProofloopStandaloneRunnerPlan({
      generatedAt: "2026-07-05T00:00:00.000Z",
      planId: "test-standalone-runner",
      budgetUsd: 100,
    });
    const allCommands = [
      plan.resume.regeneratePlanCommand,
      plan.resume.runnerCommand,
      ...plan.tasks.flatMap((task) => task.commands.map((command) => command.command)),
    ].join("\n");

    expect(plan.budget.generationCostUsd).toBe(0);
    expect(plan.tasks.find((task) => task.id === "capability.prod-proxy-denominator")?.paidModelRequired).toBe(false);
    expect(allCommands).not.toContain("proofloop-proxy-model-sweep");
    expect(allCommands).not.toContain("proofloop-full-proxy-benchmark-sweep");
    expect(allCommands).not.toContain("benchmark:proofloop:proxy-model-sweep");
    expect(allCommands).not.toContain("benchmark:proofloop:full-proxy-sweep");
  });

  it("writes JSON and Markdown artifacts with resume instructions", () => {
    const dir = mkdtempSync(join(tmpdir(), "proofloop-standalone-runner-"));
    const plan = buildProofloopStandaloneRunnerPlan({
      root: process.cwd(),
      generatedAt: "2026-07-05T00:00:00.000Z",
      planId: "test-standalone-runner",
      budgetUsd: 100,
      planPath: "docs/eval/runner-plan.json",
      docsPath: "docs/eval/runner-plan.md",
    });

    writeProofloopStandaloneRunnerPlanArtifacts({
      root: dir,
      plan,
      jsonOut: "docs/eval/runner-plan.json",
      mdOut: "docs/eval/runner-plan.md",
    });

    const json = JSON.parse(readFileSync(join(dir, "docs/eval/runner-plan.json"), "utf8")) as typeof plan;
    const markdown = readFileSync(join(dir, "docs/eval/runner-plan.md"), "utf8");

    expect(json.schema).toBe("proofloop-runner-plan-v1");
    expect(markdown).toContain("Two-Layer Contract");
    expect(markdown).toContain("Run Or Resume");
    expect(markdown).toContain("npx --yes github:HomenShum/proofloop runner run --plan docs/eval/runner-plan.json --budget-usd 100");
    expect(markdown).toContain("until the package release with the two-layer `this-repo --write-runner-plan` path is published");
    expect(renderProofloopStandaloneRunnerPlanMarkdown(plan)).toContain("No paid model sweeps were run");
  });

  it("can render a post-run receipt without mutating the runner plan JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "proofloop-standalone-runner-receipt-"));
    const runDir = join(dir, ".proofloop/runner/runs/noderoom-closeout-dogfood");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(
      join(runDir, "state.json"),
      JSON.stringify({
        schema: "proofloop-runner-state-v1",
        runId: "noderoom-closeout-dogfood",
        status: "passed",
        budgetUsd: 100,
        spentEstimatedUsd: 0,
        planDigest: "abc123",
        updatedAt: "2026-07-05T05:36:38.275Z",
        taskStates: [
          { id: "adapter-gap.proximitty-underwriting-pr0", status: "passed", attempts: 2, error: "Requeued after interrupted runner process." },
          { id: "official-score.finch", status: "passed", attempts: 1 },
        ],
      }),
      "utf8",
    );
    const plan = buildProofloopStandaloneRunnerPlan({
      root: process.cwd(),
      generatedAt: "2026-07-05T00:00:00.000Z",
      planId: "test-standalone-runner",
      budgetUsd: 100,
      planPath: "docs/eval/runner-plan.json",
      docsPath: "docs/eval/runner-plan.md",
    });
    const receipt = readProofloopRunnerDogfoodReceipt(dir, "noderoom-closeout-dogfood");

    writeProofloopStandaloneRunnerPlanArtifacts({
      root: dir,
      plan,
      dogfoodReceipt: receipt,
      jsonOut: "docs/eval/runner-plan.json",
      mdOut: "docs/eval/runner-plan.md",
    });

    const json = JSON.parse(readFileSync(join(dir, "docs/eval/runner-plan.json"), "utf8")) as Record<string, unknown>;
    const markdown = readFileSync(join(dir, "docs/eval/runner-plan.md"), "utf8");

    expect(json.dogfoodReceipt).toBeUndefined();
    expect(markdown).toContain("Dogfood Receipt");
    expect(markdown).toContain("Status: passed");
    expect(markdown).toContain("Tasks: passed=2");
    expect(markdown).toContain("`adapter-gap.proximitty-underwriting-pr0`");
  });
});
