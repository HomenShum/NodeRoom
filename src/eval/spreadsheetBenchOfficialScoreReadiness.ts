import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import type { SpreadsheetBenchTrack } from "./spreadsheetBenchAdapter";
import type { SpreadsheetBenchRunnerMode } from "./spreadsheetBenchRunner";

export type SpreadsheetBenchOfficialScoreStatus =
  | "official_score_ready"
  | "proxy_receipts_complete"
  | "proxy_outputs_complete"
  | "blocked";

export type SpreadsheetBenchOfficialScoreReadinessOptions = {
  track: SpreadsheetBenchTrack;
  expectedTaskCount?: number;
  stageReportPath?: string;
  runReportPaths?: string[];
  routeSelectionPath?: string;
  outputReceiptReportPath?: string;
  officialScorerReceiptPath?: string;
  receiptRoots?: string[];
  generatedAt?: string;
};

export type SpreadsheetBenchOfficialScoreReadiness = {
  schema: 1;
  generatedAt?: string;
  track: SpreadsheetBenchTrack;
  expectedTaskCount: number;
  status: SpreadsheetBenchOfficialScoreStatus;
  officialScoreClaim: {
    allowed: boolean;
    policy: "accepted_official_scorer_receipt_required";
    blocker?: string;
    score?: {
      averageOverall: number;
      passRate: number;
      passCount: number;
      scoredTaskCount: number;
      source: "accepted_official_scorer_receipt";
    };
  };
  officialModelRunClaim: {
    allowed: boolean;
    policy: "full_model_generated_run_required_for_official_promotion";
    requiredTaskCount: number;
    validTaskCount: number;
    missingTaskCount: number;
    nextMissingOffset?: number;
    nextMissingTaskIds: string[];
    resumeHint?: string;
    blocker?: string;
  };
  localProxyReceiptClaim: {
    allowed: boolean;
    policy: "local_workbook_scorer_receipts_are_proxy_not_official";
    score?: {
      averageOverall: number;
      passRate: number;
      passCount: number;
      scoredTaskCount: number;
      source: "validated_scorer_receipts";
    };
  };
  localProxyOutputClaim: {
    allowed: boolean;
    policy: "candidate_output_receipts_are_proxy_not_official_scores";
    receiptCount: number;
  };
  artifacts: {
    stageReport: SpreadsheetBenchOfficialArtifact;
    runReports: SpreadsheetBenchOfficialArtifact[];
    routeSelection?: SpreadsheetBenchOfficialArtifact;
    outputReceiptReport?: SpreadsheetBenchOfficialArtifact;
    officialScorerReceipt: SpreadsheetBenchOfficialArtifact;
  };
  coverage: {
    stagedTaskCount: number;
    runTaskCount: number;
    uniqueRunTaskCount: number;
    requiredScorerReceiptCount: number;
    validScorerReceiptCount: number;
    missingScorerReceiptCount: number;
    invalidScorerReceiptCount: number;
    validOutputReceiptCount: number;
    missingOutputReceiptCount: number;
    invalidOutputReceiptCount: number;
  };
  checkpoint: {
    status: "complete" | "incomplete";
    nextMissingOffset?: number;
    nextMissingTaskIds: string[];
    remainingTaskCount: number;
    resumeHint?: string;
  };
  shards: SpreadsheetBenchOfficialShardStatus[];
  routeCostLedger: {
    policy: "free_local_proxy_only";
    modelCalls: number;
    inputTokens: number;
    outputTokens: number;
    providerCostUsd: number;
    paidProviderCostUsd: number;
    routes: Array<{
      route: string;
      taskCount: number;
      modelCalls: number;
      providerCostUsd: number;
    }>;
  };
  blockers: string[];
  warnings: string[];
};

export type SpreadsheetBenchOfficialArtifact = {
  path?: string;
  status: "present" | "missing" | "invalid";
  bytes?: number;
  sha256?: string;
  reason?: string;
};

export type SpreadsheetBenchOfficialShardStatus = {
  id: string;
  path: string;
  status: "complete" | "partial" | "failed" | "missing" | "invalid";
  offset?: number;
  limit?: number;
  taskCount: number;
  scoredTaskCount: number;
  validScorerReceiptCount: number;
  providerCostUsd: number;
  exitCode?: number | null;
  reason?: string;
};

type StageReport = {
  schema?: number;
  stagedTaskCount?: number;
  tasks?: Array<{
    id?: string;
  }>;
};

type RunReport = {
  schema?: number;
  mode?: SpreadsheetBenchRunnerMode;
  outputRoot?: string;
  taskCount?: number;
  passCount?: number;
  averageOverall?: number;
  passRate?: number;
  chunked?: boolean;
  chunks?: Array<{
    index?: number;
    offset?: number;
    limit?: number;
    reportPath?: string;
    taskCount?: number;
    passCount?: number;
    exitCode?: number | null;
  }>;
  harness?: {
    budget?: {
      modelCalls?: number;
      inputTokens?: number;
      outputTokens?: number;
      providerCostUsd?: number;
    };
  };
  results?: RunResult[];
};

type RunResult = {
  taskId?: string;
  mode?: SpreadsheetBenchRunnerMode;
  attemptIndex?: number;
  score?: {
    pass?: boolean;
    scores?: {
      overall?: number;
    };
  };
  error?: {
    message?: string;
  };
  model?: {
    name?: string;
    calls?: number;
    costUsd?: number;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
    };
  };
  scorerReceipt?: SidecarFileEvidence;
};

