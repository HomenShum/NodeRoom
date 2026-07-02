import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve, relative, join } from "node:path";

export type SpreadsheetBenchTrack = "spreadsheetbench-v1" | "spreadsheetbench-v2";

export type SpreadsheetBenchAgentTask = {
  id: string;
  track: SpreadsheetBenchTrack;
  category?: string;
  instruction: string;
  instructionType?: string;
  inputFiles: string[];
  promptFiles: string[];
  goldAvailable: boolean;
};

export type SpreadsheetBenchEvaluatorMetadata = {
  answerPosition?: string;
  answerSheet?: string;
  dataPosition?: string;
};

export type SpreadsheetBenchTask = {
  id: string;
  track: SpreadsheetBenchTrack;
  category?: string;
  sourceDatasetJson: string;
  agentTask: SpreadsheetBenchAgentTask;
  evaluatorMetadata: SpreadsheetBenchEvaluatorMetadata;
  evaluatorGoldFiles: string[];
  warnings: string[];
};

export type SpreadsheetBenchIngestReport = {
  schema: 1;
  generatedAt?: string;
  sourceRoot: string;
  track: SpreadsheetBenchTrack;
  taskCount: number;
  inputFileCount: number;
  promptFileCount: number;
  evaluatorGoldFileCount: number;
  categoryCounts: Record<string, number>;
  goldIsolation: {
    agentTaskGoldPathLeaks: number;
    agentTasksExposeGold: boolean;
    agentTaskScorerMetadataLeaks: number;
    agentTasksExposeScorerMetadata: boolean;
  };
  warnings: string[];
  sampleAgentTasks: SpreadsheetBenchAgentTask[];
  tasks?: SpreadsheetBenchTask[];
};

type RawTask = Record<string, unknown>;

type ScanOptions = {
  track: SpreadsheetBenchTrack;
  includeTasks?: boolean;
  sampleLimit?: number;
  generatedAt?: string;
};

export function scanSpreadsheetBenchBundle(rootDir: string, options: ScanOptions): SpreadsheetBenchIngestReport {
  const root = resolve(rootDir);
  if (!existsSync(root)) throw new Error(`SpreadsheetBench root does not exist: ${rootDir}`);
  if (!statSync(root).isDirectory()) throw new Error(`SpreadsheetBench root is not a directory: ${rootDir}`);

  const tasks = options.track === "spreadsheetbench-v1"
    ? scanV1(root)
    : scanV2(root);
  const warnings = tasks.flatMap((task) => task.warnings.map((warning) => `${task.id}: ${warning}`));
  const sampleLimit = options.sampleLimit ?? 12;
  const categoryCounts: Record<string, number> = {};
  for (const task of tasks) {
    const key = task.category ?? "uncategorized";
    categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
  }
  const agentTaskGoldPathLeaks = tasks.filter((task) =>
    task.agentTask.inputFiles.some(isGoldPath) || task.agentTask.promptFiles.some(isGoldPath)
  ).length;
  const agentTaskScorerMetadataLeaks = tasks.filter((task) => agentTaskContainsScorerMetadata(task.agentTask)).length;

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    sourceRoot: basename(root),
    track: options.track,
    taskCount: tasks.length,
    inputFileCount: sum(tasks, (task) => task.agentTask.inputFiles.length),
    promptFileCount: sum(tasks, (task) => task.agentTask.promptFiles.length),
    evaluatorGoldFileCount: sum(tasks, (task) => task.evaluatorGoldFiles.length),
    categoryCounts,
    goldIsolation: {
      agentTaskGoldPathLeaks,
      agentTasksExposeGold: agentTaskGoldPathLeaks > 0,
      agentTaskScorerMetadataLeaks,
      agentTasksExposeScorerMetadata: agentTaskScorerMetadataLeaks > 0,
    },
    warnings,
    sampleAgentTasks: tasks.slice(0, sampleLimit).map((task) => task.agentTask),
    ...(options.includeTasks ? { tasks } : {}),
  };
}

function agentTaskContainsScorerMetadata(task: SpreadsheetBenchAgentTask): boolean {
  return Object.keys(task).some((key) => key === "answerPosition" || key === "answerSheet" || key === "dataPosition");
}

function scanV1(root: string): SpreadsheetBenchTask[] {
  const datasetPath = join(root, "dataset.json");
  if (!existsSync(datasetPath)) throw new Error("SpreadsheetBench V1 root must contain dataset.json");
  const rows = readJsonArray(datasetPath);
  return rows.map((row) => {
    const id = requiredString(row, "id");
    const taskDir = resolveDatasetPath(dirname(datasetPath), optionalString(row, "spreadsheet_path") ?? `spreadsheet/${id}`);
    const files = existingFiles(taskDir);
    const promptFiles = files.filter(isPromptPath).map((file) => rel(root, file));
    const evaluatorGoldFiles = files.filter((file) => isWorkbookPath(file) && isGoldPath(file)).map((file) => rel(root, file));
    const inputFiles = files
      .filter((file) => isWorkbookPath(file) && !isGoldPath(file))
      .map((file) => rel(root, file));
    const warnings = missingPathWarnings(taskDir, inputFiles, evaluatorGoldFiles);
    const agentTask = agentTaskFromRow({
      row,
      track: "spreadsheetbench-v1",
      id,
      inputFiles,
      promptFiles,
      goldAvailable: evaluatorGoldFiles.length > 0,
    });
    return {
      id,
      track: "spreadsheetbench-v1",
      sourceDatasetJson: rel(root, datasetPath),
      agentTask,
      evaluatorMetadata: evaluatorMetadataFromRow(row),
      evaluatorGoldFiles,
      warnings,
    };
  });
}

