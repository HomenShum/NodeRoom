import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import {
  SPREADSHEET_BENCH_CHART_AGENT_INSTRUCTIONS,
  SPREADSHEET_BENCH_CHART_OPERATION_JSON_SCHEMA,
  SPREADSHEET_BENCH_CHART_TYPES,
  isSpreadsheetBenchChartBridgeReceipt,
  parseSpreadsheetBenchChartRange,
  validateSpreadsheetBenchChartOperations,
  type SpreadsheetBenchChartBridgeReceipt,
  type SpreadsheetBenchChartOperation,
} from "../src/eval/spreadsheetBenchChartContract";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench chart contract", () => {
  it("publishes every supported chart type and validates a bounded cross-sheet operation matrix", () => {
    const operations = chartOperationMatrix();
    const result = validateSpreadsheetBenchChartOperations(operations, {
      sheets: [
        { name: "Data", maxRow: 6, maxColumn: 7, state: "visible" },
        { name: "Charts", maxRow: 1, maxColumn: 1, state: "visible" },
      ],
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.charts).toHaveLength(9);
    expect(result.charts.map((item) => item.effectiveChartType)).toEqual([
      "line", "bar", "column", "pie", "doughnut", "scatter", "area", "bubble", "combo",
    ]);
    expect(result.charts[8].operation.series[1]).toMatchObject({ chartType: "line", secondaryAxis: true });
    expect(result.charts[0].categoryRange.formula).toBe("'Data'!$A$2:$A$6");
    expect(SPREADSHEET_BENCH_CHART_OPERATION_JSON_SCHEMA.properties.chartType.enum).toEqual(SPREADSHEET_BENCH_CHART_TYPES);
    for (const chartType of SPREADSHEET_BENCH_CHART_TYPES) {
      expect(SPREADSHEET_BENCH_CHART_AGENT_INSTRUCTIONS).toContain(chartType);
    }
    expect(SPREADSHEET_BENCH_CHART_AGENT_INSTRUCTIONS).toContain("must return a receipt");
  });

  it("rejects ambiguous ranges, invalid presentation metadata, and structurally incomplete chart types", () => {
    const workbook = {
      sheets: [
        { name: "Data", maxRow: 6, maxColumn: 7, state: "visible" as const },
        { name: "Charts", maxRow: 1, maxColumn: 1, state: "visible" as const },
      ],
    };
    const cases: Array<{ operation: SpreadsheetBenchChartOperation; code: string }> = [
      { operation: { ...chartOperationMatrix()[0], title: " " }, code: "required_text" },
      { operation: { ...chartOperationMatrix()[0], categoryRange: "'Data'!A2:B6" }, code: "invalid_source_range" },
      { operation: { ...chartOperationMatrix()[0], anchor: "XFE1" }, code: "invalid_anchor" },
      { operation: { ...chartOperationMatrix()[0], legendPosition: "middle" as "right" }, code: "invalid_legend" },
      {
        operation: {
          ...chartOperationMatrix()[7],
          series: [{ ...chartOperationMatrix()[7].series[0], sizeRange: undefined }],
        },
        code: "missing_size_range",
      },
      {
        operation: {
          ...chartOperationMatrix()[8],
          series: [{ ...chartOperationMatrix()[8].series[0], chartType: undefined }],
        },
        code: "combo_series_count",
      },
      {
        operation: {
          ...chartOperationMatrix()[0],
          series: [{ ...chartOperationMatrix()[0].series[0], valuesRange: "'Data'!B2:B5" }],
        },
        code: "point_count_mismatch",
      },
    ];

    for (const { operation, code } of cases) {
      const result = validateSpreadsheetBenchChartOperations([operation], workbook);
      expect(result.ok, code).toBe(false);
      if (result.ok) continue;
      expect(result.issues.map((issue) => issue.code), JSON.stringify(result.issues)).toContain(code);
    }

    const duplicateAnchor = validateSpreadsheetBenchChartOperations([
      chartOperationMatrix()[0],
      { ...chartOperationMatrix()[1], anchor: chartOperationMatrix()[0].anchor },
    ], workbook);
    expect(duplicateAnchor).toMatchObject({ ok: false, issues: expect.arrayContaining([expect.objectContaining({ code: "duplicate_anchor" })]) });
    expect(parseSpreadsheetBenchChartRange("'Data''s Q1'!$A$2:$A$5", "Fallback")).toMatchObject({
      sheet: "Data's Q1",
      pointCount: 4,
      formula: "'Data''s Q1'!$A$2:$A$5",
    });
  });
});

