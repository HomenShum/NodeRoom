import { stableJournalHash } from "../core/journal";
import type { ReasoningFramePlan, ReasoningFramePhase } from "../core/reasoningFrames";

export const ANALYSIS_DATASET_SCHEMA_V1 = "noderoom.analysis-dataset/v1" as const;
export const RESEARCH_PLAN_SCHEMA_V1 = "noderoom.research-plan/v1" as const;
export const ANALYSIS_TASK_RUN_SCHEMA_V1 = "noderoom.analysis-task-run/v1" as const;
export const RESEARCH_PACK_SCHEMA_V1 = "noderoom.research-pack/v1" as const;
export const INVESTIGATION_WORKSPACE_SCHEMA_V1 = "noderoom.investigation-workspace/v1" as const;
export const INVESTIGATION_LAUNCH_INTENT_SCHEMA_V1 = "noderoom.investigation-launch-intent/v1" as const;
export const INVESTIGATION_LAUNCH_RECEIPT_SCHEMA_V1 = "noderoom.investigation-launch-receipt/v1" as const;
export const INVESTIGATION_CONSENT_MAX_AGE_MS = 5 * 60 * 1_000;

export type ResearchPlanStatusV1 = "ready" | "blocked";
export type AnalysisTaskRunStatusV1 = "queued" | "running" | "cached" | "completed" | "blocked" | "failed";
export type AnalysisTaskStatusSourceV1 = "plan" | "cache" | "runtime" | "server_job" | "validation";

export interface InvestigationSourceRefV1 {
  sourceRefId: string;
  kind: "source" | "upload" | "computed" | "manual" | "trace";
  label: string;
  artifactId: string;
  elementId?: string;
  uri?: string;
  contentHash: string;
  verifiedAt?: number;
  contentDigest?: string;
  receiptDigest?: string;
  verificationStatus: "verified" | "unverified" | "tampered";
}

export interface InvestigationLaunchIntentV1 {
  schema: typeof INVESTIGATION_LAUNCH_INTENT_SCHEMA_V1;
  planId: string;
  planDigest: string;
  datasetId: string;
  datasetVersionId: string;
  datasetContentHash: string;
  artifactId: string;
  artifactVersion: number;
  consent: {
    publicSourceRetrieval: true;
    approvedAt: number;
  };
}

export interface InvestigationLaunchReceiptV1 extends Omit<InvestigationLaunchIntentV1, "schema" | "consent"> {
  schema: typeof INVESTIGATION_LAUNCH_RECEIPT_SCHEMA_V1;
  consent: InvestigationLaunchIntentV1["consent"] & {
    approvedByActorId: string;
  };
  receiptDigest: string;
}

export interface AnalysisDatasetRowV1 {
  rowId: string;
  entityKey: string;
  entityLabel: string;
  fields: Record<string, unknown>;
  fieldVersions: Record<string, number>;
  fieldStatuses: Record<string, string>;
  fieldConfidence: Record<string, number>;
  fieldSourceRefIds: Record<string, string[]>;
  sourceRefs: InvestigationSourceRefV1[];
  updatedAt: number;
}

export interface AnalysisDatasetV1 {
  schema: typeof ANALYSIS_DATASET_SCHEMA_V1;
  datasetId: string;
  roomId: string;
  artifactId: string;
  artifactTitle: string;
  version: number;
  versionId: string;
  contentHash: string;
  createdAt: number;
  rows: AnalysisDatasetRowV1[];
  columns: string[];
  sourceRefs: InvestigationSourceRefV1[];
  truncated: boolean;
  warnings: string[];
}

export interface ResearchQuestionV1 {
  questionId: string;
  title: string;
  purpose: string;
  requiredFields: string[];
}

export interface ResearchPlanTaskV1 {
  taskId: string;
  frameId: string;
  phase: ReasoningFramePhase;
  title: string;
  questionIds: string[];
  dependsOn: string[];
  datasetIds: string[];
  cacheKeys: string[];
  cachePolicy: "cache_first";
  mutationMode: "none" | "room_tools_only";
  toolAllowlist: string[];
  expectedOutputSchema: string;
}

