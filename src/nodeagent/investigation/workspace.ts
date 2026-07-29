import type { AgentSession, Artifact, CellEvidence, CellPayload, TraceEvent } from "../../engine/types";
import {
  cellEvidenceReceiptDigest,
  cellEvidenceVerificationStatus,
} from "../core/evidenceReceipt";
import { stableJournalHash } from "../core/journal";
import {
  buildRoomWorkReasoningPlan,
  type ReasoningFrame,
  type RoomWorkReasoningFacetPlan,
} from "../core/reasoningFrames";
import {
  ANALYSIS_DATASET_SCHEMA_V1,
  ANALYSIS_TASK_RUN_SCHEMA_V1,
  INVESTIGATION_WORKSPACE_SCHEMA_V1,
  RESEARCH_PACK_SCHEMA_V1,
  RESEARCH_PLAN_SCHEMA_V1,
  type AnalysisDatasetRowV1,
  type AnalysisDatasetV1,
  type AnalysisTaskRunStatusV1,
  type AnalysisTaskRunV1,
  type InvestigationRuntimeStateV1,
  type InvestigationSourceRefV1,
  type InvestigationWorkspaceV1,
  type ResearchPackClaimV1,
  type ResearchPackV1,
  type ResearchPlanTaskV1,
  type ResearchPlanV1,
  type ResearchPlanValidationIssue,
  type TeachingCaseV1,
  analysisTaskRunDigestV1,
  investigationLaunchReceiptMatchesV1,
  researchPlanDigest,
  transitionAnalysisTaskRunV1,
  validateResearchPlanV1,
} from "./contracts";

const RESEARCH_ARTIFACT_TITLE = "Company research";
const RESEARCH_FIELDS = ["summary", "funding", "headcount", "recent_signal"] as const;
const FRESH_FOR_MS = 72 * 60 * 60 * 1_000;
const MAX_TRACE_REFS = 24;

type ResearchField = typeof RESEARCH_FIELDS[number];

function slug(value: string, fallback = "item"): string {
  const clean = value.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_:-]/g, "").replace(/^_+|_+$/g, "");
  return (clean || fallback).slice(0, 96);
}

function payloadOf(value: unknown): CellPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value) || !("value" in value)) return null;
  return value as CellPayload;
}

function scalarOf(value: unknown): unknown {
  return payloadOf(value)?.value ?? value;
}

function textOf(value: unknown): string {
  const scalar = scalarOf(value);
  if (scalar === null || scalar === undefined) return "";
  if (typeof scalar === "string") return scalar.trim();
  if (typeof scalar === "number" || typeof scalar === "boolean") return String(scalar);
  try {
    return JSON.stringify(scalar);
  } catch {
    return String(scalar);
  }
}

function evidenceRef(artifactId: string, elementId: string, evidence: CellEvidence): InvestigationSourceRefV1 {
  const uri = evidence.url ?? evidence.source;
  const contentHash = cellEvidenceReceiptDigest(evidence);
  const verificationStatus = cellEvidenceVerificationStatus(evidence);
  const sourceRefId = `source_${stableJournalHash({
    artifactId,
    elementId,
    evidenceId: evidence.id,
    contentHash,
    receiptDigest: evidence.receiptDigest,
  })}`;
  return {
    sourceRefId,
    kind: evidence.kind,
    label: evidence.label || uri || evidence.id,
    artifactId,
    elementId,
    ...(uri ? { uri } : {}),
    contentHash,
    ...(evidence.verifiedAt !== undefined ? { verifiedAt: evidence.verifiedAt } : {}),
    ...(evidence.contentDigest ? { contentDigest: evidence.contentDigest } : {}),
    ...(evidence.receiptDigest ? { receiptDigest: evidence.receiptDigest } : {}),
    verificationStatus,
  };
}

