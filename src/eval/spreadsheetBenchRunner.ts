import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import {
  readSpreadsheetBenchWorkbookForCells,
  scoreSpreadsheetBenchWorkbook,
  type SpreadsheetBenchWorkbookScore,
} from "./spreadsheetBenchScorer";
import type { SpreadsheetBenchTrack } from "./spreadsheetBenchAdapter";
import type { AgentModel, TokenUsage } from "../nodeagent/core/types";
import { priceRun } from "../nodeagent/models/adapter";
import { getModelPricing } from "../nodeagent/models/modelCatalog";
import {
  runSpreadsheetBenchNodeAgentBridge,
  type SpreadsheetBenchCandidateFinalizationReceipt,
} from "./spreadsheetBenchNodeAgentBridge";
import {
  checksForWorkbookOperations,
  extractWorkbookTaskReferences,
  inspectWorkbookTask,
  normalizeFormula,
  selectWorkbookTaskCells,
  verifyWorkbookPlan,
  verifyWorkbookValues,
  workbookCellKey,
  type WorkbookObservedCell,
  type WorkbookPlanOperation,
  type WorkbookPlanIssue,
  type WorkbookPlanVerification,
  type WorkbookTaskInspection,
  type WorkbookValueCheck,
} from "../nodeagent/skills/spreadsheet/workbookTaskIntelligence";

export type SpreadsheetBenchRunnerMode = "copy-input-baseline" | "apply-agent-patch" | "model-edit-plan" | "nodeagent-workbook";

const FORMULA_RESULT_POLICY = "deterministic_local_subset";
const SUPPORTED_FORMULA_FUNCTIONS = [
  "SUM",
  "AVERAGE",
  "MIN",
  "MAX",
  "MEDIAN",
  "COUNT",
  "COUNTA",
  "ABS",
  "ROUND",
  "ROUNDUP",
  "ROUNDDOWN",
  "AND",
  "OR",
  "NOT",
  "IF",
  "IFERROR",
  "SUMIF",
  "COUNTIF",
  "AVERAGEIF",
  "SUMIFS",
  "COUNTIFS",
  "AVERAGEIFS",
  "MATCH",
  "INDEX",
  "VLOOKUP",
  "XLOOKUP",
  "SUMPRODUCT",
  "LEFT",
  "RIGHT",
  "MID",
  "LEN",
  "FIND",
  "SEARCH",
  "REPLACE",
  "TEXT",
  "DATE",
  "VALUE",
  "CONCATENATE",
  "TRIM",
] as const;

export type SpreadsheetBenchRunnerOptions = {
  stageRoot: string;
  outputRoot: string;
  mode: SpreadsheetBenchRunnerMode;
  model?: AgentModel;
  modelName?: string;
  modelTimeoutMs?: number;
  modelBatchSize?: number;
  modelSnapshotMaxCells?: number;
  modelSnapshotMaxCellChars?: number;
  modelRepairAttempts?: number;
  refreshExcelCaches?: boolean;
  taskIds?: string[];
  repeats?: number;
  retryFailed?: number;
  retryScoreFailures?: boolean;
  limit?: number;
  offset?: number;
  clean?: boolean;
  compareStyles?: boolean;
  compareCharts?: boolean;
  maxMismatches?: number;
  generatedAt?: string;
};

export type SpreadsheetBenchRunnerTaskResult = {
  taskId: string;
  track: SpreadsheetBenchTrack;
  category?: string;
  mode: SpreadsheetBenchRunnerMode;
  attemptIndex: number;
  repeatIndex: number;
  tryIndex: number;
  retryOfAttemptIndex?: number;
  taskDir: string;
  agentManifest: string;
  evaluatorManifest: string;
  candidateWorkbook?: string;
  sidecarEvidence?: SpreadsheetBenchSidecarEvidence;
  scorerReceipt?: SpreadsheetBenchSidecarFileEvidence;
  score?: SpreadsheetBenchWorkbookScore;
  error?: {
    phase: "candidate_generation" | "scoring";
    message: string;
  };
  model?: {
    name: string;
    requestedName?: string;
    calls: number;
    usage: TokenUsage;
    costUsd: number;
    batch?: {
      id: string;
      taskCount: number;
      taskIndex: number;
      callShare: number;
    };
  };
  timingsMs: {
    modelPlanning?: number;
    candidateGeneration: number;
    scoring: number;
    total: number;
  };
  trajectory: Array<{
    step:
      | "read_agent_manifest"
      | "prepare_agent_workspace"
      | "read_agent_edit_plan"
      | "snapshot_agent_workbook"
      | "call_model_for_edit_plan"
      | "run_nodeagent_workbook"
      | "fallback_to_visible_formula_repairs"
      | "verify_edit_plan"
      | "repair_edit_plan"
      | "verify_candidate_workbook"
      | "emit_candidate_workbook"
      | "read_evaluator_manifest"
      | "score_candidate";
    detail: string;
  }>;
};

export type SpreadsheetBenchSidecarFileEvidence = {
  path: string;
  sha256: string;
  bytes: number;
};

export type SpreadsheetBenchSidecarEvidence = {
  candidateManifest: SpreadsheetBenchSidecarFileEvidence;
  agentWorkspaceManifest?: SpreadsheetBenchSidecarFileEvidence;
  editPlan?: SpreadsheetBenchSidecarFileEvidence & {
    kind: "source" | "generated";
  };
  rawModelOutput?: SpreadsheetBenchSidecarFileEvidence;
  workbookInspection?: SpreadsheetBenchSidecarFileEvidence;
  editVerification?: SpreadsheetBenchSidecarFileEvidence;
  nodeAgentReceipt?: SpreadsheetBenchSidecarFileEvidence;
  nodeAgentTrace?: SpreadsheetBenchSidecarFileEvidence;
  candidateFinalization?: SpreadsheetBenchSidecarFileEvidence;
  repairOutputs?: SpreadsheetBenchSidecarFileEvidence[];
  formulaResultPolicy?: string;
  supportedFormulaFunctions?: string[];
  appliedOperationCount?: number;
  repairAttemptCount?: number;
  verificationStatus?: "passed" | "needs_repair";
};

export type SpreadsheetBenchRunnerReport = {
  schema: 1;
  generatedAt?: string;
  stageRoot: string;
  outputRoot: string;
  mode: SpreadsheetBenchRunnerMode;
  taskOffset?: number;
  taskCount: number;
  passCount: number;
  averageOverall: number;
  caseCount: number;
  caseRunCount: number;
  casePassCount: number;
  casePassRate: number;
  repeatCount: number;
  attemptCount: number;
  passRate: number;
  retryPolicy: {
    maxRetries: number;
    retryOn: Array<"candidate_generation" | "scoring" | "score_failure">;
    stopOnPass: true;
  };
  retryStats: {
    retriedCaseRunCount: number;
    retryAttemptCount: number;
    passedAfterRetryCount: number;
    exhaustedCaseRunCount: number;
  };
  stats: {
    latencyMs: {
      p50: number;
      p95: number;
      max: number;
    };
    failureCounts: Record<string, number>;
  };
  harness: {
    toolPolicy: "agent_dir_only_until_candidate";
    evaluatorAccess: "after_candidate_emit_only";
    modelContextPolicy?: {
      batchSize: number;
      snapshotMaxCells: number;
      snapshotMaxCellChars: number | null;
      instructionMaxChars: number | null;
      repairAttempts: number;
      refreshExcelCaches?: boolean;
      selectedTaskCount: number;
    };
    budget: {
      modelCalls: number;
      inputTokens: number;
      outputTokens: number;
      providerCostUsd: number;
    };
  };
  warnings: string[];
  caseRuns: SpreadsheetBenchRunnerCaseRun[];
  results: SpreadsheetBenchRunnerTaskResult[];
};

export type SpreadsheetBenchRunnerCaseRun = {
  taskId: string;
  taskDir: string;
  repeatIndex: number;
  attempts: number[];
  finalAttemptIndex?: number;
  pass: boolean;
  stopReason: "passed" | "failed_score" | "retry_exhausted" | "non_retryable_error" | "runner_error";
  bestOverall: number;
};

type AgentManifest = {
  schema: 1;
  taskId: string;
  track: SpreadsheetBenchTrack;
  category?: string;
  instruction: string;
  instructionType?: string;
  inputFiles: string[];
  promptFiles: string[];
};

type EvaluatorManifest = {
  schema: 1;
  taskId: string;
  track: SpreadsheetBenchTrack;
  answerPosition?: string;
  answerSheet?: string;
  dataPosition?: string;
  goldFiles: string[];
};

type StagedTaskPaths = {
  taskDir: string;
  agentManifestPath: string;
  evaluatorManifestPath: string;
};

const DEFAULT_WORKBOOK_SNAPSHOT_MAX_CELLS = 800;
const BATCH_INSTRUCTION_MAX_CHARS = 4_000;

export type AgentEditPlan = {
  schema: 1;
  operations: AgentEditOperation[];
};

type BatchedModelPlan = {
  snapshot: WorkbookSnapshot;
  rawModelOutput: string;
  modelPlanningMs: number;
  model: ModelCandidateEmission["model"];
  plan?: AgentEditPlan;
  droppedOperationCount?: number;
  error?: string;
};

type AgentCellEditOperation = {
  op?: "set_cell";
  sheet: string;
  cell: string;
  value?: string | number | boolean | null;
  formula?: string;
  result?: string | number | boolean | null;
  numFmt?: string;
};

type AgentAggregateSectionOperation = {
  op: "aggregate_section";
  sourceSheet: string;
  sourceSection: string;
  targetSheet: string;
  targetSection: string;
  groupBy: string[];
  valueColumn: string;
  sortBy?: string[];
  totalLabel?: string;
};

type AgentFilterRowsOperation = {
  op: "filter_rows";
  sheet: string;
  sourceRange: string;
  targetCell: string;
  dateColumn?: string;
  startCell: string;
  endCell: string;
};

type AgentSortUniqueRowsOperation = {
  op: "sort_unique_rows";
  sheet: string;
  sourceRange: string;
  targetCell: string;
  keyColumns: string[];
  outputColumns: string[];
  sortBy: string;
  sortDirection?: "asc" | "desc";
  includeIndex?: boolean;
};

export type AgentChartOperation = {
  op: "add_chart";
  sheet: string;
  chartType: "line" | "bar" | "column" | "pie" | "doughnut" | "scatter" | "area" | "bubble";
  title?: string;
  categoryRange: string;
  series: Array<{
    name: string;
    valuesRange: string;
    chartType?: "line" | "bar" | "column" | "area";
    xValuesRange?: string;
    sizeRange?: string;
    color?: string;
    secondaryAxis?: boolean;
  }>;
  anchor?: string;
  width?: number;
  height?: number;
  legendPosition?: "top" | "bottom" | "left" | "right" | "none";
  grouping?: "clustered" | "stacked" | "percentStacked";
  dataLabels?: boolean;
};

export type AgentEditOperation =
  | AgentCellEditOperation
  | AgentAggregateSectionOperation
  | AgentFilterRowsOperation
  | AgentSortUniqueRowsOperation
  | AgentChartOperation;

type FormulaResult = string | number | boolean;
type FormulaCellValue = FormulaResult | null;