describe("SpreadsheetBench XLSX chart bridge", () => {
  it("persists line, bar, column, pie, doughnut, scatter, area, bubble, and combo chart objects with receipts", async () => {
    const root = makeTempRoot("matrix");
    const workbookPath = join(root, "synthetic-chart-matrix.xlsx");
    const operationsPath = join(root, "chart-operations.json");
    const receiptPath = join(root, "chart-application-receipt.json");
    await writeSyntheticWorkbook(workbookPath);
    writeFileSync(operationsPath, JSON.stringify({ schema: 1, workbook: "synthetic-chart-matrix.xlsx", operations: chartOperationMatrix() }, null, 2));

    const bridge = runChartBridge(workbookPath, operationsPath, receiptPath);
    expect(bridge.status, bridge.stderr || bridge.stdout).toBe(0);
    const stdoutReceipt = JSON.parse(bridge.stdout.trim()) as unknown;
    expect(isSpreadsheetBenchChartBridgeReceipt(stdoutReceipt)).toBe(true);

    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as SpreadsheetBenchChartBridgeReceipt;
    expect(isSpreadsheetBenchChartBridgeReceipt(receipt)).toBe(true);
    expect(receipt).toMatchObject({
      status: "applied",
      engine: chartTestEngine(),
      appliedChartCount: 9,
      operationCount: 9,
      package: {
        chartObjectCountBefore: 0,
        chartObjectCountAfter: 9,
        chartPartCountBefore: 0,
        chartPartCountAfter: 9,
        drawingPartCountAfter: 1,
      },
    });
    expect(receipt.operations).toHaveLength(9);
    expect(receipt.operations.every((operation) => operation.verified && /^xl\/charts\/chart\d+\.xml$/.test(operation.chartPart))).toBe(true);

    const zip = await JSZip.loadAsync(readFileSync(workbookPath));
    const chartPaths = Object.keys(zip.files).filter((path) => /^xl\/charts\/chart\d+\.xml$/.test(path)).sort(naturalPartSort);
    expect(chartPaths).toHaveLength(9);
    const chartXml = await Promise.all(chartPaths.map(async (path) => ({ path, xml: await zip.file(path)!.async("string") })));

    assertChartXml(chartXml, "Line Trend", ["lineChart"], ["Data!A2:A6", "Data!B2:B6"]);
    assertChartXml(chartXml, "Horizontal Cost", ["barChart"], ["Data!A2:A6", "Data!C2:C6"], "bar");
    assertChartXml(chartXml, "Revenue Columns", ["barChart"], ["Data!A2:A6", "Data!B2:B6"], "col");
    assertChartXml(chartXml, "Revenue Share", ["pieChart"], ["Data!A2:A6", "Data!B2:B6"]);
    assertChartXml(chartXml, "Cost Ring", ["doughnutChart"], ["Data!A2:A6", "Data!C2:C6"]);
    assertChartXml(chartXml, "XY Relationship", ["scatterChart"], ["Data!D2:D6", "Data!E2:E6"]);
    assertChartXml(chartXml, "Revenue Area", ["areaChart"], ["Data!A2:A6", "Data!B2:B6"]);
    assertChartXml(chartXml, "Bubble Portfolio", ["bubbleChart"], ["Data!D2:D6", "Data!E2:E6", "Data!F2:F6"]);
    const comboXml = assertChartXml(
      chartXml,
      "Revenue and Margin",
      ["barChart", "lineChart"],
      ["Data!A2:A6", "Data!B2:B6", "Data!G2:G6"],
      "col",
    );
    expect(countElements(comboXml, "valAx")).toBeGreaterThanOrEqual(2);
    expect(countElements(comboXml, "ser")).toBe(2);
    for (const [title, position] of [
      ["Line Trend", "b"],
      ["Horizontal Cost", "l"],
      ["Revenue Columns", "r"],
      ["Revenue Share", null],
      ["Cost Ring", "t"],
      ["XY Relationship", "b"],
      ["Revenue Area", "r"],
      ["Bubble Portfolio", "l"],
      ["Revenue and Margin", "b"],
    ] as const) assertChartLegend(chartXml, title, position);

    const drawingPath = Object.keys(zip.files).find((path) => /^xl\/drawings\/drawing\d+\.xml$/.test(path));
    expect(drawingPath).toBeTruthy();
    const drawingXml = await zip.file(drawingPath!)!.async("string");
    expect(countElements(drawingXml, "oneCellAnchor") + countElements(drawingXml, "twoCellAnchor")).toBe(9);
    for (const operation of chartOperationMatrix()) expectDrawingAnchor(drawingXml, operation.anchor);

    const drawingRelationships = Object.keys(zip.files).find((path) => /^xl\/drawings\/_rels\/drawing\d+\.xml\.rels$/.test(path));
    expect(drawingRelationships).toBeTruthy();
    const relationshipXml = await zip.file(drawingRelationships!)!.async("string");
    expect((relationshipXml.match(/relationships\/chart"/g) ?? [])).toHaveLength(9);
    const contentTypes = await zip.file("[Content_Types].xml")!.async("string");
    expect((contentTypes.match(/application\/vnd\.openxmlformats-officedocument\.drawingml\.chart\+xml/g) ?? [])).toHaveLength(9);
  }, 30_000);

  it("rejects a mismatched source range without mutating the workbook and writes a rejection receipt", async () => {
    const root = makeTempRoot("rejected");
    const workbookPath = join(root, "synthetic-invalid-chart.xlsx");
    const operationsPath = join(root, "chart-operations.json");
    const receiptPath = join(root, "chart-application-receipt.json");
    await writeSyntheticWorkbook(workbookPath);
    const beforeHash = sha256(readFileSync(workbookPath));
    const invalidOperation: SpreadsheetBenchChartOperation = {
      ...chartOperationMatrix()[0],
      series: [{ ...chartOperationMatrix()[0].series[0], valuesRange: "'Data'!B2:B5" }],
    };
    writeFileSync(operationsPath, JSON.stringify({ schema: 1, operations: [invalidOperation] }, null, 2));

    const bridge = runChartBridge(workbookPath, operationsPath, receiptPath);
    expect(bridge.status).toBe(2);
    expect(sha256(readFileSync(workbookPath))).toBe(beforeHash);
    expect(existsSync(receiptPath)).toBe(true);
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8")) as SpreadsheetBenchChartBridgeReceipt;
    expect(isSpreadsheetBenchChartBridgeReceipt(receipt)).toBe(true);
    expect(receipt).toMatchObject({
      status: "rejected",
      appliedChartCount: 0,
      operationCount: 1,
      package: { chartPartCountBefore: 0, chartPartCountAfter: 0 },
      error: { type: "ChartContractError" },
    });
    expect(receipt.error?.message).toContain("points; expected");
    const zip = await JSZip.loadAsync(readFileSync(workbookPath));
    expect(Object.keys(zip.files).filter((path) => /^xl\/charts\/chart\d+\.xml$/.test(path))).toHaveLength(0);
    expect(readdirSync(root).some((name) => name.includes(".charts-"))).toBe(false);
  }, 30_000);
});

function chartOperationMatrix(): SpreadsheetBenchChartOperation[] {
  const categoryRange = "'Data'!A2:A6";
  return [
    {
      op: "add_chart", sheet: "Charts", chartType: "line", title: "Line Trend", categoryRange,
      series: [{ name: "Revenue", valuesRange: "'Data'!B2:B6", color: "2563EB" }],
      anchor: "A1", legendPosition: "bottom", dataLabels: true,
    },
    {
      op: "add_chart", sheet: "Charts", chartType: "bar", title: "Horizontal Cost", categoryRange,
      series: [{ name: "Cost", valuesRange: "'Data'!C2:C6", color: "DC2626" }],
      anchor: "D1", legendPosition: "left", grouping: "stacked",
    },
    {
      op: "add_chart", sheet: "Charts", chartType: "column", title: "Revenue Columns", categoryRange,
      series: [{ name: "Revenue", valuesRange: "'Data'!B2:B6", color: "16A34A" }],
      anchor: "G1", legendPosition: "right",
    },
    {
      op: "add_chart", sheet: "Charts", chartType: "pie", title: "Revenue Share", categoryRange,
      series: [{ name: "Revenue", valuesRange: "'Data'!B2:B6" }],
      anchor: "J1", legendPosition: "none", dataLabels: true,
    },
    {
      op: "add_chart", sheet: "Charts", chartType: "doughnut", title: "Cost Ring", categoryRange,
      series: [{ name: "Cost", valuesRange: "'Data'!C2:C6" }],
      anchor: "M1", legendPosition: "top",
    },
    {
      op: "add_chart", sheet: "Charts", chartType: "scatter", title: "XY Relationship", categoryRange,
      series: [{ name: "XY", valuesRange: "'Data'!E2:E6", xValuesRange: "'Data'!D2:D6", color: "7C3AED" }],
      anchor: "A20", legendPosition: "bottom",
    },
    {
      op: "add_chart", sheet: "Charts", chartType: "area", title: "Revenue Area", categoryRange,
      series: [{ name: "Revenue", valuesRange: "'Data'!B2:B6", color: "0891B2" }],
      anchor: "D20", legendPosition: "right",
    },
    {
      op: "add_chart", sheet: "Charts", chartType: "bubble", title: "Bubble Portfolio", categoryRange,
      series: [{
        name: "Portfolio", valuesRange: "'Data'!E2:E6", xValuesRange: "'Data'!D2:D6",
        sizeRange: "'Data'!F2:F6", color: "EA580C",
      }],
      anchor: "G20", legendPosition: "left",
    },
    {
      op: "add_chart", sheet: "Charts", chartType: "combo", title: "Revenue and Margin", categoryRange,
      series: [
        { name: "Revenue", valuesRange: "'Data'!B2:B6", chartType: "column", color: "2563EB" },
        { name: "Margin", valuesRange: "'Data'!G2:G6", chartType: "line", color: "DC2626", secondaryAxis: true },
      ],
      anchor: "J20", legendPosition: "bottom",
    },
  ];
}

async function writeSyntheticWorkbook(path: string) {
  const workbook = new ExcelJS.Workbook();
  const data = workbook.addWorksheet("Data");
  data.addRow(["Category", "Revenue", "Cost", "X", "Y", "Size", "Margin"]);
  data.addRow(["Jan", 100, 60, 1, 5, 10, 0.4]);
  data.addRow(["Feb", 120, 70, 2, 8, 20, 0.4167]);
  data.addRow(["Mar", 90, 50, 3, 7, 14, 0.4444]);
  data.addRow(["Apr", 150, 85, 4, 12, 28, 0.4333]);
  data.addRow(["May", 170, 95, 5, 15, 35, 0.4412]);
  workbook.addWorksheet("Charts").getCell("A1").value = "Synthetic chart output";
  await workbook.xlsx.writeFile(path);
}

function runChartBridge(workbookPath: string, operationsPath: string, receiptPath: string) {
  const python = process.env.SPREADSHEETBENCH_PYTHON?.trim() || process.env.PYTHON?.trim() || "python";
  return spawnSync(python, [
    resolve("scripts/spreadsheetbench-apply-charts.py"),
    "--workbook", workbookPath,
    "--operations", operationsPath,
    "--receipt", receiptPath,
    "--engine", chartTestEngine(),
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
}

function chartTestEngine(): "excel" | "openpyxl" {
  return process.env.SPREADSHEETBENCH_CHART_TEST_ENGINE?.trim() === "excel" ? "excel" : "openpyxl";
}

function assertChartXml(
  chartXml: Array<{ path: string; xml: string }>,
  title: string,
  elements: string[],
  sources: string[],
  barDirection?: "bar" | "col",
): string {
  const match = chartXml.find((item) => item.xml.includes(`>${title}<`));
  expect(match, `missing chart titled ${title}`).toBeTruthy();
  const xml = match!.xml;
  for (const element of elements) expect(hasElement(xml, element), `${title} missing ${element}`).toBe(true);
  const normalized = xml.replace(/\$/g, "").replace(/'/g, "");
  for (const source of sources) expect(normalized, `${title} missing ${source}`).toContain(source);
  if (barDirection) expect(xml).toMatch(new RegExp(`<(?:[A-Za-z0-9]+:)?barDir[^>]+val=["']${barDirection}["']`));
  return xml;
}

function hasElement(xml: string, localName: string): boolean {
  return new RegExp(`<(?:[A-Za-z0-9]+:)?${localName}(?:\\s|>)`).test(xml);
}

function assertChartLegend(
  chartXml: Array<{ path: string; xml: string }>,
  title: string,
  position: "t" | "b" | "l" | "r" | null,
) {
  const xml = chartXml.find((item) => item.xml.includes(`>${title}<`))?.xml;
  expect(xml, `missing chart titled ${title}`).toBeTruthy();
  if (position === null) {
    expect(hasElement(xml!, "legend"), `${title} should not have a legend`).toBe(false);
    return;
  }
  expect(xml).toMatch(new RegExp(`<(?:[A-Za-z0-9]+:)?legendPos[^>]+val=["']${position}["']`));
}

function countElements(xml: string, localName: string): number {
  return (xml.match(new RegExp(`<(?:[A-Za-z0-9]+:)?${localName}(?:\\s|>)`, "g")) ?? []).length;
}

function expectDrawingAnchor(xml: string, anchor: string) {
  const match = anchor.match(/^([A-Z]+)([0-9]+)$/)!;
  const column = columnNameToNumber(match[1]) - 1;
  const row = Number(match[2]) - 1;
  const anchorPattern = new RegExp(
    `<(?:[A-Za-z0-9]+:)?from>\\s*<(?:[A-Za-z0-9]+:)?col>${column}<\\/(?:[A-Za-z0-9]+:)?col>[\\s\\S]*?<(?:[A-Za-z0-9]+:)?row>${row}<\\/(?:[A-Za-z0-9]+:)?row>`,
  );
  expect(xml, `missing drawing anchor ${anchor}`).toMatch(anchorPattern);
}

function columnNameToNumber(name: string): number {
  let result = 0;
  for (const char of name) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
}

function naturalPartSort(left: string, right: string): number {
  return Number(left.match(/(\d+)\.xml$/)?.[1] ?? 0) - Number(right.match(/(\d+)\.xml$/)?.[1] ?? 0);
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function makeTempRoot(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `noderoom-chart-${label}-`));
  tempRoots.push(root);
  return root;
}
