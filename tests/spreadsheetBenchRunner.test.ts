import ExcelJS from "exceljs";
import JSZip from "jszip";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { stageSpreadsheetBenchBundle } from "../src/eval/spreadsheetBenchStage";
import { runStagedSpreadsheetBench } from "../src/eval/spreadsheetBenchRunner";
import type { AgentModel } from "../src/nodeagent/core/types";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench staged runner", () => {
  it("emits a candidate workbook from the agent directory before scoring with evaluator-only gold", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-1"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-1",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-1",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
    ]);
    await writeWorkbook(join(source, "spreadsheet", "13-1", "1_13-1_init.xlsx"), 1);
    await writeWorkbook(join(source, "spreadsheet", "13-1", "1_13-1_golden.xlsx"), 2);
    writeFileSync(join(source, "spreadsheet", "13-1", "prompt.txt"), "Use only the workbook and prompt.");
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "copy-input-baseline",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({
      mode: "copy-input-baseline",
      taskCount: 1,
      caseCount: 1,
      repeatCount: 1,
      attemptCount: 1,
      passCount: 0,
      passRate: 0,
      harness: {
        toolPolicy: "agent_dir_only_until_candidate",
        evaluatorAccess: "after_candidate_emit_only",
        budget: { modelCalls: 0, providerCostUsd: 0 },
      },
    });
    const result = report.results[0];
    expect(result.trajectory.map((step) => step.step)).toEqual([
      "read_agent_manifest",
      "prepare_agent_workspace",
      "emit_candidate_workbook",
      "read_evaluator_manifest",
      "score_candidate",
    ]);
    expect(result.score).toBeDefined();
    expect(result.candidateWorkbook).toBeDefined();
    expect(result.score!.pass).toBe(false);
    expect(result.score!.mismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "value", sheet: "Sheet1", cell: "B2", expected: "2", actual: "1" }),
    ]));
    expect(existsSync(join(out, result.candidateWorkbook!))).toBe(true);
    expectSidecarFile(result.scorerReceipt, "13-1/score-receipt.json");
    expectSidecarFile(result.sidecarEvidence?.candidateManifest, "13-1/candidate-manifest.json");
    expectSidecarFile(result.sidecarEvidence?.agentWorkspaceManifest, "13-1/agent-workspace/agent-workspace-manifest.json");
    expect(result.sidecarEvidence?.editPlan).toBeUndefined();
    expect(result.sidecarEvidence?.rawModelOutput).toBeUndefined();
    const candidateManifest = readFileSync(join(out, "13-1", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("agentWorkspaceManifest");
    expect(candidateManifest.toLowerCase()).not.toContain("gold");
    expect(candidateManifest).not.toContain("evaluator");
    const workspaceManifest = JSON.parse(readFileSync(join(out, "13-1", "agent-workspace", "agent-workspace-manifest.json"), "utf8"));
    expect(workspaceManifest.boundary).toBe("agent_visible_files_only");
    expect(workspaceManifest.copiedFiles.map((file: { role: string }) => file.role)).toEqual(expect.arrayContaining(["manifest", "input", "prompt"]));
    expect(JSON.stringify(workspaceManifest).toLowerCase()).not.toContain("gold");
    expect(JSON.stringify(workspaceManifest)).not.toContain("evaluator");
  });

  it("can run an offset-limited slice for chunked full-bundle execution", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    for (const id of ["01", "02", "03"]) {
      mkdirSync(join(source, "spreadsheet", id), { recursive: true });
      await writeWorkbook(join(source, "spreadsheet", id, `1_${id}_init.xlsx`), Number(id));
      await writeWorkbook(join(source, "spreadsheet", id, `1_${id}_golden.xlsx`), Number(id));
    }
    writeJson(join(source, "dataset.json"), ["01", "02", "03"].map((id) => ({
      id,
      instruction: `Keep task ${id} unchanged.`,
      spreadsheet_path: `spreadsheet/${id}`,
      answer_position: "Sheet1!B2:B2",
      answer_sheet: "Sheet1",
    })));
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "copy-input-baseline",
      offset: 1,
      limit: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.taskOffset).toBe(1);
    expect(report.taskCount).toBe(1);
    expect(report.caseCount).toBe(1);
    expect(report.results[0].taskId).toBe("02");
    expect(report.passCount).toBe(1);
  });

  it("applies an agent-side edit plan before opening evaluator-only gold", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-2"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-2",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-2",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
    ]);
    await writeWorkbook(join(source, "spreadsheet", "13-2", "1_13-2_init.xlsx"), 1);
    await writeWorkbook(join(source, "spreadsheet", "13-2", "1_13-2_golden.xlsx"), 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "13-2", "agent", "edit-plan.json"), {
      schema: 1,
      operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }],
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-patch",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({
      mode: "apply-agent-patch",
      taskCount: 1,
      caseCount: 1,
      repeatCount: 1,
      attemptCount: 1,
      passCount: 1,
      passRate: 1,
      averageOverall: 1,
      harness: {
        toolPolicy: "agent_dir_only_until_candidate",
        evaluatorAccess: "after_candidate_emit_only",
        budget: { modelCalls: 0, providerCostUsd: 0 },
      },
    });
    const result = report.results[0];
    expect(result.trajectory.map((step) => step.step)).toEqual([
      "read_agent_manifest",
      "prepare_agent_workspace",
      "read_agent_edit_plan",
      "emit_candidate_workbook",
      "read_evaluator_manifest",
      "score_candidate",
    ]);
    expect(result.score).toBeDefined();
    expect(result.score!.pass).toBe(true);
    expectSidecarFile(result.scorerReceipt, "13-2/score-receipt.json");
    expectSidecarFile(result.sidecarEvidence?.candidateManifest, "13-2/candidate-manifest.json");
    expectSidecarFile(result.sidecarEvidence?.agentWorkspaceManifest, "13-2/agent-workspace/agent-workspace-manifest.json");
    expectSidecarFile(result.sidecarEvidence?.editPlan, "13-2/agent-workspace/agent/edit-plan.json");
    expect(result.sidecarEvidence?.editPlan?.kind).toBe("source");
    expect(result.sidecarEvidence?.formulaResultPolicy).toBe("deterministic_local_subset");
    expect(result.sidecarEvidence?.supportedFormulaFunctions).toEqual(expect.arrayContaining(["SUM", "IFERROR", "COUNTIF"]));
    expect(result.sidecarEvidence?.appliedOperationCount).toBe(1);
    const candidateManifest = readFileSync(join(out, "13-2", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("apply-agent-patch");
    expect(candidateManifest).toContain("agentWorkspaceManifest");
    expect(candidateManifest.toLowerCase()).not.toContain("gold");
    expect(candidateManifest).not.toContain("evaluator");
    expect(existsSync(join(out, "13-2", "agent-workspace", "agent", "edit-plan.json"))).toBe(true);
  });

  it("applies formula-looking values as formulas and preserves cells for format-only operations", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-10"), { recursive: true });
    await writeFormulaSemanticsWorkbook(join(source, "spreadsheet", "13-10", "1_13-10_init.xlsx"), false);
    await writeFormulaSemanticsWorkbook(join(source, "spreadsheet", "13-10", "1_13-10_golden.xlsx"), true);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-10",
        instruction: "Write the formula in B2 and format C2.",
        spreadsheet_path: "spreadsheet/13-10",
        answer_position: "Sheet1!B2:C2",
        answer_sheet: "Sheet1",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "13-10", "agent", "edit-plan.json"), {
      schema: 1,
      operations: [
        { sheet: "Sheet1", cell: "B2", value: "=SUM(A2:A3)" },
        { sheet: "Sheet1", cell: "C2", numFmt: "#,##0.00" },
      ],
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-patch",
      clean: true,
      compareStyles: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    const candidate = new ExcelJS.Workbook();
    await candidate.xlsx.readFile(join(out, report.results[0].candidateWorkbook!));
    const sheet = candidate.getWorksheet("Sheet1")!;
    expect(sheet.getCell("B2").value).toMatchObject({ formula: "SUM(A2:A3)" });
    expect(sheet.getCell("C2").value).toBe(7);
    expect(sheet.getCell("C2").numFmt).toBe("#,##0.00");
  });

  it("creates a real XLSX chart object through a bounded add_chart operation", async () => {
    const source = tempRoot("chart-source");
    const stage = tempRoot("chart-stage");
    const out = tempRoot("chart-out");
    mkdirSync(join(source, "spreadsheet", "chart-1"), { recursive: true });
    await writeChartDataWorkbook(join(source, "spreadsheet", "chart-1", "1_chart-1_init.xlsx"));
    await writeChartDataWorkbook(join(source, "spreadsheet", "chart-1", "1_chart-1_golden.xlsx"));
    writeJson(join(source, "dataset.json"), [{
      id: "chart-1",
      instruction: "Create a line chart titled 'Revenue Trend' from Month and Revenue on the Data sheet.",
      spreadsheet_path: "spreadsheet/chart-1",
      answer_position: "Data!A1:B4",
      answer_sheet: "Data",
    }]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "chart-aware-planner",
      async next() {
        return {
          text: JSON.stringify({
            schema: 1,
            operations: [{
              op: "add_chart",
              sheet: "Data",
              chartType: "line",
              title: "Revenue Trend",
              categoryRange: "'Data'!A2:A4",
              series: [{ name: "Revenue", valuesRange: "'Data'!B2:B4", color: "2563EB" }],
              anchor: "D2",
              legendPosition: "bottom",
              dataLabels: true,
            }],
          }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 80, outputTokens: 30 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      compareCharts: true,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.results[0].error).toBeUndefined();
    expect(report.results[0].sidecarEvidence?.appliedOperationCount).toBe(1);
    expect(report.results[0].score?.chartPackage?.totals.candidateChartParts).toBeGreaterThan(0);
    const candidate = readFileSync(join(out, report.results[0].candidateWorkbook!));
    const zip = await JSZip.loadAsync(candidate);
    expect(Object.keys(zip.files)).toEqual(expect.arrayContaining([expect.stringMatching(/^xl\/charts\/chart\d+\.xml$/)]));
    expect(readFileSync(join(out, "chart-1", "chart-operations.json"), "utf8")).toContain("Revenue Trend");
  }, 30_000);

  it("caches deterministic results for arithmetic and aggregate formulas before scoring", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-12"), { recursive: true });
    await writeFormulaSubsetWorkbook(join(source, "spreadsheet", "13-12", "1_13-12_init.xlsx"), false);
    await writeFormulaSubsetWorkbook(join(source, "spreadsheet", "13-12", "1_13-12_golden.xlsx"), true);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-12",
        instruction: "Write the formula result cells using arithmetic and aggregate formulas.",
        spreadsheet_path: "spreadsheet/13-12",
        answer_position: "Sheet1!C2:F2",
        answer_sheet: "Sheet1",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "13-12", "agent", "edit-plan.json"), {
      schema: 1,
      operations: [
        { sheet: "Sheet1", cell: "C2", formula: "A2*2+B2/2" },
        { sheet: "Sheet1", cell: "D2", value: "=AVERAGE(A2:A3)" },
        { sheet: "Sheet1", cell: "E2", formula: "MAX(A2:A3)-MIN(A2:A3)" },
        { sheet: "Sheet1", cell: "F2", formula: "COUNT(A2:A3)" },
      ],
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-patch",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.totals).toMatchObject({
      comparedCells: 4,
      valueMatches: 4,
      formulaCells: 4,
      formulaMatches: 4,
      mismatches: 0,
    });
    const candidate = new ExcelJS.Workbook();
    await candidate.xlsx.readFile(join(out, report.results[0].candidateWorkbook!));
    const sheet = candidate.getWorksheet("Sheet1")!;
    expect(sheet.getCell("C2").value).toMatchObject({ formula: "A2*2+B2/2", result: 25 });
    expect(sheet.getCell("D2").value).toMatchObject({ formula: "AVERAGE(A2:A3)", result: 15 });
    expect(sheet.getCell("E2").value).toMatchObject({ formula: "MAX(A2:A3)-MIN(A2:A3)", result: 10 });
    expect(sheet.getCell("F2").value).toMatchObject({ formula: "COUNT(A2:A3)", result: 2 });
    const candidateManifest = readFileSync(join(out, "13-12", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("deterministic_local_subset");
    expect(candidateManifest).toContain("AVERAGE");
  });

  it("caches deterministic results for conditional, rounding, and criteria formulas", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-13"), { recursive: true });
    await writeBusinessFormulaWorkbook(join(source, "spreadsheet", "13-13", "1_13-13_init.xlsx"), false);
    await writeBusinessFormulaWorkbook(join(source, "spreadsheet", "13-13", "1_13-13_golden.xlsx"), true);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-13",
        instruction: "Write the business formulas for conditional rounding and multi-criteria region criteria.",
        spreadsheet_path: "spreadsheet/13-13",
        answer_position: "Sheet1!E2:S2",
        answer_sheet: "Sheet1",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "13-13", "agent", "edit-plan.json"), {
      schema: 1,
      operations: [
        { sheet: "Sheet1", cell: "E2", formula: "IF(A2>100,ROUND(ABS(B2),1),0)" },
        { sheet: "Sheet1", cell: "F2", formula: "SUMIF(C2:C4,\"North\",D2:D4)" },
        { sheet: "Sheet1", cell: "G2", formula: "COUNTIF(A2:A4,\">=80\")" },
        { sheet: "Sheet1", cell: "H2", formula: "COUNTA(C2:C4)" },
        { sheet: "Sheet1", cell: "I2", formula: "IFERROR(1/0,99)" },
        { sheet: "Sheet1", cell: "J2", formula: "ROUNDUP(B3,1)" },
        { sheet: "Sheet1", cell: "K2", formula: "ROUNDDOWN(B3,1)" },
        { sheet: "Sheet1", cell: "L2", formula: "SUMIFS(D2:D4,C2:C4,\"North\",A2:A4,\">=60\")" },
        { sheet: "Sheet1", cell: "M2", formula: "COUNTIFS(C2:C4,\"No*\",A2:A4,\">50\")" },
        { sheet: "Sheet1", cell: "N2", formula: "AVERAGEIF(C2:C4,\"North\",D2:D4)" },
        { sheet: "Sheet1", cell: "O2", formula: "AVERAGEIFS(D2:D4,C2:C4,\"North\",A2:A4,\">=60\")" },
        { sheet: "Sheet1", cell: "P2", formula: "SUMIFS(D2:D4,C2:C4,\"<>South\",A2:A4,\">50\")" },
        { sheet: "Sheet1", cell: "Q2", formula: "IF(AND(A2>=100,D2=10),\"PASS\",\"FAIL\")" },
        { sheet: "Sheet1", cell: "R2", formula: "OR(A2<100,C2=\"North\")" },
        { sheet: "Sheet1", cell: "S2", formula: "NOT(C2=\"South\")" },
      ],
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-patch",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.totals).toMatchObject({
      comparedCells: 15,
      valueMatches: 15,
      formulaCells: 15,
      formulaMatches: 15,
      mismatches: 0,
    });
    const candidate = new ExcelJS.Workbook();
    await candidate.xlsx.readFile(join(out, report.results[0].candidateWorkbook!));
    const sheet = candidate.getWorksheet("Sheet1")!;
    expect(sheet.getCell("E2").value).toMatchObject({ formula: "IF(A2>100,ROUND(ABS(B2),1),0)", result: 12.3 });
    expect(sheet.getCell("F2").value).toMatchObject({ formula: "SUMIF(C2:C4,\"North\",D2:D4)", result: 40 });
    expect(sheet.getCell("G2").value).toMatchObject({ formula: "COUNTIF(A2:A4,\">=80\")", result: 2 });
    expect(sheet.getCell("H2").value).toMatchObject({ formula: "COUNTA(C2:C4)", result: 3 });
    expect(sheet.getCell("I2").value).toMatchObject({ formula: "IFERROR(1/0,99)", result: 99 });
    expect(sheet.getCell("J2").value).toMatchObject({ formula: "ROUNDUP(B3,1)", result: 2.8 });
    expect(sheet.getCell("K2").value).toMatchObject({ formula: "ROUNDDOWN(B3,1)", result: 2.7 });
    expect(sheet.getCell("L2").value).toMatchObject({ formula: "SUMIFS(D2:D4,C2:C4,\"North\",A2:A4,\">=60\")", result: 10 });
    expect(sheet.getCell("M2").value).toMatchObject({ formula: "COUNTIFS(C2:C4,\"No*\",A2:A4,\">50\")", result: 2 });
    expect(sheet.getCell("N2").value).toMatchObject({ formula: "AVERAGEIF(C2:C4,\"North\",D2:D4)", result: 20 });
    expect(sheet.getCell("O2").value).toMatchObject({ formula: "AVERAGEIFS(D2:D4,C2:C4,\"North\",A2:A4,\">=60\")", result: 10 });
    expect(sheet.getCell("P2").value).toMatchObject({ formula: "SUMIFS(D2:D4,C2:C4,\"<>South\",A2:A4,\">50\")", result: 40 });
    expect(sheet.getCell("Q2").value).toMatchObject({ formula: "IF(AND(A2>=100,D2=10),\"PASS\",\"FAIL\")", result: "PASS" });
    expect(sheet.getCell("R2").value).toMatchObject({ formula: "OR(A2<100,C2=\"North\")", result: true });
    expect(sheet.getCell("S2").value).toMatchObject({ formula: "NOT(C2=\"South\")", result: true });
    const candidateManifest = readFileSync(join(out, "13-13", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("SUMIF");
    expect(candidateManifest).toContain("SUMIFS");
    expect(candidateManifest).toContain("AVERAGEIFS");
    expect(candidateManifest).toContain("IFERROR");
  });

  it("caches deterministic results for exact lookup formulas", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-14"), { recursive: true });
    await writeLookupFormulaWorkbook(join(source, "spreadsheet", "13-14", "1_13-14_init.xlsx"), false);
    await writeLookupFormulaWorkbook(join(source, "spreadsheet", "13-14", "1_13-14_golden.xlsx"), true);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-14",
        instruction: "Write exact lookup formulas for product rows.",
        spreadsheet_path: "spreadsheet/13-14",
        answer_position: "Sheet1!D2:J2",
        answer_sheet: "Sheet1",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "13-14", "agent", "edit-plan.json"), {
      schema: 1,
      operations: [
        { sheet: "Sheet1", cell: "D2", formula: "MATCH(\"SKU2\",A2:A4,0)" },
        { sheet: "Sheet1", cell: "E2", formula: "INDEX(B2:C4,2,2)" },
        { sheet: "Sheet1", cell: "F2", formula: "VLOOKUP(\"SKU3\",A2:C4,3,FALSE)" },
        { sheet: "Sheet1", cell: "G2", formula: "XLOOKUP(\"SKU1\",A2:A4,C2:C4)" },
        { sheet: "Sheet1", cell: "H2", formula: "INDEX(C2:C4,MATCH(\"SKU3\",A2:A4,0),1)" },
        { sheet: "Sheet1", cell: "I2", formula: "MEDIAN(15,VLOOKUP(\"K1\",A6:C8,{2,3},FALSE))" },
        { sheet: "Sheet1", cell: "J2", formula: "IF(MEDIAN(15,VLOOKUP(\"K1\",A6:C8,{2,3},FALSE))=15,\"Pass\",\"Fail\")" },
      ],
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-patch",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.totals).toMatchObject({
      comparedCells: 7,
      valueMatches: 7,
      formulaCells: 7,
      formulaMatches: 7,
      mismatches: 0,
    });
    const candidate = new ExcelJS.Workbook();
    await candidate.xlsx.readFile(join(out, report.results[0].candidateWorkbook!));
    const sheet = candidate.getWorksheet("Sheet1")!;
    expect(sheet.getCell("D2").value).toMatchObject({ formula: "MATCH(\"SKU2\",A2:A4,0)", result: 2 });
    expect(sheet.getCell("E2").value).toMatchObject({ formula: "INDEX(B2:C4,2,2)", result: 20 });
    expect(sheet.getCell("F2").value).toMatchObject({ formula: "VLOOKUP(\"SKU3\",A2:C4,3,FALSE)", result: 30 });
    expect(sheet.getCell("G2").value).toMatchObject({ formula: "XLOOKUP(\"SKU1\",A2:A4,C2:C4)", result: 10 });
    expect(sheet.getCell("H2").value).toMatchObject({ formula: "INDEX(C2:C4,MATCH(\"SKU3\",A2:A4,0),1)", result: 30 });
    expect(sheet.getCell("I2").value).toMatchObject({ formula: "MEDIAN(15,VLOOKUP(\"K1\",A6:C8,{2,3},FALSE))", result: 15 });
    expect(sheet.getCell("J2").value).toMatchObject({ formula: "IF(MEDIAN(15,VLOOKUP(\"K1\",A6:C8,{2,3},FALSE))=15,\"Pass\",\"Fail\")", result: "Pass" });
    const candidateManifest = readFileSync(join(out, "13-14", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("VLOOKUP");
    expect(candidateManifest).toContain("XLOOKUP");
    expect(candidateManifest).toContain("MATCH");
  });

  it("caches deterministic results for text, date, and SUMPRODUCT formulas", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-15"), { recursive: true });
    await writeTextDateFormulaWorkbook(join(source, "spreadsheet", "13-15", "1_13-15_init.xlsx"), false);
    await writeTextDateFormulaWorkbook(join(source, "spreadsheet", "13-15", "1_13-15_golden.xlsx"), true);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-15",
        instruction: "Write text extraction, date text, value conversion, concatenation, and SUMPRODUCT formulas.",
        spreadsheet_path: "spreadsheet/13-15",
        answer_position: "Sheet1!D2:N2",
        answer_sheet: "Sheet1",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    writeJson(join(stage, "tasks", "13-15", "agent", "edit-plan.json"), {
      schema: 1,
      operations: [
        { sheet: "Sheet1", cell: "D2", formula: "LEFT(A2,3)" },
        { sheet: "Sheet1", cell: "E2", formula: "RIGHT(A2,4)" },
        { sheet: "Sheet1", cell: "F2", formula: "MID(A2,5,3)" },
        { sheet: "Sheet1", cell: "G2", formula: "LEN(A2)" },
        { sheet: "Sheet1", cell: "H2", formula: "FIND(\"-\",A2)" },
        { sheet: "Sheet1", cell: "I2", formula: "SEARCH(\"west\",B2)" },
        { sheet: "Sheet1", cell: "J2", formula: "REPLACE(A2,5,3,\"999\")" },
        { sheet: "Sheet1", cell: "K2", formula: "TEXT(DATE(2024,1,1),\"dddd\")" },
        { sheet: "Sheet1", cell: "L2", formula: "SUMPRODUCT(B5:B6,C5:C6)" },
        { sheet: "Sheet1", cell: "M2", formula: "VALUE(\"12.5%\")" },
        { sheet: "Sheet1", cell: "N2", formula: "TRIM(CONCATENATE(\"  \",B2,\" \",C2,\"  \"))" },
      ],
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "apply-agent-patch",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.totals).toMatchObject({
      comparedCells: 11,
      valueMatches: 11,
      formulaCells: 11,
      formulaMatches: 11,
      mismatches: 0,
    });
    const candidate = new ExcelJS.Workbook();
    await candidate.xlsx.readFile(join(out, report.results[0].candidateWorkbook!));
    const sheet = candidate.getWorksheet("Sheet1")!;
    expect(sheet.getCell("D2").value).toMatchObject({ formula: "LEFT(A2,3)", result: "ABC" });
    expect(sheet.getCell("E2").value).toMatchObject({ formula: "RIGHT(A2,4)", result: "1234" });
    expect(sheet.getCell("F2").value).toMatchObject({ formula: "MID(A2,5,3)", result: "XYZ" });
    expect(sheet.getCell("G2").value).toMatchObject({ formula: "LEN(A2)", result: 12 });
    expect(sheet.getCell("H2").value).toMatchObject({ formula: "FIND(\"-\",A2)", result: 4 });
    expect(sheet.getCell("I2").value).toMatchObject({ formula: "SEARCH(\"west\",B2)", result: 1 });
    expect(sheet.getCell("J2").value).toMatchObject({ formula: "REPLACE(A2,5,3,\"999\")", result: "ABC-999-1234" });
    expect(sheet.getCell("K2").value).toMatchObject({ formula: "TEXT(DATE(2024,1,1),\"dddd\")", result: "Monday" });
    expect(sheet.getCell("L2").value).toMatchObject({ formula: "SUMPRODUCT(B5:B6,C5:C6)", result: 32 });
    expect(sheet.getCell("M2").value).toMatchObject({ formula: "VALUE(\"12.5%\")", result: 0.125 });
    expect(sheet.getCell("N2").value).toMatchObject({ formula: "TRIM(CONCATENATE(\"  \",B2,\" \",C2,\"  \"))", result: "West 7" });
    const candidateManifest = readFileSync(join(out, "13-15", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("SUMPRODUCT");
    expect(candidateManifest).toContain("TEXT");
    expect(candidateManifest).toContain("CONCATENATE");
  });

  it("asks a model for an edit plan and records usage before evaluator scoring", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-3"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-3",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-3",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
    ]);
    await writeWorkbook(join(source, "spreadsheet", "13-3", "1_13-3_init.xlsx"), 1);
    await writeWorkbook(join(source, "spreadsheet", "13-3", "1_13-3_golden.xlsx"), 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "scripted-spreadsheetbench-planner",
      async next({ messages }) {
        expect(messages[0]?.content).toContain("Change Sheet1 B2 to 2");
        expect(messages[0]?.content.toLowerCase()).not.toContain("gold");
        return {
          text: JSON.stringify({ schema: 1, operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 80, outputTokens: 20 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({
      mode: "model-edit-plan",
      taskCount: 1,
      caseCount: 1,
      repeatCount: 1,
      attemptCount: 1,
      passCount: 1,
      passRate: 1,
      averageOverall: 1,
      harness: {
        toolPolicy: "agent_dir_only_until_candidate",
        evaluatorAccess: "after_candidate_emit_only",
        budget: { modelCalls: 1, inputTokens: 80, outputTokens: 20, providerCostUsd: 0 },
      },
    });
    const result = report.results[0];
    expect(result.model).toMatchObject({
      name: "scripted-spreadsheetbench-planner",
      calls: 1,
      usage: { inputTokens: 80, outputTokens: 20 },
      costUsd: 0,
    });
    expect(result.trajectory.map((step) => step.step)).toEqual([
      "read_agent_manifest",
      "prepare_agent_workspace",
      "snapshot_agent_workbook",
      "call_model_for_edit_plan",
      "verify_edit_plan",
      "verify_candidate_workbook",
      "emit_candidate_workbook",
      "read_evaluator_manifest",
      "score_candidate",
    ]);
    expectSidecarFile(result.scorerReceipt, "13-3/score-receipt.json");
    expectSidecarFile(result.sidecarEvidence?.candidateManifest, "13-3/candidate-manifest.json");
    expectSidecarFile(result.sidecarEvidence?.agentWorkspaceManifest, "13-3/agent-workspace/agent-workspace-manifest.json");
    expectSidecarFile(result.sidecarEvidence?.editPlan, "13-3/model-edit-plan.json");
    expectSidecarFile(result.sidecarEvidence?.rawModelOutput, "13-3/model-output.txt");
    expect(result.sidecarEvidence?.editPlan?.kind).toBe("generated");
    expect(result.sidecarEvidence?.formulaResultPolicy).toBe("deterministic_local_subset");
    expect(result.sidecarEvidence?.supportedFormulaFunctions).toEqual(expect.arrayContaining(["SUM", "IFERROR", "COUNTIF"]));
    expect(result.sidecarEvidence?.appliedOperationCount).toBe(1);
    const candidateManifest = readFileSync(join(out, "13-3", "candidate-manifest.json"), "utf8");
    expect(candidateManifest).toContain("model-edit-plan");
    expect(candidateManifest).toContain("agentWorkspaceManifest");
    expect(candidateManifest).toContain("rawModelOutput");
    expect(candidateManifest.toLowerCase()).not.toContain("gold");
    expect(candidateManifest).not.toContain("evaluator");
  });

  it("shows every worksheet to the model even when the first sheet exceeds the snapshot cap", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-9"), { recursive: true });
    await writeTwoSheetStarvationWorkbook(join(source, "spreadsheet", "13-9", "1_13-9_init.xlsx"), 1);
    await writeTwoSheetStarvationWorkbook(join(source, "spreadsheet", "13-9", "1_13-9_golden.xlsx"), 2);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-9",
        instruction: "Change the target cell on LISTS to 2.",
        spreadsheet_path: "spreadsheet/13-9",
        answer_position: "LISTS!B2:B2",
        answer_sheet: "LISTS",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "sheet-aware-spreadsheetbench-planner",
      async next({ messages }) {
        const payload = JSON.parse(messages[0]?.content ?? "{}") as {
          workbook?: {
            sheets?: Array<{
              name: string;
              truncated?: boolean;
              blocks?: Array<{ range: string; headerRow: number; headers: string[]; dataRowCount: number }>;
              cells?: Array<{ address: string }>;
            }>;
          };
        };
        expect(payload.workbook?.sheets?.map((sheet) => sheet.name)).toEqual(["RANGES", "LISTS"]);
        expect(payload.workbook?.sheets?.[0]?.truncated).toBe(true);
        expect(payload.workbook?.sheets?.[0]?.blocks?.[0]).toMatchObject({
          range: "A1:D160",
          headerRow: 1,
          dataRowCount: 159,
        });
        expect(payload.workbook?.sheets?.[1]?.blocks?.[0]).toMatchObject({
          range: "A1:B2",
          title: "target",
          headerRow: 2,
          dataRowCount: 0,
        });
        expect(payload.workbook?.sheets?.[1]?.cells?.map((cell) => cell.address)).toContain("B2");
        return {
          text: `Here is the edit plan:\n\`\`\`json\n${JSON.stringify({ schema: 1, operations: [{ sheet: "LISTS", cell: "B2", value: 2 }] })}\n\`\`\``,
          toolCalls: [],
          done: true,
          usage: { inputTokens: 120, outputTokens: 30 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.pass).toBe(true);
    expect(readFileSync(join(out, "13-9", "model-output.txt"), "utf8")).toContain("Here is the edit plan");
    expect(readFileSync(join(out, "13-9", "model-edit-plan.json"), "utf8")).toContain("\"sheet\": \"LISTS\"");
  });

  it("repairs a self-referential input-cell edit using the task-aware formula target", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "11276"), { recursive: true });
    await writeFormulaRepairWorkbook(join(source, "spreadsheet", "11276", "1_11276_init.xlsx"), false);
    await writeFormulaRepairWorkbook(join(source, "spreadsheet", "11276", "1_11276_golden.xlsx"), true);
    writeJson(join(source, "dataset.json"), [{
      id: "11276",
      instruction: 'The wrong formula is TEXT(F4,"DD"). Correct it so the weekday appears like the adjacent cells.',
      spreadsheet_path: "spreadsheet/11276",
      answer_position: "ATTENDENCE!F3:F3",
      answer_sheet: "ATTENDENCE",
    }]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    let callCount = 0;
    const planner: AgentModel = {
      name: "repairing-spreadsheetbench-planner",
      async next({ messages }) {
        callCount += 1;
        const payload = JSON.parse(messages[0]?.content ?? "{}") as {
          workbook?: { sheets?: Array<{ cells?: Array<{ address: string; formula?: string }> }> };
          verification?: { issues?: Array<{ kind: string }> };
        };
        if (callCount === 1) {
          const cells = payload.workbook?.sheets?.flatMap((sheet) => sheet.cells ?? []) ?? [];
          expect(cells).toEqual(expect.arrayContaining([
            expect.objectContaining({ address: "F3", formula: 'TEXT(F4,"DD")' }),
            expect.objectContaining({ address: "F4" }),
          ]));
          return {
            text: JSON.stringify({
              schema: 1,
              operations: [{ sheet: "ATTENDENCE", cell: "F4", formula: 'TEXT(F4,"ddd")', result: "Tue" }],
            }),
            toolCalls: [],
            done: true,
            usage: { inputTokens: 100, outputTokens: 25 },
          };
        }
        expect(payload.verification?.issues?.map((issue) => issue.kind)).toEqual(expect.arrayContaining([
          "formula_self_reference",
          "missing_target_coverage",
        ]));
        return {
          text: JSON.stringify({
            schema: 1,
            operations: [{ sheet: "ATTENDENCE", cell: "F3", formula: 'TEXT(F4,"ddd")', result: "Tue" }],
          }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 80, outputTokens: 20 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      modelSnapshotMaxCells: 4,
      modelRepairAttempts: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(callCount).toBe(2);
    expect(report.passCount).toBe(1);
    expect(report.harness.budget).toMatchObject({ modelCalls: 2, inputTokens: 180, outputTokens: 45 });
    expect(report.results[0]).toMatchObject({
      score: { pass: true },
      model: { calls: 2, usage: { inputTokens: 180, outputTokens: 45 } },
      sidecarEvidence: { verificationStatus: "passed" },
    });
    expect(report.results[0].trajectory.map((step) => step.step)).toEqual(expect.arrayContaining([
      "verify_edit_plan",
      "repair_edit_plan",
      "verify_candidate_workbook",
    ]));
    expectSidecarFile(report.results[0].sidecarEvidence?.repairOutputs?.[0], "11276/model-repair-output-01.txt");
    const verification = JSON.parse(readFileSync(join(out, "11276", "model-edit-verification.json"), "utf8"));
    expect(verification).toMatchObject({ status: "passed", repairAttemptCount: 1 });
    const candidate = new ExcelJS.Workbook();
    await candidate.xlsx.readFile(join(out, report.results[0].candidateWorkbook!));
    expect(candidate.getWorksheet("ATTENDENCE")?.getCell("F3").value).toMatchObject({
      formula: 'TEXT(F4,"ddd")',
      result: "Tue",
    });
  });

  it("infers and applies visible section aggregation without opening evaluator gold", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-13"), { recursive: true });
    await writeAggregateSectionsWorkbook(join(source, "spreadsheet", "13-13", "1_13-13_init.xlsx"), false);
    await writeAggregateSectionsWorkbook(join(source, "spreadsheet", "13-13", "1_13-13_golden.xlsx"), true);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-13",
        instruction:
          "Combine data from the RANGES sheet to the LISTS sheet by matching duplicates based on the DATE and REF columns, sum the AMOUNTS, use the completed STAGE section as a format reference, delete old LISTS ranges, and sort by DATE then REF.",
        spreadsheet_path: "spreadsheet/13-13",
        answer_position: "LISTS!A8:D10",
        answer_sheet: "LISTS",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "aggregate-section-aware-planner",
      async next({ messages }) {
        const payload = JSON.parse(messages[0]?.content ?? "{}") as {
          visibleDerivedOperationCandidates?: Array<{
            op: string;
            sourceSheet: string;
            sourceSection: string;
            targetSheet: string;
            targetSection: string;
            groupBy: string[];
            valueColumn: string;
          }>;
        };
        expect(payload.visibleDerivedOperationCandidates).toEqual([
          expect.objectContaining({
            op: "aggregate_section",
            sourceSheet: "RANGES",
            sourceSection: "DATA",
            targetSheet: "LISTS",
            targetSection: "DATA",
            groupBy: ["DATE", "REF"],
            valueColumn: "AMOUNTS",
          }),
        ]);
        expect(JSON.stringify(payload).toLowerCase()).not.toContain("gold");
        return {
          text: JSON.stringify({
            schema: 1,
            operations: [
              {
                op: "aggregate_section",
                sourceSheet: "RANGES",
                sourceSection: "DATA",
                targetSheet: "LISTS",
                targetSection: "DATA",
                groupBy: ["DATE", "REF"],
                valueColumn: "AMOUNTS",
                sortBy: ["DATE", "REF"],
                totalLabel: "TOTAL",
              },
              { sheet: "LISTS", cell: "B8", value: "" },
              { sheet: "LISTS", cell: "A7", value: "SN" },
              { op: "clear_section", sheet: "LISTS", section: "STAGE" },
              {
                op: "sort_unique_rows",
                sheet: "LISTS",
                sourceRange: "A1:D10",
                targetCell: "A2",
                keyColumns: ["B", "C"],
                outputColumns: ["B", "C", "D"],
                sortBy: "C",
                sortDirection: "asc",
                includeIndex: true,
              },
            ],
          }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 150, outputTokens: 20 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.pass).toBe(true);
    const normalizedPlan = JSON.parse(readFileSync(join(out, "13-13", "model-edit-plan.json"), "utf8"));
    expect(normalizedPlan.operations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        op: "aggregate_section",
        sourceSheet: "RANGES",
        sourceSection: "DATA",
        targetSheet: "LISTS",
        targetSection: "DATA",
      }),
    ]));
    expect(normalizedPlan.operations.at(-1)).toMatchObject({ op: "aggregate_section", targetSection: "DATA" });
    expect(normalizedPlan.operations).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "clear_section" }),
      expect.objectContaining({ op: "sort_unique_rows" }),
    ]));
    expect(readFileSync(join(out, "13-13", "candidate-manifest.json"), "utf8").toLowerCase()).not.toContain("gold");
  });

  it("infers and materializes visible date filters instead of unsupported dynamic formulas", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "17-35"), { recursive: true });
    await writeFilterRowsWorkbook(join(source, "spreadsheet", "17-35", "1_17-35_init.xlsx"), false);
    await writeFilterRowsWorkbook(join(source, "spreadsheet", "17-35", "1_17-35_golden.xlsx"), true);
    writeJson(join(source, "dataset.json"), [
      {
        id: "17-35",
        instruction:
          "Display the dates based on the start and end date criteria entered in cells I2 and J2. I have a data range from A1 to E8, the criteria range in cells I2 and J2, and I want the filtered results to start from cell I6.",
        spreadsheet_path: "spreadsheet/17-35",
        answer_position: "I6:M7",
        answer_sheet: "FILTER 5b",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "filter-formula-planner",
      async next({ messages }) {
        const payload = JSON.parse(messages[0]?.content ?? "{}") as {
          visibleDerivedOperationCandidates?: Array<{ op: string; sourceRange?: string; targetCell?: string }>;
        };
        expect(payload.visibleDerivedOperationCandidates).toEqual([
          expect.objectContaining({ op: "filter_rows", sourceRange: "A1:E8", targetCell: "I6" }),
        ]);
        return {
          text: JSON.stringify({
            schema: 1,
            operations: [{ sheet: "FILTER 5b", cell: "I6", value: "=FILTER(A1:E8,(A1:A8>=I2)*(A1:A8<=J2))" }],
          }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 140, outputTokens: 20 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    const normalizedPlan = JSON.parse(readFileSync(join(out, "17-35", "model-edit-plan.json"), "utf8"));
    expect(normalizedPlan.operations.at(-1)).toMatchObject({ op: "filter_rows", targetCell: "I6" });
  });

  it("infers and applies visible unique REF sorting after partial scalar model output", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "22-47"), { recursive: true });
    await writeSortUniqueRowsWorkbook(join(source, "spreadsheet", "22-47", "1_22-47_init.xlsx"), false);
    await writeSortUniqueRowsWorkbook(join(source, "spreadsheet", "22-47", "1_22-47_golden.xlsx"), true);
    writeJson(join(source, "dataset.json"), [
      {
        id: "22-47",
        instruction:
          "The sort should skip empty cells, headers, and duplicate items, where duplicates are defined by identical entries in both column B and C. The final answer should be output in columns G and H, and sort only column H sorted lowest to highest.",
        spreadsheet_path: "spreadsheet/22-47",
        answer_position: "F2:H5",
        answer_sheet: "sheet1",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "short-prefix-sort-planner",
      async next({ messages }) {
        const payload = JSON.parse(messages[0]?.content ?? "{}") as {
          visibleDerivedOperationCandidates?: Array<{ op: string; sourceRange?: string; targetCell?: string }>;
        };
        expect(payload.visibleDerivedOperationCandidates).toEqual([
          expect.objectContaining({ op: "sort_unique_rows", sourceRange: "A1:C8", targetCell: "F2" }),
        ]);
        return {
          text: JSON.stringify({
            schema: 1,
            operations: [
              { sheet: "sheet1", cell: "G2", value: "ZED" },
              { sheet: "sheet1", cell: "H2", value: 999 },
            ],
          }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 160, outputTokens: 20 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    const normalizedPlan = JSON.parse(readFileSync(join(out, "22-47", "model-edit-plan.json"), "utf8"));
    expect(normalizedPlan.operations.at(-1)).toMatchObject({ op: "sort_unique_rows", targetCell: "F2" });
  });

  it("normalizes cell refs that the model accidentally emits in the sheet field", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-11"), { recursive: true });
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-11", "1_13-11_init.xlsx"), "Actual", 1);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-11", "1_13-11_golden.xlsx"), "Actual", 2);
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-11",
        instruction: "Change Actual B2 to 2.",
        spreadsheet_path: "spreadsheet/13-11",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "cell-ref-in-sheet-field-planner",
      async next() {
        return {
          text: JSON.stringify({
            schema: 1,
            operations: [
              { sheet: "Actual", cell: "A1", value: "anchor" },
              { sheet: "B2", value: 2 },
            ],
          }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 30, outputTokens: 10 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(readFileSync(join(out, "13-11", "model-output.txt"), "utf8")).toContain("\"sheet\":\"B2\"");
    expect(JSON.parse(readFileSync(join(out, "13-11", "model-edit-plan.json"), "utf8")).operations[1]).toMatchObject({
      sheet: "Actual",
      cell: "B2",
      value: 2,
    });
  });

  it("keeps attempt indices globally unique across staged tasks", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    for (const id of ["13-7", "13-8"]) {
      mkdirSync(join(source, "spreadsheet", id), { recursive: true });
      await writeWorkbook(join(source, "spreadsheet", id, `1_${id}_init.xlsx`), 1);
      await writeWorkbook(join(source, "spreadsheet", id, `1_${id}_golden.xlsx`), 2);
    }
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-7",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-7",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
      {
        id: "13-8",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-8",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
    ]);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "copy-input-baseline",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.results.map((result) => [result.taskId, result.attemptIndex])).toEqual([
      ["13-7", 1],
      ["13-8", 2],
    ]);
    expect(report.caseRuns.map((run) => [run.taskId, run.attempts, run.finalAttemptIndex])).toEqual([
      ["13-7", [1], 1],
      ["13-8", [2], 2],
    ]);
  });

  it("counts failed model edit plans with usage, trajectory, and error evidence", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-4"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-4",
        instruction: "Change the workbook value to 2.",
        spreadsheet_path: "spreadsheet/13-4",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    await writeWorkbookWithTwoSheets(join(source, "spreadsheet", "13-4", "1_13-4_init.xlsx"), "Actual", "Lookup", 1);
    await writeWorkbookWithTwoSheets(join(source, "spreadsheet", "13-4", "1_13-4_golden.xlsx"), "Actual", "Lookup", 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "bad-spreadsheetbench-planner",
      async next() {
        return {
          text: JSON.stringify({ schema: 1, operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 33, outputTokens: 11 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({
      mode: "model-edit-plan",
      taskCount: 1,
      caseCount: 1,
      repeatCount: 1,
      attemptCount: 1,
      passCount: 0,
      passRate: 0,
      averageOverall: 0,
      harness: {
        budget: { modelCalls: 1, inputTokens: 33, outputTokens: 11, providerCostUsd: 0 },
      },
    });
    expect(report.warnings[0]).toContain("edit-plan references missing sheet: Sheet1");
    const result = report.results[0];
    expect(result.score).toBeUndefined();
    expect(result.error).toMatchObject({
      phase: "candidate_generation",
      message: "edit-plan references missing sheet: Sheet1",
    });
    expect(result.model).toMatchObject({
      name: "bad-spreadsheetbench-planner",
      calls: 1,
      usage: { inputTokens: 33, outputTokens: 11 },
    });
    expect(result.trajectory.map((step) => step.step)).toEqual([
      "read_agent_manifest",
      "prepare_agent_workspace",
      "snapshot_agent_workbook",
      "call_model_for_edit_plan",
      "verify_edit_plan",
    ]);
    expect(readFileSync(join(out, "13-4", "model-edit-plan.json"), "utf8").toLowerCase()).not.toContain("gold");
  });

  it("preserves the attempted model route when a model edit call fails before usage is returned", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-timeout"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-timeout",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-timeout",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
    ]);
    await writeWorkbook(join(source, "spreadsheet", "13-timeout", "1_13-timeout_init.xlsx"), 1);
    await writeWorkbook(join(source, "spreadsheet", "13-timeout", "1_13-timeout_golden.xlsx"), 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "openrouter/free-auto",
      async next() {
        throw new Error("The operation was aborted due to timeout");
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.harness.budget).toMatchObject({
      modelCalls: 1,
      inputTokens: 0,
      outputTokens: 0,
      providerCostUsd: 0,
    });
    expect(report.results[0]).toMatchObject({
      error: {
        phase: "candidate_generation",
        message: "The operation was aborted due to timeout",
      },
      model: {
        name: "openrouter/free-auto",
        calls: 1,
        usage: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
      },
    });
  });

  it("records the resolved concrete model while preserving the requested free-auto alias", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-resolved"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-resolved",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-resolved",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
    ]);
    await writeWorkbook(join(source, "spreadsheet", "13-resolved", "1_13-resolved_init.xlsx"), 1);
    await writeWorkbook(join(source, "spreadsheet", "13-resolved", "1_13-resolved_golden.xlsx"), 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    let resolvedName = "openrouter/free-auto";
    const planner: AgentModel = {
      get name() {
        return resolvedName;
      },
      async next() {
        resolvedName = "nvidia/nemotron-3-super-120b-a12b:free";
        return {
          text: JSON.stringify({ schema: 1, operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 30, outputTokens: 8 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      modelName: "openrouter/free-auto",
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].model).toMatchObject({
      name: "nvidia/nemotron-3-super-120b-a12b:free",
      requestedName: "openrouter/free-auto",
      calls: 1,
      usage: { inputTokens: 30, outputTokens: 8 },
      costUsd: 0,
    });
    const manifest = JSON.parse(readFileSync(join(out, "13-resolved", "candidate-manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      model: "nvidia/nemotron-3-super-120b-a12b:free",
      requestedModel: "openrouter/free-auto",
      modelCostUsd: 0,
    });
  });

  it("repairs generic Sheet1 aliases when the workbook has exactly one sheet", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-11"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-11",
        instruction: "Change the workbook value to 2.",
        spreadsheet_path: "spreadsheet/13-11",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-11", "1_13-11_init.xlsx"), "Actual", 1);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-11", "1_13-11_golden.xlsx"), "Actual", 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "single-sheet-alias-planner",
      async next() {
        return {
          text: JSON.stringify({ schema: 1, operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 30, outputTokens: 8 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.pass).toBe(true);
    const normalizedPlan = readFileSync(join(out, "13-11", "model-edit-plan.json"), "utf8");
    expect(normalizedPlan).toContain('"sheet": "Actual"');
    expect(normalizedPlan).not.toContain('"sheet": "Sheet1"');
  });

  it("repairs common model JSON drift before applying edit plans", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-12"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-12",
        instruction: "Change the workbook value to 2.",
        spreadsheet_path: "spreadsheet/13-12",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-12", "1_13-12_init.xlsx"), "Actual", 1);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-12", "1_13-12_golden.xlsx"), "Actual", 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "json-drift-planner",
      async next() {
        return {
          text: '{"schema":1,"operations":[{"sheet":"Actual","cell":"A1","value":TOTAL},{"sheet":"A2","formula":"1+1","result":2?,"numFmt":"#\\,##0.00"},{"sheet":"B2","value":2,"formula":null,}]}',
          toolCalls: [],
          done: true,
          usage: { inputTokens: 31, outputTokens: 9 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(report.results[0].score?.pass).toBe(true);
    const normalizedPlan = readFileSync(join(out, "13-12", "model-edit-plan.json"), "utf8");
    expect(normalizedPlan).toContain('"value": "TOTAL"');
    expect(normalizedPlan).toContain('"cell": "B2"');
    expect(normalizedPlan).toContain('"result": 2');
    expect(normalizedPlan).toContain('"numFmt": "#,##0.00"');
  });

  it("repairs duplicated escaped closing quotes in formula strings", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-quote-drift"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-quote-drift",
        instruction: "Change the workbook value to 2.",
        spreadsheet_path: "spreadsheet/13-quote-drift",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-quote-drift", "1_13-quote-drift_init.xlsx"), "Actual", 1);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-quote-drift", "1_13-quote-drift_golden.xlsx"), "Actual", 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "quote-drift-planner",
      async next() {
        return {
          text: '{"schema":1,"operations":[{"sheet":"Actual","cell":"B2","value":2},{"sheet":"Actual","cell":"C2","value":{"formula":"=TEXT(A2,\\"#\\") & \\"P\\"\\"}}]}',
          toolCalls: [],
          done: true,
          usage: { inputTokens: 24, outputTokens: 11 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    const normalizedPlan = JSON.parse(readFileSync(join(out, "13-quote-drift", "model-edit-plan.json"), "utf8"));
    expect(normalizedPlan.operations[1]).toMatchObject({
      sheet: "Actual",
      cell: "C2",
      formula: '=TEXT(A2,"#") & "P"'.replace(/^=/, ""),
    });
  });

  it("repairs unescaped nested quotes in formula strings", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-unescaped-formula"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-unescaped-formula",
        instruction: "Leave the age blank when the birth date is blank.",
        spreadsheet_path: "spreadsheet/13-unescaped-formula",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-unescaped-formula", "1_init.xlsx"), "Actual", 1);
    await writeWorkbookWithSheet(join(source, "spreadsheet", "13-unescaped-formula", "1_golden.xlsx"), "Actual", 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "unescaped-formula-planner",
      async next() {
        return {
          text: '{"schema":1,"operations":[{"sheet":"Actual","cell":"C2","formula":"=IF(C2="","",DATEDIF(C2,TODAY(),"y"))"},{"sheet":"Actual","cell":"B2","value":2}]}',
          toolCalls: [],
          done: true,
          usage: { inputTokens: 28, outputTokens: 12 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.results[0].error).toBeUndefined();
    const normalizedPlan = JSON.parse(readFileSync(join(out, "13-unescaped-formula", "model-edit-plan.json"), "utf8"));
    expect(normalizedPlan.operations[0].formula).toBe('=IF(C2="","",DATEDIF(C2,TODAY(),"y"))');
  });

  it("wraps model edit-plan operations that omit the schema field", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-no-schema"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-no-schema",
        instruction: "Change Sheet1 B2 to 2.",
        spreadsheet_path: "spreadsheet/13-no-schema",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
    ]);
    await writeWorkbook(join(source, "spreadsheet", "13-no-schema", "1_13-no-schema_init.xlsx"), 1);
    await writeWorkbook(join(source, "spreadsheet", "13-no-schema", "1_13-no-schema_golden.xlsx"), 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "missing-schema-planner",
      async next() {
        return {
          text: JSON.stringify({ operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 30, outputTokens: 8 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report.passCount).toBe(1);
    expect(JSON.parse(readFileSync(join(out, "13-no-schema", "model-edit-plan.json"), "utf8"))).toMatchObject({
      schema: 1,
      operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }],
    });
  });

  it("retries retryable model edit failures and records case-level stop policy", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-5"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-5",
        instruction: "Change the workbook value to 2.",
        spreadsheet_path: "spreadsheet/13-5",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    await writeWorkbookWithTwoSheets(join(source, "spreadsheet", "13-5", "1_13-5_init.xlsx"), "Actual", "Lookup", 1);
    await writeWorkbookWithTwoSheets(join(source, "spreadsheet", "13-5", "1_13-5_golden.xlsx"), "Actual", "Lookup", 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    let calls = 0;
    const planner: AgentModel = {
      name: "retrying-spreadsheetbench-planner",
      async next() {
        calls += 1;
        const sheet = calls === 1 ? "Sheet1" : "Actual";
        return {
          text: JSON.stringify({ schema: 1, operations: [{ sheet, cell: "B2", value: 2 }] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 40, outputTokens: 10 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      retryFailed: 1,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({
      mode: "model-edit-plan",
      taskCount: 2,
      caseCount: 1,
      caseRunCount: 1,
      casePassCount: 1,
      casePassRate: 1,
      repeatCount: 1,
      attemptCount: 2,
      passCount: 1,
      retryPolicy: {
        maxRetries: 1,
        retryOn: ["candidate_generation", "scoring"],
        stopOnPass: true,
      },
      retryStats: {
        retriedCaseRunCount: 1,
        retryAttemptCount: 1,
        passedAfterRetryCount: 1,
        exhaustedCaseRunCount: 0,
      },
      harness: {
        budget: { modelCalls: 2, inputTokens: 80, outputTokens: 20, providerCostUsd: 0 },
      },
    });
    expect(report.caseRuns).toEqual([
      expect.objectContaining({
        taskId: "13-5",
        repeatIndex: 1,
        attempts: [1, 2],
        finalAttemptIndex: 2,
        pass: true,
        stopReason: "passed",
        bestOverall: 1,
      }),
    ]);
    expect(report.results.map((result) => [result.attemptIndex, result.repeatIndex, result.tryIndex, result.retryOfAttemptIndex])).toEqual([
      [1, 1, 1, undefined],
      [2, 1, 2, 1],
    ]);
    expect(report.results[0].error?.message).toBe("edit-plan references missing sheet: Sheet1");
    expect(report.results[1].score?.pass).toBe(true);
    expect(existsSync(join(out, "13-5", "attempt-01", "model-edit-plan.json"))).toBe(true);
    expect(existsSync(join(out, "13-5", "attempt-02", "candidate-01-1_13-5_init.xlsx"))).toBe(true);
  });

  it("scores an explicit empty model plan as an unchanged candidate instead of a generation crash", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "248-empty"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "248-empty",
        instruction: "Attempt an unsupported workbook edit and return an empty plan when no safe operation applies.",
        spreadsheet_path: "spreadsheet/248-empty",
        answer_position: "Sheet1!B2:B2",
        answer_sheet: "Sheet1",
      },
    ]);
    await writeWorkbook(join(source, "spreadsheet", "248-empty", "1_248-empty_init.xlsx"), 1);
    await writeWorkbook(join(source, "spreadsheet", "248-empty", "1_248-empty_golden.xlsx"), 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "explicit-empty-plan-model",
      async next() {
        return {
          text: JSON.stringify({ schema: 1, operations: [] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 20, outputTokens: 6 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(report).toMatchObject({ taskCount: 1, caseCount: 1, passCount: 0, attemptCount: 1 });
    expect(report.results[0].error).toBeUndefined();
    expect(report.results[0].candidateWorkbook).toBeTruthy();
    expect(report.results[0].score?.pass).toBe(false);
    expect(report.results[0].sidecarEvidence?.appliedOperationCount).toBe(0);
    expect(report.results[0].sidecarEvidence?.editPlan?.kind).toBe("generated");
    expect(report.caseRuns[0].stopReason).toBe("failed_score");
  });

  it("accounts repeated model edit attempts with pass rate, p95, and failure counts", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    mkdirSync(join(source, "spreadsheet", "13-6"), { recursive: true });
    writeJson(join(source, "dataset.json"), [
      {
        id: "13-6",
        instruction: "Change the workbook value to 2.",
        spreadsheet_path: "spreadsheet/13-6",
        answer_position: "Actual!B2:B2",
        answer_sheet: "Actual",
      },
    ]);
    await writeWorkbookWithTwoSheets(join(source, "spreadsheet", "13-6", "1_13-6_init.xlsx"), "Actual", "Lookup", 1);
    await writeWorkbookWithTwoSheets(join(source, "spreadsheet", "13-6", "1_13-6_golden.xlsx"), "Actual", "Lookup", 2);
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const planner: AgentModel = {
      name: "repeated-bad-spreadsheetbench-planner",
      async next() {
        return {
          text: JSON.stringify({ schema: 1, operations: [{ sheet: "Sheet1", cell: "B2", value: 2 }] }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 33, outputTokens: 11 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      repeats: 3,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    const failureKey = "candidate_generation:edit-plan references missing sheet: Sheet1";
    expect(report).toMatchObject({
      mode: "model-edit-plan",
      taskCount: 3,
      caseCount: 1,
      repeatCount: 3,
      attemptCount: 3,
      passCount: 0,
      passRate: 0,
      averageOverall: 0,
      stats: {
        failureCounts: { [failureKey]: 3 },
      },
      harness: {
        budget: { modelCalls: 3, inputTokens: 99, outputTokens: 33, providerCostUsd: 0 },
      },
    });
    expect(report.stats.latencyMs.p50).toBeGreaterThanOrEqual(0);
    expect(report.stats.latencyMs.p95).toBeGreaterThanOrEqual(report.stats.latencyMs.p50);
    expect(report.results.map((result) => result.attemptIndex)).toEqual([1, 2, 3]);
    expect(report.results.map((result) => result.error?.message)).toEqual([
      "edit-plan references missing sheet: Sheet1",
      "edit-plan references missing sheet: Sheet1",
      "edit-plan references missing sheet: Sheet1",
    ]);
    expect(existsSync(join(out, "13-6", "attempt-01", "model-edit-plan.json"))).toBe(true);
    expect(readFileSync(join(out, "13-6", "attempt-01", "model-edit-plan.json"), "utf8").toLowerCase()).not.toContain("gold");
  });

  it("batches an exact task-ID selection into one auditable model call with bounded snapshots", async () => {
    const source = tempRoot("source");
    const stage = tempRoot("stage");
    const out = tempRoot("out");
    const ids = ["batch-1", "batch-2", "batch-3", "batch-4", "batch-5"];
    for (const [index, id] of ids.entries()) {
      mkdirSync(join(source, "spreadsheet", id), { recursive: true });
      await writeWorkbook(join(source, "spreadsheet", id, `1_${id}_init.xlsx`), index + 1);
      await writeWorkbook(join(source, "spreadsheet", id, `1_${id}_golden.xlsx`), index + 1);
    }
    writeJson(join(source, "dataset.json"), ids.map((id) => ({
      id,
      instruction: `Keep ${id} unchanged when no edit is justified.`,
      spreadsheet_path: `spreadsheet/${id}`,
      answer_position: "Sheet1!B2:B2",
      answer_sheet: "Sheet1",
    })));
    stageSpreadsheetBenchBundle(source, {
      track: "spreadsheetbench-v1",
      outputRoot: stage,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });
    const selected = ["batch-1", "batch-2", "batch-4", "batch-5"];
    let calls = 0;
    const planner: AgentModel = {
      name: "batched-spreadsheetbench-planner",
      async next(input) {
        calls += 1;
        const payload = JSON.parse(input.messages[0].content) as {
          tasks: Array<{ taskId: string; workbook: { cellCount: number } }>;
        };
        expect(payload.tasks.map((task) => task.taskId)).toEqual(selected);
        expect(payload.tasks.every((task) => task.workbook.cellCount <= 4)).toBe(true);
        return {
          text: JSON.stringify({
            schema: 1,
            plans: payload.tasks.map((task) => ({ taskId: task.taskId, operations: [] })),
          }),
          toolCalls: [],
          done: true,
          usage: { inputTokens: 11, outputTokens: 7, cachedInputTokens: 3 },
        };
      },
    };

    const report = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "model-edit-plan",
      model: planner,
      modelName: "batched-spreadsheetbench-planner",
      modelBatchSize: 4,
      modelSnapshotMaxCells: 4,
      modelSnapshotMaxCellChars: 32,
      taskIds: selected,
      clean: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(calls).toBe(1);
    expect(report.results.map((result) => result.taskId)).toEqual(selected);
    expect(report).toMatchObject({
      caseCount: 4,
      passCount: 4,
      harness: {
        modelContextPolicy: {
          batchSize: 4,
          snapshotMaxCells: 4,
          snapshotMaxCellChars: 32,
          selectedTaskCount: 4,
        },
        budget: {
          modelCalls: 1,
          inputTokens: 11,
          outputTokens: 7,
          providerCostUsd: 0,
        },
      },
    });
    expect(report.results.every((result) => result.model?.calls === 0.25)).toBe(true);
    expect(report.results.map((result) => result.model?.usage.inputTokens).reduce<number>((sum, value) => sum + (value ?? 0), 0)).toBe(11);
    expect(report.results.map((result) => result.model?.usage.outputTokens).reduce<number>((sum, value) => sum + (value ?? 0), 0)).toBe(7);
    for (const result of report.results) {
      expect(result.model?.batch).toMatchObject({ taskCount: 4, callShare: 0.25 });
      expectSidecarFile(result.sidecarEvidence?.candidateManifest, `${result.taskId}/candidate-manifest.json`);
      expectSidecarFile(result.sidecarEvidence?.editPlan, `${result.taskId}/model-edit-plan.json`);
      expectSidecarFile(result.sidecarEvidence?.rawModelOutput, `${result.taskId}/model-output.txt`);
      const manifest = JSON.parse(readFileSync(join(out, result.taskId, "candidate-manifest.json"), "utf8"));
      expect(manifest.modelBatch).toMatchObject({ taskCount: 4, callShare: 0.25 });
      expect(manifest.modelContext).toMatchObject({ snapshotMaxCells: 4, snapshotMaxCellChars: 32 });
    }
    expect(existsSync(join(out, "batch-3"))).toBe(false);

    const salvageOut = tempRoot("salvage-out");
    const salvagePlanner: AgentModel = {
      name: "truncated-batch-planner",
      async next() {
        return {
          text: `{"schema":1,"plans":[${selected.slice(0, 3)
            .map((taskId) => JSON.stringify({ taskId, operations: [] }))
            .join(",")},{"taskId":"${selected[3]}","operations":[`,
          toolCalls: [],
          done: true,
          usage: { inputTokens: 8, outputTokens: 4 },
        };
      },
    };
    const salvaged = await runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: salvageOut,
      mode: "model-edit-plan",
      model: salvagePlanner,
      modelBatchSize: 4,
      modelSnapshotMaxCells: 4,
      taskIds: selected,
      clean: true,
    });
    expect(salvaged.results.filter((result) => result.sidecarEvidence?.editPlan?.kind === "generated")).toHaveLength(3);
    expect(salvaged.results.find((result) => result.taskId === selected[3])?.error?.message).toContain("batch omitted");

    await expect(runStagedSpreadsheetBench({
      stageRoot: stage,
      outputRoot: out,
      mode: "copy-input-baseline",
      taskIds: ["unknown-task"],
    })).rejects.toThrow("unknown task");
  });
});

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), `noderoom-spreadsheetbench-runner-${prefix}-`));
  roots.push(root);
  return root;
}

function expectSidecarFile(evidence: { path?: string; sha256?: string; bytes?: number } | undefined, path: string) {
  expect(evidence).toMatchObject({ path });
  expect(evidence?.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(evidence?.bytes).toBeGreaterThan(0);
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeWorkbook(path: string, b2: number) {
  await writeWorkbookWithSheet(path, "Sheet1", b2);
}

async function writeWorkbookWithSheet(path: string, sheetName: string, b2: number) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  sheet.getCell("B2").value = b2;
  await workbook.xlsx.writeFile(path);
}

async function writeWorkbookWithTwoSheets(path: string, answerSheetName: string, otherSheetName: string, b2: number) {
  const workbook = new ExcelJS.Workbook();
  const answer = workbook.addWorksheet(answerSheetName);
  answer.getCell("B2").value = b2;
  const other = workbook.addWorksheet(otherSheetName);
  other.getCell("A1").value = "context";
  await workbook.xlsx.writeFile(path);
}

async function writeChartDataWorkbook(path: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");
  setRowValues(sheet, 1, ["Month", "Revenue"]);
  setRowValues(sheet, 2, ["Jan", 10]);
  setRowValues(sheet, 3, ["Feb", 14]);
  setRowValues(sheet, 4, ["Mar", 18]);
  await workbook.xlsx.writeFile(path);
}

async function writeTwoSheetStarvationWorkbook(path: string, targetValue: number) {
  const workbook = new ExcelJS.Workbook();
  const ranges = workbook.addWorksheet("RANGES");
  for (let row = 1; row <= 160; row++) {
    for (let column = 1; column <= 4; column++) {
      ranges.getCell(row, column).value = `r${row}c${column}`;
    }
  }
  const lists = workbook.addWorksheet("LISTS");
  lists.getCell("A1").value = "target";
  lists.getCell("B2").value = targetValue;
  await workbook.xlsx.writeFile(path);
}

async function writeFormulaRepairWorkbook(path: string, completed: boolean) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("ATTENDENCE");
  for (let column = 1; column <= 12; column++) sheet.getCell(1, column).value = `period-${column}`;
  sheet.getCell("E3").value = { formula: 'TEXT(E4,"ddd")', result: "Mon" };
  sheet.getCell("E4").value = "2024-01-01";
  sheet.getCell("F3").value = completed
    ? { formula: 'TEXT(F4,"ddd")', result: "Tue" }
    : { formula: 'TEXT(F4,"DD")', result: "01" };
  sheet.getCell("F4").value = "2024-01-02";
  sheet.getCell("G3").value = { formula: 'TEXT(G4,"ddd")', result: "Wed" };
  sheet.getCell("G4").value = "2024-01-03";
  await workbook.xlsx.writeFile(path);
}

async function writeAggregateSectionsWorkbook(path: string, completed: boolean) {
  const workbook = new ExcelJS.Workbook();
  const ranges = workbook.addWorksheet("RANGES");
  ranges.getCell("C1").value = "STAGE";
  setRowValues(ranges, 2, ["S.N", "DATE", "BATCH", "REF", "AMOUNTS"]);
  setRowValues(ranges, 3, [1, "2024-01-01", "S1", "AAA", 1]);
  setRowValues(ranges, 4, [2, "2024-01-01", "S2", "AAA", 2]);
  ranges.getCell("C6").value = "DATA";
  setRowValues(ranges, 7, ["S.N", "DATE", "BATCH", "REF", "AMOUNTS"]);
  setRowValues(ranges, 8, [1, "01/02/2024", "B1", "AAA", 5]);
  setRowValues(ranges, 9, [2, "2024-01-02", "B2", "AAA", 7]);
  setRowValues(ranges, 10, [3, "2024-01-03", "B3", "BBB", 2]);

  const lists = workbook.addWorksheet("LISTS");
  lists.getCell("C1").value = "STAGE";
  setRowValues(lists, 2, ["SN", "DATE", "REF", "AMOUNTS"]);
  setRowValues(lists, 3, [1, new Date(Date.UTC(2024, 0, 1)), "AAA", 3]);
  lists.getCell("A4").value = "TOTAL";
  lists.getCell("D4").value = { formula: "SUM(D3:D3)", result: 3 };
  lists.getCell("C6").value = "DATA";
  setRowValues(lists, 7, ["SN", "DATE", "REF", "AMOUNTS"]);
  if (completed) {
    setRowValues(lists, 8, [1, new Date(Date.UTC(2024, 0, 2)), "AAA", 12]);
    setRowValues(lists, 9, [2, new Date(Date.UTC(2024, 0, 3)), "BBB", 2]);
    lists.getCell("A10").value = "TOTAL";
    lists.getCell("D10").value = { formula: "SUM(D8:D9)", result: 14 };
  } else {
    setRowValues(lists, 8, [1, "", "", ""]);
    setRowValues(lists, 9, [2, "", "", ""]);
    lists.getCell("A10").value = "TOTAL";
  }
  await workbook.xlsx.writeFile(path);
}

function setRowValues(sheet: ExcelJS.Worksheet, row: number, values: ExcelJS.CellValue[], startColumn = 1) {
  values.forEach((value, index) => {
    sheet.getCell(row, startColumn + index).value = value;
  });
}

async function writeFilterRowsWorkbook(path: string, completed: boolean) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("FILTER 5b");
  setRowValues(sheet, 1, ["DATE", "SUPPLIER", "TAX", "INV", "AMOUNT"]);
  setRowValues(sheet, 2, [new Date(Date.UTC(2023, 2, 20)), "BEFORE", 1, 10, 100]);
  setRowValues(sheet, 3, [new Date(Date.UTC(2023, 2, 24)), "IN-A", 2, 20, 200]);
  setRowValues(sheet, 4, [new Date(Date.UTC(2023, 3, 4)), "IN-B", 3, 30, 300]);
  setRowValues(sheet, 5, [new Date(Date.UTC(2024, 4, 1)), "AFTER", 4, 40, 400]);
  sheet.getCell("I2").value = new Date(Date.UTC(2023, 2, 22));
  sheet.getCell("J2").value = new Date(Date.UTC(2024, 3, 23));
  setRowValues(sheet, 5, ["DATE", "SUPPLIER", "TAX", "INV", "AMOUNT"], 9);
  if (completed) {
    setRowValues(sheet, 6, [new Date(Date.UTC(2023, 2, 24)), "IN-A", 2, 20, 200], 9);
    setRowValues(sheet, 7, [new Date(Date.UTC(2023, 3, 4)), "IN-B", 3, 30, 300], 9);
  }
  await workbook.xlsx.writeFile(path);
}

async function writeSortUniqueRowsWorkbook(path: string, completed: boolean) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("sheet1");
  setRowValues(sheet, 1, ["ITEM", "NAME", "REF", "", "", "ITEM", "NAME", "REF"]);
  setRowValues(sheet, 2, [1, "BETA", 30]);
  setRowValues(sheet, 3, [2, "ALPHA", 10]);
  setRowValues(sheet, 4, [3, "BETA", 30]);
  setRowValues(sheet, 5, ["ITEM", "NAME", "REF"]);
  setRowValues(sheet, 6, [1, "GAMMA", 20]);
  setRowValues(sheet, 7, [2, "", ""]);
  setRowValues(sheet, 8, [3, "DELTA", 40]);
  if (completed) {
    setRowValues(sheet, 2, [1, "ALPHA", 10], 6);
    setRowValues(sheet, 3, [2, "GAMMA", 20], 6);
    setRowValues(sheet, 4, [3, "BETA", 30], 6);
    setRowValues(sheet, 5, [4, "DELTA", 40], 6);
  }
  await workbook.xlsx.writeFile(path);
}

async function writeFormulaSemanticsWorkbook(path: string, completed: boolean) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A2").value = 1;
  sheet.getCell("A3").value = 1;
  sheet.getCell("B2").value = completed ? { formula: "SUM(A2:A3)", result: 2 } : "";
  sheet.getCell("C2").value = 7;
  if (completed) sheet.getCell("C2").numFmt = "#,##0.00";
  await workbook.xlsx.writeFile(path);
}

async function writeFormulaSubsetWorkbook(path: string, completed: boolean) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A2").value = 10;
  sheet.getCell("A3").value = 20;
  sheet.getCell("B2").value = 10;
  sheet.getCell("C2").value = completed ? { formula: "A2*2+B2/2", result: 25 } : "";
  sheet.getCell("D2").value = completed ? { formula: "AVERAGE(A2:A3)", result: 15 } : "";
  sheet.getCell("E2").value = completed ? { formula: "MAX(A2:A3)-MIN(A2:A3)", result: 10 } : "";
  sheet.getCell("F2").value = completed ? { formula: "COUNT(A2:A3)", result: 2 } : "";
  await workbook.xlsx.writeFile(path);
}

async function writeBusinessFormulaWorkbook(path: string, completed: boolean) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A2").value = 120;
  sheet.getCell("A3").value = 80;
  sheet.getCell("A4").value = 55;
  sheet.getCell("B2").value = -12.345;
  sheet.getCell("B3").value = 2.718;
  sheet.getCell("C2").value = "North";
  sheet.getCell("C3").value = "South";
  sheet.getCell("C4").value = "North";
  sheet.getCell("D2").value = 10;
  sheet.getCell("D3").value = 20;
  sheet.getCell("D4").value = 30;
  sheet.getCell("E2").value = completed ? { formula: "IF(A2>100,ROUND(ABS(B2),1),0)", result: 12.3 } : "";
  sheet.getCell("F2").value = completed ? { formula: "SUMIF(C2:C4,\"North\",D2:D4)", result: 40 } : "";
  sheet.getCell("G2").value = completed ? { formula: "COUNTIF(A2:A4,\">=80\")", result: 2 } : "";
  sheet.getCell("H2").value = completed ? { formula: "COUNTA(C2:C4)", result: 3 } : "";
  sheet.getCell("I2").value = completed ? { formula: "IFERROR(1/0,99)", result: 99 } : "";
  sheet.getCell("J2").value = completed ? { formula: "ROUNDUP(B3,1)", result: 2.8 } : "";
  sheet.getCell("K2").value = completed ? { formula: "ROUNDDOWN(B3,1)", result: 2.7 } : "";
  sheet.getCell("L2").value = completed ? { formula: "SUMIFS(D2:D4,C2:C4,\"North\",A2:A4,\">=60\")", result: 10 } : "";
  sheet.getCell("M2").value = completed ? { formula: "COUNTIFS(C2:C4,\"No*\",A2:A4,\">50\")", result: 2 } : "";
  sheet.getCell("N2").value = completed ? { formula: "AVERAGEIF(C2:C4,\"North\",D2:D4)", result: 20 } : "";
  sheet.getCell("O2").value = completed ? { formula: "AVERAGEIFS(D2:D4,C2:C4,\"North\",A2:A4,\">=60\")", result: 10 } : "";
  sheet.getCell("P2").value = completed ? { formula: "SUMIFS(D2:D4,C2:C4,\"<>South\",A2:A4,\">50\")", result: 40 } : "";
  sheet.getCell("Q2").value = completed ? { formula: "IF(AND(A2>=100,D2=10),\"PASS\",\"FAIL\")", result: "PASS" } : "";
  sheet.getCell("R2").value = completed ? { formula: "OR(A2<100,C2=\"North\")", result: true } : "";
  sheet.getCell("S2").value = completed ? { formula: "NOT(C2=\"South\")", result: true } : "";
  await workbook.xlsx.writeFile(path);
}

async function writeLookupFormulaWorkbook(path: string, completed: boolean) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A1").value = "SKU";
  sheet.getCell("B1").value = "Category";
  sheet.getCell("C1").value = "Revenue";
  sheet.getCell("A2").value = "SKU1";
  sheet.getCell("A3").value = "SKU2";
  sheet.getCell("A4").value = "SKU3";
  sheet.getCell("B2").value = "North";
  sheet.getCell("B3").value = "South";
  sheet.getCell("B4").value = "West";
  sheet.getCell("C2").value = 10;
  sheet.getCell("C3").value = 20;
  sheet.getCell("C4").value = 30;
  sheet.getCell("D2").value = completed ? { formula: "MATCH(\"SKU2\",A2:A4,0)", result: 2 } : "";
  sheet.getCell("E2").value = completed ? { formula: "INDEX(B2:C4,2,2)", result: 20 } : "";
  sheet.getCell("F2").value = completed ? { formula: "VLOOKUP(\"SKU3\",A2:C4,3,FALSE)", result: 30 } : "";
  sheet.getCell("G2").value = completed ? { formula: "XLOOKUP(\"SKU1\",A2:A4,C2:C4)", result: 10 } : "";
  sheet.getCell("H2").value = completed ? { formula: "INDEX(C2:C4,MATCH(\"SKU3\",A2:A4,0),1)", result: 30 } : "";
  setRowValues(sheet, 6, ["K1", 10, 20]);
  setRowValues(sheet, 7, ["K2", 30, 40]);
  setRowValues(sheet, 8, ["K3", 50, 60]);
  sheet.getCell("I2").value = completed ? { formula: "MEDIAN(15,VLOOKUP(\"K1\",A6:C8,{2,3},FALSE))", result: 15 } : "";
  sheet.getCell("J2").value = completed ? { formula: "IF(MEDIAN(15,VLOOKUP(\"K1\",A6:C8,{2,3},FALSE))=15,\"Pass\",\"Fail\")", result: "Pass" } : "";
  await workbook.xlsx.writeFile(path);
}

async function writeTextDateFormulaWorkbook(path: string, completed: boolean) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.getCell("A1").value = "Code";
  sheet.getCell("B1").value = "Region";
  sheet.getCell("C1").value = "Rank";
  sheet.getCell("A2").value = "ABC-XYZ-1234";
  sheet.getCell("B2").value = "West";
  sheet.getCell("C2").value = 7;
  sheet.getCell("A5").value = "Units";
  sheet.getCell("B5").value = 2;
  sheet.getCell("C5").value = 10;
  sheet.getCell("B6").value = 3;
  sheet.getCell("C6").value = 4;
  sheet.getCell("D2").value = completed ? { formula: "LEFT(A2,3)", result: "ABC" } : "";
  sheet.getCell("E2").value = completed ? { formula: "RIGHT(A2,4)", result: "1234" } : "";
  sheet.getCell("F2").value = completed ? { formula: "MID(A2,5,3)", result: "XYZ" } : "";
  sheet.getCell("G2").value = completed ? { formula: "LEN(A2)", result: 12 } : "";
  sheet.getCell("H2").value = completed ? { formula: "FIND(\"-\",A2)", result: 4 } : "";
  sheet.getCell("I2").value = completed ? { formula: "SEARCH(\"west\",B2)", result: 1 } : "";
  sheet.getCell("J2").value = completed ? { formula: "REPLACE(A2,5,3,\"999\")", result: "ABC-999-1234" } : "";
  sheet.getCell("K2").value = completed ? { formula: "TEXT(DATE(2024,1,1),\"dddd\")", result: "Monday" } : "";
  sheet.getCell("L2").value = completed ? { formula: "SUMPRODUCT(B5:B6,C5:C6)", result: 32 } : "";
  sheet.getCell("M2").value = completed ? { formula: "VALUE(\"12.5%\")", result: 0.125 } : "";
  sheet.getCell("N2").value = completed ? { formula: "TRIM(CONCATENATE(\"  \",B2,\" \",C2,\"  \"))", result: "West 7" } : "";
  await workbook.xlsx.writeFile(path);
}