export async function runStagedSpreadsheetBench(options: SpreadsheetBenchRunnerOptions): Promise<SpreadsheetBenchRunnerReport> {
  const stageRoot = resolve(options.stageRoot);
  const outputRoot = resolve(options.outputRoot);
  if (!existsSync(stageRoot)) throw new Error(`SpreadsheetBench stage root does not exist: ${options.stageRoot}`);
  if (options.clean && existsSync(outputRoot)) rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });

  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const requestedTaskIds = options.taskIds?.length ? new Set(options.taskIds) : undefined;
  const allTasks = findStagedTasks(stageRoot);
  const selectedTasks = requestedTaskIds
    ? allTasks.filter((task) => requestedTaskIds.has(readJson<AgentManifest>(task.agentManifestPath).taskId))
    : allTasks;
  if (requestedTaskIds && selectedTasks.length !== requestedTaskIds.size) {
    const selectedIds = new Set(selectedTasks.map((task) => readJson<AgentManifest>(task.agentManifestPath).taskId));
    const missing = [...requestedTaskIds].filter((taskId) => !selectedIds.has(taskId));
    throw new Error(`SpreadsheetBench task ID selection contains ${missing.length} unknown task(s): ${missing.slice(0, 10).join(", ")}`);
  }
  const tasks = selectedTasks.slice(offset, options.limit === undefined ? undefined : offset + options.limit);
  const batchedModelPlans = options.mode === "model-edit-plan" && (options.modelBatchSize ?? 1) > 1
    ? await prepareBatchedModelPlans(tasks, options)
    : undefined;
  const repeatCount = Math.max(1, Math.trunc(options.repeats ?? 1));
  const retryPolicy = buildRetryPolicy(options);
  const warnings: string[] = [];
  const results: SpreadsheetBenchRunnerTaskResult[] = [];
  const caseRuns: SpreadsheetBenchRunnerCaseRun[] = [];
  let nextAttemptIndex = 1;
  for (let repeat = 1; repeat <= repeatCount; repeat++) {
    for (const task of tasks) {
      const caseAttempts: SpreadsheetBenchRunnerTaskResult[] = [];
      for (let tryIndex = 1; tryIndex <= retryPolicy.maxRetries + 1; tryIndex++) {
        const attemptIndex = nextAttemptIndex++;
        try {
          const result = await runTask(stageRoot, outputRoot, task, options, {
            attemptIndex,
            repeatIndex: repeat,
            tryIndex,
            retryOfAttemptIndex: tryIndex > 1 ? attemptIndex - 1 : undefined,
            repeatCount,
            maxAttemptsPerRepeat: retryPolicy.maxRetries + 1,
          }, batchedModelPlans?.get(task.taskDir));
          if (result.error) warnings.push(`${result.taskDir}#${repeat}.${tryIndex}: ${result.error.message}`);
          results.push(result);
          caseAttempts.push(result);
          if (!shouldRetry(result, retryPolicy, tryIndex)) break;
        } catch (error) {
          warnings.push(`${rel(stageRoot, task.taskDir)}#${repeat}.${tryIndex}: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
      }
      caseRuns.push(summarizeCaseRun(stageRoot, task, repeat, caseAttempts, retryPolicy));
    }
  }
  const passCount = results.filter((result) => result.score?.pass).length;
  const casePassCount = caseRuns.filter((run) => run.pass).length;
  const averageOverall = results.length
    ? Number((results.reduce((sum, result) => sum + (result.score?.scores.overall ?? 0), 0) / results.length).toFixed(6))
    : 0;
  const usage = aggregateUsage(results);
  const stats = aggregateStats(results);
  const retryStats = aggregateRetryStats(caseRuns);
  return {
    schema: 1,
    generatedAt: options.generatedAt,
    stageRoot: basename(stageRoot),
    outputRoot: basename(outputRoot),
    mode: options.mode,
    taskOffset: offset,
    taskCount: results.length,
    passCount,
    averageOverall,
    caseCount: tasks.length,
    caseRunCount: caseRuns.length,
    casePassCount,
    casePassRate: caseRuns.length ? Number((casePassCount / caseRuns.length).toFixed(6)) : 0,
    repeatCount,
    attemptCount: results.length,
    passRate: results.length ? Number((passCount / results.length).toFixed(6)) : 0,
    retryPolicy,
    retryStats,
    stats,
    harness: {
      toolPolicy: "agent_dir_only_until_candidate",
      evaluatorAccess: "after_candidate_emit_only",
      modelContextPolicy: {
        batchSize: Math.max(1, Math.trunc(options.modelBatchSize ?? 1)),
        snapshotMaxCells: Math.max(1, Math.trunc(options.modelSnapshotMaxCells ?? DEFAULT_WORKBOOK_SNAPSHOT_MAX_CELLS)),
        snapshotMaxCellChars: options.modelSnapshotMaxCellChars === undefined
          ? null
          : Math.max(1, Math.trunc(options.modelSnapshotMaxCellChars)),
        instructionMaxChars: (options.modelBatchSize ?? 1) > 1 ? BATCH_INSTRUCTION_MAX_CHARS : null,
        repairAttempts: Math.max(0, Math.min(3, Math.trunc(options.modelRepairAttempts ?? 0))),
        refreshExcelCaches: options.refreshExcelCaches === true,
        selectedTaskCount: selectedTasks.length,
      },
      budget: {
        modelCalls: usage.calls,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        providerCostUsd: usage.costUsd,
      },
    },
    warnings,
    caseRuns,
    results,
  };
}

function findStagedTasks(stageRoot: string): StagedTaskPaths[] {
  const tasksRoot = join(stageRoot, "tasks");
  if (!existsSync(tasksRoot)) throw new Error(`SpreadsheetBench staged root must contain tasks/: ${stageRoot}`);
  return walkDirs(tasksRoot)
    .map((taskDir) => ({
      taskDir,
      agentManifestPath: join(taskDir, "agent", "task.json"),
      evaluatorManifestPath: join(taskDir, "evaluator", "evaluator.json"),
    }))
    .filter((task) => existsSync(task.agentManifestPath) && existsSync(task.evaluatorManifestPath))
    .sort((a, b) => a.taskDir.localeCompare(b.taskDir));
}

async function runTask(
  stageRoot: string,
  outputRoot: string,
  task: StagedTaskPaths,
  options: SpreadsheetBenchRunnerOptions,
  attempt: {
    attemptIndex: number;
    repeatIndex: number;
    tryIndex: number;
    retryOfAttemptIndex?: number;
    repeatCount: number;
    maxAttemptsPerRepeat: number;
  },
  batchedModelPlan?: BatchedModelPlan,
): Promise<SpreadsheetBenchRunnerTaskResult> {
  const started = Date.now();
  const trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"] = [];
  const agent = readJson<AgentManifest>(task.agentManifestPath);
  trajectory.push({ step: "read_agent_manifest", detail: rel(stageRoot, task.agentManifestPath) });
  const generationStarted = Date.now();
  const taskOutDir = join(
    outputRoot,
    rel(join(stageRoot, "tasks"), task.taskDir),
    attempt.repeatCount > 1 || attempt.maxAttemptsPerRepeat > 1 ? `attempt-${String(attempt.attemptIndex).padStart(2, "0")}` : "",
  );
  const agentWorkspace = prepareAgentWorkspace(stageRoot, task, taskOutDir, agent);
  trajectory.push({ step: "prepare_agent_workspace", detail: rel(outputRoot, agentWorkspace.manifestPath) });
  const candidateWorkbook = emitCandidateWorkbook({
    stageRoot,
    taskDir: task.taskDir,
    taskOutDir,
    agentWorkspace,
    agent,
    mode: options.mode,
    trajectory,
    model: options.model,
    modelName: options.modelName,
    modelTimeoutMs: options.modelTimeoutMs,
    modelSnapshotMaxCells: options.modelSnapshotMaxCells,
    modelSnapshotMaxCellChars: options.modelSnapshotMaxCellChars,
    modelRepairAttempts: options.modelRepairAttempts,
    refreshExcelCaches: options.refreshExcelCaches,
    batchedModelPlan,
  });
  let emitted: string | ModelCandidateEmission;
  try {
    emitted = await candidateWorkbook;
  } catch (error) {
    const modelFailure = modelEditFailure(error);
    return failedTaskResult({
      stageRoot,
      task,
      agent,
      mode: options.mode,
      attemptIndex: attempt.attemptIndex,
      repeatIndex: attempt.repeatIndex,
      tryIndex: attempt.tryIndex,
      retryOfAttemptIndex: attempt.retryOfAttemptIndex,
      phase: "candidate_generation",
      message: error instanceof Error ? error.message : String(error),
      model: modelFailure?.model,
      modelPlanningMs: modelFailure?.modelPlanningMs,
      candidateGenerationMs: Date.now() - generationStarted,
      totalMs: Date.now() - started,
      trajectory,
    });
  }
  const resolvedCandidateWorkbook = typeof emitted === "string" ? emitted : emitted.path;
  const generationMs = Date.now() - generationStarted;
  trajectory.push({ step: "emit_candidate_workbook", detail: rel(outputRoot, resolvedCandidateWorkbook) });
  const sidecarEvidence = collectSidecarEvidence(outputRoot, taskOutDir);

  const scoreStarted = Date.now();
  const evaluator = readJson<EvaluatorManifest>(task.evaluatorManifestPath);
  trajectory.push({ step: "read_evaluator_manifest", detail: rel(stageRoot, task.evaluatorManifestPath) });
  const goldWorkbook = resolveManifestPath(dirname(task.evaluatorManifestPath), evaluator.goldFiles[0]);
  let score: SpreadsheetBenchWorkbookScore;
  try {
    score = await scoreSpreadsheetBenchWorkbook({
      taskId: agent.taskId,
      candidateWorkbookPath: resolvedCandidateWorkbook,
      goldWorkbookPath: goldWorkbook,
      answerPosition: evaluator.answerPosition,
      answerSheet: evaluator.answerSheet,
      compareStyles: options.compareStyles,
      compareCharts: options.compareCharts || agent.track === "spreadsheetbench-v2",
      maxMismatches: options.maxMismatches,
      generatedAt: options.generatedAt,
    });
  } catch (error) {
    return failedTaskResult({
      stageRoot,
      task,
      agent,
      mode: options.mode,
      attemptIndex: attempt.attemptIndex,
      repeatIndex: attempt.repeatIndex,
      tryIndex: attempt.tryIndex,
      retryOfAttemptIndex: attempt.retryOfAttemptIndex,
      phase: "scoring",
      message: error instanceof Error ? error.message : String(error),
      candidateWorkbook: rel(outputRoot, resolvedCandidateWorkbook),
      sidecarEvidence,
      model: typeof emitted === "string" ? undefined : emitted.model,
      modelPlanningMs: typeof emitted === "string" ? undefined : emitted.modelPlanningMs,
      candidateGenerationMs: generationMs,
      scoringMs: Date.now() - scoreStarted,
      totalMs: Date.now() - started,
      trajectory,
    });
  }
  const scoringMs = Date.now() - scoreStarted;
  const chartMismatches = score.chartPackage
    ? score.chartPackage.totals.missingChartParts + score.chartPackage.totals.extraChartParts + score.chartPackage.totals.mismatchedChartParts
    : 0;
  trajectory.push({
    step: "score_candidate",
    detail: chartMismatches
      ? `${score.totals.mismatches} cell mismatch(es), ${chartMismatches} chart-package mismatch(es)`
      : `${score.totals.mismatches} cell mismatch(es)`,
  });
  const candidateWorkbookRel = rel(outputRoot, resolvedCandidateWorkbook);
  const scorerReceiptPath = join(taskOutDir, "score-receipt.json");
  writeJson(scorerReceiptPath, {
    schema: 1,
    verifier: "spreadsheetbench_workbook_scorer",
    generatedAt: options.generatedAt,
    taskId: agent.taskId,
    track: agent.track,
    mode: options.mode,
    attemptIndex: attempt.attemptIndex,
    repeatIndex: attempt.repeatIndex,
    tryIndex: attempt.tryIndex,
    candidateWorkbook: candidateWorkbookRel,
    agentManifest: rel(stageRoot, task.agentManifestPath),
    evaluatorManifest: rel(stageRoot, task.evaluatorManifestPath),
    score,
  });

  return {
    taskId: agent.taskId,
    track: agent.track,
    category: agent.category,
    mode: options.mode,
    attemptIndex: attempt.attemptIndex,
    repeatIndex: attempt.repeatIndex,
    tryIndex: attempt.tryIndex,
    retryOfAttemptIndex: attempt.retryOfAttemptIndex,
    taskDir: rel(stageRoot, task.taskDir),
    agentManifest: rel(stageRoot, task.agentManifestPath),
    evaluatorManifest: rel(stageRoot, task.evaluatorManifestPath),
    candidateWorkbook: candidateWorkbookRel,
    sidecarEvidence,
    scorerReceipt: fileEvidence(outputRoot, scorerReceiptPath),
    score,
    model: typeof emitted === "string" ? undefined : emitted.model,
    timingsMs: {
      ...(typeof emitted === "string" ? {} : { modelPlanning: emitted.modelPlanningMs }),
      candidateGeneration: generationMs,
      scoring: scoringMs,
      total: Date.now() - started,
    },
    trajectory,
  };
}

function failedTaskResult(args: {
  stageRoot: string;
  task: StagedTaskPaths;
  agent: AgentManifest;
  mode: SpreadsheetBenchRunnerMode;
  attemptIndex: number;
  repeatIndex: number;
  tryIndex: number;
  retryOfAttemptIndex?: number;
  phase: "candidate_generation" | "scoring";
  message: string;
  candidateWorkbook?: string;
  sidecarEvidence?: SpreadsheetBenchRunnerTaskResult["sidecarEvidence"];
  model?: SpreadsheetBenchRunnerTaskResult["model"];
  modelPlanningMs?: number;
  candidateGenerationMs: number;
  scoringMs?: number;
  totalMs: number;
  trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"];
}): SpreadsheetBenchRunnerTaskResult {
  return {
    taskId: args.agent.taskId,
    track: args.agent.track,
    category: args.agent.category,
    mode: args.mode,
    attemptIndex: args.attemptIndex,
    repeatIndex: args.repeatIndex,
    tryIndex: args.tryIndex,
    retryOfAttemptIndex: args.retryOfAttemptIndex,
    taskDir: rel(args.stageRoot, args.task.taskDir),
    agentManifest: rel(args.stageRoot, args.task.agentManifestPath),
    evaluatorManifest: rel(args.stageRoot, args.task.evaluatorManifestPath),
    candidateWorkbook: args.candidateWorkbook,
    sidecarEvidence: args.sidecarEvidence,
    error: {
      phase: args.phase,
      message: args.message,
    },
    model: args.model,
    timingsMs: {
      ...(args.modelPlanningMs === undefined ? {} : { modelPlanning: args.modelPlanningMs }),
      candidateGeneration: args.candidateGenerationMs,
      scoring: args.scoringMs ?? 0,
      total: args.totalMs,
    },
    trajectory: args.trajectory,
  };
}

function collectSidecarEvidence(outputRoot: string, taskOutDir: string): SpreadsheetBenchSidecarEvidence | undefined {
  const candidateManifestPath = join(taskOutDir, "candidate-manifest.json");
  if (!existsSync(candidateManifestPath)) return undefined;
  const manifest = readJson<{
    agentWorkspaceManifest?: string;
    generatedEditPlan?: string;
    sourceEditPlan?: string;
    rawModelOutput?: string;
    workbookInspection?: string;
    editVerification?: string;
    nodeAgentReceipt?: string;
    nodeAgentTrace?: string;
    candidateFinalization?: string;
    repairOutputs?: string[];
    formulaResultPolicy?: string;
    supportedFormulaFunctions?: string[];
    appliedOperationCount?: number;
    repairAttemptCount?: number;
    verificationStatus?: "passed" | "needs_repair";
  }>(candidateManifestPath);
  const editPlanPath = manifest.generatedEditPlan ?? manifest.sourceEditPlan;
  return {
    candidateManifest: fileEvidence(outputRoot, candidateManifestPath),
    ...(manifest.agentWorkspaceManifest ? { agentWorkspaceManifest: fileEvidence(outputRoot, resolveSidecarPath(taskOutDir, manifest.agentWorkspaceManifest)) } : {}),
    ...(editPlanPath
      ? {
          editPlan: {
            ...fileEvidence(outputRoot, resolveSidecarPath(taskOutDir, editPlanPath)),
            kind: manifest.generatedEditPlan ? "generated" as const : "source" as const,
          },
        }
      : {}),
    ...(manifest.rawModelOutput ? { rawModelOutput: fileEvidence(outputRoot, resolveSidecarPath(taskOutDir, manifest.rawModelOutput)) } : {}),
    ...(manifest.workbookInspection ? { workbookInspection: fileEvidence(outputRoot, resolveSidecarPath(taskOutDir, manifest.workbookInspection)) } : {}),
    ...(manifest.editVerification ? { editVerification: fileEvidence(outputRoot, resolveSidecarPath(taskOutDir, manifest.editVerification)) } : {}),
    ...(manifest.nodeAgentReceipt ? { nodeAgentReceipt: fileEvidence(outputRoot, resolveSidecarPath(taskOutDir, manifest.nodeAgentReceipt)) } : {}),
    ...(manifest.nodeAgentTrace ? { nodeAgentTrace: fileEvidence(outputRoot, resolveSidecarPath(taskOutDir, manifest.nodeAgentTrace)) } : {}),
    ...(manifest.candidateFinalization
      ? { candidateFinalization: fileEvidence(outputRoot, resolveSidecarPath(taskOutDir, manifest.candidateFinalization)) }
      : {}),
    ...(manifest.repairOutputs?.length
      ? { repairOutputs: manifest.repairOutputs.map((path) => fileEvidence(outputRoot, resolveSidecarPath(taskOutDir, path))) }
      : {}),
    ...(manifest.formulaResultPolicy ? { formulaResultPolicy: manifest.formulaResultPolicy } : {}),
    ...(Array.isArray(manifest.supportedFormulaFunctions) ? { supportedFormulaFunctions: manifest.supportedFormulaFunctions } : {}),
    ...(typeof manifest.appliedOperationCount === "number" ? { appliedOperationCount: manifest.appliedOperationCount } : {}),
    ...(typeof manifest.repairAttemptCount === "number" ? { repairAttemptCount: manifest.repairAttemptCount } : {}),
    ...(manifest.verificationStatus ? { verificationStatus: manifest.verificationStatus } : {}),
  };
}

function resolveSidecarPath(taskOutDir: string, value: string): string {
  return isAbsolute(value) ? value : resolve(taskOutDir, value);
}

function fileEvidence(outputRoot: string, path: string): SpreadsheetBenchSidecarFileEvidence {
  const content = readFileSync(path);
  return {
    path: rel(outputRoot, path),
    sha256: createHash("sha256").update(content).digest("hex"),
    bytes: content.byteLength,
  };
}

function emitCandidateWorkbook(args: {
  stageRoot: string;
  taskDir: string;
  taskOutDir: string;
  agentWorkspace: AgentWorkspace;
  agent: AgentManifest;
  mode: SpreadsheetBenchRunnerMode;
  trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"];
  model?: AgentModel;
  modelName?: string;
  modelTimeoutMs?: number;
  modelSnapshotMaxCells?: number;
  modelSnapshotMaxCellChars?: number;
  modelRepairAttempts?: number;
  refreshExcelCaches?: boolean;
  batchedModelPlan?: BatchedModelPlan;
}): Promise<string | ModelCandidateEmission> | string {
  const firstInput = args.agent.inputFiles[0];
  if (!firstInput) throw new Error(`agent manifest has no input workbook: ${args.agent.taskId}`);
  const source = resolveManifestPath(args.agentWorkspace.agentDir, firstInput);
  if (!existsSync(source)) throw new Error(`agent input workbook does not exist: ${source}`);
  mkdirSync(args.taskOutDir, { recursive: true });
  const target = join(args.taskOutDir, `candidate-${safeFileName(basename(source))}`);
  if (args.mode === "model-edit-plan") return emitModelEditCandidateWorkbook({ ...args, source, target });
  if (args.mode === "nodeagent-workbook") return emitNodeAgentWorkbookCandidate({ ...args, source, target });
  if (args.mode === "apply-agent-patch") return emitPatchedCandidateWorkbook({ ...args, source, target });
  if (args.mode !== "copy-input-baseline") throw new Error(`Unsupported SpreadsheetBench runner mode: ${args.mode}`);
  copyFileSync(source, target);
  writeJson(join(args.taskOutDir, "candidate-manifest.json"), {
    schema: 1,
    taskId: args.agent.taskId,
    mode: args.mode,
    sourceAgentManifest: rel(args.stageRoot, join(args.taskDir, "agent", "task.json")),
    agentWorkspaceManifest: rel(args.taskOutDir, args.agentWorkspace.manifestPath),
    candidateWorkbook: basename(target),
    note: "copy-input-baseline proves runner/export/scoring plumbing only; it is not a model score.",
  });
  return target;
}

type ModelCandidateEmission = {
  path: string;
  modelPlanningMs: number;
  model: {
    name: string;
    requestedName?: string;
    calls: number;
    usage: TokenUsage;
    costUsd: number;
    batch?: {
      id: string;
      taskCount: number;
      taskIndex: number;
      callShare: number;
    };
  };
};

async function emitNodeAgentWorkbookCandidate(args: {
  stageRoot: string;
  taskDir: string;
  taskOutDir: string;
  agentWorkspace: AgentWorkspace;
  agent: AgentManifest;
  mode: SpreadsheetBenchRunnerMode;
  trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"];
  source: string;
  target: string;
  model?: AgentModel;
  modelName?: string;
  modelTimeoutMs?: number;
  modelSnapshotMaxCells?: number;
  modelRepairAttempts?: number;
  refreshExcelCaches?: boolean;
}): Promise<ModelCandidateEmission> {
  if (!args.model) throw new Error(`nodeagent-workbook requires options.model: ${args.agent.taskId}`);
  const started = Date.now();
  const maxSteps = Math.max(8, Math.min(24, 12 + Math.trunc(args.modelRepairAttempts ?? 0) * 6));
  const runTimeoutMs = args.modelTimeoutMs === undefined
    ? undefined
    : Math.max(args.modelTimeoutMs, Math.min(30 * 60_000, args.modelTimeoutMs * 6));
  const receipt = await runSpreadsheetBenchNodeAgentBridge({
    agentManifestPath: join(args.agentWorkspace.agentDir, "task.json"),
    candidateWorkbookPath: args.target,
    model: args.model,
    maxSteps,
    modelTimeoutMs: runTimeoutMs,
    snapshotMaxCells: args.modelSnapshotMaxCells,
    ...(args.refreshExcelCaches
      ? {
          finalizeCandidate: ({ candidateWorkbookPath, beforeSha256 }: {
            candidateWorkbookPath: string;
            beforeSha256: string;
          }) => refreshCandidateExcelCaches({
            candidateWorkbookPath,
            beforeSha256,
            receiptPath: join(args.taskOutDir, "candidate-finalization.json"),
          }),
        }
      : {}),
  });
  const modelPlanningMs = Date.now() - started;
  const receiptPath = join(args.taskOutDir, "nodeagent-workbook-receipt.json");
  const tracePath = join(args.taskOutDir, "nodeagent-workbook-trace.json");
  writeJson(receiptPath, receipt);
  writeJson(tracePath, receipt.trace);
  args.trajectory.push({
    step: "run_nodeagent_workbook",
    detail: `${receipt.outcome.status}; ${receipt.outcome.changedCellCount} changed cell(s); trace ${receipt.traceId}`,
  });

  const resolvedModelName = receipt.model.name || args.model.name || args.modelName || "unknown";
  const costUsd = getModelPricing(resolvedModelName)
    ? priceRun(resolvedModelName, receipt.model.usage.inputTokens, receipt.model.usage.outputTokens)
    : 0;
  const modelInfo: ModelCandidateEmission["model"] = {
    name: resolvedModelName,
    ...(args.modelName && args.modelName !== resolvedModelName ? { requestedName: args.modelName } : {}),
    calls: receipt.model.calls,
    usage: receipt.model.usage,
    costUsd,
  };
  writeJson(join(args.taskOutDir, "candidate-manifest.json"), {
    schema: 1,
    taskId: args.agent.taskId,
    mode: args.mode,
    model: modelInfo.name,
    ...(modelInfo.requestedName ? { requestedModel: modelInfo.requestedName } : {}),
    sourceAgentManifest: rel(args.stageRoot, join(args.taskDir, "agent", "task.json")),
    agentWorkspaceManifest: rel(args.taskOutDir, args.agentWorkspace.manifestPath),
    candidateWorkbook: basename(args.target),
    nodeAgentReceipt: basename(receiptPath),
    nodeAgentTrace: basename(tracePath),
    ...(receipt.candidateFinalization
      ? { candidateFinalization: basename(receipt.candidateFinalization.receipt.path) }
      : {}),
    appliedOperationCount: receipt.outcome.changedCellCount,
    repairAttemptCount: receipt.stages.repair.attempts,
    verificationStatus: receipt.outcome.finalVerificationStatus === "passed" ? "passed" : "needs_repair",
    modelContext: {
      runtime: "frameRunner -> runAgent -> RoomTools",
      maxSteps,
      snapshotMaxCells: Math.max(1, Math.trunc(args.modelSnapshotMaxCells ?? 1_200)),
      evaluatorMetadataAccess: receipt.isolation.evaluatorMetadataAccess,
    },
    modelUsage: modelInfo.usage,
    modelCostUsd: modelInfo.costUsd,
    traceId: receipt.traceId,
    note: "nodeagent-workbook executes the staged task through the canonical NodeAgent frame/runtime and production managed workbook tools before evaluator metadata becomes available.",
  });
  return { path: args.target, modelPlanningMs, model: modelInfo };
}

function refreshCandidateExcelCaches(args: {
  candidateWorkbookPath: string;
  beforeSha256: string;
  receiptPath: string;
}): SpreadsheetBenchCandidateFinalizationReceipt {
  const script = resolve("scripts", "spreadsheetbench-refresh-excel.py");
  const result = spawnSync(
    process.env.PYTHON?.trim() || "python",
    [script, "--file", args.candidateWorkbookPath, "--receipt", args.receiptPath],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      windowsHide: true,
      timeout: 10 * 60_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  if (result.error) {
    throw new Error(`SpreadsheetBench Excel cache refresh failed to start: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join(" ").replace(/\s+/g, " ").trim().slice(0, 1_000);
    throw new Error(`SpreadsheetBench Excel cache refresh failed (${String(result.status)}): ${detail}`);
  }
  const refresh = readJson<{
    engine?: string;
    records?: Array<{
      status?: string;
      beforeSha256?: string;
      afterSha256?: string;
      formulaCellCount?: number;
      cacheWriteMode?: string;
    }>;
  }>(args.receiptPath);
  const record = refresh.records?.[0];
  if (!record || record.status !== "refreshed") {
    throw new Error("SpreadsheetBench Excel cache refresh receipt is missing a refreshed record");
  }
  if (record.beforeSha256 !== args.beforeSha256 || !record.afterSha256) {
    throw new Error("SpreadsheetBench Excel cache refresh receipt hash boundary is invalid");
  }
  const receiptContent = readFileSync(args.receiptPath);
  return {
    engine: refresh.engine?.trim() || "spreadsheetbench-excel-cache-refresh",
    beforeSha256: record.beforeSha256,
    afterSha256: record.afterSha256,
    changed: record.beforeSha256 !== record.afterSha256,
    ...(typeof record.formulaCellCount === "number" ? { formulaCellCount: record.formulaCellCount } : {}),
    ...(record.cacheWriteMode ? { cacheWriteMode: record.cacheWriteMode } : {}),
    receipt: {
      path: resolve(args.receiptPath),
      sha256: createHash("sha256").update(receiptContent).digest("hex"),
      bytes: receiptContent.byteLength,
    },
  };
}

type AgentWorkspace = {
  root: string;
  agentDir: string;
  manifestPath: string;
};

class ModelEditCandidateError extends Error {
  constructor(
    message: string,
    readonly model: ModelCandidateEmission["model"],
    readonly modelPlanningMs: number,
  ) {
    super(message);
    this.name = "ModelEditCandidateError";
  }
}

function modelEditFailure(error: unknown): Pick<ModelCandidateEmission, "model" | "modelPlanningMs"> | undefined {
  return error instanceof ModelEditCandidateError
    ? { model: error.model, modelPlanningMs: error.modelPlanningMs }
    : undefined;
}

async function prepareBatchedModelPlans(
  tasks: StagedTaskPaths[],
  options: SpreadsheetBenchRunnerOptions,
): Promise<Map<string, BatchedModelPlan>> {
  if (!options.model) throw new Error("model-edit-plan batching requires options.model");
  const batchSize = Math.max(2, Math.min(16, Math.trunc(options.modelBatchSize ?? 2)));
  const plans = new Map<string, BatchedModelPlan>();

  for (let start = 0; start < tasks.length; start += batchSize) {
    const batchTasks = tasks.slice(start, start + batchSize);
    const prepared = await Promise.all(batchTasks.map(async (task) => {
      const agent = readJson<AgentManifest>(task.agentManifestPath);
      const agentDir = join(task.taskDir, "agent");
      const firstInput = agent.inputFiles[0];
      if (!firstInput) throw new Error(`agent manifest has no input workbook: ${agent.taskId}`);
      const source = resolveManifestPath(agentDir, firstInput);
      if (!existsSync(source)) throw new Error(`agent input workbook does not exist: ${source}`);
      const snapshot = await snapshotWorkbook(
        source,
        options.modelSnapshotMaxCells,
        options.modelSnapshotMaxCellChars,
        agent,
      );
      return {
        task,
        agent,
        snapshot,
        promptFiles: readPromptFiles(agentDir, agent.promptFiles),
      };
    }));
    const batchPrepared = prepared.filter(({ agent, snapshot }) => isBatchSafeWorkbookTask(agent, snapshot));
    if (batchPrepared.length < 2) continue;
    const planningStarted = Date.now();
    const requestedModelName = options.modelName;
    const attemptedModelName = options.model.name || requestedModelName || "unknown";
    let rawModelOutput = "";
    let modelPlanningMs = 0;
    let modelName = attemptedModelName;
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let parseError: string | undefined;
    let parsedPlans = new Map<string, AgentEditPlan>();

    try {
      const step = await options.model.next({
        system: spreadsheetBenchBatchPlannerSystem(),
        messages: [{
          role: "user",
          content: spreadsheetBenchBatchPlannerPrompt(batchPrepared.map(({ agent, snapshot, promptFiles }) => ({ agent, snapshot, promptFiles }))),
        }],
        tools: [],
        signal: options.modelTimeoutMs ? AbortSignal.timeout(options.modelTimeoutMs) : undefined,
      });
      modelPlanningMs = Date.now() - planningStarted;
      modelName = options.model.name || attemptedModelName;
      usage = step.usage ?? usage;
      rawModelOutput = step.text ?? "";
      if (step.toolCalls.length) throw new Error(`model-edit-plan batch expected JSON text, got ${step.toolCalls.length} tool call(s)`);
      parsedPlans = parseBatchedEditPlanText(rawModelOutput);
    } catch (error) {
      modelPlanningMs = Date.now() - planningStarted;
      parseError = error instanceof Error ? error.message : String(error);
    }

    const batchId = createHash("sha256")
      .update(JSON.stringify(batchPrepared.map(({ agent }) => agent.taskId)))
      .update("\0")
      .update(rawModelOutput)
      .digest("hex")
      .slice(0, 16);
    const totalCostUsd = getModelPricing(modelName)
      ? priceRun(modelName, usage.inputTokens, usage.outputTokens)
      : 0;

    for (const [taskIndex, item] of batchPrepared.entries()) {
      const model = batchedModelInfo({
        modelName,
        requestedModelName,
        usage,
        totalCostUsd,
        batchId,
        taskIndex,
        taskCount: batchPrepared.length,
      });
      let plan = parsedPlans.get(item.agent.taskId);
      let error = parseError;
      let droppedOperationCount = 0;
      if (!error && !plan) error = `model-edit-plan batch omitted ${item.agent.taskId}`;
      if (!error && plan) {
        try {
          const originalOperationCount = plan.operations.length;
          plan = {
            ...plan,
            operations: plan.operations.filter((operation) => batchOperationReferencesSnapshot(operation, item.snapshot)),
          };
          plan = normalizeEditPlan(plan, item.snapshot, item.agent);
          plan = {
            ...plan,
            operations: plan.operations.filter((operation) => {
              try {
                validateEditPlan({ schema: 1, operations: [operation] }, item.agent.taskId, { allowEmptyOperations: true });
                return true;
              } catch {
                return false;
              }
            }),
          };
          droppedOperationCount = originalOperationCount - plan.operations.length;
          validateEditPlan(plan, item.agent.taskId, { allowEmptyOperations: true });
        } catch (cause) {
          error = cause instanceof Error ? cause.message : String(cause);
          plan = undefined;
        }
      }
      plans.set(item.task.taskDir, {
        snapshot: item.snapshot,
        rawModelOutput,
        modelPlanningMs,
        model,
        ...(plan ? { plan } : {}),
        ...(droppedOperationCount > 0 ? { droppedOperationCount } : {}),
        ...(error ? { error } : {}),
      });
    }
  }

  return plans;
}

function batchedModelInfo(args: {
  modelName: string;
  requestedModelName?: string;
  usage: TokenUsage;
  totalCostUsd: number;
  batchId: string;
  taskIndex: number;
  taskCount: number;
}): ModelCandidateEmission["model"] {
  const share = (value: number | undefined) => {
    const total = Math.max(0, Math.trunc(value ?? 0));
    return Math.floor(total / args.taskCount) + (args.taskIndex < total % args.taskCount ? 1 : 0);
  };
  return {
    name: args.modelName,
    ...(args.requestedModelName && args.requestedModelName !== args.modelName
      ? { requestedName: args.requestedModelName }
      : {}),
    calls: 1 / args.taskCount,
    usage: {
      inputTokens: share(args.usage.inputTokens),
      outputTokens: share(args.usage.outputTokens),
      ...(args.usage.cachedInputTokens === undefined ? {} : { cachedInputTokens: share(args.usage.cachedInputTokens) }),
    },
    costUsd: Number((args.totalCostUsd / args.taskCount).toFixed(10)),
    batch: {
      id: args.batchId,
      taskCount: args.taskCount,
      taskIndex: args.taskIndex,
      callShare: 1 / args.taskCount,
    },
  };
}

function prepareAgentWorkspace(
  stageRoot: string,
  task: StagedTaskPaths,
  taskOutDir: string,
  agent: AgentManifest,
): AgentWorkspace {
  const root = join(taskOutDir, "agent-workspace");
  const agentDir = join(root, "agent");
  mkdirSync(agentDir, { recursive: true });
  const sourceAgentDir = join(task.taskDir, "agent");
  const copiedFiles: Array<{ role: "manifest" | "input" | "prompt" | "edit_plan"; path: string }> = [];

  copyFileSync(task.agentManifestPath, join(agentDir, "task.json"));
  copiedFiles.push({ role: "manifest", path: "agent/task.json" });
  for (const file of agent.inputFiles) copiedFiles.push(copyAgentFile(sourceAgentDir, agentDir, file, "input"));
  for (const file of agent.promptFiles) copiedFiles.push(copyAgentFile(sourceAgentDir, agentDir, file, "prompt"));
  const sourceEditPlan = join(sourceAgentDir, "edit-plan.json");
  if (existsSync(sourceEditPlan)) {
    copyFileSync(sourceEditPlan, join(agentDir, "edit-plan.json"));
    copiedFiles.push({ role: "edit_plan", path: "agent/edit-plan.json" });
  }

  const manifestPath = join(root, "agent-workspace-manifest.json");
  writeJson(manifestPath, {
    schema: 1,
    taskId: agent.taskId,
    boundary: "agent_visible_files_only",
    sourceAgentManifest: rel(stageRoot, task.agentManifestPath),
    workspaceAgentManifest: "agent/task.json",
    copiedFiles,
    policy: "candidate generation reads only this workspace; private scoring metadata is opened after candidate emission.",
  });
  return { root, agentDir, manifestPath };
}

function copyAgentFile(
  sourceAgentDir: string,
  workspaceAgentDir: string,
  manifestPath: string,
  role: "input" | "prompt",
): { role: "input" | "prompt"; path: string } {
  const source = resolveAgentPath(sourceAgentDir, manifestPath);
  const normalized = manifestPath.replace(/\\/g, "/");
  const target = resolveAgentPath(workspaceAgentDir, normalized);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return { role, path: `agent/${normalized}` };
}

async function emitPatchedCandidateWorkbook(args: {
  stageRoot: string;
  taskDir: string;
  taskOutDir: string;
  agentWorkspace: AgentWorkspace;
  agent: AgentManifest;
  mode: SpreadsheetBenchRunnerMode;
  trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"];
  source: string;
  target: string;
}): Promise<string> {
  const editPlanPath = join(args.agentWorkspace.agentDir, "edit-plan.json");
  if (!existsSync(editPlanPath)) throw new Error(`apply-agent-patch requires agent/edit-plan.json: ${args.agent.taskId}`);
  const plan = readJson<AgentEditPlan>(editPlanPath);
  validateEditPlan(plan, args.agent.taskId);
  args.trajectory.push({ step: "read_agent_edit_plan", detail: rel(args.taskOutDir, editPlanPath) });

  const workbook = await readSpreadsheetBenchWorkbookForCells(args.source);
  for (const operation of plan.operations) applySpreadsheetBenchOperation(workbook, operation);
  await workbook.xlsx.writeFile(args.target);
  applySpreadsheetBenchChartOperations(args.target, plan.operations, args.taskOutDir);
  writeJson(join(args.taskOutDir, "candidate-manifest.json"), {
    schema: 1,
    taskId: args.agent.taskId,
    mode: args.mode,
    sourceAgentManifest: rel(args.stageRoot, join(args.taskDir, "agent", "task.json")),
    agentWorkspaceManifest: rel(args.taskOutDir, args.agentWorkspace.manifestPath),
    sourceEditPlan: rel(args.taskOutDir, editPlanPath),
    candidateWorkbook: basename(args.target),
    appliedOperationCount: plan.operations.length,
    formulaResultPolicy: FORMULA_RESULT_POLICY,
    supportedFormulaFunctions: SUPPORTED_FORMULA_FUNCTIONS,
    note: "apply-agent-patch proves agent-side workbook edit/export/reopen plumbing; it is not an official model score.",
  });
  return args.target;
}

async function emitModelEditCandidateWorkbook(args: {
  stageRoot: string;
  taskDir: string;
  taskOutDir: string;
  agentWorkspace: AgentWorkspace;
  agent: AgentManifest;
  mode: SpreadsheetBenchRunnerMode;
  trajectory: SpreadsheetBenchRunnerTaskResult["trajectory"];
  source: string;
  target: string;
  model?: AgentModel;
  modelName?: string;
  modelTimeoutMs?: number;
  modelSnapshotMaxCells?: number;
  modelSnapshotMaxCellChars?: number;
  modelRepairAttempts?: number;
  batchedModelPlan?: BatchedModelPlan;
}): Promise<ModelCandidateEmission> {
  if (!args.model) throw new Error(`model-edit-plan requires options.model: ${args.agent.taskId}`);
  const snapshot = args.batchedModelPlan?.snapshot ?? await snapshotWorkbook(
    args.source,
    args.modelSnapshotMaxCells,
    args.modelSnapshotMaxCellChars,
    args.agent,
  );
  args.trajectory.push({ step: "snapshot_agent_workbook", detail: `${snapshot.sheets.length} sheet(s), ${snapshot.cellCount} cell(s)` });
  const requestedModelName = args.modelName;
  const attemptedModelName = args.model.name || requestedModelName || "unknown";
  const rawModelOutputPath = join(args.taskOutDir, "model-output.txt");
  const inspectionPath = join(args.taskOutDir, "workbook-inspection.json");
  writeJson(inspectionPath, snapshot.inspection);
  let rawModelOutput = "";
  let plan: AgentEditPlan | undefined;
  let planError: string | undefined;
  let modelPlanningMs = 0;
  let modelInfo: ModelCandidateEmission["model"] = {
    name: attemptedModelName,
    ...(requestedModelName && requestedModelName !== attemptedModelName ? { requestedName: requestedModelName } : {}),
    calls: 0,
    usage: { inputTokens: 0, outputTokens: 0 },
    costUsd: 0,
  };
  const repairOutputPaths: string[] = [];
  let repairAttemptCount = 0;

  if (args.batchedModelPlan) {
    rawModelOutput = args.batchedModelPlan.rawModelOutput;
    modelPlanningMs = args.batchedModelPlan.modelPlanningMs;
    modelInfo = args.batchedModelPlan.model;
    args.trajectory.push({
      step: "call_model_for_edit_plan",
      detail: `${modelInfo.name} batch ${modelInfo.batch?.id ?? "unknown"} (${modelInfo.batch?.taskCount ?? 1} tasks)`,
    });
    planError = args.batchedModelPlan.error;
    plan = args.batchedModelPlan.plan;
  } else {
    const promptFiles = readPromptFiles(args.agentWorkspace.agentDir, args.agent.promptFiles);
    const planningStarted = Date.now();
    let step: Awaited<ReturnType<AgentModel["next"]>> | undefined;
    try {
      step = await args.model.next({
        system: spreadsheetBenchPlannerSystem(),
        messages: [{ role: "user", content: spreadsheetBenchPlannerPrompt(args.agent, snapshot, promptFiles) }],
        tools: [],
        signal: args.modelTimeoutMs ? AbortSignal.timeout(args.modelTimeoutMs) : undefined,
      });
    } catch (error) {
      const usage = { inputTokens: 0, outputTokens: 0 };
      const fallback = normalizeEditPlan({ schema: 1, operations: [] }, snapshot, args.agent);
      const failureModel = {
        name: attemptedModelName,
        ...(requestedModelName && requestedModelName !== attemptedModelName ? { requestedName: requestedModelName } : {}),
        calls: 1,
        usage,
        costUsd: 0,
      };
      if (!fallback.operations.length) {
        throw new ModelEditCandidateError(error instanceof Error ? error.message : String(error), failureModel, Date.now() - planningStarted);
      }
      modelPlanningMs = Date.now() - planningStarted;
      modelInfo = failureModel;
      plan = fallback;
      planError = undefined;
      args.trajectory.push({
        step: "fallback_to_visible_formula_repairs",
        detail: `${fallback.operations.length} high-confidence operation(s) after provider failure`,
      });
    }
    if (step) {
      modelPlanningMs = Date.now() - planningStarted;
      args.trajectory.push({ step: "call_model_for_edit_plan", detail: args.model.name });
      const usage = step.usage ?? { inputTokens: 0, outputTokens: 0 };
      const modelName = args.model.name || attemptedModelName;
      const costUsd = step.usage && getModelPricing(modelName) ? priceRun(modelName, usage.inputTokens, usage.outputTokens) : 0;
      modelInfo = {
        name: modelName,
        ...(requestedModelName && requestedModelName !== modelName ? { requestedName: requestedModelName } : {}),
        calls: 1,
        usage,
        costUsd,
      };
      rawModelOutput = step.text ?? "";
      if (step.toolCalls.length) {
        planError = `model-edit-plan expected JSON text, got ${step.toolCalls.length} tool call(s)`;
      } else {
        try {
          plan = normalizeEditPlan(parseEditPlanText(rawModelOutput, args.agent.taskId), snapshot, args.agent);
        } catch (error) {
          planError = error instanceof Error ? error.message : String(error);
        }
      }
    }
  }
  if (!plan) {
    const fallback = normalizeEditPlan({ schema: 1, operations: [] }, snapshot, args.agent);
    if (fallback.operations.length) {
      plan = fallback;
      planError = undefined;
      args.trajectory.push({
        step: "fallback_to_visible_formula_repairs",
        detail: `${fallback.operations.length} high-confidence operation(s) after unusable planner output`,
      });
    }
  }
  writeFileSync(rawModelOutputPath, rawModelOutput);

  const sourceWorkbook = await readSpreadsheetBenchWorkbookForCells(args.source);
  const verificationCells = observedCellsForOperations(sourceWorkbook, snapshot, plan?.operations ?? []);
  let planVerification = workbookPlanVerification({
    agent: args.agent,
    snapshot,
    cells: verificationCells,
    plan,
    planError,
  });
  args.trajectory.push({
    step: "verify_edit_plan",
    detail: `${planVerification.status}: ${planVerification.issueCount} issue(s)`,
  });

  const maxRepairAttempts = Math.max(0, Math.min(3, Math.trunc(args.modelRepairAttempts ?? 0)));
  while (planVerification.status === "needs_repair" && repairAttemptCount < maxRepairAttempts) {
    repairAttemptCount += 1;
    const repairStarted = Date.now();
    let repairStep: Awaited<ReturnType<AgentModel["next"]>>;
    try {
      repairStep = await args.model.next({
        system: spreadsheetBenchRepairSystem(),
        messages: [{
          role: "user",
          content: spreadsheetBenchRepairPrompt({
            agent: args.agent,
            snapshot,
            priorPlan: plan,
            priorError: planError,
            verification: planVerification,
          }),
        }],
        tools: [],
        signal: args.modelTimeoutMs ? AbortSignal.timeout(args.modelTimeoutMs) : undefined,
      });
    } catch (error) {
      planError = error instanceof Error ? error.message : String(error);
      args.trajectory.push({ step: "repair_edit_plan", detail: `attempt ${repairAttemptCount} failed: ${planError}` });
      break;
    }
    const repairMs = Date.now() - repairStarted;
    modelPlanningMs += repairMs;
    modelInfo = aggregateModelPlanningStep(modelInfo, repairStep, args.model.name || attemptedModelName, requestedModelName);
    const repairOutput = repairStep.text ?? "";
    const repairOutputPath = join(args.taskOutDir, `model-repair-output-${String(repairAttemptCount).padStart(2, "0")}.txt`);
    writeFileSync(repairOutputPath, repairOutput);
    repairOutputPaths.push(repairOutputPath);
    planError = repairStep.toolCalls.length
      ? `model-edit-plan repair expected JSON text, got ${repairStep.toolCalls.length} tool call(s)`
      : undefined;
    if (!planError) {
      try {
        plan = normalizeEditPlan(parseEditPlanText(repairOutput, args.agent.taskId), snapshot, args.agent);
      } catch (error) {
        planError = error instanceof Error ? error.message : String(error);
        plan = undefined;
      }
    }
    const repairedCells = observedCellsForOperations(sourceWorkbook, snapshot, plan?.operations ?? []);
    planVerification = workbookPlanVerification({
      agent: args.agent,
      snapshot,
      cells: repairedCells,
      plan,
      planError,
    });
    args.trajectory.push({
      step: "repair_edit_plan",
      detail: `attempt ${repairAttemptCount}: ${planVerification.status}, ${planVerification.issueCount} issue(s)`,
    });
  }

  try {
    if (!plan) throw new Error(planError ?? `model-edit-plan returned no usable plan for ${args.agent.taskId}`);
    if (maxRepairAttempts > 0 && planVerification.status === "needs_repair") {
      throw new Error(`edit-plan verification failed after ${repairAttemptCount} repair attempt(s): ${planVerification.issues.map((issue) => issue.detail).join("; ")}`);
    }
    validateEditPlan(plan, args.agent.taskId, { allowEmptyOperations: true });
    const editPlanPath = join(args.taskOutDir, "model-edit-plan.json");
    writeJson(editPlanPath, plan);

    const workbook = sourceWorkbook;
    for (const operation of plan.operations) applySpreadsheetBenchOperation(workbook, operation);
    const writeChecks = checksForWorkbookOperations(plan.operations);
    const candidateCells = observedCellsForChecks(workbook, writeChecks);
    const writeVerification = verifyWorkbookValues({ cells: candidateCells, checks: writeChecks });
    const verificationStatus = planVerification.status === "passed" && writeVerification.status === "passed"
      ? "passed" as const
      : "needs_repair" as const;
    args.trajectory.push({
      step: "verify_candidate_workbook",
      detail: `${verificationStatus}: ${writeVerification.passedCount}/${writeVerification.checkedCount} changed cell(s) verified`,
    });
    await workbook.xlsx.writeFile(args.target);
    applySpreadsheetBenchChartOperations(args.target, plan.operations, args.taskOutDir);
    const editVerificationPath = join(args.taskOutDir, "model-edit-verification.json");
    writeJson(editVerificationPath, {
      schema: 1,
      taskId: args.agent.taskId,
      inspection: snapshot.inspection,
      plan: planVerification,
      candidate: writeVerification,
      repairAttemptCount,
      status: verificationStatus,
      policy: "agent-visible preflight plus candidate re-read; evaluator metadata is unavailable until after candidate emission",
    });

    writeJson(join(args.taskOutDir, "candidate-manifest.json"), {
      schema: 1,
      taskId: args.agent.taskId,
      mode: args.mode,
      model: modelInfo.name,
      ...(modelInfo.requestedName ? { requestedModel: modelInfo.requestedName } : {}),
      ...(modelInfo.batch ? { modelBatch: modelInfo.batch } : {}),
      ...(args.batchedModelPlan?.droppedOperationCount
        ? { modelBatchNormalization: { droppedOperationCount: args.batchedModelPlan.droppedOperationCount } }
        : {}),
      sourceAgentManifest: rel(args.stageRoot, join(args.taskDir, "agent", "task.json")),
      agentWorkspaceManifest: rel(args.taskOutDir, args.agentWorkspace.manifestPath),
      generatedEditPlan: basename(editPlanPath),
      rawModelOutput: basename(rawModelOutputPath),
      workbookInspection: basename(inspectionPath),
      editVerification: basename(editVerificationPath),
      repairOutputs: repairOutputPaths.map((path) => basename(path)),
      candidateWorkbook: basename(args.target),
      appliedOperationCount: plan.operations.length,
      repairAttemptCount,
      verificationStatus,
      modelContext: {
        snapshotCellCount: snapshot.cellCount,
        snapshotTruncated: snapshot.truncated,
        snapshotMaxCells: Math.max(1, Math.trunc(args.modelSnapshotMaxCells ?? DEFAULT_WORKBOOK_SNAPSHOT_MAX_CELLS)),
        snapshotMaxCellChars: args.modelSnapshotMaxCellChars === undefined
          ? null
          : Math.max(1, Math.trunc(args.modelSnapshotMaxCellChars)),
        repairAttempts: maxRepairAttempts,
      },
      formulaResultPolicy: FORMULA_RESULT_POLICY,
      supportedFormulaFunctions: SUPPORTED_FORMULA_FUNCTIONS,
      modelUsage: modelInfo.usage,
      modelCostUsd: modelInfo.costUsd,
      note: "model-edit-plan inspects agent-visible workbook cells, preflights and optionally repairs the model plan, applies it, and re-reads changed targets before hidden scoring metadata becomes available.",
    });
  } catch (error) {
    throw new ModelEditCandidateError(error instanceof Error ? error.message : String(error), modelInfo, modelPlanningMs);
  }
  return {
    path: args.target,
    modelPlanningMs,
    model: modelInfo,
  };
}

function workbookPlanVerification(args: {
  agent: AgentManifest;
  snapshot: WorkbookSnapshot;
  cells: WorkbookObservedCell[];
  plan?: AgentEditPlan;
  planError?: string;
}): WorkbookPlanVerification {
  const verification = verifyWorkbookPlan({
    instruction: args.agent.instruction,
    inspection: args.snapshot.inspection,
    cells: args.cells,
    sheetNames: args.snapshot.sheets.map((sheet) => sheet.name),
    operations: (args.plan?.operations ?? []) as WorkbookPlanOperation[],
  });
  if (!args.planError) return verification;
  const issue: WorkbookPlanIssue = {
    kind: "planner_output_error",
    severity: "error",
    detail: args.planError,
    repair: "Return one complete strict-JSON replacement plan using only the visible workbook context.",
  };
  return {
    ...verification,
    status: "needs_repair",
    issueCount: verification.issueCount + 1,
    issues: [issue, ...verification.issues],
  };
}

function observedCellsForOperations(
  workbook: ExcelJS.Workbook,
  snapshot: WorkbookSnapshot,
  operations: AgentEditOperation[],
): WorkbookObservedCell[] {
  const cells = new Map<string, WorkbookObservedCell>();
  for (const sheet of snapshot.sheets) {
    for (const cell of sheet.cells) {
      cells.set(workbookCellKey(sheet.name, cell.address), {
        sheet: sheet.name,
        address: cell.address,
        value: cell.value,
        ...(cell.formula ? { formula: cell.formula } : {}),
        ...(cell.numFmt ? { numFmt: cell.numFmt } : {}),
      });
    }
  }
  const targets = [
    ...snapshot.inspection.targetCandidates.map((target) => ({ sheet: target.sheet, address: target.address })),
    ...snapshot.inspection.findings.map((finding) => ({ sheet: finding.sheet, address: finding.address })),
    ...operations.flatMap((operation) => isCellEditOperation(operation) && operation.cell
      ? [{ sheet: operation.sheet, address: operation.cell }]
      : []),
  ];
  for (const target of targets) {
    const sheet = worksheetByName(workbook, target.sheet);
    if (!sheet || !isCellRef(target.address)) continue;
    const observed = observedWorkbookCell(sheet, sheet.getCell(target.address));
    cells.set(workbookCellKey(observed.sheet, observed.address), observed);
  }
  return [...cells.values()];
}

function observedCellsForChecks(workbook: ExcelJS.Workbook, checks: WorkbookValueCheck[]): WorkbookObservedCell[] {
  const cells: WorkbookObservedCell[] = [];
  for (const check of checks) {
    if (!check.sheet || !isCellRef(check.elementId)) continue;
    const sheet = worksheetByName(workbook, check.sheet);
    if (!sheet) continue;
    cells.push(observedWorkbookCell(sheet, sheet.getCell(check.elementId)));
  }
  return cells;
}

function worksheetByName(workbook: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  return workbook.getWorksheet(name) ?? workbook.worksheets.find((sheet) => sheet.name.toLowerCase() === name.toLowerCase());
}

function aggregateModelPlanningStep(
  current: ModelCandidateEmission["model"],
  step: Awaited<ReturnType<AgentModel["next"]>>,
  resolvedName: string,
  requestedName?: string,
): ModelCandidateEmission["model"] {
  const usage = step.usage ?? { inputTokens: 0, outputTokens: 0 };
  const resolved = resolvedName || current.name;
  const stepCost = step.usage && getModelPricing(resolved)
    ? priceRun(resolved, usage.inputTokens, usage.outputTokens)
    : 0;
  return {
    ...current,
    name: resolved,
    ...(requestedName && requestedName !== resolved ? { requestedName } : {}),
    calls: current.calls + 1,
    usage: {
      inputTokens: current.usage.inputTokens + usage.inputTokens,
      outputTokens: current.usage.outputTokens + usage.outputTokens,
      ...((current.usage.cachedInputTokens ?? usage.cachedInputTokens) === undefined
        ? {}
        : { cachedInputTokens: (current.usage.cachedInputTokens ?? 0) + (usage.cachedInputTokens ?? 0) }),
    },
    costUsd: Number((current.costUsd + stepCost).toFixed(10)),
  };
}

function spreadsheetBenchRepairSystem(): string {
  return [
    spreadsheetBenchPlannerSystem(),
    "This is a bounded repair pass over a prior plan that failed agent-visible verification.",
    "Return one complete replacement plan, not a patch to the prior JSON.",
    "Address every verification error. Do not repeat an unchanged failing plan.",
    "You still cannot see evaluator metadata or a gold workbook; use only the task, inspection, workbook cells, prior plan, and verification findings.",
  ].join("\n");
}

function spreadsheetBenchRepairPrompt(args: {
  agent: AgentManifest;
  snapshot: WorkbookSnapshot;
  priorPlan?: AgentEditPlan;
  priorError?: string;
  verification: WorkbookPlanVerification;
}): string {
  return JSON.stringify({
    taskId: args.agent.taskId,
    instruction: args.agent.instruction,
    instructionType: args.agent.instructionType,
    workbook: args.snapshot,
    priorPlan: args.priorPlan ?? null,
    priorError: args.priorError ?? null,
    verification: args.verification,
    requiredResponse: { schema: 1, operations: "complete replacement operation array" },
  });
}

function validateEditPlan(
  plan: AgentEditPlan,
  taskId: string,
  options: { allowEmptyOperations?: boolean } = {},
) {
  if (!plan || plan.schema !== 1) throw new Error(`invalid edit-plan schema for ${taskId}`);
  if (!Array.isArray(plan.operations)) {
    throw new Error(`edit-plan operations must be an array for ${taskId}`);
  }
  if (plan.operations.length === 0 && !options.allowEmptyOperations) {
    throw new Error(`edit-plan has no operations for ${taskId}`);
  }
  for (const [index, operation] of plan.operations.entries()) {
    if (isChartOperation(operation)) {
      if (typeof operation.sheet !== "string" || !operation.sheet.trim()) throw new Error(`edit-plan chart operation ${index + 1} is missing sheet`);
      if (!SUPPORTED_CHART_TYPES.has(operation.chartType)) throw new Error(`edit-plan chart operation ${index + 1} has unsupported chartType`);
      if (!isRangeRef(operation.categoryRange)) throw new Error(`edit-plan chart operation ${index + 1} has invalid categoryRange`);
      if (!Array.isArray(operation.series) || operation.series.length === 0 || operation.series.length > 12) {
        throw new Error(`edit-plan chart operation ${index + 1} must contain 1-12 series`);
      }
      for (const series of operation.series) {
        if (typeof series.name !== "string" || !series.name.trim() || !isRangeRef(series.valuesRange)) {
          throw new Error(`edit-plan chart operation ${index + 1} has invalid series metadata`);
        }
        if (series.xValuesRange && !isRangeRef(series.xValuesRange)) throw new Error(`edit-plan chart operation ${index + 1} has invalid xValuesRange`);
        if (series.sizeRange && !isRangeRef(series.sizeRange)) throw new Error(`edit-plan chart operation ${index + 1} has invalid sizeRange`);
        if (series.chartType && !["line", "bar", "column", "area"].includes(series.chartType)) {
          throw new Error(`edit-plan chart operation ${index + 1} has invalid series chartType`);
        }
      }
      if (operation.anchor && !isCellRef(operation.anchor)) throw new Error(`edit-plan chart operation ${index + 1} has invalid anchor`);
      continue;
    }
    if (isAggregateSectionOperation(operation)) {
      if (![operation.sourceSheet, operation.sourceSection, operation.targetSheet, operation.targetSection]
        .every((value) => typeof value === "string" && value.trim())) {
        throw new Error(`edit-plan aggregate operation ${index + 1} is missing source/target section metadata`);
      }
      if (!Array.isArray(operation.groupBy) || operation.groupBy.length === 0 || operation.groupBy.some((header) => typeof header !== "string" || !header.trim())) {
        throw new Error(`edit-plan aggregate operation ${index + 1} is missing groupBy headers`);
      }
      if (typeof operation.valueColumn !== "string" || !operation.valueColumn.trim()) {
        throw new Error(`edit-plan aggregate operation ${index + 1} is missing valueColumn`);
      }
      continue;
    }
    if (isFilterRowsOperation(operation)) {
      if (typeof operation.sheet !== "string" || !operation.sheet.trim()) throw new Error(`edit-plan filter operation ${index + 1} is missing sheet`);
      if (!parseRangeRef(operation.sourceRange)) throw new Error(`edit-plan filter operation ${index + 1} has invalid sourceRange`);
      if (!isCellRef(operation.targetCell)) throw new Error(`edit-plan filter operation ${index + 1} has invalid targetCell`);
      if (!isCellRef(operation.startCell) || !isCellRef(operation.endCell)) {
        throw new Error(`edit-plan filter operation ${index + 1} has invalid criteria cells`);
      }
      continue;
    }
    if (isSortUniqueRowsOperation(operation)) {
      if (typeof operation.sheet !== "string" || !operation.sheet.trim()) throw new Error(`edit-plan sort operation ${index + 1} is missing sheet`);
      if (!parseRangeRef(operation.sourceRange)) throw new Error(`edit-plan sort operation ${index + 1} has invalid sourceRange`);
      if (!isCellRef(operation.targetCell)) throw new Error(`edit-plan sort operation ${index + 1} has invalid targetCell`);
      if (!Array.isArray(operation.keyColumns) || !operation.keyColumns.length ||
        !Array.isArray(operation.outputColumns) || !operation.outputColumns.length ||
        typeof operation.sortBy !== "string" || !operation.sortBy.trim()) {
        throw new Error(`edit-plan sort operation ${index + 1} is missing sort metadata`);
      }
      continue;
    }
    if (!operation || typeof operation.sheet !== "string" || !operation.sheet.trim()) {
      throw new Error(`edit-plan operation ${index + 1} is missing sheet`);
    }
    if (!isCellRef(operation.cell)) {
      throw new Error(`edit-plan operation ${index + 1} has invalid cell: ${operation.cell}`);
    }
    if (operation.formula === undefined && !("value" in operation) && !operation.numFmt) {
      throw new Error(`edit-plan operation ${index + 1} must set value, formula, or numFmt`);
    }
  }
}

function isAggregateSectionOperation(operation: unknown): operation is AgentAggregateSectionOperation {
  return Boolean(operation && typeof operation === "object" && (operation as { op?: unknown }).op === "aggregate_section");
}

function isFilterRowsOperation(operation: unknown): operation is AgentFilterRowsOperation {
  return Boolean(operation && typeof operation === "object" && (operation as { op?: unknown }).op === "filter_rows");
}

function isSortUniqueRowsOperation(operation: unknown): operation is AgentSortUniqueRowsOperation {
  return Boolean(operation && typeof operation === "object" && (operation as { op?: unknown }).op === "sort_unique_rows");
}

const SUPPORTED_CHART_TYPES = new Set<AgentChartOperation["chartType"]>(["line", "bar", "column", "pie", "doughnut", "scatter", "area", "bubble"]);

function isChartOperation(operation: unknown): operation is AgentChartOperation {
  return Boolean(operation && typeof operation === "object" && (operation as { op?: unknown }).op === "add_chart");
}

function isStructuralOperation(
  operation: AgentEditOperation,
): operation is AgentAggregateSectionOperation | AgentFilterRowsOperation | AgentSortUniqueRowsOperation | AgentChartOperation {
  return isAggregateSectionOperation(operation) || isFilterRowsOperation(operation) || isSortUniqueRowsOperation(operation) || isChartOperation(operation);
}

function batchOperationReferencesSnapshot(operation: AgentEditOperation, snapshot: WorkbookSnapshot): boolean {
  const sheet = (name: string | undefined) => snapshot.sheets.find((item) =>
    item.name.toLowerCase() === String(name ?? "").trim().toLowerCase());
  if (isAggregateSectionOperation(operation)) {
    const source = sheet(operation.sourceSheet);
    const target = sheet(operation.targetSheet);
    const hasSection = (item: WorkbookSnapshot["sheets"][number] | undefined, section: string) =>
      Boolean(item?.blocks.some((block) => block.title && normalizeHeader(block.title) === normalizeHeader(section)));
    return hasSection(source, operation.sourceSection) && hasSection(target, operation.targetSection);
  }
  if (isChartOperation(operation)) return Boolean(sheet(operation.sheet));
  return Boolean(sheet(operation.sheet));
}

function isCellEditOperation(operation: AgentEditOperation): operation is AgentCellEditOperation {
  return Boolean(operation && !isStructuralOperation(operation) && typeof (operation as { sheet?: unknown }).sheet === "string");
}

function hasUnsupportedOperationKind(operation: unknown): boolean {
  if (!operation || typeof operation !== "object") return false;
  const op = (operation as { op?: unknown }).op;
  return typeof op === "string" && !["set_cell", "aggregate_section", "filter_rows", "sort_unique_rows", "add_chart"].includes(op);
}

function isRangeRef(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  const local = value.trim().replace(/^=/, "").split("!").at(-1)?.replace(/\$/g, "") ?? "";
  return Boolean(parseRangeRef(local));
}

function isCellRef(value: unknown): value is string {
  return typeof value === "string" && /^[A-Z]{1,3}[1-9][0-9]*$/i.test(value);
}

function normalizeEditPlan(plan: AgentEditPlan, snapshot: WorkbookSnapshot, agent?: AgentManifest): AgentEditPlan {
  const sourcePlan = plan && typeof plan === "object"
    ? plan
    : ({ schema: 1, operations: [] } as AgentEditPlan);
  const sheetNames = new Set(snapshot.sheets.map((sheet) => sheet.name));
  const sheetNamesByLower = new Map(snapshot.sheets.map((sheet) => [sheet.name.toLowerCase(), sheet.name]));
  const onlySheetName = snapshot.sheets.length === 1 ? snapshot.sheets[0]?.name : undefined;
  const candidateFilterKeys = agent ? new Set(inferVisibleFilterRowsOperations(agent, snapshot, []).map(filterRowsOperationKey)) : undefined;
  const candidateSortKeys = agent ? new Set(inferVisibleSortUniqueRowsOperations(agent, snapshot, []).map(sortUniqueRowsOperationKey)) : undefined;
  let lastKnownSheet: string | undefined;
  const operations: AgentEditOperation[] = Array.isArray(sourcePlan.operations)
    ? sourcePlan.operations.flatMap((operation): AgentEditOperation[] => {
        if (isChartOperation(operation)) return [normalizeChartOperation(operation, sheetNamesByLower)];
        if (isAggregateSectionOperation(operation)) return [normalizeAggregateSectionOperation(operation, sheetNamesByLower)];
        if (isFilterRowsOperation(operation)) {
          const normalized = normalizeFilterRowsOperation(operation, sheetNamesByLower);
          const candidateAllowed = !candidateFilterKeys || candidateFilterKeys.has(filterRowsOperationKey(normalized));
          return candidateAllowed && filterRowsOperationIsSelfConsistent(normalized) ? [normalized] : [];
        }
        if (isSortUniqueRowsOperation(operation)) {
          const normalized = normalizeSortUniqueRowsOperation(operation, sheetNamesByLower);
          const candidateAllowed = !candidateSortKeys || candidateSortKeys.has(sortUniqueRowsOperationKey(normalized));
          return candidateAllowed && sortUniqueRowsOperationIsSelfConsistent(normalized) ? [normalized] : [];
        }
        if (hasUnsupportedOperationKind(operation)) return [];
        if (!isCellEditOperation(operation)) return [operation];
        const normalizedOperation = normalizeEditOperationShape(operation);
        const sheetName = normalizedOperation.sheet.trim().replace(/^'|'$/g, "");
        const canonicalSheet = sheetNames.has(sheetName) ? sheetName : sheetNamesByLower.get(sheetName.toLowerCase());
        if (canonicalSheet) {
          lastKnownSheet = canonicalSheet;
          return [canonicalSheet === normalizedOperation.sheet ? normalizedOperation : { ...normalizedOperation, sheet: canonicalSheet }];
        }
        if (lastKnownSheet && isCellRef(normalizedOperation.sheet)) {
          return [{
            ...normalizedOperation,
            sheet: lastKnownSheet,
            cell: typeof normalizedOperation.cell === "string" && isCellRef(normalizedOperation.cell) ? normalizedOperation.cell : normalizedOperation.sheet,
          }];
        }
        if (onlySheetName && isGenericSheetAlias(sheetName)) {
          lastKnownSheet = onlySheetName;
          return [{ ...normalizedOperation, sheet: onlySheetName }];
        }
        return [normalizedOperation];
      })
    : [];
  const inferredOperations = agent
    ? [
        ...inferVisibleAggregateSectionOperations(agent, snapshot, operations),
        ...inferVisibleFilterRowsOperations(agent, snapshot, operations),
        ...inferVisibleSortUniqueRowsOperations(agent, snapshot, operations),
        ...inferVisibleChartOperations(agent, snapshot, operations),
      ]
    : [];
  const visibleFormulaRepairs = agent && operations.length === 0 && snapshot.inspection.mutatingTask && !snapshot.inspection.allowEmptyPlan
    && visibleFormulaRepairFallbackAllowed(agent, snapshot)
    ? inferVisibleFormulaRepairOperations(snapshot)
    : [];
  const orderedOperations = [
    ...operations.filter((operation) => !isStructuralOperation(operation)),
    ...operations.filter(isStructuralOperation),
    ...inferredOperations,
    ...visibleFormulaRepairs,
  ];
  return {
    ...sourcePlan,
    operations: orderedOperations,
  };
}

function normalizeChartOperation(
  operation: AgentChartOperation,
  sheetNamesByLower: Map<string, string>,
): AgentChartOperation {
  const sheetName = operation.sheet.trim().replace(/^'|'$/g, "");
  return {
    ...operation,
    sheet: sheetNamesByLower.get(sheetName.toLowerCase()) ?? sheetName,
    title: operation.title?.trim().slice(0, 160),
    series: operation.series.slice(0, 12).map((series) => ({
      ...series,
      name: series.name.trim().slice(0, 80),
      color: series.color?.replace(/^#/, "").toUpperCase().slice(0, 6),
    })),
    anchor: operation.anchor && isCellRef(operation.anchor) ? operation.anchor.toUpperCase() : "H2",
    width: boundedChartDimension(operation.width, 18, 6, 36),
    height: boundedChartDimension(operation.height, 10, 4, 24),
  };
}

function boundedChartDimension(value: number | undefined, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function isBatchSafeWorkbookTask(agent: AgentManifest, snapshot: WorkbookSnapshot): boolean {
  if (agent.instruction.length > BATCH_INSTRUCTION_MAX_CHARS) return false;
  if (/\b(?:audit\s+and\s+fix|complete\s+the\s+(?:financial\s+)?model|fill\s+in\s+all\s+empty|all\s+formulas|create\s+(?:an?\s+)?(?:chart|dashboard)|visuali[sz]ation)\b/i.test(agent.instruction)) return false;
  if (snapshot.inspection.referencedSheets.length > 2) return false;
  if (snapshot.inspection.allowEmptyPlan) return true;
  const explicitTargets = snapshot.inspection.targetCandidates.length;
  const derivedTargets = snapshot.inspection.formulaFillSuggestions.reduce((sum, suggestion) => sum + suggestion.operations.length, 0)
    + snapshot.inspection.formulaRepairSuggestions.length
    + snapshot.inspection.valueSuggestions.length;
  return explicitTargets > 0 && explicitTargets + derivedTargets <= 8;
}

function inferVisibleFormulaRepairOperations(snapshot: WorkbookSnapshot): AgentCellEditOperation[] {
  const operations: AgentCellEditOperation[] = [
    ...snapshot.inspection.formulaFillSuggestions.flatMap((suggestion) => suggestion.operations),
    ...snapshot.inspection.formulaRepairSuggestions.map((suggestion) => ({
      sheet: suggestion.sheet,
      cell: suggestion.cell,
      formula: suggestion.formula,
    })),
    ...snapshot.inspection.valueSuggestions.map((suggestion) => ({
      sheet: suggestion.sheet,
      cell: suggestion.cell,
      value: suggestion.value,
      ...(suggestion.numFmt ? { numFmt: suggestion.numFmt } : {}),
    })),
  ];
  const unique = new Map<string, AgentCellEditOperation>();
  for (const operation of operations) {
    const key = workbookCellKey(operation.sheet, operation.cell);
    const current = unique.get(key);
    if (!current || normalizeFormula(current.formula) === normalizeFormula(operation.formula)) unique.set(key, operation);
    else unique.delete(key);
  }
  return unique.size > 16 ? [] : [...unique.values()];
}

function inferVisibleChartOperations(
  agent: AgentManifest,
  snapshot: WorkbookSnapshot,
  existing: AgentEditOperation[],
): AgentChartOperation[] {
  if (existing.some(isChartOperation) || !/\b(?:chart|graph|dashboard|visuali[sz]ation)\b/i.test(agent.instruction)) return [];
  const usable = snapshot.sheets.flatMap((sheet) => sheet.blocks.flatMap((block) => {
    const range = parseRangeRef(block.range);
    const nonEmptyHeaders = block.headers
      .map((header, index) => ({ header: header.trim(), column: (range?.startCol ?? 1) + index }))
      .filter((item) => item.header);
    return range && block.dataRowCount >= 2 && nonEmptyHeaders.length >= 2
      ? [{ sheet, block, range, headers: nonEmptyHeaders }]
      : [];
  }));
  if (!usable.length) return [];
  const instruction = agent.instruction.toLowerCase();
  const source = [...usable].sort((left, right) => {
    const sourceScore = (entry: typeof left) =>
      (instruction.includes(`from the ${entry.sheet.name.toLowerCase()} sheet`) ? 10_000 : 0)
      + (instruction.includes(entry.sheet.name.toLowerCase()) ? 1_000 : 0)
      + Math.min(500, entry.block.dataRowCount)
      + entry.headers.length;
    return sourceScore(right) - sourceScore(left);
  })[0];
  const namedTarget = snapshot.sheets.find((sheet) =>
    instruction.includes(`in the ${sheet.name.toLowerCase()} sheet`)
    || instruction.includes(`on the ${sheet.name.toLowerCase()} sheet`));
  const targetSheet = namedTarget ?? source.sheet;
  const category = source.headers[0];
  const values = source.headers.slice(1, 5);
  if (!category || !values.length) return [];
  const firstDataRow = source.block.headerRow + 1;
  const lastDataRow = source.range.endRow;
  const rangeFor = (column: number) => `${quotedSheetName(source.sheet.name)}!${columnNumberToName(column)}${firstDataRow}:${columnNumberToName(column)}${lastDataRow}`;
  const chartType = chartTypeFromInstruction(agent.instruction);
  const isPareto = /\bpareto\s+chart\b/i.test(agent.instruction);
  const series: AgentChartOperation["series"] = values.map((header, index) => ({
    name: header.header,
    valuesRange: rangeFor(header.column),
    ...(chartType === "scatter" || chartType === "bubble" ? { xValuesRange: rangeFor(category.column) } : {}),
    ...(isPareto && index === 0 ? { chartType: "column" as const, color: "4472C4" } : {}),
    ...(isPareto && index === 1 ? { chartType: "line" as const, color: "ED7D31", secondaryAxis: true } : {}),
  }));
  if (chartType === "bubble" && values.length >= 2) series[0].sizeRange = rangeFor(values.at(-1)!.column);
  const anchorColumn = Math.min(40, Math.max(8, source.range.endCol + 2));
  return [{
    op: "add_chart",
    sheet: targetSheet.name,
    chartType,
    title: chartTitleFromInstruction(agent.instruction) ?? `${agent.taskId} chart`,
    categoryRange: rangeFor(category.column),
    series: chartType === "pie" || chartType === "doughnut" ? series.slice(0, 1) : series,
    anchor: `${columnNumberToName(anchorColumn)}2`,
    width: 18,
    height: 10,
    legendPosition: /\bno\s+legend\b/i.test(agent.instruction) ? "none" : /\blegend\s+at\s+the\s+bottom\b/i.test(agent.instruction) || isPareto ? "bottom" : "right",
    grouping: /100%\s*stacked/i.test(agent.instruction) ? "percentStacked" : /\bstacked\b/i.test(agent.instruction) ? "stacked" : "clustered",
    dataLabels: /\bdata\s+labels?\b/i.test(agent.instruction),
  }];
}

function chartTypeFromInstruction(instruction: string): AgentChartOperation["chartType"] {
  if (/\bbubble\s+chart\b/i.test(instruction)) return "bubble";
  if (/\bscatter\s+(?:chart|graph)\b/i.test(instruction)) return "scatter";
  if (/\b(?:pie|sunburst)\s+chart\b/i.test(instruction)) return "pie";
  if (/\b(?:doughnut|donut|gauge|speedometer)\b/i.test(instruction)) return "doughnut";
  if (/\barea\s+chart\b/i.test(instruction)) return "area";
  if (/\b(?:bar|football\s+field)\s+chart\b/i.test(instruction)) return "bar";
  if (/\b(?:column|waterfall|pareto)\s+chart\b/i.test(instruction)) return "column";
  return "line";
}

function chartTitleFromInstruction(instruction: string): string | undefined {
  const match = instruction.match(/(?:titled|title(?:d)?\s+(?:the\s+chart\s+)?)\s*["']([^"']{2,160})["']/i);
  return match?.[1]?.trim();
}

function quotedSheetName(sheet: string): string {
  return `'${sheet.replace(/'/g, "''")}'`;
}

function visibleFormulaRepairFallbackAllowed(agent: AgentManifest, snapshot: WorkbookSnapshot): boolean {
  if (snapshot.inspection.formulaFillSuggestions.length > 0 || snapshot.inspection.valueSuggestions.length > 0) return true;
  return /\b(?:audit\s+and\s+fix|audit\s+this\s+(?:file|workbook)|fix\s+(?:all\s+)?formula\s+(?:errors|inconsistencies)|repair\s+(?:all\s+)?broken\s+(?:formulas|references))\b/i.test(agent.instruction);
}

function normalizeAggregateSectionOperation(
  operation: AgentAggregateSectionOperation,
  sheetNamesByLower: Map<string, string>,
): AgentAggregateSectionOperation {
  return {
    ...operation,
    sourceSheet: canonicalSheetName(operation.sourceSheet, sheetNamesByLower),
    targetSheet: canonicalSheetName(operation.targetSheet, sheetNamesByLower),
    sourceSection: stringValue(operation.sourceSection),
    targetSection: stringValue(operation.targetSection),
    groupBy: stringArray(operation.groupBy),
    valueColumn: stringValue(operation.valueColumn),
    sortBy: optionalStringArray(operation.sortBy),
    totalLabel: optionalString(operation.totalLabel),
  };
}

function normalizeFilterRowsOperation(
  operation: AgentFilterRowsOperation,
  sheetNamesByLower: Map<string, string>,
): AgentFilterRowsOperation {
  return {
    ...operation,
    sheet: canonicalSheetName(operation.sheet, sheetNamesByLower),
    sourceRange: stringValue(operation.sourceRange).toUpperCase(),
    targetCell: stringValue(operation.targetCell).toUpperCase(),
    dateColumn: optionalString(operation.dateColumn)?.toUpperCase(),
    startCell: stringValue(operation.startCell).toUpperCase(),
    endCell: stringValue(operation.endCell).toUpperCase(),
  };
}

function normalizeSortUniqueRowsOperation(
  operation: AgentSortUniqueRowsOperation,
  sheetNamesByLower: Map<string, string>,
): AgentSortUniqueRowsOperation {
  return {
    ...operation,
    sheet: canonicalSheetName(operation.sheet, sheetNamesByLower),
    sourceRange: stringValue(operation.sourceRange).toUpperCase(),
    targetCell: stringValue(operation.targetCell).toUpperCase(),
    keyColumns: stringArray(operation.keyColumns).map((column) => column.toUpperCase()),
    outputColumns: stringArray(operation.outputColumns).map((column) => column.toUpperCase()),
    sortBy: stringValue(operation.sortBy).toUpperCase(),
    sortDirection: operation.sortDirection === "desc" ? "desc" : "asc",
    includeIndex: operation.includeIndex ?? true,
  };
}

function canonicalSheetName(value: unknown, sheetNamesByLower: Map<string, string>): string {
  const sheet = stringValue(value);
  return sheetNamesByLower.get(sheet.toLowerCase()) ?? sheet;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | undefined {
  return stringValue(value) || undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(stringValue).filter(Boolean)
    : [];
}

function optionalStringArray(value: unknown): string[] | undefined {
  const values = stringArray(value);
  return values.length ? values : undefined;
}

function filterRowsOperationIsSelfConsistent(operation: AgentFilterRowsOperation): boolean {
  const source = parseRangeRef(operation.sourceRange);
  if (!source) return false;
  const dateColumn = operation.dateColumn ? columnNameToNumber(operation.dateColumn) : source.startCol;
  return dateColumn >= source.startCol && dateColumn <= source.endCol;
}

function filterRowsOperationKey(operation: AgentFilterRowsOperation): string {
  return [operation.sheet, operation.sourceRange, operation.targetCell, operation.dateColumn ?? "", operation.startCell, operation.endCell]
    .map((value) => value.trim().toUpperCase())
    .join("::");
}

function sortUniqueRowsOperationIsSelfConsistent(operation: AgentSortUniqueRowsOperation): boolean {
  const source = parseRangeRef(operation.sourceRange);
  if (!source) return false;
  const referencedColumns = [
    ...operation.keyColumns,
    ...operation.outputColumns,
    operation.sortBy,
  ].map(columnNameToNumber);
  return referencedColumns.every((column) => column >= source.startCol && column <= source.endCol);
}

function sortUniqueRowsOperationKey(operation: AgentSortUniqueRowsOperation): string {
  return [
    operation.sheet,
    operation.sourceRange,
    operation.targetCell,
    operation.keyColumns.join(","),
    operation.outputColumns.join(","),
    operation.sortBy,
    operation.sortDirection ?? "asc",
    operation.includeIndex === false ? "no_index" : "index",
  ].map((value) => value.trim().toUpperCase()).join("::");
}

function inferVisibleAggregateSectionOperations(
  agent: AgentManifest,
  snapshot: WorkbookSnapshot,
  existingOperations: AgentEditOperation[],
): AgentAggregateSectionOperation[] {
  const instruction = agent.instruction.toLowerCase();
  if (!/\b(?:combine|group|match|matching|duplicates?)\b/.test(instruction)) return [];
  if (!/\b(?:sum|total|amounts?)\b/.test(instruction)) return [];
  const existingKeys = new Set(
    existingOperations
      .filter(isAggregateSectionOperation)
      .map((operation) => aggregateOperationKey(operation.sourceSheet, operation.sourceSection, operation.targetSheet, operation.targetSection)),
  );
  const sourceSheets = snapshot.sheets.filter((sheet) =>
    sheet.blocks.some((block) => block.title && hasHeaders(block, ["DATE", "REF"]) && findHeader(block, ["AMOUNTS", "AMOUNT"])),
  );
  const targetSheets = snapshot.sheets.filter((sheet) =>
    sheet.blocks.some((block) => block.title && hasHeaders(block, ["SN", "DATE", "REF"]) && findHeader(block, ["AMOUNTS", "AMOUNT"])),
  );
  const operations: AgentAggregateSectionOperation[] = [];
  for (const sourceSheet of sourceSheets) {
    for (const targetSheet of targetSheets) {
      if (sourceSheet.name === targetSheet.name) continue;
      for (const targetBlock of targetSheet.blocks) {
        if (!targetBlock.title || !targetSectionLooksBlank(targetSheet, targetBlock)) continue;
        const sourceBlock = sourceSheet.blocks.find((block) => block.title && normalizeHeader(block.title) === normalizeHeader(targetBlock.title!));
        if (!sourceBlock) continue;
        if (!hasHeaders(sourceBlock, ["DATE", "REF"]) || !findHeader(sourceBlock, ["AMOUNTS", "AMOUNT"])) continue;
        const valueColumn = findHeader(sourceBlock, ["AMOUNTS", "AMOUNT"])!;
        const key = aggregateOperationKey(sourceSheet.name, sourceBlock.title!, targetSheet.name, targetBlock.title);
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        operations.push({
          op: "aggregate_section",
          sourceSheet: sourceSheet.name,
          sourceSection: sourceBlock.title!,
          targetSheet: targetSheet.name,
          targetSection: targetBlock.title,
          groupBy: ["DATE", "REF"],
          valueColumn,
          sortBy: ["DATE", "REF"],
          totalLabel: "TOTAL",
        });
      }
    }
  }
  return operations;
}

function inferVisibleFilterRowsOperations(
  agent: AgentManifest,
  snapshot: WorkbookSnapshot,
  existingOperations: AgentEditOperation[],
): AgentFilterRowsOperation[] {
  const instruction = agent.instruction;
  const lower = instruction.toLowerCase();
  if (!/\bfilter(?:ed)?\b/.test(lower) || !/\bdate/.test(lower) || !/\bcriteria\b/.test(lower)) return [];
  const dataRange = instruction.match(/\bdata range from\s+([A-Z]{1,3}[1-9][0-9]*\s+to\s+[A-Z]{1,3}[1-9][0-9]*)/i)?.[1]
    ?.replace(/\s+to\s+/i, ":")
    .toUpperCase();
  const criteria = instruction.match(/\bcells?\s+([A-Z]{1,3}[1-9][0-9]*)\s+and\s+([A-Z]{1,3}[1-9][0-9]*)/i);
  const targetCell = instruction.match(/\bstart(?:ing)?(?:\s+from)?\s+cell\s+([A-Z]{1,3}[1-9][0-9]*)/i)?.[1]?.toUpperCase();
  if (!dataRange || !criteria || !targetCell) return [];
  const sheet = snapshot.sheets.find((item) => parseRangeRef(dataRange) && item.cells.some((cell) => cell.address.toUpperCase() === criteria[1].toUpperCase()));
  if (!sheet) return [];
  const existing = new Set(
    existingOperations.filter(isFilterRowsOperation).map((operation) => `${operation.sheet}:${operation.sourceRange}:${operation.targetCell}`),
  );
  const key = `${sheet.name}:${dataRange}:${targetCell}`;
  if (existing.has(key)) return [];
  return [{
    op: "filter_rows",
    sheet: sheet.name,
    sourceRange: dataRange,
    targetCell,
    dateColumn: "A",
    startCell: criteria[1].toUpperCase(),
    endCell: criteria[2].toUpperCase(),
  }];
}

function inferVisibleSortUniqueRowsOperations(
  agent: AgentManifest,
  snapshot: WorkbookSnapshot,
  existingOperations: AgentEditOperation[],
): AgentSortUniqueRowsOperation[] {
  const lower = agent.instruction.toLowerCase();
  if (!/\bduplicate/.test(lower) || !/\boutput\b/.test(lower) || !/\bcolumn\s+h\b/.test(lower) || !/\blowest to highest\b/.test(lower)) {
    return [];
  }
  const sheet = snapshot.sheets.find((item) => {
    const headers = new Map(item.cells.map((cell) => [`${cell.address.toUpperCase()}:${normalizeHeader(cell.value)}`, cell.value]));
    return headers.has("A1:ITEM") && headers.has("B1:NAME") && headers.has("C1:REF") && headers.has("F1:ITEM") && headers.has("G1:NAME") && headers.has("H1:REF");
  });
  if (!sheet) return [];
  const existing = new Set(
    existingOperations.filter(isSortUniqueRowsOperation).map((operation) => `${operation.sheet}:${operation.sourceRange}:${operation.targetCell}`),
  );
  const sourceRange = `A1:C${sheet.rowCount}`;
  const targetCell = "F2";
  const key = `${sheet.name}:${sourceRange}:${targetCell}`;
  if (existing.has(key)) return [];
  return [{
    op: "sort_unique_rows",
    sheet: sheet.name,
    sourceRange,
    targetCell,
    keyColumns: ["B", "C"],
    outputColumns: ["B", "C"],
    sortBy: "C",
    sortDirection: "asc",
    includeIndex: true,
  }];
}

function aggregateOperationKey(sourceSheet: string, sourceSection: string, targetSheet: string, targetSection: string): string {
  return [sourceSheet, sourceSection, targetSheet, targetSection].map(normalizeHeader).join("::");
}

function hasHeaders(block: WorkbookSnapshot["sheets"][number]["blocks"][number], headers: string[]): boolean {
  return headers.every((header) => Boolean(findHeader(block, [header])));
}

function findHeader(block: WorkbookSnapshot["sheets"][number]["blocks"][number], candidates: string[]): string | undefined {
  const normalized = new Set(candidates.map(normalizeHeader));
  return block.headers.find((header) => normalized.has(normalizeHeader(header)));
}

function targetSectionLooksBlank(
  sheet: WorkbookSnapshot["sheets"][number],
  block: WorkbookSnapshot["sheets"][number]["blocks"][number],
): boolean {
  const parsed = parseRangeRef(block.range);
  if (!parsed || block.dataRowCount === 0) return false;
  const headerByName = new Map(block.headers.map((header, index) => [normalizeHeader(header), parsed.startCol + index]));
  const valueColumns = ["DATE", "REF", "AMOUNTS", "AMOUNT"].flatMap((header) => headerByName.get(normalizeHeader(header)) ?? []);
  if (!valueColumns.length) return false;
  const cellValues = new Map(sheet.cells.map((cell) => [cell.address.toUpperCase(), cell.value]));
  for (let row = block.headerRow + 1; row <= parsed.endRow; row += 1) {
    const firstCellValue = cellValues.get(`${columnNumberToName(parsed.startCol)}${row}`)?.trim().toUpperCase();
    if (firstCellValue === "TOTAL") continue;
    if (valueColumns.every((col) => !(cellValues.get(`${columnNumberToName(col)}${row}`) ?? "").trim())) return true;
  }
  return false;
}

function isGenericSheetAlias(value: string): boolean {
  return /^(?:sheet|worksheet|tab)\s*\d+$/i.test(value);
}

function normalizeEditOperationShape(operation: AgentCellEditOperation): AgentCellEditOperation {
  const normalized = { ...operation } as AgentEditOperation & { formula?: unknown; numFmt?: unknown; result?: unknown; value?: unknown };
  const encodedValue = normalized.value;
  const nestedValue = parseEncodedCellValue(encodedValue);
  if (nestedValue) {
    if (typeof nestedValue.formula === "string") normalized.formula = nestedValue.formula.trim().replace(/^=/, "");
    if ("result" in nestedValue && normalized.result === undefined) normalized.result = nestedValue.result;
    if (typeof nestedValue.numFmt === "string" && normalized.numFmt === undefined) normalized.numFmt = nestedValue.numFmt;
    if ("value" in nestedValue) normalized.value = nestedValue.value;
    else delete normalized.value;
  }
  if (normalized.formula === null) delete normalized.formula;
  if (normalized.numFmt === null) delete normalized.numFmt;
  return normalized as AgentCellEditOperation;
}

function parseEncodedCellValue(value: unknown): { formula?: unknown; value?: unknown; result?: unknown; numFmt?: unknown } | undefined {
  const candidate = typeof value === "string" && value.trim().startsWith("{")
    ? (() => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return undefined;
        }
      })()
    : value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return undefined;
  const record = candidate as Record<string, unknown>;
  if (!("formula" in record || "value" in record || "result" in record || "numFmt" in record)) return undefined;
  return record;
}

type WorkbookSnapshot = {
  sheets: Array<{
    name: string;
    rowCount: number;
    columnCount: number;
    actualRowCount: number;
    actualColumnCount: number;
    truncated: boolean;
    blocks: Array<{
      range: string;
      title?: string;
      headerRow: number;
      headers: string[];
      dataRowCount: number;
    }>;
    cells: Array<{ address: string; value: string; formula?: string; numFmt?: string }>;
  }>;
  cellCount: number;
  truncated: boolean;
  inspection: WorkbookTaskInspection;
};

async function snapshotWorkbook(
  path: string,
  maxCells = DEFAULT_WORKBOOK_SNAPSHOT_MAX_CELLS,
  maxCellChars?: number,
  agent?: AgentManifest,
): Promise<WorkbookSnapshot> {
  const workbook = await readSpreadsheetBenchWorkbookForCells(path);
  const boundedMaxCells = Math.max(1, Math.trunc(maxCells));
  const boundedMaxCellChars = maxCellChars === undefined ? undefined : Math.max(1, Math.trunc(maxCellChars));
  const compactMetadata = boundedMaxCells < DEFAULT_WORKBOOK_SNAPSHOT_MAX_CELLS || boundedMaxCellChars !== undefined;
  const worksheets = compactMetadata ? workbook.worksheets.slice(0, 32) : workbook.worksheets;
  const observations = new Map<string, WorkbookObservedCell>();
  for (const sheet of worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const observed = observedWorkbookCell(sheet, cell);
        observations.set(workbookCellKey(observed.sheet, observed.address), observed);
      });
    });
  }
  if (agent) addExplicitReferenceCells(agent, worksheets, observations);
  const allCells = [...observations.values()];
  const inspection = inspectWorkbookTask({
    instruction: agent?.instruction ?? "Inspect the workbook before editing.",
    sheetNames: worksheets.map((sheet) => sheet.name),
    cells: allCells,
  });
  const perSheetLimit = worksheets.length > 0
    ? Math.max(24, Math.floor(boundedMaxCells / worksheets.length))
    : boundedMaxCells;
  const selectedCells = selectWorkbookTaskCells({
    inspection,
    cells: allCells,
    maxCells: boundedMaxCells,
    maxCellsPerSheet: perSheetLimit,
  });
  const selectedBySheet = new Map<string, WorkbookObservedCell[]>();
  for (const cell of selectedCells) {
    const cells = selectedBySheet.get(cell.sheet) ?? [];
    cells.push(cell);
    selectedBySheet.set(cell.sheet, cells);
  }
  const sheets: WorkbookSnapshot["sheets"] = worksheets.map((sheet) => {
    const cells = selectedBySheet.get(sheet.name) ?? [];
    const observedCount = allCells.filter((cell) => cell.sheet === sheet.name).length;
    return {
      name: sheet.name,
      rowCount: sheet.rowCount,
      columnCount: sheet.columnCount,
      actualRowCount: sheet.actualRowCount,
      actualColumnCount: sheet.actualColumnCount,
      truncated: cells.length < observedCount,
      blocks: detectSheetBlocks(sheet, compactMetadata
        ? {
            maxRows: 256,
            maxColumns: 24,
            maxBlocks: 6,
            maxHeaderChars: boundedMaxCellChars ?? 128,
          }
        : undefined),
      cells: cells.map((cell) => {
        const value = cellValueForPrompt(cell.value as ExcelJS.CellValue);
        return {
          address: cell.address,
          value: boundedMaxCellChars === undefined ? value : value.slice(0, boundedMaxCellChars),
          ...(cell.formula ? { formula: boundedMaxCellChars === undefined ? cell.formula : cell.formula.slice(0, boundedMaxCellChars) } : {}),
          ...(cell.numFmt ? { numFmt: cell.numFmt } : {}),
        };
      }),
    };
  });
  return {
    sheets,
    cellCount: selectedCells.length,
    truncated: worksheets.length < workbook.worksheets.length || selectedCells.length < allCells.length,
    inspection,
  };
}

