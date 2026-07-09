import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildAgentRepairPrompt,
  collectProofloopAgentTrace,
  launchProofloopAgentAdapter,
  setupProofloopAgentAdapter,
  writeAgentRepairAttemptReceipt,
  type AgentRunResult,
  type ProofloopVerdict,
} from "../src/eval/proofloopAgentAdapters";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ProofLoop agent adapters", () => {
  const verdict: ProofloopVerdict = {
    runId: "bankertoolbench-001",
    suite: "bankertoolbench",
    cmd: "npm run proofloop -- run bankertoolbench",
    passed: false,
    exitCode: 1,
    score: 50,
    minScore: 100,
    failedGates: ["artifact_reopen_validation"],
    receiptPaths: ["docs/eval/browser-receipts/bankertoolbench-live-room-proof.json"],
  };

  it("sets up Codex hooks and writes an agent adapter receipt", async () => {
    const root = tempRoot();

    const receipt = await setupProofloopAgentAdapter({
      adapterId: "codex",
      root,
      local: true,
      generatedAt: "2026-07-08T00:00:00.000Z",
    });

    expect(receipt).toMatchObject({
      schema: "proofloop-agent-adapter-setup-v1",
      adapterId: "codex",
      status: "ready",
      hookHost: "codex",
    });
    expect(existsSync(join(root, ".codex", "hooks.local.json"))).toBe(true);
    expect(existsSync(join(root, ".proofloop", "setup", "agents", "codex.json"))).toBe(true);
    expect(receipt.setupPackPath).toBe(".proofloop/setup/agents/codex-setup-pack.md");
    expect(receipt.mcpConfigPath).toBe(".proofloop/mcp/proofloop-mcp.json");
    expect(receipt.providerSetupCommands).toContain("npm run proofloop -- providers setup nebius");
    expect(receipt.proofCommands).toContain("npm run proofloop -- setup finch --doctor");
    expect(existsSync(join(root, receipt.setupPackPath))).toBe(true);
    expect(JSON.parse(readFileSync(join(root, receipt.mcpConfigPath), "utf8"))).toMatchObject({
      schema: "proofloop-mcp-bridge-config-v1",
      status: "ready",
      servers: {
        proofloop: {
          command: "node",
          args: ["scripts/proofloop.mjs", "mcp", "serve"],
        },
      },
    });
  });

  it("sets up Cursor with the native launcher command while leaving runtime proof to receipts", async () => {
    const root = tempRoot();

    const receipt = await setupProofloopAgentAdapter({
      adapterId: "cursor",
      root,
      generatedAt: "2026-07-08T00:00:00.000Z",
    });

    expect(receipt.status).toBe("ready");
    expect(receipt.launchCommand).toBe("npm run proofloop -- agents launch cursor --prompt {promptPath}");
    expect(receipt.gateEnforcement.join(" ")).toContain("native launch receipt");
    expect(receipt.setupPackPath).toBe(".proofloop/setup/agents/cursor-setup-pack.md");
    expect(receipt.instructionPaths).toEqual([".cursor/rules/proofloop.mdc"]);
    expect(readFileSync(join(root, ".proofloop", "setup", "agents", "cursor.json"), "utf8")).toContain("ProofLoop native launch receipt");
    expect(readFileSync(join(root, ".cursor", "rules", "proofloop.mdc"), "utf8")).toContain("proofloop-cursor-launch.mjs");
    const setupPack = readFileSync(join(root, receipt.setupPackPath), "utf8");
    expect(setupPack).toContain("Strict-ready: yes");
    expect(setupPack).toContain("runtime readiness is still proven by launch/collect/verify receipts");
    expect(setupPack).toContain("npm run proofloop -- providers setup all");
    expect(setupPack).toContain("npm run proofloop -- setup workstreambench --doctor");
    expect(setupPack).toContain("MCP bridge config");
  });

  it("keeps Windsurf marked as needing a non-interactive launcher unless one is configured", async () => {
    const root = tempRoot();

    const receipt = await setupProofloopAgentAdapter({
      adapterId: "windsurf",
      root,
      generatedAt: "2026-07-08T00:00:00.000Z",
    });

    expect(receipt.status).toBe("needs_adapter");
    expect(receipt.gateEnforcement.join(" ")).toContain("adapter-required");
    expect(receipt.instructionPaths).toEqual([".windsurf/rules/proofloop.md"]);
  });

  it("writes Devin handoff docs with the hosted API native launcher ready", async () => {
    const root = tempRoot();

    const receipt = await setupProofloopAgentAdapter({
      adapterId: "devin",
      root,
      generatedAt: "2026-07-08T00:00:00.000Z",
    });

    expect(receipt.status).toBe("ready");
    expect(receipt.launchCommand).toBe("npm run proofloop -- agents launch devin-api --prompt {promptPath}");
    expect(receipt.instructionPaths).toEqual(["docs/agents/devin-proofloop.md"]);
    expect(receipt.providerSetupCommands).toEqual(expect.arrayContaining([
      "npm run proofloop -- providers setup daytona",
      "npm run proofloop -- providers setup opsera",
    ]));
    expect(readFileSync(join(root, "docs", "agents", "devin-proofloop.md"), "utf8")).toContain("proofloop-devin-api-launch.mjs");
    expect(readFileSync(join(root, receipt.setupPackPath), "utf8")).toContain("agents launch devin-api");
    expect(readFileSync(join(root, receipt.setupPackPath), "utf8")).toContain("official-score claims require");
  });

  it("builds generic repair prompts and attempt receipts", () => {
    const root = tempRoot();
    const runDir = join(root, ".proofloop", "runs", verdict.runId);
    const promptPath = join(runDir, "generic-cli-repair-prompt.md");
    const prompt = buildAgentRepairPrompt({
      adapterId: "generic-cli",
      verdict,
      repairPrompt: "NodeEval says the exported artifact did not reopen.",
      attempt: 1,
      maxAttempts: 2,
    });
    expect(prompt).toContain("Adapter: generic-cli");
    expect(prompt).toContain("Do not weaken verifiers");
    expect(prompt).toContain("artifact_reopen_validation");

    const runResult: AgentRunResult = {
      adapterId: "generic-cli",
      status: "needs_command",
      launched: false,
      promptPath: ".proofloop/runs/bankertoolbench-001/generic-cli-repair-prompt.md",
      message: "dry run",
    };
    const receiptPath = writeAgentRepairAttemptReceipt({
      root,
      runDir,
      adapterId: "generic-cli",
      meta: verdict,
      repairPromptPath: promptPath,
      attempt: 1,
      maxAttempts: 2,
      runResult,
    });
    expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toMatchObject({
      schema: "proofloop-agent-repair-attempt-v1",
      adapterId: "generic-cli",
      failedRunId: verdict.runId,
      runResult: { status: "needs_command" },
    });
  });

  it("runs generic-cli through the Cursor bridge contract and collects trace evidence", () => {
    const root = tempRoot();
    const runDir = join(root, ".proofloop", "runs", verdict.runId);
    const promptPath = join(runDir, "generic-cli-repair-prompt.md");
    const workerPath = join(root, "fake-generic-worker.mjs");
    const bridgePath = join(process.cwd(), "scripts", "proofloop-generic-cursor-bridge.mjs");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(promptPath, "Repair without changing verifier thresholds.\n", "utf8");
    writeFileSync(workerPath, fakeGenericWorkerSource(), "utf8");

    const result = launchProofloopAgentAdapter({
      adapterId: "generic-cli",
      promptPath,
      targetDir: root,
      command: `node "${bridgePath}"`,
      env: {
        ...process.env,
        PROOFLOOP_GENERIC_BRIDGE_COMMAND: `node "${workerPath}"`,
      },
    });

    expect(result.status).toBe("launched");
    expect(readFileSync(join(root, result.stdoutPath ?? ""), "utf8")).toContain("generic bridge received verifier prompt");
    expect(readFileSync(join(runDir, "generic-cli-trace.json"), "utf8")).toContain("proofloop-generic-cli-bridge-trace-v1");

    const trace = collectProofloopAgentTrace({ adapterId: "generic-cli", runDir, root });
    expect(trace.evidenceFiles).toEqual(expect.arrayContaining([
      ".proofloop/runs/bankertoolbench-001/generic-cli-trace.json",
      ".proofloop/runs/bankertoolbench-001/generic-cli-stdout.log",
      ".proofloop/runs/bankertoolbench-001/generic-cli-stderr.log",
    ]));
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-agent-adapter-"));
  tempRoots.push(root);
  return root;
}

function fakeGenericWorkerSource(): string {
  return [
    "import { readFileSync } from 'node:fs';",
    "const prompt = readFileSync(0, 'utf8');",
    "if (!prompt.includes('verifier')) process.exit(3);",
    "console.log('generic bridge received verifier prompt');",
  ].join("\n");
}
