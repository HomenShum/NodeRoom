import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeProofLoopArtifacts, type ProofLoopArtifactRun } from "../src/eval/proofloopArtifacts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "proofloop-artifacts-"));
  roots.push(root);
  return root;
}

function fakeRun(outputDir: string): ProofLoopArtifactRun {
  return {
    schema: 1,
    suite: "unit-suite",
    runId: "run-001",
    generatedAt: "2026-07-01T00:00:00.000Z",
    configPath: "proofloop/unit/config.json",
    minScore: 80,
    outputDir,
    passed: false,
    score: 50,
    failReasons: ["Required step \"scenario\" fail (exit 1)", "Score 50 < minScore 80"],
    steps: [
      {
        name: "build",
        status: "pass",
        durationMs: 100,
        stdout: "built",
        stderr: "",
        exitCode: 0,
        required: true,
      },
      {
        name: "scenario",
        status: "fail",
        durationMs: 200,
        stdout: "",
        stderr: "expected output artifact was missing",
        exitCode: 1,
        required: true,
      },
    ],
  };
}

describe("writeProofLoopArtifacts", () => {
  it("writes NodeTrace v2, NodeEval, repair prompt, and trace storybook", () => {
    const outputDir = tempRoot();
    mkdirSync(join(outputDir, "screenshots"));
    writeFileSync(join(outputDir, "run-result.json"), JSON.stringify({ ok: true }), "utf-8");
    writeFileSync(join(outputDir, "trace.jsonl"), "{}\n", "utf-8");
    writeFileSync(join(outputDir, "scorecard.md"), "# scorecard\n", "utf-8");
    writeFileSync(join(outputDir, "screenshots", "failure.png"), "fake image bytes", "utf-8");

    const paths = writeProofLoopArtifacts(fakeRun(outputDir), outputDir, { baseUrl: "http://127.0.0.1:5173" });

    const nodeTrace = JSON.parse(readFileSync(paths.nodeTracePath, "utf-8"));
    expect(nodeTrace.schema).toBe(2);
    expect(nodeTrace.outerTrace.screenshots).toHaveLength(1);
    expect(nodeTrace.innerTrace.steps[1]).toMatchObject({ action: "scenario", phase: "repair" });
    expect(nodeTrace.reward.failureCategories).toContain("task_completion_failure");

    const nodeEval = JSON.parse(readFileSync(paths.nodeEvalPath, "utf-8"));
    expect(nodeEval.verifier.hardPass).toBe(false);
    expect(nodeEval.reward.total).toBeLessThan(1);

    const repairPrompt = readFileSync(paths.repairPromptPath, "utf-8");
    expect(repairPrompt).toContain("Exact Failure");
    expect(repairPrompt).toContain("expected output artifact was missing");

    const storybook = readFileSync(paths.storybookPath, "utf-8");
    expect(storybook).toContain("Trace Storybook");
    expect(storybook).toContain("trace-data");
  });
});
