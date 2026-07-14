import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildSpreadsheetBenchOfficialScoreReadiness } from "../src/eval/spreadsheetBenchOfficialScoreReadiness";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench official-score readiness gate", () => {
  it("blocks official score claims when run results are present but scorer receipts are missing", () => {
    const root = tempRoot();
    const stagePath = join(root, "stage.json");
    const runPath = join(root, "run.json");
    const routePath = join(root, "routes.json");
    writeStage(stagePath, ["task-a", "task-b"]);
    writeJson(routePath, { schema: 1, taskCount: 2 });
    writeJson(runPath, {
      schema: 1,
      mode: "model-edit-plan",
      outputRoot: "out",
      taskCount: 2,
      harness: { budget: { modelCalls: 2, inputTokens: 20, outputTokens: 10, providerCostUsd: 0 } },
      results: [
        scoredResult("task-a", 1, true),
        scoredResult("task-b", 0.5, false),
      ],
    });

    const receipt = buildSpreadsheetBenchOfficialScoreReadiness({
      track: "spreadsheetbench-v1",
      expectedTaskCount: 2,
      stageReportPath: stagePath,
      runReportPaths: [runPath],
      routeSelectionPath: routePath,
      officialScorerReceiptPath: join(root, "missing-official-scorer-receipt.json"),
      receiptRoots: [join(root, "out")],
      generatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(receipt.status).toBe("blocked");
    expect(receipt.officialScoreClaim.allowed).toBe(false);
    expect(receipt.officialScoreClaim.score).toBeUndefined();
    expect(receipt.officialModelRunClaim).toMatchObject({
      allowed: false,
      requiredTaskCount: 2,
      validTaskCount: 0,
      missingTaskCount: 2,
    });
    expect(receipt.coverage).toMatchObject({
      stagedTaskCount: 2,
      uniqueRunTaskCount: 2,
      requiredScorerReceiptCount: 2,
      validScorerReceiptCount: 0,
      missingScorerReceiptCount: 2,
    });
    expect(receipt.checkpoint).toMatchObject({
      status: "incomplete",
      nextMissingOffset: 0,
      remainingTaskCount: 2,
    });
    expect(receipt.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("0/2 required scorer receipt"),
      expect.stringContaining("2 required scorer receipt(s) are missing"),
    ]));
  });

  it("marks local proxy receipts complete without allowing an official score claim", () => {
    const root = tempRoot();
    const out = join(root, "out");
    const stagePath = join(root, "stage.json");
    const runPath = join(root, "run.json");
    const routePath = join(root, "routes.json");
    writeStage(stagePath, ["task-a", "task-b"]);
    writeJson(routePath, { schema: 1, taskCount: 2 });
    const taskAReceipt = writeScorerReceipt(out, "task-a", 1, true);
    const taskBReceipt = writeScorerReceipt(out, "task-b", 0.5, false);
    writeJson(runPath, {
      schema: 1,
      mode: "model-edit-plan",
      outputRoot: "out",
      taskCount: 2,
      harness: { budget: { modelCalls: 2, inputTokens: 20, outputTokens: 10, providerCostUsd: 0 } },
      results: [
        { ...scoredResult("task-a", 1, true), scorerReceipt: taskAReceipt },
        { ...scoredResult("task-b", 0.5, false), scorerReceipt: taskBReceipt },
      ],
    });

    const receipt = buildSpreadsheetBenchOfficialScoreReadiness({
      track: "spreadsheetbench-v1",
      expectedTaskCount: 2,
      stageReportPath: stagePath,
      runReportPaths: [runPath],
      routeSelectionPath: routePath,
      officialScorerReceiptPath: join(root, "missing-official-scorer-receipt.json"),
      receiptRoots: [out],
      generatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(receipt.status).toBe("proxy_receipts_complete");
    expect(receipt.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("accepted official scorer receipt is missing"),
    ]));
    expect(receipt.officialScoreClaim.allowed).toBe(false);
    expect(receipt.officialScoreClaim.score).toBeUndefined();
    expect(receipt.officialModelRunClaim).toMatchObject({
      allowed: false,
      validTaskCount: 0,
      missingTaskCount: 2,
    });
    expect(receipt.localProxyReceiptClaim).toMatchObject({
      allowed: true,
      score: {
        averageOverall: 0.75,
        passRate: 0.5,
        passCount: 1,
        scoredTaskCount: 2,
        source: "validated_scorer_receipts",
      },
    });
    expect(receipt.checkpoint.status).toBe("complete");
    expect(receipt.routeCostLedger).toMatchObject({
      policy: "free_local_proxy_only",
      providerCostUsd: 0,
      paidProviderCostUsd: 0,
    });
  });

  it("allows an official score only after accepted official scorer receipt import", () => {
    const root = tempRoot();
    const out = join(root, "out");
    const stagePath = join(root, "stage.json");
    const runPath = join(root, "run.json");
    const routePath = join(root, "routes.json");
    const officialReceiptPath = join(root, "official-scorer-receipt.json");
    writeStage(stagePath, ["task-a", "task-b"]);
    writeJson(routePath, { schema: 1, taskCount: 2 });
    const taskAReceipt = writeScorerReceipt(out, "task-a", 1, true);
    const taskBReceipt = writeScorerReceipt(out, "task-b", 0.5, false);
    writeOfficialScorerReceipt(officialReceiptPath, "spreadsheetbench-v1", {
      averageOverall: 0.75,
      passRate: 0.5,
      passCount: 1,
      scoredTaskCount: 2,
    });
    writeJson(runPath, {
      schema: 1,
      mode: "model-edit-plan",
      outputRoot: "out",
      taskCount: 2,
      harness: { budget: { modelCalls: 2, inputTokens: 20, outputTokens: 10, providerCostUsd: 0 } },
      results: [
        { ...modelScoredResult("task-a", 1, true), scorerReceipt: taskAReceipt },
        { ...modelScoredResult("task-b", 0.5, false), scorerReceipt: taskBReceipt },
      ],
    });

    const receipt = buildSpreadsheetBenchOfficialScoreReadiness({
      track: "spreadsheetbench-v1",
      expectedTaskCount: 2,
      stageReportPath: stagePath,
      runReportPaths: [runPath],
      routeSelectionPath: routePath,
      officialScorerReceiptPath: officialReceiptPath,
      receiptRoots: [out],
      generatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(receipt.status).toBe("official_score_ready");
    expect(receipt.blockers).toEqual([]);
    expect(receipt.officialScoreClaim).toMatchObject({
      allowed: true,
      score: {
        averageOverall: 0.75,
        passRate: 0.5,
        passCount: 1,
        scoredTaskCount: 2,
        source: "accepted_official_scorer_receipt",
      },
    });
    expect(receipt.officialModelRunClaim).toMatchObject({
      allowed: true,
      validTaskCount: 2,
      missingTaskCount: 0,
    });
    expect(receipt.localProxyReceiptClaim.allowed).toBe(true);
  });

  it("keeps copy-input receipts non-official even with an accepted scorer receipt", () => {
    const root = tempRoot();
    const out = join(root, "out");
    const stagePath = join(root, "stage.json");
    const runPath = join(root, "run.json");
    const routePath = join(root, "routes.json");
    const officialReceiptPath = join(root, "official-scorer-receipt.json");
    writeStage(stagePath, ["task-a", "task-b"]);
    writeJson(routePath, { schema: 1, taskCount: 2 });
    const taskAReceipt = writeScorerReceipt(out, "task-a", 1, true);
    const taskBReceipt = writeScorerReceipt(out, "task-b", 0.5, false);
    writeOfficialScorerReceipt(officialReceiptPath, "spreadsheetbench-v2", {
      averageOverall: 0.75,
      passRate: 0.5,
      passCount: 1,
      scoredTaskCount: 2,
    });
    writeJson(runPath, {
      schema: 1,
      mode: "copy-input-baseline",
      outputRoot: "out",
      taskCount: 2,
      harness: { budget: { modelCalls: 0, inputTokens: 0, outputTokens: 0, providerCostUsd: 0 } },
      results: [
        { ...copyInputScoredResult("task-a", 1, true), scorerReceipt: taskAReceipt },
        { ...copyInputScoredResult("task-b", 0.5, false), scorerReceipt: taskBReceipt },
      ],
    });

    const receipt = buildSpreadsheetBenchOfficialScoreReadiness({
      track: "spreadsheetbench-v2",
      expectedTaskCount: 2,
      stageReportPath: stagePath,
      runReportPaths: [runPath],
      routeSelectionPath: routePath,
      officialScorerReceiptPath: officialReceiptPath,
      receiptRoots: [out],
      generatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(receipt.status).toBe("proxy_receipts_complete");
    expect(receipt.officialScoreClaim.allowed).toBe(false);
    expect(receipt.officialModelRunClaim).toMatchObject({
      allowed: false,
      validTaskCount: 0,
      missingTaskCount: 2,
    });
    expect(receipt.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("full model-generated run receipt coverage is incomplete: 0/2"),
    ]));
  });

  it("records shard checkpoints and blocks paid-provider cost in the no-spend lane", () => {
    const root = tempRoot();
    const out = join(root, "out");
    const stagePath = join(root, "stage.json");
    const runPath = join(root, "run.json");
    const routePath = join(root, "routes.json");
    writeStage(stagePath, ["task-a", "task-b", "task-c"]);
    writeJson(routePath, { schema: 1, taskCount: 3 });
    const taskAReceipt = writeScorerReceipt(out, "task-a", 1, true);
    const taskBReceipt = writeScorerReceipt(out, "task-b", 1, true);
    writeJson(runPath, {
      schema: 1,
      mode: "model-edit-plan",
      outputRoot: "out",
      taskCount: 2,
      chunked: true,
      chunks: [
        { index: 1, offset: 0, limit: 2, reportPath: "chunk-001.json", taskCount: 2, passCount: 2, exitCode: 0 },
        { index: 2, offset: 2, limit: 1, reportPath: "chunk-002.json", taskCount: 0, passCount: 0, exitCode: 1 },
      ],
      harness: { budget: { modelCalls: 2, inputTokens: 20, outputTokens: 10, providerCostUsd: 0.25 } },
      results: [
        { ...scoredResult("task-a", 1, true), scorerReceipt: taskAReceipt, model: { name: "paid/model", calls: 1, costUsd: 0.125 } },
        { ...scoredResult("task-b", 1, true), scorerReceipt: taskBReceipt, model: { name: "paid/model", calls: 1, costUsd: 0.125 } },
      ],
    });

    const receipt = buildSpreadsheetBenchOfficialScoreReadiness({
      track: "spreadsheetbench-v2",
      expectedTaskCount: 3,
      stageReportPath: stagePath,
      runReportPaths: [runPath],
      routeSelectionPath: routePath,
      officialScorerReceiptPath: join(root, "missing-official-scorer-receipt.json"),
      receiptRoots: [out],
      generatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(receipt.status).toBe("blocked");
    expect(receipt.checkpoint).toMatchObject({
      status: "incomplete",
      nextMissingOffset: 2,
      nextMissingTaskIds: ["task-c"],
      remainingTaskCount: 1,
    });
    expect(receipt.shards).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "run-1-chunk-1", status: "complete", offset: 0, limit: 2 }),
      expect.objectContaining({ id: "run-1-chunk-2", status: "failed", offset: 2, limit: 1 }),
    ]));
    expect(receipt.routeCostLedger).toMatchObject({
      providerCostUsd: 0.25,
      paidProviderCostUsd: 0.25,
    });
    expect(receipt.officialModelRunClaim).toMatchObject({
      allowed: false,
      validTaskCount: 2,
      missingTaskCount: 1,
    });
    expect(receipt.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("only 2/3 official task(s) have run results"),
      expect.stringContaining("provider spend is $0.25"),
    ]));
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-spreadsheetbench-official-score-"));
  roots.push(root);
  return root;
}

