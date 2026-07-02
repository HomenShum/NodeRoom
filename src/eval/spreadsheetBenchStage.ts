import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  scanSpreadsheetBenchBundle,
  type SpreadsheetBenchTask,
  type SpreadsheetBenchTrack,
} from "./spreadsheetBenchAdapter";

export type SpreadsheetBenchStageOptions = {
  track: SpreadsheetBenchTrack;
  outputRoot: string;
  limit?: number;
  clean?: boolean;
  generatedAt?: string;
};

export type SpreadsheetBenchStagedTask = {
  id: string;
  category?: string;
  taskDir: string;
  agentManifest: string;
  evaluatorManifest: string;
  agentInputFiles: string[];
  agentPromptFiles: string[];
  evaluatorGoldFiles: string[];
  warnings: string[];
};

export type SpreadsheetBenchStageReport = {
  schema: 1;
  generatedAt?: string;
  sourceRoot: string;
  outputRoot: string;
  track: SpreadsheetBenchTrack;
  scannedTaskCount: number;
  stagedTaskCount: number;
  skippedTaskCount: number;
  agentFileCount: number;
  evaluatorGoldFileCount: number;
  isolation: {
    agentDirectoryGoldFileCount: number;
    agentManifestGoldPathLeaks: number;
    agentManifestScorerMetadataLeaks: number;
    agentEvaluatorPathOverlap: boolean;
  };
  warnings: string[];
  tasks: SpreadsheetBenchStagedTask[];
};

type AgentTaskManifest = {
  schema: 1;
  taskId: string;
  track: SpreadsheetBenchTrack;
  category?: string;
  instruction: string;
  instructionType?: string;
  inputFiles: string[];
  promptFiles: string[];
};

type EvaluatorTaskManifest = {
  schema: 1;
  taskId: string;
  track: SpreadsheetBenchTrack;
  answerPosition?: string;
  answerSheet?: string;
  dataPosition?: string;
  goldFiles: string[];
};

export function stageSpreadsheetBenchBundle(rootDir: string, options: SpreadsheetBenchStageOptions): SpreadsheetBenchStageReport {
  const sourceRoot = resolve(rootDir);
  const outputRoot = resolve(options.outputRoot);
  if (options.clean && existsSync(outputRoot)) rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const ingest = scanSpreadsheetBenchBundle(sourceRoot, {
    track: options.track,
    includeTasks: true,
    sampleLimit: 0,
    generatedAt: options.generatedAt,
  });
  const allTasks = ingest.tasks ?? [];
  const eligible = allTasks.filter((task) => task.agentTask.inputFiles.length > 0 && task.evaluatorGoldFiles.length > 0);
  const selected = eligible.slice(0, options.limit ?? eligible.length);
  const staged = selected.map((task) => stageTask(sourceRoot, outputRoot, task));
  const warnings = [
    ...ingest.warnings,
    ...allTasks
      .filter((task) => task.agentTask.inputFiles.length === 0 || task.evaluatorGoldFiles.length === 0)
      .map((task) => `${task.id}: skipped because input workbook or evaluator gold is missing`),
    ...staged.flatMap((task) => task.warnings.map((warning) => `${task.id}: ${warning}`)),
  ];
  const agentDirectoryGoldFileCount = staged.reduce((sum, task) =>
    sum + task.agentInputFiles.concat(task.agentPromptFiles).filter((file) => /answer|gold|golden|ground[_-]?truth/i.test(file)).length, 0);
  const agentManifestGoldPathLeaks = staged.filter((task) => manifestLeaksGold(join(outputRoot, task.agentManifest))).length;
  const agentManifestScorerMetadataLeaks = staged.filter((task) => manifestLeaksScorerMetadata(join(outputRoot, task.agentManifest))).length;
  const agentEvaluatorPathOverlap = staged.some((task) =>
    task.agentInputFiles.concat(task.agentPromptFiles).some((agentPath) => task.evaluatorGoldFiles.includes(agentPath)));

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    sourceRoot: basename(sourceRoot),
    outputRoot: basename(outputRoot),
    track: options.track,
    scannedTaskCount: ingest.taskCount,
    stagedTaskCount: staged.length,
    skippedTaskCount: allTasks.length - staged.length,
    agentFileCount: staged.reduce((sum, task) => sum + task.agentInputFiles.length + task.agentPromptFiles.length, 0),
    evaluatorGoldFileCount: staged.reduce((sum, task) => sum + task.evaluatorGoldFiles.length, 0),
    isolation: {
      agentDirectoryGoldFileCount,
      agentManifestGoldPathLeaks,
      agentManifestScorerMetadataLeaks,
      agentEvaluatorPathOverlap,
    },
    warnings,
    tasks: staged,
  };
}

