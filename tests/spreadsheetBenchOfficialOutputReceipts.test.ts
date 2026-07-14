import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildSpreadsheetBenchOfficialOutputReceipts,
} from "../src/eval/spreadsheetBenchOfficialOutputReceipts";
import {
  buildSpreadsheetBenchOfficialScoreReadiness,
} from "../src/eval/spreadsheetBenchOfficialScoreReadiness";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench official local/proxy output receipts", () => {
  it("builds candidate output receipts and keeps official score claims blocked", () => {
    const root = tempRoot();
    const stageRoot = join(root, "stage");
    const outputRoot = join(root, "out");
    const stageReportPath = join(root, "stage-report.json");
    const outputReportPath = join(root, "output-receipts.json");
    const routePath = join(root, "routes.json");
    mkdirSync(join(stageRoot, "tasks", "task-a", "agent", "inputs"), { recursive: true });
    writeFileSync(join(stageRoot, "tasks", "task-a", "agent", "inputs", "input.xlsx"), "fake workbook");
    writeJson(stageReportPath, {
      schema: 1,
      stagedTaskCount: 1,
      tasks: [{
        id: "task-a",
        taskDir: "tasks/task-a",
        agentManifest: "tasks/task-a/agent/task.json",
        evaluatorManifest: "tasks/task-a/evaluator/evaluator.json",
        agentInputFiles: ["tasks/task-a/agent/inputs/input.xlsx"],
      }],
    });
    writeJson(routePath, { schema: 1, taskCount: 1 });

    const report = buildSpreadsheetBenchOfficialOutputReceipts({
      track: "spreadsheetbench-v1",
      stageRoot,
      stageReportPath,
      outputRoot,
      clean: true,
      generatedAt: "2026-07-09T00:00:00.000Z",
    });
    writeJson(outputReportPath, report);

    expect(report).toMatchObject({
      verifier: "spreadsheetbench_local_proxy_output_scaffold",
      expectedTaskCount: 1,
      coverage: {
        outputReceiptCount: 1,
        candidateWorkbookCount: 1,
        missingInputCount: 0,
      },
      officialScoreClaim: {
        allowed: false,
      },
      routeCostLedger: {
        providerCostUsd: 0,
        paidProviderCostUsd: 0,
      },
    });
    expect(report.receipts[0].receipt).toMatchObject({
      path: "task-a/local-proxy-output-receipt.json",
    });

    const readiness = buildSpreadsheetBenchOfficialScoreReadiness({
      track: "spreadsheetbench-v1",
      expectedTaskCount: 1,
      stageReportPath,
      runReportPaths: [],
      routeSelectionPath: routePath,
      outputReceiptReportPath: outputReportPath,
      officialScorerReceiptPath: join(root, "missing-official-scorer-receipt.json"),
      receiptRoots: [outputRoot],
      generatedAt: "2026-07-09T00:00:00.000Z",
    });

    expect(readiness.status).toBe("proxy_outputs_complete");
    expect(readiness.localProxyOutputClaim).toMatchObject({
      allowed: true,
      receiptCount: 1,
    });
    expect(readiness.localProxyReceiptClaim.allowed).toBe(false);
    expect(readiness.officialScoreClaim.allowed).toBe(false);
    expect(readiness.coverage).toMatchObject({
      validOutputReceiptCount: 1,
      missingOutputReceiptCount: 0,
      invalidOutputReceiptCount: 0,
    });
    expect(readiness.blockers).toEqual(expect.arrayContaining([
      expect.stringContaining("accepted official scorer receipt is missing"),
    ]));
  });
});

function tempRoot(): string {
  const base = join(process.cwd(), ".tmp", "tests");
  mkdirSync(base, { recursive: true });
  const root = mkdtempSync(join(base, "noderoom-spreadsheetbench-output-receipts-"));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
