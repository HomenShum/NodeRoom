import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";

export const SPREADSHEETBENCH_V2_CATEGORIES = [
  "Debugging",
  "Financial_Model",
  "Template",
  "Visualization",
] as const;

export type SpreadsheetBenchV2Category = (typeof SPREADSHEETBENCH_V2_CATEGORIES)[number];
export type SpreadsheetBenchV2DeterministicCategory = Exclude<SpreadsheetBenchV2Category, "Visualization">;

export const SPREADSHEETBENCH_V2_EXPECTED_CATEGORY_COUNTS: Readonly<Record<SpreadsheetBenchV2Category, number>> = {
  Debugging: 100,
  Financial_Model: 100,
  Template: 97,
  Visualization: 24,
};

export const SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT = 321;

/** The last accepted V2 score is a floor, not a target. Modification must improve strictly. */
export const SPREADSHEETBENCH_V2_ACCEPTED_BASELINES: Readonly<
  Record<SpreadsheetBenchV2DeterministicCategory, { modificationAccuracy: number; regressionAccuracy: number }>
> = {
  Debugging: { modificationAccuracy: 0.2681, regressionAccuracy: 0.998 },
  Financial_Model: { modificationAccuracy: 0.1015, regressionAccuracy: 0.9499 },
  Template: { modificationAccuracy: 0.039, regressionAccuracy: 0.9998 },
};

const SHA256_RE = /^[a-f0-9]{64}$/i;
const DETERMINISTIC_CATEGORIES = SPREADSHEETBENCH_V2_CATEGORIES.filter(
  (category): category is SpreadsheetBenchV2DeterministicCategory => category !== "Visualization",
);

export type SpreadsheetBenchV2GateStatus = "pass" | "blocked";

export type SpreadsheetBenchV2ArtifactEvidence = {
  path?: string;
  status: "present" | "missing" | "invalid" | "unconfigured";
  sha256?: string;
  bytes?: number;
  reason?: string;
};

export type SpreadsheetBenchV2OfficialResultAudit = {
  category: SpreadsheetBenchV2Category;
  valid: boolean;
  taskCount: number;
  uniqueTaskCount: number;
  exactPassCount: number;
  regressionAccuracy?: number;
  modificationAccuracy?: number;
  evaluatedByVlm?: number;
  realVlmPassCount?: number;
  errors: string[];
};

export type SpreadsheetBenchV2TaskReceiptAudit = {
  taskId: string;
  category?: SpreadsheetBenchV2Category;
  traceReceiptValid: boolean;
  candidateReceiptValid: boolean;
  scorerReceiptValid: boolean;
  editPlanOperationCount?: number;
  emptyPlanExplained?: boolean;
  errors?: string[];
};

export type SpreadsheetBenchV2QualityGateInput = {
  officialReceipt?: unknown;
  officialResultAudits?: SpreadsheetBenchV2OfficialResultAudit[];
  taskReceiptAudits?: SpreadsheetBenchV2TaskReceiptAudit[];
  /** Structural fallback for callers that already loaded model-run receipts. Path mode performs deeper hash checks. */
  modelRunReceipts?: unknown[];
  authenticityErrors?: string[];
  provenanceErrors?: string[];
  artifacts?: SpreadsheetBenchV2QualityGateVerdict["artifacts"];
};

export type SpreadsheetBenchV2QualityGatePaths = {
  officialReceiptPath?: string;
  modelRunReceiptPaths?: string[];
  receiptRoots?: string[];
  cwd?: string;
};

export type SpreadsheetBenchV2CategoryQuality = {
  category: SpreadsheetBenchV2DeterministicCategory;
  taskCount: number | null;
  exactPassCount: number | null;
  modificationAccuracy: number | null;
  modificationBaseline: number;
  modificationDelta: number | null;
  regressionAccuracy: number | null;
  regressionBaseline: number;
  regressionDelta: number | null;
  exactPassesPass: boolean;
  modificationImprovementPass: boolean;
  regressionNoDeclinePass: boolean;
  pass: boolean;
};

export type SpreadsheetBenchV2QualityGateVerdict = {
  schema: "noderoom-spreadsheetbench-v2-quality-gate-v1";
  track: "spreadsheetbench-v2";
  expectedTaskCount: 321;
  status: SpreadsheetBenchV2GateStatus;
  pass: boolean;
  scorerAuthenticity: {
    status: SpreadsheetBenchV2GateStatus;
    authentic: boolean;
    acceptedReceipt: boolean;
    errors: string[];
  };
  coverage: {
    status: SpreadsheetBenchV2GateStatus;
    officialScoredTaskCount: number | null;
    officialCategoryTaskCount: number;
    modelRunTaskCount: number;
    uniqueModelRunTaskCount: number;
    traceReceiptCount: number;
    candidateReceiptCount: number;
    scorerReceiptCount: number;
    categoryTaskCounts: Record<SpreadsheetBenchV2Category, number>;
    duplicateTaskIds: string[];
  };
  provenance: {
    status: SpreadsheetBenchV2GateStatus;
    valid: boolean;
    invalidTaskIds: string[];
    emptyEditingPlanCount: number;
    explainedEmptyEditingPlanCount: number;
    unexplainedEmptyEditingPlanIds: string[];
    errors: string[];
  };
  performance: {
    status: SpreadsheetBenchV2GateStatus;
    pass: boolean;
    categories: Record<SpreadsheetBenchV2DeterministicCategory, SpreadsheetBenchV2CategoryQuality>;
    visualization: {
      taskCount: number | null;
      exactPassCount: number | null;
      evaluatedByVlm: number | null;
      judgeCalls: number | null;
      realVlmPassCount: number;
      exactPassesPass: boolean;
      realVlmPassesPass: boolean;
      pass: boolean;
    };
    errors: string[];
  };
  gates: Array<{
    id:
      | "scorer_authenticity"
      | "official_coverage"
      | "trace_candidate_scorer_receipts"
      | "editing_plan_integrity"
      | "category_performance"
      | "visualization_vlm";
    status: SpreadsheetBenchV2GateStatus;
    reason: string;
  }>;
  artifacts: {
    officialReceipt: SpreadsheetBenchV2ArtifactEvidence;
    deterministicEvaluator?: SpreadsheetBenchV2ArtifactEvidence;
    visualEvaluator?: SpreadsheetBenchV2ArtifactEvidence;
    projectionReceipt?: SpreadsheetBenchV2ArtifactEvidence;
    refreshReceipt?: SpreadsheetBenchV2ArtifactEvidence;
    officialResults: Partial<Record<SpreadsheetBenchV2Category, SpreadsheetBenchV2ArtifactEvidence>>;
    modelRunReceipts: SpreadsheetBenchV2ArtifactEvidence[];
  };
  blockers: string[];
  claim: string;
};

type ProjectionCase = {
  taskId: string;
  category: SpreadsheetBenchV2Category;
  id: string;
  model: string;
  modelCalls: number;
  source: string;
  sourceSha256: string;
  output: string;
  outputSha256: string;
};

type LoadedArtifact = {
  absolutePath: string;
  evidence: SpreadsheetBenchV2ArtifactEvidence;
  content?: Buffer;
  value?: unknown;
};

type LoadedProjection = {
  cases: ProjectionCase[];
  reportSha256?: string;
  value?: Record<string, unknown>;
};

export function defaultSpreadsheetBenchV2QualityGateInputs(): Required<
  Pick<SpreadsheetBenchV2QualityGatePaths, "officialReceiptPath" | "modelRunReceiptPaths">
> {
  return {
    officialReceiptPath: "docs/eval/spreadsheetbench-v2-accepted-official-scorer-receipt.json",
    modelRunReceiptPaths: ["docs/eval/spreadsheetbench-v2-321-model-run.json"],
  };
}

