import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type ExcelJS from "exceljs";
import {
  applySpreadsheetBenchOperation,
  type AgentEditOperation,
} from "../src/eval/spreadsheetBenchRunner";
import { readSpreadsheetBenchWorkbookForCells } from "../src/eval/spreadsheetBenchScorer";
import {
  inspectWorkbookTask,
  workbookCellKey,
  type WorkbookObservedCell,
} from "../src/nodeagent/skills/spreadsheet/workbookTaskIntelligence";

type AgentManifest = {
  schema: 1;
  taskId: string;
  instruction: string;
  inputFiles: string[];
};

const args = process.argv.slice(2);
const stageRoot = resolve(requiredOption("--stage-root"));
const outputRoot = resolve(requiredOption("--output-root"));
const jsonOut = resolve(requiredOption("--json-out"));
const category = option("--category") ?? "Debugging";
const modulus = numberOption("--modulus") ?? 10;
const residue = numberOption("--residue") ?? 0;
const limit = numberOption("--limit") ?? 10;
const clean = args.includes("--clean");
if (!Number.isInteger(modulus) || modulus < 1) throw new Error("--modulus must be a positive integer");
if (!Number.isInteger(residue) || residue < 0 || residue >= modulus) throw new Error("--residue must be between zero and modulus - 1");
if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer");
if (clean) rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const tasksRoot = join(stageRoot, "tasks");
const candidates = readdirSync(tasksRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => {
    const taskDir = join(tasksRoot, entry.name);
    const manifestPath = join(taskDir, "agent", "task.json");
    const manifest = readJson<AgentManifest>(manifestPath);
    return { taskDir, manifestPath, manifest };
  })
  .filter(({ manifest }) => manifest.taskId.startsWith(`${category}/`))
  .filter(({ manifest }) => hashBucket(manifest.taskId, modulus) === residue)
  .sort((left, right) => left.manifest.taskId.localeCompare(right.manifest.taskId))
  .slice(0, limit);

if (!candidates.length) throw new Error(`no ${category} tasks matched hash bucket ${residue}/${modulus}`);
const results: Array<Record<string, unknown>> = [];
for (const { taskDir, manifestPath, manifest } of candidates) {
  const inputFile = manifest.inputFiles[0];
  if (!inputFile) throw new Error(`${manifest.taskId} has no agent-visible input workbook`);
  const source = resolve(dirname(manifestPath), inputFile);
  if (!existsSync(source)) throw new Error(`${manifest.taskId} input is missing: ${source}`);
  const workbook = await readSpreadsheetBenchWorkbookForCells(source);
  const cells = observedCells(workbook);
  const inspection = inspectWorkbookTask({
    instruction: manifest.instruction,
    sheetNames: workbook.worksheets.map((sheet) => sheet.name),
    cells,
    maxFindings: 100,
  });
  const operations = visibleRepairOperations(inspection);
  for (const operation of operations) applySpreadsheetBenchOperation(workbook, operation);
  const id = manifest.taskId.slice(category.length + 1);
  const output = join(outputRoot, category, `${id}_output.xlsx`);
  mkdirSync(dirname(output), { recursive: true });
  await workbook.xlsx.writeFile(output);
  results.push({
    taskId: manifest.taskId,
    selectionBucket: hashBucket(manifest.taskId, modulus),
    agentManifest: rel(manifestPath),
    agentManifestSha256: sha256File(manifestPath),
    input: rel(source),
    inputSha256: sha256File(source),
    instructionSha256: sha256(manifest.instruction),
    observedCellCount: cells.length,
    findingCount: inspection.findings.length,
    formulaRepairSuggestionCount: inspection.formulaRepairSuggestions.length,
    formulaFillSuggestionCount: inspection.formulaFillSuggestions.length,
    operationCount: operations.length,
    operations,
    output: rel(output),
    outputSha256: sha256File(output),
  });
  console.log(`${manifest.taskId}: ${operations.length} visible repair operation(s)`);
}

writeJson(jsonOut, {
  schema: 1,
  generatedAt: new Date().toISOString(),
  track: "spreadsheetbench-v2",
  category,
  selection: {
    policy: "sha256_task_id_modulo_selected_before_workbook_inspection",
    modulus,
    residue,
    limit,
    selectedTaskIds: results.map((result) => result.taskId),
    selectedTaskIdsSha256: sha256(JSON.stringify(results.map((result) => result.taskId))),
  },
  boundary: {
    candidateGeneration: "agent_visible_manifest_and_input_workbook_only",
    evaluatorMetadataRead: false,
    goldenWorkbookRead: false,
    modelCalls: 0,
    note: "This is an exploration replay of the same high-confidence visible formula repair fallback used by the product runner; scoring happens only after candidate emission.",
  },
  taskCount: results.length,
  taskWithRepairCount: results.filter((result) => Number(result.operationCount) > 0).length,
  operationCount: results.reduce((sum, result) => sum + Number(result.operationCount), 0),
  results,
});
console.log(`wrote ${rel(jsonOut)}`);

function observedCells(workbook: ExcelJS.Workbook): WorkbookObservedCell[] {
  const cells: WorkbookObservedCell[] = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const formula = formulaFromValue(cell.value);
        cells.push({
          sheet: sheet.name,
          address: cell.address,
          value: cell.value,
          ...(formula ? { formula } : {}),
          ...(cell.numFmt ? { numFmt: cell.numFmt } : {}),
        });
      });
    });
  }
  return cells;
}

function formulaFromValue(value: ExcelJS.CellValue): string | undefined {
  return value && typeof value === "object" && "formula" in value && typeof value.formula === "string"
    ? value.formula
    : undefined;
}

function visibleRepairOperations(inspection: ReturnType<typeof inspectWorkbookTask>): AgentEditOperation[] {
  const candidates: AgentEditOperation[] = [
    ...inspection.formulaFillSuggestions.flatMap((suggestion) => suggestion.operations),
    ...inspection.formulaRepairSuggestions.map((suggestion) => ({
      sheet: suggestion.sheet,
      cell: suggestion.cell,
      formula: suggestion.formula,
    })),
  ];
  const unique = new Map<string, AgentEditOperation>();
  const conflicts = new Set<string>();
  for (const operation of candidates) {
    if (!("sheet" in operation) || !("cell" in operation) || typeof operation.sheet !== "string" || typeof operation.cell !== "string") continue;
    const key = workbookCellKey(operation.sheet, operation.cell);
    const serialized = JSON.stringify(operation);
    const current = unique.get(key);
    if (current && JSON.stringify(current) !== serialized) {
      unique.delete(key);
      conflicts.add(key);
    } else if (!conflicts.has(key)) unique.set(key, operation);
  }
  return unique.size > 16 ? [] : [...unique.values()];
}

function hashBucket(value: string, bucketCount: number): number {
  return createHash("sha256").update(value).digest().readUInt32BE(0) % bucketCount;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function option(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function numberOption(name: string): number | undefined {
  const value = option(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be numeric`);
  return parsed;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
