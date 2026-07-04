import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import type { BenchmarkAdapterId } from "../src/eval/proofloopBenchmarkAdapters";
import {
  officialOutputManifestPath,
  type ProofloopOfficialOutputManifest,
} from "../src/eval/proofloopOfficialOutputManifests";

type OutputAdapterId = Extract<BenchmarkAdapterId, "finch" | "finauditing">;

type FinchTask = {
  id: string;
  source_files?: string[];
};

const args = process.argv.slice(2);
const selectedIds = optionValues("--id") as OutputAdapterId[];
const ids: OutputAdapterId[] = selectedIds.length ? selectedIds : ["finch", "finauditing"];
const root = process.cwd();
const generatedAt = new Date().toISOString();
const python = optionValue("--python") ?? "python";
const runFinchPipeline = args.includes("--run-finch-pipeline") && !args.includes("--skip-finch-pipeline");
const localRoot = optionValue("--output-root") ?? ".tmp/official-benchmarks/proofloop-official-outputs";
const manifests: ProofloopOfficialOutputManifest[] = [];

const FIN_AUDITING_EXPORTER_PY = String.raw`
import json
import math
import sys
from pathlib import Path

import pandas as pd

root = Path(sys.argv[1])
output_root = Path(sys.argv[2])
generated_at = sys.argv[3]

datasets = [
    ("FinSM", root / ".tmp/official-benchmarks/finauditing-FinSM/data/test-00000-of-00001.parquet", "[]"),
    ("FinRE", root / ".tmp/official-benchmarks/finauditing-FinRE/data/test-00000-of-00001.parquet", "Inappropriateness"),
    ("FinMR", root / ".tmp/official-benchmarks/finauditing-FinMR/data/test-00000-of-00001.parquet", json.dumps({"extracted_value": "", "calculated_value": ""})),
]

def clean(value):
    try:
        if value is None:
            return None
        if isinstance(value, float) and math.isnan(value):
            return None
        if hasattr(value, "item"):
            return clean(value.item())
        if isinstance(value, (list, tuple)):
            return [clean(v) for v in value]
        if isinstance(value, dict):
            return {str(k): clean(v) for k, v in value.items()}
        return value
    except Exception:
        return str(value)

files = []
dataset_summaries = []
official_task_count = 0
prediction_row_count = 0
output_root.mkdir(parents=True, exist_ok=True)

for dataset_id, parquet_path, baseline_prediction in datasets:
    df = pd.read_parquet(parquet_path)
    out_path = output_root / f"{dataset_id}.predictions.jsonl"
    rows = 0
    with out_path.open("w", encoding="utf-8") as f:
        for _, row in df.iterrows():
            obj = {
                "dataset": dataset_id,
                "id": str(clean(row.get("id"))),
                "task_id": f"{dataset_id}-{clean(row.get('id'))}",
                "dqc_id": clean(row.get("dqc_id")),
                "query": clean(row.get("query")),
                "prediction": baseline_prediction,
                "ground_truth": clean(row.get("answer")),
                "generation_policy": "deterministic low-information baseline; not an official model score claim",
            }
            if "choices" in row:
                obj["choices"] = clean(row.get("choices"))
            if "gold" in row:
                obj["gold"] = clean(row.get("gold"))
            f.write(json.dumps(obj, ensure_ascii=False) + "\n")
            rows += 1
    files.append(str(out_path))
    official_task_count += len(df)
    prediction_row_count += rows
    dataset_summaries.append({
        "id": dataset_id,
        "taskCount": int(len(df)),
        "predictionRows": int(rows),
        "path": str(out_path),
    })

manifest_path = output_root / "manifest.json"
manifest_path.write_text(json.dumps({
    "schema": "proofloop-finauditing-prediction-output-manifest-v1",
    "generatedAt": generated_at,
    "generationPolicy": "deterministic low-information baseline; not an official model score claim",
    "officialTaskCount": official_task_count,
    "predictionRowCount": prediction_row_count,
    "datasets": dataset_summaries,
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
files.append(str(manifest_path))

print(json.dumps({
    "officialTaskCount": official_task_count,
    "predictionRowCount": prediction_row_count,
    "files": files,
    "datasets": dataset_summaries,
}, ensure_ascii=False))
`;

for (const id of ids) {
  if (id === "finch") manifests.push(await exportFinch());
  else if (id === "finauditing") manifests.push(exportFinAuditing());
  else throw new Error(`Unsupported official-output adapter: ${id}`);
}

