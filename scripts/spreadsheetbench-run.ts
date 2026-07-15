import "./benchmark/loadEnv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { runStagedSpreadsheetBench, type SpreadsheetBenchRunnerMode } from "../src/eval/spreadsheetBenchRunner";
import type { OpenRouterFreeModelMode } from "../src/nodeagent/models/openRouterFreeModels";

const args = process.argv.slice(2);
const stageRoot = optionValue("--stage-root");
const outputRoot = optionValue("--output-root");
const jsonOut = optionValue("--json-out");
const mode = (optionValue("--mode") ?? "copy-input-baseline") as SpreadsheetBenchRunnerMode;
const modelId = optionValue("--model");
const freeAutoMode = optionValue("--free-auto-mode") as OpenRouterFreeModelMode | undefined;
const modelTimeoutMs = numberOption("--model-timeout-ms") ?? 120_000;
const modelBatchSize = numberOption("--model-batch-size") ?? 1;
const modelSnapshotMaxCells = numberOption("--model-snapshot-max-cells");
const modelSnapshotMaxCellChars = numberOption("--model-snapshot-max-cell-chars");
const modelRepairAttempts = numberOption("--model-repair-attempts")
  ?? (mode === "model-edit-plan" || mode === "nodeagent-workbook" ? 1 : 0);
const taskIdsFile = optionValue("--task-ids-file");
const taskIds = taskIdsFile ? readTaskIds(taskIdsFile) : undefined;
const limit = numberOption("--limit");
const offset = numberOption("--offset") ?? 0;
const repeats = numberOption("--repeats") ?? 1;
const retryFailed = numberOption("--retry-failed") ?? 0;
const maxMismatches = numberOption("--max-mismatches") ?? 20;
const clean = args.includes("--clean");
const compareStyles = args.includes("--compare-styles");
const compareCharts = args.includes("--compare-charts");
const retryScoreFailures = args.includes("--retry-score-failures");
const refreshExcelCaches = args.includes("--refresh-excel-caches");

const allowedModes: SpreadsheetBenchRunnerMode[] = [
  "copy-input-baseline",
  "apply-agent-patch",
  "model-edit-plan",
  "nodeagent-workbook",
];
const allowedFreeAutoModes: OpenRouterFreeModelMode[] = ["chat", "agent", "structured", "vision", "coding"];
const modeRequiresModel = mode === "model-edit-plan" || mode === "nodeagent-workbook";

if (!stageRoot || !outputRoot || !allowedModes.includes(mode)) {
  console.error([
    "Usage:",
    "  npm run benchmark:spreadsheetbench:run -- --stage-root <staged-dir> --output-root <candidate-output-dir> [--mode copy-input-baseline|apply-agent-patch|model-edit-plan|nodeagent-workbook] [--model <route>] [--free-auto-mode chat|agent|structured|vision|coding] [--model-batch-size 1] [--model-snapshot-max-cells 800] [--model-snapshot-max-cell-chars 256] [--model-repair-attempts 1] [--refresh-excel-caches] [--task-ids-file <ids.json>] [--offset 0] [--limit 3] [--repeats 5] [--retry-failed 2] [--retry-score-failures] [--compare-charts] [--clean] [--json-out <path>]",
    "",
    "copy-input-baseline proves runner/export/scoring plumbing.",
    "apply-agent-patch reads agent/edit-plan.json, edits the workbook, emits a candidate, then opens evaluator metadata.",
    "model-edit-plan asks the configured model to emit that edit plan from the staged agent bundle.",
    "nodeagent-workbook requires --model, defaults OpenRouter free-auto routing to agent, and runs the NodeAgent workbook tool loop (batch size must be 1).",
    "Model-backed runs are not official model scores unless produced by a benchmark runner under the recorded model/tool policy.",
  ].join("\n"));
  process.exit(2);
}

if (modeRequiresModel && !modelId) {
  console.error(`${mode} requires --model <route>.`);
  process.exit(2);
}

if (freeAutoMode && !allowedFreeAutoModes.includes(freeAutoMode)) {
  console.error(`--free-auto-mode must be one of: ${allowedFreeAutoModes.join(", ")}`);
  process.exit(2);
}
if (modelBatchSize < 1 || modelBatchSize > 16) {
  throw new Error("--model-batch-size must be between 1 and 16.");
}
if (mode === "nodeagent-workbook" && modelBatchSize > 1) {
  throw new Error("nodeagent-workbook requires --model-batch-size 1.");
}
if (refreshExcelCaches && mode !== "nodeagent-workbook") {
  throw new Error("--refresh-excel-caches requires --mode nodeagent-workbook.");
}
if (modelSnapshotMaxCells !== undefined && modelSnapshotMaxCells < 1) {
  throw new Error("--model-snapshot-max-cells must be at least 1.");
}
if (modelSnapshotMaxCellChars !== undefined && modelSnapshotMaxCellChars < 1) {
  throw new Error("--model-snapshot-max-cell-chars must be at least 1.");
}
if (modelRepairAttempts < 0 || modelRepairAttempts > 3) {
  throw new Error("--model-repair-attempts must be between 0 and 3.");
}

const agentModel = modelId
  ? (await import("../src/nodeagent/models/adapter")).model(modelId, {
      freeAutoMode: freeAutoMode ?? (mode === "nodeagent-workbook" ? "agent" : mode === "model-edit-plan" ? "structured" : undefined),
    })
  : undefined;

const report = await runStagedSpreadsheetBench({
  stageRoot,
  outputRoot,
  mode,
  model: agentModel,
  modelName: modelId,
  modelTimeoutMs,
  modelBatchSize,
  modelSnapshotMaxCells,
  modelSnapshotMaxCellChars,
  modelRepairAttempts,
  refreshExcelCaches,
  taskIds,
  limit,
  offset,
  repeats,
  retryFailed,
  retryScoreFailures,
  clean,
  compareStyles,
  compareCharts,
  maxMismatches,
  generatedAt: new Date().toISOString(),
});

const content = `${JSON.stringify(report, null, 2)}\n`;
if (jsonOut) {
  const outPath = resolve(jsonOut);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, content);
  console.log(`wrote ${rel(outPath)}`);
} else {
  process.stdout.write(content);
}

function optionValue(name: string): string | undefined {
  const prefix = `${name}=`;
  const equalArg = args.find((arg) => arg.startsWith(prefix));
  if (equalArg) return equalArg.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(name: string): number | undefined {
  const raw = optionValue(name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return Math.floor(value);
}

function readTaskIds(path: string): string[] {
  const value = JSON.parse(readFileSync(resolve(path), "utf8")) as unknown;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`--task-ids-file must contain a JSON array of non-empty strings: ${path}`);
  }
  const unique = [...new Set(value.map((item) => item.trim()))];
  if (unique.length !== value.length) throw new Error(`--task-ids-file contains duplicate task IDs: ${path}`);
  return unique;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