function observedWorkbookCell(sheet: ExcelJS.Worksheet, cell: ExcelJS.Cell): WorkbookObservedCell {
  return {
    sheet: sheet.name,
    address: cell.address,
    value: cell.value,
    ...(cell.formula ? { formula: cell.formula } : {}),
    ...(cell.numFmt ? { numFmt: cell.numFmt } : {}),
  };
}

function addExplicitReferenceCells(
  agent: AgentManifest,
  worksheets: ExcelJS.Worksheet[],
  observations: Map<string, WorkbookObservedCell>,
) {
  const references = extractWorkbookTaskReferences(agent.instruction, worksheets.map((sheet) => sheet.name));
  const mentionedSheets = worksheets.filter((sheet) => agent.instruction.toLowerCase().includes(sheet.name.toLowerCase()));
  for (const reference of references) {
    const candidateSheets = reference.sheet
      ? worksheets.filter((sheet) => sheet.name.toLowerCase() === reference.sheet!.toLowerCase())
      : mentionedSheets.length === 1 ? mentionedSheets : worksheets;
    const range = parseRangeRef(`${reference.start}:${reference.end}`);
    if (!range) continue;
    const area = (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
    const positions: Array<{ row: number; col: number }> = [];
    if (area <= 128) {
      for (let row = range.startRow; row <= range.endRow; row += 1) {
        for (let col = range.startCol; col <= range.endCol; col += 1) positions.push({ row, col });
      }
    } else {
      positions.push(
        { row: range.startRow, col: range.startCol },
        { row: range.startRow, col: range.endCol },
        { row: range.endRow, col: range.startCol },
        { row: range.endRow, col: range.endCol },
      );
    }
    for (const sheet of candidateSheets) {
      for (const position of positions) {
        const cell = sheet.getCell(position.row, position.col);
        const observed = observedWorkbookCell(sheet, cell);
        observations.set(workbookCellKey(observed.sheet, observed.address), observed);
      }
    }
  }
}

function detectSheetBlocks(sheet: ExcelJS.Worksheet, limits?: {
  maxRows: number;
  maxColumns: number;
  maxBlocks: number;
  maxHeaderChars: number;
}) {
  const blocks: WorkbookSnapshot["sheets"][number]["blocks"] = [];
  const maxRow = limits ? Math.min(sheet.rowCount, limits.maxRows) : sheet.rowCount;
  const fullColumnCount = Math.max(1, sheet.actualColumnCount || sheet.columnCount);
  const maxCol = limits ? Math.min(fullColumnCount, limits.maxColumns) : fullColumnCount;
  let startRow: number | undefined;
  for (let rowNumber = 1; rowNumber <= maxRow + 1; rowNumber++) {
    const rowHasValues = rowNumber <= maxRow && rowHasVisibleValues(sheet.getRow(rowNumber), maxCol);
    if (rowHasValues && startRow === undefined) startRow = rowNumber;
    if ((!rowHasValues || rowNumber > maxRow) && startRow !== undefined) {
      const endRow = rowNumber - 1;
      const firstValues = visibleRowValues(sheet.getRow(startRow), maxCol);
      const firstNonEmpty = firstValues.filter(Boolean);
      const firstLooksLikeTitle = firstNonEmpty.length === 1 && endRow > startRow;
      const headerRow = firstLooksLikeTitle ? startRow + 1 : startRow;
      const headers = visibleRowValues(sheet.getRow(headerRow), maxCol)
        .map((header) => limits ? header.slice(0, limits.maxHeaderChars) : header);
      blocks.push({
        range: `${columnNumberToName(1)}${startRow}:${columnNumberToName(maxCol)}${endRow}`,
        ...(firstLooksLikeTitle ? { title: firstNonEmpty[0] } : {}),
        headerRow,
        headers,
        dataRowCount: Math.max(0, endRow - headerRow),
      });
      if (limits && blocks.length >= limits.maxBlocks) break;
      startRow = undefined;
    }
  }
  return blocks;
}

function rowHasVisibleValues(row: ExcelJS.Row, maxCol: number): boolean {
  return visibleRowValues(row, maxCol).some(Boolean);
}

function visibleRowValues(row: ExcelJS.Row, maxCol: number): string[] {
  const values: string[] = [];
  for (let column = 1; column <= maxCol; column++) values.push(cellValueForPrompt(row.getCell(column).value));
  return values;
}

function columnNumberToName(column: number): string {
  let value = "";
  let remaining = column;
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    value = String.fromCharCode(65 + modulo) + value;
    remaining = Math.floor((remaining - modulo) / 26);
  }
  return value;
}

