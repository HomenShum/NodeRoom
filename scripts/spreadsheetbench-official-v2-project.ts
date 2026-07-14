import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

type RunReport = {
  schema?: number;
  mode?: string;
  outputRoot?: string;
  taskCount?: number;
  results?: Array<{
    taskId?: string;
    category?: string;
    mode?: string;
    candidateWorkbook?: string;
    model?: { name?: string; calls?: number };
  }>;
};

type DatasetTask = { id?: string | number };

const CATEGORIES = ["Debugging", "Financial_Model", "Template", "Visualization"] as const;
const EXPECTED_COUNTS: Record<(typeof CATEGORIES)[number], number> = {
  Debugging: 100,
  Financial_Model: 100,
  Template: 97,
  Visualization: 24,
};

const args = process.argv.slice(2);
const reportPath = resolve(requiredOption("--report"));
const runRoot = resolve(requiredOption("--run-root"));
const datasetRoot = resolve(requiredOption("--dataset-root"));
const upstreamRepo = resolve(requiredOption("--upstream-repo"));
const outputsRoot = resolve(requiredOption("--outputs-root"));
const receiptOut = resolve(requiredOption("--receipt-out"));
const clean = args.includes("--clean");
const report = readJson<RunReport>(reportPath);

if (report.schema !== 1) throw new Error(`run report schema must be 1, got ${String(report.schema)}`);
if (report.mode !== "model-edit-plan") throw new Error(`V2 official projection requires model-edit-plan, got ${String(report.mode)}`);
if (report.taskCount !== 321 || report.results?.length !== 321) {
  throw new Error(`V2 official projection requires 321 results, got taskCount=${String(report.taskCount)} results=${report.results?.length ?? 0}`);
}

const upstreamDataRoot = join(upstreamRepo, "data");
if (clean) {
  for (const category of CATEGORIES) {
    rmSync(join(upstreamDataRoot, category), { recursive: true, force: true });
    rmSync(join(outputsRoot, category), { recursive: true, force: true });
  }
}

const datasetIds = new Map<string, Set<string>>();
for (const category of CATEGORIES) {
  const sourceCategory = join(datasetRoot, category);
  const datasetPath = join(sourceCategory, "dataset.json");
  if (!existsSync(datasetPath)) throw new Error(`dataset is missing: ${datasetPath}`);
  const tasks = readJson<DatasetTask[]>(datasetPath);
  const ids = new Set(tasks.map((task) => String(task.id ?? "")));
  if (ids.has("") || ids.size !== EXPECTED_COUNTS[category]) {
    throw new Error(`${category} dataset must contain ${EXPECTED_COUNTS[category]} unique IDs, got ${ids.size}`);
  }
  datasetIds.set(category, ids);
  mkdirSync(upstreamDataRoot, { recursive: true });
  cpSync(sourceCategory, join(upstreamDataRoot, category), { recursive: true, force: true });
}

const seen = new Set<string>();
const categoryCounts = Object.fromEntries(CATEGORIES.map((category) => [category, 0])) as Record<string, number>;
const cases: Array<{
  taskId: string;
  category: string;
  id: string;
  model: string;
  modelCalls: number;
  source: string;
  sourceSha256: string;
  output: string;
  outputSha256: string;
}> = [];
const errors: string[] = [];

for (const result of report.results) {
  const taskId = result.taskId ?? "";
  const slash = taskId.indexOf("/");
  const category = (result.category || taskId.slice(0, slash)) as (typeof CATEGORIES)[number];
  const id = slash >= 0 ? taskId.slice(slash + 1) : "";
  if (!CATEGORIES.includes(category) || !id) {
    errors.push(`invalid task identity: ${taskId}`);
    continue;
  }
  if (seen.has(taskId)) {
    errors.push(`duplicate task: ${taskId}`);
    continue;
  }
  seen.add(taskId);
  if (!datasetIds.get(category)?.has(id)) {
    errors.push(`task is absent from upstream dataset: ${taskId}`);
    continue;
  }
  if ((result.mode ?? report.mode) !== "model-edit-plan") {
    errors.push(`task is not model-generated: ${taskId}`);
    continue;
  }
  const candidateWorkbook = result.candidateWorkbook;
  if (!candidateWorkbook) {
    errors.push(`candidate workbook missing from report: ${taskId}`);
    continue;
  }
  const source = resolve(runRoot, candidateWorkbook);
  if (!existsSync(source)) {
    errors.push(`candidate workbook missing on disk: ${taskId} -> ${source}`);
    continue;
  }
  const output = join(outputsRoot, category, `${id}_output.xlsx`);
  mkdirSync(dirname(output), { recursive: true });
  cpSync(source, output, { force: true });
  const sourceSha256 = sha256File(source);
  const outputSha256 = sha256File(output);
  if (sourceSha256 !== outputSha256) errors.push(`copy hash mismatch: ${taskId}`);
  categoryCounts[category] += 1;
  cases.push({
    taskId,
    category,
    id,
    model: result.model?.name ?? "unknown",
    modelCalls: result.model?.calls ?? 0,
    source: rel(source),
    sourceSha256,
    output: rel(output),
    outputSha256,
  });
}

for (const category of CATEGORIES) {
  if (categoryCounts[category] !== EXPECTED_COUNTS[category]) {
    errors.push(`${category} projection expected ${EXPECTED_COUNTS[category]} outputs, got ${categoryCounts[category]}`);
  }
}
if (seen.size !== 321) errors.push(`projection expected 321 unique tasks, got ${seen.size}`);

const evaluatorPath = join(upstreamRepo, "evaluation", "evaluation.py");
const visualEvaluatorPath = join(upstreamRepo, "evaluation", "run_visual_vlm_checklist_eval.py");
if (!existsSync(evaluatorPath) || !existsSync(visualEvaluatorPath)) throw new Error("upstream V2 evaluators are missing");
cases.sort((a, b) => a.taskId.localeCompare(b.taskId));
const caseManifestSha256 = sha256(JSON.stringify(cases));
writeJson(receiptOut, {
  schema: 1,
  track: "spreadsheetbench-v2",
  generatedAt: new Date().toISOString(),
  report: rel(reportPath),
  reportSha256: sha256File(reportPath),
  taskCount: seen.size,
  projectedOutputCount: cases.length,
  projectionErrorCount: errors.length,
  categoryCounts,
  caseManifestSha256,
  outputsRoot: rel(outputsRoot),
  upstream: {
    repository: "https://github.com/RUCKBReasoning/SpreadsheetBench-2",
    commit: gitCommit(upstreamRepo),
    evaluator: rel(evaluatorPath),
    evaluatorSha256: sha256File(evaluatorPath),
    visualEvaluator: rel(visualEvaluatorPath),
    visualEvaluatorSha256: sha256File(visualEvaluatorPath),
  },
  errors,
  cases,
});
console.log(`projected ${cases.length}/321 V2 model outputs (${errors.length} errors)`);
console.log(`wrote ${rel(receiptOut)}`);
if (errors.length) process.exitCode = 1;

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function gitCommit(repo: string): string {
  const head = readFileSync(join(repo, ".git", "HEAD"), "utf8").trim();
  if (!head.startsWith("ref: ")) return head;
  return readFileSync(join(repo, ".git", head.slice(5)), "utf8").trim();
}

function requiredOption(name: string): string {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