export function evaluateSpreadsheetBenchV2QualityGate(
  input: SpreadsheetBenchV2QualityGateInput,
): SpreadsheetBenchV2QualityGateVerdict {
  const receipt = asRecord(input.officialReceipt);
  const resultAudits = input.officialResultAudits ?? [];
  const taskAudits = input.taskReceiptAudits ?? structuralTaskAudits(input.modelRunReceipts ?? []);
  const metrics = categoryMetrics(receipt);
  const score = asRecord(receipt.score);
  const officialScoredTaskCount = finiteNumber(score.scoredTaskCount);

  const authenticityErrors = validateOfficialReceipt(receipt, metrics, resultAudits, input.authenticityErrors ?? []);
  const scorerAuthentic = authenticityErrors.length === 0;

  const byTaskId = new Map<string, SpreadsheetBenchV2TaskReceiptAudit>();
  const duplicateTaskIds = new Set<string>();
  for (const audit of taskAudits) {
    if (!audit.taskId) continue;
    if (byTaskId.has(audit.taskId)) duplicateTaskIds.add(audit.taskId);
    else byTaskId.set(audit.taskId, audit);
  }
  const uniqueAudits = [...byTaskId.values()];
  const categoryTaskCounts = Object.fromEntries(
    SPREADSHEETBENCH_V2_CATEGORIES.map((category) => [
      category,
      uniqueAudits.filter((audit) => normalizedCategory(audit.category, audit.taskId) === category).length,
    ]),
  ) as Record<SpreadsheetBenchV2Category, number>;

  const traceReceiptIds = validReceiptIds(uniqueAudits, "traceReceiptValid");
  const candidateReceiptIds = validReceiptIds(uniqueAudits, "candidateReceiptValid");
  const scorerReceiptIds = validReceiptIds(uniqueAudits, "scorerReceiptValid");
  const officialCategoryTaskCount = SPREADSHEETBENCH_V2_CATEGORIES.reduce(
    (sum, category) => sum + (finiteNumber(metrics[category]?.taskCount) ?? 0),
    0,
  );
  const officialCoveragePass =
    officialScoredTaskCount === SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT
    && officialCategoryTaskCount === SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT
    && SPREADSHEETBENCH_V2_CATEGORIES.every(
      (category) => finiteNumber(metrics[category]?.taskCount) === SPREADSHEETBENCH_V2_EXPECTED_CATEGORY_COUNTS[category],
    );

  const invalidTaskIds = uniqueAudits
    .filter((audit) =>
      !audit.traceReceiptValid
      || !audit.candidateReceiptValid
      || !audit.scorerReceiptValid
      || !Number.isInteger(audit.editPlanOperationCount)
      || (audit.errors?.length ?? 0) > 0,
    )
    .map((audit) => audit.taskId)
    .sort();
  const emptyAudits = uniqueAudits.filter((audit) => audit.editPlanOperationCount === 0);
  const unexplainedEmptyEditingPlanIds = emptyAudits
    .filter((audit) => audit.emptyPlanExplained !== true)
    .map((audit) => audit.taskId)
    .sort();

  const provenanceErrors = [...(input.provenanceErrors ?? [])];
  if (taskAudits.length !== SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT) {
    provenanceErrors.push(`model-run receipt must contain exactly 321 task results; found ${taskAudits.length}`);
  }
  if (uniqueAudits.length !== SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT) {
    provenanceErrors.push(`model-run receipt must cover exactly 321 unique task IDs; found ${uniqueAudits.length}`);
  }
  if (duplicateTaskIds.size > 0) {
    provenanceErrors.push(`model-run receipt contains ${duplicateTaskIds.size} duplicate task ID(s)`);
  }
  for (const category of SPREADSHEETBENCH_V2_CATEGORIES) {
    const expected = SPREADSHEETBENCH_V2_EXPECTED_CATEGORY_COUNTS[category];
    if (categoryTaskCounts[category] !== expected) {
      provenanceErrors.push(`${category} model-run coverage must be ${expected}; found ${categoryTaskCounts[category]}`);
    }
  }
  if (traceReceiptIds.size !== SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT) {
    provenanceErrors.push(`trace receipts validate for ${traceReceiptIds.size}/321 tasks`);
  }
  if (candidateReceiptIds.size !== SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT) {
    provenanceErrors.push(`candidate receipts validate for ${candidateReceiptIds.size}/321 tasks`);
  }
  if (scorerReceiptIds.size !== SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT) {
    provenanceErrors.push(`scorer receipts validate for ${scorerReceiptIds.size}/321 tasks`);
  }
  if (invalidTaskIds.length > 0) provenanceErrors.push(`${invalidTaskIds.length} task receipt audit(s) are invalid`);
  if (unexplainedEmptyEditingPlanIds.length > 0) {
    provenanceErrors.push(`${unexplainedEmptyEditingPlanIds.length} editing plan(s) are empty without a structured explanation`);
  }
  for (const audit of uniqueAudits) {
    for (const error of audit.errors ?? []) provenanceErrors.push(`${audit.taskId}: ${error}`);
  }

  const performanceErrors: string[] = [];
  const categoryQuality = Object.fromEntries(DETERMINISTIC_CATEGORIES.map((category) => {
    const metric = metrics[category];
    const baseline = SPREADSHEETBENCH_V2_ACCEPTED_BASELINES[category];
    const taskCount = finiteNumber(metric?.taskCount);
    const exactPassCount = finiteNumber(metric?.passCount);
    const modificationAccuracy = finiteNumber(metric?.modificationAccuracy);
    const regressionAccuracy = finiteNumber(metric?.regressionAccuracy);
    const exactPassesPass = exactPassCount !== null && exactPassCount > 0;
    const modificationImprovementPass = modificationAccuracy !== null && modificationAccuracy > baseline.modificationAccuracy;
    const regressionNoDeclinePass = regressionAccuracy !== null && regressionAccuracy >= baseline.regressionAccuracy;
    if (!exactPassesPass) performanceErrors.push(`${category} must have at least one exact official pass`);
    if (!modificationImprovementPass) {
      performanceErrors.push(`${category} modification accuracy must be > ${baseline.modificationAccuracy}; found ${formatNumber(modificationAccuracy)}`);
    }
    if (!regressionNoDeclinePass) {
      performanceErrors.push(`${category} regression accuracy must be >= ${baseline.regressionAccuracy}; found ${formatNumber(regressionAccuracy)}`);
    }
    const quality: SpreadsheetBenchV2CategoryQuality = {
      category,
      taskCount,
      exactPassCount,
      modificationAccuracy,
      modificationBaseline: baseline.modificationAccuracy,
      modificationDelta: modificationAccuracy === null ? null : modificationAccuracy - baseline.modificationAccuracy,
      regressionAccuracy,
      regressionBaseline: baseline.regressionAccuracy,
      regressionDelta: regressionAccuracy === null ? null : regressionAccuracy - baseline.regressionAccuracy,
      exactPassesPass,
      modificationImprovementPass,
      regressionNoDeclinePass,
      pass: exactPassesPass && modificationImprovementPass && regressionNoDeclinePass,
    };
    return [category, quality];
  })) as Record<SpreadsheetBenchV2DeterministicCategory, SpreadsheetBenchV2CategoryQuality>;

  const visualMetric = metrics.Visualization;
  const visualAudit = resultAudits.find((audit) => audit.category === "Visualization");
  const visualTaskCount = finiteNumber(visualMetric?.taskCount);
  const visualExactPassCount = finiteNumber(visualMetric?.passCount);
  const evaluatedByVlm = finiteNumber(visualMetric?.evaluatedByVlm);
  const judgeCalls = finiteNumber(asRecord(receipt.metric).visualJudgeCalls);
  const realVlmPassCount = visualAudit?.realVlmPassCount ?? 0;
  const visualExactPassesPass = visualExactPassCount !== null && visualExactPassCount > 0;
  const realVlmPassesPass =
    visualExactPassCount !== null
    && visualExactPassCount > 0
    && realVlmPassCount === visualExactPassCount
    && evaluatedByVlm !== null
    && evaluatedByVlm > 0
    && judgeCalls !== null
    && judgeCalls > 0;
  if (!visualExactPassesPass) performanceErrors.push("Visualization must have at least one exact official pass");
  if (!realVlmPassesPass) {
    performanceErrors.push("Visualization passes must be backed by successful official VLM checklist evaluations and nonzero judge calls");
  }
  const visualizationPass = visualExactPassesPass && realVlmPassesPass;
  const deterministicPerformancePass = DETERMINISTIC_CATEGORIES.every((category) => categoryQuality[category].pass);
  const performancePass = deterministicPerformancePass && visualizationPass;

  const coveragePass = officialCoveragePass
    && taskAudits.length === SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT
    && uniqueAudits.length === SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT
    && duplicateTaskIds.size === 0
    && SPREADSHEETBENCH_V2_CATEGORIES.every(
      (category) => categoryTaskCounts[category] === SPREADSHEETBENCH_V2_EXPECTED_CATEGORY_COUNTS[category],
    );
  const receiptCoveragePass =
    traceReceiptIds.size === SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT
    && candidateReceiptIds.size === SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT
    && scorerReceiptIds.size === SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT
    && invalidTaskIds.length === 0;
  const editingPlanPass = unexplainedEmptyEditingPlanIds.length === 0;
  const provenancePass = coveragePass && receiptCoveragePass && editingPlanPass && provenanceErrors.length === 0;

  const gates: SpreadsheetBenchV2QualityGateVerdict["gates"] = [
    {
      id: "scorer_authenticity",
      status: scorerAuthentic ? "pass" : "blocked",
      reason: scorerAuthentic
        ? "Accepted receipt and all hash-linked upstream scorer artifacts authenticate."
        : `${authenticityErrors.length} scorer authenticity check(s) failed.`,
    },
    {
      id: "official_coverage",
      status: coveragePass ? "pass" : "blocked",
      reason: coveragePass
        ? "Official scores and model-run provenance cover exactly 321/321 tasks."
        : `Coverage is incomplete or inexact (official=${formatNumber(officialScoredTaskCount)}, model=${uniqueAudits.length}/321).`,
    },
    {
      id: "trace_candidate_scorer_receipts",
      status: receiptCoveragePass ? "pass" : "blocked",
      reason: `${traceReceiptIds.size}/321 trace, ${candidateReceiptIds.size}/321 candidate, ${scorerReceiptIds.size}/321 scorer receipts validate.`,
    },
    {
      id: "editing_plan_integrity",
      status: editingPlanPass ? "pass" : "blocked",
      reason: editingPlanPass
        ? `${emptyAudits.length} empty editing plan(s), all explicitly explained.`
        : `${unexplainedEmptyEditingPlanIds.length} empty editing plan(s) lack a structured explanation.`,
    },
    {
      id: "category_performance",
      status: deterministicPerformancePass ? "pass" : "blocked",
      reason: deterministicPerformancePass
        ? "Every deterministic category has exact passes, higher modification accuracy, and no regression decline."
        : "At least one deterministic category misses the exact-pass, modification-improvement, or regression floor.",
    },
    {
      id: "visualization_vlm",
      status: visualizationPass ? "pass" : "blocked",
      reason: visualizationPass
        ? `${realVlmPassCount} official Visualization pass(es) are backed by real VLM checklist evaluations.`
        : "No qualifying official Visualization pass is backed by a successful VLM checklist evaluation.",
    },
  ];

  const pass = gates.every((gate) => gate.status === "pass");
  const blockers = gates.filter((gate) => gate.status === "blocked").map((gate) => gate.id);
  return {
    schema: "noderoom-spreadsheetbench-v2-quality-gate-v1",
    track: "spreadsheetbench-v2",
    expectedTaskCount: SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT,
    status: pass ? "pass" : "blocked",
    pass,
    scorerAuthenticity: {
      status: scorerAuthentic ? "pass" : "blocked",
      authentic: scorerAuthentic,
      acceptedReceipt: receipt.accepted === true,
      errors: uniqueSorted(authenticityErrors),
    },
    coverage: {
      status: coveragePass ? "pass" : "blocked",
      officialScoredTaskCount,
      officialCategoryTaskCount,
      modelRunTaskCount: taskAudits.length,
      uniqueModelRunTaskCount: uniqueAudits.length,
      traceReceiptCount: traceReceiptIds.size,
      candidateReceiptCount: candidateReceiptIds.size,
      scorerReceiptCount: scorerReceiptIds.size,
      categoryTaskCounts,
      duplicateTaskIds: [...duplicateTaskIds].sort(),
    },
    provenance: {
      status: provenancePass ? "pass" : "blocked",
      valid: provenancePass,
      invalidTaskIds,
      emptyEditingPlanCount: emptyAudits.length,
      explainedEmptyEditingPlanCount: emptyAudits.length - unexplainedEmptyEditingPlanIds.length,
      unexplainedEmptyEditingPlanIds,
      errors: uniqueSorted(provenanceErrors),
    },
    performance: {
      status: performancePass ? "pass" : "blocked",
      pass: performancePass,
      categories: categoryQuality,
      visualization: {
        taskCount: visualTaskCount,
        exactPassCount: visualExactPassCount,
        evaluatedByVlm,
        judgeCalls,
        realVlmPassCount,
        exactPassesPass: visualExactPassesPass,
        realVlmPassesPass,
        pass: visualizationPass,
      },
      errors: uniqueSorted(performanceErrors),
    },
    gates,
    artifacts: input.artifacts ?? emptyArtifacts(),
    blockers,
    claim: pass
      ? "SpreadsheetBench V2 quality gate earned: authentic official scoring, exact 321/321 receipt coverage, explained editing plans, category improvement without regression, and real VLM visualization passes."
      : `SpreadsheetBench V2 quality gate NOT earned: blocked by ${blockers.join(", ") || "unknown checks"}. Scorer authenticity and measured performance are reported separately.`,
  };
}

