import ExcelJS from "exceljs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { parseAnswerPosition, scoreSpreadsheetBenchWorkbook } from "../src/eval/spreadsheetBenchScorer";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SpreadsheetBench workbook scorer", () => {
  it("parses quoted multi-sheet answer ranges", () => {
    expect(parseAnswerPosition("'Valuation'!C3:D4,'Ratio Analysis'!B2:B3,'PP&E, Debt, NWC'!B2:L91")).toEqual([
      { sheetName: "Valuation", startRow: 3, endRow: 4, startCol: 3, endCol: 4, label: "'Valuation'!C3:D4" },
      { sheetName: "Ratio Analysis", startRow: 2, endRow: 3, startCol: 2, endCol: 2, label: "'Ratio Analysis'!B2:B3" },
      { sheetName: "PP&E, Debt, NWC", startRow: 2, endRow: 91, startCol: 2, endCol: 12, label: "'PP&E, Debt, NWC'!B2:L91" },
    ]);
  });

  it("normalizes malformed official answer-position sheet quotes and shorthand ranges", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet3 = workbook.addWorksheet("Sheet3");
    const outCas = workbook.addWorksheet("OUT CAS");
    sheet3.getCell("A1").value = "a";
    sheet3.getCell("G4").value = "g";
    outCas.getCell("BD308").value = "tail";

    expect(parseAnswerPosition("'PL Recon Items!'A1:D2,'Statement Recon Items!'A1:J3")).toEqual([
      { sheetName: "PL Recon Items", startRow: 1, endRow: 2, startCol: 1, endCol: 4, label: "'PL Recon Items'!A1:D2" },
      { sheetName: "Statement Recon Items", startRow: 1, endRow: 3, startCol: 1, endCol: 10, label: "'Statement Recon Items'!A1:J3" },
    ]);
    expect(parseAnswerPosition("'99250!A1:F9','99251!A1:F9'")).toEqual([
      { sheetName: "99250", startRow: 1, endRow: 9, startCol: 1, endCol: 6, label: "'99250'!A1:F9" },
      { sheetName: "99251", startRow: 1, endRow: 9, startCol: 1, endCol: 6, label: "'99251'!A1:F9" },
    ]);
    expect(parseAnswerPosition("Sheet3'!A:G", undefined, workbook)).toEqual([
      { sheetName: "Sheet3", startRow: 1, endRow: 4, startCol: 1, endCol: 7, label: "'Sheet3'!A:G" },
    ]);
    expect(parseAnswerPosition("OUT CAS'!BD2:308", undefined, workbook)).toEqual([
      { sheetName: "OUT CAS", startRow: 2, endRow: 308, startCol: 56, endCol: 56, label: "'OUT CAS'!BD2:308" },
    ]);
    expect(parseAnswerPosition("G12：J15")).toEqual([
      { sheetName: undefined, startRow: 12, endRow: 15, startCol: 7, endCol: 10, label: "G12:J15" },
    ]);
    expect(parseAnswerPosition("'Received'!'Received!A1:G16'", "Received")).toEqual([
      { sheetName: "Received", startRow: 1, endRow: 16, startCol: 1, endCol: 7, label: "'Received'!A1:G16" },
    ]);
  });

  it("passes when candidate workbook matches evaluator-only gold across values, formulas, and styles", async () => {
    const root = tempRoot();
    const candidate = join(root, "candidate.xlsx");
    const gold = join(root, "gold.xlsx");
    await writeWorkbook(candidate, { value: 24, formula: "B2*2", bold: true, numFmt: "$#,##0" });
    await writeWorkbook(gold, { value: 24, formula: "B2*2", bold: true, numFmt: "$#,##0" });

    const score = await scoreSpreadsheetBenchWorkbook({
      taskId: "fixture/pass",
      candidateWorkbookPath: candidate,
      goldWorkbookPath: gold,
      answerPosition: "'Model'!B2:C2",
      compareStyles: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(score.pass).toBe(true);
    expect(score.totals).toMatchObject({
      comparedCells: 2,
      valueMatches: 2,
      formulaCells: 1,
      formulaMatches: 1,
      styleCells: 2,
      styleMatches: 2,
      mismatches: 0,
    });
    expect(score.scores).toMatchObject({ value: 1, formula: 1, style: 1, overall: 1 });
  });

  it("reports value, formula, and style mismatches without mutating either workbook", async () => {
    const root = tempRoot();
    const candidate = join(root, "candidate.xlsx");
    const gold = join(root, "gold.xlsx");
    await writeWorkbook(candidate, { value: 23, formula: "B2+1", bold: false, numFmt: "0.0%" });
    await writeWorkbook(gold, { value: 24, formula: "B2*2", bold: true, numFmt: "$#,##0" });

    const score = await scoreSpreadsheetBenchWorkbook({
      taskId: "fixture/fail",
      candidateWorkbookPath: candidate,
      goldWorkbookPath: gold,
      answerPosition: "'Model'!B2:C2",
      compareStyles: true,
      maxMismatches: 10,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(score.pass).toBe(false);
    expect(score.totals.comparedCells).toBe(2);
    expect(score.totals.mismatches).toBeGreaterThanOrEqual(3);
    expect(score.mismatches.map((item) => item.kind)).toEqual(expect.arrayContaining(["value", "formula", "style"]));
    expect(score.scores.overall).toBeLessThan(1);
  });

  it("does not penalize a value-equivalent candidate formula when gold stores a scalar result", async () => {
    const root = tempRoot();
    const candidate = join(root, "candidate.xlsx");
    const gold = join(root, "gold.xlsx");
    await writeFormulaVsScalarWorkbook(candidate, "formula");
    await writeFormulaVsScalarWorkbook(gold, "scalar");

    const score = await scoreSpreadsheetBenchWorkbook({
      taskId: "fixture/formula-scalar-equivalence",
      candidateWorkbookPath: candidate,
      goldWorkbookPath: gold,
      answerPosition: "'Model'!B2:C2",
      maxMismatches: 10,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(score.pass).toBe(true);
    expect(score.totals).toMatchObject({
      comparedCells: 2,
      valueMatches: 2,
      formulaCells: 0,
      formulaMatches: 0,
      mismatches: 0,
    });
    expect(score.scores).toMatchObject({ value: 1, formula: null, overall: 1 });
  });

  it("scores row, column, and merge layout drift when style comparison is enabled", async () => {
    const root = tempRoot();
    const candidate = join(root, "candidate.xlsx");
    const gold = join(root, "gold.xlsx");
    await writeLayoutWorkbook(candidate, { formatted: false });
    await writeLayoutWorkbook(gold, { formatted: true });

    const score = await scoreSpreadsheetBenchWorkbook({
      taskId: "fixture/layout",
      candidateWorkbookPath: candidate,
      goldWorkbookPath: gold,
      answerPosition: "'Model'!B2:B3",
      compareStyles: true,
      maxMismatches: 10,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(score.pass).toBe(false);
    expect(score.totals).toMatchObject({
      comparedCells: 2,
      valueMatches: 2,
      styleCells: 2,
      styleMatches: 2,
      styleLayoutItems: 4,
      styleLayoutMatches: 1,
    });
    expect(score.mismatches).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "style", cell: "column:B" }),
      expect.objectContaining({ kind: "style", cell: "row:2" }),
      expect.objectContaining({ kind: "style", cell: "merges" }),
    ]));
    expect(score.scores.style).toBeLessThan(1);
  });

  it("includes optional static chart-package evidence in workbook scores", async () => {
    const root = tempRoot();
    const candidate = join(root, "candidate.xlsx");
    const gold = join(root, "gold.xlsx");
    await writeWorkbook(candidate, { value: 24, formula: "B2*2", bold: true, numFmt: "$#,##0" });
    await writeWorkbook(gold, { value: 24, formula: "B2*2", bold: true, numFmt: "$#,##0" });
    appendStoredZipEntries(candidate, [
      ["xl/charts/chart1.xml", "<c:chartSpace><c:title><c:v>Revenue</c:v></c:title></c:chartSpace>"],
      ["xl/drawings/drawing1.xml", "<xdr:wsDr><xdr:twoCellAnchor/></xdr:wsDr>"],
    ]);
    appendStoredZipEntries(gold, [
      ["xl/charts/chart1.xml", "<c:chartSpace>\n<c:title><c:v>Revenue</c:v></c:title>\n</c:chartSpace>"],
      ["xl/drawings/drawing1.xml", "<xdr:wsDr><xdr:twoCellAnchor/></xdr:wsDr>"],
    ]);

    const score = await scoreSpreadsheetBenchWorkbook({
      taskId: "fixture/chart",
      candidateWorkbookPath: candidate,
      goldWorkbookPath: gold,
      answerPosition: "'Model'!B2:C2",
      compareCharts: true,
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(score.pass).toBe(true);
    expect(score.scores.chartPackage).toBe(1);
    expect(score.chartPackage).toMatchObject({
      verifier: "xlsx_chart_package_static",
      pass: true,
      totals: {
        goldChartParts: 2,
        candidateChartParts: 2,
        matchedChartParts: 2,
      },
    });
    expect(score.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining("not a rendered visual or VLM"),
    ]));
  });

  it("scores invalid ExcelJS date objects as blank values instead of throwing", async () => {
    const root = tempRoot();
    const candidate = join(root, "candidate.xlsx");
    const gold = join(root, "gold.xlsx");
    await writeInvalidDateWorkbook(candidate);
    await writeInvalidDateWorkbook(gold);

    const score = await scoreSpreadsheetBenchWorkbook({
      taskId: "fixture/invalid-date",
      candidateWorkbookPath: candidate,
      goldWorkbookPath: gold,
      answerPosition: "'Model'!A1:A1",
      generatedAt: "2026-06-13T00:00:00.000Z",
    });

    expect(score.pass).toBe(true);
    expect(score.totals.comparedCells).toBe(1);
    expect(score.totals.mismatches).toBe(0);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "noderoom-spreadsheetbench-score-"));
  roots.push(root);
  return root;
}

async function writeWorkbook(path: string, args: { value: number; formula: string; bold: boolean; numFmt: string }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Model");
  sheet.getCell("B2").value = args.value;
  sheet.getCell("B2").numFmt = args.numFmt;
  sheet.getCell("B2").font = { bold: args.bold };
  sheet.getCell("C2").value = { formula: args.formula, result: args.value * 2 };
  sheet.getCell("C2").numFmt = args.numFmt;
  sheet.getCell("C2").font = { bold: args.bold };
  await workbook.xlsx.writeFile(path);
}

async function writeFormulaVsScalarWorkbook(path: string, mode: "formula" | "scalar") {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Model");
  sheet.getCell("B2").value = 12;
  sheet.getCell("C2").value = mode === "formula" ? { formula: "B2*2", result: 24 } : 24;
  await workbook.xlsx.writeFile(path);
}

async function writeLayoutWorkbook(path: string, args: { formatted: boolean }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Model");
  sheet.getCell("B2").value = "Section";
  sheet.getCell("B3").value = 42;
  sheet.getCell("B2").font = { bold: true };
  sheet.getCell("B3").font = { bold: false };
  if (args.formatted) {
    sheet.getColumn("B").width = 28;
    sheet.getRow(2).height = 32;
    sheet.mergeCells("B2:C2");
  }
  await workbook.xlsx.writeFile(path);
}

async function writeInvalidDateWorkbook(path: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Model");
  sheet.getCell("A1").value = new Date(Number.NaN);
  await workbook.xlsx.writeFile(path);
}

function appendStoredZipEntries(path: string, entries: Array<[string, string]>) {
  const buffer = readFileSync(path);
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const oldEntryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const prefix = buffer.subarray(0, centralDirectoryOffset);
  const oldCentralDirectory = buffer.subarray(centralDirectoryOffset, centralDirectoryOffset + centralDirectorySize);
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = prefix.length;

  for (const [name, text] of entries) {
    const nameBuffer = Buffer.from(name, "utf8");
    const content = Buffer.from(text, "utf8");
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(content.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(content.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + content.length;
  }

  const localData = Buffer.concat(localParts);
  const centralDirectoryOffsetNew = prefix.length + localData.length;
  const centralDirectory = Buffer.concat([oldCentralDirectory, ...centralParts]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(oldEntryCount + entries.length, 8);
  eocd.writeUInt16LE(oldEntryCount + entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(centralDirectoryOffsetNew, 16);
  eocd.writeUInt16LE(0, 20);
  writeFileSync(path, Buffer.concat([prefix, localData, centralDirectory, eocd]));
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const min = Math.max(0, buffer.length - 0xffff - 22);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("ZIP end of central directory not found");
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