export interface ResearchPlanV1 {
  schema: typeof RESEARCH_PLAN_SCHEMA_V1;
  planId: string;
  planDigest: string;
  roomId: string;
  goal: string;
  status: ResearchPlanStatusV1;
  createdAt: number;
  datasetRefs: Array<{
    datasetId: string;
    version: number;
    versionId: string;
    contentHash: string;
  }>;
  questions: ResearchQuestionV1[];
  tasks: ResearchPlanTaskV1[];
  framePlan: ReasoningFramePlan;
  executionPolicy: {
    runtime: "nodeagent";
    cache: "reasoning_frames_entity_cache";
    writes: "room_tools_only";
    egress: "explicit_user_action";
  };
  provenance: {
    artifactRefs: Array<{ artifactId: string; version: number }>;
    traceIds: string[];
    compiler: "nodeagent.reasoning_frames";
  };
}

export interface InvestigationRuntimeStateV1 {
  source?: "room_store" | "durable_job" | "room_session";
  jobId?: string;
  latestRunId?: string;
  status?: string;
  modelPolicy?: string;
  approvalPolicy?: string;
  evidencePolicy?: string;
  attempts?: number;
  error?: string;
  createdAt?: number;
  updatedAt?: number;
  authorization?: InvestigationLaunchReceiptV1;
  /** Digest of the durable job's terminal result, not a client projection. */
  resultDigest?: string;
  telemetry?: {
    model: string;
    steps: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    costKind: string;
    ms: number;
  };
}

export interface AnalysisTaskOutputReceiptV1 {
  kind: "plan" | "cache" | "server_job";
  statusSource: AnalysisTaskStatusSourceV1;
  claimArtifactDigest: string;
  cacheEvidenceDigest?: string;
  serverJobId?: string;
  serverRunId?: string;
  resultDigest?: string;
}

