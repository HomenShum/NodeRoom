export interface BankerToolBenchSweepTask {
  taskId: string;
  jobName?: string;
  jobDir?: string;
  resultPath?: string;
  status?: string;
  trialId?: string | null;
  reward?: number | null;
  mean?: number | null;
  rawScore?: number | null;
  maximumScore?: number | null;
  completedTrials?: number | null;
  erroredTrials?: number | null;
  plannerTransport?: string | null;
  modelCalls?: number | null;
  materializerModeReceipt?: string | null;
  genericWriterOnly?: boolean | null;
  generalFamilyMaterializersEnabled?: boolean | null;
  replayMaterializersEnabled?: boolean | null;
  boundaryReceiptCount?: number | null;
  supportedBoundaryReceipts?: number | null;
  cleanCapabilityAccepted?: boolean | null;
  cleanCapabilityRejectionReasons?: string[] | null;
}

export interface BankerToolBenchSweepSummary {
  schema?: string;
  generatedAt?: string;
  repoRoot?: string;
  runRoot?: string;
  jobNamePrefix?: string;
  modelId?: string;
  candidateModel?: string;
  materializerMode?: string;
  allowFallbackPlan?: boolean;
  forceModelPlanner?: boolean;
  selectedTasks?: number;
  completedTasks?: number;
  erroredTasks?: number;
  missingTasks?: number;
  meanReward?: number | null;
  cleanCapabilityAcceptedTasks?: number | null;
  cleanCapabilityMeanReward?: number | null;
  dryRun?: boolean;
  summaryOnly?: boolean;
  tasks?: BankerToolBenchSweepTask[];
}

export interface BtbLedgerTask {
  taskId: string;
  reward: number;
  raw?: string;
  exceptions: number;
  firedWriter: string;
  cleanGeneralProbe: boolean;
  modelCalls: number;
  plannerTransport?: string;
  trialId?: string;
  verdict: string;
  source: {
    status: string;
    jobName?: string;
    jobDir?: string;
    resultPath?: string;
  };
  boundary: {
    supported: number | null;
    total: number | null;
    fullySupported: boolean;
  };
  rejectionReasons: string[];
}

export interface BtbLedgerRun {
  iterationLabel: string;
  benchmark: "bankertoolbench";
  model?: string;
  materializerMode: string;
  taskCount: number;
  notes: string;
  sourcePath?: string;
  generatedAt?: string;
  summary: {
    selectedTasks: number;
    completedTasks: number;
    erroredTasks: number;
    missingTasks: number;
    meanReward: number | null;
    cleanAcceptedTasks: number;
    cleanMeanReward: number | null;
    normalizedCleanAcceptedTasks: number;
    normalizedCleanMeanReward: number | null;
  };
  tasks: BtbLedgerTask[];
}

export interface BtbLedgerImport {
  schema: "noderoom-btb-ledger-import-v1";
  generatedAt: string;
  runs: BtbLedgerRun[];
  totals: {
    runs: number;
    tasks: number;
    cleanAcceptedTasks: number;
    cleanMeanReward: number | null;
  };
}

export interface ConvexBtbLedgerRunPayload {
  iterationLabel: string;
  benchmark: "bankertoolbench";
  model?: string;
  materializerMode: string;
  taskCount: number;
  notes?: string;
  tasks: Array<{
    taskId: string;
    reward: number;
    raw?: string;
    exceptions: number;
    firedWriter: string;
    cleanGeneralProbe: boolean;
    modelCalls: number;
    plannerTransport?: string;
    trialId?: string;
    verdict?: string;
  }>;
}

export function buildBtbLedgerImport(args: {
  summaries: Array<{ path?: string; summary: BankerToolBenchSweepSummary }>;
  generatedAt?: string;
}): BtbLedgerImport {
  const runs = args.summaries.map(({ path, summary }) => normalizeBtbSweepSummary(summary, { sourcePath: path }));
  const counted = runs.flatMap((run) => run.tasks.filter((task) => task.cleanGeneralProbe && task.modelCalls > 0));
  return {
    schema: "noderoom-btb-ledger-import-v1",
    generatedAt: args.generatedAt ?? new Date().toISOString(),
    runs,
    totals: {
      runs: runs.length,
      tasks: runs.reduce((sum, run) => sum + run.tasks.length, 0),
      cleanAcceptedTasks: counted.length,
      cleanMeanReward: mean(counted.map((task) => task.reward)),
    },
  };
}

