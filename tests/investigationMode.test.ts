import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { Actor, Artifact, CellPayload } from "../src/engine/types";
import {
  ANALYSIS_TASK_RUN_SCHEMA_V1,
  buildAnalysisDatasetV1,
  buildInvestigationWorkspaceV1,
  buildResearchPackV1,
  buildResearchPlanV1,
  projectAnalysisTaskRunsV1,
  researchPlanDigest,
  topologicalResearchTaskOrder,
  transitionAnalysisTaskRunV1,
  validateResearchPlanV1,
  type AnalysisTaskRunV1,
  type ResearchPlanV1,
} from "../src/nodeagent/investigation";
import { stableJournalHash } from "../src/nodeagent/core/journal";
import {
  ELEMENT_SCOPED_WRITE_TOOL_ALLOWLIST,
  FRAME_TOOL_ALLOWLIST,
} from "../src/nodeagent/core/reasoningFrames";
import {
  cellEvidenceVerificationStatus,
  sealCellEvidence,
} from "../src/nodeagent/core/evidenceReceipt";
import { PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";

const now = Date.parse("2026-07-28T12:00:00.000Z");
const agent: Actor = { kind: "agent", id: "agent-room", name: "Room NodeAgent", scope: "public" };

function immutableContentDigest(bytes: string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

const columns = [
  "company",
  "website",
  "summary",
  "funding",
  "headcount",
  "recent_signal",
  "source",
  "source2",
  "last_researched",
  "status",
];

function payload(value: string, source?: string, verifiedAt = now): CellPayload {
  const evidence = source ? sealCellEvidence({
    id: `evidence:${value}`,
    kind: "source" as const,
    label: "Primary source",
    url: source,
    snippet: value,
    confidence: 0.91,
  }, {
    contentDigest: immutableContentDigest(value),
    verifiedAt,
  }) : undefined;
  return {
    value,
    status: "complete",
    confidence: source ? 0.91 : undefined,
    evidence: evidence ? [evidence] : undefined,
  };
}

function researchArtifact(args: {
  status?: "pending" | "complete";
  version?: number;
  truncated?: boolean;
  reverseElements?: boolean;
  omitFundingEvidence?: boolean;
  evidenceVerifiedAt?: number;
} = {}): Artifact {
  const status = args.status ?? "pending";
  const version = args.version ?? 7;
  const values: Record<string, unknown> = {
    "row-1__company": "CardioNova",
    "row-1__website": "https://cardionova.example",
    "row-1__summary": payload("Remote cardiac monitoring platform.", "https://cardionova.example/about", args.evidenceVerifiedAt),
    "row-1__funding": payload("$42M Series B", args.omitFundingEvidence ? undefined : "https://news.example/cardionova-series-b", args.evidenceVerifiedAt),
    "row-1__headcount": payload("145 employees", "https://cardionova.example/team", args.evidenceVerifiedAt),
    "row-1__recent_signal": payload("Expanded into two hospital systems.", "https://news.example/cardionova-hospitals", args.evidenceVerifiedAt),
    "row-1__source": "https://cardionova.example/about",
    "row-1__source2": "https://news.example/cardionova-series-b",
    "row-1__last_researched": "2026-07-28",
    "row-1__status": status,
  };
  const entries = Object.entries(values);
  if (args.reverseElements) entries.reverse();
  return {
    id: "research-sheet",
    roomId: "room-1",
    kind: "sheet",
    title: "Company research",
    version,
    elements: Object.fromEntries(entries.map(([id, value]) => [id, {
      id,
      version,
      value,
      updatedAt: now,
      updatedBy: agent,
    }])),
    order: entries.map(([id]) => id),
    updatedAt: now,
    createdBy: agent,
    visibility: "room",
    meta: {
      dataframe: {
        columns: columns.map((id, order) => ({ id, label: id, order, mode: "manual" })),
        rowCount: 1,
        parser: "test",
        truncated: args.truncated ?? false,
        warnings: args.truncated ? ["Only the first row was imported."] : [],
      },
    },
  };
}

function initialQueuedRun(plan: ResearchPlanV1): AnalysisTaskRunV1 {
  const task = plan.tasks[2];
  return {
    schema: ANALYSIS_TASK_RUN_SCHEMA_V1,
    runId: "run-execute",
    planId: plan.planId,
    taskId: task.taskId,
    phase: task.phase,
    status: "queued",
    statusSource: "plan",
    createdAt: now,
    inputDigest: "input",
    provenanceHash: "provenance",
    runDigest: "run-digest",
    provenance: {
      datasetRefs: plan.datasetRefs.map((ref) => ({
        datasetId: ref.datasetId,
        versionId: ref.versionId,
        contentHash: ref.contentHash,
      })),
      dependencyRunIds: [],
      cacheKeys: task.cacheKeys,
      traceIds: [],
      frameId: task.frameId,
    },
  };
}

function authorizedRuntime(
  artifact: Artifact,
  status: string,
  extras: Partial<{
    error: string;
    updatedAt: number;
  }> = {},
) {
  const base = buildInvestigationWorkspaceV1({
    roomId: artifact.roomId,
    artifacts: [artifact],
    traces: [],
    now,
  });
  const core = {
    schema: "noderoom.investigation-launch-receipt/v1" as const,
    planId: base.plan!.planId,
    planDigest: base.plan!.planDigest,
    datasetId: base.dataset!.datasetId,
    datasetVersionId: base.dataset!.versionId,
    datasetContentHash: base.dataset!.contentHash,
    artifactId: base.dataset!.artifactId,
    artifactVersion: base.dataset!.version,
    consent: {
      publicSourceRetrieval: true as const,
      approvedAt: now - 1_000,
      approvedByActorId: "host-1",
    },
  };
  return {
    source: "durable_job" as const,
    jobId: "job-1",
    status,
    updatedAt: extras.updatedAt ?? now,
    ...(["completed", "failed", "cancelled", "canceled"].includes(status)
      ? { resultDigest: `result:${status}:job-1` }
      : {}),
    ...(extras.error ? { error: extras.error } : {}),
    authorization: { ...core, receiptDigest: stableJournalHash(core) },
  };
}

describe("Investigation Mode contracts", () => {
  it("keeps element-scoped execution on evidence-sealing write tools only", () => {
    expect([...ELEMENT_SCOPED_WRITE_TOOL_ALLOWLIST]).toEqual([
      "write_locked_cell_result",
      "write_locked_cell_results",
    ]);
    expect(FRAME_TOOL_ALLOWLIST.execute).toEqual(expect.arrayContaining([
      "write_locked_cell_result",
      "write_locked_cell_results",
    ]));
    expect(FRAME_TOOL_ALLOWLIST.execute).not.toContain("write_locked_cell");
    expect(PRODUCTION_ROOM_TOOLS
      .filter((tool) => (ELEMENT_SCOPED_WRITE_TOOL_ALLOWLIST as readonly string[]).includes(tool.name))
      .map((tool) => tool.name))
      .toEqual([...ELEMENT_SCOPED_WRITE_TOOL_ALLOWLIST]);
  });

  it("refuses to mint source freshness from caller metadata and accepts only a byte-bound receipt", () => {
    const attackerChosenFuture = now + 365 * 24 * 60 * 60 * 1_000;
    const fabricated = sealCellEvidence({
      id: "forged-source",
      kind: "source",
      label: "Caller-controlled source",
      url: "https://example.com/source",
      verifiedAt: attackerChosenFuture,
      contentDigest: `sha256:${"a".repeat(64)}`,
      receiptDigest: "caller-forged-receipt",
    });

    expect(fabricated).not.toHaveProperty("verifiedAt");
    expect(fabricated).not.toHaveProperty("contentDigest");
    expect(fabricated).not.toHaveProperty("receiptDigest");
    expect(cellEvidenceVerificationStatus(fabricated)).toBe("unverified");

    const immutableBytes = "captured response bytes for CardioNova";
    const sealed = sealCellEvidence({
      id: "byte-bound-source",
      kind: "source",
      label: "Trusted source adapter receipt",
      url: "https://example.com/source",
      snippet: "CardioNova source excerpt",
      contentDigest: `sha256:${"b".repeat(64)}`,
      verifiedAt: attackerChosenFuture,
      receiptDigest: "caller-forged-receipt",
    }, {
      contentDigest: immutableContentDigest(immutableBytes),
      verifiedAt: now,
    });

    expect(sealed.verifiedAt).toBe(now);
    expect(sealed.contentDigest).toBe(immutableContentDigest(immutableBytes));
    expect(sealed.receiptDigest).toBe(stableJournalHash({
      id: "byte-bound-source",
      kind: "source",
      label: "Trusted source adapter receipt",
      url: "https://example.com/source",
      snippet: "CardioNova source excerpt",
      contentDigest: immutableContentDigest(immutableBytes),
      verifiedAt: now,
    }));
    expect(cellEvidenceVerificationStatus(sealed)).toBe("verified");
    expect(cellEvidenceVerificationStatus({
      ...sealed,
      snippet: "Semantically mutated source excerpt",
    })).toBe("tampered");

    const manual = sealCellEvidence({
      id: "forged-manual",
      kind: "manual",
      label: "Analyst note",
      verifiedAt: now,
      receiptDigest: "caller-forged-receipt",
    });
    expect(manual.verifiedAt).toBeUndefined();
    expect(cellEvidenceVerificationStatus(manual)).toBe("unverified");

    const writeTool = PRODUCTION_ROOM_TOOLS.find((tool) => tool.name === "write_locked_cell_result");
    const parsed = writeTool?.schema.safeParse({
      elementId: "row-1__summary",
      value: "Caller-controlled claim",
      baseVersion: 1,
      status: "complete",
      evidence: [{
        id: "forged-source",
        kind: "source",
        label: "Caller-controlled source",
        url: "https://example.com/source",
        verifiedAt: attackerChosenFuture,
        contentDigest: "caller-claimed-content",
        receiptDigest: "caller-forged-receipt",
      }],
    });
    expect(parsed?.success).toBe(true);
    if (!parsed?.success) throw new Error("expected managed result schema to parse");
    const parsedEvidence = (parsed.data as { evidence: Array<Record<string, unknown>> }).evidence[0];
    expect(parsedEvidence).not.toHaveProperty("verifiedAt");
    expect(parsedEvidence).not.toHaveProperty("contentDigest");
    expect(parsedEvidence).not.toHaveProperty("receiptDigest");
  });

  it("builds a stable analysis dataset and changes the version identity when content changes", () => {
    const first = buildAnalysisDatasetV1(researchArtifact());
    const reordered = buildAnalysisDatasetV1(researchArtifact({ reverseElements: true }));
    const changedArtifact = researchArtifact({ version: 8 });
    changedArtifact.elements["row-1__funding"] = {
      ...changedArtifact.elements["row-1__funding"],
      value: payload("$50M Series B", "https://news.example/cardionova-series-b"),
    };
    const changed = buildAnalysisDatasetV1(changedArtifact);

    expect(first.schema).toBe("noderoom.analysis-dataset/v1");
    expect(first.versionId).toBe(reordered.versionId);
    expect(first.contentHash).toBe(reordered.contentHash);
    expect(first.versionId).not.toBe(changed.versionId);
    expect(first.rows[0].fieldSourceRefIds.summary).toHaveLength(1);
    expect(first.rows[0].fieldConfidence.summary).toBe(0.91);
  });

  it("compiles the existing reasoning-frame harness into a validated task DAG", () => {
    const dataset = buildAnalysisDatasetV1(researchArtifact());
    const plan = buildResearchPlanV1({ dataset, traceIds: ["trace-2", "trace-1"], now });
    const validation = validateResearchPlanV1(plan, [dataset]);
    const ordered = topologicalResearchTaskOrder(plan);

    expect(validation.valid).toBe(true);
    expect(ordered.map((task) => task.phase)).toEqual(["intake", "plan", "execute", "verify", "synthesize"]);
    expect(plan.framePlan.schema).toBe("noderoom.reasoning_frame_plan.v1");
    expect(plan.executionPolicy).toEqual({
      runtime: "nodeagent",
      cache: "reasoning_frames_entity_cache",
      writes: "room_tools_only",
      egress: "explicit_user_action",
    });
    expect(plan.tasks[2].cachePolicy).toBe("cache_first");
    expect(plan.tasks[2].cacheKeys.length).toBeGreaterThan(0);
  });

  it("keeps duplicate company labels collision-free and fails closed on duplicate entity identities", () => {
    const artifact = researchArtifact();
    for (const [elementId, element] of Object.entries({ ...artifact.elements })) {
      if (!elementId.startsWith("row-1__")) continue;
      const duplicateId = elementId.replace("row-1__", "row-2__");
      artifact.elements[duplicateId] = { ...element, id: duplicateId };
      artifact.order.push(duplicateId);
    }
    if (artifact.meta?.dataframe) artifact.meta.dataframe.rowCount = 2;

    const dataset = buildAnalysisDatasetV1(artifact);
    const plan = buildResearchPlanV1({ dataset, now });
    const childFrameIds = plan.framePlan.childFrames.map((frame) => frame.frameId);
    const cacheKeys = plan.framePlan.childFrames.map((frame) => frame.cacheKey);

    expect(new Set(dataset.rows.map((row) => row.entityKey)).size).toBe(2);
    expect(new Set(childFrameIds).size).toBe(childFrameIds.length);
    expect(new Set(cacheKeys).size).toBe(cacheKeys.length);
    expect(validateResearchPlanV1(plan, [dataset]).valid).toBe(true);

    const collided = structuredClone(dataset);
    collided.rows[1].entityKey = collided.rows[0].entityKey;
    const collidedPlan = buildResearchPlanV1({ dataset: collided, now });
    expect(validateResearchPlanV1(collidedPlan, [collided]).issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "analysis_entity_key_duplicate",
      "child_frame_duplicate",
      "cache_key_duplicate",
    ]));
  });

  it("rejects missing dependencies, cycles, and version drift", () => {
    const dataset = buildAnalysisDatasetV1(researchArtifact());
    const original = buildResearchPlanV1({ dataset, now });

    const missing = structuredClone(original);
    missing.tasks[0].dependsOn = ["task:does-not-exist"];
    missing.planDigest = researchPlanDigest(missing);
    expect(validateResearchPlanV1(missing, [dataset]).issues.map((issue) => issue.code)).toContain("task_dependency_missing");

    const cyclic = structuredClone(original);
    cyclic.tasks[0].dependsOn = [cyclic.tasks.at(-1)!.taskId];
    cyclic.planDigest = researchPlanDigest(cyclic);
    expect(validateResearchPlanV1(cyclic, [dataset]).issues.map((issue) => issue.code)).toContain("task_dependency_cycle");

    const drifted = { ...dataset, versionId: "v999-drifted" };
    expect(validateResearchPlanV1(original, [drifted]).issues.map((issue) => issue.code)).toContain("dataset_version_mismatch");

    const unknownFrame = structuredClone(original);
    unknownFrame.tasks[0].frameId = "rf_missing";
    unknownFrame.planDigest = researchPlanDigest(unknownFrame);
    expect(validateResearchPlanV1(unknownFrame, [dataset]).issues.map((issue) => issue.code)).toContain("task_frame_unknown");
  });

  it("enforces explicit task lifecycle transitions including failure and retry", () => {
    const dataset = buildAnalysisDatasetV1(researchArtifact());
    const plan = buildResearchPlanV1({ dataset, now });
    const queued = initialQueuedRun(plan);
    const running = transitionAnalysisTaskRunV1(queued, { type: "start", at: now + 1, source: "runtime" });
    const completed = transitionAnalysisTaskRunV1(running, { type: "complete", at: now + 2, output: { claims: 4 }, source: "runtime" });

    expect(running.status).toBe("running");
    expect(completed.status).toBe("completed");
    expect(completed.outputDigest).toBeTruthy();
    expect(() => transitionAnalysisTaskRunV1(completed, { type: "retry", at: now + 3 })).toThrow("invalid_analysis_task_transition");

    const failed = transitionAnalysisTaskRunV1(queued, { type: "fail", at: now + 1, code: "provider_timeout", message: "Timed out.", retryable: true, source: "runtime" });
    const retried = transitionAnalysisTaskRunV1(failed, { type: "retry", at: now + 2, source: "runtime" });
    expect(failed.failure).toEqual({ code: "provider_timeout", message: "Timed out.", retryable: true });
    expect(retried.status).toBe("queued");
    expect(retried.failure).toBeUndefined();
  });

  it("projects ready, running, failed, complete, and fail-closed workspace states", () => {
    const pending = researchArtifact({ status: "pending" });
    const readyWorkspace = buildInvestigationWorkspaceV1({ roomId: "room-1", artifacts: [pending], traces: [], now });
    expect(readyWorkspace.state).toBe("ready");
    expect(readyWorkspace.taskRuns.map((run) => run.status)).toEqual(["completed", "completed", "queued", "blocked", "blocked"]);

    const runningWorkspace = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [pending],
      traces: [],
      now,
      runtime: authorizedRuntime(pending, "running", { updatedAt: now + 1 }),
    });
    expect(runningWorkspace.state).toBe("running");
    expect(runningWorkspace.taskRuns.find((run) => run.phase === "execute")).toMatchObject({
      status: "running",
      statusSource: "server_job",
    });

    const failedWorkspace = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [pending],
      traces: [],
      now,
      runtime: authorizedRuntime(pending, "failed", { error: "Source fetch failed.", updatedAt: now + 2 }),
    });
    expect(failedWorkspace.state).toBe("failed");
    expect(failedWorkspace.taskRuns.find((run) => run.phase === "execute")?.failure?.message).toBe("Source fetch failed.");

    const completedButStillStale = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [pending],
      traces: [],
      now,
      runtime: authorizedRuntime(pending, "completed", { updatedAt: now + 3 }),
    });
    expect(completedButStillStale.state).toBe("ready");
    expect(completedButStillStale.taskRuns.find((run) => run.phase === "execute")).toMatchObject({
      status: "queued",
      statusSource: "plan",
      provenance: { serverJob: { jobId: "job-1", status: "completed" } },
    });

    const completeWorkspace = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [researchArtifact({ status: "complete" })],
      traces: [],
      now,
    });
    expect(completeWorkspace.state).toBe("complete");
    expect(completeWorkspace.taskRuns.every((run) => run.status === "completed" || run.status === "cached")).toBe(true);

    const missingWorkspace = buildInvestigationWorkspaceV1({ roomId: "room-1", artifacts: [], traces: [], now });
    expect(missingWorkspace.state).toBe("blocked");
    expect(missingWorkspace.validation.issues[0].code).toBe("research_artifact_missing");

    const truncatedWorkspace = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [researchArtifact({ truncated: true })],
      traces: [],
      now,
    });
    expect(truncatedWorkspace.state).toBe("blocked");
    expect(truncatedWorkspace.taskRuns).toEqual([]);
    expect(truncatedWorkspace.researchPack).toBeNull();
    expect(truncatedWorkspace.validation.issues.map((issue) => issue.code)).toContain("analysis_dataset_truncated");

    const missingEntity = researchArtifact();
    missingEntity.elements["row-1__company"] = { ...missingEntity.elements["row-1__company"], value: "" };
    const missingEntityWorkspace = buildInvestigationWorkspaceV1({ roomId: "room-1", artifacts: [missingEntity], traces: [], now });
    expect(missingEntityWorkspace.state).toBe("blocked");
    expect(missingEntityWorkspace.validation.issues.map((issue) => issue.code)).toContain("analysis_dataset_entity_missing");
  });

  it("correlates durable runtime only through an exact untampered investigation authorization receipt", () => {
    const pending = researchArtifact({ status: "pending" });
    const base = buildInvestigationWorkspaceV1({ roomId: "room-1", artifacts: [pending], traces: [], now });
    const receiptCore = {
      schema: "noderoom.investigation-launch-receipt/v1" as const,
      planId: base.plan!.planId,
      planDigest: base.plan!.planDigest,
      datasetId: base.dataset!.datasetId,
      datasetVersionId: base.dataset!.versionId,
      datasetContentHash: base.dataset!.contentHash,
      artifactId: base.dataset!.artifactId,
      artifactVersion: base.dataset!.version,
      consent: {
        publicSourceRetrieval: true as const,
        approvedAt: now - 1_000,
        approvedByActorId: "host-1",
      },
    };
    const authorization = { ...receiptCore, receiptDigest: stableJournalHash(receiptCore) };
    const runtime = {
      source: "durable_job" as const,
      jobId: "job-current",
      status: "running",
      updatedAt: now,
      authorization,
    };

    const exact = buildInvestigationWorkspaceV1({ roomId: "room-1", artifacts: [pending], traces: [], now, runtime });
    expect(exact.state).toBe("running");
    expect(exact.runtime?.jobId).toBe("job-current");

    const absent = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [pending],
      traces: [],
      now,
      runtime: { source: "durable_job", jobId: "job-generic", status: "running", updatedAt: now },
    });
    expect(absent.state).toBe("ready");
    expect(absent.runtime).toBeNull();

    const drifted = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [pending],
      traces: [],
      now,
      runtime: {
        ...runtime,
        authorization: { ...authorization, datasetVersionId: "v999-old" },
      },
    });
    expect(drifted.state).toBe("ready");
    expect(drifted.runtime).toBeNull();

    const tampered = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [pending],
      traces: [],
      now,
      runtime: {
        ...runtime,
        authorization: { ...authorization, receiptDigest: "forged" },
      },
    });
    expect(tampered.state).toBe("ready");
    expect(tampered.runtime).toBeNull();
  });

  it("does not infer investigation progress from ambiguous room-session activity", () => {
    const pending = researchArtifact({ status: "pending" });
    const unrelated = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [pending],
      traces: [],
      sessions: [{
        id: "session-1",
        roomId: "room-1",
        agentId: "agent-room",
        agentName: "Room NodeAgent",
        scope: "public",
        status: "working",
        lastAction: "Recomputing Q3 variance",
        updatedAt: now,
      }],
      now,
    });
    expect(unrelated.state).toBe("ready");
    expect(unrelated.runtime).toBeNull();

    const alsoAmbiguous = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [pending],
      traces: [],
      sessions: [{
        id: "session-2",
        roomId: "room-1",
        agentId: "agent-room",
        agentName: "Room NodeAgent",
        scope: "public",
        status: "working",
        lastAction: "Researching company evidence",
        updatedAt: now,
      }],
      now,
    });
    expect(alsoAmbiguous.state).toBe("ready");
    expect(alsoAmbiguous.runtime).toBeNull();
  });

  it("fails closed when a terminal durable job has no result receipt", () => {
    const complete = researchArtifact({ status: "complete" });
    const runtime = authorizedRuntime(complete, "completed");
    const workspace = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [complete],
      traces: [],
      now,
      runtime: { ...runtime, resultDigest: undefined },
    });

    expect(workspace.state).toBe("blocked");
    expect(workspace.runtime).toMatchObject({
      status: "blocked",
      error: expect.stringContaining("result receipt is missing"),
    });
    const executeRun = workspace.taskRuns.find((run) => run.phase === "execute");
    expect(executeRun).toMatchObject({
      status: "blocked",
      statusSource: "server_job",
    });
    expect(executeRun?.outputDigest).toBeUndefined();
    expect(executeRun?.outputReceipt).toBeUndefined();
  });

  it("binds claims to field-level sources and marks unsupported claims for review", () => {
    const dataset = buildAnalysisDatasetV1(researchArtifact({ status: "complete", omitFundingEvidence: true }));
    const plan = buildResearchPlanV1({ dataset, now });
    const runs = projectAnalysisTaskRunsV1({ plan, datasets: [dataset] });
    const pack = buildResearchPackV1({ dataset, plan, taskRuns: runs });
    const funding = pack.claims.find((claim) => claim.field === "funding");
    const summary = pack.claims.find((claim) => claim.field === "summary");

    expect(funding).toMatchObject({ status: "needs_review", sourceRefIds: [] });
    expect(summary?.status).toBe("supported");
    expect(summary?.sourceRefIds).toHaveLength(1);
    expect(pack.coverage.needsReviewClaims).toBe(1);
    expect(pack.packDigest).toBeTruthy();
  });

  it("keeps fresh citations out of supported coverage when the analyst cell is needs_review or stale", () => {
    const artifact = researchArtifact({ status: "complete" });
    const summary = artifact.elements["row-1__summary"];
    const funding = artifact.elements["row-1__funding"];
    artifact.elements["row-1__summary"] = {
      ...summary,
      value: { ...(summary.value as CellPayload), status: "needs_review" },
    };
    artifact.elements["row-1__funding"] = {
      ...funding,
      value: { ...(funding.value as CellPayload), status: "stale" } as unknown as CellPayload,
    };

    const dataset = buildAnalysisDatasetV1(artifact);
    const plan = buildResearchPlanV1({ dataset, now });
    const runs = projectAnalysisTaskRunsV1({ plan, datasets: [dataset] });
    const pack = buildResearchPackV1({ dataset, plan, taskRuns: runs, now });

    expect(pack.claims.find((claim) => claim.field === "summary")).toMatchObject({
      status: "needs_review",
      sourceRefIds: [expect.any(String)],
    });
    expect(pack.claims.find((claim) => claim.field === "funding")).toMatchObject({
      status: "stale",
      sourceRefIds: [expect.any(String)],
    });
    expect(pack.coverage).toMatchObject({
      totalClaims: 4,
      sourcedClaims: 4,
      staleClaims: 1,
      needsReviewClaims: 2,
      ratio: 0.5,
    });
  });

  it("keeps a sustained 256-row burst of citation-shaped model output at zero supported coverage", () => {
    const artifact = researchArtifact({ status: "complete" });
    const elements: Artifact["elements"] = {};
    const order: string[] = [];
    for (let index = 0; index < 256; index += 1) {
      const rowId = `company-${index.toString().padStart(3, "0")}`;
      const companyId = `${rowId}__company`;
      const summaryId = `${rowId}__summary`;
      elements[companyId] = {
        id: companyId,
        version: 1,
        value: `Company ${index}`,
        updatedAt: now,
        updatedBy: agent,
      };
      elements[summaryId] = {
        id: summaryId,
        version: 1,
        value: {
          value: `Model-generated diligence summary ${index}`,
          status: "complete",
          evidence: [{
            id: `fabricated-${index}`,
            kind: "source",
            label: "Citation-shaped model metadata",
            url: `https://source-${index}.example/diligence`,
            snippet: `Unfetched source claim ${index}`,
          }],
        } satisfies CellPayload,
        updatedAt: now,
        updatedBy: agent,
      };
      order.push(companyId, summaryId);
    }
    artifact.elements = elements;
    artifact.order = order;
    artifact.version = 8;
    artifact.meta = {
      dataframe: {
        columns: [
          { id: "company", label: "company", order: 0, mode: "manual" },
          { id: "summary", label: "summary", order: 1, mode: "enrich" },
        ],
        rowCount: 256,
        parser: "model-output-stress",
      },
    };

    const dataset = buildAnalysisDatasetV1(artifact);
    const plan = buildResearchPlanV1({ dataset, now });
    const runs = projectAnalysisTaskRunsV1({ plan, datasets: [dataset] });
    const pack = buildResearchPackV1({ dataset, plan, taskRuns: runs, now });

    expect(dataset.rows).toHaveLength(256);
    expect(pack.claims).toHaveLength(256);
    expect(pack.claims.every((claim) => claim.status === "needs_review")).toBe(true);
    expect(pack.coverage).toEqual({
      totalClaims: 256,
      sourcedClaims: 0,
      staleClaims: 0,
      needsReviewClaims: 256,
      ratio: 0,
    });
  });

  it("keeps manual evidence visible without treating it as sourced support or fresh cache", () => {
    const artifact = researchArtifact({ status: "complete" });
    for (const field of ["summary", "funding", "headcount", "recent_signal"]) {
      const elementId = `row-1__${field}`;
      const existing = artifact.elements[elementId].value as CellPayload;
      const manualCore = {
        id: `manual:${field}`,
        kind: "manual" as const,
        label: "Analyst note",
        snippet: String(existing.value),
        verifiedAt: now,
      };
      artifact.elements[elementId] = {
        ...artifact.elements[elementId],
        value: {
          ...existing,
          evidence: [{ ...manualCore, receiptDigest: stableJournalHash(manualCore) }],
        },
      };
    }

    const workspace = buildInvestigationWorkspaceV1({ roomId: "room-1", artifacts: [artifact], traces: [], now });
    expect(workspace.state).toBe("ready");
    expect(workspace.researchPack?.sourceRefs.some((source) => source.kind === "manual")).toBe(true);
    expect(workspace.researchPack?.sourceRefs.every((source) => source.verificationStatus !== "verified")).toBe(true);
    expect(workspace.researchPack?.claims.every((claim) => claim.status === "needs_review")).toBe(true);
    expect(workspace.researchPack?.coverage).toMatchObject({
      sourcedClaims: 0,
      needsReviewClaims: 4,
      ratio: 0,
    });
  });

  it("uses each source receipt verification time and rejects a tampered receipt digest", () => {
    const oldVerifiedAt = Date.parse("2026-07-20T12:00:00.000Z");
    const artifact = researchArtifact({ status: "complete" });
    artifact.elements["row-1__summary"] = {
      ...artifact.elements["row-1__summary"],
      value: payload("Remote cardiac monitoring platform.", "https://cardionova.example/about", oldVerifiedAt),
    };
    const workspace = buildInvestigationWorkspaceV1({ roomId: "room-1", artifacts: [artifact], traces: [], now });
    expect(workspace.researchPack?.claims.find((claim) => claim.field === "summary")?.status).toBe("stale");
    expect(workspace.researchPack?.claims.filter((claim) => claim.field !== "summary").every((claim) => claim.status === "supported")).toBe(true);

    const tamperedArtifact = researchArtifact({ status: "complete" });
    const tamperedPayload = tamperedArtifact.elements["row-1__summary"].value as CellPayload;
    tamperedArtifact.elements["row-1__summary"] = {
      ...tamperedArtifact.elements["row-1__summary"],
      value: {
        ...tamperedPayload,
        evidence: tamperedPayload.evidence?.map((evidence) => ({ ...evidence, receiptDigest: "tampered" })),
      },
    };
    const tampered = buildInvestigationWorkspaceV1({ roomId: "room-1", artifacts: [tamperedArtifact], traces: [], now });
    expect(tampered.researchPack?.claims.find((claim) => claim.field === "summary")?.status).toBe("needs_review");
    expect(tampered.researchPack?.sourceRefs.find((source) => source.elementId === "row-1__summary")?.verificationStatus).toBe("tampered");
  });

  it("binds output, run, and pack digests to status source, server provenance, and claim artifacts", () => {
    const artifact = researchArtifact({ status: "complete" });
    const cached = buildInvestigationWorkspaceV1({ roomId: "room-1", artifacts: [artifact], traces: [], now });
    const receiptCore = {
      schema: "noderoom.investigation-launch-receipt/v1" as const,
      planId: cached.plan!.planId,
      planDigest: cached.plan!.planDigest,
      datasetId: cached.dataset!.datasetId,
      datasetVersionId: cached.dataset!.versionId,
      datasetContentHash: cached.dataset!.contentHash,
      artifactId: cached.dataset!.artifactId,
      artifactVersion: cached.dataset!.version,
      consent: {
        publicSourceRetrieval: true as const,
        approvedAt: now - 1_000,
        approvedByActorId: "host-1",
      },
    };
    const server = buildInvestigationWorkspaceV1({
      roomId: "room-1",
      artifacts: [artifact],
      traces: [],
      now,
      runtime: {
        source: "durable_job",
        jobId: "job-current",
        latestRunId: "server-run-9",
        status: "completed",
        updatedAt: now,
        resultDigest: "server-result-digest",
        authorization: { ...receiptCore, receiptDigest: stableJournalHash(receiptCore) },
      },
    });
    const cachedExecute = cached.taskRuns.find((run) => run.phase === "execute")!;
    const serverExecute = server.taskRuns.find((run) => run.phase === "execute")!;

    expect(cachedExecute.runId).toBe(serverExecute.runId);
    expect(cachedExecute.outputDigest).not.toBe(serverExecute.outputDigest);
    expect(cachedExecute.runDigest).not.toBe(serverExecute.runDigest);
    expect(cached.researchPack?.packDigest).not.toBe(server.researchPack?.packDigest);
    expect(serverExecute.outputReceipt).toMatchObject({
      kind: "server_job",
      statusSource: "server_job",
      serverJobId: "job-current",
      serverRunId: "server-run-9",
      resultDigest: "server-result-digest",
      claimArtifactDigest: server.dataset?.contentHash,
    });
    expect(server.researchPack?.taskRunReceipts.find((receipt) => receipt.taskId === serverExecute.taskId)).toMatchObject({
      runDigest: serverExecute.runDigest,
      outputDigest: serverExecute.outputDigest,
      status: "completed",
      statusSource: "server_job",
    });
  });

  it("keeps sourced-but-expired claims stale instead of presenting them as decision-ready", () => {
    const staleArtifact = researchArtifact({
      status: "complete",
      evidenceVerifiedAt: Date.parse("2026-07-20T12:00:00.000Z"),
    });
    staleArtifact.elements["row-1__last_researched"] = {
      ...staleArtifact.elements["row-1__last_researched"],
      value: "2026-07-20",
    };
    const dataset = buildAnalysisDatasetV1(staleArtifact);
    const plan = buildResearchPlanV1({ dataset, now });
    const runs = projectAnalysisTaskRunsV1({ plan, datasets: [dataset] });
    const pack = buildResearchPackV1({ dataset, plan, taskRuns: runs });
    const workspace = buildInvestigationWorkspaceV1({ roomId: "room-1", artifacts: [staleArtifact], traces: [], now });

    expect(pack.claims.every((claim) => claim.status === "stale")).toBe(true);
    expect(pack.coverage).toMatchObject({ sourcedClaims: 4, staleClaims: 4, needsReviewClaims: 4, ratio: 0 });
    expect(workspace.state).toBe("ready");
    expect(workspace.teachingCase?.openQuestions.some((question) => question.includes("current source"))).toBe(true);
    expect(workspace.teachingCase?.recommendedNextStep).toBe("Resolve 4 evidence gaps before promoting the case.");
  });
});
