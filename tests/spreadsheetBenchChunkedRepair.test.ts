import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { fingerprintSpreadsheetBenchRunSource } from "../src/eval/spreadsheetBenchRunSourceFingerprint";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench chunked receipt repair", () => {
  it("reconstructs a hash-verified receipt across model routes without another provider call", () => {
    const root = mkdtempSync(join(tmpdir(), "spreadsheetbench-repair-"));
    tempRoots.push(root);
    const stage = join(root, "stage");
    const output = join(root, "output");
    const aggregatePath = join(root, "aggregate.json");
    const taskDir = join(stage, "tasks", "task-a");
    writeJson(join(taskDir, "agent", "task.json"), { taskId: "Task/A", track: "spreadsheetbench-v2" });
    writeJson(join(taskDir, "evaluator", "evaluator.json"), { taskId: "Task/A", track: "spreadsheetbench-v2" });

    writeFile(join(output, "task-a", "candidate.xlsx"), "candidate");
    const candidateManifest = evidence(output, "task-a/candidate-manifest.json", "candidate manifest");
    const workspaceManifest = evidence(output, "task-a/agent-workspace/agent-workspace-manifest.json", "workspace manifest");
    const editPlan = evidence(output, "task-a/model-edit-plan.json", "edit plan");
    const rawOutput = evidence(output, "task-a/model-output.txt", "model output");
    const scorerReceipt = evidence(output, "task-a/score-receipt.json", "score receipt");
    const result = {
      taskId: "Task/A",
      track: "spreadsheetbench-v2",
      mode: "model-edit-plan",
      attemptIndex: 1,
      repeatIndex: 1,
      tryIndex: 1,
      taskDir: "tasks/task-a",
      agentManifest: "tasks/task-a/agent/task.json",
      evaluatorManifest: "tasks/task-a/evaluator/evaluator.json",
      candidateWorkbook: "task-a/candidate.xlsx",
      sidecarEvidence: {
        candidateManifest,
        agentWorkspaceManifest: workspaceManifest,
        editPlan: { ...editPlan, kind: "generated" },
        rawModelOutput: rawOutput,
      },
      scorerReceipt,
      score: { pass: false, scores: { overall: 0.25 } },
      model: {
        name: "original/free-route",
        requestedName: "original/free-route",
        calls: 1,
        usage: { inputTokens: 10, outputTokens: 2 },
        costUsd: 0,
      },
      timingsMs: { candidateGeneration: 1, scoring: 1, total: 2 },
      trajectory: [],
    };
    const caseRun = {
      taskId: "Task/A",
      taskDir: "tasks/task-a",
      repeatIndex: 1,
      attempts: [1],
      finalAttemptIndex: 1,
      pass: false,
      stopReason: "failed_score",
      bestOverall: 0.25,
    };
    writeJson(join(output, ".chunks", "history", "chunk-old.json"), {
      schema: 1,
      stageRoot: "stage",
      outputRoot: "output",
      mode: "model-edit-plan",
      taskOffset: 0,
      taskCount: 1,
      passCount: 0,
      averageOverall: 0.25,
      caseCount: 1,
      caseRunCount: 1,
      casePassCount: 0,
      casePassRate: 0,
      repeatCount: 1,
      attemptCount: 1,
      passRate: 0,
      retryPolicy: { maxRetries: 0, retryOn: ["candidate_generation", "scoring"], stopOnPass: true },
      retryStats: { retriedCaseRunCount: 0, retryAttemptCount: 0, passedAfterRetryCount: 0, exhaustedCaseRunCount: 0 },
      stats: { latencyMs: { p50: 2, p95: 2, max: 2 }, failureCounts: {} },
      harness: {
        toolPolicy: "agent_dir_only_until_candidate",
        evaluatorAccess: "after_candidate_emit_only",
        budget: { modelCalls: 1, inputTokens: 10, outputTokens: 2, providerCostUsd: 0 },
      },
      warnings: [],
      caseRuns: [caseRun],
      results: [result],
    });
    const sourceFingerprint = fingerprintSpreadsheetBenchRunSource(resolve("."));
    writeJson(join(output, ".chunks", "source-fingerprint.json"), {
      schema: 1,
      kind: "spreadsheetbench-run-source-fingerprint",
      generatedAt: "2026-07-15T00:00:00.000Z",
      ...sourceFingerprint,
    });

    const run = spawnSync(process.execPath, [
      resolve("node_modules", "tsx", "dist", "cli.mjs"),
      resolve("scripts", "spreadsheetbench-run-chunked.ts"),
      "--stage-root", stage,
      "--output-root", output,
      "--json-out", aggregatePath,
      "--mode", "model-edit-plan",
      "--chunk-size", "1",
      "--concurrency", "1",
      "--model", "fallback/free-route",
      "--resume",
      "--repair-missing-model-receipts",
    ], { cwd: resolve("."), encoding: "utf8" });

    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("repair archive: 1 valid task receipt(s)");
    expect(run.stdout).toContain("resumed pass=0/1");
    const aggregate = JSON.parse(readFileSync(aggregatePath, "utf8"));
    expect(aggregate).toMatchObject({ taskCount: 1, caseCount: 1 });
    expect(aggregate.harness.budget.modelCalls).toBe(1);
    expect(aggregate.results[0].model.name).toBe("original/free-route");
    expect(aggregate.results[0].sidecarEvidence.candidateManifest.sha256).toBe(candidateManifest.sha256);
  });

  it("refuses a priced repair route before provider launch without an explicit cost ceiling", () => {
    const root = mkdtempSync(join(tmpdir(), "spreadsheetbench-spend-"));
    tempRoots.push(root);
    const stage = join(root, "stage");
    const output = join(root, "output");
    const taskDir = join(stage, "tasks", "task-a");
    writeJson(join(taskDir, "agent", "task.json"), { taskId: "Task/A", track: "spreadsheetbench-v2" });
    writeJson(join(taskDir, "evaluator", "evaluator.json"), { taskId: "Task/A", track: "spreadsheetbench-v2" });

    const run = spawnSync(process.execPath, [
      resolve("node_modules", "tsx", "dist", "cli.mjs"),
      resolve("scripts", "spreadsheetbench-run-chunked.ts"),
      "--stage-root", stage,
      "--output-root", output,
      "--json-out", join(root, "aggregate.json"),
      "--mode", "model-edit-plan",
      "--chunk-size", "1",
      "--concurrency", "1",
      "--model", "gpt-5.4-nano",
      "--resume",
      "--repair-missing-model-receipts",
    ], { cwd: resolve("."), encoding: "utf8" });

    expect(run.status).not.toBe(0);
    expect(`${run.stdout}\n${run.stderr}`).toContain("Refusing paid model route gpt-5.4-nano");
  });

  it("refuses to resume legacy chunk evidence without a bound source fingerprint", () => {
    const root = mkdtempSync(join(tmpdir(), "spreadsheetbench-source-seal-"));
    tempRoots.push(root);
    const stage = join(root, "stage");
    const output = join(root, "output");
    const taskDir = join(stage, "tasks", "task-a");
    writeJson(join(taskDir, "agent", "task.json"), { taskId: "Task/A", track: "spreadsheetbench-v2" });
    writeJson(join(taskDir, "evaluator", "evaluator.json"), { taskId: "Task/A", track: "spreadsheetbench-v2" });
    writeJson(join(output, ".chunks", "chunk-001-0-1.json"), { schema: 1 });

    const run = spawnSync(process.execPath, [
      resolve("node_modules", "tsx", "dist", "cli.mjs"),
      resolve("scripts", "spreadsheetbench-run-chunked.ts"),
      "--stage-root", stage,
      "--output-root", output,
      "--json-out", join(root, "aggregate.json"),
      "--mode", "copy-input-baseline",
      "--chunk-size", "1",
      "--concurrency", "1",
      "--resume",
    ], { cwd: resolve("."), encoding: "utf8" });

    expect(run.status).not.toBe(0);
    expect(`${run.stdout}\n${run.stderr}`).toContain("resume data has no source fingerprint");
  });
});

function evidence(root: string, relativePath: string, content: string) {
  writeFile(join(root, relativePath), content);
  return {
    path: relativePath,
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: Buffer.byteLength(content),
  };
}

function writeJson(path: string, value: unknown): void {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeFile(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}
