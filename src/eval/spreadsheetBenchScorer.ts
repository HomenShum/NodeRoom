import ExcelJS from "exceljs";
import JSZip from "jszip";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { scoreSpreadsheetBenchCharts, type SpreadsheetBenchChartScore } from "./spreadsheetBenchChartScorer";

export type SpreadsheetBenchCellMismatchKind = "value" | "formula" | "style" | "missing_sheet";

export type SpreadsheetBenchCellMismatch = {
  kind: SpreadsheetBenchCellMismatchKind;
  sheet: string;
  cell?: string;
  expected?: string;
  actual?: string;
};

export type SpreadsheetBenchScoreOptions = {
  taskId?: string;
  candidateWorkbookPath: string;
  goldWorkbookPath: string;
  answerPosition?: string;
  answerSheet?: string;
  compareStyles?: boolean;
  compareCharts?: boolean;
  maxMismatches?: number;
  generatedAt?: string;
};

export type SpreadsheetBenchWorkbookScore = {
  schema: 1;
  generatedAt?: string;
  taskId?: string;
  candidateWorkbook: string;
  goldWorkbook: string;
  answerPosition?: string;
  ranges: string[];
  totals: {
    comparedCells: number;
    valueMatches: number;
    formulaCells: number;
    formulaMatches: number;
    styleCells: number;
    styleMatches: number;
    styleLayoutItems: number;
    styleLayoutMatches: number;
    mismatches: number;
    missingSheets: number;
  };
  scores: {
    value: number;
    formula: number | null;
    style: number | null;
    chartPackage: number | null;
    overall: number;
  };
  pass: boolean;
  warnings: string[];
  mismatches: SpreadsheetBenchCellMismatch[];
  chartPackage?: SpreadsheetBenchChartScore;
};

type ParsedRange = {
  sheetName?: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  label: string;
};

type CellParts = {
  value: unknown;
  formula?: string;
  style: string;
};

const XLSX_READ_IGNORE_NODES = ["drawing", "picture", "tableParts", "extLst"] as const;

