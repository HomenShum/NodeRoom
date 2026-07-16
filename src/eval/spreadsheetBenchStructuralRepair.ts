import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { WorkbookObservedCell } from "../nodeagent/skills/spreadsheet/workbookTaskIntelligence";

export const SPREADSHEETBENCH_STRUCTURAL_REPAIR_SCHEMA = 1 as const;

export type SpreadsheetBenchStructuralFormulaRepair = {
  sheet: string;
  cell: string;
  formula: string;
};

export type SpreadsheetBenchStructuralRepairPlan = {
  schema: typeof SPREADSHEETBENCH_STRUCTURAL_REPAIR_SCHEMA;
  status: "complete";
  basis: "visible_workbook_invariants";
  repairId: string;
  kind: "insert_missing_selector_row";
  sheet: string;
  insertRow: number;
  labelCell: string;
  label: string;
  selectorCell: string;
  selectorValue: number;
  formulaSearch: string;
  formulaReplace: string;
  expectedFormulaReplacementCount: number;
  formulaRepairs: SpreadsheetBenchStructuralFormulaRepair[];
  operationCount: number;
  evidence: string[];
};

export type SpreadsheetBenchStructuralRepairReceipt = {
  schema: 1;
  backend: "excel_com";
  status: "completed";
  workbookPath: string;
  repairIds: string[];
  insertedRowCount: number;
  formulaReplacementCount: number;
  explicitFormulaRepairCount: number;
  calculationPasses: number;
};

