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
  it("continues from persisted tasks until only typed external blockers remain", () => {
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
    expect(second.task?.status).toBe("blocked_external");
    expect(second.state.status).toBe("blocked_external");
    expect(second.state.unblockedTasksRemaining).toBe(0);
    expect(second.state.blockedTasksRemaining).toBe(1);

    const gate = gateProofloopGoal("official-scores", { root });
    expect(gate.status).toBe("blocked_external");

    const goalDir = join(root, ".proofloop", "goals", "official-scores");
    expect(existsSync(join(goalDir, "state.json"))).toBe(true);
    expect(existsSync(join(goalDir, "queue.json"))).toBe(true);
    expect(JSON.parse(readFileSync(join(goalDir, "blockers.json"), "utf8"))).toHaveLength(1);
    expect(readFileSync(join(goalDir, "ledger.jsonl"), "utf8")).toContain("task_blocked_external");
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
    expect(tasks.find((task) => task.id === "external-adapter-blocker-receipts")?.command).toBe("npm run benchmark:proofloop:adapter-blockers");
    for (const id of ["finch-official-score", "finauditing-official-score", "workstreambench-official-score"]) {
      const task = tasks.find((candidate) => candidate.id === id);
      expect(task?.kind).toBe("external_blocker");
      expect(task?.resumeCommand).toContain("npm run proofloop");
      expect(task?.evidence.join(" ")).toContain("docs/eval/proofloop-adapter-blockers");
    }
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