export async function scoreSpreadsheetBenchWorkbook(options: SpreadsheetBenchScoreOptions): Promise<SpreadsheetBenchWorkbookScore> {
  const zipScore = await tryScoreSpreadsheetBenchWorkbookFromZip(options);
  if (zipScore) return zipScore;

  const [candidate, gold] = await Promise.all([
    readSpreadsheetBenchWorkbookForCells(options.candidateWorkbookPath),
    readSpreadsheetBenchWorkbookForCells(options.goldWorkbookPath),
  ]);
  const maxMismatches = options.maxMismatches ?? 50;
  const warnings: string[] = [];
  const mismatches: SpreadsheetBenchCellMismatch[] = [];
  const chartPackage = options.compareCharts
    ? scoreSpreadsheetBenchCharts({
        taskId: options.taskId ?? "spreadsheetbench-workbook",
        candidateWorkbookPath: options.candidateWorkbookPath,
        goldWorkbookPath: options.goldWorkbookPath,
        generatedAt: options.generatedAt,
      })
    : undefined;
  const ranges = parseAnswerPosition(options.answerPosition, options.answerSheet, gold);
  const concreteRanges = ranges.length > 0 ? ranges : usedRangesFromGold(gold);

  let comparedCells = 0;
  let valueMatches = 0;
  let formulaCells = 0;
  let formulaMatches = 0;
  let styleCells = 0;
  let styleMatches = 0;
  let styleLayoutItems = 0;
  let styleLayoutMatches = 0;
  let missingSheets = 0;
  let mismatchCount = 0;

  for (const range of concreteRanges) {
    const sheetName = range.sheetName ?? options.answerSheet ?? gold.worksheets[0]?.name;
    if (!sheetName) {
      warnings.push(`range ${range.label} has no sheet and the gold workbook has no worksheets`);
      continue;
    }
    const goldSheet = gold.getWorksheet(sheetName);
    const candidateSheet = candidate.getWorksheet(sheetName);
    if (!goldSheet || !candidateSheet) {
      missingSheets += 1;
      mismatchCount += rangeCellCount(range);
      pushMismatch(mismatches, maxMismatches, {
        kind: "missing_sheet",
        sheet: sheetName,
        expected: goldSheet ? "gold sheet exists" : "gold sheet missing",
        actual: candidateSheet ? "candidate sheet exists" : "candidate sheet missing",
      });
      continue;
    }

    for (let row = range.startRow; row <= range.endRow; row += 1) {
      for (let col = range.startCol; col <= range.endCol; col += 1) {
        comparedCells += 1;
        const cellRef = `${colToLetters(col)}${row}`;
        const expected = cellParts(goldSheet.getCell(row, col));
        const actual = cellParts(candidateSheet.getCell(row, col));
        const valueOk = valuesEqual(actual.value, expected.value);
        if (valueOk) valueMatches += 1;
        else {
          mismatchCount += 1;
          pushMismatch(mismatches, maxMismatches, {
            kind: "value",
            sheet: sheetName,
            cell: cellRef,
            expected: preview(expected.value),
            actual: preview(actual.value),
          });
        }

        if (expected.formula) {
          formulaCells += 1;
          const formulaOk = normalizeFormula(actual.formula) === normalizeFormula(expected.formula);
          if (formulaOk) formulaMatches += 1;
          else {
            mismatchCount += 1;
            pushMismatch(mismatches, maxMismatches, {
              kind: "formula",
              sheet: sheetName,
              cell: cellRef,
              expected: expected.formula,
              actual: actual.formula,
            });
          }
        }

        if (options.compareStyles) {
          styleCells += 1;
          if (actual.style === expected.style) styleMatches += 1;
          else {
            mismatchCount += 1;
            pushMismatch(mismatches, maxMismatches, {
              kind: "style",
              sheet: sheetName,
              cell: cellRef,
              expected: expected.style,
              actual: actual.style,
            });
          }
        }
      }
    }

    if (options.compareStyles) {
      const layout = compareSheetLayoutStyles(candidateSheet, goldSheet, range, maxMismatches - mismatches.length);
      styleLayoutItems += layout.items;
      styleLayoutMatches += layout.matches;
      mismatchCount += layout.mismatchCount;
      mismatches.push(...layout.mismatches);
    }
  }

  const valueScore = ratio(valueMatches, comparedCells);
  const formulaScore = formulaCells > 0 ? ratio(formulaMatches, formulaCells) : null;
  const styleTotal = styleCells + styleLayoutItems;
  const styleMatched = styleMatches + styleLayoutMatches;
  const styleScore = options.compareStyles && styleTotal > 0 ? ratio(styleMatched, styleTotal) : null;
  const hasChartPackageEvidence = chartPackage
    ? chartPackage.totals.goldChartParts > 0 || chartPackage.totals.candidateChartParts > 0
    : false;
  const chartPackageScore = chartPackage && hasChartPackageEvidence ? chartPackage.scores.package : null;
  const overallParts = [
    valueScore,
    ...(formulaScore === null ? [] : [formulaScore]),
    ...(styleScore === null ? [] : [styleScore]),
    ...(chartPackageScore === null ? [] : [chartPackageScore]),
  ];
  const overall = overallParts.reduce((sum, item) => sum + item, 0) / Math.max(1, overallParts.length);

  if (mismatchCount > mismatches.length) warnings.push(`mismatch list capped at ${mismatches.length}/${mismatchCount}`);
  if (chartPackage) {
    warnings.push(...chartPackage.warnings.map((warning) => `chart_package: ${warning}`));
  }

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    taskId: options.taskId,
    candidateWorkbook: basename(options.candidateWorkbookPath),
    goldWorkbook: basename(options.goldWorkbookPath),
    answerPosition: options.answerPosition,
    ranges: concreteRanges.map((range) => range.label),
    totals: {
      comparedCells,
      valueMatches,
      formulaCells,
      formulaMatches,
      styleCells,
      styleMatches,
      styleLayoutItems,
      styleLayoutMatches,
      mismatches: mismatchCount,
      missingSheets,
    },
    scores: {
      value: valueScore,
      formula: formulaScore,
      style: styleScore,
      chartPackage: chartPackageScore,
      overall,
    },
    pass: comparedCells > 0 && mismatchCount === 0 && missingSheets === 0 && (chartPackageScore === null || chartPackage?.pass === true),
    warnings,
    mismatches,
    chartPackage,
  };
}

async function tryScoreSpreadsheetBenchWorkbookFromZip(
  options: SpreadsheetBenchScoreOptions,
): Promise<SpreadsheetBenchWorkbookScore | undefined> {
  if (options.compareStyles || options.compareCharts || !canUseZipCellScorer(options.answerPosition)) return undefined;
  try {
    const ranges = parseAnswerPosition(options.answerPosition, options.answerSheet);
    if (ranges.length === 0) return undefined;
    const [candidate, gold] = await Promise.all([
      readZipWorkbookCells(options.candidateWorkbookPath),
      readZipWorkbookCells(options.goldWorkbookPath),
    ]);
    return scoreZipWorkbookCells({ options, ranges, candidate, gold });
  } catch {
    return undefined;
  }
}