export function buildSpreadsheetBenchV2QualityGate(
  options: SpreadsheetBenchV2QualityGatePaths = {},
): SpreadsheetBenchV2QualityGateVerdict {
  const cwd = resolve(options.cwd ?? process.cwd());
  const defaults = defaultSpreadsheetBenchV2QualityGateInputs();
  const officialReceiptPath = options.officialReceiptPath ?? defaults.officialReceiptPath;
  const modelRunReceiptPaths = options.modelRunReceiptPaths?.length
    ? options.modelRunReceiptPaths
    : defaults.modelRunReceiptPaths;
  const receiptRoots = (options.receiptRoots ?? []).map((root) => resolve(cwd, root));
  const authenticityErrors: string[] = [];
  const provenanceErrors: string[] = [];
  const officialArtifact = loadJsonArtifact(officialReceiptPath, cwd);
  if (officialArtifact.evidence.status !== "present") {
    authenticityErrors.push(`official scorer receipt is ${officialArtifact.evidence.status}: ${officialArtifact.evidence.path ?? officialReceiptPath}`);
  }
  const receipt = asRecord(officialArtifact.value);
  const source = asRecord(receipt.source);
  const artifacts = emptyArtifacts();
  artifacts.officialReceipt = officialArtifact.evidence;

  const deterministicEvaluator = loadHashLinkedArtifact(
    stringValue(source.deterministicEvaluator),
    stringValue(source.deterministicEvaluatorSha256),
    "deterministic evaluator",
    cwd,
    authenticityErrors,
  );
  if (deterministicEvaluator) artifacts.deterministicEvaluator = deterministicEvaluator.evidence;
  const visualEvaluator = loadHashLinkedArtifact(
    stringValue(source.visualEvaluator),
    stringValue(source.visualEvaluatorSha256),
    "visual evaluator",
    cwd,
    authenticityErrors,
  );
  if (visualEvaluator) artifacts.visualEvaluator = visualEvaluator.evidence;
  const projectionArtifact = loadHashLinkedArtifact(
    stringValue(source.projectionReceipt),
    stringValue(source.projectionReceiptSha256),
    "projection receipt",
    cwd,
    authenticityErrors,
    true,
  );
  if (projectionArtifact) artifacts.projectionReceipt = projectionArtifact.evidence;
  const refreshArtifact = loadHashLinkedArtifact(
    stringValue(source.refreshReceipt),
    stringValue(source.refreshReceiptSha256),
    "refresh receipt",
    cwd,
    authenticityErrors,
    true,
  );
  if (refreshArtifact) artifacts.refreshReceipt = refreshArtifact.evidence;

  const projection = auditProjection(
    asRecord(projectionArtifact?.value),
    receipt,
    authenticityErrors,
  );
  auditRefresh(asRecord(refreshArtifact?.value), projection.cases, cwd, authenticityErrors);

  const resultAudits: SpreadsheetBenchV2OfficialResultAudit[] = [];
  const expectedIds = expectedIdsByCategory(projection.cases);
  const sourceResults = arrayValue(source.results);
  for (const category of SPREADSHEETBENCH_V2_CATEGORIES) {
    const sourceResult = sourceResults.map(asRecord).find((item) => item.category === category);
    const loaded = sourceResult
      ? loadOfficialResultArtifact(sourceResult, category, cwd, authenticityErrors)
      : undefined;
    if (loaded) artifacts.officialResults[category] = loaded.evidence;
    const audit = category === "Visualization"
      ? auditVisualResult(loaded?.value, receipt, expectedIds[category])
      : auditDeterministicResult(category, loaded?.value, receipt, expectedIds[category]);
    resultAudits.push(audit);
  }

  const runArtifacts = modelRunReceiptPaths.map((path) => loadJsonArtifact(path, cwd));
  artifacts.modelRunReceipts = runArtifacts.map((artifact) => artifact.evidence);
  for (const artifact of runArtifacts) {
    if (artifact.evidence.status !== "present") {
      provenanceErrors.push(`model-run receipt is ${artifact.evidence.status}: ${artifact.evidence.path ?? "unknown"}`);
    }
  }
  const linkedRunArtifact = projection.reportSha256
    ? runArtifacts.find((artifact) => artifact.evidence.sha256 === projection.reportSha256)
    : undefined;
  if (!linkedRunArtifact) {
    provenanceErrors.push("no supplied model-run receipt matches the projection receipt reportSha256");
  }
  const taskReceiptAudits = linkedRunArtifact
    ? auditModelRunTasks({
        artifact: linkedRunArtifact,
        cases: projection.cases,
        receiptRoots,
        cwd,
        provenanceErrors,
      })
    : [];

  return evaluateSpreadsheetBenchV2QualityGate({
    officialReceipt: officialArtifact.value,
    officialResultAudits: resultAudits,
    taskReceiptAudits,
    authenticityErrors,
    provenanceErrors,
    artifacts,
  });
}

