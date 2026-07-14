import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  devAudienceReadyGoalTasks,
  formatProofloopGoalStatus,
  gateProofloopGoal,
  initProofloopGoal,
  officialScoresGoalTasks,
  proofloopGoalBlockerChecklist,
  runNextProofloopGoalTask,
  superviseProofloopGoal,
  type ProofloopGoalTask,
} from "../src/eval/proofloopGoalSupervisor";
import {
  OFFICIAL_SCORE_PREFLIGHT_COMMAND,
  OFFICIAL_SCORE_PREFLIGHT_JSON,
} from "../src/eval/proofloopOfficialScorePreflight";

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
    expect(existsSync(join(goalDir, "blocker-checklist.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(goalDir, "blockers.json"), "utf8"))).toHaveLength(0);
    expect(JSON.parse(readFileSync(join(goalDir, "blocker-checklist.json"), "utf8"))[0]).toMatchObject({
      taskId: "spreadsheetbench-full",
      nextCommand: OFFICIAL_SCORE_PREFLIGHT_COMMAND,
    });
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
      resumeCommand: OFFICIAL_SCORE_PREFLIGHT_COMMAND,
      nextCommand: OFFICIAL_SCORE_PREFLIGHT_COMMAND,
    });
    expect(receipt.goals[0].tasks.find((task: { id: string }) => task.id === "spreadsheetbench-full").evidence).toContain(
      "docs/eval/official-benchmark-task-coverage.json",
    );
    const markdown = readFileSync(exportedMarkdownPath, "utf8");
    expect(markdown).toContain("Raw `.proofloop` stores stay gitignored");
    expect(markdown).toContain("full official bundle is not staged");
    expect(markdown).toContain("Local blocker checklist");
    expect(formatProofloopGoalStatus(gate)).toContain("Blocker checklist:");
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

  it("defines the official-score template with claimable external score commands", () => {
    const tasks = officialScoresGoalTasks();

    const preflight = tasks[0];
    expect(preflight.id).toBe("official-score-free-first-preflight");
    expect(preflight.command).toContain("free-model-gauge -- --skip-live --strict");
    expect(preflight.command).toContain("benchmark:proofloop:official-preflight -- --strict");
    expect(preflight.evidence).toContain(OFFICIAL_SCORE_PREFLIGHT_JSON);
    expect(tasks.findIndex((task) => task.id === "official-score-free-first-preflight")).toBeLessThan(
      tasks.findIndex((task) => task.id === "btb-fullsuite-official-score"),
    );
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
    expect(tasks.findIndex((task) => task.id === "official-score-free-first-preflight")).toBeLessThan(
      tasks.findIndex((task) => task.id === "external-adapter-local-product-proofs"),
    );
    const spreadsheetV1 = tasks.find((task) => task.id === "spreadsheetbench-v1-full-official-score");
    expect(spreadsheetV1?.kind).toBe("command");
    expect(spreadsheetV1?.command).toContain("spreadsheetbench-official-score-readiness.ts --track spreadsheetbench-v1");
    expect(spreadsheetV1?.blockers).toEqual([]);
    expect(spreadsheetV1?.evidence).toContain("docs/eval/spreadsheetbench-v1-official-score-readiness.json");
    const spreadsheetV2 = tasks.find((task) => task.id === "spreadsheetbench-v2-full-official-score");
    expect(spreadsheetV2?.kind).toBe("command");
    expect(spreadsheetV2?.command).toContain("spreadsheetbench-official-score-readiness.ts --track spreadsheetbench-v2");
    expect(spreadsheetV2?.blockers).toEqual([]);
    expect(spreadsheetV2?.evidence).toContain("docs/eval/spreadsheetbench-v2-official-score-readiness.json");
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
    const finchTask = tasks.find((task) => task.id === "finch-official-score");
    expect(finchTask?.kind).toBe("command");
    expect(finchTask?.command).toContain("benchmark:proofloop:adapter-blockers -- --id finch --strict");
    expect(finchTask?.blockers).toEqual([]);
    expect(finchTask?.evidence.join(" ")).toContain("docs/eval/proofloop-official-scores/finch.json");
    expect(finchTask?.evidence.join(" ")).toContain("docs/eval/proofloop-official-score-imports/finch.json");
    const finAuditingTask = tasks.find((task) => task.id === "finauditing-official-score");
    expect(finAuditingTask?.kind).toBe("command");
    expect(finAuditingTask?.command).toContain("benchmark:proofloop:adapter-blockers -- --id finauditing --strict");
    expect(finAuditingTask?.blockers).toEqual([]);
    expect(finAuditingTask?.evidence.join(" ")).toContain("docs/eval/proofloop-official-scores/finauditing.json");
    const workstreamTask = tasks.find((task) => task.id === "workstreambench-official-score");
    expect(workstreamTask?.kind).toBe("command");
    expect(workstreamTask?.command).toContain("benchmark:proofloop:adapter-blockers -- --id workstreambench --strict");
    expect(workstreamTask?.blockers).toEqual([]);
    expect(workstreamTask?.evidence.join(" ")).toContain("docs/eval/proofloop-official-scores/workstreambench.json");
    expect(tasks.find((task) => task.id === "finch-official-score")?.evidence.join(" ")).toContain("docs/eval/proofloop-official-task-bundles/finch.json");
    expect(tasks.find((task) => task.id === "finauditing-official-score")?.evidence.join(" ")).toContain("docs/eval/proofloop-official-task-bundles/finauditing.json");
  });

  it("builds a clear official-score blocker checklist with safe next commands", () => {
    const root = tempRoot();
    const state = initProofloopGoal({
      root,
      goalId: "official-scores",
      tasks: [
        blockerTask("finch-official-score", "accepted Finch scorer receipt is missing"),
      ],
    });

    const checklist = proofloopGoalBlockerChecklist(state);
    expect(checklist).toHaveLength(1);
    expect(checklist[0]).toMatchObject({
      taskId: "finch-official-score",
      nextCommand: `${OFFICIAL_SCORE_PREFLIGHT_COMMAND} && npm run benchmark:proofloop:adapter-blockers -- --id finch --strict`,
    });
    expect(formatProofloopGoalStatus(state)).toContain("next command: npm run benchmark:proofloop:official-preflight -- --strict");
  });

  it("migrates existing official-score ledgers to require preflight before known lane tasks", () => {
    const root = tempRoot();
    initProofloopGoal({
      root,
      goalId: "official-scores",
      tasks: [
        commandTask("btb-fullsuite-official-score", "node -e \"process.exit(0)\""),
        blockerTask("workstreambench-official-score", "no public official task bundle lock is staged"),
      ],
    });

    const state = gateProofloopGoal("official-scores", { root });
    expect(state.tasks[0].id).toBe("official-score-free-first-preflight");
    expect(state.tasks[0].status).toBe("pending");
    expect(state.tasks[1].id).toBe("btb-fullsuite-official-score");
    const workstream = state.tasks.find((task) => task.id === "workstreambench-official-score");
    expect(workstream?.kind).toBe("command");
    expect(workstream?.command).toContain("benchmark:proofloop:adapter-blockers -- --id workstreambench --strict");
    expect(workstream?.blockers).toEqual([]);
    expect(JSON.parse(readFileSync(join(root, ".proofloop", "goals", "official-scores", "queue.json"), "utf8"))[0].id).toBe(
      "official-score-free-first-preflight",
    );
  });

  it("defines the dev-audience-ready template as cheap setup/session/router proof", () => {
    const tasks = devAudienceReadyGoalTasks();

    expect(tasks.map((task) => task.id)).toEqual([
      "dev-doctor",
      "dev-agent-setup",
      "dev-native-session-smokes",
      "dev-free-first-router-cost-guard",
      "dev-onboarding-docs",
    ]);
    expect(tasks.every((task) => task.kind === "command")).toBe(true);
    expect(tasks.find((task) => task.id === "dev-native-session-smokes")?.command).toContain("native-smokes");
    expect(tasks.find((task) => task.id === "dev-native-session-smokes")?.title).toContain("without paid model calls");
    expect(tasks.find((task) => task.id === "dev-free-first-router-cost-guard")?.evidence.join(" ")).toContain("proofloop-free-openrouter-nodeagent-gauge");
    expect(tasks.find((task) => task.id === "dev-onboarding-docs")?.evidence.join(" ")).toContain("DEV_AUDIENCE_READY.md");

    const root = tempRoot();
    const state = initProofloopGoal({
      root,
      goalId: "dev-audience-ready",
      template: "dev-audience-ready",
      now: () => new Date("2026-07-09T00:00:00.000Z"),
    });
    expect(state.objective).toContain("intended developers and customers");
    expect(state.tasks).toHaveLength(5);
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
