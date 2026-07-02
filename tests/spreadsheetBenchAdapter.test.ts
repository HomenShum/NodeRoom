import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { scanSpreadsheetBenchBundle } from "../src/eval/spreadsheetBenchAdapter";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench official bundle ingest", () => {
  it("ingests SpreadsheetBench V1 task folders without exposing golden files or scorer metadata to the agent", () => {
    const root = tempRoot();
    mkdirSync(join(root, "spreadsheet", "13-1"), { recursive: true });
    writeJson(join(root, "dataset.json"), [
      {
        id: "13-1",
        instruction: "Fill the missing revenue variance.",
        spreadsheet_path: "spreadsheet/13-1",
        instruction_type: "editing",
        answer_position: "Sheet1!C3",
        answer_sheet: "Sheet1",
        data_position: "Sheet1!A1:C5",
      },
    ]);
    touch(join(root, "spreadsheet", "13-1", "1_13-1_init.xlsx"));
    touch(join(root, "spreadsheet", "13-1", "1_13-1_answer.xlsx"));
    writeFileSync(join(root, "spreadsheet", "13-1", "prompt.txt"), "Use the workbook and preserve formulas.");

    const report = scanSpreadsheetBenchBundle(root, {
      track: "spreadsheetbench-v1",
      includeTasks: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.taskCount).toBe(1);
    expect(report.inputFileCount).toBe(1);
    expect(report.promptFileCount).toBe(1);
    expect(report.evaluatorGoldFileCount).toBe(1);
    expect(report.goldIsolation).toMatchObject({
      agentTaskGoldPathLeaks: 0,
      agentTasksExposeGold: false,
      agentTaskScorerMetadataLeaks: 0,
      agentTasksExposeScorerMetadata: false,
    });
    expect(report.tasks?.[0]?.agentTask.inputFiles).toEqual(["spreadsheet/13-1/1_13-1_init.xlsx"]);
    expect(report.tasks?.[0]?.agentTask.promptFiles).toEqual(["spreadsheet/13-1/prompt.txt"]);
    expect(report.tasks?.[0]?.evaluatorGoldFiles).toEqual(["spreadsheet/13-1/1_13-1_answer.xlsx"]);
    expect(report.tasks?.[0]?.evaluatorMetadata).toEqual({
      answerPosition: "Sheet1!C3",
      answerSheet: "Sheet1",
      dataPosition: "Sheet1!A1:C5",
    });
    expect(JSON.stringify(report.tasks?.[0]?.agentTask)).not.toContain("golden");
    expect(JSON.stringify(report.tasks?.[0]?.agentTask)).not.toContain("answer");
    expect(JSON.stringify(report.tasks?.[0]?.agentTask)).not.toContain("answerPosition");
    expect(JSON.stringify(report.tasks?.[0]?.agentTask)).not.toContain("dataPosition");
  });

  it("ingests SpreadsheetBench V2 category datasets with scoped task ids and isolated gold", () => {
    const root = tempRoot();
    mkdirSync(join(root, "Template", "spreadsheet", "02_cash_sweep"), { recursive: true });
    writeJson(join(root, "Template", "dataset.json"), [
      {
        id: "02_01",
        instruction: "Create the cash sweep schedule while preserving the template.",
        spreadsheet_path: "spreadsheet/02_cash_sweep/02_01_input.xlsx",
        golden_response_path: "spreadsheet/02_cash_sweep/02_01_golden.xlsx",
        answer_position: "'Cash Sweep'!B4:K22",
      },
    ]);
    touch(join(root, "Template", "spreadsheet", "02_cash_sweep", "02_01_input.xlsx"));
    touch(join(root, "Template", "spreadsheet", "02_cash_sweep", "02_01_golden.xlsx"));

    const report = scanSpreadsheetBenchBundle(root, {
      track: "spreadsheetbench-v2",
      includeTasks: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.taskCount).toBe(1);
    expect(report.categoryCounts).toEqual({ Template: 1 });
    expect(report.tasks?.[0]?.id).toBe("Template/02_01");
    expect(report.tasks?.[0]?.agentTask).toMatchObject({
      id: "Template/02_01",
      track: "spreadsheetbench-v2",
      category: "Template",
      inputFiles: ["Template/spreadsheet/02_cash_sweep/02_01_input.xlsx"],
      goldAvailable: true,
    });
    expect(report.tasks?.[0]?.evaluatorGoldFiles).toEqual(["Template/spreadsheet/02_cash_sweep/02_01_golden.xlsx"]);
    expect(report.tasks?.[0]?.evaluatorMetadata).toEqual({
      answerPosition: "'Cash Sweep'!B4:K22",
      answerSheet: undefined,
      dataPosition: undefined,
    });
    expect(report.goldIsolation.agentTasksExposeGold).toBe(false);
    expect(report.goldIsolation.agentTasksExposeScorerMetadata).toBe(false);
    expect(JSON.stringify(report.sampleAgentTasks)).not.toContain("golden");
    expect(JSON.stringify(report.sampleAgentTasks)).not.toContain("answerPosition");
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-spreadsheetbench-"));
  roots.push(root);
  return root;
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function touch(path: string) {
  writeFileSync(path, "");
}
