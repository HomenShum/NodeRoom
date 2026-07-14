import "./benchmark/loadEnv";

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import type {
  SpreadsheetBenchRunnerCaseRun,
  SpreadsheetBenchRunnerMode,
  SpreadsheetBenchRunnerReport,
  SpreadsheetBenchRunnerTaskResult,
} from "../src/eval/spreadsheetBenchRunner";
import type { SpreadsheetBenchTrack } from "../src/eval/spreadsheetBenchAdapter";
import { getModelPricing } from "../src/nodeagent/models/modelCatalog";

const args = process.argv.slice(2);
const stageRoot = optionValue("--stage-root");
const outputRoot = optionValue("--output-root");
const jsonOut = optionValue("--json-out");
const mode = (optionValue("--mode") ?? "copy-input-baseline") as SpreadsheetBenchRunnerMode;
const chunkSize = numberOption("--chunk-size") ?? 25;
const concurrency = numberOption("--concurrency") ?? 1;
const repeats = numberOption("--repeats") ?? 1;
const retryFailed = numberOption("--retry-failed") ?? 0;
const maxMismatches = numberOption("--max-mismatches") ?? 5;
const model = optionValue("--model");
const freeAutoMode = optionValue("--free-auto-mode");
const modelTimeoutMs = numberOption("--model-timeout-ms");
const modelBatchSize = numberOption("--model-batch-size") ?? 1;
const modelSnapshotMaxCells = numberOption("--model-snapshot-max-cells");
const modelSnapshotMaxCellChars = numberOption("--model-snapshot-max-cell-chars");
const modelRepairAttempts = numberOption("--model-repair-attempts") ?? (mode === "model-edit-plan" ? 1 : 0);
const taskIdsFile = optionValue("--task-ids-file");
const taskIds = taskIdsFile ? readTaskIds(taskIdsFile) : undefined;
const compareStyles = args.includes("--compare-styles");
const compareCharts = args.includes("--compare-charts");
const retryScoreFailures = args.includes("--retry-score-failures");
const clean = args.includes("--clean");
const resume = args.includes("--resume");
const repairMissingModelReceipts = args.includes("--repair-missing-model-receipts");
const allowProviderSpend = args.includes("--allow-provider-spend");
const maxProviderCostUsd = decimalOption("--max-provider-cost-usd");
const providerCallReserveUsd = decimalOption("--provider-call-reserve-usd") ?? 0.05;

if (!stageRoot || !outputRoot || !jsonOut || chunkSize <= 0 || concurrency <= 0 || concurrency > 16) {
  console.error([
    "Usage:",
    "  npm run benchmark:spreadsheetbench:run-chunked -- --stage-root <staged-dir> --output-root <candidate-output-dir> --json-out <report.json> [--mode copy-input-baseline|apply-agent-patch|model-edit-plan] [--chunk-size 25] [--concurrency 1..16] [--resume] [--repair-missing-model-receipts] [--model <route>] [--free-auto-mode chat|agent|structured|vision|coding] [--model-batch-size 1] [--model-snapshot-max-cells 800] [--model-snapshot-max-cell-chars 256] [--model-repair-attempts 1] [--task-ids-file <ids.json>] [--allow-provider-spend --max-provider-cost-usd 1 --provider-call-reserve-usd 0.05] [--clean]",
    "",
    "Runs staged SpreadsheetBench tasks in fresh child processes and aggregates the reports.",
  ].join("\n"));
  process.exit(2);
}
if (mode === "model-edit-plan" && !model) {
  console.error("model-edit-plan requires --model <route>.");
  process.exit(2);
}
if (resume && clean) {
  console.error("--resume and --clean cannot be used together.");
  process.exit(2);
}
if (repairMissingModelReceipts && (!resume || mode !== "model-edit-plan")) {
  console.error("--repair-missing-model-receipts requires --resume and --mode model-edit-plan.");
  process.exit(2);
}
if (modelBatchSize < 1 || modelBatchSize > 16) throw new Error("--model-batch-size must be between 1 and 16.");
if (modelSnapshotMaxCells !== undefined && modelSnapshotMaxCells < 1) throw new Error("--model-snapshot-max-cells must be at least 1.");
if (modelSnapshotMaxCellChars !== undefined && modelSnapshotMaxCellChars < 1) throw new Error("--model-snapshot-max-cell-chars must be at least 1.");
if (modelRepairAttempts < 0 || modelRepairAttempts > 3) throw new Error("--model-repair-attempts must be between 0 and 3.");
if (providerCallReserveUsd <= 0) throw new Error("--provider-call-reserve-usd must be positive.");
if (maxProviderCostUsd !== undefined && maxProviderCostUsd <= 0) throw new Error("--max-provider-cost-usd must be positive.");
if (allowProviderSpend && maxProviderCostUsd === undefined) throw new Error("--allow-provider-spend requires --max-provider-cost-usd.");