function stageTask(sourceRoot: string, outputRoot: string, task: SpreadsheetBenchTask): SpreadsheetBenchStagedTask {
  const taskDir = `tasks/${safeId(task.id)}`;
  const agentDir = join(outputRoot, taskDir, "agent");
  const evaluatorDir = join(outputRoot, taskDir, "evaluator");
  mkdirSync(join(agentDir, "inputs"), { recursive: true });
  mkdirSync(join(agentDir, "prompts"), { recursive: true });
  mkdirSync(join(evaluatorDir, "gold"), { recursive: true });

  const warnings: string[] = [];
  const agentInputFiles = copyFiles(sourceRoot, task.agentTask.inputFiles, join(agentDir, "inputs"), warnings)
    .map((file) => rel(outputRoot, file));
  const agentPromptFiles = copyFiles(sourceRoot, task.agentTask.promptFiles, join(agentDir, "prompts"), warnings)
    .map((file) => rel(outputRoot, file));
  const evaluatorGoldFiles = copyFiles(sourceRoot, task.evaluatorGoldFiles, join(evaluatorDir, "gold"), warnings)
    .map((file) => rel(outputRoot, file));
  const agentManifest: AgentTaskManifest = {
    schema: 1,
    taskId: task.id,
    track: task.track,
    category: task.category,
    instruction: task.agentTask.instruction,
    instructionType: task.agentTask.instructionType,
    inputFiles: agentInputFiles.map((file) => rel(join(outputRoot, taskDir, "agent"), join(outputRoot, file))),
    promptFiles: agentPromptFiles.map((file) => rel(join(outputRoot, taskDir, "agent"), join(outputRoot, file))),
  };
  const evaluatorManifest: EvaluatorTaskManifest = {
    schema: 1,
    taskId: task.id,
    track: task.track,
    answerPosition: task.evaluatorMetadata.answerPosition,
    answerSheet: task.evaluatorMetadata.answerSheet,
    dataPosition: task.evaluatorMetadata.dataPosition,
    goldFiles: evaluatorGoldFiles.map((file) => rel(join(outputRoot, taskDir, "evaluator"), join(outputRoot, file))),
  };
  const agentManifestPath = join(agentDir, "task.json");
  const evaluatorManifestPath = join(evaluatorDir, "evaluator.json");
  writeJson(agentManifestPath, agentManifest);
  writeJson(evaluatorManifestPath, evaluatorManifest);

  return {
    id: task.id,
    category: task.category,
    taskDir,
    agentManifest: rel(outputRoot, agentManifestPath),
    evaluatorManifest: rel(outputRoot, evaluatorManifestPath),
    agentInputFiles,
    agentPromptFiles,
    evaluatorGoldFiles,
    warnings,
  };
}

function copyFiles(sourceRoot: string, sourceFiles: string[], destinationDir: string, warnings: string[]): string[] {
  return sourceFiles.flatMap((sourceFile, index) => {
    const source = join(sourceRoot, sourceFile);
    if (!existsSync(source)) {
      warnings.push(`missing source file for copy: ${sourceFile}`);
      return [];
    }
    const target = join(destinationDir, `${String(index + 1).padStart(2, "0")}-${safeFileName(basename(sourceFile))}`);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
    return [target];
  });
}

function manifestLeaksGold(path: string): boolean {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const forbiddenKeys = Object.keys(parsed).some((key) => /answer|gold|golden|evaluator/i.test(key));
  const fileValues = [...stringArray(parsed.inputFiles), ...stringArray(parsed.promptFiles)];
  return forbiddenKeys || fileValues.some((file) => /answer|gold|golden|ground[_-]?truth/i.test(file));
}

function manifestLeaksScorerMetadata(path: string): boolean {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  return ["answerPosition", "answerSheet", "dataPosition", "evaluatorMetadata", "goldFiles"].some((key) => key in parsed);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function safeId(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "task";
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_");
}

function rel(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, "/");
}
