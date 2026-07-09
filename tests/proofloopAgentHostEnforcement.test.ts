import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectNativeAgentSession,
  launchNativeAgentHost,
  parseProofloopNativeAgentHostId,
  verifyNativeAgentEnforcement,
} from "../src/eval/proofloopAgentHostEnforcement";
import { initProofloopGoal, type ProofloopGoalTask } from "../src/eval/proofloopGoalSupervisor";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ProofLoop native agent host enforcement", () => {
  it("launches a Devin CLI-style worker, collects ATIF evidence, and verifies against the gate", () => {
    const root = tempRoot();
    const promptPath = join(root, "repair-prompt.md");
    const workerPath = join(root, "fake-devin-worker.mjs");
    write(promptPath, "Fix the failing ProofLoop receipt.\n");
    write(workerPath, fakeWorkerSource());

    const launch = launchNativeAgentHost({
      root,
      hostId: "devin-cli",
      promptPath,
      generatedAt: "2026-07-09T00:00:00.000Z",
      command: `node "${workerPath}" --prompt-file {promptPath} --export {exportPath}`,
    });

    expect(launch.status).toBe("launch_ready");
    expect(launch.exportPath).toBe(".proofloop/agents/native/devin-cli-2026-07-09T00-00-00-000Z/devin-cli-session.atif.json");
    expect(launch.exportPath && existsSync(join(root, launch.exportPath))).toBe(true);
    expect(readFileSync(join(root, launch.stdoutPath ?? ""), "utf8")).toContain("fake worker completed");

    const collected = collectNativeAgentSession({
      root,
      hostId: "devin-cli",
      runDir: launch.runDir,
      generatedAt: "2026-07-09T00:00:01.000Z",
    });
    expect(collected.status).toBe("trace_ready");
    expect(collected.evidenceFiles).toEqual(expect.arrayContaining([
      launch.exportPath,
      launch.stdoutPath,
      launch.stderrPath,
    ]));

    initPassedGoal(root, "native-ready");
    const verified = verifyNativeAgentEnforcement({
      root,
      hostId: "devin-cli",
      runDir: launch.runDir,
      goalId: "native-ready",
      generatedAt: "2026-07-09T00:00:02.000Z",
    });

    expect(verified.status).toBe("ready");
    expect(verified.checks.map((check) => check.status)).toEqual(["pass", "pass", "pass"]);
  });

  it("fails closed when Cursor CLI is not installed", () => {
    const root = tempRoot();
    const promptPath = join(root, "repair-prompt.md");
    write(promptPath, "Fix the failing ProofLoop receipt.\n");

    const launch = launchNativeAgentHost({
      root,
      hostId: "cursor",
      promptPath,
      generatedAt: "2026-07-09T00:00:00.000Z",
      env: {},
    });

    expect(launch.status).toBe("failed");
    expect(launch.command).toContain("proofloop-cursor-launch.mjs");
    expect(readFileSync(join(root, launch.stderrPath ?? ""), "utf8")).toContain("Cursor CLI not found");
    const verified = verifyNativeAgentEnforcement({
      root,
      hostId: "cursor",
      runDir: launch.runDir,
      goalId: "missing-goal",
    });
    expect(verified.status).toBe("needs_launch");
    expect(verified.checks[0]).toMatchObject({ id: "launch", status: "fail" });
  });

  it("launches hosted Devin API in dry-run mode and captures the session id", () => {
    const root = tempRoot();
    const promptPath = join(root, "repair-prompt.md");
    write(promptPath, "Fix the failing ProofLoop receipt.\n");

    const launch = launchNativeAgentHost({
      root,
      hostId: "devin-api",
      promptPath,
      generatedAt: "2026-07-09T00:00:00.000Z",
      env: { PROOFLOOP_DEVIN_API_DRY_RUN: "1" },
    });

    expect(launch.status).toBe("launch_ready");
    expect(launch.command).toContain("proofloop-devin-api-launch.mjs");
    expect(launch.sessionId).toBe("dry-run-devin-session");
    expect(readFileSync(join(root, launch.exportPath ?? ""), "utf8")).toContain("proofloop-devin-api-session-export-v1");
  });

  it("launches local Devin CLI through the repository wrapper in dry-run mode", () => {
    const root = tempRoot();
    const promptPath = join(root, "repair-prompt.md");
    write(promptPath, "Fix the failing ProofLoop receipt.\n");

    const launch = launchNativeAgentHost({
      root,
      hostId: "devin-cli",
      promptPath,
      generatedAt: "2026-07-09T00:00:00.000Z",
      env: { PROOFLOOP_DEVIN_CLI_DRY_RUN: "1" },
    });

    expect(launch.status).toBe("launch_ready");
    expect(launch.command).toContain("proofloop-devin-cli-launch.py");
    expect(readFileSync(join(root, launch.exportPath ?? ""), "utf8")).toContain("proofloop-devin-cli-session-export-v1");
    expect(readFileSync(join(root, launch.stdoutPath ?? ""), "utf8")).toContain("dry-run Devin CLI session");
  });

  it("collects a Windsurf Cascade transcript as session evidence", () => {
    const root = tempRoot();
    const transcriptPath = join(root, "cascade-transcript.jsonl");
    write(transcriptPath, `${JSON.stringify({ type: "assistant", status: "completed", text: "used proofloop MCP" })}\n`);

    const collected = collectNativeAgentSession({
      root,
      hostId: "windsurf",
      runDir: ".proofloop/agents/native/windsurf-fixture",
      sessionPath: transcriptPath,
      sessionId: "cascade-001",
      generatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(collected.status).toBe("trace_ready");
    expect(collected.sessionId).toBe("cascade-001");
    expect(collected.sessionPath).toBe(".proofloop/agents/native/windsurf-fixture/windsurf-session-export.jsonl");
    expect(readFileSync(join(root, collected.sessionPath ?? ""), "utf8")).toContain("used proofloop MCP");
  });

  it("parses native host ids including Devin CLI and Devin API", () => {
    expect(parseProofloopNativeAgentHostId("devin-cli")).toBe("devin-cli");
    expect(parseProofloopNativeAgentHostId("devin-api")).toBe("devin-api");
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-native-agent-"));
  tempRoots.push(root);
  return root;
}

function write(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function initPassedGoal(root: string, goalId: string): void {
  const task: ProofloopGoalTask = {
    id: "native-agent-ready",
    title: "Native agent enforcement ready",
    kind: "command",
    command: "true",
    required: true,
    status: "passed",
    evidence: [".proofloop/agents/native/devin-cli-2026-07-09T00-00-00-000Z/devin-cli-native-verify.json"],
    blockers: [],
    attempts: 1,
    startedAt: "2026-07-09T00:00:00.000Z",
    finishedAt: "2026-07-09T00:00:00.000Z",
  };
  initProofloopGoal({
    root,
    goalId,
    objective: "Test native agent enforcement",
    tasks: [task],
    overwrite: true,
    now: () => new Date("2026-07-09T00:00:00.000Z"),
  });
}

function fakeWorkerSource(): string {
  return [
    "import { readFileSync, writeFileSync } from 'node:fs';",
    "const args = process.argv.slice(2);",
    "const promptPath = args[args.indexOf('--prompt-file') + 1];",
    "const exportPath = args[args.indexOf('--export') + 1];",
    "const prompt = readFileSync(promptPath, 'utf8');",
    "writeFileSync(exportPath, JSON.stringify({ schema: 'atif-v1', prompt, steps: [{ type: 'tool', name: 'proofloop_manifest' }] }, null, 2));",
    "console.log('fake worker completed');",
  ].join("\n");
}