const stage = resolve(stageRoot);
const output = resolve(outputRoot);
const outPath = resolve(jsonOut);
if (!existsSync(stage)) throw new Error(`stage root does not exist: ${stageRoot}`);
if (clean && existsSync(output)) rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
mkdirSync(dirname(outPath), { recursive: true });
const chunkRoot = resolve(output, ".chunks");
if (!resume) rmSync(chunkRoot, { recursive: true, force: true });
mkdirSync(chunkRoot, { recursive: true });
const stagedTasks = listStagedTasks();
const taskCount = stagedTasks.length;
const repairArchive = repairMissingModelReceipts ? collectRepairArchive() : undefined;
const modelPricing = model ? getModelPricing(model) : undefined;
const pricedModel = Boolean(modelPricing && (modelPricing.inputPer1M > 0 || modelPricing.outputPer1M > 0));
let providerCostSpentUsd = 0;
let providerCostReservedUsd = 0;

const chunkReports: SpreadsheetBenchRunnerReport[] = [];
const chunks: Array<{ index: number; offset: number; limit: number; reportPath: string; taskCount: number; passCount: number; exitCode: number | null }> = [];
const jobs: Array<{ index: number; offset: number; limit: number }> = [];
for (let offset = 0, index = 1; offset < taskCount; offset += chunkSize, index += 1) {
  const limit = Math.min(chunkSize, taskCount - offset);
  jobs.push({ index, offset, limit });
}
const reportGroups = await mapWithConcurrency(jobs, concurrency, ({ index, offset, limit }) => runChunk(index, offset, limit));
for (const reports of reportGroups) {
  chunkReports.push(...reports);
}
chunks.sort((a, b) => a.offset - b.offset || a.limit - b.limit || a.index - b.index);

const aggregate = aggregateChunkReports({
  generatedAt: new Date().toISOString(),
  stageRoot: basename(stage),
  outputRoot: basename(output),
  mode,
  chunkSize,
  chunks,
  reports: chunkReports,
});
writeFileSync(outPath, `${JSON.stringify(aggregate, null, 2)}\n`);
console.log(`wrote ${rel(outPath)}`);
console.log(`SpreadsheetBench chunked run: ${aggregate.passCount}/${aggregate.taskCount} pass, average=${aggregate.averageOverall}`);