export interface AnalysisTaskRunV1 {
  schema: typeof ANALYSIS_TASK_RUN_SCHEMA_V1;
  runId: string;
  planId: string;
  taskId: string;
  phase: ReasoningFramePhase;
  status: AnalysisTaskRunStatusV1;
  statusSource: AnalysisTaskStatusSourceV1;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  inputDigest: string;
  outputDigest?: string;
  outputReceipt?: AnalysisTaskOutputReceiptV1;
  provenanceHash: string;
  runDigest: string;
  provenance: {
    datasetRefs: Array<{ datasetId: string; versionId: string; contentHash: string }>;
    dependencyRunIds: string[];
    cacheKeys: string[];
    traceIds: string[];
    frameId: string;
    serverJob?: Omit<InvestigationRuntimeStateV1, "telemetry">;
    telemetry?: InvestigationRuntimeStateV1["telemetry"];
  };
  failure?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface ResearchPackClaimV1 {
  claimId: string;
  rowId: string;
  entityLabel: string;
  field: string;
  value: string;
  sourceRefIds: string[];
  status: "supported" | "stale" | "needs_review";
  confidence?: number;
}

export interface ResearchPackV1 {
  schema: typeof RESEARCH_PACK_SCHEMA_V1;
  packId: string;
  packDigest: string;
  planId: string;
  datasetRefs: ResearchPlanV1["datasetRefs"];
  taskRunIds: string[];
  taskRunReceipts: Array<{
    taskId: string;
    runId: string;
    runDigest: string;
    status: AnalysisTaskRunStatusV1;
    statusSource: AnalysisTaskStatusSourceV1;
    inputDigest: string;
    outputDigest?: string;
    provenanceHash: string;
  }>;
  sourceRefs: InvestigationSourceRefV1[];
  traceIds: string[];
  claims: ResearchPackClaimV1[];
  coverage: {
    totalClaims: number;
    sourcedClaims: number;
    staleClaims: number;
    needsReviewClaims: number;
    ratio: number;
  };
  compiledAt: number;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseInvestigationLaunchIntentV1(value: unknown): InvestigationLaunchIntentV1 | null {
  const input = recordOf(value);
  const consent = recordOf(input?.consent);
  if (
    input?.schema !== INVESTIGATION_LAUNCH_INTENT_SCHEMA_V1 ||
    !nonEmptyString(input.planId) ||
    !nonEmptyString(input.planDigest) ||
    !nonEmptyString(input.datasetId) ||
    !nonEmptyString(input.datasetVersionId) ||
    !nonEmptyString(input.datasetContentHash) ||
    !nonEmptyString(input.artifactId) ||
    !Number.isInteger(input.artifactVersion) ||
    (input.artifactVersion as number) < 0 ||
    consent?.publicSourceRetrieval !== true ||
    !finitePositiveNumber(consent.approvedAt)
  ) {
    return null;
  }
  return {
    schema: INVESTIGATION_LAUNCH_INTENT_SCHEMA_V1,
    planId: input.planId,
    planDigest: input.planDigest,
    datasetId: input.datasetId,
    datasetVersionId: input.datasetVersionId,
    datasetContentHash: input.datasetContentHash,
    artifactId: input.artifactId,
    artifactVersion: input.artifactVersion as number,
    consent: {
      publicSourceRetrieval: true,
      approvedAt: consent.approvedAt,
    },
  };
}

export function buildInvestigationLaunchIntentV1(args: {
  plan: ResearchPlanV1;
  dataset: AnalysisDatasetV1;
  approvedAt?: number;
}): InvestigationLaunchIntentV1 {
  return {
    schema: INVESTIGATION_LAUNCH_INTENT_SCHEMA_V1,
    planId: args.plan.planId,
    planDigest: args.plan.planDigest,
    datasetId: args.dataset.datasetId,
    datasetVersionId: args.dataset.versionId,
    datasetContentHash: args.dataset.contentHash,
    artifactId: args.dataset.artifactId,
    artifactVersion: args.dataset.version,
    consent: {
      publicSourceRetrieval: true,
      approvedAt: args.approvedAt ?? Date.now(),
    },
  };
}

export function investigationLaunchIntentMatchesV1(args: {
  intent: unknown;
  plan: ResearchPlanV1;
  dataset: AnalysisDatasetV1;
}): args is {
  intent: InvestigationLaunchIntentV1;
  plan: ResearchPlanV1;
  dataset: AnalysisDatasetV1;
} {
  const intent = parseInvestigationLaunchIntentV1(args.intent);
  return !!intent &&
    intent.planId === args.plan.planId &&
    intent.planDigest === args.plan.planDigest &&
    intent.datasetId === args.dataset.datasetId &&
    intent.datasetVersionId === args.dataset.versionId &&
    intent.datasetContentHash === args.dataset.contentHash &&
    intent.artifactId === args.dataset.artifactId &&
    intent.artifactVersion === args.dataset.version;
}

function investigationLaunchReceiptCore(
  receipt: Omit<InvestigationLaunchReceiptV1, "receiptDigest"> | InvestigationLaunchReceiptV1,
): Omit<InvestigationLaunchReceiptV1, "receiptDigest"> {
  const { receiptDigest: _receiptDigest, ...core } = receipt as InvestigationLaunchReceiptV1;
  return core;
}

export function finalizeInvestigationLaunchReceiptV1(
  intent: InvestigationLaunchIntentV1,
  approvedByActorId: string,
): InvestigationLaunchReceiptV1 {
  const parsed = parseInvestigationLaunchIntentV1(intent);
  if (!parsed || !nonEmptyString(approvedByActorId)) {
    throw new Error("investigation_launch_intent_invalid");
  }
  const core: Omit<InvestigationLaunchReceiptV1, "receiptDigest"> = {
    ...parsed,
    schema: INVESTIGATION_LAUNCH_RECEIPT_SCHEMA_V1,
    consent: {
      ...parsed.consent,
      approvedByActorId,
    },
  };
  return {
    ...core,
    receiptDigest: stableJournalHash(core),
  };
}

export function parseInvestigationLaunchReceiptV1(value: unknown): InvestigationLaunchReceiptV1 | null {
  const input = recordOf(value);
  const consent = recordOf(input?.consent);
  if (
    input?.schema !== INVESTIGATION_LAUNCH_RECEIPT_SCHEMA_V1 ||
    !nonEmptyString(input.planId) ||
    !nonEmptyString(input.planDigest) ||
    !nonEmptyString(input.datasetId) ||
    !nonEmptyString(input.datasetVersionId) ||
    !nonEmptyString(input.datasetContentHash) ||
    !nonEmptyString(input.artifactId) ||
    !Number.isInteger(input.artifactVersion) ||
    (input.artifactVersion as number) < 0 ||
    consent?.publicSourceRetrieval !== true ||
    !finitePositiveNumber(consent.approvedAt) ||
    !nonEmptyString(consent.approvedByActorId) ||
    !nonEmptyString(input.receiptDigest)
  ) {
    return null;
  }
  const receipt: InvestigationLaunchReceiptV1 = {
    schema: INVESTIGATION_LAUNCH_RECEIPT_SCHEMA_V1,
    planId: input.planId,
    planDigest: input.planDigest,
    datasetId: input.datasetId,
    datasetVersionId: input.datasetVersionId,
    datasetContentHash: input.datasetContentHash,
    artifactId: input.artifactId,
    artifactVersion: input.artifactVersion as number,
    consent: {
      publicSourceRetrieval: true,
      approvedAt: consent.approvedAt,
      approvedByActorId: consent.approvedByActorId,
    },
    receiptDigest: input.receiptDigest,
  };
  return receipt.receiptDigest === stableJournalHash(investigationLaunchReceiptCore(receipt))
    ? receipt
    : null;
}

export function investigationLaunchReceiptMatchesV1(args: {
  receipt: unknown;
  plan: ResearchPlanV1;
  dataset: AnalysisDatasetV1;
}): args is {
  receipt: InvestigationLaunchReceiptV1;
  plan: ResearchPlanV1;
  dataset: AnalysisDatasetV1;
} {
  const receipt = parseInvestigationLaunchReceiptV1(args.receipt);
  return !!receipt &&
    receipt.planId === args.plan.planId &&
    receipt.planDigest === args.plan.planDigest &&
    receipt.datasetId === args.dataset.datasetId &&
    receipt.datasetVersionId === args.dataset.versionId &&
    receipt.datasetContentHash === args.dataset.contentHash &&
    receipt.artifactId === args.dataset.artifactId &&
    receipt.artifactVersion === args.dataset.version;
}

export interface TeachingCaseV1 {
  title: string;
  setup: string;
  decisionQuestion: string;
  evidenceCards: Array<{
    claimId: string;
    label: string;
    value: string;
    sourceCount: number;
    status: ResearchPackClaimV1["status"];
  }>;
  openQuestions: string[];
  learningObjectives: string[];
  recommendedNextStep: string;
}

export interface ResearchPlanValidationIssue {
  level: "error" | "warning";
  code: string;
  path: string;
  message: string;
}

export interface ResearchPlanValidationResult {
  valid: boolean;
  issues: ResearchPlanValidationIssue[];
  taskOrder: string[];
}

export type InvestigationWorkspaceStateV1 = "ready" | "running" | "complete" | "blocked" | "failed";

export interface InvestigationWorkspaceV1 {
  schema: typeof INVESTIGATION_WORKSPACE_SCHEMA_V1;
  state: InvestigationWorkspaceStateV1;
  dataset: AnalysisDatasetV1 | null;
  plan: ResearchPlanV1 | null;
  taskRuns: AnalysisTaskRunV1[];
  researchPack: ResearchPackV1 | null;
  teachingCase: TeachingCaseV1 | null;
  validation: ResearchPlanValidationResult;
  runtime: InvestigationRuntimeStateV1 | null;
  summary: {
    entityCount: number;
    taskCount: number;
    completedTaskCount: number;
    pendingTaskCount: number;
    sourceCount: number;
    needsReviewCount: number;
  };
}

function duplicateIds(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return Array.from(duplicates).sort();
}

function planDigestInput(plan: ResearchPlanV1): Omit<ResearchPlanV1, "planDigest"> {
  const { planDigest: _planDigest, ...input } = plan;
  return input;
}

export function researchPlanDigest(plan: ResearchPlanV1): string {
  return stableJournalHash(planDigestInput(plan));
}

function taskGraphOrder(
  tasks: readonly ResearchPlanTaskV1[],
): { order: string[]; missing: Array<{ taskId: string; dependencyId: string }>; cyclic: string[] } {
  const ids = new Set(tasks.map((task) => task.taskId));
  const missing: Array<{ taskId: string; dependencyId: string }> = [];
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const task of tasks) {
    indegree.set(task.taskId, 0);
    dependents.set(task.taskId, []);
  }
  for (const task of tasks) {
    for (const dependencyId of task.dependsOn) {
      if (!ids.has(dependencyId)) {
        missing.push({ taskId: task.taskId, dependencyId });
        continue;
      }
      indegree.set(task.taskId, (indegree.get(task.taskId) ?? 0) + 1);
      dependents.get(dependencyId)?.push(task.taskId);
    }
  }
  const ready = tasks
    .filter((task) => (indegree.get(task.taskId) ?? 0) === 0)
    .map((task) => task.taskId)
    .sort();
  const order: string[] = [];
  while (ready.length) {
    const next = ready.shift()!;
    order.push(next);
    for (const dependent of (dependents.get(next) ?? []).sort()) {
      const value = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, value);
      if (value === 0) {
        ready.push(dependent);
        ready.sort();
      }
    }
  }
  const cyclic = tasks.map((task) => task.taskId).filter((taskId) => !order.includes(taskId)).sort();
  return { order, missing, cyclic };
}

