import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { stageSpreadsheetBenchBundle } from "../src/eval/spreadsheetBenchStage";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench sandbox staging", () => {
  it("stages V1 tasks with separate agent and evaluator manifests", () => {
    const source = tempRoot("source");
    const out = tempRoot("stage");
    mkdirSync(join(source, "spreadsheet", "13-1"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-1",
        instruction: "Complete the visible workbook task.",
        spreadsheet_path: "spreadsheet/13-1",
        instruction_type: "Sheet-Level Manipulation",
        answer_position: "Sheet1!B2:C3",
        answer_sheet: "Sheet1",
      },
    ]);
    touch(join(source, "spreadsheet", "13-1", "1_13-1_init.xlsx"));
    touch(join(source, "spreadsheet", "13-1", "1_13-1_answer.xlsx"));
    writeFileSync(join(source, "spreadsheet", "13-1", "prompt.txt"), "Preserve formulas.");

    const report = stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: out,
      limit: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const task = report.tasks[0];
    const agentManifest = JSON.parse(readFileSync(join(out, task.agentManifest), "utf8")) as Record<string, unknown>;
    const evaluatorManifest = JSON.parse(readFileSync(join(out, task.evaluatorManifest), "utf8")) as Record<string, unknown>;

    expect(report.isolation).toEqual({
      agentDirectoryGoldFileCount: 0,
      agentManifestGoldPathLeaks: 0,
      agentManifestScorerMetadataLeaks: 0,
      agentEvaluatorPathOverlap: false,
    });
    expect(task.agentInputFiles).toHaveLength(1);
    expect(task.agentPromptFiles).toHaveLength(1);
    expect(task.evaluatorGoldFiles).toHaveLength(1);
    expect(JSON.stringify(agentManifest).toLowerCase()).not.toContain("gold");
    expect(JSON.stringify(agentManifest).toLowerCase()).not.toContain("answer");
    expect(JSON.stringify(agentManifest)).not.toContain("answer_position");
    expect(JSON.stringify(agentManifest)).not.toContain("answerPosition");
    expect(agentManifest).toMatchObject({
      taskId: "13-1",
      track: "spreadsheetbench-v1",
      instruction: "Complete the visible workbook task.",
      inputFiles: ["inputs/01-1_13-1_init.xlsx"],
      promptFiles: ["prompts/01-prompt.txt"],
    });
    expect(evaluatorManifest).toMatchObject({
      taskId: "13-1",
      answerPosition: "Sheet1!B2:C3",
      answerSheet: "Sheet1",
      goldFiles: ["gold/01-1_13-1_answer.xlsx"],
    });
  });

  it("records skipped V2 rows while keeping staged agent files isolated", () => {
    const source = tempRoot("source");
    const out = tempRoot("stage");
    mkdirSync(join(source, "Template", "spreadsheet", "02_cash_sweep"), { recursive: true });
    writeJson(join(source, "Template", "dataset.json"), [
      {
        id: "02_01",
        instruction: "Complete the template.",
        spreadsheet_path: "spreadsheet/02_cash_sweep/02_01_input.xlsx",
        golden_response_path: "spreadsheet/02_cash_sweep/02_01_golden.xlsx",
        answer_position: "'Cash Sweep'!B4:K22",
      },
      {
        id: "02_missing",
        instruction: "Missing official fixture row.",
        spreadsheet_path: "spreadsheet/02_cash_sweep/missing_input.xlsx",
        golden_response_path: "spreadsheet/02_cash_sweep/missing_golden.xlsx",
      },
    ]);
    touch(join(source, "Template", "spreadsheet", "02_cash_sweep", "02_01_input.xlsx"));
    touch(join(source, "Template", "spreadsheet", "02_cash_sweep", "02_01_golden.xlsx"));

    const report = stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v2",
      outputRoot: out,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.scannedTaskCount).toBe(2);
    expect(report.stagedTaskCount).toBe(1);
    expect(report.skippedTaskCount).toBe(1);
    expect(report.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("Template/02_missing"),
      expect.stringContaining("skipped because input workbook or evaluator gold is missing"),
    ]));
    expect(report.isolation.agentDirectoryGoldFileCount).toBe(0);
    expect(report.isolation.agentManifestScorerMetadataLeaks).toBe(0);
  });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `noderoom-spreadsheetbench-stage-${prefix}-`));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function touch(path: string) {
  writeFileSync(path, "");
}