export function formatSpreadsheetBenchV2QualityGateDense(
  verdict: SpreadsheetBenchV2QualityGateVerdict,
): string {
  const exact = SPREADSHEETBENCH_V2_CATEGORIES.map((category) => {
    if (category === "Visualization") return `${category}:${formatNumber(verdict.performance.visualization.exactPassCount)}`;
    return `${category}:${formatNumber(verdict.performance.categories[category].exactPassCount)}`;
  }).join(",");
  const modification = DETERMINISTIC_CATEGORIES.map((category) =>
    `${category}:${formatNumber(verdict.performance.categories[category].modificationAccuracy)}`,
  ).join(",");
  const regression = DETERMINISTIC_CATEGORIES.map((category) =>
    `${category}:${formatNumber(verdict.performance.categories[category].regressionAccuracy)}`,
  ).join(",");
  return [
    "spreadsheetbench-v2-quality-gate",
    `status=${verdict.status.toUpperCase()}`,
    `authenticity=${verdict.scorerAuthenticity.status.toUpperCase()}`,
    `provenance=${verdict.provenance.status.toUpperCase()}`,
    `performance=${verdict.performance.status.toUpperCase()}`,
    `coverage=${verdict.coverage.uniqueModelRunTaskCount}/321`,
    `trace=${verdict.coverage.traceReceiptCount}/321`,
    `candidate=${verdict.coverage.candidateReceiptCount}/321`,
    `scorer=${verdict.coverage.scorerReceiptCount}/321`,
    `empty_unexplained=${verdict.provenance.unexplainedEmptyEditingPlanIds.length}`,
    `exact=${exact}`,
    `modification=${modification}`,
    `regression=${regression}`,
    `vlm=${verdict.performance.visualization.realVlmPassCount}/${formatNumber(verdict.performance.visualization.exactPassCount)}`,
    `blockers=${verdict.blockers.length ? verdict.blockers.join(",") : "none"}`,
  ].join(" ");
}

function validateOfficialReceipt(
  receipt: Record<string, unknown>,
  metrics: Partial<Record<SpreadsheetBenchV2Category, Record<string, unknown>>>,
  resultAudits: SpreadsheetBenchV2OfficialResultAudit[],
  artifactErrors: string[],
): string[] {
  const errors = [...artifactErrors];
  if (receipt.schema !== 1) errors.push("official receipt schema must be 1");
  if (receipt.verifier !== "spreadsheetbench_official_scorer") {
    errors.push("official receipt verifier must be spreadsheetbench_official_scorer");
  }
  if (receipt.track !== "spreadsheetbench-v2") errors.push("official receipt track must be spreadsheetbench-v2");
  if (receipt.accepted !== true) errors.push("official receipt accepted must be true");
  const score = asRecord(receipt.score);
  for (const key of ["averageOverall", "passRate", "passCount", "scoredTaskCount"] as const) {
    if (finiteNumber(score[key]) === null) errors.push(`official receipt score.${key} must be finite`);
  }
  const aggregatePassCount = integerNumber(score.passCount);
  const aggregateScoredTaskCount = integerNumber(score.scoredTaskCount);
  if (aggregatePassCount === null || aggregateScoredTaskCount === null || aggregatePassCount > aggregateScoredTaskCount) {
    errors.push("official receipt aggregate pass/scored counts must be non-negative integers with passCount <= scoredTaskCount");
  }
  const metric = asRecord(receipt.metric);
  if (metric.primary !== "official_task_accuracy") errors.push("official receipt metric.primary must be official_task_accuracy");
  if (!stringValue(metric.visualJudgeModel)) errors.push("official receipt visual judge model is missing");
  if (finiteNumber(metric.visualJudgeCalls) === null) errors.push("official receipt visual judge calls must be finite");
  const source = asRecord(receipt.source);
  if (source.kind !== "upstream_official_evaluators") errors.push("official receipt source.kind must be upstream_official_evaluators");
  if (!stringValue(source.repository)) errors.push("official receipt source.repository is missing");
  if (!/^[a-f0-9]{40}$/i.test(stringValue(source.commit) ?? "")) errors.push("official receipt source.commit must be a git SHA");
  for (const key of [
    "deterministicEvaluatorSha256",
    "visualEvaluatorSha256",
    "projectionReceiptSha256",
    "caseManifestSha256",
    "refreshReceiptSha256",
  ] as const) {
    if (!SHA256_RE.test(stringValue(source[key]) ?? "")) errors.push(`official receipt source.${key} must be sha256`);
  }
  if (!stringValue(source.deterministicEvaluator)) errors.push("official receipt deterministic evaluator path is missing");
  if (!stringValue(source.visualEvaluator)) errors.push("official receipt visual evaluator path is missing");
  if (!stringValue(source.projectionReceipt)) errors.push("official receipt projection receipt path is missing");
  if (!stringValue(source.refreshReceipt)) errors.push("official receipt refresh receipt path is missing");

  const sourceResults = arrayValue(source.results).map(asRecord);
  for (const category of SPREADSHEETBENCH_V2_CATEGORIES) {
    const entries = sourceResults.filter((entry) => entry.category === category);
    if (entries.length !== 1) errors.push(`official receipt must link exactly one ${category} result artifact`);
    const entry = entries[0];
    if (entry) {
      if (!stringValue(entry.path) && !stringValue(entry.copy)) errors.push(`${category} result artifact path is missing`);
      if (!SHA256_RE.test(stringValue(entry.sha256) ?? "")) errors.push(`${category} result artifact sha256 is invalid`);
      if (stringValue(entry.copy) && !SHA256_RE.test(stringValue(entry.copySha256) ?? "")) {
        errors.push(`${category} copied result artifact sha256 is invalid`);
      }
      if (stringValue(entry.copySha256) && entry.copySha256 !== entry.sha256) {
        errors.push(`${category} source and copied result hashes differ`);
      }
    }
    const matchingAudits = resultAudits.filter((candidate) => candidate.category === category);
    if (matchingAudits.length !== 1) {
      errors.push(`${category} must have exactly one official result artifact audit; found ${matchingAudits.length}`);
    }
    const audit = matchingAudits[0];
    if (!audit) {
      errors.push(`${category} official result artifact was not audited`);
      continue;
    }
    for (const error of audit.errors) errors.push(`${category} official result: ${error}`);
    if (!audit.valid) errors.push(`${category} official result artifact is invalid`);
    const expected = SPREADSHEETBENCH_V2_EXPECTED_CATEGORY_COUNTS[category];
    if (audit.taskCount !== expected || audit.uniqueTaskCount !== expected) {
      errors.push(`${category} official result coverage must be ${expected}/${expected}`);
    }
    const categoryMetric = metrics[category];
    const metricTaskCount = integerNumber(categoryMetric?.taskCount);
    const metricPassCount = integerNumber(categoryMetric?.passCount);
    if (metricTaskCount !== expected) errors.push(`${category} receipt taskCount must be ${expected}`);
    if (metricPassCount !== audit.exactPassCount || metricPassCount === null || metricPassCount > expected) {
      errors.push(`${category} receipt passCount does not match its result artifact`);
    }
    if (!sameNumber(finiteNumber(categoryMetric?.accuracy), audit.exactPassCount / expected)) {
      errors.push(`${category} receipt accuracy is inconsistent with its exact pass count`);
    }
    if (category !== "Visualization") {
      if (!sameNumber(finiteNumber(categoryMetric?.regressionAccuracy), audit.regressionAccuracy ?? null)) {
        errors.push(`${category} receipt regression accuracy does not match its result artifact`);
      }
      if (!sameNumber(finiteNumber(categoryMetric?.modificationAccuracy), audit.modificationAccuracy ?? null)) {
        errors.push(`${category} receipt modification accuracy does not match its result artifact`);
      }
    } else {
      if (finiteNumber(categoryMetric?.evaluatedByVlm) !== audit.evaluatedByVlm) {
        errors.push("Visualization receipt evaluatedByVlm does not match its result artifact");
      }
      if (finiteNumber(metric.visualJudgeCalls) !== audit.evaluatedByVlm) {
        errors.push("Visualization visualJudgeCalls does not match evaluated VLM tasks");
      }
    }
  }

  const passCount = SPREADSHEETBENCH_V2_CATEGORIES.reduce(
    (sum, category) => sum + (finiteNumber(metrics[category]?.passCount) ?? 0),
    0,
  );
  if (finiteNumber(score.scoredTaskCount) !== SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT) {
    errors.push("official receipt must score exactly 321 tasks");
  }
  if (finiteNumber(score.passCount) !== passCount) errors.push("official receipt aggregate passCount is inconsistent");
  const expectedPassRate = passCount / SPREADSHEETBENCH_V2_EXPECTED_TASK_COUNT;
  if (!sameNumber(finiteNumber(score.passRate), expectedPassRate)) errors.push("official receipt passRate is inconsistent");
  if (!sameNumber(finiteNumber(score.averageOverall), expectedPassRate)) errors.push("official receipt averageOverall is inconsistent");
  return uniqueSorted(errors);
}