export function validateResearchPlanV1(
  plan: ResearchPlanV1,
  datasets: readonly AnalysisDatasetV1[] = [],
): ResearchPlanValidationResult {
  const issues: ResearchPlanValidationIssue[] = [];
  if (plan.schema !== RESEARCH_PLAN_SCHEMA_V1) {
    issues.push({ level: "error", code: "schema_mismatch", path: "schema", message: `Expected ${RESEARCH_PLAN_SCHEMA_V1}.` });
  }
  if (!plan.planId.trim()) issues.push({ level: "error", code: "plan_id_missing", path: "planId", message: "Plan id is required." });
  if (!plan.roomId.trim()) issues.push({ level: "error", code: "room_id_missing", path: "roomId", message: "Room id is required." });
  if (!plan.goal.trim()) issues.push({ level: "error", code: "goal_missing", path: "goal", message: "A falsifiable research goal is required." });
  if (!plan.datasetRefs.length) {
    issues.push({ level: "error", code: "dataset_ref_missing", path: "datasetRefs", message: "At least one versioned analysis dataset is required." });
  }

  for (const id of duplicateIds(plan.datasetRefs.map((ref) => ref.datasetId))) {
    issues.push({ level: "error", code: "dataset_ref_duplicate", path: "datasetRefs", message: `Dataset ${id} is referenced more than once.` });
  }
  for (const id of duplicateIds(plan.questions.map((question) => question.questionId))) {
    issues.push({ level: "error", code: "question_duplicate", path: "questions", message: `Question ${id} is duplicated.` });
  }
  for (const id of duplicateIds(plan.tasks.map((task) => task.taskId))) {
    issues.push({ level: "error", code: "task_duplicate", path: "tasks", message: `Task ${id} is duplicated.` });
  }
  for (const id of duplicateIds(plan.framePlan.frames.map((frame) => frame.frameId))) {
    issues.push({ level: "error", code: "frame_duplicate", path: "framePlan.frames", message: `Frame ${id} is duplicated.` });
  }
  for (const id of duplicateIds(plan.framePlan.childFrames.map((frame) => frame.frameId))) {
    issues.push({ level: "error", code: "child_frame_duplicate", path: "framePlan.childFrames", message: `Child frame ${id} is duplicated.` });
  }
  for (const key of duplicateIds(plan.framePlan.childFrames.map((frame) => frame.cacheKey))) {
    issues.push({ level: "error", code: "cache_key_duplicate", path: "framePlan.childFrames", message: `Child-frame cache key ${key} is duplicated.` });
  }

  const datasetIds = new Set(plan.datasetRefs.map((ref) => ref.datasetId));
  const questionIds = new Set(plan.questions.map((question) => question.questionId));
  const framesById = new Map(plan.framePlan.frames.map((frame) => [frame.frameId, frame]));
  if (plan.framePlan.framePlanId !== plan.planId) {
    issues.push({ level: "error", code: "frame_plan_id_mismatch", path: "framePlan.framePlanId", message: "The reasoning-frame plan does not belong to this research plan." });
  }
  for (const [index, task] of plan.tasks.entries()) {
    if (!task.datasetIds.length) {
      issues.push({ level: "error", code: "task_dataset_missing", path: `tasks[${index}].datasetIds`, message: `${task.taskId} has no dataset input.` });
    }
    for (const datasetId of task.datasetIds) {
      if (!datasetIds.has(datasetId)) {
        issues.push({ level: "error", code: "task_dataset_unknown", path: `tasks[${index}].datasetIds`, message: `${task.taskId} references unknown dataset ${datasetId}.` });
      }
    }
    for (const questionId of task.questionIds) {
      if (!questionIds.has(questionId)) {
        issues.push({ level: "error", code: "task_question_unknown", path: `tasks[${index}].questionIds`, message: `${task.taskId} references unknown question ${questionId}.` });
      }
    }
    if (!task.expectedOutputSchema.trim()) {
      issues.push({ level: "error", code: "task_output_schema_missing", path: `tasks[${index}].expectedOutputSchema`, message: `${task.taskId} has no output contract.` });
    }
    const frame = framesById.get(task.frameId);
    if (!frame) {
      issues.push({ level: "error", code: "task_frame_unknown", path: `tasks[${index}].frameId`, message: `${task.taskId} references unknown frame ${task.frameId}.` });
    } else if (frame.phase !== task.phase) {
      issues.push({ level: "error", code: "task_frame_phase_mismatch", path: `tasks[${index}].phase`, message: `${task.taskId} does not match its reasoning-frame phase.` });
    }
    for (const dependencyId of duplicateIds(task.dependsOn)) {
      issues.push({ level: "error", code: "task_dependency_duplicate", path: `tasks[${index}].dependsOn`, message: `${task.taskId} repeats dependency ${dependencyId}.` });
    }
  }

  const graph = taskGraphOrder(plan.tasks);
  for (const missing of graph.missing) {
    issues.push({
      level: "error",
      code: "task_dependency_missing",
      path: `tasks.${missing.taskId}.dependsOn`,
      message: `${missing.taskId} depends on unknown task ${missing.dependencyId}.`,
    });
  }
  if (graph.cyclic.length) {
    issues.push({
      level: "error",
      code: "task_dependency_cycle",
      path: "tasks",
      message: `Task DAG contains a cycle involving ${graph.cyclic.join(", ")}.`,
    });
  }

  if (datasets.length) {
    const byId = new Map(datasets.map((dataset) => [dataset.datasetId, dataset]));
    for (const dataset of datasets) {
      for (const rowId of duplicateIds(dataset.rows.map((row) => row.rowId))) {
        issues.push({
          level: "error",
          code: "analysis_row_id_duplicate",
          path: `datasets.${dataset.datasetId}.rows`,
          message: `Analysis row id ${rowId} is duplicated.`,
        });
      }
      for (const entityKey of duplicateIds(dataset.rows.map((row) => row.entityKey))) {
        issues.push({
          level: "error",
          code: "analysis_entity_key_duplicate",
          path: `datasets.${dataset.datasetId}.rows`,
          message: `Analysis entity key ${entityKey} is duplicated.`,
        });
      }
    }
    for (const [index, ref] of plan.datasetRefs.entries()) {
      const dataset = byId.get(ref.datasetId);
      if (!dataset) {
        issues.push({ level: "error", code: "dataset_unavailable", path: `datasetRefs[${index}]`, message: `Dataset ${ref.datasetId} is not available.` });
      } else if (dataset.roomId !== plan.roomId) {
        issues.push({ level: "error", code: "dataset_room_mismatch", path: `datasetRefs[${index}]`, message: `Dataset ${ref.datasetId} belongs to another room.` });
      } else if (dataset.version !== ref.version || dataset.versionId !== ref.versionId || dataset.contentHash !== ref.contentHash) {
        issues.push({ level: "error", code: "dataset_version_mismatch", path: `datasetRefs[${index}]`, message: `Dataset ${ref.datasetId} no longer matches ${ref.versionId}.` });
      }
    }
  }

  if (plan.planDigest !== researchPlanDigest(plan)) {
    issues.push({ level: "error", code: "plan_digest_mismatch", path: "planDigest", message: "Plan digest does not match its canonical content." });
  }
  if (plan.provenance.artifactRefs.length === 0) {
    issues.push({ level: "warning", code: "artifact_provenance_empty", path: "provenance.artifactRefs", message: "Plan has no room artifact provenance." });
  }

  return {
    valid: !issues.some((issue) => issue.level === "error"),
    issues,
    taskOrder: graph.missing.length || graph.cyclic.length ? [] : graph.order,
  };
}

