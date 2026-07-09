import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCodexRepairPrompt,
  writeCodexRepairAttemptReceipt,
} from "../src/eval/proofloopCodexLoop";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Proof Loop Codex repair loop", () => {
  const meta = {
    runId: "bankertoolbench-2026-07-08",
    suite: "bankertoolbench",
    cmd: "npm run proofloop:live:btb --cockpit",
    passed: false,
    exitCode: 1,
    score: 50,
    minScore: 100,
    failedGates: ["official_fixture_upload", "artifact_reopen_validation"],
    receiptPaths: ["docs/eval/browser-receipts/bankertoolbench-live-room-proof.json"],
  };

  it("builds a bounded Codex repair prompt from a failed proof receipt", () => {
    const prompt = buildCodexRepairPrompt({
      meta,
      repairPrompt: "Repair context from node-eval.",
      attempt: 1,
      maxAttempts: 3,
    });

    expect(prompt).toContain("Do not weaken verifiers");
    expect(prompt).toContain("official_fixture_upload");
    expect(prompt).toContain("Repair context from node-eval.");
    expect(prompt).toContain("npm run proofloop -- run bankertoolbench");
  });

  it("writes a Codex repair attempt receipt next to the failed run", () => {
    const root = tempRoot();
    const runDir = join(root, ".proofloop", "runs", meta.runId);
    const path = writeCodexRepairAttemptReceipt({
      root,
      runDir,
      meta,
      repairPromptPath: join(runDir, "codex-repair-prompt.md"),
      attempt: 1,
      maxAttempts: 3,
      codexCommand: "codex exec --json",
      launched: false,
    });

    expect(existsSync(path)).toBe(true);
    const receipt = JSON.parse(readFileSync(path, "utf8"));
    expect(receipt).toMatchObject({
      schema: "proofloop-codex-repair-attempt-v1",
      failedRunId: meta.runId,
      launched: false,
      nextRunCommand: "npm run proofloop -- run bankertoolbench",
    });
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-codex-loop-"));
  tempRoots.push(root);
  return root;
}