function categoryMetrics(
  receipt: Record<string, unknown>,
): Partial<Record<SpreadsheetBenchV2Category, Record<string, unknown>>> {
  const raw = asRecord(asRecord(receipt.metric).categoryMetrics);
  return Object.fromEntries(
    SPREADSHEETBENCH_V2_CATEGORIES.map((category) => [category, asRecord(raw[category])]),
  );
}

function structuralTaskAudits(modelRunReceipts: unknown[]): SpreadsheetBenchV2TaskReceiptAudit[] {
  const audits: SpreadsheetBenchV2TaskReceiptAudit[] = [];
  for (const reportValue of modelRunReceipts) {
    const report = asRecord(reportValue);
    for (const resultValue of arrayValue(report.results)) {
      const result = asRecord(resultValue);
      const taskId = stringValue(result.taskId) ?? "";
      const sidecar = asRecord(result.sidecarEvidence);
      const trajectory = arrayValue(result.trajectory).map(asRecord);
      const steps = trajectory.map((entry) => stringValue(entry.step) ?? "");
      const model = asRecord(result.model);
      const traceReceiptValid =
        result.mode === "model-edit-plan"
        && (finiteNumber(model.calls) ?? 0) > 0
        && validEvidenceShape(sidecar.editPlan)
        && validEvidenceShape(sidecar.rawModelOutput)
        && requiredTrajectoryPresent(steps);
      const candidateReceiptValid = Boolean(stringValue(result.candidateWorkbook)) && validEvidenceShape(sidecar.candidateManifest);
      const scorerReceiptValid = validEvidenceShape(result.scorerReceipt);
      const editPlanOperationCount = integerNumber(sidecar.appliedOperationCount) ?? undefined;
      audits.push({
        taskId,
        category: normalizedCategory(stringValue(result.category), taskId),
        traceReceiptValid,
        candidateReceiptValid,
        scorerReceiptValid,
        editPlanOperationCount,
        emptyPlanExplained: substantiveExplanation(
          explanationFrom(result) ?? explanationFrom(sidecar),
        ),
        errors: [
          ...(taskId ? [] : ["task ID is missing"]),
          ...(editPlanOperationCount === undefined ? ["editing plan operation count is missing"] : []),
        ],
      });
    }
  }
  return audits;
}

function auditProjection(
  projection: Record<string, unknown>,
  officialReceipt: Record<string, unknown>,
  errors: string[],
): LoadedProjection {
  if (Object.keys(projection).length === 0) return { cases: [] };
  if (projection.schema !== 1) errors.push("projection receipt schema must be 1");
  if (projection.track !== "spreadsheetbench-v2") errors.push("projection receipt track must be spreadsheetbench-v2");
  if (finiteNumber(projection.taskCount) !== 321) errors.push("projection receipt taskCount must be 321");
  if (finiteNumber(projection.projectedOutputCount) !== 321) errors.push("projection receipt projectedOutputCount must be 321");
  if (finiteNumber(projection.projectionErrorCount) !== 0) errors.push("projection receipt must have zero projection errors");
  const source = asRecord(officialReceipt.source);
  if (projection.caseManifestSha256 !== source.caseManifestSha256) errors.push("projection case manifest hash differs from accepted receipt");
  const upstream = asRecord(projection.upstream);
  if (upstream.repository !== source.repository || upstream.commit !== source.commit) {
    errors.push("projection upstream repository or commit differs from accepted receipt");
  }
  if (upstream.evaluatorSha256 !== source.deterministicEvaluatorSha256) errors.push("projection deterministic evaluator hash differs from accepted receipt");
  if (upstream.visualEvaluatorSha256 !== source.visualEvaluatorSha256) errors.push("projection visual evaluator hash differs from accepted receipt");

  const rawCases = arrayValue(projection.cases);
  const cases: ProjectionCase[] = [];
  const seen = new Set<string>();
  for (const [index, value] of rawCases.entries()) {
    const row = asRecord(value);
    const taskId = stringValue(row.taskId);
    const category = normalizedCategory(stringValue(row.category), taskId ?? "");
    const id = stringValue(row.id);
    const model = stringValue(row.model);
    const modelCalls = finiteNumber(row.modelCalls);
    const sourcePath = stringValue(row.source);
    const sourceSha256 = stringValue(row.sourceSha256);
    const output = stringValue(row.output);
    const outputSha256 = stringValue(row.outputSha256);
    if (!taskId || !category || !id || !model || modelCalls === null || modelCalls <= 0 || !sourcePath || !output
      || !SHA256_RE.test(sourceSha256 ?? "") || !SHA256_RE.test(outputSha256 ?? "")) {
      errors.push(`projection case ${index + 1} is invalid`);
      continue;
    }
    if (seen.has(taskId)) errors.push(`projection contains duplicate task ${taskId}`);
    seen.add(taskId);
    cases.push({ taskId, category, id, model, modelCalls, source: sourcePath, sourceSha256: sourceSha256!, output, outputSha256: outputSha256! });
  }
  if (cases.length !== 321 || seen.size !== 321) errors.push(`projection must contain 321 unique valid cases; found ${seen.size}`);
  const expectedManifestHash = sha256(Buffer.from(JSON.stringify(cases), "utf8"));
  if (stringValue(projection.caseManifestSha256) && expectedManifestHash !== projection.caseManifestSha256) {
    errors.push("projection cases do not reproduce caseManifestSha256");
  }
  const categoryCounts = asRecord(projection.categoryCounts);
  for (const category of SPREADSHEETBENCH_V2_CATEGORIES) {
    const expected = SPREADSHEETBENCH_V2_EXPECTED_CATEGORY_COUNTS[category];
    const actual = cases.filter((row) => row.category === category).length;
    if (actual !== expected || finiteNumber(categoryCounts[category]) !== expected) {
      errors.push(`projection ${category} coverage must be ${expected}; found ${actual}`);
    }
  }
  const reportSha256 = stringValue(projection.reportSha256);
  if (!SHA256_RE.test(reportSha256 ?? "")) errors.push("projection reportSha256 is invalid");
  return { cases, reportSha256, value: projection };
}

function auditRefresh(
  refresh: Record<string, unknown>,
  cases: ProjectionCase[],
  cwd: string,
  errors: string[],
): void {
  if (Object.keys(refresh).length === 0) return;
  if (refresh.schema !== 1) errors.push("refresh receipt schema must be 1");
  if (finiteNumber(refresh.workbookCount) !== 321 || finiteNumber(refresh.refreshedCount) !== 321) {
    errors.push("refresh receipt must prove 321/321 refreshed workbooks");
  }
  if (finiteNumber(refresh.failureCount) !== 0) errors.push("refresh receipt must have zero failures");
  if (!stringValue(refresh.engine) || !stringValue(refresh.engineVersion)) errors.push("refresh engine identity is missing");
  const records = arrayValue(refresh.records).map(asRecord);
  if (records.length !== 321) errors.push(`refresh receipt must contain 321 records; found ${records.length}`);
  const expectedOutputs = new Set(cases.map((row) => normalizedPath(resolve(cwd, row.output))));
  const seen = new Set<string>();
  for (const [index, record] of records.entries()) {
    const path = stringValue(record.path);
    const afterSha256 = stringValue(record.afterSha256);
    if (!path || record.status !== "refreshed" || !SHA256_RE.test(afterSha256 ?? "")) {
      errors.push(`refresh record ${index + 1} is invalid`);
      continue;
    }
    const absolute = resolve(cwd, path);
    const normalized = normalizedPath(absolute);
    if (seen.has(normalized)) errors.push(`refresh receipt contains duplicate output ${path}`);
    seen.add(normalized);
    if (!expectedOutputs.has(normalized)) errors.push(`refresh output is absent from projection: ${path}`);
    const actual = readFileForHash(absolute);
    if (!actual) errors.push(`refreshed output is missing: ${path}`);
    else if (sha256(actual) !== afterSha256) errors.push(`refreshed output hash mismatch: ${path}`);
  }
  if (seen.size !== expectedOutputs.size || [...expectedOutputs].some((path) => !seen.has(path))) {
    errors.push("refresh output set does not exactly match projection output set");
  }
}