export class ResearchPlanValidationError extends Error {
  constructor(readonly issues: ResearchPlanValidationIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "ResearchPlanValidationError";
  }
}

export function topologicalResearchTaskOrder(plan: ResearchPlanV1): ResearchPlanTaskV1[] {
  const validation = validateResearchPlanV1(plan);
  if (!validation.valid) throw new ResearchPlanValidationError(validation.issues);
  const byId = new Map(plan.tasks.map((task) => [task.taskId, task]));
  return validation.taskOrder.map((taskId) => byId.get(taskId)!).filter(Boolean);
}

export type AnalysisTaskRunTransitionV1 =
  | { type: "start"; at: number; source?: AnalysisTaskStatusSourceV1 }
  | { type: "complete"; at: number; output: unknown; source?: AnalysisTaskStatusSourceV1 }
  | { type: "cache_hit"; at: number; output: unknown }
  | { type: "block"; at: number; code: string; message: string; retryable?: boolean; source?: AnalysisTaskStatusSourceV1 }
  | { type: "fail"; at: number; code: string; message: string; retryable?: boolean; source?: AnalysisTaskStatusSourceV1 }
  | { type: "retry"; at: number; source?: AnalysisTaskStatusSourceV1 };

const ALLOWED_TRANSITIONS: Record<AnalysisTaskRunStatusV1, AnalysisTaskRunTransitionV1["type"][]> = {
  queued: ["start", "cache_hit", "block", "fail"],
  running: ["complete", "block", "fail"],
  cached: [],
  completed: [],
  blocked: ["retry"],
  failed: ["retry"],
};

