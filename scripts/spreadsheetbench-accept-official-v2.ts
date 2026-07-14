import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

type ProjectionReceipt = {
  schema?: number;
  track?: string;
  taskCount?: number;
  projectedOutputCount?: number;
  projectionErrorCount?: number;
  categoryCounts?: Record<string, number>;
  caseManifestSha256?: string;
  cases?: Array<{ taskId?: string; output?: string }>;
  upstream?: {
    repository?: string;
    commit?: string;
    evaluatorSha256?: string;
    visualEvaluatorSha256?: string;
  };
};

type RefreshReceipt = {
  schema?: number;
  workbookCount?: number;
  refreshedCount?: number;
  failureCount?: number;
  engine?: string;
  engineVersion?: string;
  records?: Array<{ path?: string; status?: string; afterSha256?: string; openMode?: string }>;
};

type DeterministicResult = {
  total_tests?: number;
  missing_outputs?: number;
  regression_accuracy?: number;
  modification_accuracy?: number;
  accuracy?: number;
  scores?: Array<{
    id?: string | number;
    regression_accuracy?: number;
    modification_accuracy?: number;
    accuracy?: number;
  }>;
};

type VisualResult = {
  meta?: { eval_method?: string; model?: string; base_url?: string };
  summary?: {
    total_tasks?: number;
    completed?: number;
    pending?: number;
    evaluated?: number;
    errors?: number;
    all_task_avg_score?: number;
    acc?: number;
    acc_tasks?: number;
    acc_total?: number;
    acc_threshold?: number;
  };
  results?: Array<{ task_id?: string | number; status?: string; score?: number; acc?: number }>;
};

type DatasetTask = { id?: string | number };

const args = process.argv.slice(2);
const projectionPath = resolve(requiredOption("--projection"));
const refreshPath = resolve(requiredOption("--refresh"));
const upstreamRepo = resolve(requiredOption("--upstream-repo"));
const receiptOut = resolve(requiredOption("--receipt-out"));
const resultCopyDir = resolve(requiredOption("--result-copy-dir"));
const projection = readJson<ProjectionReceipt>(projectionPath);
const refresh = readJson<RefreshReceipt>(refreshPath);
const deterministicCategories = [
  ["Debugging", 100],
  ["Financial_Model", 100],
  ["Template", 97],
] as const;

if (projection.schema !== 1 || projection.track !== "spreadsheetbench-v2") throw new Error("invalid V2 projection receipt");
if (projection.taskCount !== 321 || projection.projectedOutputCount !== 321 || projection.projectionErrorCount !== 0) {
  throw new Error("V2 projection must contain 321 outputs with zero errors");
}
if (!/^[a-f0-9]{64}$/i.test(projection.caseManifestSha256 ?? "")) throw new Error("projection case manifest hash is invalid");
if (refresh.schema !== 1 || refresh.workbookCount !== 321 || refresh.refreshedCount !== 321 || refresh.failureCount !== 0) {
  throw new Error("V2 refresh receipt must prove 321 refreshed outputs with zero failures");
}

const projectedOutputs = new Set((projection.cases ?? []).map((item) => item.output));
const refreshRecords = refresh.records ?? [];
if (projectedOutputs.size !== 321 || refreshRecords.length !== 321) throw new Error("projection/refresh output sets must each contain 321 files");
for (const record of refreshRecords) {
  if (!record.path || record.status !== "refreshed" || !/^[a-f0-9]{64}$/i.test(record.afterSha256 ?? "")) {
    throw new Error(`invalid refresh record: ${String(record.path)}`);
  }
  const absolute = resolve(record.path);
  if (!existsSync(absolute) || sha256File(absolute) !== record.afterSha256) throw new Error(`refreshed output hash mismatch: ${record.path}`);
  if (!projectedOutputs.has(record.path)) throw new Error(`refresh output absent from projection: ${record.path}`);
}

const evaluatorPath = join(upstreamRepo, "evaluation", "evaluation.py");
const visualEvaluatorPath = join(upstreamRepo, "evaluation", "run_visual_vlm_checklist_eval.py");
if (sha256File(evaluatorPath) !== projection.upstream?.evaluatorSha256) throw new Error("deterministic evaluator hash mismatch");
if (sha256File(visualEvaluatorPath) !== projection.upstream?.visualEvaluatorSha256) throw new Error("visual evaluator hash mismatch");

mkdirSync(resultCopyDir, { recursive: true });
const categoryMetrics: Record<string, unknown> = {};
const sourceResults: Array<{ category: string; path: string; sha256: string; copy: string; copySha256: string }> = [];
let passCount = 0;
let scoredTaskCount = 0;
for (const [category, expectedCount] of deterministicCategories) {
  const resultPath = join(upstreamRepo, "results", category, `noderoom_${category}__regression.json`);
  const result = readJson<DeterministicResult>(resultPath);
  const datasetPath = join(upstreamRepo, "data", category, "dataset.json");
  const expectedIds = new Set(readJson<DatasetTask[]>(datasetPath).map((task) => String(task.id)));
  if (result.total_tests !== expectedCount || result.missing_outputs !== 0 || result.scores?.length !== expectedCount) {
    throw new Error(`${category} official result has incomplete coverage`);
  }
  const actualIds = new Set(result.scores.map((row) => String(row.id)));
  if (actualIds.size !== expectedCount || [...expectedIds].some((id) => !actualIds.has(id))) {
    throw new Error(`${category} official result task IDs do not match the upstream dataset`);
  }
  for (const row of result.scores) {
    for (const key of ["regression_accuracy", "modification_accuracy", "accuracy"] as const) {
      const value = row[key];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`${category} ${String(row.id)} has invalid ${key}`);
      }
    }
    if (row.accuracy !== 0 && row.accuracy !== 1) throw new Error(`${category} ${String(row.id)} accuracy must be binary`);
    passCount += row.accuracy;
  }
  scoredTaskCount += expectedCount;
  categoryMetrics[category] = {
    taskCount: expectedCount,
    passCount: result.scores.filter((row) => row.accuracy === 1).length,
    accuracy: result.accuracy,
    regressionAccuracy: result.regression_accuracy,
    modificationAccuracy: result.modification_accuracy,
  };
  sourceResults.push(copyResult(category, resultPath, resultCopyDir));
}