async function runChunk(index: number, offset: number, limit: number): Promise<SpreadsheetBenchRunnerReport[]> {
  const reportPath = resolve(chunkRoot, `chunk-${String(index).padStart(3, "0")}-${offset}-${limit}.json`);
  const resumed = resume
    ? readRepairArchiveReport(offset, limit) ?? readReusableChunkReport(reportPath, offset, limit)
    : undefined;
  if (resumed) {
    chunks.push({
      index,
      offset,
      limit,
      reportPath: existsSync(reportPath) ? rel(reportPath) : "(hash-verified repair archive)",
      taskCount: resumed.taskCount,
      passCount: resumed.passCount,
      exitCode: 0,
    });
    console.log(`chunk ${index}: offset=${offset} limit=${limit} resumed pass=${resumed.passCount}/${resumed.taskCount}`);
    return [resumed];
  }
  if (repairMissingModelReceipts && existsSync(reportPath)) archiveChunkReport(reportPath);
  const childArgs = [
    resolve("node_modules", "tsx", "dist", "cli.mjs"),
    resolve("scripts", "spreadsheetbench-run.ts"),
    "--stage-root",
    stage,
    "--output-root",
    output,
    "--mode",
    mode,
    "--offset",
    String(offset),
    "--limit",
    String(limit),
    "--repeats",
    String(repeats),
    "--retry-failed",
    String(retryFailed),
    "--max-mismatches",
    String(maxMismatches),
    "--json-out",
    reportPath,
    ...(model ? ["--model", model] : []),
    ...(freeAutoMode ? ["--free-auto-mode", freeAutoMode] : []),
    ...(modelTimeoutMs !== undefined ? ["--model-timeout-ms", String(modelTimeoutMs)] : []),
    "--model-batch-size",
    String(modelBatchSize),
    ...(modelSnapshotMaxCells !== undefined ? ["--model-snapshot-max-cells", String(modelSnapshotMaxCells)] : []),
    ...(modelSnapshotMaxCellChars !== undefined ? ["--model-snapshot-max-cell-chars", String(modelSnapshotMaxCellChars)] : []),
    "--model-repair-attempts",
    String(modelRepairAttempts),
    ...(taskIdsFile ? ["--task-ids-file", resolve(taskIdsFile)] : []),
    ...(retryScoreFailures ? ["--retry-score-failures"] : []),
    ...(compareStyles ? ["--compare-styles"] : []),
    ...(compareCharts ? ["--compare-charts"] : []),
  ];
  const costReservation = reserveProviderCost();
  let child: Awaited<ReturnType<typeof runChild>>;
  try {
    child = await runChild(process.execPath, childArgs, 30 * 60_000);
  } finally {
    providerCostReservedUsd -= costReservation;
  }
  if (child.status !== 0) {
    process.stderr.write(child.stdout);
    process.stderr.write(child.stderr);
    if (limit > 1) {
      console.log(`chunk ${index}: offset=${offset} limit=${limit} failed; splitting into single-task chunks`);
      const reports: SpreadsheetBenchRunnerReport[] = [];
      for (let next = offset; next < offset + limit; next += 1) {
        reports.push(...await runChunk(index, next, 1));
      }
      return reports;
    }
    let synthetic = syntheticFailedReport(offset, child.status, child.error ?? (child.stderr || "child process failed"));
    if (repairMissingModelReceipts) synthetic = mergePreservedModelReceipts(synthetic, offset);
    writeFileSync(reportPath, `${JSON.stringify(synthetic, null, 2)}\n`);
    chunks.push({
      index,
      offset,
      limit,
      reportPath: rel(reportPath),
      taskCount: synthetic.taskCount,
      passCount: synthetic.passCount,
      exitCode: child.status,
    });
    console.log(`chunk ${index}: offset=${offset} limit=1 failed -> recorded synthetic error`);
    return [synthetic];
  }
  let report = JSON.parse(readFileSync(reportPath, "utf8")) as SpreadsheetBenchRunnerReport;
  providerCostSpentUsd = Number((providerCostSpentUsd + aggregateUsage(report.results).costUsd).toFixed(8));
  if (maxProviderCostUsd !== undefined && providerCostSpentUsd > maxProviderCostUsd) {
    throw new Error(`provider cost ceiling exceeded after completed call ($${providerCostSpentUsd.toFixed(6)}/$${maxProviderCostUsd.toFixed(6)})`);
  }
  if (repairMissingModelReceipts) {
    report = mergePreservedModelReceipts(report, offset);
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  chunks.push({
    index,
    offset,
    limit,
    reportPath: rel(reportPath),
    taskCount: report.taskCount,
    passCount: report.passCount,
    exitCode: child.status,
  });
  console.log(`chunk ${index}: offset=${offset} limit=${limit} pass=${report.passCount}/${report.taskCount}`);
  return [report];
}

function readReusableChunkReport(path: string, offset: number, limit: number): SpreadsheetBenchRunnerReport | undefined {
  if (!existsSync(path)) return undefined;
  try {
    let report = readJson<SpreadsheetBenchRunnerReport>(path);
    if (report.schema !== 1 || report.mode !== mode || report.taskOffset !== offset || (report.caseCount ?? report.taskCount) !== limit) return undefined;
    if (
      mode === "model-edit-plan" &&
      !repairMissingModelReceipts &&
      report.results.some((result) => result.model?.requestedName !== model && result.model?.name !== model)
    ) return undefined;
    if (repairMissingModelReceipts) {
      report = mergePreservedModelReceipts(report, offset);
      if (!hasModelReceiptForEveryCase(report, limit)) return undefined;
    }
    return report;
  } catch {
    return undefined;
  }
}

function hasModelReceiptForEveryCase(report: SpreadsheetBenchRunnerReport, expectedCases: number): boolean {
  const taskIds = new Set(report.results.filter(hasModelCandidateAndScorerAttemptReceipt).map((result) => result.taskId));
  return taskIds.size >= expectedCases;
}

function hasModelCandidateAndScorerAttemptReceipt(result: SpreadsheetBenchRunnerTaskResult): boolean {
  const sidecar = result.sidecarEvidence;
  return result.mode === "model-edit-plan" &&
    (result.model?.calls ?? 0) > 0 &&
    Boolean(result.taskId) &&
    validOutputFile(result.candidateWorkbook) &&
    validFileEvidence(sidecar?.candidateManifest) &&
    validFileEvidence(sidecar?.agentWorkspaceManifest) &&
    sidecar?.editPlan?.kind === "generated" &&
    validFileEvidence(sidecar.editPlan) &&
    validFileEvidence(sidecar.rawModelOutput) &&
    (validFileEvidence(result.scorerReceipt) || Boolean(result.score) || result.error?.phase === "scoring");
}

function validFileEvidence(receipt: { path?: string; sha256?: string; bytes?: number } | undefined): boolean {
  if (!receipt?.path || !receipt.sha256 || typeof receipt.bytes !== "number" || receipt.bytes <= 0) return false;
  const path = resolve(output, receipt.path);
  if (!existsSync(path)) return false;
  const content = readFileSync(path);
  return content.length === receipt.bytes && createHash("sha256").update(content).digest("hex") === receipt.sha256;
}

function validOutputFile(path: string | undefined): boolean {
  return Boolean(path && existsSync(resolve(output, path)));
}

function reserveProviderCost(): number {
  if (!pricedModel) return 0;
  if (!allowProviderSpend || maxProviderCostUsd === undefined) {
    throw new Error(`Refusing paid model route ${model} without --allow-provider-spend and --max-provider-cost-usd.`);
  }
  const reservation = providerCallReserveUsd * (1 + modelRepairAttempts);
  const projected = providerCostSpentUsd + providerCostReservedUsd + reservation;
  if (projected > maxProviderCostUsd) {
    throw new Error(`provider cost reservation would exceed ceiling ($${projected.toFixed(6)}/$${maxProviderCostUsd.toFixed(6)})`);
  }
  providerCostReservedUsd += reservation;
  return reservation;
}

function collectRepairArchive(): {
  results: Map<string, SpreadsheetBenchRunnerTaskResult>;
  caseRuns: Map<string, SpreadsheetBenchRunnerCaseRun>;
} {
  const results = new Map<string, SpreadsheetBenchRunnerTaskResult>();
  const caseRuns = new Map<string, SpreadsheetBenchRunnerCaseRun>();
  const historyRoot = resolve(chunkRoot, "history");
  const paths = [
    ...readdirSync(chunkRoot).filter((name) => /^chunk-.*\.json$/.test(name)).map((name) => resolve(chunkRoot, name)),
    ...(existsSync(historyRoot)
      ? readdirSync(historyRoot).filter((name) => name.endsWith(".json")).map((name) => resolve(historyRoot, name))
      : []),
  ];
  for (const path of paths) {
    try {
      const report = readJson<SpreadsheetBenchRunnerReport>(path);
      const runs = new Map(report.caseRuns.map((run) => [run.taskId, run]));
      for (const result of report.results) {
        if (!result.taskId || results.has(result.taskId) || !hasModelCandidateAndScorerAttemptReceipt(result)) continue;
        results.set(result.taskId, result);
        const run = runs.get(result.taskId);
        if (run) caseRuns.set(result.taskId, run);
      }
    } catch {
      // A partial child write is not eligible repair evidence.
    }
  }
  console.log(`repair archive: ${results.size} valid task receipt(s)`);
  return { results, caseRuns };
}

function readRepairArchiveReport(offset: number, limit: number): SpreadsheetBenchRunnerReport | undefined {
  if (!repairArchive) return undefined;
  const results: SpreadsheetBenchRunnerTaskResult[] = [];
  const caseRuns: SpreadsheetBenchRunnerCaseRun[] = [];
  for (let next = offset; next < offset + limit; next += 1) {
    const task = stagedTaskAtOffset(next);
    const agent = readJson<{ taskId?: string }>(task.agentManifestPath);
    const taskId = agent.taskId ?? basename(task.taskDir);
    const result = repairArchive.results.get(taskId);
    if (!result) return undefined;
    results.push(result);
    caseRuns.push(repairArchive.caseRuns.get(taskId) ?? caseRunFor(result));
  }
  const template = syntheticFailedReport(offset, 0, "repair archive reconstruction template");
  template.warnings = [`repair reconstructed ${results.length} task receipt(s) from hash-verified chunk history`];
  return summarizeRepairedReport(template, results, caseRuns, results.length);
}

function mergePreservedModelReceipts(report: SpreadsheetBenchRunnerReport, offset: number): SpreadsheetBenchRunnerReport {
  if (!repairArchive) return report;
  const freshRuns = new Map(report.caseRuns.map((run) => [run.taskId, run]));
  let preserved = 0;
  const results = report.results.map((fresh) => {
    if (hasModelCandidateAndScorerAttemptReceipt(fresh)) {
      repairArchive.results.set(fresh.taskId, fresh);
      const run = freshRuns.get(fresh.taskId);
      if (run) repairArchive.caseRuns.set(fresh.taskId, run);
      return fresh;
    }
    const previous = repairArchive.results.get(fresh.taskId);
    if (!previous || !hasModelCandidateAndScorerAttemptReceipt(previous)) return fresh;
    preserved += 1;
    return previous;
  });
  const caseRuns = results.map((result) =>
    freshRuns.get(result.taskId) && result === report.results.find((candidate) => candidate.taskId === result.taskId)
      ? freshRuns.get(result.taskId)!
      : repairArchive.caseRuns.get(result.taskId) ?? caseRunFor(result));
  if (preserved > 0) console.log(`chunk repair: offset=${offset} preserved=${preserved} prior valid receipt(s)`);
  return summarizeRepairedReport(report, results, caseRuns, preserved);
}

function summarizeRepairedReport(
  report: SpreadsheetBenchRunnerReport,
  results: SpreadsheetBenchRunnerTaskResult[],
  caseRuns: SpreadsheetBenchRunnerCaseRun[],
  preserved: number,
): SpreadsheetBenchRunnerReport {
  const passCount = results.filter((result) => result.score?.pass).length;
  const casePassCount = caseRuns.filter((run) => run.pass).length;
  const usage = aggregateUsage(results);
  const retried = caseRuns.filter((run) => run.attempts.length > 1);
  return {
    ...report,
    taskCount: results.length,
    passCount,
    averageOverall: results.length
      ? Number((results.reduce((sum, result) => sum + (result.score?.scores.overall ?? 0), 0) / results.length).toFixed(6))
      : 0,
    caseCount: results.length,
    caseRunCount: caseRuns.length,
    casePassCount,
    casePassRate: caseRuns.length ? Number((casePassCount / caseRuns.length).toFixed(6)) : 0,
    attemptCount: results.length,
    passRate: results.length ? Number((passCount / results.length).toFixed(6)) : 0,
    retryStats: {
      retriedCaseRunCount: retried.length,
      retryAttemptCount: retried.reduce((sum, run) => sum + Math.max(0, run.attempts.length - 1), 0),
      passedAfterRetryCount: retried.filter((run) => run.pass).length,
      exhaustedCaseRunCount: caseRuns.filter((run) => run.stopReason === "retry_exhausted").length,
    },
    stats: aggregateStats(results),
    harness: {
      ...report.harness,
      budget: {
        modelCalls: usage.calls,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        providerCostUsd: usage.costUsd,
      },
    },
    warnings: preserved > 0
      ? [...new Set([...report.warnings, `repair preserved ${preserved} prior valid model receipt(s)`])]
      : report.warnings,
    caseRuns,
    results,
  };
}

function caseRunFor(result: SpreadsheetBenchRunnerTaskResult): SpreadsheetBenchRunnerCaseRun {
  return {
    taskId: result.taskId,
    taskDir: result.taskDir,
    repeatIndex: result.repeatIndex,
    attempts: [result.attemptIndex],
    finalAttemptIndex: result.attemptIndex,
    pass: result.score?.pass === true,
    stopReason: result.score?.pass ? "passed" : result.error ? "runner_error" : "failed_score",
    bestOverall: result.score?.scores.overall ?? 0,
  };
}

function archiveChunkReport(path: string) {
  const content = readFileSync(path);
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
  const historyRoot = resolve(chunkRoot, "history");
  const historyPath = resolve(historyRoot, `${basename(path, ".json")}-${hash}.json`);
  if (existsSync(historyPath)) return;
  mkdirSync(historyRoot, { recursive: true });
  writeFileSync(historyPath, content);
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

function runChild(command: string, childArgs: string[], timeoutMs: number): Promise<{ status: number | null; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolveRun) => {
    const child = spawn(command, childArgs, { cwd: process.cwd(), env: process.env, shell: false, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolveRun({ status: null, stdout, stderr, error: error.message });
    });
    child.once("close", (status) => {
      clearTimeout(timer);
      resolveRun({ status, stdout, stderr, ...(timedOut ? { error: `child timed out after ${timeoutMs}ms` } : {}) });
    });
  });
}