function auditDeterministicResult(
  category: SpreadsheetBenchV2DeterministicCategory,
  value: unknown,
  receipt: Record<string, unknown>,
  expectedIds: Set<string>,
): SpreadsheetBenchV2OfficialResultAudit {
  const errors: string[] = [];
  const result = asRecord(value);
  const expected = SPREADSHEETBENCH_V2_EXPECTED_CATEGORY_COUNTS[category];
  const scores = arrayValue(result.scores).map(asRecord);
  const ids = new Set<string>();
  let exactPassCount = 0;
  for (const [index, score] of scores.entries()) {
    const id = String(score.id ?? "");
    if (!id) errors.push(`score row ${index + 1} is missing id`);
    if (ids.has(id)) errors.push(`duplicate score id ${id}`);
    ids.add(id);
    for (const key of ["regression_accuracy", "modification_accuracy", "accuracy"] as const) {
      const number = finiteNumber(score[key]);
      if (number === null || number < 0 || number > 1) errors.push(`${id || index + 1} has invalid ${key}`);
    }
    const accuracy = finiteNumber(score.accuracy);
    if (accuracy !== 0 && accuracy !== 1) errors.push(`${id || index + 1} accuracy must be binary`);
    if (accuracy === 1) exactPassCount += 1;
  }
  if (finiteNumber(result.total_tests) !== expected) errors.push(`total_tests must be ${expected}`);
  if (finiteNumber(result.missing_outputs) !== 0) errors.push("missing_outputs must be zero");
  if (scores.length !== expected || ids.size !== expected) errors.push(`scores must cover ${expected} unique tasks`);
  if (expectedIds.size > 0 && (expectedIds.size !== ids.size || [...expectedIds].some((id) => !ids.has(id)))) {
    errors.push("score IDs do not match projection task IDs");
  }
  const regressionAccuracy = finiteNumber(result.regression_accuracy) ?? undefined;
  const modificationAccuracy = finiteNumber(result.modification_accuracy) ?? undefined;
  const exactAccuracy = exactPassCount / expected;
  if (regressionAccuracy === undefined) errors.push("aggregate regression_accuracy is invalid");
  if (modificationAccuracy === undefined) errors.push("aggregate modification_accuracy is invalid");
  if (!sameNumber(finiteNumber(result.accuracy), exactAccuracy)) errors.push("aggregate accuracy is inconsistent with exact passes");
  const metric = categoryMetrics(receipt)[category];
  if (!sameNumber(regressionAccuracy ?? null, finiteNumber(metric?.regressionAccuracy))) errors.push("aggregate regression accuracy differs from receipt");
  if (!sameNumber(modificationAccuracy ?? null, finiteNumber(metric?.modificationAccuracy))) errors.push("aggregate modification accuracy differs from receipt");
  if (!sameNumber(finiteNumber(metric?.accuracy), exactAccuracy)) errors.push("receipt accuracy is inconsistent with exact passes");
  if (finiteNumber(metric?.passCount) !== exactPassCount) errors.push("exact pass count differs from receipt");
  return {
    category,
    valid: errors.length === 0,
    taskCount: scores.length,
    uniqueTaskCount: ids.size,
    exactPassCount,
    regressionAccuracy,
    modificationAccuracy,
    errors: uniqueSorted(errors),
  };
}

function auditVisualResult(
  value: unknown,
  receipt: Record<string, unknown>,
  expectedIds: Set<string>,
): SpreadsheetBenchV2OfficialResultAudit {
  const errors: string[] = [];
  const result = asRecord(value);
  const meta = asRecord(result.meta);
  const summary = asRecord(result.summary);
  const rows = arrayValue(result.results).map(asRecord);
  const ids = new Set<string>();
  let exactPassCount = 0;
  let realVlmPassCount = 0;
  let successCount = 0;
  let errorCount = 0;
  const threshold = finiteNumber(summary.acc_threshold);
  if (meta.eval_method !== "vlm_checklist_only") errors.push("eval_method must be vlm_checklist_only");
  if (meta.base_url !== "https://openrouter.ai/api/v1") errors.push("official visual evaluator base_url is invalid");
  const receiptMetric = asRecord(receipt.metric);
  if (!stringValue(meta.model) || meta.model !== receiptMetric.visualJudgeModel) errors.push("visual judge model differs from accepted receipt");
  if (finiteNumber(summary.total_tasks) !== 24 || finiteNumber(summary.completed) !== 24 || finiteNumber(summary.pending) !== 0) {
    errors.push("visual summary must cover 24 completed tasks with zero pending");
  }
  if (finiteNumber(summary.acc_total) !== 24 || rows.length !== 24) errors.push("visual result must score exactly 24 tasks");
  if (threshold === null || threshold <= 0 || threshold > 1) errors.push("visual accuracy threshold is invalid");
  for (const [index, row] of rows.entries()) {
    const id = String(row.task_id ?? "");
    if (!id) errors.push(`visual row ${index + 1} is missing task_id`);
    if (ids.has(id)) errors.push(`duplicate visual task id ${id}`);
    ids.add(id);
    const score = finiteNumber(row.score);
    const acc = finiteNumber(row.acc);
    if (score === null || score < 0 || score > 1) errors.push(`${id || index + 1} visual score is invalid`);
    if (acc !== 0 && acc !== 1) errors.push(`${id || index + 1} visual acc must be binary`);
    if (row.status === "success") successCount += 1;
    if (row.status === "error") errorCount += 1;
    if (acc === 1) {
      exactPassCount += 1;
      const checklist = asRecord(row.checklist);
      const checklistTotal = finiteNumber(checklist.total);
      const checklistPass = finiteNumber(checklist.pass);
      const details = arrayValue(checklist.details);
      const realPass =
        row.status === "success"
        && row.eval_method === "vlm_checklist"
        && score !== null
        && threshold !== null
        && score >= threshold
        && Boolean(stringValue(row.image_source))
        && (finiteNumber(row.num_charts) ?? 0) > 0
        && checklistTotal !== null
        && checklistTotal > 0
        && checklistPass !== null
        && checklistPass > 0
        && details.length > 0;
      if (realPass) realVlmPassCount += 1;
      else errors.push(`${id || index + 1} claims a visual pass without a real VLM checklist evaluation`);
    }
  }
  if (ids.size !== 24) errors.push(`visual results must contain 24 unique task IDs; found ${ids.size}`);
  if (expectedIds.size > 0 && (expectedIds.size !== ids.size || [...expectedIds].some((id) => !ids.has(id)))) {
    errors.push("visual score IDs do not match projection task IDs");
  }
  const evaluatedByVlm = finiteNumber(summary.evaluated) ?? 0;
  if (evaluatedByVlm !== successCount) errors.push("visual evaluated count does not match successful VLM result rows");
  if ((finiteNumber(summary.errors) ?? 0) !== errorCount) errors.push("visual error count does not match result rows");
  if (finiteNumber(summary.acc_tasks) !== exactPassCount) errors.push("visual exact pass count differs from result rows");
  const exactAccuracy = exactPassCount / 24;
  if (!sameNumber(finiteNumber(summary.acc), exactAccuracy)) errors.push("visual summary accuracy is inconsistent with exact passes");
  const visualMetric = categoryMetrics(receipt).Visualization;
  if (finiteNumber(visualMetric?.passCount) !== exactPassCount) errors.push("visual exact pass count differs from receipt");
  if (!sameNumber(finiteNumber(visualMetric?.accuracy), exactAccuracy)) errors.push("visual receipt accuracy is inconsistent with exact passes");
  if (finiteNumber(visualMetric?.evaluatedByVlm) !== evaluatedByVlm) errors.push("visual evaluated count differs from receipt");
  return {
    category: "Visualization",
    valid: errors.length === 0,
    taskCount: rows.length,
    uniqueTaskCount: ids.size,
    exactPassCount,
    evaluatedByVlm,
    realVlmPassCount,
    errors: uniqueSorted(errors),
  };
}

