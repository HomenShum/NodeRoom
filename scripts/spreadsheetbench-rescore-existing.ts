import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { SpreadsheetBenchRunnerReport, SpreadsheetBenchRunnerTaskResult } from "../src/eval/spreadsheetBenchRunner";
import { scoreSpreadsheetBenchWorkbook } from "../src/eval/spreadsheetBenchScorer";

type EvaluatorManifest = {
  answerPosition?: string;
  answerSheet?: string;
  goldFiles: string[];
};

const args = process.argv.slice(2);
const stageRoot = requiredOption("--stage-root");
const outputRoot = requiredOption("--output-root");
const runReport = requiredOption("--run-report");
const jsonOut = requiredOption("--json-out");
const taskIdsFile = requiredOption("--task-ids-file");
const maxMismatches = numberOption("--max-mismatches") ?? 20;
const generatedAt = new Date().toISOString();
const stage = resolve(stageRoot);
const output = resolve(outputRoot);
const report = readJson<SpreadsheetBenchRunnerReport>(resolve(runReport));
const taskIds = new Set(readTaskIds(taskIdsFile));
const rescoredTaskIds: string[] = [];
const results: SpreadsheetBenchRunnerTaskResult[] = [];

for (const result of report.results) {
  if (!taskIds.has(result.taskId)) {
    results.push(result);
    continue;
  }
  if (!result.candidateWorkbook) throw new Error(`${result.taskId} has no candidate workbook to rescore`);
  const candidateWorkbook = resolve(output, result.candidateWorkbook);
  const evaluatorPath = resolve(stage, result.evaluatorManifest);
  const evaluator = readJson<EvaluatorManifest>(evaluatorPath);
  const goldFile = evaluator.goldFiles[0];
  if (!goldFile) throw new Error(`${result.taskId} evaluator has no gold workbook`);
  const goldWorkbook = resolve(dirname(evaluatorPath), goldFile);
  if (!existsSync(candidateWorkbook)) throw new Error(`${result.taskId} candidate workbook is missing: ${candidateWorkbook}`);
  if (!existsSync(goldWorkbook)) throw new Error(`${result.taskId} gold workbook is missing: ${goldWorkbook}`);

  const scoreStarted = Date.now();
  const score = await scoreSpreadsheetBenchWorkbook({
    taskId: result.taskId,
    candidateWorkbookPath: candidateWorkbook,
    goldWorkbookPath: goldWorkbook,
    answerPosition: evaluator.answerPosition,
    answerSheet: evaluator.answerSheet,
    compareCharts: result.track === "spreadsheetbench-v2",
    maxMismatches,
    generatedAt,
  });
  const scorerReceiptPath = resolve(output, result.taskId, "score-receipt.json");
  mkdirSync(dirname(scorerReceiptPath), { recursive: true });
  writeJson(scorerReceiptPath, {
    schema: 1,
    verifier: "spreadsheetbench_workbook_scorer",
    generatedAt,
    taskId: result.taskId,
    track: result.track,
    mode: result.mode,
    attemptIndex: result.attemptIndex,
    repeatIndex: result.repeatIndex,
    tryIndex: result.tryIndex,
    candidateWorkbook: result.candidateWorkbook,
    agentManifest: result.agentManifest,
    evaluatorManifest: result.evaluatorManifest,
    score,
    rescore: {
      sourceRunReport: rel(resolve(runReport)),
      policy: "reuse hash-linked model candidate; rerun repaired scorer only",
    },
  });
  const { error: _error, ...withoutError } = result;
  const scoringMs = Date.now() - scoreStarted;
  results.push({
    ...withoutError,
    score,
    scorerReceipt: fileEvidence(output, scorerReceiptPath),
    timingsMs: { ...result.timingsMs, scoring: scoringMs, total: result.timingsMs.candidateGeneration + scoringMs },
    trajectory: [
      ...result.trajectory.filter((entry) => entry.step !== "score_candidate"),
      { step: "score_candidate", detail: `${score.totals.mismatches} cell mismatch(es); existing candidate rescored` },
    ],
  });
  rescoredTaskIds.push(result.taskId);
}

const passCount = results.filter((result) => result.score?.pass).length;
const scored = results.filter((result) => result.score);
const averageOverall = scored.length
  ? Number((scored.reduce((sum, result) => sum + (result.score?.scores.overall ?? 0), 0) / scored.length).toFixed(6))
  : 0;
const caseRuns = report.caseRuns.map((caseRun) => {
  const final = [...results].reverse().find((result) => result.taskId === caseRun.taskId && result.repeatIndex === caseRun.repeatIndex);
  return final ? { ...caseRun, pass: final.score?.pass === true, bestOverall: final.score?.scores.overall ?? 0 } : caseRun;
});
const failureCounts: Record<string, number> = {};
for (const result of results) {
  if (!result.error) continue;
  const key = `${result.error.phase}:${result.error.message}`;
  failureCounts[key] = (failureCounts[key] ?? 0) + 1;
}
const nextReport = {
  ...report,
  generatedAt,
  passCount,
  averageOverall,
  passRate: results.length ? Number((passCount / results.length).toFixed(6)) : 0,
  casePassCount: caseRuns.filter((caseRun) => caseRun.pass).length,
  casePassRate: caseRuns.length ? Number((caseRuns.filter((caseRun) => caseRun.pass).length / caseRuns.length).toFixed(6)) : 0,
  stats: { ...report.stats, failureCounts },
  warnings: report.warnings.filter((warning) => !rescoredTaskIds.some((taskId) => warning.startsWith(`${taskId}:`) || warning.includes(`tasks/${taskId}`))),
  caseRuns,
  results,
  rescore: {
    schema: 1,
    generatedAt,
    sourceRunReport: rel(resolve(runReport)),
    taskIds: rescoredTaskIds,
    modelCalls: 0,
    policy: "scorer-only replay over existing model-generated candidates",
  },
};

writeJson(resolve(jsonOut), nextReport);
console.log(`SpreadsheetBench existing-candidate rescore: ${rescoredTaskIds.length} task(s), ${passCount}/${results.length} pass`);
console.log(`wrote ${rel(resolve(jsonOut))}`);

function fileEvidence(root: string, path: string) {
  const bytes = statSync(path).size;
  return {
    path: relative(root, path).replace(/\\/g, "/"),
    sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    bytes,
  };
}

function readTaskIds(path: string): string[] {
  const value = readJson<unknown>(resolve(path));
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${path} must contain a JSON array of task ids`);
  }
  return [...new Set(value.map((item) => String(item).trim()))];
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function requiredOption(name: string): string {
  const value = optionValue(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function optionValue(name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function numberOption(name: string): number | undefined {
  const value = optionValue(name);
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} must be a non-negative number`);
  return Math.trunc(parsed);
}

function rel(path: string): string {
  return relative(process.cwd(), path).replace(/\\/g, "/");
}