function aggregateChunkReports(args: {
  generatedAt: string;
  stageRoot: string;
  outputRoot: string;
  mode: SpreadsheetBenchRunnerMode;
  chunkSize: number;
  chunks: Array<{ index: number; offset: number; limit: number; reportPath: string; taskCount: number; passCount: number; exitCode: number | null }>;
  reports: SpreadsheetBenchRunnerReport[];
}) {
  const results = args.reports.flatMap((report) => report.results);
  const caseRuns = args.reports.flatMap((report) => report.caseRuns);
  const passCount = results.filter((result) => result.score?.pass).length;
  const casePassCount = caseRuns.filter((run) => run.pass).length;
  const usage = aggregateUsage(results);
  const stats = aggregateStats(results);
  const retryStats = {
    retriedCaseRunCount: args.reports.reduce((sum, report) => sum + report.retryStats.retriedCaseRunCount, 0),
    retryAttemptCount: args.reports.reduce((sum, report) => sum + report.retryStats.retryAttemptCount, 0),
    passedAfterRetryCount: args.reports.reduce((sum, report) => sum + report.retryStats.passedAfterRetryCount, 0),
    exhaustedCaseRunCount: args.reports.reduce((sum, report) => sum + report.retryStats.exhaustedCaseRunCount, 0),
  };
  const averageOverall = results.length
    ? Number((results.reduce((sum, result) => sum + (result.score?.scores.overall ?? 0), 0) / results.length).toFixed(6))
    : 0;
  return {
    schema: 1,
    generatedAt: args.generatedAt,
    stageRoot: args.stageRoot,
    outputRoot: args.outputRoot,
    mode: args.mode,
    chunked: true,
    chunkSize: args.chunkSize,
    chunks: args.chunks,
    taskCount: results.length,
    passCount,
    averageOverall,
    caseCount: args.reports.reduce((sum, report) => sum + report.caseCount, 0),
    caseRunCount: caseRuns.length,
    casePassCount,
    casePassRate: caseRuns.length ? Number((casePassCount / caseRuns.length).toFixed(6)) : 0,
    repeatCount: args.reports[0]?.repeatCount ?? 1,
    attemptCount: results.length,
    passRate: results.length ? Number((passCount / results.length).toFixed(6)) : 0,
    retryPolicy: args.reports[0]?.retryPolicy,
    retryStats,
    stats,
    harness: {
      toolPolicy: "agent_dir_only_until_candidate",
      evaluatorAccess: "after_candidate_emit_only",
      ...(args.reports[0]?.harness.modelContextPolicy
        ? { modelContextPolicy: args.reports[0].harness.modelContextPolicy }
        : {}),
      budget: {
        modelCalls: usage.calls,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        providerCostUsd: usage.costUsd,
      },
    },
    warnings: args.reports.flatMap((report) => report.warnings),
    caseRuns,
    results,
  };
}