function canUseZipCellScorer(answerPosition: string | undefined): boolean {
  if (!answerPosition?.trim()) return false;
  const normalized = normalizeAnswerPosition(answerPosition);
  return splitOutsideQuotes(normalized).every((raw) => {
    const bang = indexOfSheetBang(raw);
    const rangeText = bang >= 0 ? raw.slice(bang + 1) : raw;
    return rangeText.split(":").every((part) => /^\s*'?\$?[A-Z]{1,3}\$?[1-9]\d*'?\s*$/i.test(part));
  });
}

type ZipWorkbookCells = {
  firstSheetName?: string;
  sheets: Map<string, Map<string, { value: unknown; formula?: string }>>;
};

async function readZipWorkbookCells(path: string): Promise<ZipWorkbookCells> {
  const zip = await JSZip.loadAsync(await readFile(path));
  const sharedStrings = await readZipSharedStrings(zip);
  const sheets = await readZipWorkbookSheetMap(zip);
  const out = new Map<string, Map<string, { value: unknown; formula?: string }>>();
  for (const sheet of sheets) {
    const file = zip.file(sheet.path);
    if (!file) continue;
    out.set(sheet.name, parseZipWorksheetCells(await file.async("string"), sharedStrings));
  }
  return { firstSheetName: sheets[0]?.name, sheets: out };
}

async function readZipSharedStrings(zip: JSZip): Promise<string[]> {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];
  const xml = await file.async("string");
  return [...xml.matchAll(/<si\b[\s\S]*?<\/si>/gi)].map((match) =>
    [...match[0].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((text) => decodeXml(text[1])).join(""),
  );
}

async function readZipWorkbookSheetMap(zip: JSZip): Promise<Array<{ name: string; path: string }>> {
  const workbookXml = await zip.file("xl/workbook.xml")?.async("string");
  if (!workbookXml) return [];
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels")?.async("string");
  const rels = new Map<string, string>();
  if (relsXml) {
    for (const rel of relsXml.matchAll(/<Relationship\b([^>]*)\/>/gi)) {
      const attrs = xmlAttrs(rel[1]);
      if (attrs.Id && attrs.Target) rels.set(attrs.Id, normalizeWorkbookRelationshipTarget(attrs.Target));
    }
  }
  const sheets: Array<{ name: string; path: string }> = [];
  for (const sheet of workbookXml.matchAll(/<sheet\b([^>]*)\/>/gi)) {
    const attrs = xmlAttrs(sheet[1]);
    const relId = attrs["r:id"];
    const path = relId ? rels.get(relId) : undefined;
    if (attrs.name && path) sheets.push({ name: decodeXml(attrs.name), path });
  }
  return sheets;
}

function normalizeWorkbookRelationshipTarget(target: string): string {
  const normalized = target.replace(/\\/g, "/").replace(/^\//, "");
  return normalized.startsWith("xl/") ? normalized : `xl/${normalized}`;
}

function parseZipWorksheetCells(xml: string, sharedStrings: string[]): Map<string, { value: unknown; formula?: string }> {
  const cells = new Map<string, { value: unknown; formula?: string }>();
  for (const match of xml.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gi)) {
    const attrs = xmlAttrs(match[1]);
    const address = attrs.r?.replace(/\$/g, "").toUpperCase();
    if (!address) continue;
    const body = match[2] ?? "";
    const formula = body.match(/<f\b[^>]*>([\s\S]*?)<\/f>/i)?.[1];
    cells.set(address, {
      value: zipCellValue(attrs.t, body, sharedStrings),
      ...(formula === undefined ? {} : { formula: ensureEquals(decodeXml(formula)) }),
    });
  }
  return cells;
}

function zipCellValue(type: string | undefined, body: string, sharedStrings: string[]): unknown {
  const raw = body.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1];
  if (type === "inlineStr") {
    return [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((item) => decodeXml(item[1])).join("");
  }
  if (raw === undefined) return "";
  const decoded = decodeXml(raw);
  if (type === "s") return sharedStrings[Number(decoded)] ?? "";
  if (type === "b") return decoded === "1";
  if (type === "str" || type === "e") return decoded;
  const numeric = Number(decoded);
  return Number.isFinite(numeric) ? numeric : decoded;
}