type OutputReceiptReport = {
  schema?: number;
  track?: SpreadsheetBenchTrack;
  outputRoot?: string;
  taskCount?: number;
  routeCostLedger?: {
    providerCostUsd?: number;
  };
  receipts?: OutputReceiptResult[];
};

type OutputReceiptResult = {
  taskId?: string;
  receipt?: SidecarFileEvidence;
};

type SidecarFileEvidence = {
  path?: string;
  sha256?: string;
  bytes?: number;
};

type JsonArtifact<T> = {
  evidence: SpreadsheetBenchOfficialArtifact;
  value?: T;
};

type OfficialScorerReceipt = {
  schema?: unknown;
  verifier?: unknown;
  track?: unknown;
  accepted?: unknown;
  score?: {
    averageOverall?: unknown;
    passRate?: unknown;
    passCount?: unknown;
    scoredTaskCount?: unknown;
  };
};

type OfficialScorerReceiptArtifact = {
  evidence: SpreadsheetBenchOfficialArtifact;
  score?: NonNullable<SpreadsheetBenchOfficialScoreReadiness["officialScoreClaim"]["score"]>;
};

type ReceiptValidation = {
  taskId?: string;
  valid: boolean;
  reason?: string;
};

const EXPECTED_TASK_COUNTS: Record<SpreadsheetBenchTrack, number> = {
  "spreadsheetbench-v1": 912,
  "spreadsheetbench-v2": 321,
};

export function defaultSpreadsheetBenchOfficialScoreInputs(track: SpreadsheetBenchTrack) {
  if (track === "spreadsheetbench-v1") {
    return {
      expectedTaskCount: EXPECTED_TASK_COUNTS[track],
      stageReportPath: "docs/eval/spreadsheetbench-v1-912-stage.json",
      runReportPaths: [
        existsSync("docs/eval/spreadsheetbench-v1-912-model-run-rescored.json")
          ? "docs/eval/spreadsheetbench-v1-912-model-run-rescored.json"
          : existsSync("docs/eval/spreadsheetbench-v1-912-model-run.json")
          ? "docs/eval/spreadsheetbench-v1-912-model-run.json"
          : existsSync("docs/eval/spreadsheetbench-v1-912-local-proxy-receipts.json")
          ? "docs/eval/spreadsheetbench-v1-912-local-proxy-receipts.json"
          : "docs/eval/spreadsheetbench-v1-912-copy-input-baseline.json",
      ],
      routeSelectionPath: "docs/eval/spreadsheetbench-v1-route-selection.json",
      outputReceiptReportPath: "docs/eval/spreadsheetbench-v1-912-local-proxy-output-receipts.json",
      officialScorerReceiptPath: "docs/eval/spreadsheetbench-v1-accepted-official-scorer-receipt.json",
    };
  }
  return {
    expectedTaskCount: EXPECTED_TASK_COUNTS[track],
    stageReportPath: existsSync("docs/eval/spreadsheetbench-v2-full-stage.json")
      ? "docs/eval/spreadsheetbench-v2-full-stage.json"
      : "docs/eval/spreadsheetbench-v2-stage-smoke.json",
    runReportPaths: [
      existsSync("docs/eval/spreadsheetbench-v2-321-model-run.json")
        ? "docs/eval/spreadsheetbench-v2-321-model-run.json"
        : existsSync("docs/eval/spreadsheetbench-v2-321-local-proxy-receipts.json")
        ? "docs/eval/spreadsheetbench-v2-321-local-proxy-receipts.json"
        : "docs/eval/spreadsheetbench-v2-run-smoke.json",
    ],
    routeSelectionPath: "docs/eval/spreadsheetbench-v2-route-selection.json",
    outputReceiptReportPath: "docs/eval/spreadsheetbench-v2-321-local-proxy-output-receipts.json",
    officialScorerReceiptPath: "docs/eval/spreadsheetbench-v2-accepted-official-scorer-receipt.json",
  };
}