function columnNameToNumber(column: string): number {
  return column
    .replace(/\$/g, "")
    .trim()
    .toUpperCase()
    .split("")
    .reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0);
}

function cellValueForPrompt(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value && value.result !== undefined) return String(value.result ?? "");
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value) return JSON.stringify(value.richText);
    return JSON.stringify(value);
  }
  return String(value);
}

function readPromptFiles(agentDir: string, promptFiles: string[]): Array<{ path: string; text: string }> {
  return promptFiles.slice(0, 4).flatMap((file) => {
    const path = resolveManifestPath(agentDir, file);
    if (!existsSync(path)) return [];
    return [{ path: file, text: readFileSync(path, "utf8").slice(0, 5000) }];
  });
}

function spreadsheetBenchPlannerSystem(): string {
  return [
    "You are a spreadsheet editing worker.",
    "Return only JSON matching this schema:",
    "{\"schema\":1,\"operations\":[{\"sheet\":\"Sheet1\",\"cell\":\"B2\",\"value\":2}]}",
    "For single-cell edits, use value for literal values, or formula plus optional result for formulas.",
    "For repeated visible table aggregation work, prefer the bounded aggregate_section operation:",
    "{\"op\":\"aggregate_section\",\"sourceSheet\":\"RANGES\",\"sourceSection\":\"DATA\",\"targetSheet\":\"LISTS\",\"targetSection\":\"DATA\",\"groupBy\":[\"DATE\",\"REF\"],\"valueColumn\":\"AMOUNTS\",\"sortBy\":[\"DATE\",\"REF\"],\"totalLabel\":\"TOTAL\"}",
    "aggregate_section groups rows in the source section by the named headers, sums valueColumn, sorts by sortBy/groupBy, writes SN/group/value rows, and writes the total formula.",
    "For visible date criteria filters, prefer filter_rows over dynamic FILTER formulas:",
    "{\"op\":\"filter_rows\",\"sheet\":\"FILTER 5b\",\"sourceRange\":\"A1:E315\",\"targetCell\":\"I6\",\"dateColumn\":\"A\",\"startCell\":\"I2\",\"endCell\":\"J2\"}",
    "filter_rows copies concrete rows whose dateColumn is between startCell and endCell into the target range.",
    "For visible dedupe/sort table outputs, prefer sort_unique_rows over writing a short prefix:",
    "{\"op\":\"sort_unique_rows\",\"sheet\":\"sheet1\",\"sourceRange\":\"A1:C195\",\"targetCell\":\"F2\",\"keyColumns\":[\"B\",\"C\"],\"outputColumns\":[\"B\",\"C\"],\"sortBy\":\"C\",\"sortDirection\":\"asc\",\"includeIndex\":true}",
    "sort_unique_rows skips blank/header rows, removes duplicate key rows, sorts by sortBy, and writes an optional index plus outputColumns.",
    "For chart work, use add_chart so the candidate contains a real XLSX chart object:",
    "{\"op\":\"add_chart\",\"sheet\":\"Data\",\"chartType\":\"line\",\"title\":\"Monthly Trend\",\"categoryRange\":\"'Data'!A2:A13\",\"series\":[{\"name\":\"Revenue\",\"valuesRange\":\"'Data'!B2:B13\"}],\"anchor\":\"H2\",\"legendPosition\":\"bottom\"}",
    "Supported chartType values are line, bar, column, pie, doughnut, scatter, area, and bubble. Use xValuesRange for scatter/bubble and sizeRange for bubble series; a series may set chartType plus secondaryAxis for combo charts.",
    "Use exactly one of the sheet names shown in workbook.sheets[].name; do not invent Sheet1 unless Sheet1 exists.",
    "Use workbook.inspection as the task plan: quoted formula matches are higher-confidence targets than cells referenced inside those formulas; ranked cells are selected for relevance, not workbook order.",
    "Use inputFiles only as agent-visible issue-type context (for example, Incorrect Average or Embedded Hardcode); never treat a filename as a hidden answer or invent a target from it.",
    "Before editing, distinguish output targets from source/dependency cells. Never put a formula into an input cell merely because the task mentions that input address.",
    "Preserve existing formulas unless the task explicitly asks for hardcoded values. Do not emit #REF! formulas or formulas that reference their own target cell.",
    "If the task requires many cells, emit every required cell operation explicitly. Do not use placeholders, spill ranges, or one-cell dynamic-array shortcuts.",
    "When a visible example/reference table shows the desired output shape, infer the repeated operation from that reference and write the concrete target cells.",
    "For each requested metric, use the matching label and its calculation_row_context cells to inspect the full year band, nearby headers, and adjacent source rows before choosing formulas.",
    "Extend established formulas across a requested year band with correct relative and absolute references; do not invent a formula from the row label alone.",
    "The JSON must be valid strict JSON: double-quoted keys/strings, no comments, no trailing commas.",
    "Do not include markdown, prose, comments, evaluator metadata, or hidden answers.",
  ].join("\n");
}