function scoreZipWorkbookCells(args: {
  options: SpreadsheetBenchScoreOptions;
  ranges: ParsedRange[];
  candidate: ZipWorkbookCells;
  gold: ZipWorkbookCells;
}): SpreadsheetBenchWorkbookScore {
  const maxMismatches = args.options.maxMismatches ?? 50;
  const warnings: string[] = [];
  const mismatches: SpreadsheetBenchCellMismatch[] = [];
  let comparedCells = 0;
  let valueMatches = 0;
  let formulaCells = 0;
  let formulaMatches = 0;
  let missingSheets = 0;
  let mismatchCount = 0;

  for (const range of args.ranges) {
    const sheetName = range.sheetName ?? defaultSheetName(args.options.answerSheet) ?? args.gold.firstSheetName;
    if (!sheetName) {
      warnings.push(`range ${range.label} has no sheet and the gold workbook has no worksheets`);
      continue;
    }
    const goldSheet = args.gold.sheets.get(sheetName);
    const candidateSheet = args.candidate.sheets.get(sheetName);
    if (!goldSheet || !candidateSheet) {
      missingSheets += 1;
      mismatchCount += rangeCellCount(range);
      if (mismatches.length < maxMismatches) {
        mismatches.push({ kind: "missing_sheet", sheet: sheetName, expected: goldSheet ? "present" : "missing", actual: candidateSheet ? "present" : "missing" });
      }
      continue;
    }
    for (let row = range.startRow; row <= range.endRow; row += 1) {
      for (let col = range.startCol; col <= range.endCol; col += 1) {
        comparedCells += 1;
        const address = `${colToLetters(col)}${row}`;
        const goldCell = goldSheet.get(address) ?? { value: "" };
        const candidateCell = candidateSheet.get(address) ?? { value: "" };
        if (valuesEqual(candidateCell.value, goldCell.value)) {
          valueMatches += 1;
        } else {
          mismatchCount += 1;
          if (mismatches.length < maxMismatches) {
            mismatches.push({
              kind: "value",
              sheet: sheetName,
              cell: address,
              expected: preview(goldCell.value),
              actual: preview(candidateCell.value),
            });
          }
        }
        if (goldCell.formula) {
          formulaCells += 1;
          if (normalizeFormula(candidateCell.formula) === normalizeFormula(goldCell.formula)) {
            formulaMatches += 1;
          } else {
            mismatchCount += 1;
            if (mismatches.length < maxMismatches) {
              mismatches.push({
                kind: "formula",
                sheet: sheetName,
                cell: address,
                expected: goldCell.formula,
                actual: candidateCell.formula,
              });
            }
          }
        }
      }
    }
  }

  const valueScore = ratio(valueMatches, comparedCells);
  const formulaScore = formulaCells ? ratio(formulaMatches, formulaCells) : null;
  const overallParts = [valueScore, ...(formulaScore === null ? [] : [formulaScore])];
  const overall = ratio(overallParts.reduce((sum, value) => sum + value, 0), overallParts.length || 1);
  return {
    schema: 1,
    generatedAt: args.options.generatedAt,
    taskId: args.options.taskId,
    candidateWorkbook: basename(args.options.candidateWorkbookPath),
    goldWorkbook: basename(args.options.goldWorkbookPath),
    answerPosition: args.options.answerPosition,
    ranges: args.ranges.map((range) => range.label),
    totals: {
      comparedCells,
      valueMatches,
      formulaCells,
      formulaMatches,
      styleCells: 0,
      styleMatches: 0,
      styleLayoutItems: 0,
      styleLayoutMatches: 0,
      mismatches: mismatchCount,
      missingSheets,
    },
    scores: {
      value: valueScore,
      formula: formulaScore,
      style: null,
      chartPackage: null,
      overall,
    },
    pass: comparedCells > 0 && mismatchCount === 0 && missingSheets === 0,
    warnings,
    mismatches,
  };
}

function xmlAttrs(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of value.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) attrs[match[1]] = decodeXml(match[2]);
  return attrs;
}