for (const manifest of manifests) {
  const adapterId = manifest.adapterId as OutputAdapterId;
  const path = officialOutputManifestPath(adapterId);
  writeJson(path, manifest);
  updateOfficialScoreReceipt(adapterId, manifest);
  console.log(`${adapterId}: ${manifest.status} ${producedSummary(manifest)} -> ${path}`);
}

async function exportFinch(): Promise<ProofloopOfficialOutputManifest> {
  const adapterId = "finch" as const;
  const datasetRoot = resolve(root, ".tmp/official-benchmarks/finch-dataset");
  const repoRoot = resolve(root, ".tmp/official-benchmarks/finch-repo");
  const jsonlPath = join(datasetRoot, "finch_workflows_test.jsonl");
  const outputRoot = resolve(root, localRoot, adapterId);
  const modelName = "noderoom-source-workbook-baseline";
  const modelOutputDir = join(outputRoot, "model-output", modelName);
  const evalSetRoot = join(outputRoot, "eval_set");
  const blockers: string[] = [];
  const evidence: string[] = [];

  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(modelOutputDir, { recursive: true });

  const tasks = existsSync(jsonlPath) ? readJsonl<FinchTask>(jsonlPath) : [];
  if (tasks.length === 0) blockers.push(`Finch official task JSONL is missing or empty: ${jsonlPath}`);

  let outputTaskCount = 0;
  let generatedBlankWorkbookCount = 0;
  for (const task of tasks) {
    const taskId = String(task.id);
    const sources = task.source_files ?? [];
    if (sources.length === 0) {
      await writeBlankFinchWorkbook(join(modelOutputDir, `${taskId}.xlsx`), task);
      generatedBlankWorkbookCount++;
      outputTaskCount++;
      continue;
    }
    const sourcePath = join(datasetRoot, "files", taskId, sources[0]);
    if (!existsSync(sourcePath)) {
      blockers.push(`Finch source workbook missing for task ${taskId}: ${sourcePath}`);
      continue;
    }
    const suffix = sourcePath.toLowerCase().endsWith(".xlsm") ? ".xlsm" : ".xlsx";
    copyFileSync(sourcePath, join(modelOutputDir, `${taskId}${suffix}`));
    outputTaskCount++;
  }

  const modelOutputManifestPath = join(outputRoot, "model-output-manifest.json");
  writeJson(modelOutputManifestPath, {
    schema: "proofloop-finch-model-output-manifest-v1",
    generatedAt,
    modelName,
    generationPolicy: "No-op baseline: copy each official source workbook as the model output. This is scorer-ingestable artifact coverage, not an official score claim.",
    taskCount: tasks.length,
    outputTaskCount,
    generatedBlankWorkbookCount,
    modelOutputDir,
  });
  evidence.push(normalizeEvidence(modelOutputManifestPath));

  let contentPartsCount = 0;
  let pipelineExitCode: number | null = null;
  if (runFinchPipeline && tasks.length > 0 && outputTaskCount === tasks.length) {
    const pipeline = spawnSync(
      python,
      [
        "src/prompt_build_pipeline.py",
        "--dataset-dir",
        datasetRoot,
        "--output-dir",
        join(outputRoot, "model-output"),
        "--target-dir",
        evalSetRoot,
        "--root-dir",
        evalSetRoot,
        "--models",
        modelName,
        "--project-root",
        repoRoot,
      ],
      { cwd: repoRoot, env: process.env, stdio: "inherit" },
    );
    pipelineExitCode = pipeline.status ?? 1;
    if (pipeline.error) blockers.push(`Finch upstream prompt pipeline could not start: ${pipeline.error.message}`);
    if (pipelineExitCode !== 0) blockers.push(`Finch upstream prompt pipeline exited ${pipelineExitCode}.`);
  } else if (runFinchPipeline) {
    blockers.push("Finch upstream prompt pipeline skipped because the model-output baseline is incomplete.");
  }

  const contentPartsPath = join(evalSetRoot, modelName, "content_parts.jsonl");
  if (existsSync(contentPartsPath)) {
    contentPartsCount = countNonEmptyLines(contentPartsPath);
    evidence.push(normalizeEvidence(contentPartsPath));
  } else if (runFinchPipeline) {
    blockers.push(`Finch content_parts.jsonl was not produced: ${contentPartsPath}`);
  }
  if (runFinchPipeline && tasks.length > 0 && contentPartsCount < tasks.length) {
    blockers.push(`Finch content_parts coverage is ${contentPartsCount}/${tasks.length}.`);
  }

  const complete = tasks.length > 0 && outputTaskCount === tasks.length;
  return {
    schema: "proofloop-official-output-manifest-v1",
    adapterId,
    status: complete ? "complete" : blockers.length ? "partial" : "blocked",
    generatedAt,
    officialTaskCount: tasks.length,
    outputTaskCount,
    contentPartsCount,
    outputRoot: normalizeEvidence(outputRoot),
    officialFormat: "Finch eval_set/<model>/content_parts.jsonl produced by upstream src/prompt_build_pipeline.py from official task JSONL plus model workbook outputs.",
    generationPolicy: "No-op source-workbook baseline; sufficient to prove exporter/scorer-ingestion shape, not sufficient to claim a good model score.",
    upstreamPipeline: {
      ran: runFinchPipeline,
      exitCode: pipelineExitCode,
      contentPartsPath: normalizeEvidence(contentPartsPath),
      status: runFinchPipeline
        ? contentPartsCount === tasks.length ? "complete" : "partial"
        : "skipped",
      blocker: runFinchPipeline && contentPartsCount < tasks.length
        ? `Upstream Finch content_parts rendering is ${contentPartsCount}/${tasks.length}; official judge input remains partial.`
        : !runFinchPipeline
          ? "Upstream Finch content_parts rendering skipped by default because it is slow and not required to prove model-output artifact coverage."
          : undefined,
    },
    generatedBlankWorkbookCount,
    blockers: [...new Set(blockers)],
    evidence: [...new Set([
      "docs/eval/proofloop-official-task-bundles/finch.json",
      normalizeEvidence(modelOutputManifestPath),
      ...evidence,
    ])],
  };
}