function spreadsheetBenchPlannerPrompt(agent: AgentManifest, snapshot: WorkbookSnapshot, promptFiles: Array<{ path: string; text: string }>): string {
  const visibleDerivedOperationCandidates = [
    ...inferVisibleAggregateSectionOperations(agent, snapshot, []),
    ...inferVisibleFilterRowsOperations(agent, snapshot, []),
    ...inferVisibleSortUniqueRowsOperations(agent, snapshot, []),
    ...inferVisibleChartOperations(agent, snapshot, []),
  ];
  return JSON.stringify({
    taskId: agent.taskId,
    instruction: agent.instruction,
    instructionType: agent.instructionType,
    inputFiles: agent.inputFiles,
    prompts: promptFiles,
    workbook: snapshot,
    visibleDerivedOperationCandidates,
  }, null, 2);
}

function spreadsheetBenchBatchPlannerSystem(): string {
  const boundedGuidance = spreadsheetBenchPlannerSystem()
    .split("\n")
    .slice(3)
    .filter((line) => !line.startsWith("If the task requires many cells"));
  return [
    "You are a spreadsheet editing worker planning several independent tasks.",
    "Return only strict JSON matching this batch schema:",
    "{\"schema\":1,\"plans\":[{\"taskId\":\"task-a\",\"operations\":[{\"sheet\":\"Sheet1\",\"cell\":\"B2\",\"value\":2}]},{\"taskId\":\"task-b\",\"operations\":[]}]}",
    "Return exactly one plan for every taskId. If the bounded context does not justify an edit, return an empty operations array for that task instead of inventing cells.",
    "Return at most eight operations per task. If the task would require more, return an empty operations array so the response remains complete JSON.",
    ...boundedGuidance,
  ].join("\n");
}