function auditModelRunTasks(args: {
  artifact: LoadedArtifact;
  cases: ProjectionCase[];
  receiptRoots: string[];
  cwd: string;
  provenanceErrors: string[];
}): SpreadsheetBenchV2TaskReceiptAudit[] {
  const report = asRecord(args.artifact.value);
  if (report.schema !== 1) args.provenanceErrors.push("linked model-run receipt schema must be 1");
  if (report.mode !== "model-edit-plan") args.provenanceErrors.push("linked model-run receipt mode must be model-edit-plan");
  if (finiteNumber(report.taskCount) !== 321) args.provenanceErrors.push("linked model-run receipt taskCount must be 321");
  const results = arrayValue(report.results).map(asRecord);
  if (results.length !== 321) args.provenanceErrors.push(`linked model-run receipt must contain 321 results; found ${results.length}`);
  const byId = new Map<string, Record<string, unknown>>();
  for (const result of results) {
    const taskId = stringValue(result.taskId);
    if (!taskId) continue;
    if (byId.has(taskId)) args.provenanceErrors.push(`linked model-run receipt contains duplicate task ${taskId}`);
    else byId.set(taskId, result);
  }
  const caseIds = new Set(args.cases.map((row) => row.taskId));
  for (const taskId of byId.keys()) if (!caseIds.has(taskId)) args.provenanceErrors.push(`model-run task is absent from projection: ${taskId}`);
  const outputRoot = stringValue(report.outputRoot);
  const roots = uniquePaths([
    ...args.receiptRoots,
    ...(outputRoot ? [
      resolve(args.cwd, ".tmp", "official-benchmarks", outputRoot),
      resolve(args.cwd, outputRoot),
      resolve(dirname(args.artifact.absolutePath), outputRoot),
    ] : []),
  ]);

  return args.cases.map((projectionCase) => {
    const result = byId.get(projectionCase.taskId);
    if (!result) {
      return {
        taskId: projectionCase.taskId,
        category: projectionCase.category,
        traceReceiptValid: false,
        candidateReceiptValid: false,
        scorerReceiptValid: false,
        errors: ["task is missing from linked model-run receipt"],
      };
    }
    return auditModelRunTask(result, projectionCase, roots, args.cwd);
  });
}

function auditModelRunTask(
  result: Record<string, unknown>,
  projectionCase: ProjectionCase,
  roots: string[],
  cwd: string,
): SpreadsheetBenchV2TaskReceiptAudit {
  const traceErrors: string[] = [];
  const candidateErrors: string[] = [];
  const scorerErrors: string[] = [];
  if (result.track !== "spreadsheetbench-v2") traceErrors.push("result track must be spreadsheetbench-v2");
  if (result.mode !== "model-edit-plan") traceErrors.push("result mode must be model-edit-plan");
  if (stringValue(result.category) !== projectionCase.category) traceErrors.push("result category differs from projection");
  const model = asRecord(result.model);
  if (!stringValue(model.name) || model.name !== projectionCase.model) traceErrors.push("model identity differs from projection");
  if (!sameNumber(finiteNumber(model.calls), projectionCase.modelCalls) || (finiteNumber(model.calls) ?? 0) <= 0) {
    traceErrors.push("model call count is missing, zero, or differs from projection");
  }
  const trajectory = arrayValue(result.trajectory).map(asRecord);
  const steps = trajectory.map((entry) => stringValue(entry.step) ?? "");
  if (!requiredTrajectoryPresent(steps)) traceErrors.push("trajectory is missing the ordered model/candidate/scorer steps");

  const sidecar = asRecord(result.sidecarEvidence);
  const editPlanFile = validateEvidenceFile(sidecar.editPlan, roots, "edit plan", traceErrors);
  const rawModelOutputFile = validateEvidenceFile(sidecar.rawModelOutput, roots, "raw model output", traceErrors);
  if (rawModelOutputFile?.content && rawModelOutputFile.content.toString("utf8").trim().length === 0) {
    traceErrors.push("raw model output receipt is empty");
  }
  const editPlan = asRecord(editPlanFile?.value);
  const operations = Array.isArray(editPlan.operations) ? editPlan.operations : undefined;
  if (!operations) traceErrors.push("edit plan receipt must contain an operations array");
  if (stringValue(editPlan.taskId) && editPlan.taskId !== projectionCase.taskId) traceErrors.push("edit plan taskId differs from projection");

  const candidateManifestFile = validateEvidenceFile(sidecar.candidateManifest, roots, "candidate manifest", candidateErrors);
  const candidateManifest = asRecord(candidateManifestFile?.value);
  if (candidateManifest.schema !== 1) candidateErrors.push("candidate manifest schema must be 1");
  if (candidateManifest.taskId !== projectionCase.taskId) candidateErrors.push("candidate manifest taskId differs from projection");
  if (candidateManifest.mode !== "model-edit-plan") candidateErrors.push("candidate manifest mode must be model-edit-plan");
  const candidateWorkbook = stringValue(result.candidateWorkbook);
  if (!candidateWorkbook) candidateErrors.push("candidate workbook path is missing from model-run result");
  const manifestCandidate = stringValue(candidateManifest.candidateWorkbook);
  if (!manifestCandidate || (candidateWorkbook && basename(candidateWorkbook) !== basename(manifestCandidate))) {
    candidateErrors.push("candidate manifest workbook differs from model-run result");
  }
  const projectedCandidatePath = resolve(cwd, projectionCase.source);
  const projectedCandidate = readFileForHash(projectedCandidatePath);
  if (!projectedCandidate) candidateErrors.push("projected candidate workbook is missing");
  else if (sha256(projectedCandidate) !== projectionCase.sourceSha256) candidateErrors.push("projected candidate workbook hash mismatch");
  if (projectionCase.sourceSha256 !== projectionCase.outputSha256) candidateErrors.push("projection source/output copy hash mismatch");
  if (candidateWorkbook) {
    const resolvedCandidate = resolveFileByHash(candidateWorkbook, roots, projectionCase.sourceSha256);
    if (!resolvedCandidate) candidateErrors.push("model-run candidate workbook cannot be resolved with the projected hash");
    else if (normalizedPath(resolvedCandidate) !== normalizedPath(projectedCandidatePath)) {
      candidateErrors.push("model-run candidate workbook path differs from projected scorer input source");
    }
  }

  const scorerFile = validateEvidenceFile(result.scorerReceipt, roots, "scorer receipt", scorerErrors);
  const scorer = asRecord(scorerFile?.value);
  if (scorer.schema !== 1) scorerErrors.push("scorer receipt schema must be 1");
  if (scorer.verifier !== "spreadsheetbench_workbook_scorer") scorerErrors.push("scorer receipt verifier is invalid");
  if (scorer.taskId !== projectionCase.taskId) scorerErrors.push("scorer receipt taskId differs from projection");
  if (scorer.track !== "spreadsheetbench-v2") scorerErrors.push("scorer receipt track must be spreadsheetbench-v2");
  if (scorer.mode !== "model-edit-plan") scorerErrors.push("scorer receipt mode must be model-edit-plan");
  if (!asOptionalRecord(scorer.score) || !asOptionalRecord(result.score)) scorerErrors.push("scorer receipt or model-run score is missing");
  if (stringValue(scorer.candidateWorkbook) && candidateWorkbook
    && basename(stringValue(scorer.candidateWorkbook)!) !== basename(candidateWorkbook)) {
    scorerErrors.push("scorer receipt candidate differs from model-run candidate");
  }

  const parsedOperationCount = operations?.length;
  const sidecarOperationCount = integerNumber(sidecar.appliedOperationCount);
  const manifestOperationCount = integerNumber(candidateManifest.appliedOperationCount);
  if (sidecarOperationCount !== null && manifestOperationCount !== null && sidecarOperationCount !== manifestOperationCount) {
    candidateErrors.push("candidate manifest operation count differs from model-run sidecar");
  }
  if (parsedOperationCount !== undefined && manifestOperationCount !== null && parsedOperationCount !== manifestOperationCount) {
    candidateErrors.push("candidate manifest operation count differs from edit plan");
  }
  const editPlanOperationCount = manifestOperationCount ?? sidecarOperationCount ?? parsedOperationCount;
  const explanation = explanationFrom(editPlan)
    ?? explanationFrom(candidateManifest)
    ?? explanationFrom(sidecar)
    ?? explanationFrom(result);
  const emptyPlanExplained = editPlanOperationCount === 0 && substantiveExplanation(explanation);
  const errors = uniqueSorted([...traceErrors, ...candidateErrors, ...scorerErrors]);
  return {
    taskId: projectionCase.taskId,
    category: projectionCase.category,
    traceReceiptValid: traceErrors.length === 0,
    candidateReceiptValid: candidateErrors.length === 0,
    scorerReceiptValid: scorerErrors.length === 0,
    editPlanOperationCount: editPlanOperationCount ?? undefined,
    emptyPlanExplained,
    errors,
  };
}