function exportFinAuditing(): ProofloopOfficialOutputManifest {
  const adapterId = "finauditing" as const;
  const outputRoot = resolve(root, localRoot, adapterId);
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const py = spawnSync(
    python,
    ["-c", FIN_AUDITING_EXPORTER_PY, root, outputRoot, generatedAt],
    { cwd: root, env: { ...process.env, PYTHONIOENCODING: "utf-8" }, encoding: "utf8" },
  );

  const blockers: string[] = [];
  if (py.error) blockers.push(`FinAuditing parquet exporter could not start: ${py.error.message}`);
  if ((py.status ?? 1) !== 0) {
    blockers.push(`FinAuditing parquet exporter exited ${py.status ?? 1}: ${(py.stderr ?? "").trim()}`);
  }

  const stdout = (py.stdout ?? "").trim();
  let summary: {
    officialTaskCount: number;
    predictionRowCount: number;
    files: string[];
    datasets: Array<{ id: string; taskCount: number; predictionRows: number; path: string }>;
  } = { officialTaskCount: 0, predictionRowCount: 0, files: [], datasets: [] };
  if (stdout) {
    try {
      summary = JSON.parse(stdout) as typeof summary;
    } catch {
      blockers.push(`FinAuditing parquet exporter printed non-JSON stdout: ${stdout.slice(0, 200)}`);
    }
  }
  if (summary.officialTaskCount > 0 && summary.predictionRowCount < summary.officialTaskCount) {
    blockers.push(`FinAuditing prediction coverage is ${summary.predictionRowCount}/${summary.officialTaskCount}.`);
  }

  const complete = summary.officialTaskCount > 0 && summary.predictionRowCount === summary.officialTaskCount;
  return {
    schema: "proofloop-official-output-manifest-v1",
    adapterId,
    status: complete ? "complete" : blockers.length ? "partial" : "blocked",
    generatedAt,
    officialTaskCount: summary.officialTaskCount,
    predictionRowCount: summary.predictionRowCount,
    outputRoot: normalizeEvidence(outputRoot),
    officialFormat: "FinAuditing predictions.jsonl rows with prediction and ground_truth fields for FinSM, FinRE, and FinMR evaluator notebooks.",
    generationPolicy: "Deterministic low-information baseline predictions; sufficient to prove JSONL exporter shape, not an official model score claim.",
    datasets: summary.datasets.map((dataset) => ({
      ...dataset,
      path: normalizeEvidence(dataset.path),
    })),
    blockers: [...new Set(blockers)],
    evidence: [...new Set([
      "docs/eval/proofloop-official-task-bundles/finauditing.json",
      ...summary.files.map(normalizeEvidence),
    ])],
  };
}