function literalSourceRef(artifactId: string, elementId: string, value: string): InvestigationSourceRefV1 | null {
  const uri = value.trim();
  if (!/^https?:\/\//i.test(uri)) return null;
  const contentHash = stableJournalHash({ artifactId, elementId, uri });
  return {
    sourceRefId: `source_${contentHash}`,
    kind: "source",
    label: (() => {
      try {
        return new URL(uri).hostname.replace(/^www\./, "");
      } catch {
        return uri;
      }
    })(),
    artifactId,
    elementId,
    uri,
    contentHash,
    verificationStatus: "unverified",
  };
}

function sourceRefsForElement(artifactId: string, elementId: string, value: unknown): InvestigationSourceRefV1[] {
  const payload = payloadOf(value);
  const refs = (payload?.evidence ?? []).map((evidence) => evidenceRef(artifactId, elementId, evidence));
  const literal = literalSourceRef(artifactId, elementId, textOf(value));
  if (literal) refs.push(literal);
  return refs;
}

function dedupeSources(refs: readonly InvestigationSourceRefV1[]): InvestigationSourceRefV1[] {
  const byId = new Map<string, InvestigationSourceRefV1>();
  for (const ref of refs) byId.set(ref.sourceRefId, ref);
  return Array.from(byId.values()).sort((a, b) => a.sourceRefId.localeCompare(b.sourceRefId));
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function buildAnalysisDatasetV1(artifact: Artifact): AnalysisDatasetV1 {
  const rowIds = new Set<string>();
  const derivedColumns = new Set<string>();
  for (const elementId of Object.keys(artifact.elements)) {
    const separator = elementId.indexOf("__");
    if (separator <= 0) continue;
    rowIds.add(elementId.slice(0, separator));
    derivedColumns.add(elementId.slice(separator + 2));
  }
  const columns = artifact.meta?.dataframe?.columns
    ?.slice()
    .sort((a, b) => a.order - b.order)
    .map((column) => column.id) ?? Array.from(derivedColumns).sort(naturalCompare);

  const rows: AnalysisDatasetRowV1[] = Array.from(rowIds)
    .sort(naturalCompare)
    .map((rowId) => {
      const fields: Record<string, unknown> = {};
      const fieldVersions: Record<string, number> = {};
      const fieldStatuses: Record<string, string> = {};
      const fieldConfidence: Record<string, number> = {};
      const fieldSourceRefIds: Record<string, string[]> = {};
      const sourceRefs: InvestigationSourceRefV1[] = [];
      let updatedAt = 0;
      for (const field of columns) {
        const elementId = `${rowId}__${field}`;
        const element = artifact.elements[elementId];
        if (!element) continue;
        fields[field] = scalarOf(element.value);
        fieldVersions[field] = element.version;
        const payload = payloadOf(element.value);
        if (payload?.status) fieldStatuses[field] = payload.status;
        if (typeof payload?.confidence === "number") fieldConfidence[field] = payload.confidence;
        const fieldSources = sourceRefsForElement(artifact.id, elementId, element.value);
        fieldSourceRefIds[field] = fieldSources.map((source) => source.sourceRefId).sort();
        sourceRefs.push(...fieldSources);
        updatedAt = Math.max(updatedAt, element.updatedAt);
      }
      const entityLabel = textOf(fields.company) || textOf(fields.account) || rowId;
      return {
        rowId,
        entityKey: `${slug(entityLabel, rowId)}:${stableJournalHash({ artifactId: artifact.id, rowId }).slice(0, 12)}`,
        entityLabel,
        fields,
        fieldVersions,
        fieldStatuses,
        fieldConfidence,
        fieldSourceRefIds,
        sourceRefs: dedupeSources(sourceRefs),
        updatedAt,
      };
    })
    .filter((row) => Object.entries(row.fields).some(([field, value]) => (
      field !== "status" && field !== "last_researched" && textOf(value) !== ""
    )));

  const sourceRefs = dedupeSources(rows.flatMap((row) => row.sourceRefs));
  const contentHash = stableJournalHash({
    artifactId: artifact.id,
    artifactVersion: artifact.version,
    columns,
    rows: rows.map((row) => ({
      rowId: row.rowId,
      fields: row.fields,
      fieldVersions: row.fieldVersions,
      fieldStatuses: row.fieldStatuses,
      fieldConfidence: row.fieldConfidence,
      fieldSourceRefIds: row.fieldSourceRefIds,
      sourceRefIds: row.sourceRefs.map((ref) => ref.sourceRefId),
    })),
  });
  return {
    schema: ANALYSIS_DATASET_SCHEMA_V1,
    datasetId: `analysis:${artifact.id}`,
    roomId: artifact.roomId,
    artifactId: artifact.id,
    artifactTitle: artifact.title,
    version: artifact.version,
    versionId: `v${artifact.version}-${contentHash.slice(0, 8)}`,
    contentHash,
    createdAt: artifact.updatedAt,
    rows,
    columns,
    sourceRefs,
    truncated: artifact.meta?.dataframe?.truncated === true,
    warnings: [...(artifact.meta?.dataframe?.warnings ?? [])],
  };
}

function trustedSourceRef(ref: InvestigationSourceRefV1): boolean {
  return (ref.kind === "source" || ref.kind === "upload") && ref.verificationStatus === "verified";
}

function freshSourceRef(ref: InvestigationSourceRefV1, now: number): boolean {
  return trustedSourceRef(ref) &&
    Number.isFinite(ref.verifiedAt) &&
    (ref.verifiedAt ?? 0) <= now &&
    now - (ref.verifiedAt ?? 0) <= FRESH_FOR_MS;
}

function facetPlanFor(row: AnalysisDatasetRowV1, field: ResearchField, now: number): RoomWorkReasoningFacetPlan {
  const value = textOf(row.fields[field]);
  const rowStatus = textOf(row.fields.status).toLowerCase();
  const fieldRefIds = new Set(row.fieldSourceRefIds[field] ?? []);
  const fieldRefs = row.sourceRefs.filter((ref) => fieldRefIds.has(ref.sourceRefId));
  const trustedRefs = fieldRefs.filter(trustedSourceRef);
  const freshRefs = trustedRefs.filter((ref) => freshSourceRef(ref, now));
  const cacheKey = stableJournalHash({
    rowId: row.rowId,
    field,
    value,
    version: row.fieldVersions[field] ?? 0,
    sources: fieldRefs.map((ref) => ({
      sourceRefId: ref.sourceRefId,
      verificationStatus: ref.verificationStatus,
      verifiedAt: ref.verifiedAt,
    })),
  });
  const fresh = value !== "" && freshRefs.length > 0 && rowStatus === "complete";
  const reusable = value !== "" && trustedRefs.length > 0;
  const latestVerifiedAt = trustedRefs.reduce(
    (latest, ref) => Math.max(latest, ref.verifiedAt ?? 0),
    0,
  );
  return {
    entityType: "company",
    entityKey: row.entityKey,
    displayName: row.entityLabel,
    facet: field,
    cachePolicy: fresh ? "fresh_use_cache" : reusable ? "stale_use_cache_and_refresh" : "missing_research_now",
    status: fresh ? "complete" : reusable ? "needs_review" : "pending",
    cacheHit: reusable ? {
      cacheId: `investigation-cache:${cacheKey}`,
      fresh,
      visibility: "room",
      staleAfter: latestVerifiedAt ? latestVerifiedAt + FRESH_FOR_MS : undefined,
    } : null,
  };
}

function titleForPhase(phase: ReasoningFrame["phase"]): string {
  if (phase === "intake") return "Inventory the live room";
  if (phase === "plan") return "Build the cache-first analysis DAG";
  if (phase === "execute") return "Resolve stale or missing evidence";
  if (phase === "verify") return "Validate evidence and contradictions";
  return "Compile the research pack";
}

function questionIdsForPhase(phase: ReasoningFrame["phase"]): string[] {
  if (phase === "intake" || phase === "plan") return ["q_scope"];
  if (phase === "execute") return ["q_evidence", "q_gaps"];
  if (phase === "verify") return ["q_evidence", "q_contradictions"];
  return ["q_decision", "q_gaps"];
}

function taskFromFrame(frame: ReasoningFrame, previousTaskId: string | undefined, datasetId: string): ResearchPlanTaskV1 {
  return {
    taskId: `task:${frame.frameId}`,
    frameId: frame.frameId,
    phase: frame.phase,
    title: titleForPhase(frame.phase),
    questionIds: questionIdsForPhase(frame.phase),
    dependsOn: previousTaskId ? [previousTaskId] : [],
    datasetIds: [datasetId],
    cacheKeys: [...frame.contextPack.relevantCacheKeys].sort(),
    cachePolicy: "cache_first",
    mutationMode: frame.phase === "execute" ? "room_tools_only" : "none",
    toolAllowlist: [...frame.toolAllowlist],
    expectedOutputSchema: frame.contextPack.expectedOutputSchema ?? `${frame.phase}_result_v1`,
  };
}

export function buildResearchPlanV1(args: {
  dataset: AnalysisDatasetV1;
  traceIds?: readonly string[];
  now?: number;
  blockedReason?: string;
}): ResearchPlanV1 {
  const now = args.now ?? Date.now();
  const dataset = args.dataset;
  const facetPlans = dataset.rows.flatMap((row) => RESEARCH_FIELDS.map((field) => facetPlanFor(row, field, now)));
  const freshHitCount = facetPlans.filter((plan) => plan.cachePolicy === "fresh_use_cache").length;
  const cacheHitCount = facetPlans.filter((plan) => plan.cacheHit).length;
  const planId = `investigation:${stableJournalHash({
    roomId: dataset.roomId,
    datasetId: dataset.datasetId,
    versionId: dataset.versionId,
    goal: "evidence_bound_diligence",
  })}`;
  const framePlan = buildRoomWorkReasoningPlan({
    framePlanId: planId,
    globalGoal: `Investigate ${dataset.rows.length} companies and compile an evidence-bound diligence teaching case.`,
    mode: "investigation",
    artifactId: dataset.artifactId,
    inputKind: "versioned_analysis_dataset",
    entities: dataset.rows.map((row) => ({
      entityType: "company",
      entityKey: row.entityKey,
      displayName: row.entityLabel,
      website: textOf(row.fields.website),
    })),
    facets: [...RESEARCH_FIELDS],
    facetPlans,
    cacheHitCount,
    freshHitCount,
    blockedReason: args.blockedReason,
    childFrameSampleLimit: 200,
  });
  let previousTaskId: string | undefined;
  const tasks = framePlan.frames.map((frame) => {
    const task = taskFromFrame(frame, previousTaskId, dataset.datasetId);
    previousTaskId = task.taskId;
    return task;
  });
  const core: Omit<ResearchPlanV1, "planDigest"> = {
    schema: RESEARCH_PLAN_SCHEMA_V1,
    planId,
    roomId: dataset.roomId,
    goal: framePlan.globalGoal,
    status: args.blockedReason ? "blocked" : "ready",
    createdAt: dataset.createdAt,
    datasetRefs: [{
      datasetId: dataset.datasetId,
      version: dataset.version,
      versionId: dataset.versionId,
      contentHash: dataset.contentHash,
    }],
    questions: [
      { questionId: "q_scope", title: "What evidence is inside this version?", purpose: "Freeze the room inputs before analysis.", requiredFields: ["company"] },
      { questionId: "q_evidence", title: "Which claims are sufficiently sourced?", purpose: "Keep supported facts separate from inference.", requiredFields: [...RESEARCH_FIELDS] },
      { questionId: "q_gaps", title: "Which gaps block a decision?", purpose: "Fail closed instead of filling missing facts.", requiredFields: ["status", "last_researched"] },
      { questionId: "q_contradictions", title: "Where does evidence disagree?", purpose: "Surface review work before synthesis.", requiredFields: ["source", "source2"] },
      { questionId: "q_decision", title: "What can enter the downstream-ready draft?", purpose: "Compile only evidence-bound claims.", requiredFields: [...RESEARCH_FIELDS] },
    ],
    tasks,
    framePlan,
    executionPolicy: {
      runtime: "nodeagent",
      cache: "reasoning_frames_entity_cache",
      writes: "room_tools_only",
      egress: "explicit_user_action",
    },
    provenance: {
      artifactRefs: [{ artifactId: dataset.artifactId, version: dataset.version }],
      traceIds: [...(args.traceIds ?? [])].slice(-MAX_TRACE_REFS),
      compiler: "nodeagent.reasoning_frames",
    },
  };
  const plan = { ...core, planDigest: "" } as ResearchPlanV1;
  return { ...plan, planDigest: researchPlanDigest(plan) };
}

function frameStatus(plan: ResearchPlanV1, task: ResearchPlanTaskV1): ReasoningFrame["status"] {
  return plan.framePlan.frames.find((frame) => frame.frameId === task.frameId)?.status ?? "blocked";
}

function runtimeStatusForExecute(runtime: InvestigationRuntimeStateV1 | null | undefined): AnalysisTaskRunStatusV1 | null {
  const status = runtime?.status?.toLowerCase();
  if (!status) return null;
  if (["queued", "running", "retrying", "cancel_requested"].includes(status)) return "running";
  if (["waiting", "waiting_for_human", "paused", "blocked"].includes(status)) return "blocked";
  if (["failed", "cancelled", "canceled"].includes(status)) return "failed";
  if (status === "completed") return "completed";
  return null;
}

function makeQueuedRun(
  plan: ResearchPlanV1,
  task: ResearchPlanTaskV1,
  datasets: readonly AnalysisDatasetV1[],
  dependencyRunIds: string[],
  runtime: InvestigationRuntimeStateV1 | null | undefined,
): AnalysisTaskRunV1 {
  const datasetRefs = datasets
    .filter((dataset) => task.datasetIds.includes(dataset.datasetId))
    .map((dataset) => ({ datasetId: dataset.datasetId, versionId: dataset.versionId, contentHash: dataset.contentHash }));
  const inputDigest = stableJournalHash({
    planDigest: plan.planDigest,
    task,
    datasetRefs,
    dependencyRunIds,
  });
  const runId = `analysis-run:${stableJournalHash({ planId: plan.planId, taskId: task.taskId, inputDigest })}`;
  const serverJob = runtime?.jobId ? {
    source: runtime.source,
    jobId: runtime.jobId,
    latestRunId: runtime.latestRunId,
    status: runtime.status,
    modelPolicy: runtime.modelPolicy,
    approvalPolicy: runtime.approvalPolicy,
    evidencePolicy: runtime.evidencePolicy,
    attempts: runtime.attempts,
    error: runtime.error,
    createdAt: runtime.createdAt,
    updatedAt: runtime.updatedAt,
    authorization: runtime.authorization,
    resultDigest: runtime.resultDigest,
  } : undefined;
  const provenance = {
    datasetRefs,
    dependencyRunIds,
    cacheKeys: [...task.cacheKeys],
    traceIds: [...plan.provenance.traceIds],
    frameId: task.frameId,
    ...(serverJob ? { serverJob } : {}),
    ...(runtime?.telemetry ? { telemetry: runtime.telemetry } : {}),
  };
  const queued: Omit<AnalysisTaskRunV1, "runDigest"> = {
    schema: ANALYSIS_TASK_RUN_SCHEMA_V1,
    runId,
    planId: plan.planId,
    taskId: task.taskId,
    phase: task.phase,
    status: "queued",
    statusSource: "plan",
    createdAt: plan.createdAt,
    inputDigest,
    provenanceHash: stableJournalHash(provenance),
    provenance,
  };
  return { ...queued, runDigest: analysisTaskRunDigestV1(queued) };
}

function projectedStatus(
  plan: ResearchPlanV1,
  task: ResearchPlanTaskV1,
  priorRuns: readonly AnalysisTaskRunV1[],
  runtime: InvestigationRuntimeStateV1 | null | undefined,
): { status: AnalysisTaskRunStatusV1; code?: string; message?: string; source: AnalysisTaskRunV1["statusSource"] } {
  if (task.phase === "execute") {
    const runtimeStatus = runtimeStatusForExecute(runtime);
    // A completed prior job is not proof that the CURRENT dataset version has
    // satisfied all child work. Let the freshly compiled frame plan re-queue it.
    if (runtimeStatus && (runtimeStatus !== "completed" || plan.framePlan.decision.next === "finish")) {
      const statusSource = runtime?.jobId ? "server_job" : "runtime";
      const runtimeLabel = runtime?.jobId ? "durable research job" : "room research runtime";
      return {
        status: runtimeStatus,
        source: statusSource,
        ...(runtimeStatus === "failed" ? { code: "research_runtime_failed", message: runtime?.error ?? `The ${runtimeLabel} failed.` } : {}),
        ...(runtimeStatus === "blocked" ? { code: "research_runtime_blocked", message: runtime?.error ?? `The ${runtimeLabel} is waiting for intervention.` } : {}),
      };
    }
  }
  const dependenciesReady = priorRuns.every((run) => run.status === "completed" || run.status === "cached");
  const status = frameStatus(plan, task);
  if (status === "completed") {
    const cacheSatisfied = task.phase === "execute" && plan.framePlan.decision.next === "finish";
    return { status: cacheSatisfied ? "cached" : "completed", source: cacheSatisfied ? "cache" : "plan" };
  }
  if (status === "failed") return { status: "failed", code: "frame_failed", message: `${task.title} failed.`, source: "plan" };
  if (status === "blocked" || !dependenciesReady) {
    return { status: "blocked", code: "dependency_blocked", message: dependenciesReady ? "The plan is blocked." : "A dependency has not completed.", source: "plan" };
  }
  if (status === "running") return { status: "running", source: "plan" };
  if (status === "skipped") return { status: "cached", source: "cache" };
  return { status: "queued", source: "plan" };
}

export function projectAnalysisTaskRunsV1(args: {
  plan: ResearchPlanV1;
  datasets: readonly AnalysisDatasetV1[];
  runtime?: InvestigationRuntimeStateV1 | null;
}): AnalysisTaskRunV1[] {
  const validation = validateResearchPlanV1(args.plan, args.datasets);
  if (!validation.valid) return [];
  const runtime = args.datasets.length === 1 && args.runtime && investigationLaunchReceiptMatchesV1({
    receipt: args.runtime.authorization,
    plan: args.plan,
    dataset: args.datasets[0],
  })
    ? args.runtime
    : null;
  const taskById = new Map(args.plan.tasks.map((task) => [task.taskId, task]));
  const runs: AnalysisTaskRunV1[] = [];
  const runByTaskId = new Map<string, AnalysisTaskRunV1>();
  for (const taskId of validation.taskOrder) {
    const task = taskById.get(taskId)!;
    const dependencyRuns = task.dependsOn.map((dependencyId) => runByTaskId.get(dependencyId)).filter((run): run is AnalysisTaskRunV1 => !!run);
    let run = makeQueuedRun(args.plan, task, args.datasets, dependencyRuns.map((dependency) => dependency.runId), runtime);
    const projection = projectedStatus(args.plan, task, dependencyRuns, runtime);
    const at = task.phase === "execute" && runtime?.updatedAt ? runtime.updatedAt : args.plan.createdAt;
    if (projection.status === "running") {
      run = transitionAnalysisTaskRunV1(run, { type: "start", at, source: projection.source });
    } else if (projection.status === "cached") {
      run = transitionAnalysisTaskRunV1(run, { type: "cache_hit", at, output: { taskId, inputDigest: run.inputDigest } });
    } else if (projection.status === "completed") {
      run = transitionAnalysisTaskRunV1(run, { type: "start", at, source: projection.source });
      run = transitionAnalysisTaskRunV1(run, { type: "complete", at, source: projection.source, output: { taskId, inputDigest: run.inputDigest } });
    } else if (projection.status === "blocked") {
      run = transitionAnalysisTaskRunV1(run, {
        type: "block",
        at,
        code: projection.code ?? "blocked",
        message: projection.message ?? "Task is blocked.",
        source: projection.source,
      });
    } else if (projection.status === "failed") {
      run = transitionAnalysisTaskRunV1(run, {
        type: "fail",
        at,
        code: projection.code ?? "failed",
        message: projection.message ?? "Task failed.",
        retryable: true,
        source: projection.source,
      });
    }
    runs.push(run);
    runByTaskId.set(task.taskId, run);
  }
  return runs;
}

function confidenceFor(row: AnalysisDatasetRowV1, field: string): number | undefined {
  return row.fieldConfidence[field];
}

export function buildResearchPackV1(args: {
  dataset: AnalysisDatasetV1;
  plan: ResearchPlanV1;
  taskRuns: readonly AnalysisTaskRunV1[];
  traceIds?: readonly string[];
  now?: number;
}): ResearchPackV1 {
  const claims: ResearchPackClaimV1[] = [];
  const sourceById = new Map(args.dataset.sourceRefs.map((source) => [source.sourceRefId, source]));
  const freshnessNow = args.now ?? args.plan.createdAt;
  for (const row of args.dataset.rows) {
    for (const field of RESEARCH_FIELDS) {
      const value = textOf(row.fields[field]);
      if (!value) continue;
      const visibleSourceRefIds = row.fieldSourceRefIds[field] ?? [];
      const trustedRefs = visibleSourceRefIds
        .map((sourceRefId) => sourceById.get(sourceRefId))
        .filter((ref): ref is InvestigationSourceRefV1 => !!ref && trustedSourceRef(ref));
      const sourceRefIds = trustedRefs.map((ref) => ref.sourceRefId);
      const fieldStatus = row.fieldStatuses[field];
      const status: ResearchPackClaimV1["status"] = fieldStatus === "stale" && trustedRefs.length > 0
        ? "stale"
        : fieldStatus !== "complete" || trustedRefs.length === 0
          ? "needs_review"
          : trustedRefs.some((ref) => freshSourceRef(ref, freshnessNow))
            ? "supported"
            : "stale";
      claims.push({
        claimId: `claim:${stableJournalHash({ dataset: args.dataset.versionId, rowId: row.rowId, field, value })}`,
        rowId: row.rowId,
        entityLabel: row.entityLabel,
        field,
        value,
        sourceRefIds,
        status,
        ...(confidenceFor(row, field) !== undefined ? { confidence: confidenceFor(row, field) } : {}),
      });
    }
  }
  const sourcedClaims = claims.filter((claim) => claim.sourceRefIds.some((sourceRefId) => {
    const ref = sourceById.get(sourceRefId);
    return !!ref && trustedSourceRef(ref);
  })).length;
  const supportedClaims = claims.filter((claim) => claim.status === "supported").length;
  const staleClaims = claims.filter((claim) => claim.status === "stale").length;
  const taskRunReceipts = args.taskRuns.map((run) => ({
    taskId: run.taskId,
    runId: run.runId,
    runDigest: run.runDigest,
    status: run.status,
    statusSource: run.statusSource,
    inputDigest: run.inputDigest,
    ...(run.outputDigest ? { outputDigest: run.outputDigest } : {}),
    provenanceHash: run.provenanceHash,
  }));
  const packCore: Omit<ResearchPackV1, "packDigest"> = {
    schema: RESEARCH_PACK_SCHEMA_V1,
    packId: `research-pack:${stableJournalHash({ planId: args.plan.planId, dataset: args.dataset.versionId })}`,
    planId: args.plan.planId,
    datasetRefs: args.plan.datasetRefs,
    taskRunIds: args.taskRuns.map((run) => run.runId),
    taskRunReceipts,
    sourceRefs: args.dataset.sourceRefs,
    traceIds: [...(args.traceIds ?? args.plan.provenance.traceIds)].slice(-MAX_TRACE_REFS),
    claims,
    coverage: {
      totalClaims: claims.length,
      sourcedClaims,
      staleClaims,
      needsReviewClaims: claims.length - supportedClaims,
      ratio: claims.length ? supportedClaims / claims.length : 0,
    },
    compiledAt: args.dataset.createdAt,
  };
  const pack = { ...packCore, packDigest: "" } as ResearchPackV1;
  return {
    ...pack,
    packDigest: stableJournalHash(packCore),
  };
}

export function buildTeachingCaseV1(dataset: AnalysisDatasetV1, pack: ResearchPackV1): TeachingCaseV1 {
  const claimCounts = new Map<string, number>();
  for (const claim of pack.claims) claimCounts.set(claim.rowId, (claimCounts.get(claim.rowId) ?? 0) + 1);
  const selected = dataset.rows
    .slice()
    .sort((a, b) => (claimCounts.get(b.rowId) ?? 0) - (claimCounts.get(a.rowId) ?? 0) || naturalCompare(a.rowId, b.rowId))[0];
  const selectedClaims = selected ? pack.claims.filter((claim) => claim.rowId === selected.rowId) : [];
  const missingQuestions = selected
    ? RESEARCH_FIELDS
      .filter((field) => !textOf(selected.fields[field]))
      .map((field) => `What evidence resolves ${field.replace(/_/g, " ")} for ${selected.entityLabel}?`)
    : ["Which company should anchor this investigation?"];
  const reviewQuestions = selectedClaims
    .filter((claim) => claim.status !== "supported")
    .map((claim) => claim.status === "stale"
      ? `What current source refreshes ${claim.field.replace(/_/g, " ")} for ${claim.entityLabel}?`
      : `What source supports ${claim.field.replace(/_/g, " ")} for ${claim.entityLabel}?`);
  const openQuestions = [...missingQuestions, ...reviewQuestions];
  const evidenceGapCount = openQuestions.length;
  return {
    title: selected ? `${selected.entityLabel}: evidence-bound diligence case` : "Evidence-bound diligence case",
    setup: selected
      ? `Review ${selectedClaims.length} claims from ${dataset.versionId}. Every conclusion must remain bound to this dataset version and its source receipts.`
      : `The analysis dataset ${dataset.versionId} contains no complete company row yet.`,
    decisionQuestion: "Which claims are safe to carry into a downstream-ready diligence draft, and which must remain needs review?",
    evidenceCards: selectedClaims.map((claim) => ({
      claimId: claim.claimId,
      label: claim.field.replace(/_/g, " "),
      value: claim.value,
      sourceCount: claim.sourceRefIds.length,
      status: claim.status,
    })),
    openQuestions,
    learningObjectives: [
      "Separate observed facts from interpretation.",
      "Treat dataset version and source lineage as part of the answer.",
      "Keep downstream synthesis blocked when required evidence is missing.",
    ],
    recommendedNextStep: evidenceGapCount
      ? `Resolve ${evidenceGapCount} evidence gap${evidenceGapCount === 1 ? "" : "s"} before promoting the case.`
      : "Review the cited claims, then export the research pack as a downstream-ready draft input.",
  };
}

function emptyValidation(issue: ResearchPlanValidationIssue) {
  return { valid: false, issues: [issue], taskOrder: [] };
}

function runtimeFromRoom(args: {
  runtime?: InvestigationRuntimeStateV1 | null;
  plan: ResearchPlanV1;
  dataset: AnalysisDatasetV1;
}): InvestigationRuntimeStateV1 | null {
  if (!args.runtime || !investigationLaunchReceiptMatchesV1({
    receipt: args.runtime.authorization,
    plan: args.plan,
    dataset: args.dataset,
  })) {
    return null;
  }
  const terminalStatus = runtimeStatusForExecute(args.runtime);
  if (
    args.runtime.source === "durable_job" &&
    (terminalStatus === "completed" || terminalStatus === "failed") &&
    !args.runtime.resultDigest?.trim()
  ) {
    return {
      ...args.runtime,
      status: "blocked",
      error: "The durable research job is terminal but its result receipt is missing.",
      resultDigest: undefined,
    };
  }
  return args.runtime.jobId || args.runtime.status || args.runtime.telemetry ? args.runtime : null;
}

export function buildInvestigationWorkspaceV1(args: {
  roomId: string;
  artifacts: readonly Artifact[];
  traces: readonly TraceEvent[];
  sessions?: readonly AgentSession[];
  runtime?: InvestigationRuntimeStateV1 | null;
  now?: number;
}): InvestigationWorkspaceV1 {
  const researchArtifact = args.artifacts.find((artifact) => artifact.kind === "sheet" && artifact.title === RESEARCH_ARTIFACT_TITLE);
  if (!researchArtifact) {
    const issue: ResearchPlanValidationIssue = {
      level: "error",
      code: "research_artifact_missing",
      path: "artifacts",
      message: `Add a ${RESEARCH_ARTIFACT_TITLE} sheet before starting Investigation Mode.`,
    };
    return {
      schema: INVESTIGATION_WORKSPACE_SCHEMA_V1,
      state: "blocked",
      dataset: null,
      plan: null,
      taskRuns: [],
      researchPack: null,
      teachingCase: null,
      validation: emptyValidation(issue),
      runtime: null,
      summary: { entityCount: 0, taskCount: 0, completedTaskCount: 0, pendingTaskCount: 0, sourceCount: 0, needsReviewCount: 0 },
    };
  }

  const dataset = buildAnalysisDatasetV1(researchArtifact);
  const workspaceIssues: ResearchPlanValidationIssue[] = [];
  if (dataset.rows.length === 0) {
    workspaceIssues.push({
      level: "error",
      code: "analysis_dataset_empty",
      path: "dataset.rows",
      message: "The Company research sheet has no populated company rows.",
    });
  }
  const missingEntityRows = dataset.rows
    .filter((row) => !textOf(row.fields.company) && !textOf(row.fields.account))
    .map((row) => row.rowId);
  if (missingEntityRows.length) {
    workspaceIssues.push({
      level: "error",
      code: "analysis_dataset_entity_missing",
      path: "dataset.rows",
      message: `Rows without a company identity cannot be investigated: ${missingEntityRows.join(", ")}.`,
    });
  }
  if (dataset.truncated) {
    workspaceIssues.push({
      level: "error",
      code: "analysis_dataset_truncated",
      path: "dataset.truncated",
      message: "The source sheet is truncated; Investigation Mode fails closed until the full dataset is available.",
    });
  }
  for (const warning of dataset.warnings) {
    workspaceIssues.push({ level: "warning", code: "analysis_dataset_warning", path: "dataset.warnings", message: warning });
  }
  const traceIds = args.traces
    .slice()
    .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
    .map((trace) => trace.id)
    .slice(-MAX_TRACE_REFS);
  const plan = buildResearchPlanV1({
    dataset,
    traceIds,
    now: args.now,
    blockedReason: workspaceIssues.find((issue) => issue.level === "error")?.message,
  });
  const runtime = runtimeFromRoom({ runtime: args.runtime, plan, dataset });
  const planValidation = validateResearchPlanV1(plan, [dataset]);
  const validation = {
    valid: planValidation.valid && !workspaceIssues.some((issue) => issue.level === "error"),
    issues: [...workspaceIssues, ...planValidation.issues],
    taskOrder: planValidation.taskOrder,
  };
  const taskRuns = validation.valid ? projectAnalysisTaskRunsV1({ plan, datasets: [dataset], runtime }) : [];
  const researchPack = validation.valid ? buildResearchPackV1({ dataset, plan, taskRuns, traceIds, now: args.now }) : null;
  const teachingCase = researchPack ? buildTeachingCaseV1(dataset, researchPack) : null;
  const runtimeStatus = runtimeStatusForExecute(runtime);
  const state = !validation.valid
    ? "blocked"
    : runtimeStatus === "failed"
      ? "failed"
      : runtimeStatus === "running"
        ? "running"
        : runtimeStatus === "blocked"
          ? "blocked"
          : plan.framePlan.decision.next === "finish"
            ? "complete"
            : "ready";
  const completedTaskCount = taskRuns.filter((run) => run.status === "completed" || run.status === "cached").length;
  return {
    schema: INVESTIGATION_WORKSPACE_SCHEMA_V1,
    state,
    dataset,
    plan,
    taskRuns,
    researchPack,
    teachingCase,
    validation,
    runtime,
    summary: {
      entityCount: dataset.rows.length,
      taskCount: taskRuns.length,
      completedTaskCount,
      pendingTaskCount: taskRuns.filter((run) => run.status === "queued" || run.status === "running" || run.status === "blocked").length,
      sourceCount: researchPack?.sourceRefs.length ?? dataset.sourceRefs.length,
      needsReviewCount: researchPack?.coverage.needsReviewClaims ?? 0,
    },
  };
}