export function buildSpreadsheetBenchOfficialScoreReadiness(
  options: SpreadsheetBenchOfficialScoreReadinessOptions,
): SpreadsheetBenchOfficialScoreReadiness {
  const defaults = defaultSpreadsheetBenchOfficialScoreInputs(options.track);
  const expectedTaskCount = options.expectedTaskCount ?? defaults.expectedTaskCount;
  const stageReportPath = options.stageReportPath ?? defaults.stageReportPath;
  const runReportPaths = options.runReportPaths ?? defaults.runReportPaths;
  const routeSelectionPath = options.routeSelectionPath ?? defaults.routeSelectionPath;
  const usingDefaultInputs = !options.stageReportPath && !options.runReportPaths && !options.routeSelectionPath;
  const outputReceiptReportPath = options.outputReceiptReportPath ?? (usingDefaultInputs ? defaults.outputReceiptReportPath : undefined);
  const officialScorerReceiptPath = options.officialScorerReceiptPath ?? defaults.officialScorerReceiptPath;

  const stageArtifact = readJsonArtifact<StageReport>(stageReportPath);
  const runArtifacts = runReportPaths.map((path) => readJsonArtifact<RunReport>(path));
  const routeSelection = routeSelectionPath ? artifactForPath(routeSelectionPath) : undefined;
  const outputReceiptReport = readJsonArtifact<OutputReceiptReport>(outputReceiptReportPath);
  const officialScorerReceipt = readOfficialScorerReceiptArtifact(officialScorerReceiptPath, options.track);
  const stageTaskIds = (stageArtifact.value?.tasks ?? [])
    .map((task) => task.id)
    .filter((id): id is string => Boolean(id))
    .slice(0, expectedTaskCount);
  const stagedTaskCount = stageArtifact.value?.stagedTaskCount ?? stageTaskIds.length;

  const runReports = runArtifacts.flatMap((artifact) => artifact.value ? [{ artifact, report: artifact.value }] : []);
  const results = runReports.flatMap(({ report }) => report.results ?? []);
  const latestResultsByTaskId = latestResultMap(results);
  const latestModelResultsByTaskId = latestResultMap(results.filter(isModelGeneratedResult));
  const receiptRoots = receiptRootsFor(options, runReports.map(({ artifact, report }) => ({ path: artifact.evidence.path, report })));
  const outputReceiptRoots = outputReceiptRootsFor(options, outputReceiptReport);
  const receiptValidations = [...latestResultsByTaskId.values()].map((result) => validateScorerReceipt(result, receiptRoots));
  const modelReceiptValidations = [...latestModelResultsByTaskId.values()].map((result) => validateScorerReceipt(result, receiptRoots));
  const outputReceiptValidations = (outputReceiptReport.value?.receipts ?? [])
    .map((result) => validateOutputReceipt(result, outputReceiptRoots, options.track));
  const validReceiptTaskIds = new Set(receiptValidations.filter((receipt) => receipt.valid && receipt.taskId).map((receipt) => receipt.taskId!));
  const validModelReceiptTaskIds = new Set(modelReceiptValidations.filter((receipt) => receipt.valid && receipt.taskId).map((receipt) => receipt.taskId!));
  const validOutputReceiptTaskIds = new Set(outputReceiptValidations.filter((receipt) => receipt.valid && receipt.taskId).map((receipt) => receipt.taskId!));
  const invalidScorerReceiptCount = receiptValidations.filter((receipt) => !receipt.valid && receipt.reason !== "missing_scorer_receipt").length;
  const invalidOutputReceiptCount = outputReceiptValidations.filter((receipt) => !receipt.valid && receipt.reason !== "missing_output_receipt").length;
  const expectedTaskIds = stageTaskIds.length > 0 ? stageTaskIds : [...latestResultsByTaskId.keys()].slice(0, expectedTaskCount);
  const missingTaskIds = expectedTaskIds.length > 0
    ? expectedTaskIds.filter((taskId) => !validReceiptTaskIds.has(taskId))
    : [];
  const missingModelTaskIds = expectedTaskIds.length > 0
    ? expectedTaskIds.filter((taskId) => !validModelReceiptTaskIds.has(taskId))
    : [];
  const missingOutputTaskIds = expectedTaskIds.length > 0
    ? expectedTaskIds.filter((taskId) => !validOutputReceiptTaskIds.has(taskId))
    : [];
  const missingScorerReceiptCount = Math.max(
    missingTaskIds.length,
    expectedTaskCount - Math.min(expectedTaskCount, validReceiptTaskIds.size),
  );
  const missingOutputReceiptCount = Math.max(
    missingOutputTaskIds.length,
    expectedTaskCount - Math.min(expectedTaskCount, validOutputReceiptTaskIds.size),
  );
  const routeCostLedger = buildRouteCostLedger(runReports.map(({ report }) => report), results);
  const outputReceiptCostUsd = outputReceiptReport.value?.routeCostLedger?.providerCostUsd ?? 0;
  const scoredResults = [...latestResultsByTaskId.values()].filter((result) => result.score);
  const localBlockers = buildLocalBlockers({
    expectedTaskCount,
    stageArtifact,
    stagedTaskCount,
    runArtifacts,
    uniqueRunTaskCount: latestResultsByTaskId.size,
    validScorerReceiptCount: validReceiptTaskIds.size,
    missingScorerReceiptCount,
    invalidScorerReceiptCount,
    providerCostUsd: routeCostLedger.providerCostUsd,
  });
  const outputBlockers = buildOutputBlockers({
    track: options.track,
    expectedTaskCount,
    outputReceiptReport,
    validOutputReceiptCount: validOutputReceiptTaskIds.size,
    missingOutputReceiptCount,
    invalidOutputReceiptCount,
    providerCostUsd: outputReceiptCostUsd,
  });
  const localProxyComplete = localBlockers.length === 0;
  const localProxyOutputComplete = outputBlockers.length === 0;
  const localProofComplete = localProxyComplete || localProxyOutputComplete;
  const modelRunComplete = expectedTaskIds.length > 0
    ? missingModelTaskIds.length === 0 && validModelReceiptTaskIds.size >= expectedTaskCount
    : validModelReceiptTaskIds.size >= expectedTaskCount;
  const firstMissingModelOffset = firstMissingTaskOffset(stageTaskIds, validModelReceiptTaskIds);
  const nextMissingModelTaskIds = missingModelTaskIds.slice(0, 10);
  const modelRunBlocker = modelRunComplete
    ? undefined
    : `full model-generated run receipt coverage is incomplete: ${Math.min(expectedTaskCount, validModelReceiptTaskIds.size)}/${expectedTaskCount} model-edit-plan task(s) validate`;
  const officialScorerBlocker = officialScorerReceipt.score
    ? undefined
    : `accepted official scorer receipt is ${officialScorerReceipt.evidence.status}: ${officialScorerReceipt.evidence.path ?? "unconfigured"}${officialScorerReceipt.evidence.reason ? ` (${officialScorerReceipt.evidence.reason})` : ""}`;
  const blockers = localProofComplete
    ? [
        ...(modelRunBlocker ? [modelRunBlocker] : []),
        ...(officialScorerBlocker ? [officialScorerBlocker] : []),
      ]
    : outputReceiptReport.evidence.status === "present"
      ? outputBlockers
      : localBlockers;
  const officialScoreReady = localProofComplete && modelRunComplete && Boolean(officialScorerReceipt.score);
  const checkpointTaskIds = localProxyOutputComplete ? validOutputReceiptTaskIds : validReceiptTaskIds;
  const checkpointMissingTaskIds = localProxyOutputComplete ? missingOutputTaskIds : missingTaskIds;
  const firstMissingOffset = firstMissingTaskOffset(stageTaskIds, checkpointTaskIds);
  const nextMissingTaskIds = checkpointMissingTaskIds.slice(0, 10);
  const localProxyScore = localProxyComplete ? scoreFromResults(scoredResults) : undefined;

  const warnings = [
    ...(routeSelection?.status === "missing" ? [`route selection artifact is missing: ${routeSelection.path}`] : []),
    ...receiptValidations
      .filter((receipt) => !receipt.valid && receipt.reason)
      .slice(0, 20)
      .map((receipt) => `${receipt.taskId ?? "unknown task"} scorer receipt ${receipt.reason}`),
    ...outputReceiptValidations
      .filter((receipt) => !receipt.valid && receipt.reason)
      .slice(0, 20)
      .map((receipt) => `${receipt.taskId ?? "unknown task"} output receipt ${receipt.reason}`),
  ];

  return {
    schema: 1,
    generatedAt: options.generatedAt,
    track: options.track,
    expectedTaskCount,
    status: officialScoreReady
      ? "official_score_ready"
      : localProxyComplete
        ? "proxy_receipts_complete"
        : localProxyOutputComplete
          ? "proxy_outputs_complete"
          : "blocked",
    officialScoreClaim: {
      allowed: officialScoreReady,
      policy: "accepted_official_scorer_receipt_required",
      ...(officialScorerReceipt.score ? { score: officialScorerReceipt.score } : {}),
      ...(!officialScorerReceipt.score && officialScorerBlocker ? { blocker: officialScorerBlocker } : {}),
    },
    officialModelRunClaim: {
      allowed: modelRunComplete,
      policy: "full_model_generated_run_required_for_official_promotion",
      requiredTaskCount: expectedTaskCount,
      validTaskCount: Math.min(expectedTaskCount, validModelReceiptTaskIds.size),
      missingTaskCount: Math.max(0, expectedTaskCount - Math.min(expectedTaskCount, validModelReceiptTaskIds.size)),
      ...(firstMissingModelOffset === undefined ? {} : { nextMissingOffset: firstMissingModelOffset }),
      nextMissingTaskIds: nextMissingModelTaskIds,
      ...(firstMissingModelOffset === undefined
        ? {}
        : {
            resumeHint:
              `npm run benchmark:spreadsheetbench:run-chunked -- --stage-root .tmp/official-benchmarks/staged-v2-full --output-root .tmp/official-benchmarks/run-v2-full-model --json-out docs/eval/spreadsheetbench-v2-full-model-run.json --mode model-edit-plan --model openrouter/free-auto --chunk-size 25 --offset ${firstMissingModelOffset}`,
          }),
      ...(modelRunBlocker ? { blocker: modelRunBlocker } : {}),
    },
    localProxyReceiptClaim: {
      allowed: localProxyComplete,
      policy: "local_workbook_scorer_receipts_are_proxy_not_official",
      ...(localProxyScore ? { score: localProxyScore } : {}),
    },
    localProxyOutputClaim: {
      allowed: localProxyOutputComplete,
      policy: "candidate_output_receipts_are_proxy_not_official_scores",
      receiptCount: Math.min(expectedTaskCount, validOutputReceiptTaskIds.size),
    },
    artifacts: {
      stageReport: stageArtifact.evidence,
      runReports: runArtifacts.map((artifact) => artifact.evidence),
      ...(routeSelection ? { routeSelection } : {}),
      ...(outputReceiptReportPath ? { outputReceiptReport: outputReceiptReport.evidence } : {}),
      officialScorerReceipt: officialScorerReceipt.evidence,
    },
    coverage: {
      stagedTaskCount,
      runTaskCount: results.length,
      uniqueRunTaskCount: latestResultsByTaskId.size,
      requiredScorerReceiptCount: expectedTaskCount,
      validScorerReceiptCount: Math.min(expectedTaskCount, validReceiptTaskIds.size),
      missingScorerReceiptCount,
      invalidScorerReceiptCount,
      validOutputReceiptCount: Math.min(expectedTaskCount, validOutputReceiptTaskIds.size),
      missingOutputReceiptCount,
      invalidOutputReceiptCount,
    },
    checkpoint: {
      status: localProofComplete ? "complete" : "incomplete",
      ...(firstMissingOffset === undefined ? {} : { nextMissingOffset: firstMissingOffset }),
      nextMissingTaskIds,
      remainingTaskCount: localProofComplete
        ? 0
        : Math.max(0, expectedTaskCount - Math.min(expectedTaskCount, checkpointTaskIds.size)),
      ...(firstMissingOffset === undefined
        ? {}
        : {
            resumeHint:
              `run the next SpreadsheetBench shard with --offset ${firstMissingOffset} --limit ${Math.min(25, expectedTaskCount - firstMissingOffset)}`,
          }),
    },
    shards: buildShardStatuses(runArtifacts, receiptRoots),
    routeCostLedger,
    blockers,
    warnings,
  };
}