function aggregateUsage(results: SpreadsheetBenchRunnerTaskResult[]) {
  return {
    calls: results.reduce((sum, result) => sum + (result.model?.calls ?? 0), 0),
    inputTokens: results.reduce((sum, result) => sum + (result.model?.usage.inputTokens ?? 0), 0),
    outputTokens: results.reduce((sum, result) => sum + (result.model?.usage.outputTokens ?? 0), 0),
    costUsd: Number(results.reduce((sum, result) => sum + (result.model?.costUsd ?? 0), 0).toFixed(8)),
  };
}

function aggregateStats(results: SpreadsheetBenchRunnerTaskResult[]) {
  const latencies = results.map((result) => result.timingsMs.total).sort((a, b) => a - b);
  const failureCounts: Record<string, number> = {};
  for (const result of results) {
    if (!result.error) continue;
    failureCounts[result.error.phase] = (failureCounts[result.error.phase] ?? 0) + 1;
  }
  return {
    latencyMs: {
      p50: percentile(latencies, 0.5),
      p95: percentile(latencies, 0.95),
      max: latencies.at(-1) ?? 0,
    },
    failureCounts,
  };
}

function syntheticFailedReport(offset: number, exitCode: number | null, rawMessage: string): SpreadsheetBenchRunnerReport {
  const task = stagedTaskAtOffset(offset);
  const agent = readJson<{
    taskId?: string;
    track?: SpreadsheetBenchTrack;
    category?: string;
  }>(task.agentManifestPath);
  const message = previewFailure(rawMessage);
  const result: SpreadsheetBenchRunnerTaskResult = {
    taskId: agent.taskId ?? basename(task.taskDir),
    track: agent.track ?? "spreadsheetbench-v1",
    category: agent.category,
    mode,
    attemptIndex: offset,
    repeatIndex: 0,
    tryIndex: 0,
    taskDir: relTo(stage, task.taskDir),
    agentManifest: relTo(stage, task.agentManifestPath),
    evaluatorManifest: relTo(stage, task.evaluatorManifestPath),
    error: {
      phase: "candidate_generation",
      message: `child process exited ${exitCode ?? "without status"}: ${message}`,
    },
    timingsMs: {
      candidateGeneration: 0,
      scoring: 0,
      total: 0,
    },
    trajectory: [
      { step: "read_agent_manifest", detail: relTo(stage, task.agentManifestPath) },
      { step: "prepare_agent_workspace", detail: "not reached; child process failed before report emission" },
    ],
  };
  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    stageRoot: basename(stage),
    outputRoot: basename(output),
    mode,
    taskOffset: offset,
    taskCount: 1,
    passCount: 0,
    averageOverall: 0,
    caseCount: 1,
    caseRunCount: 1,
    casePassCount: 0,
    casePassRate: 0,
    repeatCount: 1,
    attemptCount: 1,
    passRate: 0,
    retryPolicy: {
      maxRetries: retryFailed,
      retryOn: ["candidate_generation", "scoring", ...(retryScoreFailures ? ["score_failure" as const] : [])],
      stopOnPass: true,
    },
    retryStats: {
      retriedCaseRunCount: 0,
      retryAttemptCount: 0,
      passedAfterRetryCount: 0,
      exhaustedCaseRunCount: 0,
    },
    stats: {
      latencyMs: { p50: 0, p95: 0, max: 0 },
      failureCounts: { candidate_generation: 1 },
    },
    harness: {
      toolPolicy: "agent_dir_only_until_candidate",
      evaluatorAccess: "after_candidate_emit_only",
      budget: {
        modelCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        providerCostUsd: 0,
      },
    },
    warnings: [
      `chunked runner recorded a synthetic failure for offset ${offset} (${result.taskId}) after a child process failed before writing a report`,
    ],
    caseRuns: [
      {
        taskId: result.taskId,
        taskDir: result.taskDir,
        repeatIndex: 0,
        attempts: [result.attemptIndex],
        finalAttemptIndex: result.attemptIndex,
        pass: false,
        stopReason: "runner_error",
        bestOverall: 0,
      },
    ],
    results: [result],
  };
}