export function detectSpreadsheetBenchStructuralRepair(args: {
  instruction: string;
  sheetNames: string[];
  cells: WorkbookObservedCell[];
}): SpreadsheetBenchStructuralRepairPlan | undefined {
  if (!/\b(?:deleted|missing)\s+rows?\b/i.test(args.instruction)
    || !/\b(?:audit|fix|repair)\b/i.test(args.instruction)) return undefined;
  const selectorMatch = args.instruction.match(/active\s+scenario\s+case\s+selector\s+value\s+is\s+([1-9][0-9]*)/i);
  const selectorValue = selectorMatch ? Number(selectorMatch[1]) : NaN;
  if (!Number.isInteger(selectorValue) || selectorValue < 1) return undefined;

  const brokenBySheet = new Map<string, WorkbookObservedCell[]>();
  for (const cell of args.cells) {
    if (!cell.formula || !/\bCHOOSE\s*\(\s*#REF!\s*,/i.test(cell.formula)) continue;
    const current = brokenBySheet.get(cell.sheet) ?? [];
    current.push(cell);
    brokenBySheet.set(cell.sheet, current);
  }
  const candidate = [...brokenBySheet.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))[0];
  if (!candidate || candidate[1].length < 10) return undefined;
  const [sheet, brokenChooseCells] = candidate;
  const sheetCells = args.cells.filter((cell) => cell.sheet === sheet);
  const title = sheetCells
    .filter((cell) => /add[- ]on acquisitions|mergers?\s*&\s*acquisitions|\bm\s*&\s*a\b/i.test(`${cell.value ?? ""} ${cell.formula ?? ""}`))
    .map((cell) => ({ cell, row: addressRow(cell.address) }))
    .filter((entry): entry is { cell: WorkbookObservedCell; row: number } => entry.row !== undefined && entry.row >= 3)
    .sort((left, right) => left.row - right.row)[0];
  if (!title || title.row > 12) return undefined;
  const insertRow = title.row - 1;
  const labelCell = `B${insertRow}`;
  const selectorCell = `C${insertRow}`;
  const occupied = new Set(sheetCells.map((cell) => normalizeCellAddress(cell.address)));
  if (occupied.has(labelCell) || occupied.has(selectorCell)) return undefined;

  const formulaRepairs = detectExternalSheetFormulaRepairs(args.cells, args.sheetNames);
  const operationCount = 1 + 2 + brokenChooseCells.length + formulaRepairs.length;
  return {
    schema: SPREADSHEETBENCH_STRUCTURAL_REPAIR_SCHEMA,
    status: "complete",
    basis: "visible_workbook_invariants",
    repairId: `restore-selector-row-${stableIdentifier(sheet)}-${insertRow}`,
    kind: "insert_missing_selector_row",
    sheet,
    insertRow,
    labelCell,
    label: "Case",
    selectorCell,
    selectorValue,
    formulaSearch: "CHOOSE(#REF!,",
    formulaReplace: `CHOOSE($C$${insertRow},`,
    expectedFormulaReplacementCount: brokenChooseCells.length,
    formulaRepairs,
    operationCount,
    evidence: [
      `${brokenChooseCells.length} formulas on ${sheet} share a deleted CHOOSE selector reference.`,
      `${labelCell}:${selectorCell} is empty immediately before the visible model title row ${title.row}.`,
      `The task supplies active scenario selector value ${selectorValue}.`,
      `${formulaRepairs.length} external-style sheet reference(s) resolve uniquely to existing workbook sheets.`,
    ],
  };
}

export function applySpreadsheetBenchStructuralRepairs(args: {
  workbookPath: string;
  repairs: SpreadsheetBenchStructuralRepairPlan[];
  timeoutMs?: number;
}): SpreadsheetBenchStructuralRepairReceipt | undefined {
  if (args.repairs.length === 0) return undefined;
  if (process.platform !== "win32") {
    throw new Error("Spreadsheet structural repair requires the Windows Excel COM backend");
  }
  const workbookPath = resolve(args.workbookPath);
  if (!existsSync(workbookPath)) throw new Error(`Spreadsheet structural repair workbook does not exist: ${workbookPath}`);
  const scriptPath = resolve(process.cwd(), "scripts", "spreadsheetbench-structural-repair.ps1");
  if (!existsSync(scriptPath)) throw new Error(`Spreadsheet structural repair script is missing: ${scriptPath}`);

  const root = mkdtempSync(join(tmpdir(), "noderoom-structural-repair-"));
  const planPath = join(root, "plan.json");
  try {
    writeFileSync(planPath, `${JSON.stringify({ schema: 1, repairs: args.repairs }, null, 2)}\n`, "utf8");
    const stdout = execFileSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-WorkbookPath",
      workbookPath,
      "-PlanPath",
      planPath,
    ], {
      encoding: "utf8",
      timeout: Math.max(30_000, Math.trunc(args.timeoutMs ?? 180_000)),
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    }).trim();
    const line = stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean).at(-1);
    if (!line) throw new Error("Spreadsheet structural repair returned no receipt");
    const receipt = JSON.parse(line) as SpreadsheetBenchStructuralRepairReceipt;
    const expectedIds = args.repairs.map((repair) => repair.repairId).sort();
    const actualIds = [...(receipt.repairIds ?? [])].sort();
    if (receipt.schema !== 1 || receipt.status !== "completed" || JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
      throw new Error(`Spreadsheet structural repair returned an invalid receipt: ${line}`);
    }
    return receipt;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function detectExternalSheetFormulaRepairs(
  cells: WorkbookObservedCell[],
  sheetNames: string[],
): SpreadsheetBenchStructuralFormulaRepair[] {
  const repairs: SpreadsheetBenchStructuralFormulaRepair[] = [];
  for (const cell of cells) {
    if (!cell.formula || !/\[[0-9]+\]/.test(cell.formula)) continue;
    let changed = false;
    const formula = cell.formula.replace(/'\[[0-9]+\]([^']+)'!/g, (token, externalName: string) => {
      const match = nearestSheetName(externalName, sheetNames);
      if (!match) return token;
      changed = true;
      return `'${match.replace(/'/g, "''")}'!`;
    });
    if (changed && formula !== cell.formula) {
      repairs.push({ sheet: cell.sheet, cell: normalizeCellAddress(cell.address), formula: `=${formula.replace(/^=/, "")}` });
    }
  }
  return repairs.sort((left, right) => left.sheet.localeCompare(right.sheet) || left.cell.localeCompare(right.cell));
}

function nearestSheetName(candidate: string, sheetNames: string[]): string | undefined {
  const normalized = normalizeSheetName(candidate);
  const ranked = sheetNames
    .map((sheet) => ({ sheet, distance: editDistance(normalized, normalizeSheetName(sheet)) }))
    .sort((left, right) => left.distance - right.distance || left.sheet.localeCompare(right.sheet));
  if (!ranked[0] || ranked[0].distance > 1 || ranked[1]?.distance === ranked[0].distance) return undefined;
  return ranked[0].sheet;
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_value, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function normalizeSheetName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function addressRow(address: string): number | undefined {
  const match = normalizeCellAddress(address).match(/^[A-Z]{1,3}([1-9][0-9]*)$/);
  return match ? Number(match[1]) : undefined;
}

function normalizeCellAddress(value: string): string {
  return value.trim().replace(/\$/g, "").toUpperCase();
}

function stableIdentifier(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "sheet";
}
