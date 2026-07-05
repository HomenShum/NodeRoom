import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  gateProofloopGoal,
  initProofloopGoal,
  officialScoresGoalTasks,
  runNextProofloopGoalTask,
  superviseProofloopGoal,
  type ProofloopGoalTask,
} from "../src/eval/proofloopGoalSupervisor";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("Proof Loop goal supervisor", () => {
  it("continues from persisted tasks and refuses external status before solver work is complete", () => {
    const root = tempRoot();
    initProofloopGoal({
      root,
      goalId: "official-scores",
      tasks: [
        commandTask("local-proof", "node -e \"console.log('ok')\""),
        blockerTask("spreadsheetbench-full", "full official bundle is not staged"),
      ],
    });

    const first = runNextProofloopGoalTask("official-scores", { root });
    expect(first.task?.status).toBe("passed");
    expect(first.state.status).toBe("running");

    const second = runNextProofloopGoalTask("official-scores", { root });
    expect(second.task?.status).toBe("needs_scaffold_or_run");
    expect(second.state.status).toBe("needs_scaffold_or_run");
    expect(second.state.unblockedTasksRemaining).toBe(0);
    expect(second.state.blockedTasksRemaining).toBe(1);

    const gate = gateProofloopGoal("official-scores", { root });
    expect(gate.status).toBe("needs_scaffold_or_run");

    const goalDir = join(root, ".proofloop", "goals", "official-scores");
    expect(existsSync(join(goalDir, "state.json"))).toBe(true);
    expect(existsSync(join(goalDir, "queue.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(goalDir, "blockers.json"), "utf8"))).toHaveLength(0);
    expect(readFileSync(join(goalDir, "ledger.jsonl"), "utf8")).toContain("task_needs_scaffold_or_run");
    expect(existsSync(join(root, ".proofloop", "lanes", "spreadsheetbench-full", "blocker-analysis.json"))).toBe(true);

    const exportedJsonPath = join(root, "docs", "eval", "proofloop-goal-ledger.json");
    const exportedMarkdownPath = join(root, "docs", "eval", "PROOFLOOP_GOAL_LEDGER.md");
    expect(existsSync(exportedJsonPath)).toBe(true);
    expect(existsSync(exportedMarkdownPath)).toBe(true);
    const receipt = JSON.parse(readFileSync(exportedJsonPath, "utf8"));
    expect(receipt.schema).toBe("proofloop-goal-ledger-export-v1");
    expect(receipt.localStore.rawLocalStoresCommitted).toBe(false);
    expect(receipt.exports).toEqual({
      json: "docs/eval/proofloop-goal-ledger.json",
      markdown: "docs/eval/PROOFLOOP_GOAL_LEDGER.md",
    });
    expect(receipt.summary.blockedReasonCount).toBe(1);
    expect(receipt.goals[0].blockedReasons[0]).toMatchObject({
      taskId: "spreadsheetbench-full",
      status: "needs_scaffold_or_run",
      reason: "full official bundle is not staged",
      resumeCommand: "npm run benchmark:official:task-coverage -- --strict",
    });
    expect(receipt.goals[0].tasks.find((task: { id: string }) => task.id === "spreadsheetbench-full").evidence).toContain(
      "docs/eval/official-benchmark-task-coverage.json",
    );
    const markdown = readFileSync(exportedMarkdownPath, "utf8");
    expect(markdown).toContain("Raw `.proofloop` stores stay gitignored");
    expect(markdown).toContain("full official bundle is not staged");
  });

  it("supervises repeatedly without treating a transcript summary as completion", () => {
    const root = tempRoot();
    initProofloopGoal({
      root,
      goalId: "g",
      tasks: [
        commandTask("a", "node -e \"process.exit(0)\""),
        commandTask("b", "node -e \"process.exit(0)\""),
      ],
    });

    const state = superviseProofloopGoal("g", { root, maxSteps: 5 });
    expect(state.status).toBe("passed");
    expect(state.terminalReason).toContain("persisted proof ledger");
    expect(readFileSync(join(root, ".proofloop", "goals", "g", "ledger.jsonl"), "utf8")).toContain("task_passed");
  });

  it("defines the official-score template with BTB command work and unresolved benchmark blockers", () => {
    const tasks = officialScoresGoalTasks();

    expect(tasks.find((task) => task.id === "btb-fullsuite-official-score")?.command).toContain("bankertoolbench:fullsuite-gate");
    expect(tasks.find((task) => task.id === "benchmark-normalization-ledger")?.command).toBe("npm run benchmark:proofloop:normalized");
    expect(tasks.find((task) => task.id === "company-task-coverage-ledger")?.command).toBe("npm run benchmark:proofloop:company-tasks");
    expect(tasks.find((task) => task.id === "harness-economics-ledger")?.command).toBe("npm run benchmark:proofloop:harness-economics");
    expect(tasks.find((task) => task.id === "harness-economics-ledger")?.evidence.join(" ")).toContain("openrouter-top-paid-tools-snapshot");
    const npxPackage = tasks.find((task) => task.id === "proofloop-npx-package-proof");
    expect(npxPackage?.command).toBe("npm run benchmark:proofloop:npx-package");
    expect(npxPackage?.evidence.join(" ")).toContain("docs/eval/proofloop-npx-package-proof.json");
    expect(npxPackage?.evidence.join(" ")).toContain("docs/eval/PROOFLOOP_NPX_PACKAGE_PROOF.md");
    const preprod = tasks.find((task) => task.id === "preprod-readiness-ledger");
    expect(preprod?.command).toBe("npm run benchmark:proofloop:preprod");
    expect(preprod?.evidence.join(" ")).toContain("docs/eval/proofloop-preprod-readiness.json");
    expect(preprod?.evidence.join(" ")).toContain("docs/eval/PROOFLOOP_PREPROD_READINESS.md");
    expect(preprod?.evidence.join(" ")).toContain("docs/runbooks/PROOFLOOP_PREPROD_RUNBOOK.md");
    expect(tasks.findIndex((task) => task.id === "harness-economics-ledger")).toBeLessThan(
      tasks.findIndex((task) => task.id === "proofloop-npx-package-proof"),
    );
    expect(tasks.findIndex((task) => task.id === "proofloop-npx-package-proof")).toBeLessThan(
      tasks.findIndex((task) => task.id === "preprod-readiness-ledger"),
    );
    expect(tasks.findIndex((task) => task.id === "preprod-readiness-ledger")).toBeLessThan(
      tasks.findIndex((task) => task.id === "external-adapter-setup-doctor"),
    );
    const setupDoctor = tasks.find((task) => task.id === "external-adapter-setup-doctor");
    expect(setupDoctor?.command).toContain("setup bankertoolbench --doctor");
    expect(setupDoctor?.command).toContain("setup finch --doctor");
    expect(setupDoctor?.command).toContain("setup finauditing --doctor");
    expect(setupDoctor?.command).toContain("setup workstreambench --doctor");
    expect(setupDoctor?.evidence.join(" ")).toContain(".proofloop/setup/bankertoolbench-local-setup.json");
    expect(tasks.findIndex((task) => task.id === "external-adapter-setup-doctor")).toBeLessThan(
      tasks.findIndex((task) => task.id === "external-adapter-local-product-proofs"),
    );
    const spreadsheetV1 = tasks.find((task) => task.id === "spreadsheetbench-v1-full-official-score");
    expect(spreadsheetV1?.blockers.join(" ")).toContain("912/912 tasks");
    expect(spreadsheetV1?.blockers.join(" ")).toContain("model-run evidence");
    expect(spreadsheetV1?.blockers.join(" ")).toContain("OpenRouter proxy judges");
    expect(spreadsheetV1?.blockers.join(" ")).not.toContain("not staged");
    const spreadsheetV2 = tasks.find((task) => task.id === "spreadsheetbench-v2-full-official-score");
    expect(spreadsheetV2?.blockers.join(" ")).toContain("321 V2 tasks");
    expect(spreadsheetV2?.blockers.join(" ")).toContain("proxy judges");
    expect(tasks.find((task) => task.id === "external-adapter-local-product-proofs")?.command).toContain("benchmark:proofloop:external-adapter-live-room");
    expect(tasks.find((task) => task.id === "external-adapter-local-product-proofs")?.evidence.join(" ")).toContain("docs/eval/proofloop-external-adapter-live-room-runs");
    expect(tasks.find((task) => task.id === "external-adapter-blocker-receipts")?.command).toBe("npm run benchmark:proofloop:adapter-blockers");
    const solver = tasks.find((task) => task.id === "blocked-lane-solver");
    expect(solver?.command).toBe("npm run proofloop -- solve-blockers --goal official-scores");
    expect(solver?.evidence.join(" ")).toContain(".proofloop/lanes/spreadsheetbench-v1/blocker-analysis.json");
    const chartPack = tasks.find((task) => task.id === "proofloop-chart-pack");
    expect(chartPack?.command).toBe("npm run proofloop -- charts latest");
    expect(chartPack?.evidence.join(" ")).toContain(".proofloop/runs/latest/charts/chart-pack.json");
    expect(chartPack?.evidence.join(" ")).toContain(".proofloop/runs/latest/charts/model-performance.vl.json");
    expect(chartPack?.evidence.join(" ")).toContain("docs/eval/proofloop-charts/chart-pack.html");
    expect(chartPack?.evidence.join(" ")).toContain("docs/eval/proofloop-charts/proofloop-chart-pack.json");
    expect(chartPack?.evidence.join(" ")).toContain("docs/eval/proofloop-charts/svg/latency-cost-frontier.svg");
    expect(tasks.findIndex((task) => task.id === "blocked-lane-solver")).toBeLessThan(
      tasks.findIndex((task) => task.id === "proofloop-chart-pack"),
    );
    expect(tasks.findIndex((task) => task.id === "proofloop-chart-pack")).toBeLessThan(
      tasks.findIndex((task) => task.id === "proofloop-benchmark-board"),
    );
    for (const id of ["finch-official-score", "finauditing-official-score", "workstreambench-official-score"]) {
      const task = tasks.find((candidate) => candidate.id === id);
      expect(task?.kind).toBe("external_blocker");
      expect(task?.resumeCommand).toContain("benchmark:proofloop:adapter-blockers");
      expect(task?.blockers.join(" ")).toContain("official scorer receipt");
      expect(task?.evidence.join(" ")).toContain("docs/eval/proofloop-adapter-blockers");
      expect(task?.evidence.join(" ")).toContain("docs/eval/proofloop-external-adapter-runs");
      expect(task?.evidence.join(" ")).toContain("docs/eval/proofloop-official-scores");
      expect(task?.resumeCommand).toContain("benchmark:proofloop:harness-economics");
      expect(task?.blockers.join(" ")).not.toContain(".tmp/official-benchmarks");
    }
    const finchBlockers = tasks.find((task) => task.id === "finch-official-score")?.blockers.join(" ") ?? "";
    expect(finchBlockers).toContain("model-output artifacts are complete");
    expect(finchBlockers).toContain("upstream content_parts rendering");
    expect(finchBlockers).toContain("accepted Azure judge/scorer receipt");
    expect(tasks.find((task) => task.id === "finauditing-official-score")?.blockers.join(" ")).toContain("accepted FinMR judge path");
    expect(tasks.find((task) => task.id === "workstreambench-official-score")?.blockers.join(" ")).toContain("scorer/rubric");
    expect(tasks.find((task) => task.id === "finch-official-score")?.evidence.join(" ")).toContain("docs/eval/proofloop-official-task-bundles/finch.json");
    expect(tasks.find((task) => task.id === "finauditing-official-score")?.evidence.join(" ")).toContain("docs/eval/proofloop-official-task-bundles/finauditing.json");
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-goal-"));
  tempRoots.push(root);
  return root;
}

function commandTask(id: string, command: string): ProofloopGoalTask {
  return {
    id,
    title: id,
    kind: "command",
    command,
    required: true,
    status: "pending",
    evidence: [],
    blockers: [],
    attempts: 0,
  };
}

function blockerTask(id: string, reason: string): ProofloopGoalTask {
  return {
    id,
    title: id,
    kind: "external_blocker",
    required: true,
    status: "pending",
    evidence: ["docs/eval/official-benchmark-task-coverage.json"],
    blockers: [reason],
    resumeCommand: "npm run benchmark:official:task-coverage -- --strict",
    attempts: 0,
  };
}