function writeStage(path: string, taskIds: string[]) {
  writeJson(path, {
    schema: 1,
    stagedTaskCount: taskIds.length,
    tasks: taskIds.map((id) => ({ id })),
  });
}

function scoredResult(taskId: string, overall: number, pass: boolean) {
  return {
    taskId,
    mode: "model-edit-plan",
    score: {
      pass,
      scores: { overall },
    },
  };
}

function modelScoredResult(taskId: string, overall: number, pass: boolean) {
  return {
    ...scoredResult(taskId, overall, pass),
    model: {
      name: "openrouter/free-auto",
      calls: 1,
      costUsd: 0,
      usage: { inputTokens: 10, outputTokens: 5 },
    },
  };
}

function copyInputScoredResult(taskId: string, overall: number, pass: boolean) {
  return {
    ...scoredResult(taskId, overall, pass),
    mode: "copy-input-baseline",
  };
}

function writeScorerReceipt(root: string, taskId: string, overall: number, pass: boolean) {
  const relPath = `${taskId}/score-receipt.json`;
  const path = join(root, taskId, "score-receipt.json");
  const content = `${JSON.stringify({
    schema: 1,
    verifier: "spreadsheetbench_workbook_scorer",
    taskId,
    score: {
      pass,
      scores: { overall },
    },
  }, null, 2)}\n`;
  mkdirSync(join(root, taskId), { recursive: true });
  writeFileSync(path, content);
  return {
    path: relPath,
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: Buffer.byteLength(content),
  };
}

function writeOfficialScorerReceipt(
  path: string,
  track: "spreadsheetbench-v1" | "spreadsheetbench-v2",
  score: { averageOverall: number; passRate: number; passCount: number; scoredTaskCount: number },
) {
  writeJson(path, {
    schema: 1,
    verifier: "spreadsheetbench_official_scorer",
    track,
    accepted: true,
    score,
  });
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
