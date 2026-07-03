import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { initProofloopGoal, type ProofloopGoalTask } from "../src/eval/proofloopGoalSupervisor";
import { proofloopOrchestratorMcpManifest } from "../src/proofloop/mcp/orchestratorManifest";
import { runProofloopOrchestrator } from "../src/proofloop/orchestrator";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("ProofLoop Orchestrator", () => {
  it("runs safe local proof tasks and writes repair packets for unfinished benchmark work", () => {
    const root = tempRoot();
    seedRepo(root);
    initProofloopGoal({
      root,
      goalId: "g",
      tasks: [
        commandTask("normalization", "npm run benchmark:proofloop:normalized"),
        blockerTask("spreadsheetbench-v1-full-official-score", "all 912 tasks need model-run evidence"),
      ],
    });

    const result = runProofloopOrchestrator({
      root,
      goalId: "g",
      runId: "test-run",
      maxSteps: 10,
      executeSafe: true,
      dryRun: false,
      generatedAt: "2026-07-03T00:00:00.000Z",
    });

    expect(result.state.tasks.find((task) => task.id === "normalization")?.status).toBe("passed");
    const spreadsheet = result.state.tasks.find((task) => task.id === "spreadsheetbench-v1-full-official-score");
    expect(spreadsheet?.status).toBe("needs_scaffold_or_run");
    expect(spreadsheet?.repairContextPath).toContain("repair-contexts/spreadsheetbench-v1-full-official-score.md");
    expect(result.state.terminalStatus).toBe("NEEDS_HUMAN_APPROVAL");

    const runDir = join(root, ".proofloop", "orchestrator", "runs", "test-run");
    expect(existsSync(join(runDir, "orchestrator-state.json"))).toBe(true);
    expect(existsSync(join(runDir, "task-queue.json"))).toBe(true);
    expect(existsSync(join(runDir, "worker-dispatch.json"))).toBe(true);
    expect(existsSync(join(runDir, "dashboard.json"))).toBe(true);
    expect(existsSync(join(runDir, "evaluator-receipt.json"))).toBe(true);
    expect(existsSync(join(runDir, "session-memory.json"))).toBe(true);
    expect(existsSync(join(root, ".proofloop", "codegraph", "graph-manifest.json"))).toBe(true);
    expect(readFileSync(join(runDir, "events.jsonl"), "utf8")).toContain("repair_context_written");
    expect(readFileSync(join(runDir, "events.jsonl"), "utf8")).toContain("long_run_control_plane_written");
    expect(readFileSync(join(runDir, "repair-contexts", "spreadsheetbench-v1-full-official-score.md"), "utf8")).toContain(
      "proofloopGoalSupervisor.ts",
    );
    expect(readFileSync(join(runDir, "repair-contexts", "spreadsheetbench-v1-full-official-score.md"), "utf8")).toContain(
      "The detached evaluator, verifier stack, dashboard, and session-mined rules decide completion",
    );

    expect(result.state.longRun.schema).toBe("proofloop-long-running-agent-v1");
    expect(result.state.longRun.goalContract.measurableExitCriteria.join(" ")).toContain("Official benchmark scores");
    expect(result.state.longRun.evaluator.sharesExecutorContext).toBe(false);
    expect(result.state.longRun.evaluator.verdict).toBe("not_done");
    expect(result.state.longRun.verifierStack.deterministic.join(" ")).toContain("benchmark:proofloop:normalized");
    expect(result.state.longRun.outerLoop.earlyStopPolicy).toBe("terminal_status_only_after_evaluator_and_verifiers");
    expect(result.state.longRun.orchestration.roles.find((role) => role.role === "planner")?.route).toMatchObject({
      id: "deepseek/deepseek-v4-pro",
      role: "planner",
    });
    expect(result.state.longRun.orchestration.roles.find((role) => role.role === "evaluator")?.route).toMatchObject({
      id: "local/deterministic",
      role: "judge",
      routePolicy: "deterministic",
    });
    expect(result.state.longRun.observability.dashboardPath).toContain("dashboard.json");
    expect(result.state.longRun.memory.minedRules.map((rule) => rule.id)).toContain("scaffold-blockers-into-runnable-receipts");

    const dashboard = JSON.parse(readFileSync(join(runDir, "dashboard.json"), "utf8")) as { schema: string; controlPlane: { schema: string } };
    expect(dashboard.schema).toBe("proofloop-orchestrator-dashboard-v1");
    expect(dashboard.controlPlane.schema).toBe("proofloop-long-running-agent-v1");
    const evaluator = JSON.parse(readFileSync(join(runDir, "evaluator-receipt.json"), "utf8")) as {
      schema: string;
      executorContextIncluded: boolean;
      evaluator: { verdict: string };
    };
    expect(evaluator.schema).toBe("proofloop-orchestrator-evaluator-v1");
    expect(evaluator.executorContextIncluded).toBe(false);
    expect(evaluator.evaluator.verdict).toBe("not_done");
    const memory = JSON.parse(readFileSync(join(runDir, "session-memory.json"), "utf8")) as {
      schema: string;
      rules: Array<{ id: string }>;
    };
    expect(memory.schema).toBe("proofloop-orchestrator-session-memory-v1");
    expect(memory.rules.map((rule) => rule.id)).toContain("proxy-judges-do-not-promote-official-scores");
  });

  it("dogfoods the official-score template without hiding the still-not-done lanes", () => {
    const root = tempRoot();
    seedRepo(root);

    const result = runProofloopOrchestrator({
      root,
      mode: "dogfood",
      goalId: "official-scores",
      template: "official-scores",
      freshTemplate: true,
      runId: "official-dogfood",
      maxSteps: 100,
      executeSafe: false,
      dryRun: true,
      generatedAt: "2026-07-03T00:00:00.000Z",
    });

    const notDoneIds = result.state.tasks.filter((task) => task.status !== "passed").map((task) => task.id);
    expect(notDoneIds).toContain("spreadsheetbench-v1-full-official-score");
    expect(notDoneIds).toContain("spreadsheetbench-v2-full-official-score");
    expect(notDoneIds).toContain("finch-official-score");
    expect(notDoneIds).toContain("finauditing-official-score");
    expect(notDoneIds).toContain("workstreambench-official-score");
    expect(result.state.dispatches.find((dispatch) => dispatch.taskId === "finch-official-score")?.promptPath).toContain(
      "finch-official-score.md",
    );
    expect(result.state.longRun.verifierStack.officialPromotionBlockedBy).toEqual(expect.arrayContaining([
      "spreadsheetbench-v1-full-official-score",
      "spreadsheetbench-v2-full-official-score",
      "finch-official-score",
      "finauditing-official-score",
      "workstreambench-official-score",
    ]));
    expect(result.state.longRun.memory.minedRules.map((rule) => rule.id)).toContain("proxy-judges-do-not-promote-official-scores");
    expect(result.state.terminalStatus).toBe("NEEDS_HUMAN_APPROVAL");
  });

  it("declares the MCP integration as a thin surface over the local orchestrator", () => {
    expect(proofloopOrchestratorMcpManifest.tools.map((tool) => tool.name)).toContain("proofloop.orchestrator.start");
    expect(proofloopOrchestratorMcpManifest.tools.map((tool) => tool.name)).toContain("proofloop.orchestrator.mineSession");
    expect(proofloopOrchestratorMcpManifest.resources.map((resource) => resource.uri)).toContain("proofloop://codegraph/latest");
    expect(proofloopOrchestratorMcpManifest.resources.map((resource) => resource.uri)).toContain("proofloop://orchestrator/latest-dashboard");
    expect(proofloopOrchestratorMcpManifest.resources.map((resource) => resource.uri)).toContain("proofloop://orchestrator/session-memory");
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-orchestrator-"));
  tempRoots.push(root);
  return root;
}

function seedRepo(root: string): void {
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: {
          "benchmark:proofloop:normalized": "node -e \"console.log('normalized proof')\"",
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(join(root, "src.ts"), "export function proofloopGoalSupervisor() { return 'ok'; }\n", "utf8");
  writeFileSync(
    join(root, "proofloopGoalSupervisor.ts"),
    "export const spreadsheetbench = 'src/eval/proofloopGoalSupervisor.ts';\n",
    "utf8",
  );
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
    evidence: [],
    blockers: [reason],
    attempts: 0,
  };
}