const visualResultPath = join(upstreamRepo, "results", "Visualization", "noderoom_Visualization_official.json");
const visual = readJson<VisualResult>(visualResultPath);
const visualIds = new Set(readJson<DatasetTask[]>(join(upstreamRepo, "data", "Visualization", "dataset.json")).map((task) => String(task.id)));
if (
  visual.meta?.eval_method !== "vlm_checklist_only"
  || visual.meta.model !== "z-ai/glm-4.6v"
  || visual.meta.base_url !== "https://openrouter.ai/api/v1"
  || visual.summary?.total_tasks !== 24
  || visual.summary.completed !== 24
  || visual.summary.pending !== 0
  || visual.summary.acc_total !== 24
  || visual.results?.length !== 24
) {
  throw new Error("Visualization official result has an invalid judge contract or incomplete coverage");
}
const actualVisualIds = new Set(visual.results.map((row) => String(row.task_id)));
if (actualVisualIds.size !== 24 || [...visualIds].some((id) => !actualVisualIds.has(id))) {
  throw new Error("Visualization official result task IDs do not match the upstream dataset");
}
for (const row of visual.results) {
  if (typeof row.score !== "number" || !Number.isFinite(row.score) || row.score < 0 || row.score > 1) throw new Error("invalid visual score");
  if (row.acc !== 0 && row.acc !== 1) throw new Error("visual acc must be binary");
  passCount += row.acc;
}
scoredTaskCount += 24;
categoryMetrics.Visualization = {
  taskCount: 24,
  passCount: visual.summary.acc_tasks,
  accuracy: visual.summary.acc,
  averageChecklistScore: visual.summary.all_task_avg_score,
  evaluatedByVlm: visual.summary.evaluated,
  errorsScoredAsZero: visual.summary.errors,
  judgeCalls: visual.summary.evaluated,
};
sourceResults.push(copyResult("Visualization", visualResultPath, resultCopyDir));

if (scoredTaskCount !== 321) throw new Error(`official V2 result must score 321 tasks, got ${scoredTaskCount}`);
const passRate = passCount / scoredTaskCount;
writeJson(receiptOut, {
  schema: 1,
  verifier: "spreadsheetbench_official_scorer",
  track: "spreadsheetbench-v2",
  accepted: true,
  generatedAt: new Date().toISOString(),
  score: {
    averageOverall: passRate,
    passRate,
    passCount,
    scoredTaskCount,
  },
  metric: {
    primary: "official_task_accuracy",
    categoryMetrics,
    visualAccThreshold: visual.summary.acc_threshold,
    visualJudgeModel: visual.meta.model,
    visualJudgeCalls: visual.summary.evaluated,
    providerCostUsd: visual.summary.evaluated === 0 ? 0 : null,
  },
  source: {
    kind: "upstream_official_evaluators",
    repository: projection.upstream?.repository,
    commit: projection.upstream?.commit,
    deterministicEvaluator: rel(evaluatorPath),
    deterministicEvaluatorSha256: sha256File(evaluatorPath),
    visualEvaluator: rel(visualEvaluatorPath),
    visualEvaluatorSha256: sha256File(visualEvaluatorPath),
    projectionReceipt: rel(projectionPath),
    projectionReceiptSha256: sha256File(projectionPath),
    caseManifestSha256: projection.caseManifestSha256,
    refreshReceipt: rel(refreshPath),
    refreshReceiptSha256: sha256File(refreshPath),
    refreshEngine: refresh.engine,
    refreshEngineVersion: refresh.engineVersion,
    results: sourceResults,
    runtime: "Python 3; upstream evaluation.py and run_visual_vlm_checklist_eval.py unmodified",
    commands: [
      "python evaluation/evaluation.py --model noderoom --dataset <Debugging|Financial_Model|Template> --outputs-dir outputs/noderoom/<category> --workers 4",
      "python evaluation/run_visual_vlm_checklist_eval.py --tasks-json data/Visualization/dataset.json --output-dir outputs/noderoom/Visualization --base-url https://openrouter.ai/api/v1 --model z-ai/glm-4.6v",
    ],
  },
  claimBoundary: "Canonical upstream SpreadsheetBench V2 evaluation over all 321 model outputs. Visualization tasks with no chart objects are scored zero before VLM inference, as required by the upstream evaluator.",
});
console.log(`accepted SpreadsheetBench V2 official score: ${passCount}/${scoredTaskCount} (${passRate})`);
console.log(`wrote ${rel(receiptOut)}`);

function copyResult(category: string, source: string, destinationDir: string) {
  const slug = category.toLowerCase().replace(/_/g, "-");
  const destination = join(destinationDir, `spreadsheetbench-v2-upstream-official-${slug}.json`);
  writeFileSync(destination, readFileSync(source));
  return { category, path: rel(source), sha256: sha256File(source), copy: rel(destination), copySha256: sha256File(destination) };
}

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