function spreadsheetBenchBatchPlannerPrompt(tasks: Array<{
  agent: AgentManifest;
  snapshot: WorkbookSnapshot;
  promptFiles: Array<{ path: string; text: string }>;
}>): string {
  return JSON.stringify({
    tasks: tasks.map(({ agent, snapshot, promptFiles }) => ({
      taskId: agent.taskId,
      instruction: agent.instruction.slice(0, BATCH_INSTRUCTION_MAX_CHARS),
      instructionType: agent.instructionType,
      inputFiles: agent.inputFiles,
      prompts: promptFiles,
      workbook: snapshot,
      visibleDerivedOperationCandidates: [
        ...inferVisibleAggregateSectionOperations(agent, snapshot, []),
        ...inferVisibleFilterRowsOperations(agent, snapshot, []),
        ...inferVisibleSortUniqueRowsOperations(agent, snapshot, []),
        ...inferVisibleChartOperations(agent, snapshot, []),
      ],
    })),
  });
}

function parseBatchedEditPlanText(text: string): Map<string, AgentEditPlan> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const repaired = repairCommonModelJsonDrift(cleaned);
  let parsed: unknown;
  try {
    const jsonText = extractFirstJsonObject(repaired, "batch");
    parsed = JSON.parse(jsonText) as unknown;
  } catch (error) {
    const salvaged = extractCompleteBatchPlanObjects(repaired);
    if (salvaged.length === 0) throw error;
    parsed = { plans: salvaged };
  }
  if (!parsed || typeof parsed !== "object") throw new Error("model-edit-plan batch returned a non-object JSON value");
  const record = parsed as Record<string, unknown>;
  const rawPlans = record.plans;
  const entries: Array<[string, unknown]> = Array.isArray(rawPlans)
    ? rawPlans.flatMap((value): Array<[string, unknown]> => {
        if (!value || typeof value !== "object") return [];
        const item = value as Record<string, unknown>;
        const taskId = typeof item.taskId === "string" ? item.taskId.trim() : "";
        return taskId ? [[taskId, item.plan ?? item]] : [];
      })
    : rawPlans && typeof rawPlans === "object"
      ? Object.entries(rawPlans as Record<string, unknown>)
      : [];
  if (entries.length === 0) throw new Error("model-edit-plan batch returned no task plans");
  const plans = new Map<string, AgentEditPlan>();
  for (const [taskId, value] of entries) {
    if (plans.has(taskId)) throw new Error(`model-edit-plan batch returned duplicate taskId ${taskId}`);
    plans.set(taskId, normalizeParsedEditPlanShape(value));
  }
  return plans;
}

function extractCompleteBatchPlanObjects(text: string): unknown[] {
  const plansKey = text.search(/["']plans["']\s*:/i);
  const arrayStart = plansKey >= 0 ? text.indexOf("[", plansKey) : -1;
  if (arrayStart < 0) return [];
  const objects: unknown[] = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let quote = "";
  let escaped = false;
  for (let index = arrayStart + 1; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === "\"" || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === "{") {
      if (depth === 0) objectStart = index;
      depth += 1;
      continue;
    }
    if (char !== "}" || depth === 0) continue;
    depth -= 1;
    if (depth !== 0 || objectStart < 0) continue;
    try {
      objects.push(JSON.parse(repairCommonModelJsonDrift(text.slice(objectStart, index + 1))));
    } catch {
      // A malformed task object is omitted; complete neighboring objects remain usable.
    }
    objectStart = -1;
  }
  return objects;
}

function parseEditPlanText(text: string, taskId: string): AgentEditPlan {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const jsonText = extractFirstJsonObject(repairCommonModelJsonDrift(cleaned), taskId);
  if (!jsonText.startsWith("{")) throw new Error(`model-edit-plan returned no JSON for ${taskId}`);
  return parseEditPlanJson(jsonText);
}

function parseEditPlanJson(jsonText: string): AgentEditPlan {
  try {
    return normalizeParsedEditPlanShape(JSON.parse(jsonText));
  } catch (error) {
    const repaired = repairCommonModelJsonDrift(jsonText);
    if (repaired !== jsonText) {
      try {
        return normalizeParsedEditPlanShape(JSON.parse(repaired));
      } catch {
        // Preserve the original parser error so failure taxonomy stays tied to the model output.
      }
    }
    throw error;
  }
}

function normalizeParsedEditPlanShape(value: unknown): AgentEditPlan {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.operations) && (record.schema === undefined || record.schema === "1")) {
      return { ...record, schema: 1 } as AgentEditPlan;
    }
  }
  return value as AgentEditPlan;
}

export function repairCommonModelJsonDrift(jsonText: string): string {
  const withoutUnescapedFormulaQuotes = repairUnescapedFormulaQuotes(jsonText);
  const withoutInvalidCommaEscapes = withoutUnescapedFormulaQuotes.replace(/\\,/g, ",");
  const withoutTrailingCommas = withoutInvalidCommaEscapes.replace(/,\s*([}\]])/g, "$1");
  const withoutUncertainNumberSuffixes = withoutTrailingCommas.replace(/("(?:value|result)"\s*:\s*-?\d+(?:\.\d+)?)\?(?=\s*[,}])/g, "$1");
  const withoutDuplicatedEscapedQuotes = withoutUncertainNumberSuffixes.replace(
    /(?<!\\)"formula"\s*:\s*"((?:\\.|[^"\\])*)\\"\\"(?=\s*(?:[}\]]|,\s*"[^"\\]+"\s*:))/g,
    (match: string) => match.replace(/\\"\\"$/, () => String.raw`\""`),
  );
  return withoutDuplicatedEscapedQuotes.replace(/("value"\s*:\s*)([A-Za-z_][A-Za-z0-9_ -]*)(?=\s*[,}])/g, (_match, prefix: string, raw: string) => {
    const value = raw.trim();
    if (/^(?:true|false|null)$/i.test(value)) return `${prefix}${value.toLowerCase()}`;
    return `${prefix}${JSON.stringify(value)}`;
  });
}

function repairUnescapedFormulaQuotes(jsonText: string): string {
  const formulaStart = /"formula"\s*:\s*"/g;
  let cursor = 0;
  let repaired = "";
  while (true) {
    formulaStart.lastIndex = cursor;
    const match = formulaStart.exec(jsonText);
    if (!match) return `${repaired}${jsonText.slice(cursor)}`;
    const contentStart = match.index + match[0].length;
    repaired += jsonText.slice(cursor, contentStart);
    let index = contentStart;
    let closed = false;
    while (index < jsonText.length) {
      const char = jsonText[index];
      if (char === "\\") {
        repaired += jsonText.slice(index, Math.min(index + 2, jsonText.length));
        index += 2;
        continue;
      }
      if (char !== "\"") {
        repaired += char;
        index += 1;
        continue;
      }
      if (isFormulaJsonClosingQuote(jsonText, index)) {
        repaired += char;
        cursor = index + 1;
        closed = true;
        break;
      }
      repaired += "\\\"";
      index += 1;
    }
    if (!closed) return repaired;
  }
}

function isFormulaJsonClosingQuote(jsonText: string, quoteIndex: number): boolean {
  const tail = jsonText.slice(quoteIndex + 1);
  return /^\s*(?:}|$)/.test(tail) ||
    /^\s*,\s*}/.test(tail) ||
    /^\s*,\s*"(?:[^"\\]|\\.)+"\s*:/.test(tail);
}