function scanV2(root: string): SpreadsheetBenchTask[] {
  const datasetPaths = walkFiles(root).filter((file) => basename(file) === "dataset.json");
  if (datasetPaths.length === 0) throw new Error("SpreadsheetBench V2 root must contain category dataset.json files");
  return datasetPaths.flatMap((datasetPath) => {
    const category = basename(dirname(datasetPath));
    const base = dirname(datasetPath);
    return readJsonArray(datasetPath).map((row) => {
      const id = requiredString(row, "id");
      const scopedId = `${category}/${id}`;
      const inputFiles = collectPath(base, optionalString(row, "spreadsheet_path"))
        .filter((file) => isWorkbookPath(file) && !isGoldPath(file))
        .map((file) => rel(root, file));
      const evaluatorGoldFiles = collectPath(base, optionalString(row, "golden_response_path"))
        .filter((file) => isWorkbookPath(file) && isGoldPath(file))
        .map((file) => rel(root, file));
      const promptFiles = collectPromptFiles(base, row, inputFiles, root).map((file) => rel(root, file));
      const warnings = missingPathWarnings(base, inputFiles, evaluatorGoldFiles);
      const agentTask = agentTaskFromRow({
        row,
        track: "spreadsheetbench-v2",
        id: scopedId,
        category,
        inputFiles,
        promptFiles,
        goldAvailable: evaluatorGoldFiles.length > 0,
      });
      return {
        id: scopedId,
        track: "spreadsheetbench-v2",
        category,
        sourceDatasetJson: rel(root, datasetPath),
        agentTask,
        evaluatorMetadata: evaluatorMetadataFromRow(row),
        evaluatorGoldFiles,
        warnings,
      };
    });
  });
}

function agentTaskFromRow(args: {
  row: RawTask;
  track: SpreadsheetBenchTrack;
  id: string;
  category?: string;
  inputFiles: string[];
  promptFiles: string[];
  goldAvailable: boolean;
}): SpreadsheetBenchAgentTask {
  return {
    id: args.id,
    track: args.track,
    category: args.category,
    instruction: optionalString(args.row, "instruction") ?? "",
    instructionType: optionalString(args.row, "instruction_type"),
    inputFiles: args.inputFiles,
    promptFiles: args.promptFiles,
    goldAvailable: args.goldAvailable,
  };
}

function evaluatorMetadataFromRow(row: RawTask): SpreadsheetBenchEvaluatorMetadata {
  return {
    answerPosition: optionalString(row, "answer_position"),
    answerSheet: optionalString(row, "answer_sheet"),
    dataPosition: optionalString(row, "data_position"),
  };
}

function collectPromptFiles(base: string, row: RawTask, inputFiles: string[], root: string): string[] {
  const explicit = collectPath(base, optionalString(row, "prompt_path")).filter(isPromptPath);
  if (explicit.length > 0) return explicit;
  const inputRoots = inputFiles.map((file) => dirname(resolve(root, file)));
  const candidates = new Set<string>();
  for (const dir of inputRoots) {
    for (const file of existingFiles(dir)) {
      if (isPromptPath(file)) candidates.add(file);
    }
  }
  return [...candidates];
}

function collectPath(base: string, rawPath: string | undefined): string[] {
  if (!rawPath) return [];
  const target = resolveDatasetPath(base, rawPath);
  if (!existsSync(target)) return [];
  return statSync(target).isDirectory() ? walkFiles(target) : [target];
}

function existingFiles(path: string): string[] {
  if (!existsSync(path)) return [];
  return statSync(path).isDirectory() ? walkFiles(path) : [path];
}

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, item.name);
    if (item.isDirectory()) out.push(...walkFiles(full));
    else if (item.isFile()) out.push(full);
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function resolveDatasetPath(base: string, rawPath: string): string {
  return resolve(base, rawPath.replace(/\\/g, "/"));
}

function rel(root: string, file: string): string {
  return normalizePath(relative(root, file));
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isWorkbookPath(file: string): boolean {
  return /\.(xlsx|xlsm|xls)$/i.test(file);
}

function isPromptPath(file: string): boolean {
  return basename(file).toLowerCase().includes("prompt") && /\.txt$/i.test(file);
}

function isGoldPath(file: string): boolean {
  return /(^|[/\\])[^/\\]*(answer|golden|gold|ground[_-]?truth)[^/\\]*\.(xlsx|xlsm|xls)$/i.test(file);
}

function readJsonArray(file: string): RawTask[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`Expected JSON array in ${file}`);
  return parsed as RawTask[];
}

function requiredString(row: RawTask, key: string): string {
  const value = row[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  throw new Error(`Missing required string field ${key}`);
}

function optionalString(row: RawTask, key: string): string | undefined {
  const value = row[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return undefined;
}

function missingPathWarnings(scope: string, inputFiles: string[], evaluatorGoldFiles: string[]): string[] {
  const warnings: string[] = [];
  if (!existsSync(scope)) warnings.push(`missing task path: ${scope}`);
  if (inputFiles.length === 0) warnings.push("no input workbook files found");
  if (evaluatorGoldFiles.length === 0) warnings.push("no evaluator gold workbook files found");
  return warnings;
}

function sum<T>(items: T[], fn: (item: T) => number): number {
  return items.reduce((total, item) => total + fn(item), 0);
}