function decodeXml(value: string): string {
  return value
    .replace(/&#(?:x([0-9a-f]+)|([0-9]+));/gi, (entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function parseAnswerPosition(answerPosition: string | undefined, defaultSheet?: string, workbook?: ExcelJS.Workbook): ParsedRange[] {
  if (!answerPosition?.trim()) return [];
  return splitOutsideQuotes(normalizeAnswerPosition(answerPosition)).map((raw) => {
    const part = raw.trim();
    const bang = indexOfSheetBang(part);
    const sheetName = bang >= 0 ? unquoteSheet(part.slice(0, bang)) : defaultSheetName(defaultSheet);
    const rangeText = normalizeRangeText(bang >= 0 ? part.slice(bang + 1) : part, sheetName);
    const [startText, endText = startText] = rangeText.split(":").map((item) => item.trim());
    const bounds = sheetUsedBounds(workbook, sheetName);
    const start = parseRangePoint(startText, { bounds, isEnd: false });
    const end = parseRangePoint(endText, { bounds, paired: start, isEnd: true });
    return {
      sheetName,
      startRow: Math.min(start.row, end.row),
      endRow: Math.max(start.row, end.row),
      startCol: Math.min(start.col, end.col),
      endCol: Math.max(start.col, end.col),
      label: `${sheetName ? `'${sheetName}'!` : ""}${cleanRangeToken(startText)}${endText === startText ? "" : `:${cleanRangeToken(endText)}`}`,
    };
  });
}

export async function readSpreadsheetBenchWorkbookForCells(path: string): Promise<ExcelJS.Workbook> {
  if (await workbookPackageNeedsCellReadSanitizer(path)) {
    return readSanitizedWorkbook(path);
  }
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(path, { ignoreNodes: [...XLSX_READ_IGNORE_NODES] });
    return workbook;
  } catch (error) {
    if (!isExcelJsUnsupportedPackagePartError(error)) throw error;
    return readSanitizedWorkbook(path);
  }
}

/**
 * Preserve package parts that ExcelJS can read, but keep benchmark execution
 * moving when a workbook contains an unsupported WPS/Office drawing package.
 */
export async function readSpreadsheetBenchWorkbookForMutation(path: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.readFile(path);
    return workbook;
  } catch (error) {
    if (!isExcelJsUnsupportedPackagePartError(error)) throw error;
    return readSanitizedWorkbook(path);
  }
}

async function readSanitizedWorkbook(path: string): Promise<ExcelJS.Workbook> {
  const sanitized = await sanitizeWorkbookPackageForCellRead(path);
  try {
    const fallback = new ExcelJS.Workbook();
    await fallback.xlsx.readFile(sanitized.path, { ignoreNodes: [...XLSX_READ_IGNORE_NODES] });
    return fallback;
  } finally {
    await rm(sanitized.root, { recursive: true, force: true });
  }
}

async function workbookPackageNeedsCellReadSanitizer(path: string): Promise<boolean> {
  const buffer = await readFile(path);
  return [
    "xl/externalLinks/",
    "xl/drawings/",
    "xl/comments",
    "xl/threadedComments/",
    "xl/tables/",
  ].some((marker) => buffer.includes(Buffer.from(marker)));
}

function isExcelJsUnsupportedPackagePartError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("reading 'anchors'") ||
    message.includes("reading 'comments'") ||
    message.includes("reading 'name'")
  );
}

async function sanitizeWorkbookPackageForCellRead(path: string): Promise<{ root: string; path: string }> {
  const zip = await JSZip.loadAsync(await readFile(path));
  for (const entryName of Object.keys(zip.files)) {
    if (shouldRemoveWorkbookPart(entryName)) zip.remove(entryName);
  }
  await rewriteZipXml(zip, "[Content_Types].xml", removeUnsupportedContentTypes);
  await rewriteZipXml(zip, "xl/workbook.xml", removeUnsupportedWorkbookNodes);
  await rewriteZipXml(zip, "xl/_rels/workbook.xml.rels", removeUnsupportedWorkbookRelationships);
  for (const entryName of Object.keys(zip.files)) {
    if (/^xl\/worksheets\/_rels\/[^/]+\.rels$/i.test(entryName)) {
      await rewriteZipXml(zip, entryName, removeUnsupportedWorksheetRelationships);
    }
    if (/^xl\/worksheets\/[^/]+\.xml$/i.test(entryName)) {
      await rewriteZipXml(zip, entryName, removeUnsupportedWorksheetNodes);
    }
  }
  const root = await mkdtemp(join(tmpdir(), "noderoom-xlsx-cell-read-"));
  const sanitizedPath = join(root, basename(path));
  await writeFile(sanitizedPath, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  return { root, path: sanitizedPath };
}

function shouldRemoveWorkbookPart(path: string): boolean {
  return (
    /^xl\/drawings\//i.test(path) ||
    /^xl\/comments\d*\.xml$/i.test(path) ||
    /^xl\/threadedComments\//i.test(path) ||
    /^xl\/externalLinks\//i.test(path) ||
    /^xl\/calcChain\.xml$/i.test(path) ||
    /^xl\/person\/persons\.xml$/i.test(path) ||
    /^xl\/tables\//i.test(path) ||
    /^xl\/media\//i.test(path) ||
    /^xl\/ctrlProps\//i.test(path)
  );
}

async function rewriteZipXml(zip: JSZip, path: string, rewrite: (xml: string) => string): Promise<void> {
  const file = zip.file(path);
  if (!file) return;
  zip.file(path, rewrite(await file.async("string")));
}

function removeUnsupportedContentTypes(xml: string): string {
  return xml.replace(
    /<Override\b[^>]+PartName="\/xl\/(?:(?:drawings|comments|threadedComments|person|tables|media|ctrlProps|externalLinks)\/[^"]+|calcChain\.xml)"[^>]*\/>/gi,
    "",
  );
}