function stagedTaskAtOffset(offset: number): { taskDir: string; agentManifestPath: string; evaluatorManifestPath: string } {
  const task = stagedTasks[offset];
  if (!task) throw new Error(`no staged SpreadsheetBench task at offset ${offset}; task count is ${stagedTasks.length}`);
  return task;
}

function listStagedTasks(): Array<{ taskDir: string; agentManifestPath: string; evaluatorManifestPath: string }> {
  const requestedTaskIds = taskIds ? new Set(taskIds) : undefined;
  const tasks = walkDirs(resolve(stage, "tasks"))
    .map((taskDir) => ({
      taskDir,
      agentManifestPath: resolve(taskDir, "agent", "task.json"),
      evaluatorManifestPath: resolve(taskDir, "evaluator", "evaluator.json"),
    }))
    .filter((task) => existsSync(task.agentManifestPath) && existsSync(task.evaluatorManifestPath))
    .filter((task) => !requestedTaskIds || requestedTaskIds.has(readJson<{ taskId?: string }>(task.agentManifestPath).taskId ?? ""))
    .sort((a, b) => a.taskDir.localeCompare(b.taskDir));
  if (requestedTaskIds && tasks.length !== requestedTaskIds.size) {
    const selectedIds = new Set(tasks.map((task) => readJson<{ taskId?: string }>(task.agentManifestPath).taskId));
    const missing = [...requestedTaskIds].filter((taskId) => !selectedIds.has(taskId));
    throw new Error(`SpreadsheetBench task ID selection contains ${missing.length} unknown task(s): ${missing.slice(0, 10).join(", ")}`);
  }
  return tasks;
}

function previewFailure(message: string): string {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length > 1200 ? `${normalized.slice(0, 1200)}...` : normalized || "child process failed before emitting stderr";
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * p) - 1));
  return values[index];
}

function walkDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (!entry.isDirectory()) continue;
    out.push(path, ...walkDirs(path));
  }
  return out;
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

function decimalOption(name: string): number | undefined {
  const raw = optionValue(name);
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
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
  return relative(process.cwd(), resolve(path)).replace(/\\/g, "/");
}

function relTo(base: string, path: string): string {
  return relative(resolve(base), resolve(path)).replace(/\\/g, "/");
}