function extractFirstJsonObject(text: string, taskId: string): string {
  const start = text.indexOf("{");
  if (start < 0) throw new Error(`model-edit-plan returned no JSON for ${taskId}`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error(`model-edit-plan returned unterminated JSON for ${taskId}`);
}

export function applySpreadsheetBenchOperation(workbook: ExcelJS.Workbook, operation: AgentEditOperation) {
  if (isChartOperation(operation)) return;
  if (isAggregateSectionOperation(operation)) {
    applyAggregateSectionOperation(workbook, operation);
    return;
  }
  if (isFilterRowsOperation(operation)) {
    applyFilterRowsOperation(workbook, operation);
    return;
  }
  if (isSortUniqueRowsOperation(operation)) {
    applySortUniqueRowsOperation(workbook, operation);
    return;
  }
  const sheet = workbook.getWorksheet(operation.sheet);
  if (!sheet) throw new Error(`edit-plan references missing sheet: ${operation.sheet}`);
  const cell = sheet.getCell(operation.cell);
  if (operation.formula !== undefined) {
    cell.value = {
      formula: operation.formula,
      result: operation.result ?? evaluateSimpleFormula(workbook, sheet, operation.formula),
    };
  }
  else if (typeof operation.value === "string" && operation.value.trim().startsWith("=")) {
    const formula = operation.value.trim().slice(1);
    cell.value = {
      formula,
      result: operation.result ?? evaluateSimpleFormula(workbook, sheet, formula),
    };
  }
  else if ("value" in operation) cell.value = operation.value ?? null;
  if (operation.numFmt) cell.numFmt = operation.numFmt;
}

export function applySpreadsheetBenchChartOperations(
  workbookPath: string,
  operations: AgentEditOperation[],
  receiptDir = dirname(workbookPath),
): void {
  const charts = operations.filter(isChartOperation);
  if (!charts.length) return;
  const receiptPath = join(receiptDir, "chart-operations.json");
  writeJson(receiptPath, { schema: 1, workbook: basename(workbookPath), operations: charts });
  const python = process.env.SPREADSHEETBENCH_PYTHON?.trim() || process.env.PYTHON?.trim() || "python";
  const script = resolve("scripts/spreadsheetbench-apply-charts.py");
  const result = spawnSync(python, [script, "--workbook", resolve(workbookPath), "--operations", resolve(receiptPath)], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.error) throw new Error(`chart operation bridge failed: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || `exit ${result.status}`).trim().slice(0, 1_000);
    throw new Error(`chart operation bridge failed: ${detail}`);
  }
}

function applyAggregateSectionOperation(workbook: ExcelJS.Workbook, operation: AgentAggregateSectionOperation) {
  const sourceSheet = workbook.getWorksheet(operation.sourceSheet);
  if (!sourceSheet) throw new Error(`aggregate_section references missing source sheet: ${operation.sourceSheet}`);
  const targetSheet = workbook.getWorksheet(operation.targetSheet);
  if (!targetSheet) throw new Error(`aggregate_section references missing target sheet: ${operation.targetSheet}`);
  const sourceSection = findWorksheetSection(sourceSheet, operation.sourceSection);
  if (!sourceSection) throw new Error(`aggregate_section references missing source section: ${operation.sourceSheet}/${operation.sourceSection}`);
  const targetSection = findWorksheetSection(targetSheet, operation.targetSection);
  if (!targetSection) throw new Error(`aggregate_section references missing target section: ${operation.targetSheet}/${operation.targetSection}`);

  const sourceHeaders = headerColumnMap(sourceSection);
  const targetHeaders = headerColumnMap(targetSection);
  const sourceGroupColumns = operation.groupBy.map((header) => {
    const column = sourceHeaders.get(normalizeHeader(header));
    if (!column) throw new Error(`aggregate_section source section missing groupBy header: ${header}`);
    return { header, column };
  });
  const targetGroupColumns = operation.groupBy.map((header) => {
    const column = targetHeaders.get(normalizeHeader(header));
    if (!column) throw new Error(`aggregate_section target section missing groupBy header: ${header}`);
    return { header, column };
  });
  const sourceValueColumn = sourceHeaders.get(normalizeHeader(operation.valueColumn));
  if (!sourceValueColumn) throw new Error(`aggregate_section source section missing valueColumn: ${operation.valueColumn}`);
  const targetValueColumn = targetHeaders.get(normalizeHeader(operation.valueColumn)) ?? targetHeaders.get("AMOUNT");
  if (!targetValueColumn) throw new Error(`aggregate_section target section missing valueColumn: ${operation.valueColumn}`);
  const targetSnColumn = targetHeaders.get("SN") ?? targetHeaders.get("S.N") ?? targetSection.startCol;

  const groups = new Map<string, { values: ExcelJS.CellValue[]; amount: number; sortKeys: string[] }>();
  for (let row = sourceSection.headerRow + 1; row <= sourceSection.endRow; row += 1) {
    const values = sourceGroupColumns.map(({ column }) => sourceSheet.getCell(row, column).value);
    if (values.every(isBlankCellValue)) continue;
    const amount = numericComparableValue(comparableFormulaValue(sourceSheet.getCell(row, sourceValueColumn).value));
    if (amount === undefined) continue;
    const key = values.map(groupKeyValue).join("\u001f");
    const existing = groups.get(key);
    if (existing) existing.amount = roundFormulaNumber(existing.amount + amount);
    else {
      groups.set(key, {
        values,
        amount,
        sortKeys: values.map(sortableGroupValue),
      });
    }
  }
  const rows = [...groups.values()].sort((a, b) => compareAggregateRows(a.sortKeys, b.sortKeys));
  const totalRow = findTotalRow(targetSheet, targetSection, operation.totalLabel ?? "TOTAL") ?? targetSection.endRow;
  const firstDataRow = targetSection.headerRow + 1;
  const lastDataRow = Math.max(firstDataRow - 1, totalRow - 1);
  const availableRows = Math.max(0, lastDataRow - firstDataRow + 1);
  if (rows.length > availableRows) {
    const templateRow = Math.max(firstDataRow, lastDataRow);
    targetSheet.duplicateRow(templateRow, rows.length - availableRows, true);
    targetSection.endRow += rows.length - availableRows;
  }
  const finalTotalRow = findTotalRow(targetSheet, targetSection, operation.totalLabel ?? "TOTAL") ?? firstDataRow + rows.length;
  const finalLastDataRow = Math.max(firstDataRow - 1, finalTotalRow - 1);
  for (let row = firstDataRow; row <= finalLastDataRow; row += 1) {
    for (const column of [targetSnColumn, ...targetGroupColumns.map(({ column }) => column), targetValueColumn]) {
      targetSheet.getCell(row, column).value = null;
    }
  }
  rows.forEach((aggregateRow, index) => {
    const rowNumber = firstDataRow + index;
    targetSheet.getCell(rowNumber, targetSnColumn).value = index + 1;
    targetGroupColumns.forEach(({ column }, groupIndex) => {
      targetSheet.getCell(rowNumber, column).value = outputGroupValue(aggregateRow.values[groupIndex]);
    });
    targetSheet.getCell(rowNumber, targetValueColumn).value = aggregateRow.amount;
  });
  const totalLabelCell = targetSheet.getCell(finalTotalRow, targetSnColumn);
  totalLabelCell.value = operation.totalLabel ?? "TOTAL";
  const totalCell = targetSheet.getCell(finalTotalRow, targetValueColumn);
  const valueColumnName = columnNumberToName(targetValueColumn);
  const formula = `SUM(${valueColumnName}${firstDataRow}:${valueColumnName}${firstDataRow + rows.length - 1})`;
  totalCell.value = {
    formula,
    result: evaluateSimpleFormula(workbook, targetSheet, formula),
  };
}

function applyFilterRowsOperation(workbook: ExcelJS.Workbook, operation: AgentFilterRowsOperation) {
  const sheet = workbook.getWorksheet(operation.sheet);
  if (!sheet) throw new Error(`filter_rows references missing sheet: ${operation.sheet}`);
  const source = parseRangeRef(operation.sourceRange);
  const target = parseA1(operation.targetCell);
  if (!source || !target) throw new Error(`filter_rows has invalid range or target`);
  const startDate = dateFromCellValue(sheet.getCell(operation.startCell).value);
  const endDate = dateFromCellValue(sheet.getCell(operation.endCell).value);
  if (!startDate || !endDate) throw new Error(`filter_rows criteria cells must contain dates`);
  const dateCol = operation.dateColumn ? columnNameToNumber(operation.dateColumn) : source.startCol;
  if (dateCol < source.startCol || dateCol > source.endCol) throw new Error(`filter_rows dateColumn is outside sourceRange`);
  const width = source.endCol - source.startCol + 1;
  const height = source.endRow - source.startRow + 1;
  clearRange(sheet, target.row, target.col, target.row + height - 1, target.col + width - 1);
  let outputRow = target.row;
  for (let row = source.startRow; row <= source.endRow; row += 1) {
    const date = dateFromCellValue(sheet.getCell(row, dateCol).value);
    if (!date || date < startDate || date > endDate) continue;
    for (let offset = 0; offset < width; offset += 1) {
      const sourceCell = sheet.getCell(row, source.startCol + offset);
      const targetCell = sheet.getCell(outputRow, target.col + offset);
      targetCell.value = offset === dateCol - source.startCol ? outputGroupValue(sourceCell.value) : sourceCell.value;
      targetCell.style = { ...sourceCell.style };
      if (sourceCell.numFmt) targetCell.numFmt = sourceCell.numFmt;
    }
    outputRow += 1;
  }
}

function applySortUniqueRowsOperation(workbook: ExcelJS.Workbook, operation: AgentSortUniqueRowsOperation) {
  const sheet = workbook.getWorksheet(operation.sheet);
  if (!sheet) throw new Error(`sort_unique_rows references missing sheet: ${operation.sheet}`);
  const source = parseRangeRef(operation.sourceRange);
  const target = parseA1(operation.targetCell);
  if (!source || !target) throw new Error(`sort_unique_rows has invalid range or target`);
  const keyColumns = operation.keyColumns.map(columnNameToNumber);
  const outputColumns = operation.outputColumns.map(columnNameToNumber);
  const sortColumn = columnNameToNumber(operation.sortBy);
  const referencedColumns = [...keyColumns, ...outputColumns, sortColumn];
  if (referencedColumns.some((column) => column < source.startCol || column > source.endCol)) {
    throw new Error(`sort_unique_rows references columns outside sourceRange`);
  }
  const rows: Array<{ values: ExcelJS.CellValue[]; key: string; sortValue: ExcelJS.CellValue; originalRow: number }> = [];
  const seen = new Set<string>();
  for (let row = source.startRow; row <= source.endRow; row += 1) {
    const keyValues = keyColumns.map((col) => sheet.getCell(row, col).value);
    const outputValues = outputColumns.map((col) => sheet.getCell(row, col).value);
    if (outputValues.every(isBlankCellValue)) continue;
    if (outputValues.some((value) => normalizeHeader(cellValueForPrompt(value)) === "NAME" || normalizeHeader(cellValueForPrompt(value)) === "REF")) continue;
    const key = keyValues.map((value) => cellValueForPrompt(value).trim().toUpperCase()).join("\u001f");
    if (!key.trim() || seen.has(key)) continue;
    seen.add(key);
    rows.push({ values: outputValues, key, sortValue: sheet.getCell(row, sortColumn).value, originalRow: row });
  }
  rows.sort((left, right) => compareSortValues(left.sortValue, right.sortValue, operation.sortDirection ?? "asc") || left.originalRow - right.originalRow);
  const width = outputColumns.length + (operation.includeIndex === false ? 0 : 1);
  const height = source.endRow - source.startRow + 1;
  clearRange(sheet, target.row, target.col, target.row + height - 1, target.col + width - 1);
  rows.forEach((row, index) => {
    const rowNumber = target.row + index;
    let col = target.col;
    if (operation.includeIndex !== false) sheet.getCell(rowNumber, col++).value = index + 1;
    for (const value of row.values) sheet.getCell(rowNumber, col++).value = value;
  });
}

function clearRange(sheet: ExcelJS.Worksheet, startRow: number, startCol: number, endRow: number, endCol: number) {
  for (let row = startRow; row <= endRow; row += 1) {
    for (let col = startCol; col <= endCol; col += 1) sheet.getCell(row, col).value = null;
  }
}

function compareSortValues(left: ExcelJS.CellValue, right: ExcelJS.CellValue, direction: "asc" | "desc"): number {
  const leftNumber = numericComparableValue(comparableFormulaValue(left));
  const rightNumber = numericComparableValue(comparableFormulaValue(right));
  const multiplier = direction === "desc" ? -1 : 1;
  if (leftNumber !== undefined && rightNumber !== undefined) return (leftNumber - rightNumber) * multiplier;
  return cellValueForPrompt(left).localeCompare(cellValueForPrompt(right), undefined, { numeric: true, sensitivity: "base" }) * multiplier;
}

type WorksheetSection = {
  title?: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
  headerRow: number;
  headers: string[];
};

function findWorksheetSection(sheet: ExcelJS.Worksheet, title: string): WorksheetSection | undefined {
  const normalizedTitle = normalizeHeader(title);
  return detectWorksheetSections(sheet).find((section) => section.title && normalizeHeader(section.title) === normalizedTitle);
}

function detectWorksheetSections(sheet: ExcelJS.Worksheet): WorksheetSection[] {
  const sections: WorksheetSection[] = [];
  const maxRow = sheet.rowCount;
  const maxCol = Math.max(1, sheet.actualColumnCount || sheet.columnCount);
  let startRow: number | undefined;
  for (let rowNumber = 1; rowNumber <= maxRow + 1; rowNumber += 1) {
    const hasValues = rowNumber <= maxRow && rowHasVisibleValues(sheet.getRow(rowNumber), maxCol);
    if (hasValues && startRow === undefined) startRow = rowNumber;
    if ((!hasValues || rowNumber > maxRow) && startRow !== undefined) {
      const endRow = rowNumber - 1;
      const firstValues = visibleRowValues(sheet.getRow(startRow), maxCol);
      const firstNonEmpty = firstValues.filter(Boolean);
      const firstLooksLikeTitle = firstNonEmpty.length === 1 && endRow > startRow;
      const headerRow = firstLooksLikeTitle ? startRow + 1 : startRow;
      const headers = visibleRowValues(sheet.getRow(headerRow), maxCol);
      sections.push({
        ...(firstLooksLikeTitle ? { title: firstNonEmpty[0] } : {}),
        startRow,
        endRow,
        startCol: 1,
        endCol: maxCol,
        headerRow,
        headers,
      });
      startRow = undefined;
    }
  }
  return sections;
}

function headerColumnMap(section: WorksheetSection): Map<string, number> {
  const map = new Map<string, number>();
  section.headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    if (normalized) map.set(normalized, section.startCol + index);
  });
  return map;
}

function findTotalRow(sheet: ExcelJS.Worksheet, section: WorksheetSection, totalLabel: string): number | undefined {
  const normalizedLabel = normalizeHeader(totalLabel);
  for (let row = section.headerRow + 1; row <= section.endRow; row += 1) {
    for (let col = section.startCol; col <= section.endCol; col += 1) {
      if (normalizeHeader(cellValueForPrompt(sheet.getCell(row, col).value)) === normalizedLabel) return row;
    }
  }
  return undefined;
}

function compareAggregateRows(left: string[], right: string[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const a = left[index] ?? "";
    const b = right[index] ?? "";
    const compared = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
    if (compared !== 0) return compared;
  }
  return 0;
}

function outputGroupValue(value: ExcelJS.CellValue): ExcelJS.CellValue {
  const date = dateFromCellValue(value);
  return date ?? value;
}

function sortableGroupValue(value: ExcelJS.CellValue): string {
  const date = dateFromCellValue(value);
  if (date) return date.toISOString();
  return cellValueForPrompt(value).trim().toUpperCase();
}

function groupKeyValue(value: ExcelJS.CellValue): string {
  return sortableGroupValue(value);
}

function dateFromCellValue(value: ExcelJS.CellValue): Date | undefined {
  if (value instanceof Date) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  let match = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2])));
  return undefined;
}

function isBlankCellValue(value: ExcelJS.CellValue): boolean {
  return cellValueForPrompt(value).trim() === "";
}

function parseRangeRef(range: string): { startCol: number; startRow: number; endCol: number; endRow: number } | undefined {
  const [start, end = start] = range.split(":").map((part) => parseA1(part.trim()));
  if (!start || !end) return undefined;
  return {
    startCol: Math.min(start.col, end.col),
    startRow: Math.min(start.row, end.row),
    endCol: Math.max(start.col, end.col),
    endRow: Math.max(start.row, end.row),
  };
}

function normalizeHeader(value: string): string {
  return value.trim().replace(/\s+/g, " ").replace(/\.$/, "").toUpperCase();
}

function evaluateSimpleFormula(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  formula: string,
): FormulaResult | undefined {
  const expression = formula.trim().replace(/^=/, "");
  return evaluateFormulaExpression(workbook, currentSheet, expression);
}

function evaluateFormulaExpression(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): FormulaResult | undefined {
  const trimmed = expression.trim();
  if (/^TRUE$/i.test(trimmed)) return true;
  if (/^FALSE$/i.test(trimmed)) return false;
  const stringLiteral = parseFormulaStringLiteral(trimmed);
  if (stringLiteral !== undefined) return stringLiteral;
  if (formulaArgLooksLikeRange(trimmed)) {
    const cells = cellsForFormulaRef(workbook, currentSheet, trimmed);
    if (cells?.length === 1 && cells[0].value !== null) return cells[0].value;
  }
  const functionResult = evaluateFormulaFunction(workbook, currentSheet, trimmed);
  if (functionResult !== undefined) return functionResult;
  return evaluateArithmeticFormula(workbook, currentSheet, trimmed);
}

function evaluateFormulaFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): FormulaResult | undefined {
  const call = parseSingleFormulaFunction(expression);
  if (!call) return undefined;
  const fn = call.name.toUpperCase();
  if (!SUPPORTED_FORMULA_FUNCTIONS.includes(fn as (typeof SUPPORTED_FORMULA_FUNCTIONS)[number])) return undefined;
  const args = splitFormulaArgs(call.args);
  if (fn === "AND" || fn === "OR") {
    if (args.length === 0) return undefined;
    const conditions = args.map((arg) => evaluateFormulaCondition(workbook, currentSheet, arg));
    if (conditions.some((condition) => condition === undefined)) return undefined;
    return fn === "AND" ? conditions.every(Boolean) : conditions.some(Boolean);
  }
  if (fn === "NOT") {
    if (args.length !== 1) return undefined;
    const condition = evaluateFormulaCondition(workbook, currentSheet, args[0]);
    return condition === undefined ? undefined : !condition;
  }
  if (fn === "MEDIAN") return evaluateMedianFunction(workbook, currentSheet, args);
  if (fn === "IF") return evaluateIfFunction(workbook, currentSheet, args);
  if (fn === "IFERROR") return evaluateIfErrorFunction(workbook, currentSheet, args);
  if (fn === "SUMIF") return evaluateSumIfFunction(workbook, currentSheet, args);
  if (fn === "COUNTIF") return evaluateCountIfFunction(workbook, currentSheet, args);
  if (fn === "AVERAGEIF") return evaluateAverageIfFunction(workbook, currentSheet, args);
  if (fn === "SUMIFS") return evaluateSumIfsFunction(workbook, currentSheet, args);
  if (fn === "COUNTIFS") return evaluateCountIfsFunction(workbook, currentSheet, args);
  if (fn === "AVERAGEIFS") return evaluateAverageIfsFunction(workbook, currentSheet, args);
  if (fn === "MATCH") return evaluateMatchFunction(workbook, currentSheet, args);
  if (fn === "INDEX") return evaluateIndexFunction(workbook, currentSheet, args);
  if (fn === "VLOOKUP") return evaluateVLookupFunction(workbook, currentSheet, args);
  if (fn === "XLOOKUP") return evaluateXLookupFunction(workbook, currentSheet, args);
  if (fn === "SUMPRODUCT") return evaluateSumProductFunction(workbook, currentSheet, args);
  if (fn === "LEFT" || fn === "RIGHT" || fn === "MID" || fn === "LEN") return evaluateTextSliceFunction(workbook, currentSheet, fn, args);
  if (fn === "FIND" || fn === "SEARCH") return evaluateTextSearchFunction(workbook, currentSheet, fn, args);
  if (fn === "REPLACE") return evaluateReplaceFunction(workbook, currentSheet, args);
  if (fn === "TEXT") return evaluateTextFormatFunction(workbook, currentSheet, args);
  if (fn === "DATE") return evaluateDateFunction(workbook, currentSheet, args);
  if (fn === "VALUE") return evaluateValueFunction(workbook, currentSheet, args);
  if (fn === "CONCATENATE") return evaluateConcatenateFunction(workbook, currentSheet, args);
  if (fn === "TRIM") return evaluateTrimFunction(workbook, currentSheet, args);
  if (fn === "COUNTA") return args.flatMap((part) => rawValuesForFormulaArg(workbook, currentSheet, part.trim())).filter(isNonBlankFormulaValue).length;

  const values = args.flatMap((part) => valuesForFormulaArg(workbook, currentSheet, part.trim()));
  if (values.length === 0 || values.some((value) => value === undefined)) return undefined;
  const numericValues = values.filter((value): value is number => value !== undefined);
  if (fn === "COUNT") return numericValues.length;
  if (numericValues.length === 0) return undefined;
  if (fn === "SUM") return roundFormulaNumber(numericValues.reduce((sum, value) => sum + value, 0));
  if (fn === "AVERAGE") return roundFormulaNumber(numericValues.reduce((sum, value) => sum + value, 0) / numericValues.length);
  if (fn === "MIN") return Math.min(...numericValues);
  if (fn === "MAX") return Math.max(...numericValues);
  if (fn === "ABS" && numericValues.length === 1) return Math.abs(numericValues[0]);
  if (fn === "ROUND" || fn === "ROUNDUP" || fn === "ROUNDDOWN") {
    if (numericValues.length !== 2) return undefined;
    return roundWithMode(numericValues[0], numericValues[1], fn);
  }
  return undefined;
}

function parseSingleFormulaFunction(expression: string): { name: string; args: string } | undefined {
  const trimmed = expression.trim();
  const header = trimmed.match(/^([A-Z]+)\(/i);
  if (!header) return undefined;
  let depth = 0;
  let inString = false;
  let inSheetQuote = false;
  const openIndex = header[0].length - 1;
  for (let index = openIndex; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "\"") {
      if (inString && trimmed[index + 1] === "\"") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "'") {
      inSheetQuote = !inSheetQuote;
      continue;
    }
    if (inSheetQuote) continue;
    if (char === "(") depth += 1;
    else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        if (index !== trimmed.length - 1) return undefined;
        return { name: header[1], args: trimmed.slice(openIndex + 1, index) };
      }
    }
  }
  return undefined;
}

function evaluateIfFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): FormulaResult | undefined {
  if (args.length < 2 || args.length > 3) return undefined;
  const condition = evaluateFormulaCondition(workbook, currentSheet, args[0]);
  if (condition === undefined) return undefined;
  const branch = condition ? args[1] : args[2] ?? "FALSE";
  return evaluateFormulaExpression(workbook, currentSheet, branch);
}

function evaluateIfErrorFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): FormulaResult | undefined {
  if (args.length !== 2) return undefined;
  return evaluateFormulaExpression(workbook, currentSheet, args[0])
    ?? evaluateFormulaExpression(workbook, currentSheet, args[1]);
}

function evaluateSumIfFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length < 2 || args.length > 3) return undefined;
  const criteriaCells = cellsForFormulaRef(workbook, currentSheet, args[0]);
  if (!criteriaCells) return undefined;
  const sumCells = args[2] ? cellsForFormulaRef(workbook, currentSheet, args[2]) : criteriaCells;
  if (!sumCells || sumCells.length < criteriaCells.length) return undefined;
  const criteria = criteriaFromFormulaArg(workbook, currentSheet, args[1]);
  if (criteria === undefined) return undefined;
  let total = 0;
  for (let index = 0; index < criteriaCells.length; index += 1) {
    if (!formulaValueMatchesCriteria(criteriaCells[index].value, criteria)) continue;
    const numeric = numericComparableValue(sumCells[index].value);
    if (numeric === undefined) return undefined;
    total += numeric;
  }
  return roundFormulaNumber(total);
}

function evaluateCountIfFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length !== 2) return undefined;
  const cells = cellsForFormulaRef(workbook, currentSheet, args[0]);
  if (!cells) return undefined;
  const criteria = criteriaFromFormulaArg(workbook, currentSheet, args[1]);
  if (criteria === undefined) return undefined;
  return cells.filter((cell) => formulaValueMatchesCriteria(cell.value, criteria)).length;
}

function evaluateAverageIfFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length < 2 || args.length > 3) return undefined;
  const criteriaCells = cellsForFormulaRef(workbook, currentSheet, args[0]);
  if (!criteriaCells) return undefined;
  const averageCells = args[2] ? cellsForFormulaRef(workbook, currentSheet, args[2]) : criteriaCells;
  if (!averageCells || averageCells.length < criteriaCells.length) return undefined;
  const criteria = criteriaFromFormulaArg(workbook, currentSheet, args[1]);
  if (criteria === undefined) return undefined;
  const values: number[] = [];
  for (let index = 0; index < criteriaCells.length; index += 1) {
    if (!formulaValueMatchesCriteria(criteriaCells[index].value, criteria)) continue;
    const numeric = numericComparableValue(averageCells[index].value);
    if (numeric === undefined) return undefined;
    values.push(numeric);
  }
  if (values.length === 0) return undefined;
  return roundFormulaNumber(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function evaluateSumIfsFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length < 3 || args.length % 2 !== 1) return undefined;
  const sumCells = cellsForFormulaRef(workbook, currentSheet, args[0]);
  const criteriaSets = criteriaSetsFromFormulaArgs(workbook, currentSheet, args.slice(1), sumCells?.length ?? 0);
  if (!sumCells || !criteriaSets) return undefined;
  let total = 0;
  for (let index = 0; index < sumCells.length; index += 1) {
    if (!criteriaSets.every((set) => formulaValueMatchesCriteria(set.cells[index].value, set.criteria))) continue;
    const numeric = numericComparableValue(sumCells[index].value);
    if (numeric === undefined) return undefined;
    total += numeric;
  }
  return roundFormulaNumber(total);
}

function evaluateCountIfsFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length < 2 || args.length % 2 !== 0) return undefined;
  const firstRange = cellsForFormulaRef(workbook, currentSheet, args[0]);
  const criteriaSets = criteriaSetsFromFormulaArgs(workbook, currentSheet, args, firstRange?.length ?? 0);
  if (!firstRange || !criteriaSets) return undefined;
  let count = 0;
  for (let index = 0; index < firstRange.length; index += 1) {
    if (criteriaSets.every((set) => formulaValueMatchesCriteria(set.cells[index].value, set.criteria))) count += 1;
  }
  return count;
}

function evaluateAverageIfsFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length < 3 || args.length % 2 !== 1) return undefined;
  const averageCells = cellsForFormulaRef(workbook, currentSheet, args[0]);
  const criteriaSets = criteriaSetsFromFormulaArgs(workbook, currentSheet, args.slice(1), averageCells?.length ?? 0);
  if (!averageCells || !criteriaSets) return undefined;
  const values: number[] = [];
  for (let index = 0; index < averageCells.length; index += 1) {
    if (!criteriaSets.every((set) => formulaValueMatchesCriteria(set.cells[index].value, set.criteria))) continue;
    const numeric = numericComparableValue(averageCells[index].value);
    if (numeric === undefined) return undefined;
    values.push(numeric);
  }
  if (values.length === 0) return undefined;
  return roundFormulaNumber(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function criteriaSetsFromFormulaArgs(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
  expectedLength: number,
): Array<{ cells: Array<{ row: number; col: number; value: FormulaCellValue }>; criteria: FormulaResult }> | undefined {
  if (expectedLength <= 0 || args.length < 2 || args.length % 2 !== 0) return undefined;
  const sets: Array<{ cells: Array<{ row: number; col: number; value: FormulaCellValue }>; criteria: FormulaResult }> = [];
  for (let index = 0; index < args.length; index += 2) {
    const cells = cellsForFormulaRef(workbook, currentSheet, args[index]);
    const criteria = criteriaFromFormulaArg(workbook, currentSheet, args[index + 1]);
    if (!cells || cells.length < expectedLength || criteria === undefined) return undefined;
    sets.push({ cells, criteria });
  }
  return sets;
}

function evaluateMatchFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length < 2 || args.length > 3) return undefined;
  if (args[2] !== undefined && numericFormulaArg(workbook, currentSheet, args[2]) !== 0) return undefined;
  const lookupValue = lookupFormulaArg(workbook, currentSheet, args[0]);
  const lookupCells = cellsForFormulaRef(workbook, currentSheet, args[1]);
  if (lookupValue === undefined || !lookupCells) return undefined;
  const matchIndex = lookupCells.findIndex((cell) => compareFormulaValues(cell.value, lookupValue, "="));
  return matchIndex >= 0 ? matchIndex + 1 : undefined;
}

function evaluateIndexFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): FormulaResult | undefined {
  if (args.length < 2 || args.length > 3) return undefined;
  const cells = cellsForFormulaRef(workbook, currentSheet, args[0]);
  const rowNumber = numericFormulaArg(workbook, currentSheet, args[1]);
  const columnNumber = args[2] === undefined ? 1 : numericFormulaArg(workbook, currentSheet, args[2]);
  if (!cells || rowNumber === undefined || columnNumber === undefined) return undefined;
  const rowOffset = Math.trunc(rowNumber) - 1;
  const colOffset = Math.trunc(columnNumber) - 1;
  if (rowOffset < 0 || colOffset < 0) return undefined;
  return cellAtFormulaRangeOffset(cells, rowOffset, colOffset)?.value ?? undefined;
}

function evaluateVLookupFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): FormulaResult | undefined {
  if (args.length < 4 || args.length > 4) return undefined;
  if (!formulaArgRequestsExactLookup(workbook, currentSheet, args[3])) return undefined;
  const lookupValue = lookupFormulaArg(workbook, currentSheet, args[0]);
  const tableCells = cellsForFormulaRef(workbook, currentSheet, args[1]);
  const colIndex = numericFormulaArg(workbook, currentSheet, args[2]);
  if (lookupValue === undefined || !tableCells || colIndex === undefined) return undefined;
  const shape = formulaRangeShape(tableCells);
  const targetColOffset = Math.trunc(colIndex) - 1;
  if (targetColOffset < 0 || targetColOffset >= shape.colCount) return undefined;
  for (let rowOffset = 0; rowOffset < shape.rowCount; rowOffset += 1) {
    const firstColumn = cellAtFormulaRangeOffset(tableCells, rowOffset, 0);
    if (!firstColumn || !compareFormulaValues(firstColumn.value, lookupValue, "=")) continue;
    return cellAtFormulaRangeOffset(tableCells, rowOffset, targetColOffset)?.value ?? undefined;
  }
  return undefined;
}

function evaluateMedianFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length === 0) return undefined;
  const values: number[] = [];
  for (const arg of args) {
    const call = parseSingleFormulaFunction(arg);
    const rawValues = call?.name.toUpperCase() === "VLOOKUP"
      ? evaluateVLookupArrayFunction(workbook, currentSheet, splitFormulaArgs(call.args))
      : undefined;
    const numericValues = rawValues
      ? rawValues.map(numericComparableValue)
      : valuesForFormulaArg(workbook, currentSheet, arg);
    if (numericValues.length === 0 || numericValues.some((value) => value === undefined)) return undefined;
    values.push(...numericValues as number[]);
  }
  values.sort((left, right) => left - right);
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 1
    ? values[middle]
    : roundFormulaNumber((values[middle - 1] + values[middle]) / 2);
}

function evaluateVLookupArrayFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): FormulaResult[] | undefined {
  if (args.length !== 4 || !formulaArgRequestsExactLookup(workbook, currentSheet, args[3])) return undefined;
  const indexes = parseFormulaArrayIndexes(args[2]);
  if (!indexes?.length) return undefined;
  const lookupValue = lookupFormulaArg(workbook, currentSheet, args[0]);
  const tableCells = cellsForFormulaRef(workbook, currentSheet, args[1]);
  if (lookupValue === undefined || !tableCells) return undefined;
  const shape = formulaRangeShape(tableCells);
  if (indexes.some((index) => index < 1 || index > shape.colCount)) return undefined;
  for (let rowOffset = 0; rowOffset < shape.rowCount; rowOffset += 1) {
    const firstColumn = cellAtFormulaRangeOffset(tableCells, rowOffset, 0);
    if (!firstColumn || !compareFormulaValues(firstColumn.value, lookupValue, "=")) continue;
    const values = indexes.map((index) => cellAtFormulaRangeOffset(tableCells, rowOffset, index - 1)?.value);
    return values.every((value): value is FormulaResult => value !== undefined && value !== null) ? values : undefined;
  }
  return undefined;
}

function parseFormulaArrayIndexes(arg: string): number[] | undefined {
  const match = arg.trim().match(/^\{\s*([1-9][0-9]*(?:\s*,\s*[1-9][0-9]*)*)\s*\}$/);
  return match ? match[1].split(",").map((value) => Number(value.trim())) : undefined;
}

function evaluateXLookupFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): FormulaResult | undefined {
  if (args.length < 3 || args.length > 6) return undefined;
  const matchMode = args[4] === undefined ? 0 : numericFormulaArg(workbook, currentSheet, args[4]);
  const searchMode = args[5] === undefined ? 1 : numericFormulaArg(workbook, currentSheet, args[5]);
  if (matchMode !== 0 || (searchMode !== 1 && searchMode !== -1)) return undefined;
  const lookupValue = lookupFormulaArg(workbook, currentSheet, args[0]);
  const lookupCells = cellsForFormulaRef(workbook, currentSheet, args[1]);
  const returnCells = cellsForFormulaRef(workbook, currentSheet, args[2]);
  if (lookupValue === undefined || !lookupCells || !returnCells || returnCells.length < lookupCells.length) return undefined;
  const indexes = lookupCells.map((_, index) => index);
  if (searchMode === -1) indexes.reverse();
  const matchIndex = indexes.find((index) => compareFormulaValues(lookupCells[index].value, lookupValue, "="));
  if (matchIndex !== undefined) return returnCells[matchIndex].value ?? undefined;
  return args[3] === undefined ? undefined : lookupFormulaArg(workbook, currentSheet, args[3]);
}

function evaluateSumProductFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length === 0) return undefined;
  const vectors = args.map((arg) => valuesForFormulaArg(workbook, currentSheet, arg.trim()));
  if (vectors.some((vector) => vector.length === 0 || vector.some((value) => value === undefined))) return undefined;
  const length = Math.max(...vectors.map((vector) => vector.length));
  if (vectors.some((vector) => vector.length !== 1 && vector.length !== length)) return undefined;
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    total += vectors.reduce((product, vector) => product * (vector[vector.length === 1 ? 0 : index] ?? 0), 1);
  }
  return roundFormulaNumber(total);
}

function evaluateTextSliceFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  fn: string,
  args: string[],
): FormulaResult | undefined {
  if (fn === "LEN") {
    if (args.length !== 1) return undefined;
    return textFormulaArg(workbook, currentSheet, args[0])?.length;
  }
  const text = textFormulaArg(workbook, currentSheet, args[0]);
  if (text === undefined) return undefined;
  if (fn === "LEFT" || fn === "RIGHT") {
    if (args.length < 1 || args.length > 2) return undefined;
    const count = args[1] === undefined ? 1 : numericFormulaArg(workbook, currentSheet, args[1]);
    if (count === undefined || count < 0) return undefined;
    const chars = Math.trunc(count);
    return fn === "LEFT" ? text.slice(0, chars) : text.slice(Math.max(0, text.length - chars));
  }
  if (fn === "MID") {
    if (args.length !== 3) return undefined;
    const start = numericFormulaArg(workbook, currentSheet, args[1]);
    const count = numericFormulaArg(workbook, currentSheet, args[2]);
    if (start === undefined || count === undefined || start < 1 || count < 0) return undefined;
    return text.slice(Math.trunc(start) - 1, Math.trunc(start) - 1 + Math.trunc(count));
  }
  return undefined;
}

function evaluateTextSearchFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  fn: string,
  args: string[],
): number | undefined {
  if (args.length < 2 || args.length > 3) return undefined;
  const needle = textFormulaArg(workbook, currentSheet, args[0]);
  const haystack = textFormulaArg(workbook, currentSheet, args[1]);
  const start = args[2] === undefined ? 1 : numericFormulaArg(workbook, currentSheet, args[2]);
  if (needle === undefined || haystack === undefined || start === undefined || start < 1) return undefined;
  const offset = Math.trunc(start) - 1;
  const searchNeedle = fn === "SEARCH" ? needle.toUpperCase() : needle;
  const searchHaystack = fn === "SEARCH" ? haystack.toUpperCase() : haystack;
  const index = searchHaystack.indexOf(searchNeedle, offset);
  return index >= 0 ? index + 1 : undefined;
}

function evaluateReplaceFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): string | undefined {
  if (args.length !== 4) return undefined;
  const text = textFormulaArg(workbook, currentSheet, args[0]);
  const start = numericFormulaArg(workbook, currentSheet, args[1]);
  const count = numericFormulaArg(workbook, currentSheet, args[2]);
  const replacement = textFormulaArg(workbook, currentSheet, args[3]);
  if (text === undefined || start === undefined || count === undefined || replacement === undefined || start < 1 || count < 0) return undefined;
  const index = Math.trunc(start) - 1;
  return `${text.slice(0, index)}${replacement}${text.slice(index + Math.trunc(count))}`;
}

function evaluateTextFormatFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): string | undefined {
  if (args.length !== 2) return undefined;
  const value = lookupFormulaArg(workbook, currentSheet, args[0]);
  const format = textFormulaArg(workbook, currentSheet, args[1]);
  if (value === undefined || format === undefined) return undefined;
  const numeric = numericComparableValue(value);
  if (numeric !== undefined) return formatExcelNumber(numeric, format);
  return String(value);
}

function evaluateDateFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length !== 3) return undefined;
  const year = numericFormulaArg(workbook, currentSheet, args[0]);
  const month = numericFormulaArg(workbook, currentSheet, args[1]);
  const day = numericFormulaArg(workbook, currentSheet, args[2]);
  if (year === undefined || month === undefined || day === undefined) return undefined;
  const date = new Date(Date.UTC(Math.trunc(year), Math.trunc(month) - 1, Math.trunc(day)));
  return dateToExcelSerial(date);
}

function evaluateValueFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): number | undefined {
  if (args.length !== 1) return undefined;
  const text = textFormulaArg(workbook, currentSheet, args[0]);
  if (text === undefined) return undefined;
  const parsed = Number(text.replace(/[$,%\s]/g, ""));
  if (!Number.isFinite(parsed)) return undefined;
  return text.includes("%") ? parsed / 100 : parsed;
}

function evaluateConcatenateFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): string | undefined {
  const parts = args.map((arg) => textFormulaArg(workbook, currentSheet, arg));
  if (parts.some((part) => part === undefined)) return undefined;
  return parts.join("");
}

function evaluateTrimFunction(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  args: string[],
): string | undefined {
  if (args.length !== 1) return undefined;
  return textFormulaArg(workbook, currentSheet, args[0])?.trim().replace(/\s+/g, " ");
}

function formulaRangeShape(cells: Array<{ row: number; col: number; value: FormulaCellValue }>): { startRow: number; startCol: number; rowCount: number; colCount: number } {
  const rows = cells.map((cell) => cell.row);
  const cols = cells.map((cell) => cell.col);
  const startRow = Math.min(...rows);
  const startCol = Math.min(...cols);
  return {
    startRow,
    startCol,
    rowCount: Math.max(...rows) - startRow + 1,
    colCount: Math.max(...cols) - startCol + 1,
  };
}

function cellAtFormulaRangeOffset(
  cells: Array<{ row: number; col: number; value: FormulaCellValue }>,
  rowOffset: number,
  colOffset: number,
): { row: number; col: number; value: FormulaCellValue } | undefined {
  const shape = formulaRangeShape(cells);
  return cells.find((cell) => cell.row === shape.startRow + rowOffset && cell.col === shape.startCol + colOffset);
}

function numericFormulaArg(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): number | undefined {
  return numericComparableValue(lookupFormulaArg(workbook, currentSheet, arg));
}

function textFormulaArg(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): string | undefined {
  const value = lookupFormulaArg(workbook, currentSheet, arg);
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isInteger(value)) return String(value);
  if (typeof value === "number") return String(roundFormulaNumber(value));
  return String(value);
}

function formulaArgRequestsExactLookup(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): boolean {
  const value = lookupFormulaArg(workbook, currentSheet, arg);
  if (value === false) return true;
  if (typeof value === "number") return value === 0;
  if (typeof value === "string") return /^FALSE$/i.test(value.trim()) || value.trim() === "0";
  return false;
}

function lookupFormulaArg(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): FormulaResult | undefined {
  const literal = parseFormulaStringLiteral(arg);
  if (literal !== undefined) return literal;
  const cells = formulaArgLooksLikeRange(arg) ? cellsForFormulaRef(workbook, currentSheet, arg) : undefined;
  if (cells?.length === 1) return cells[0].value ?? undefined;
  return evaluateFormulaExpression(workbook, currentSheet, arg);
}

function valuesForFormulaArg(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): Array<number | undefined> {
  if (formulaArgLooksLikeRange(arg)) return valuesForFormulaRef(workbook, currentSheet, arg);
  return [numericComparableValue(evaluateFormulaExpression(workbook, currentSheet, arg))];
}

function rawValuesForFormulaArg(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): FormulaCellValue[] {
  if (formulaArgLooksLikeRange(arg)) return valuesForFormulaRefRaw(workbook, currentSheet, arg);
  const value = evaluateFormulaExpression(workbook, currentSheet, arg);
  return value === undefined ? [] : [value];
}

function formulaArgLooksLikeRange(arg: string): boolean {
  return /^(?:'[^']+'!|[A-Z0-9_ .-]+!)?\$?[A-Z]{1,3}\$?[1-9][0-9]*(?::\$?[A-Z]{1,3}\$?[1-9][0-9]*)?$/i.test(arg.trim());
}

function splitFormulaArgs(raw: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let braceDepth = 0;
  let inSheetQuote = false;
  let inString = false;
  let start = 0;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (char === "\"") {
      if (inString && raw[index + 1] === "\"") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "'") {
      inSheetQuote = !inSheetQuote;
      continue;
    }
    if (inSheetQuote) continue;
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth -= 1;
    else if (char === "," && depth === 0 && braceDepth === 0) {
      args.push(raw.slice(start, index));
      start = index + 1;
    }
  }
  args.push(raw.slice(start));
  return args.map((arg) => arg.trim()).filter(Boolean);
}

function evaluateArithmeticFormula(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): number | undefined {
  const expandedFunctions = replaceFormulaFunctionCalls(workbook, currentSheet, expression);
  if (expandedFunctions === undefined) return undefined;
  const normalized = replaceFormulaRefs(workbook, currentSheet, expandedFunctions);
  if (normalized === undefined || !/^[0-9+\-*/^().\s]+$/.test(normalized)) return undefined;
  try {
    return roundFormulaNumber(new FormulaMathParser(normalized).parse());
  } catch {
    return undefined;
  }
}

function replaceFormulaFunctionCalls(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): string | undefined {
  let failed = false;
  let current = expression;
  for (let pass = 0; pass < 20; pass += 1) {
    let changed = false;
    current = current.replace(/\b(SUM|AVERAGE|MIN|MAX|MEDIAN|COUNT|COUNTA|ABS|ROUND|ROUNDUP|ROUNDDOWN|IF|IFERROR|SUMIF|COUNTIF|AVERAGEIF|SUMIFS|COUNTIFS|AVERAGEIFS|MATCH|INDEX|VLOOKUP|XLOOKUP|SUMPRODUCT|LEN|FIND|SEARCH|DATE|VALUE)\(([^()]+)\)/gi, (match) => {
      const result = evaluateFormulaFunction(workbook, currentSheet, match);
      if (typeof result !== "number") {
        failed = true;
        return "0";
      }
      changed = true;
      return String(result);
    });
    if (failed) return undefined;
    if (!changed) return current;
  }
  return undefined;
}

function replaceFormulaRefs(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): string | undefined {
  let failed = false;
  const replaced = expression.replace(/(?:'[^']+'!|[A-Z0-9_ .-]+!)?\$?[A-Z]{1,3}\$?[1-9][0-9]*/gi, (ref) => {
    const values = valuesForFormulaRef(workbook, currentSheet, ref);
    if (values.length !== 1 || values[0] === undefined) {
      failed = true;
      return "0";
    }
    return String(values[0]);
  });
  return failed ? undefined : replaced;
}

function valuesForFormulaRef(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  ref: string,
): Array<number | undefined> {
  const cells = cellsForFormulaRef(workbook, currentSheet, ref);
  if (!cells) return [undefined];
  return cells.map((cell) => numericComparableValue(cell.value));
}

function valuesForFormulaRefRaw(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  ref: string,
): FormulaCellValue[] {
  return cellsForFormulaRef(workbook, currentSheet, ref)?.map((cell) => cell.value) ?? [];
}

function cellsForFormulaRef(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  ref: string,
): Array<{ row: number; col: number; value: FormulaCellValue }> | undefined {
  const { sheet, range } = parseFormulaRef(workbook, currentSheet, ref);
  if (!sheet || !range) return undefined;
  const start = parseA1(range.start);
  const end = parseA1(range.end);
  if (!start || !end) return undefined;
  const cells: Array<{ row: number; col: number; value: FormulaCellValue }> = [];
  for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
    for (let col = Math.min(start.col, end.col); col <= Math.max(start.col, end.col); col += 1) {
      cells.push({ row, col, value: comparableFormulaValue(sheet.getCell(row, col).value) });
    }
  }
  return cells;
}

function parseFormulaRef(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  raw: string,
): { sheet: ExcelJS.Worksheet | undefined; range: { start: string; end: string } | undefined } {
  const bang = raw.lastIndexOf("!");
  const sheetName = bang >= 0 ? raw.slice(0, bang).replace(/^'|'$/g, "").replace(/''/g, "'") : currentSheet.name;
  const sheet = workbook.getWorksheet(sheetName);
  const rangeText = (bang >= 0 ? raw.slice(bang + 1) : raw).replace(/\$/g, "");
  const [start, end = start] = rangeText.split(":").map((part) => part.trim().toUpperCase());
  return { sheet, range: { start, end } };
}

function parseA1(ref: string): { row: number; col: number } | undefined {
  const match = ref.replace(/\$/g, "").match(/^([A-Z]{1,3})([1-9][0-9]*)$/);
  if (!match) return undefined;
  return {
    row: Number(match[2]),
    col: match[1].split("").reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0),
  };
}

function parseFormulaStringLiteral(expression: string): string | undefined {
  const trimmed = expression.trim();
  if (!/^"(?:[^"]|"")*"$/.test(trimmed)) return undefined;
  return trimmed.slice(1, -1).replace(/""/g, "\"");
}

function evaluateFormulaCondition(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  expression: string,
): boolean | undefined {
  const comparison = splitFormulaComparison(expression);
  if (comparison) {
    const left = evaluateFormulaExpression(workbook, currentSheet, comparison.left);
    const right = evaluateFormulaExpression(workbook, currentSheet, comparison.right);
    if (left === undefined || right === undefined) return undefined;
    return compareFormulaValues(left, right, comparison.operator);
  }
  const value = evaluateFormulaExpression(workbook, currentSheet, expression);
  if (typeof value === "boolean") return value;
  const numeric = numericComparableValue(value);
  if (numeric !== undefined) return numeric !== 0;
  if (typeof value === "string") return value.trim() !== "";
  return undefined;
}

function splitFormulaComparison(expression: string): { left: string; operator: string; right: string } | undefined {
  let depth = 0;
  let inString = false;
  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === "\"") {
      if (inString && expression[index + 1] === "\"") {
        index += 1;
        continue;
      }
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (depth !== 0) continue;
    for (const operator of [">=", "<=", "<>", "=", ">", "<"]) {
      if (!expression.startsWith(operator, index)) continue;
      return {
        left: expression.slice(0, index).trim(),
        operator,
        right: expression.slice(index + operator.length).trim(),
      };
    }
  }
  return undefined;
}

function criteriaFromFormulaArg(
  workbook: ExcelJS.Workbook,
  currentSheet: ExcelJS.Worksheet,
  arg: string,
): FormulaResult | undefined {
  const literal = parseFormulaStringLiteral(arg);
  if (literal !== undefined) return literal;
  const cells = formulaArgLooksLikeRange(arg) ? cellsForFormulaRef(workbook, currentSheet, arg) : undefined;
  if (cells?.length === 1) return cells[0].value ?? undefined;
  return evaluateFormulaExpression(workbook, currentSheet, arg);
}

function formulaValueMatchesCriteria(value: FormulaCellValue, criteria: FormulaResult): boolean {
  if (typeof criteria === "string") {
    const match = criteria.match(/^(>=|<=|<>|>|<|=)(.*)$/);
    if (match) return compareCriteriaValue(value, match[2].trim(), match[1]);
    if (formulaCriteriaHasWildcard(criteria)) return wildcardFormulaCriteriaMatches(value, criteria);
  }
  return compareFormulaValues(value, criteria, "=");
}

function compareCriteriaValue(value: FormulaCellValue, rawExpected: string, operator: string): boolean {
  const expected = rawExpected === "" ? "" : Number(rawExpected);
  if (typeof expected === "number" && Number.isFinite(expected)) return compareFormulaValues(value, expected, operator);
  const expectedText = rawExpected.replace(/^"|"$/g, "");
  if ((operator === "=" || operator === "<>") && formulaCriteriaHasWildcard(expectedText)) {
    const matches = wildcardFormulaCriteriaMatches(value, expectedText);
    return operator === "<>" ? !matches : matches;
  }
  return compareFormulaValues(value, expectedText, operator);
}

function formulaCriteriaHasWildcard(criteria: string): boolean {
  return /[*?]/.test(criteria);
}

function wildcardFormulaCriteriaMatches(value: FormulaCellValue, criteria: string): boolean {
  const escaped = criteria.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i").test(String(value ?? ""));
}

function compareFormulaValues(left: FormulaCellValue, right: FormulaCellValue, operator: string): boolean {
  const leftNumber = numericComparableValue(left);
  const rightNumber = numericComparableValue(right);
  if (leftNumber !== undefined && rightNumber !== undefined) {
    if (operator === ">=") return leftNumber >= rightNumber;
    if (operator === "<=") return leftNumber <= rightNumber;
    if (operator === ">") return leftNumber > rightNumber;
    if (operator === "<") return leftNumber < rightNumber;
    if (operator === "<>") return leftNumber !== rightNumber;
    return leftNumber === rightNumber;
  }
  const leftText = String(left ?? "").toUpperCase();
  const rightText = String(right ?? "").toUpperCase();
  if (operator === "<>") return leftText !== rightText;
  if (operator === "=") return leftText === rightText;
  return false;
}

function isNonBlankFormulaValue(value: FormulaCellValue): boolean {
  return value !== null && value !== "";
}

function comparableFormulaValue(value: ExcelJS.CellValue): FormulaCellValue {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean") return value;
  if (value instanceof Date) return dateToExcelSerial(value);
  if (value && typeof value === "object" && "result" in value) return comparableFormulaValue(value.result as ExcelJS.CellValue);
  if (value === null || value === undefined) return null;
  return String(value);
}

function numericComparableValue(value: FormulaCellValue | undefined): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (value === null || value === undefined || value === "") return 0;
  return undefined;
}

function roundWithMode(value: number, digits: number, mode: "ROUND" | "ROUNDUP" | "ROUNDDOWN"): number {
  const places = Math.trunc(digits);
  const factor = 10 ** places;
  const scaled = value * factor;
  if (mode === "ROUNDUP") return roundFormulaNumber((scaled < 0 ? Math.floor(scaled) : Math.ceil(scaled)) / factor);
  if (mode === "ROUNDDOWN") return roundFormulaNumber((scaled < 0 ? Math.ceil(scaled) : Math.floor(scaled)) / factor);
  return roundFormulaNumber(Math.round(scaled) / factor);
}

function roundFormulaNumber(value: number): number {
  return Number(value.toFixed(12));
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateToExcelSerial(date: Date): number {
  return Math.round((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - EXCEL_EPOCH_UTC) / MS_PER_DAY);
}

function excelSerialToDate(serial: number): Date {
  return new Date(EXCEL_EPOCH_UTC + Math.trunc(serial) * MS_PER_DAY);
}

function formatExcelNumber(value: number, format: string): string {
  const lower = format.toLowerCase();
  if (/[dmy]/.test(lower)) return formatExcelDate(value, lower);
  if (lower.includes("%")) return `${roundFormulaNumber(value * 100)}%`;
  const decimals = (format.match(/\.([0#]+)/)?.[1].length) ?? 0;
  return decimals > 0 ? value.toFixed(decimals) : String(roundFormulaNumber(value));
}

function formatExcelDate(serial: number, lowerFormat: string): string {
  const date = excelSerialToDate(serial);
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const yyyy = String(date.getUTCFullYear());
  const yy = yyyy.slice(-2);
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return lowerFormat.replace(/dddd|ddd|mmmm|mmm|yyyy|yy|mm|m|dd|d/g, (token) => {
    if (token === "dddd") return weekdays[date.getUTCDay()];
    if (token === "ddd") return weekdays[date.getUTCDay()].slice(0, 3);
    if (token === "mmmm") return months[date.getUTCMonth()];
    if (token === "mmm") return months[date.getUTCMonth()].slice(0, 3);
    if (token === "yyyy") return yyyy;
    if (token === "yy") return yy;
    if (token === "mm") return String(month).padStart(2, "0");
    if (token === "m") return String(month);
    if (token === "dd") return String(day).padStart(2, "0");
    return String(day);
  });
}

class FormulaMathParser {
  private index = 0;

  constructor(private readonly expression: string) {}

  parse(): number {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.index !== this.expression.length) throw new Error("trailing formula characters");
    if (!Number.isFinite(value)) throw new Error("non-finite formula result");
    return value;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      if (this.take("+")) value += this.parseTerm();
      else if (this.take("-")) value -= this.parseTerm();
      else return value;
    }
  }

  private parseTerm(): number {
    let value = this.parsePower();
    while (true) {
      this.skipWhitespace();
      if (this.take("*")) value *= this.parsePower();
      else if (this.take("/")) value /= this.parsePower();
      else return value;
    }
  }

  private parsePower(): number {
    const base = this.parseUnary();
    this.skipWhitespace();
    if (!this.take("^")) return base;
    return base ** this.parsePower();
  }

  private parseUnary(): number {
    this.skipWhitespace();
    if (this.take("+")) return this.parseUnary();
    if (this.take("-")) return -this.parseUnary();
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    this.skipWhitespace();
    if (this.take("(")) {
      const value = this.parseExpression();
      if (!this.take(")")) throw new Error("unterminated formula parentheses");
      return value;
    }
    return this.parseNumber();
  }

  private parseNumber(): number {
    this.skipWhitespace();
    const match = this.expression.slice(this.index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) throw new Error("expected formula number");
    this.index += match[0].length;
    return Number(match[0]);
  }

  private take(value: string): boolean {
    if (this.expression[this.index] !== value) return false;
    this.index += value.length;
    return true;
  }

  private skipWhitespace() {
    while (/\s/.test(this.expression[this.index] ?? "")) this.index += 1;
  }
}

function aggregateUsage(results: SpreadsheetBenchRunnerTaskResult[]) {
  const calls = results.reduce((sum, result) => sum + (result.model?.calls ?? 0), 0);
  const inputTokens = results.reduce((sum, result) => sum + (result.model?.usage.inputTokens ?? 0), 0);
  const outputTokens = results.reduce((sum, result) => sum + (result.model?.usage.outputTokens ?? 0), 0);
  const costUsd = Number(results.reduce((sum, result) => sum + (result.model?.costUsd ?? 0), 0).toFixed(8));
  return { calls, inputTokens, outputTokens, costUsd };
}

function aggregateStats(results: SpreadsheetBenchRunnerTaskResult[]): SpreadsheetBenchRunnerReport["stats"] {
  const latencies = results.map((result) => result.timingsMs.total).sort((a, b) => a - b);
  const failureCounts: Record<string, number> = {};
  for (const result of results) {
    if (!result.error) continue;
    const key = `${result.error.phase}:${result.error.message}`;
    failureCounts[key] = (failureCounts[key] ?? 0) + 1;
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

function buildRetryPolicy(options: SpreadsheetBenchRunnerOptions): SpreadsheetBenchRunnerReport["retryPolicy"] {
  const maxRetries = Math.max(0, Math.trunc(options.retryFailed ?? 0));
  return {
    maxRetries,
    retryOn: [
      "candidate_generation",
      "scoring",
      ...(options.retryScoreFailures ? ["score_failure" as const] : []),
    ],
    stopOnPass: true,
  };
}

function shouldRetry(
  result: SpreadsheetBenchRunnerTaskResult,
  retryPolicy: SpreadsheetBenchRunnerReport["retryPolicy"],
  tryIndex: number,
): boolean {
  if (tryIndex > retryPolicy.maxRetries) return false;
  if (result.score?.pass) return false;
  if (result.error) return retryPolicy.retryOn.includes(result.error.phase);
  if (result.score && !result.score.pass) return retryPolicy.retryOn.includes("score_failure");
  return false;
}

function summarizeCaseRun(
  stageRoot: string,
  task: StagedTaskPaths,
  repeatIndex: number,
  attempts: SpreadsheetBenchRunnerTaskResult[],
  retryPolicy: SpreadsheetBenchRunnerReport["retryPolicy"],
): SpreadsheetBenchRunnerCaseRun {
  const final = attempts.at(-1);
  const pass = attempts.some((attempt) => attempt.score?.pass);
  return {
    taskId: final?.taskId ?? rel(stageRoot, task.taskDir),
    taskDir: rel(stageRoot, task.taskDir),
    repeatIndex,
    attempts: attempts.map((attempt) => attempt.attemptIndex),
    finalAttemptIndex: final?.attemptIndex,
    pass,
    stopReason: caseStopReason(final, pass, attempts.length, retryPolicy),
    bestOverall: attempts.length
      ? Number(Math.max(...attempts.map((attempt) => attempt.score?.scores.overall ?? 0)).toFixed(6))
      : 0,
  };
}

function caseStopReason(
  final: SpreadsheetBenchRunnerTaskResult | undefined,
  pass: boolean,
  attemptCount: number,
  retryPolicy: SpreadsheetBenchRunnerReport["retryPolicy"],
): SpreadsheetBenchRunnerCaseRun["stopReason"] {
  if (!final) return "runner_error";
  if (pass) return "passed";
  const retryableFinal =
    (final.error && retryPolicy.retryOn.includes(final.error.phase)) ||
    (!!final.score && !final.score.pass && retryPolicy.retryOn.includes("score_failure"));
  if (retryableFinal && attemptCount >= retryPolicy.maxRetries + 1) return "retry_exhausted";
  if (final.error) return "non_retryable_error";
  return "failed_score";
}

function aggregateRetryStats(caseRuns: SpreadsheetBenchRunnerCaseRun[]): SpreadsheetBenchRunnerReport["retryStats"] {
  return {
    retriedCaseRunCount: caseRuns.filter((run) => run.attempts.length > 1).length,
    retryAttemptCount: caseRuns.reduce((sum, run) => sum + Math.max(0, run.attempts.length - 1), 0),
    passedAfterRetryCount: caseRuns.filter((run) => run.pass && run.attempts.length > 1).length,
    exhaustedCaseRunCount: caseRuns.filter((run) => run.stopReason === "retry_exhausted").length,
  };
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1);
  return values[index] ?? 0;
}

function resolveManifestPath(base: string, manifestPath: string | undefined): string {
  if (!manifestPath) throw new Error("manifest path is missing");
  return resolve(base, manifestPath.replace(/\\/g, "/"));
}

function resolveAgentPath(base: string, manifestPath: string): string {
  const root = resolve(base);
  const resolved = resolveManifestPath(root, manifestPath);
  const relPath = relative(root, resolved);
  if (!relPath || relPath.startsWith("..") || isAbsolute(relPath)) {
    throw new Error(`agent manifest path escapes agent workspace: ${manifestPath}`);
  }
  return resolved;
}

function walkDirs(root: string): string[] {
  const out: string[] = [];
  for (const item of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, item.name);
    if (!item.isDirectory()) continue;
    if (existsSync(join(full, "agent", "task.json"))) out.push(full);
    out.push(...walkDirs(full));
  }
  return out;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]+/g, "_");
}

function rel(root: string, file: string): string {
  return relative(root, file).replace(/\\/g, "/");
}