function readJsonArtifact<T>(path: string | undefined): JsonArtifact<T> {
  const evidence = artifactForPath(path);
  if (evidence.status !== "present" || !path) return { evidence };
  try {
    return {
      evidence,
      value: JSON.parse(readFileSync(resolve(path), "utf8")) as T,
    };
  } catch (error) {
    return {
      evidence: {
        ...evidence,
        status: "invalid",
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function readOfficialScorerReceiptArtifact(path: string | undefined, track: SpreadsheetBenchTrack): OfficialScorerReceiptArtifact {
  const artifact = readJsonArtifact<OfficialScorerReceipt>(path);
  if (artifact.evidence.status !== "present" || !artifact.value) return { evidence: artifact.evidence };
  const reason = officialScorerReceiptInvalidReason(artifact.value, track);
  if (reason) return { evidence: { ...artifact.evidence, status: "invalid", reason } };
  return {
    evidence: artifact.evidence,
    score: {
      averageOverall: artifact.value.score!.averageOverall as number,
      passRate: artifact.value.score!.passRate as number,
      passCount: artifact.value.score!.passCount as number,
      scoredTaskCount: artifact.value.score!.scoredTaskCount as number,
      source: "accepted_official_scorer_receipt",
    },
  };
}

function officialScorerReceiptInvalidReason(receipt: OfficialScorerReceipt, track: SpreadsheetBenchTrack): string | undefined {
  if (receipt.schema !== 1) return "official scorer receipt schema must be 1";
  if (receipt.verifier !== "spreadsheetbench_official_scorer") return "official scorer receipt verifier must be spreadsheetbench_official_scorer";
  if (receipt.track !== track) return `official scorer receipt track must be ${track}`;
  if (receipt.accepted !== true) return "official scorer receipt accepted must be true";
  if (!receipt.score) return "official scorer receipt score is missing";
  for (const key of ["averageOverall", "passRate", "passCount", "scoredTaskCount"] as const) {
    if (typeof receipt.score[key] !== "number" || !Number.isFinite(receipt.score[key])) {
      return `official scorer receipt score.${key} must be a finite number`;
    }
  }
  return undefined;
}

function artifactForPath(path: string | undefined): SpreadsheetBenchOfficialArtifact {
  if (!path) return { status: "missing", reason: "path not configured" };
  const absolute = resolve(path);
  if (!existsSync(absolute)) return { path: rel(absolute), status: "missing" };
  try {
    const stat = statSync(absolute);
    if (!stat.isFile()) return { path: rel(absolute), status: "invalid", reason: "not a file" };
    const content = readFileSync(absolute);
    return {
      path: rel(absolute),
      status: "present",
      bytes: content.byteLength,
      sha256: sha256(content),
    };
  } catch (error) {
    return {
      path: rel(absolute),
      status: "invalid",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function latestResultMap(results: RunResult[]): Map<string, RunResult> {
  const out = new Map<string, RunResult>();
  for (const result of results) {
    if (!result.taskId) continue;
    out.set(result.taskId, result);
  }
  return out;
}

function isModelGeneratedResult(result: RunResult): boolean {
  return result.mode === "model-edit-plan" && (result.model?.calls ?? 0) > 0;
}

function receiptRootsFor(
  options: SpreadsheetBenchOfficialScoreReadinessOptions,
  runs: Array<{ path?: string; report: RunReport }>,
): string[] {
  const roots = new Set<string>();
  for (const root of options.receiptRoots ?? []) roots.add(resolve(root));
  for (const { path, report } of runs) {
    if (!report.outputRoot) continue;
    roots.add(resolve(".tmp", "official-benchmarks", report.outputRoot));
    roots.add(resolve(report.outputRoot));
    if (path) roots.add(resolve(dirname(path), report.outputRoot));
  }
  return [...roots];
}

function outputReceiptRootsFor(
  options: SpreadsheetBenchOfficialScoreReadinessOptions,
  report: JsonArtifact<OutputReceiptReport>,
): string[] {
  const roots = new Set<string>();
  for (const root of options.receiptRoots ?? []) roots.add(resolve(root));
  if (report.value?.outputRoot) {
    roots.add(resolve(".tmp", "official-benchmarks", report.value.outputRoot));
    roots.add(resolve(report.value.outputRoot));
    if (report.evidence.path) roots.add(resolve(dirname(report.evidence.path), report.value.outputRoot));
  }
  return [...roots];
}

function validateScorerReceipt(result: RunResult, roots: string[]): ReceiptValidation {
  const evidence = result.scorerReceipt;
  if (!result.taskId) return { valid: false, reason: "missing_task_id" };
  if (!evidence?.path) return { taskId: result.taskId, valid: false, reason: "missing_scorer_receipt" };
  if (!/^[a-f0-9]{64}$/.test(evidence.sha256 ?? "")) {
    return { taskId: result.taskId, valid: false, reason: "invalid_scorer_receipt_sha256" };
  }
  if ((evidence.bytes ?? 0) <= 0) return { taskId: result.taskId, valid: false, reason: "invalid_scorer_receipt_size" };

  const file = resolveReceiptFile(evidence.path, roots, evidence);
  if (!file) return { taskId: result.taskId, valid: false, reason: "scorer_receipt_file_not_found" };
  const content = readFileSync(file);
  if (content.byteLength !== evidence.bytes) return { taskId: result.taskId, valid: false, reason: "scorer_receipt_size_mismatch" };
  if (sha256(content) !== evidence.sha256) return { taskId: result.taskId, valid: false, reason: "scorer_receipt_sha256_mismatch" };
  try {
    const parsed = JSON.parse(content.toString("utf8")) as {
      schema?: unknown;
      verifier?: unknown;
      taskId?: unknown;
      score?: unknown;
    };
    if (parsed.schema !== 1) return { taskId: result.taskId, valid: false, reason: "scorer_receipt_schema_mismatch" };
    if (parsed.verifier !== "spreadsheetbench_workbook_scorer") {
      return { taskId: result.taskId, valid: false, reason: "scorer_receipt_verifier_mismatch" };
    }
    if (parsed.taskId !== result.taskId) return { taskId: result.taskId, valid: false, reason: "scorer_receipt_task_mismatch" };
    if (!parsed.score || !result.score) return { taskId: result.taskId, valid: false, reason: "scorer_receipt_missing_score" };
  } catch {
    return { taskId: result.taskId, valid: false, reason: "scorer_receipt_json_invalid" };
  }
  return { taskId: result.taskId, valid: true };
}

function validateOutputReceipt(
  result: OutputReceiptResult,
  roots: string[],
  track: SpreadsheetBenchTrack,
): ReceiptValidation {
  const evidence = result.receipt;
  if (!result.taskId) return { valid: false, reason: "missing_task_id" };
  if (!evidence?.path) return { taskId: result.taskId, valid: false, reason: "missing_output_receipt" };
  if (!/^[a-f0-9]{64}$/.test(evidence.sha256 ?? "")) {
    return { taskId: result.taskId, valid: false, reason: "invalid_output_receipt_sha256" };
  }
  if ((evidence.bytes ?? 0) <= 0) return { taskId: result.taskId, valid: false, reason: "invalid_output_receipt_size" };

  const file = resolveReceiptFile(evidence.path, roots, evidence);
  if (!file) return { taskId: result.taskId, valid: false, reason: "output_receipt_file_not_found" };
  const content = readFileSync(file);
  if (content.byteLength !== evidence.bytes) return { taskId: result.taskId, valid: false, reason: "output_receipt_size_mismatch" };
  if (sha256(content) !== evidence.sha256) return { taskId: result.taskId, valid: false, reason: "output_receipt_sha256_mismatch" };
  try {
    const parsed = JSON.parse(content.toString("utf8")) as {
      schema?: unknown;
      verifier?: unknown;
      taskId?: unknown;
      track?: unknown;
      officialScoreClaim?: {
        allowed?: unknown;
      };
      officialScoring?: {
        status?: unknown;
      };
    };
    if (parsed.schema !== 1) return { taskId: result.taskId, valid: false, reason: "output_receipt_schema_mismatch" };
    if (parsed.verifier !== "spreadsheetbench_local_proxy_output") {
      return { taskId: result.taskId, valid: false, reason: "output_receipt_verifier_mismatch" };
    }
    if (parsed.taskId !== result.taskId) return { taskId: result.taskId, valid: false, reason: "output_receipt_task_mismatch" };
    if (parsed.track !== track) return { taskId: result.taskId, valid: false, reason: "output_receipt_track_mismatch" };
    if (parsed.officialScoreClaim?.allowed !== false) {
      return { taskId: result.taskId, valid: false, reason: "output_receipt_must_not_allow_official_score_claim" };
    }
    if (parsed.officialScoring?.status !== "pending_official_scorer_receipt") {
      return { taskId: result.taskId, valid: false, reason: "output_receipt_official_scoring_status_mismatch" };
    }
  } catch {
    return { taskId: result.taskId, valid: false, reason: "output_receipt_json_invalid" };
  }
  return { taskId: result.taskId, valid: true };
}

function resolveReceiptFile(path: string, roots: string[], evidence?: SidecarFileEvidence): string | undefined {
  const candidates = isAbsolute(path)
    ? [resolve(path)]
    : roots.map((root) => resolve(root, path)).filter((candidate) => isWithinRoots(candidate, roots));
  const existing = candidates.filter((candidate) => existsSync(candidate) && statSync(candidate).isFile());
  if (!evidence?.sha256 && !evidence?.bytes) return existing[0];
  return existing.find((candidate) => {
    const content = readFileSync(candidate);
    if (evidence.bytes !== undefined && content.byteLength !== evidence.bytes) return false;
    return !evidence.sha256 || sha256(content) === evidence.sha256;
  }) ?? existing[0];
}

function isWithinRoots(file: string, roots: string[]): boolean {
  const resolved = resolve(file);
  return roots.some((root) => {
    const resolvedRoot = resolve(root);
    return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}\\`) || resolved.startsWith(`${resolvedRoot}/`);
  });
}

function buildRouteCostLedger(reports: RunReport[], results: RunResult[]): SpreadsheetBenchOfficialScoreReadiness["routeCostLedger"] {
  const routeMap = new Map<string, { route: string; taskCount: number; modelCalls: number; providerCostUsd: number }>();
  for (const result of results) {
    const route = result.model?.name ?? `local/${result.mode ?? "copy-input-baseline"}`;
    const current = routeMap.get(route) ?? { route, taskCount: 0, modelCalls: 0, providerCostUsd: 0 };
    current.taskCount += 1;
    current.modelCalls += result.model?.calls ?? 0;
    current.providerCostUsd += result.model?.costUsd ?? 0;
    routeMap.set(route, current);
  }
  for (const report of reports) {
    if ((report.results?.length ?? 0) > 0) continue;
    const route = `local/${report.mode ?? "copy-input-baseline"}`;
    const current = routeMap.get(route) ?? { route, taskCount: 0, modelCalls: 0, providerCostUsd: 0 };
    current.taskCount += report.taskCount ?? 0;
    current.modelCalls += report.harness?.budget?.modelCalls ?? 0;
    current.providerCostUsd += report.harness?.budget?.providerCostUsd ?? 0;
    routeMap.set(route, current);
  }
  const modelCalls = reports.reduce((sum, report) => sum + (report.harness?.budget?.modelCalls ?? 0), 0)
    || results.reduce((sum, result) => sum + (result.model?.calls ?? 0), 0);
  const inputTokens = reports.reduce((sum, report) => sum + (report.harness?.budget?.inputTokens ?? 0), 0)
    || results.reduce((sum, result) => sum + (result.model?.usage?.inputTokens ?? 0), 0);
  const outputTokens = reports.reduce((sum, report) => sum + (report.harness?.budget?.outputTokens ?? 0), 0)
    || results.reduce((sum, result) => sum + (result.model?.usage?.outputTokens ?? 0), 0);
  const providerCostUsd = Number((reports.reduce((sum, report) => sum + (report.harness?.budget?.providerCostUsd ?? 0), 0)
    || results.reduce((sum, result) => sum + (result.model?.costUsd ?? 0), 0)).toFixed(8));
  return {
    policy: "free_local_proxy_only",
    modelCalls,
    inputTokens,
    outputTokens,
    providerCostUsd,
    paidProviderCostUsd: providerCostUsd > 0 ? providerCostUsd : 0,
    routes: [...routeMap.values()]
      .map((route) => ({ ...route, providerCostUsd: Number(route.providerCostUsd.toFixed(8)) }))
      .sort((a, b) => a.route.localeCompare(b.route)),
  };
}

function buildLocalBlockers(args: {
  expectedTaskCount: number;
  stageArtifact: JsonArtifact<StageReport>;
  stagedTaskCount: number;
  runArtifacts: JsonArtifact<RunReport>[];
  uniqueRunTaskCount: number;
  validScorerReceiptCount: number;
  missingScorerReceiptCount: number;
  invalidScorerReceiptCount: number;
  providerCostUsd: number;
}): string[] {
  const blockers: string[] = [];
  if (args.stageArtifact.evidence.status !== "present") {
    blockers.push(`stage report is ${args.stageArtifact.evidence.status}: ${args.stageArtifact.evidence.path ?? "unconfigured"}`);
  }
  if (args.stagedTaskCount < args.expectedTaskCount) {
    blockers.push(`only ${args.stagedTaskCount}/${args.expectedTaskCount} official task(s) are staged`);
  }
  const presentRunReports = args.runArtifacts.filter((artifact) => artifact.evidence.status === "present").length;
  if (presentRunReports === 0) blockers.push("no SpreadsheetBench run report artifacts are present");
  const invalidRunReports = args.runArtifacts.filter((artifact) => artifact.evidence.status === "invalid");
  for (const artifact of invalidRunReports) {
    blockers.push(`run report is invalid: ${artifact.evidence.path ?? "unknown"} (${artifact.evidence.reason ?? "unknown error"})`);
  }
  if (args.uniqueRunTaskCount < args.expectedTaskCount) {
    blockers.push(`only ${args.uniqueRunTaskCount}/${args.expectedTaskCount} official task(s) have run results`);
  }
  if (args.validScorerReceiptCount < args.expectedTaskCount) {
    blockers.push(`only ${args.validScorerReceiptCount}/${args.expectedTaskCount} required scorer receipt(s) validate`);
  }
  if (args.missingScorerReceiptCount > 0) {
    blockers.push(`${args.missingScorerReceiptCount} required scorer receipt(s) are missing`);
  }
  if (args.invalidScorerReceiptCount > 0) {
    blockers.push(`${args.invalidScorerReceiptCount} scorer receipt artifact(s) are present but invalid`);
  }
  if (args.providerCostUsd > 0) {
    blockers.push(`provider spend is $${args.providerCostUsd}; this readiness lane only accepts free/local/proxy smokes`);
  }
  return blockers;
}

function buildOutputBlockers(args: {
  track: SpreadsheetBenchTrack;
  expectedTaskCount: number;
  outputReceiptReport: JsonArtifact<OutputReceiptReport>;
  validOutputReceiptCount: number;
  missingOutputReceiptCount: number;
  invalidOutputReceiptCount: number;
  providerCostUsd: number;
}): string[] {
  const blockers: string[] = [];
  if (args.outputReceiptReport.evidence.status !== "present") {
    blockers.push(`local/proxy output receipt report is ${args.outputReceiptReport.evidence.status}: ${args.outputReceiptReport.evidence.path ?? "unconfigured"}`);
  }
  if (args.outputReceiptReport.value?.track && args.outputReceiptReport.value.track !== args.track) {
    blockers.push(`local/proxy output receipt report track must be ${args.track}`);
  }
  if ((args.outputReceiptReport.value?.taskCount ?? 0) < args.expectedTaskCount) {
    blockers.push(`only ${args.outputReceiptReport.value?.taskCount ?? 0}/${args.expectedTaskCount} local/proxy output task(s) are reported`);
  }
  if (args.validOutputReceiptCount < args.expectedTaskCount) {
    blockers.push(`only ${args.validOutputReceiptCount}/${args.expectedTaskCount} local/proxy output receipt(s) validate`);
  }
  if (args.missingOutputReceiptCount > 0) {
    blockers.push(`${args.missingOutputReceiptCount} local/proxy output receipt(s) are missing`);
  }
  if (args.invalidOutputReceiptCount > 0) {
    blockers.push(`${args.invalidOutputReceiptCount} local/proxy output receipt artifact(s) are present but invalid`);
  }
  if (args.providerCostUsd > 0) {
    blockers.push(`provider spend is $${args.providerCostUsd}; this readiness lane only accepts free/local/proxy output receipts`);
  }
  return blockers;
}

function firstMissingTaskOffset(stageTaskIds: string[], validReceiptTaskIds: Set<string>): number | undefined {
  const index = stageTaskIds.findIndex((taskId) => !validReceiptTaskIds.has(taskId));
  return index >= 0 ? index : undefined;
}

function scoreFromResults(results: RunResult[]): NonNullable<SpreadsheetBenchOfficialScoreReadiness["localProxyReceiptClaim"]["score"]> {
  const scores = results.map((result) => result.score?.scores?.overall).filter((score): score is number => typeof score === "number");
  const passCount = results.filter((result) => result.score?.pass === true).length;
  return {
    averageOverall: scores.length ? Number((scores.reduce((sum, score) => sum + score, 0) / scores.length).toFixed(6)) : 0,
    passRate: results.length ? Number((passCount / results.length).toFixed(6)) : 0,
    passCount,
    scoredTaskCount: results.length,
    source: "validated_scorer_receipts",
  };
}

function buildShardStatuses(
  artifacts: JsonArtifact<RunReport>[],
  receiptRoots: string[],
): SpreadsheetBenchOfficialShardStatus[] {
  return artifacts.flatMap((artifact, artifactIndex) => {
    const path = artifact.evidence.path ?? `run-report-${artifactIndex + 1}`;
    if (!artifact.value) {
      return [{
        id: `run-${artifactIndex + 1}`,
        path,
        status: artifact.evidence.status === "missing" ? "missing" as const : "invalid" as const,
        taskCount: 0,
        scoredTaskCount: 0,
        validScorerReceiptCount: 0,
        providerCostUsd: 0,
        reason: artifact.evidence.reason,
      }];
    }
    const report = artifact.value;
    const reportReceiptCount = (report.results ?? [])
      .map((result) => validateScorerReceipt(result, receiptRoots))
      .filter((receipt) => receipt.valid)
      .length;
    const reportShard: SpreadsheetBenchOfficialShardStatus = {
      id: `run-${artifactIndex + 1}`,
      path,
      status: reportReceiptCount >= (report.results?.length ?? 0) && (report.results?.length ?? 0) > 0 ? "complete" : "partial",
      taskCount: report.taskCount ?? report.results?.length ?? 0,
      scoredTaskCount: (report.results ?? []).filter((result) => result.score).length,
      validScorerReceiptCount: reportReceiptCount,
      providerCostUsd: report.harness?.budget?.providerCostUsd ?? 0,
    };
    const chunks = (report.chunks ?? []).map((chunk) => ({
      id: `run-${artifactIndex + 1}-chunk-${chunk.index ?? "unknown"}`,
      path: chunk.reportPath ?? path,
      status: chunk.exitCode === 0 ? "complete" as const : "failed" as const,
      offset: chunk.offset,
      limit: chunk.limit,
      taskCount: chunk.taskCount ?? 0,
      scoredTaskCount: chunk.taskCount ?? 0,
      validScorerReceiptCount: 0,
      providerCostUsd: 0,
      exitCode: chunk.exitCode,
      ...(chunk.exitCode === 0 ? {} : { reason: `child exit code ${chunk.exitCode ?? "missing"}` }),
    }));
    return [reportShard, ...chunks];
  });
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function rel(path: string): string {
  return relative(process.cwd(), resolve(path)).replace(/\\/g, "/") || basename(path);
}