export function transitionAnalysisTaskRunV1(
  run: AnalysisTaskRunV1,
  transition: AnalysisTaskRunTransitionV1,
): AnalysisTaskRunV1 {
  if (!ALLOWED_TRANSITIONS[run.status].includes(transition.type)) {
    throw new Error(`invalid_analysis_task_transition:${run.status}->${transition.type}`);
  }

  let next: AnalysisTaskRunV1;
  if (transition.type === "start") {
    next = { ...run, status: "running", statusSource: transition.source ?? run.statusSource, startedAt: transition.at, failure: undefined };
  } else if (transition.type === "complete") {
    const statusSource = transition.source ?? run.statusSource;
    const outputReceipt = analysisTaskOutputReceipt(run, statusSource);
    next = {
      ...run,
      status: "completed",
      statusSource,
      startedAt: run.startedAt ?? transition.at,
      completedAt: transition.at,
      outputReceipt,
      outputDigest: stableJournalHash({ output: transition.output, outputReceipt }),
      failure: undefined,
    };
  } else if (transition.type === "cache_hit") {
    const outputReceipt = analysisTaskOutputReceipt(run, "cache");
    next = {
      ...run,
      status: "cached",
      statusSource: "cache",
      completedAt: transition.at,
      outputReceipt,
      outputDigest: stableJournalHash({ output: transition.output, outputReceipt }),
      failure: undefined,
    };
  } else if (transition.type === "retry") {
    next = {
      ...run,
      status: "queued",
      statusSource: transition.source ?? run.statusSource,
      startedAt: undefined,
      completedAt: undefined,
      outputDigest: undefined,
      outputReceipt: undefined,
      failure: undefined,
    };
  } else {
    next = {
      ...run,
      status: transition.type === "block" ? "blocked" : "failed",
      statusSource: transition.source ?? run.statusSource,
      completedAt: transition.at,
      failure: {
        code: transition.code,
        message: transition.message,
        retryable: transition.retryable ?? transition.type === "block",
      },
    };
  }

  const provenanceHash = stableJournalHash(next.provenance);
  const withProvenance = { ...next, provenanceHash };
  return { ...withProvenance, runDigest: analysisTaskRunDigestV1(withProvenance) };
}