function removeUnsupportedWorkbookRelationships(xml: string): string {
  return xml.replace(
    /<Relationship\b[^>]+Type="[^"]+\/(?:externalLink|calcChain|table|ctrlProp)"[^>]*\/>/gi,
    "",
  );
}

function removeUnsupportedWorkbookNodes(xml: string): string {
  return xml.replace(/<externalReferences\b[\s\S]*?<\/externalReferences>/gi, "");
}

function removeUnsupportedWorksheetRelationships(xml: string): string {
  return xml.replace(
    /<Relationship\b[^>]+Type="[^"]+\/(?:drawing|vmlDrawing|comments|threadedComment|table|ctrlProp)"[^>]*\/>/gi,
    "",
  );
}

function removeUnsupportedWorksheetNodes(xml: string): string {
  return xml
    .replace(/<drawing\b[^>]*\/>/gi, "")
    .replace(/<legacyDrawing\b[^>]*\/>/gi, "")
    .replace(/<legacyDrawingHF\b[^>]*\/>/gi, "")
    .replace(/<picture\b[^>]*\/>/gi, "")
    .replace(/<tableParts\b[\s\S]*?<\/tableParts>/gi, "")
    .replace(/<extLst\b[\s\S]*?<\/extLst>/gi, "");
}

function usedRangesFromGold(workbook: ExcelJS.Workbook): ParsedRange[] {
  return workbook.worksheets.flatMap((sheet) => {
    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = 0;
    let minCol = Number.POSITIVE_INFINITY;
    let maxCol = 0;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
        minRow = Math.min(minRow, rowNumber);
        maxRow = Math.max(maxRow, rowNumber);
        minCol = Math.min(minCol, colNumber);
        maxCol = Math.max(maxCol, colNumber);
      });
    });
    if (!maxRow || !maxCol) return [];
    return [{
      sheetName: sheet.name,
      startRow: minRow,
      endRow: maxRow,
      startCol: minCol,
      endCol: maxCol,
      label: `'${sheet.name}'!${colToLetters(minCol)}${minRow}:${colToLetters(maxCol)}${maxRow}`,
    }];
  });
}

function cellParts(cell: ExcelJS.Cell): CellParts {
  return {
    value: comparableValue(cell.value),
    formula: formulaText(cell.value),
    style: styleFingerprint(cell),
  };
}

function comparableValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  if (typeof value !== "object") return value;
  if ("formula" in value) return comparableValue(value.result as ExcelJS.CellValue);
  if ("sharedFormula" in value) return comparableValue(value.result as ExcelJS.CellValue);
  if ("richText" in value && Array.isArray(value.richText)) return value.richText.map((item) => item.text ?? "").join("");
  if ("hyperlink" in value) return value.text ?? value.hyperlink;
  if ("error" in value) return value.error;
  return JSON.stringify(value);
}

function formulaText(value: ExcelJS.CellValue): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if ("formula" in value && typeof value.formula === "string") return ensureEquals(value.formula);
  if ("sharedFormula" in value && typeof value.sharedFormula === "string") return ensureEquals(value.sharedFormula);
  return undefined;
}

function ensureEquals(formula: string): string {
  return formula.trim().startsWith("=") ? formula.trim() : `=${formula.trim()}`;
}

function normalizeFormula(formula: string | undefined): string {
  return (formula ?? "").replace(/^=/, "").replace(/\s+/g, "").replace(/\$/g, "").toUpperCase();
}