export function normalizeBtbSweepSummary(
  summary: BankerToolBenchSweepSummary,
  options: { sourcePath?: string } = {},
): BtbLedgerRun {
  const tasks = summary.tasks ?? [];
  const normalizedTasks = tasks.map((task) => normalizeBtbSweepTask(task, summary));
  const counted = normalizedTasks.filter((task) => task.cleanGeneralProbe && task.modelCalls > 0);
  const iterationLabel = summary.jobNamePrefix ?? labelFromPath(options.sourcePath) ?? "btb-ledger-import";
  return {
    iterationLabel,
    benchmark: "bankertoolbench",
    model: summary.modelId ?? summary.candidateModel,
    materializerMode: summary.materializerMode ?? "unknown",
    taskCount: numberOr(summary.selectedTasks, normalizedTasks.length),
    notes: [
      `source=${options.sourcePath ?? "inline"}`,
      `generatedAt=${summary.generatedAt ?? "unknown"}`,
      `forceModelPlanner=${String(summary.forceModelPlanner ?? "unknown")}`,
      `allowFallbackPlan=${String(summary.allowFallbackPlan ?? "unknown")}`,
      `summaryOnly=${String(summary.summaryOnly ?? false)}`,
      `dryRun=${String(summary.dryRun ?? false)}`,
      `reportedCleanAccepted=${String(summary.cleanCapabilityAcceptedTasks ?? "unknown")}`,
      `reportedCleanMean=${String(summary.cleanCapabilityMeanReward ?? "unknown")}`,
    ].join("; "),
    sourcePath: options.sourcePath,
    generatedAt: summary.generatedAt,
    summary: {
      selectedTasks: numberOr(summary.selectedTasks, normalizedTasks.length),
      completedTasks: numberOr(summary.completedTasks, normalizedTasks.filter((task) => task.source.status === "finished").length),
      erroredTasks: numberOr(summary.erroredTasks, normalizedTasks.filter((task) => task.source.status === "errored").length),
      missingTasks: numberOr(summary.missingTasks, normalizedTasks.filter((task) => task.source.status === "missing").length),
      meanReward: typeof summary.meanReward === "number" ? summary.meanReward : null,
      cleanAcceptedTasks: numberOr(summary.cleanCapabilityAcceptedTasks, counted.length),
      cleanMeanReward: typeof summary.cleanCapabilityMeanReward === "number" ? summary.cleanCapabilityMeanReward : null,
      normalizedCleanAcceptedTasks: counted.length,
      normalizedCleanMeanReward: mean(counted.map((task) => task.reward)),
    },
    tasks: normalizedTasks,
  };
}

export function toConvexBtbLedgerPayload(run: BtbLedgerRun): ConvexBtbLedgerRunPayload {
  return {
    iterationLabel: run.iterationLabel,
    benchmark: run.benchmark,
    model: run.model,
    materializerMode: run.materializerMode,
    taskCount: run.taskCount,
    notes: run.notes,
    tasks: run.tasks.map((task) => ({
      taskId: task.taskId,
      reward: task.reward,
      raw: task.raw,
      exceptions: task.exceptions,
      firedWriter: task.firedWriter,
      cleanGeneralProbe: task.cleanGeneralProbe,
      modelCalls: task.modelCalls,
      plannerTransport: task.plannerTransport,
      trialId: task.trialId,
      verdict: task.verdict,
    })),
  };
}

export function normalizeBtbSweepTask(
  task: BankerToolBenchSweepTask,
  summary: Pick<BankerToolBenchSweepSummary, "materializerMode"> = {},
): BtbLedgerTask {
  const rejectionReasons = task.cleanCapabilityRejectionReasons ?? [];
  const supported = typeof task.supportedBoundaryReceipts === "number" ? task.supportedBoundaryReceipts : null;
  const total = typeof task.boundaryReceiptCount === "number" ? task.boundaryReceiptCount : null;
  const cleanGeneralProbe = task.cleanCapabilityAccepted === true;
  const reward = typeof task.reward === "number" ? task.reward : typeof task.mean === "number" ? task.mean : 0;
  const modelCalls = typeof task.modelCalls === "number" ? task.modelCalls : 0;
  const status = task.status ?? "unknown";
  const accepted = cleanGeneralProbe && modelCalls > 0;
  return {
    taskId: task.taskId,
    reward,
    raw: rawScore(task),
    exceptions: Math.max(0, numberOr(task.erroredTrials, status === "errored" ? 1 : 0)),
    firedWriter: firedWriter(task, summary.materializerMode),
    cleanGeneralProbe,
    modelCalls,
    plannerTransport: optionalString(task.plannerTransport),
    trialId: optionalString(task.trialId),
    verdict: renderVerdict({ accepted, status, rejectionReasons, supported, total, jobName: task.jobName }),
    source: {
      status,
      jobName: task.jobName,
      jobDir: task.jobDir,
      resultPath: task.resultPath,
    },
    boundary: {
      supported,
      total,
      fullySupported: supported !== null && total !== null && supported === total,
    },
    rejectionReasons,
  };
}

function firedWriter(task: BankerToolBenchSweepTask, summaryMode?: string): string {
  if (task.genericWriterOnly === true && task.generalFamilyMaterializersEnabled === false && task.replayMaterializersEnabled === false) {
    return "generic-quartet";
  }
  if (task.materializerModeReceipt) return task.materializerModeReceipt;
  if (summaryMode) return summaryMode;
  return "unknown";
}

function rawScore(task: BankerToolBenchSweepTask): string | undefined {
  if (typeof task.rawScore === "number" && typeof task.maximumScore === "number") {
    return `${trimNumber(task.rawScore)} / ${trimNumber(task.maximumScore)}`;
  }
  return undefined;
}

function renderVerdict(args: {
  accepted: boolean;
  status: string;
  rejectionReasons: string[];
  supported: number | null;
  total: number | null;
  jobName?: string;
}): string {
  const boundary = args.supported === null || args.total === null ? "unknown" : `${args.supported}/${args.total}`;
  const reasons = args.rejectionReasons.length ? args.rejectionReasons.join(",") : "none";
  return [
    args.accepted ? "accepted" : "rejected",
    `status=${args.status}`,
    `reasons=${reasons}`,
    `boundary=${boundary}`,
    ...(args.jobName ? [`job=${args.jobName}`] : []),
  ].join("; ");
}

function numberOr(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function optionalString(value: string | null | undefined): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function labelFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const file = path.split(/[\\/]/).pop();
  return file?.replace(/\.json$/i, "");
}

function trimNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}
