import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeCodexRelaunchPacket } from "../src/eval/proofloopCodexRelaunch";
import type { ProofloopMetaForLoop } from "../src/eval/proofloopLoopArtifacts";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("ProofLoop Codex relaunch artifacts", () => {
  it("writes a failed-run packet and reprompt from ProofLoop receipts", () => {
    const root = tempRoot();
    const runDir = join(root, ".proofloop", "runs", "finch-001");
    const repairPromptPath = join(runDir, "repair-prompt.md");
    mkdirSync(runDir, { recursive: true });
    writeFileSync(repairPromptPath, "# Repair\n\nFix the verifier-visible upload path.\n", "utf8");

    const meta: ProofloopMetaForLoop = {
      runId: "finch-001",
      suite: "finch",
      cmd: "npm run benchmark:proofloop:external-adapter-live-room -- --id finch --prod --user-emulation strict",
      startedAt: "2026-07-08T00:00:00.000Z",
      finishedAt: "2026-07-08T00:01:00.000Z",
      durationMs: 60_000,
      exitCode: 1,
      passed: false,
      failedGates: ["visual_browser_proof_captured"],
      receiptPaths: ["docs/eval/proofloop-external-adapter-live-room-runs/finch.json"],
    };

    const result = writeCodexRelaunchPacket({ root, runDir, meta, repairPromptPath });

    expect(result.wrote).toBe(true);
    expect(existsSync(result.packetPath)).toBe(true);
    expect(existsSync(result.promptPath)).toBe(true);
    const packet = JSON.parse(readFileSync(result.packetPath, "utf8"));
    expect(packet).toMatchObject({
      schema: "proofloop-codex-relaunch-v1",
      runId: "finch-001",
      suite: "finch",
      passed: false,
      failure: { exitCode: 1, failedGates: ["visual_browser_proof_captured"] },
      commands: {
        repair: "npm run proofloop -- repair finch-001",
        codexReprompt: "npm run proofloop -- codex reprompt finch-001",
        installCodexHooks: "npm run proofloop -- hooks install --worker codex --local",
      },
    });
    expect(packet.receipts.repairPrompt).toBe(".proofloop/runs/finch-001/repair-prompt.md");
    expect(readFileSync(result.promptPath, "utf8")).toContain("Do not claim the work is done until the deterministic gate or proof receipt passes.");
  });

  it("does not write relaunch artifacts for passing runs unless forced", () => {
    const root = tempRoot();
    const runDir = join(root, ".proofloop", "runs", "finch-002");
    const meta: ProofloopMetaForLoop = {
      runId: "finch-002",
      suite: "finch",
      cmd: "npm run proofloop -- run finch",
      startedAt: "2026-07-08T00:00:00.000Z",
      finishedAt: "2026-07-08T00:01:00.000Z",
      durationMs: 60_000,
      exitCode: 0,
      passed: true,
      receiptPaths: [],
    };

    const result = writeCodexRelaunchPacket({ root, runDir, meta, repairPromptPath: join(runDir, "repair-prompt.md") });

    expect(result.wrote).toBe(false);
    expect(existsSync(result.packetPath)).toBe(false);
    expect(existsSync(result.promptPath)).toBe(false);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-codex-relaunch-"));
  tempRoots.push(root);
  return root;
}