function valuesEqual(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "number" && typeof expected === "number") return Math.abs(actual - expected) <= 1e-9;
  if (actual === expected) return true;
  return normalizeText(actual) === normalizeText(expected);
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function compareSheetLayoutStyles(
  candidateSheet: ExcelJS.Worksheet,
  goldSheet: ExcelJS.Worksheet,
  range: ParsedRange,
  maxMismatches: number,
): {
  items: number;
  matches: number;
  mismatchCount: number;
  mismatches: SpreadsheetBenchCellMismatch[];
} {
  const mismatches: SpreadsheetBenchCellMismatch[] = [];
  let items = 0;
  let matches = 0;
  let mismatchCount = 0;
  const compare = (label: string, expected: unknown, actual: unknown) => {
    items += 1;
    const expectedText = stableJson(expected);
    const actualText = stableJson(actual);
    if (expectedText === actualText) {
      matches += 1;
      return;
    }
    mismatchCount += 1;
    pushMismatch(mismatches, maxMismatches, {
      kind: "style",
      sheet: goldSheet.name,
      cell: label,
      expected: expectedText,
      actual: actualText,
    });
  };

  for (let col = range.startCol; col <= range.endCol; col += 1) {
    compare(`column:${colToLetters(col)}`, columnLayoutFingerprint(goldSheet.getColumn(col)), columnLayoutFingerprint(candidateSheet.getColumn(col)));
  }
  for (let row = range.startRow; row <= range.endRow; row += 1) {
    compare(`row:${row}`, rowLayoutFingerprint(goldSheet.getRow(row)), rowLayoutFingerprint(candidateSheet.getRow(row)));
  }
  compare("merges", mergesIntersectingRange(goldSheet, range), mergesIntersectingRange(candidateSheet, range));
  return { items, matches, mismatchCount, mismatches };
}

function columnLayoutFingerprint(column: ExcelJS.Column): Record<string, unknown> {
  return compact({
    width: column.width,
    hidden: column.hidden,
    outlineLevel: column.outlineLevel,
    collapsed: column.collapsed,
  });
}

function rowLayoutFingerprint(row: ExcelJS.Row): Record<string, unknown> {
  return compact({
    height: row.height,
    hidden: row.hidden,
    outlineLevel: row.outlineLevel,
    collapsed: row.collapsed,
  });
}

function mergesIntersectingRange(sheet: ExcelJS.Worksheet, range: ParsedRange): string[] {
  return sheetMergeRanges(sheet)
    .map(normalizeRangeLabel)
    .filter((merge) => rangesIntersect(merge, range))
    .map((merge) => merge.label)
    .sort((a, b) => a.localeCompare(b));
}

function sheetMergeRanges(sheet: ExcelJS.Worksheet): string[] {
  const model = sheet.model as { merges?: string[] | Record<string, unknown> };
  if (Array.isArray(model.merges)) return model.merges;
  if (model.merges && typeof model.merges === "object") return Object.keys(model.merges);
  return [];
}

function normalizeRangeLabel(value: string): ParsedRange {
  const [startText, endText = startText] = value.replace(/\$/g, "").split(":").map((item) => item.trim().toUpperCase());
  const start = parseCellRef(startText);
  const end = parseCellRef(endText);
  const normalizedStart = `${colToLetters(Math.min(start.col, end.col))}${Math.min(start.row, end.row)}`;
  const normalizedEnd = `${colToLetters(Math.max(start.col, end.col))}${Math.max(start.row, end.row)}`;
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startCol: Math.min(start.col, end.col),
    endCol: Math.max(start.col, end.col),
    label: normalizedStart === normalizedEnd ? normalizedStart : `${normalizedStart}:${normalizedEnd}`,
  };
}

function rangesIntersect(a: ParsedRange, b: ParsedRange): boolean {
  return a.startRow <= b.endRow
    && a.endRow >= b.startRow
    && a.startCol <= b.endCol
    && a.endCol >= b.startCol;
}

function styleFingerprint(cell: ExcelJS.Cell): string {
  const style = cell.style ?? {};
  return stableJson({
    numFmt: style.numFmt,
    font: compact({
      name: style.font?.name,
      size: style.font?.size,
      bold: style.font?.bold,
      italic: style.font?.italic,
      underline: style.font?.underline,
      color: style.font?.color,
    }),
    fill: style.fill,
    alignment: style.alignment,
    border: style.border,
  });
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function splitOutsideQuotes(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "'") {
      current += ch;
      if (value[i + 1] === "'") {
        current += value[i + 1];
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === "," && !quoted) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

function normalizeAnswerPosition(value: string): string {
  return splitOutsideQuotes(normalizeRangePunctuation(value))
    .map((part) => normalizeAnswerPositionPart(part))
    .join(",");
}

function normalizeRangePunctuation(value: string): string {
  return value
    .replace(/\uFF1A/g, ":")
    .replace(/\uFF01/g, "!")
    .replace(/\uFF0C/g, ",")
    .replace(/ï¼š/g, ":")
    .replace(/ï¼/g, "!")
    .replace(/ï¼/g, ",");
}

function normalizeRangeText(value: string, sheetName?: string): string {
  let normalized = normalizeRangePunctuation(value.trim());
  if (normalized.startsWith("'") && normalized.endsWith("'")) {
    normalized = normalized.slice(1, -1).replace(/''/g, "'");
  }
  const bang = indexOfSheetBang(normalized);
  if (bang >= 0) {
    const embeddedSheet = unquoteSheet(normalized.slice(0, bang));
    if (!sheetName || embeddedSheet.toLowerCase() === sheetName.toLowerCase()) {
      normalized = normalized.slice(bang + 1);
    }
  }
  return normalized;
}

function normalizeAnswerPositionPart(value: string): string {
  return value.trim()
    .replace(/^'([^'!,]+)!'(?=[A-Z$])/i, (_match, sheet: string) => `'${sheet}'!`)
    .replace(/^'([^'!,]+)!(?=[A-Z$])/i, (_match, sheet: string) => `'${sheet}'!`)
    .replace(/^([^,'!]+)'!(?=[A-Z$])/i, (_match, sheet: string) => `'${sheet.trim()}'!`)
    .replace(/(\$?[A-Z]{1,3}\$?[1-9]\d*|\$?[A-Z]{1,3}|\$?[1-9]\d*)'$/i, "$1");
}

function indexOfSheetBang(value: string): number {
  let quoted = false;
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch === "'") {
      if (value[i + 1] === "'") i += 1;
      else quoted = !quoted;
    } else if (ch === "!" && !quoted) {
      return i;
    }
  }
  return value.indexOf("!");
}