function analysisTaskOutputReceipt(
  run: AnalysisTaskRunV1,
  statusSource: AnalysisTaskStatusSourceV1,
): AnalysisTaskOutputReceiptV1 {
  const claimArtifactDigest = stableJournalHash(
    run.provenance.datasetRefs.map((ref) => ({
      datasetId: ref.datasetId,
      versionId: ref.versionId,
      contentHash: ref.contentHash,
    })),
  );
  const serverJob = run.provenance.serverJob;
  if (statusSource === "server_job" && serverJob?.jobId) {
    return {
      kind: "server_job",
      statusSource,
      claimArtifactDigest: run.provenance.datasetRefs.length === 1
        ? run.provenance.datasetRefs[0].contentHash
        : claimArtifactDigest,
      serverJobId: serverJob.jobId,
      ...(serverJob.latestRunId ? { serverRunId: serverJob.latestRunId } : {}),
      ...(serverJob.resultDigest ? { resultDigest: serverJob.resultDigest } : {}),
    };
  }
  if (statusSource === "cache") {
    return {
      kind: "cache",
      statusSource,
      claimArtifactDigest: run.provenance.datasetRefs.length === 1
        ? run.provenance.datasetRefs[0].contentHash
        : claimArtifactDigest,
      cacheEvidenceDigest: stableJournalHash({
        cacheKeys: run.provenance.cacheKeys,
        datasetRefs: run.provenance.datasetRefs,
      }),
    };
  }
  return {
    kind: "plan",
    statusSource,
    claimArtifactDigest: run.provenance.datasetRefs.length === 1
      ? run.provenance.datasetRefs[0].contentHash
      : claimArtifactDigest,
  };
}

export function analysisTaskRunDigestV1(
  run: Omit<AnalysisTaskRunV1, "runDigest"> | AnalysisTaskRunV1,
): string {
  const { runDigest: _runDigest, ...core } = run as AnalysisTaskRunV1;
  return stableJournalHash(core);
}