async function writeBlankFinchWorkbook(path: string, task: FinchTask): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ProofLoop";
  workbook.created = new Date(generatedAt);
  const sheet = workbook.addWorksheet("Baseline");
  sheet.columns = [
    { header: "Field", key: "field", width: 28 },
    { header: "Value", key: "value", width: 120 },
  ];
  sheet.addRow({ field: "task_id", value: String(task.id) });
  sheet.addRow({
    field: "baseline_policy",
    value: "No-source Finch task; generated blank workbook baseline without using reference outputs. This is not an official score claim.",
  });
  sheet.addRow({
    field: "instruction_prefix",
    value: String((task as { instruction_en?: string }).instruction_en ?? "").slice(0, 500),
  });
  mkdirSync(dirname(path), { recursive: true });
  await workbook.xlsx.writeFile(path);
}

function updateOfficialScoreReceipt(adapterId: OutputAdapterId, manifest: ProofloopOfficialOutputManifest): void {
  const receiptPath = `docs/eval/proofloop-official-scores/${adapterId}.json`;
  const receipt = readJson<Record<string, unknown>>(receiptPath) ?? {};
  const blockers = Array.isArray(receipt.blockers) ? receipt.blockers.map(String) : [];
  const removeOutputBlocker = manifest.status === "complete";
  const filteredBlockers = removeOutputBlocker
    ? blockers.filter((blocker) => !isOutputBlocker(adapterId, blocker))
    : blockers;
  const contentPartsBlocker = adapterId === "finch" && (manifest.contentPartsCount ?? 0) < (manifest.officialTaskCount ?? 0)
    ? `Upstream Finch content_parts rendering is ${manifest.contentPartsCount ?? 0}/${manifest.officialTaskCount ?? 0}; official Azure judge input remains incomplete even though model-output artifacts are complete.`
    : undefined;
  const attempted = Array.isArray(receipt.attempted) ? receipt.attempted.map(String) : [];
  const preservedAttempted = attempted.filter((item) => !item.startsWith(`Generated ${adapterId} official-format output manifest`));
  const evidence = Array.isArray(receipt.evidence) ? receipt.evidence.map(String) : [];

  writeJson(receiptPath, {
    ...receipt,
    status: receipt.status ?? "blocked_external",
    generatedAt,
    attempted: [
      ...new Set([
        ...preservedAttempted,
        `Generated ${adapterId} official-format output manifest with ${manifest.officialTaskCount ?? 0} expected task rows and ${manifest.outputTaskCount ?? manifest.predictionRowCount ?? 0} exported rows.`,
      ]),
    ],
    blockers: [...new Set([
      ...filteredBlockers,
      ...(contentPartsBlocker ? [contentPartsBlocker] : []),
    ])],
    scoreClaim: false,
    officialOutputManifest: {
      path: officialOutputManifestPath(adapterId),
      status: manifest.status,
      officialTaskCount: manifest.officialTaskCount ?? 0,
      outputTaskCount: manifest.outputTaskCount ?? null,
      predictionRowCount: manifest.predictionRowCount ?? null,
      contentPartsCount: manifest.contentPartsCount ?? null,
    },
    evidence: [
      ...new Set([
        ...evidence,
        officialOutputManifestPath(adapterId),
        ...(manifest.evidence ?? []),
      ]),
    ],
  });
}

function isOutputBlocker(adapterId: OutputAdapterId, blocker: string): boolean {
  const text = blocker.toLowerCase();
  if (adapterId === "finch") {
    return text.includes("model-output directory") || text.includes("one output artifact per official finch task id");
  }
  return text.includes("prediction jsonl") || text.includes("finsm, finre, or finmr");
}

function producedSummary(manifest: ProofloopOfficialOutputManifest): string {
  if (manifest.adapterId === "finch") {
    return `outputs=${manifest.outputTaskCount ?? 0}/${manifest.officialTaskCount ?? 0}, content_parts=${manifest.contentPartsCount ?? 0}/${manifest.officialTaskCount ?? 0}`;
  }
  return `predictions=${manifest.predictionRowCount ?? 0}/${manifest.officialTaskCount ?? 0}`;
}

function readJsonl<T>(path: string): T[] {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

function countNonEmptyLines(path: string): number {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .length;
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeEvidence(path: string): string {
  const normalizedRoot = resolve(root).replace(/\\/g, "/").replace(/\/$/, "");
  const normalizedPath = resolve(path).replace(/\\/g, "/");
  return normalizedPath.startsWith(`${normalizedRoot}/`)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : normalizedPath;
}

function optionValue(name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function optionValues(name: string): string[] {
  const values: string[] = [];
  const inlinePrefix = `${name}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith(inlinePrefix)) values.push(arg.slice(inlinePrefix.length));
    else if (arg === name) {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        i++;
      }
    }
  }
  return values;
}