function unquoteSheet(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1).replace(/''/g, "'");
  return trimmed.replace(/^'+/, "").replace(/'+$/, "").replace(/''/g, "'");
}

function parseCellRef(value: string): { row: number; col: number } {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(cleanRangeToken(value));
  if (!match) throw new Error(`Unsupported SpreadsheetBench cell reference: ${value}`);
  return { col: lettersToCol(match[1].toUpperCase()), row: Number(match[2]) };
}

function parseRangePoint(
  value: string,
  args: {
    bounds?: { minRow: number; maxRow: number; minCol: number; maxCol: number };
    paired?: { row: number; col: number };
    isEnd: boolean;
  },
): { row: number; col: number } {
  const token = cleanRangeToken(value);
  const cell = /^\$?[A-Z]{1,3}\$?[1-9]\d*$/i.test(token) ? parseCellRef(token) : undefined;
  if (cell) return cell;
  const colOnly = /^\$?([A-Z]{1,3})$/i.exec(token);
  if (colOnly) {
    return {
      col: lettersToCol(colOnly[1].toUpperCase()),
      row: args.isEnd ? (args.bounds?.maxRow ?? args.paired?.row ?? 1) : (args.bounds?.minRow ?? 1),
    };
  }
  const rowOnly = /^\$?([1-9]\d*)$/i.exec(token);
  if (rowOnly) {
    return {
      col: args.paired?.col ?? (args.isEnd ? (args.bounds?.maxCol ?? 1) : (args.bounds?.minCol ?? 1)),
      row: Number(rowOnly[1]),
    };
  }
  throw new Error(`Unsupported SpreadsheetBench cell reference: ${value}`);
}

function cleanRangeToken(value: string): string {
  return value.trim().replace(/^'+/, "").replace(/'+$/, "").replace(/\$/g, "");
}

function defaultSheetName(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  return unquoteSheet(splitOutsideQuotes(value)[0] ?? value);
}

function sheetUsedBounds(workbook: ExcelJS.Workbook | undefined, sheetName: string | undefined) {
  const sheet = sheetName ? workbook?.getWorksheet(sheetName) : workbook?.worksheets[0];
  if (!sheet) return undefined;
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = 0;
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = 0;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: false }, (_cell, colNumber) => {
      minRow = Math.min(minRow, rowNumber);
      maxRow = Math.max(maxRow, rowNumber);
      minCol = Math.min(minCol, colNumber);
      maxCol = Math.max(maxCol, colNumber);
    });
  });
  if (!maxRow || !maxCol) return undefined;
  return { minRow, maxRow, minCol, maxCol };
}

function lettersToCol(letters: string): number {
  return [...letters].reduce((total, ch) => total * 26 + ch.charCodeAt(0) - 64, 0);
}

function colToLetters(col: number): string {
  let value = col;
  let out = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    out = String.fromCharCode(65 + mod) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

function rangeCellCount(range: ParsedRange): number {
  return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
}

function ratio(numerator: number, denominator: number): number {
  return denominator <= 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

function preview(value: unknown): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  return raw.length > 140 ? `${raw.slice(0, 137)}...` : raw;
}

function pushMismatch(items: SpreadsheetBenchCellMismatch[], max: number, item: SpreadsheetBenchCellMismatch) {
  if (items.length < max) items.push(item);
}