function loadOfficialResultArtifact(
  sourceResult: Record<string, unknown>,
  category: SpreadsheetBenchV2Category,
  cwd: string,
  errors: string[],
): LoadedArtifact | undefined {
  const candidates = [
    { path: stringValue(sourceResult.copy), hash: stringValue(sourceResult.copySha256) },
    { path: stringValue(sourceResult.path), hash: stringValue(sourceResult.sha256) },
  ].filter((candidate): candidate is { path: string; hash: string | undefined } => Boolean(candidate.path));
  for (const candidate of candidates) {
    const loaded = loadJsonArtifact(candidate.path, cwd);
    if (loaded.evidence.status !== "present") continue;
    if (!SHA256_RE.test(candidate.hash ?? "") || loaded.evidence.sha256 !== candidate.hash) continue;
    return loaded;
  }
  errors.push(`${category} official result artifact is missing or hash-mismatched`);
  return candidates.length ? loadJsonArtifact(candidates[0].path, cwd) : undefined;
}

function loadHashLinkedArtifact(
  path: string | undefined,
  expectedSha256: string | undefined,
  label: string,
  cwd: string,
  errors: string[],
  parseJson = false,
): LoadedArtifact | undefined {
  if (!path) {
    errors.push(`${label} path is missing`);
    return undefined;
  }
  const loaded = parseJson ? loadJsonArtifact(path, cwd) : loadFileArtifact(path, cwd);
  if (loaded.evidence.status !== "present") {
    errors.push(`${label} is ${loaded.evidence.status}: ${loaded.evidence.path ?? path}`);
    return loaded;
  }
  if (!SHA256_RE.test(expectedSha256 ?? "") || loaded.evidence.sha256 !== expectedSha256) {
    errors.push(`${label} hash mismatch`);
  }
  return loaded;
}

function loadJsonArtifact(path: string, cwd: string): LoadedArtifact {
  const loaded = loadFileArtifact(path, cwd);
  if (!loaded.content || loaded.evidence.status !== "present") return loaded;
  try {
    return { ...loaded, value: JSON.parse(decodeJsonBuffer(loaded.content)) as unknown };
  } catch (error) {
    return {
      ...loaded,
      evidence: {
        ...loaded.evidence,
        status: "invalid",
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function loadFileArtifact(path: string, cwd: string): LoadedArtifact {
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const displayPath = rel(cwd, absolutePath);
  if (!existsSync(absolutePath)) return { absolutePath, evidence: { path: displayPath, status: "missing" } };
  try {
    const stat = statSync(absolutePath);
    if (!stat.isFile()) return { absolutePath, evidence: { path: displayPath, status: "invalid", reason: "not a file" } };
    const content = readFileSync(absolutePath);
    return {
      absolutePath,
      content,
      evidence: {
        path: displayPath,
        status: "present",
        sha256: sha256(content),
        bytes: content.byteLength,
      },
    };
  } catch (error) {
    return {
      absolutePath,
      evidence: {
        path: displayPath,
        status: "invalid",
        reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function validateEvidenceFile(
  value: unknown,
  roots: string[],
  label: string,
  errors: string[],
): LoadedArtifact | undefined {
  const evidence = asRecord(value);
  const path = stringValue(evidence.path);
  const expectedSha256 = stringValue(evidence.sha256);
  const expectedBytes = finiteNumber(evidence.bytes);
  if (!path || !SHA256_RE.test(expectedSha256 ?? "") || expectedBytes === null || expectedBytes <= 0) {
    errors.push(`${label} evidence metadata is invalid`);
    return undefined;
  }
  const candidates = uniquePaths([
    ...(isAbsolute(path) ? [resolve(path)] : []),
    ...roots.map((root) => resolve(root, path)),
    resolve(path),
  ]);
  let fallback: LoadedArtifact | undefined;
  for (const candidate of candidates) {
    const loaded = loadJsonOrTextArtifact(candidate);
    if (loaded.evidence.status !== "present") continue;
    fallback ??= loaded;
    if (loaded.evidence.sha256 === expectedSha256 && loaded.evidence.bytes === expectedBytes) return loaded;
  }
  if (fallback) errors.push(`${label} size or hash mismatch`);
  else errors.push(`${label} file is missing`);
  return fallback;
}

function loadJsonOrTextArtifact(absolutePath: string): LoadedArtifact {
  const loaded = loadFileArtifact(absolutePath, process.cwd());
  if (!loaded.content || loaded.evidence.status !== "present") return loaded;
  try {
    return { ...loaded, value: JSON.parse(decodeJsonBuffer(loaded.content)) as unknown };
  } catch {
    return loaded;
  }
}

function resolveFileByHash(path: string, roots: string[], expectedSha256: string): string | undefined {
  const candidates = uniquePaths([
    ...(isAbsolute(path) ? [resolve(path)] : []),
    ...roots.map((root) => resolve(root, path)),
    resolve(path),
  ]);
  return candidates.find((candidate) => {
    const content = readFileForHash(candidate);
    return content ? sha256(content) === expectedSha256 : false;
  });
}

function expectedIdsByCategory(
  cases: ProjectionCase[],
): Record<SpreadsheetBenchV2Category, Set<string>> {
  return Object.fromEntries(SPREADSHEETBENCH_V2_CATEGORIES.map((category) => [
    category,
    new Set(cases.filter((row) => row.category === category).map((row) => row.id)),
  ])) as Record<SpreadsheetBenchV2Category, Set<string>>;
}

function validReceiptIds(
  audits: SpreadsheetBenchV2TaskReceiptAudit[],
  key: "traceReceiptValid" | "candidateReceiptValid" | "scorerReceiptValid",
): Set<string> {
  return new Set(audits.filter((audit) => audit[key] === true && audit.taskId).map((audit) => audit.taskId));
}

function validEvidenceShape(value: unknown): boolean {
  const evidence = asRecord(value);
  return Boolean(stringValue(evidence.path))
    && SHA256_RE.test(stringValue(evidence.sha256) ?? "")
    && (finiteNumber(evidence.bytes) ?? 0) > 0;
}

function requiredTrajectoryPresent(steps: string[]): boolean {
  const required = [
    "read_agent_manifest",
    "prepare_agent_workspace",
    "call_model_for_edit_plan",
    "emit_candidate_workbook",
    "read_evaluator_manifest",
    "score_candidate",
  ];
  let cursor = -1;
  for (const step of required) {
    const next = steps.indexOf(step, cursor + 1);
    if (next < 0) return false;
    cursor = next;
  }
  return true;
}

function explanationFrom(value: Record<string, unknown>): string | undefined {
  for (const key of ["emptyPlanExplanation", "emptyPlanReason", "noOpReason", "explanation", "reason"] as const) {
    const explanation = stringValue(value[key]);
    if (explanation) return explanation;
  }
  const emptyPlan = asOptionalRecord(value.emptyPlan);
  return emptyPlan ? stringValue(emptyPlan.explanation) ?? stringValue(emptyPlan.reason) : undefined;
}

function substantiveExplanation(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length < 12) return false;
  return !/^(?:n\/?a|none|unknown|empty|no[- ]?op(?:eration)?s?|not applicable|no reason)(?:[.!])?$/i.test(normalized);
}

function normalizedCategory(
  category: unknown,
  taskId: string,
): SpreadsheetBenchV2Category | undefined {
  const candidate = typeof category === "string" && category ? category : taskId.split("/", 1)[0];
  return SPREADSHEETBENCH_V2_CATEGORIES.find((known) => known === candidate);
}

function emptyArtifacts(): SpreadsheetBenchV2QualityGateVerdict["artifacts"] {
  return {
    officialReceipt: { status: "unconfigured" },
    officialResults: {},
    modelRunReceipts: [],
  };
}

function readFileForHash(path: string): Buffer | undefined {
  try {
    return existsSync(path) && statSync(path).isFile() ? readFileSync(path) : undefined;
  } catch {
    return undefined;
  }
}

function decodeJsonBuffer(buffer: Buffer): string {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3).toString("utf8");
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString("utf16le").replace(/^\uFEFF/, "");
  }
  return buffer.toString("utf8").replace(/^\uFEFF/, "");
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  return Object.keys(record).length > 0 ? record : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function integerNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
}

function sameNumber(left: number | null, right: number | null, tolerance = 1e-9): boolean {
  return left !== null && right !== null && Math.abs(left - right) <= tolerance;
}

function formatNumber(value: number | null): string {
  return value === null ? "n/a" : Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function uniquePaths(paths: string[]): string[] {
  return [...new Set(paths.map((path) => normalizedPath(resolve(path))))];
}

function normalizedPath(path: string): string {
  return process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
}

function rel(cwd: string, path: string): string {
  return relative(cwd, resolve(path)).replace(/\\/g, "/") || basename(path);
}
