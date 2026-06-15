import { v } from "convex/values";
import { cancel as cancelWorkflow, start } from "@convex-dev/workflow";
import { internalMutation, mutation, query } from "./_generated/server";
import { components, internal } from "./_generated/api";
import { actorProofV, requireActorProof, requireArtifactInRoom, type ActorValue } from "./lib";
import { classifyIntakeMessage, buildPlanPreview } from "../src/nodeagent/core/intakePreflight";
import { parseBulkCompanyIngest } from "../src/nodeagent/skills/finance/bulkIngest";

// BOUND: cap a single bulk-diligence fan-out so one command can't enqueue unbounded jobs.
const MAX_BULK_COMPANIES = 50;
function companyKeyOf(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

const attemptStatusV = v.union(v.literal("completed"), v.literal("handoff"), v.literal("retrying"), v.literal("failed"));
const terminalStatuses = new Set(["completed", "failed", "blocked", "cancelled"]);
const entrypointV = v.union(
  v.literal("public_ask"),
  v.literal("private_agent"),
  v.literal("free"),
  v.literal("system"),
  v.literal("automation"),
  v.literal("provider_parser"),
);
const agentScopeV = v.union(v.literal("public_room"), v.literal("private_user"), v.literal("team"));
const approvalPolicyV = v.union(v.literal("read_only"), v.literal("draft_first"), v.literal("auto_commit_safe"), v.literal("host_review"));
const evidencePolicyV = v.union(v.literal("public_only"), v.literal("private_allowed"), v.literal("mixed_requires_redaction"));
const traceLevelV = v.union(v.literal("summary"), v.literal("standard"), v.literal("full_operation_ledger"));
const operationEventKindV = v.union(
  v.literal("action"),
  v.literal("query"),
  v.literal("mutation"),
  v.literal("model_call"),
  v.literal("tool_call"),
  v.literal("scheduler"),
  v.literal("lease"),
  v.literal("checkpoint"),
);
const operationStatusV = v.union(v.literal("started"), v.literal("completed"), v.literal("failed"), v.literal("skipped"));

function clean<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) if (val !== undefined) out[key] = val;
  return out as T;
}

function defaultJobIdempotencyKey(args: { roomId: unknown; artifactId: unknown; actorId: string; goal: string; entrypoint: string }) {
  const normalizedGoal = args.goal.trim().replace(/\s+/g, " ").toLowerCase();
  return `${args.entrypoint}:${String(args.roomId)}:${String(args.artifactId)}:${args.actorId}:${normalizedGoal}`;
}

type ArtifactAccess = { visibility?: "private" | "room" | "public"; createdBy?: ActorValue };
type JobAccess = {
  requester: ActorValue;
  scope?: "public_room" | "private_user" | "team";
  entrypoint?: "public_ask" | "private_agent" | "free" | "system" | "automation" | "provider_parser";
};

function actorOwnsArtifact(artifact: ArtifactAccess, actor: ActorValue): boolean {
  if (!artifact.createdBy) return false;
  if (artifact.createdBy.kind === actor.kind && artifact.createdBy.id === actor.id) return true;
  return actor.kind === "agent" && !!actor.ownerId && artifact.createdBy.kind === "user" && artifact.createdBy.id === actor.ownerId;
}

function requireJobArtifactAccess(artifact: ArtifactAccess, actor: ActorValue, opts?: { allowPrivate?: boolean }) {
  if ((artifact.visibility ?? "room") !== "private") return;
  if (!actorOwnsArtifact(artifact, actor)) throw new Error("artifact_not_visible");
  if (!opts?.allowPrivate) throw new Error("private_artifact_requires_private_job");
}

function actorOwnsJob(job: JobAccess, actor: ActorValue): boolean {
  if (job.requester.kind === actor.kind && job.requester.id === actor.id) return true;
  return actor.kind === "agent" && !!actor.ownerId && job.requester.kind === "user" && job.requester.id === actor.ownerId;
}

function canReadJob(job: JobAccess, actor: ActorValue): boolean {
  if (job.scope === "private_user" || job.entrypoint === "private_agent") return actorOwnsJob(job, actor);
  return true;
}

async function recordOperationEvent(ctx: any, args: {
  jobId: string;
  runId?: string;
  sequence: number;
  kind: "action" | "query" | "mutation" | "model_call" | "tool_call" | "scheduler" | "lease" | "checkpoint";
  name: string;
  targetKind?: "notebook" | "node" | "relation" | "artifact" | "element" | "range" | "wiki_page" | "wiki_block";
  targetId?: string;
  status?: "started" | "completed" | "failed" | "skipped";
  countDelta?: number;
  affectedIds?: string[];
  startedAt?: number;
  completedAt?: number;
}) {
  const now = Date.now();
  await ctx.db.insert("agentOperationEvents", clean({
    jobId: args.jobId,
    runId: args.runId,
    sequence: args.sequence,
    kind: args.kind,
    name: args.name,
    targetKind: args.targetKind,
    targetId: args.targetId,
    status: args.status ?? "completed",
    countDelta: args.countDelta,
    affectedIds: args.affectedIds,
    startedAt: args.startedAt ?? now,
    completedAt: args.completedAt ?? now,
  }));
}

export const createOrReuse = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    goal: v.string(),
    entrypoint: entrypointV,
    scope: agentScopeV,
    modelPolicy: v.string(),
    idempotencyKey: v.string(),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"))),
    approvalPolicy: v.optional(approvalPolicyV),
    evidencePolicy: v.optional(evidencePolicyV),
    autoAllow: v.optional(v.boolean()),
    traceLevel: v.optional(traceLevelV),
    request: v.optional(v.any()),
    maxAttempts: v.optional(v.number()),
    initialStatus: v.optional(v.union(v.literal("running"), v.literal("blocked"))),
    planPreview: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    if (a.goal.length > 2_000) throw new Error("goal_too_long");
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const artifact = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    requireJobArtifactAccess(artifact, actor, { allowPrivate: a.scope === "private_user" || a.entrypoint === "private_agent" || a.evidencePolicy === "private_allowed" });
    const prior = await ctx.db.query("agentJobs").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", a.idempotencyKey)).order("desc").take(5);
    const reusable = prior.find((job) => String(job.roomId) === String(a.roomId) && String(job.artifactId) === String(a.artifactId));
    if (reusable) return { jobId: reusable._id, reused: true as const, status: reusable.status, latestRunId: reusable.latestRunId };
    const now = Date.now();
    const initialStatus = a.initialStatus ?? "running";
    const jobId = await ctx.db.insert("agentJobs", clean({
      roomId: a.roomId,
      artifactId: a.artifactId,
      requester: actor,
      goal: a.goal,
      entrypoint: a.entrypoint,
      scope: a.scope,
      commandText: a.goal,
      request: a.request,
      priority: 0,
      approvalPolicy: a.approvalPolicy ?? "host_review",
      evidencePolicy: a.evidencePolicy ?? "public_only",
      autoAllow: a.autoAllow ?? false,
      traceLevel: a.traceLevel ?? "standard",
      idempotencyKey: a.idempotencyKey,
      mode: a.mode,
      planPreview: a.planPreview,
      status: initialStatus,
      error: a.error,
      modelPolicy: a.modelPolicy,
      runtime: "inline",
      attempts: 0,
      maxAttempts: Math.max(1, Math.min(a.maxAttempts ?? 1, 20)),
      actionSliceCount: 0,
      queryCount: 0,
      mutationCount: 1,
      modelCallCount: 0,
      toolCallCount: 0,
      schedulerHandoffCount: 0,
      receiptCount: 0,
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
      completedAt: initialStatus === "blocked" ? now : undefined,
    }));
    await recordOperationEvent(ctx, {
      jobId,
      sequence: 1,
      kind: "mutation",
      name: "agentJobs.createOrReuse",
      targetKind: "artifact",
      targetId: String(a.artifactId),
      countDelta: 1,
      affectedIds: [String(jobId), String(a.artifactId)],
      startedAt: now,
      completedAt: now,
    });
    if (initialStatus === "blocked") {
      await ctx.db.insert("traces", {
        roomId: a.roomId,
        ts: now,
        actor,
        type: "plan_blocked",
        summary: `PlanPreview blocked this run (${(a.planPreview as { scheduling?: string } | undefined)?.scheduling ?? "blocked"}) on ${String(a.artifactId)}`,
        detail: `plan_preview - ${(a.planPreview as { scheduling?: string; conflicts?: Array<{ kind?: string; detail?: string }> } | undefined)?.scheduling ?? "blocked"} - conflicts=${((a.planPreview as { conflicts?: Array<{ kind?: string }> } | undefined)?.conflicts ?? []).map((c) => c.kind).join(",") || "none"} - ${a.error ?? ""}`.slice(0, 480),
      });
    }
    return { jobId, reused: false as const, status: initialStatus };
  },
});

export const finishInteractive = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    runId: v.optional(v.id("agentRuns")),
    status: v.union(v.literal("completed"), v.literal("failed"), v.literal("blocked"), v.literal("paused")),
    finalText: v.optional(v.string()),
    error: v.optional(v.string()),
    handoff: v.optional(v.any()),
    cursor: v.optional(v.any()),
    scheduledNextAt: v.optional(v.number()),
    scheduleWorkflow: v.optional(v.boolean()),
    resolvedModel: v.string(),
    stopReason: v.string(),
    ms: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    modelCalls: v.number(),
    toolCalls: v.number(),
    queryCount: v.optional(v.number()),
    mutationCount: v.optional(v.number()),
    receiptCount: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    if (terminalStatuses.has(job.status) && job.latestRunId) return { ok: true as const, terminal: true as const };
    const now = Date.now();
    const attempt = job.attempts + 1;
    await ctx.db.insert("agentJobAttempts", clean({
      jobId: a.jobId,
      runId: a.runId,
      attempt,
      status: a.status === "completed" ? "completed" : a.status === "paused" ? "handoff" : "failed",
      resolvedModel: a.resolvedModel,
      stopReason: a.stopReason,
      ms: a.ms,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      costUsd: a.costUsd,
      error: a.error,
      startedAt: now - a.ms,
      endedAt: now,
    }));
    const baseSequence = (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 2;
    const eventStatus = a.status === "failed" || a.status === "blocked" ? "failed" : "completed";
    await recordOperationEvent(ctx, { jobId: a.jobId, runId: a.runId, sequence: baseSequence, kind: "action", name: "agent.runRoomAgent", countDelta: 1, status: eventStatus, startedAt: now - a.ms, completedAt: now });
    await recordOperationEvent(ctx, { jobId: a.jobId, runId: a.runId, sequence: baseSequence + 1, kind: "model_call", name: a.resolvedModel, countDelta: a.modelCalls, status: eventStatus, startedAt: now - a.ms, completedAt: now });
    await recordOperationEvent(ctx, { jobId: a.jobId, runId: a.runId, sequence: baseSequence + 2, kind: "tool_call", name: "NodeAgent tools", countDelta: a.toolCalls, status: eventStatus, startedAt: now - a.ms, completedAt: now });
    await recordOperationEvent(ctx, { jobId: a.jobId, runId: a.runId, sequence: baseSequence + 3, kind: "checkpoint", name: "agentJobs.finishInteractive", countDelta: 1, status: "completed", startedAt: now, completedAt: now });
    let workflowId: string | undefined;
    if (a.status === "paused" && a.scheduleWorkflow) {
      workflowId = String(await start(ctx, internal.agentWorkflows.freeAutoWorkflow, { jobId: a.jobId }, {
        onComplete: internal.agentWorkflows.freeAutoWorkflowComplete,
        context: { jobId: a.jobId },
      }));
      await recordOperationEvent(ctx, { jobId: a.jobId, runId: a.runId, sequence: baseSequence + 4, kind: "scheduler", name: "agentWorkflows.freeAutoWorkflow", countDelta: 1, status: "completed", startedAt: now, completedAt: now });
    }
    await ctx.db.patch(a.jobId, clean({
      status: a.status,
      attempts: attempt,
      latestRunId: a.runId,
      finalText: a.finalText,
      error: a.error,
      handoff: a.handoff,
      cursor: a.cursor,
      nextRunAt: a.scheduledNextAt,
      runtime: workflowId ? "workflow" : job.runtime,
      workflowId,
      actionSliceCount: (job.actionSliceCount ?? 0) + 1,
      queryCount: (job.queryCount ?? 0) + (a.queryCount ?? 1),
      mutationCount: (job.mutationCount ?? 0) + (a.mutationCount ?? 1),
      modelCallCount: (job.modelCallCount ?? 0) + a.modelCalls,
      toolCallCount: (job.toolCallCount ?? 0) + a.toolCalls,
      receiptCount: (job.receiptCount ?? 0) + (a.receiptCount ?? 0),
      schedulerHandoffCount: (job.schedulerHandoffCount ?? 0) + (workflowId ? 1 : 0),
      leaseId: "",
      leaseUntil: 0,
      updatedAt: now,
      completedAt: a.status === "completed" ? now : undefined,
    }) as any);
    return { ok: true as const };
  },
});

export const recordLiveOperation = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    runId: v.optional(v.id("agentRuns")),
    sequence: v.number(),
    kind: operationEventKindV,
    name: v.string(),
    status: v.optional(operationStatusV),
    countDelta: v.optional(v.number()),
    affectedIds: v.optional(v.array(v.string())),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    if (terminalStatuses.has(job.status)) return { ok: false as const, reason: "job_terminal" as const };
    await recordOperationEvent(ctx, {
      jobId: a.jobId,
      runId: a.runId,
      sequence: a.sequence,
      kind: a.kind,
      name: a.name,
      status: a.status ?? "completed",
      countDelta: a.countDelta,
      affectedIds: a.affectedIds,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
    });
    await ctx.db.patch(a.jobId, { updatedAt: Date.now() });
    return { ok: true as const };
  },
});

export const startFreeAuto = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    goal: v.string(),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"))),
    maxAttempts: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    if (a.goal.length > 2_000) throw new Error("goal_too_long");
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const artifact = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    requireJobArtifactAccess(artifact, actor);
    const now = Date.now();
    const maxAttempts = Math.max(1, Math.min(a.maxAttempts ?? 20, 100));
    const idempotencyKey = a.idempotencyKey ?? defaultJobIdempotencyKey({ roomId: a.roomId, artifactId: a.artifactId, actorId: actor.id, goal: a.goal, entrypoint: "free" });
    const prior = await ctx.db.query("agentJobs").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey)).order("desc").take(5);
    const reusable = prior.find((job) => String(job.roomId) === String(a.roomId) && String(job.artifactId) === String(a.artifactId) && !terminalStatuses.has(job.status));
    if (reusable) return reusable._id;

    // PlanPreview admission gate (server-side, fail-closed): the structured intake classification +
    // affected-set/conflict computation that was client-advisory now runs in the BACKEND before any
    // durable work is queued. cancel/wait/privacy/formula/budget intents, and work that overlaps an
    // unresolved pending proposal, are refused (recorded as a blocked job, no tool loop started).
    const intake = classifyIntakeMessage(a.goal);
    const elementIds = (await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", a.artifactId)).collect()).map((e) => e.elementId);
    const pendingProposalRefs = (await ctx.db.query("proposals").withIndex("by_room_status", (q) => q.eq("roomId", a.roomId).eq("status", "pending")).collect())
      .filter((p) => String(p.artifactId) === String(a.artifactId))
      .map((p) => (p.op as { elementId?: string } | null)?.elementId)
      .filter((id): id is string => typeof id === "string");
    const planPreview = buildPlanPreview({
      decision: intake,
      targetArtifacts: [String(a.artifactId)],
      intendedWriteSet: elementIds, // a free-auto enrich may touch any row in the artifact
      pendingProposals: pendingProposalRefs,
    });
    const planBlocked = planPreview.scheduling !== "run_now";

    const jobId = await ctx.db.insert("agentJobs", clean({
      roomId: a.roomId,
      artifactId: a.artifactId,
      requester: actor,
      goal: a.goal,
      entrypoint: "free",
      scope: "public_room",
      commandText: a.goal,
      request: {
        roomId: String(a.roomId),
        targetArtifactId: String(a.artifactId),
        commandText: a.goal,
        entrypoint: "free",
        scope: "public_room",
        approvalPolicy: "draft_first",
        evidencePolicy: "public_only",
        traceLevel: "full_operation_ledger",
      },
      priority: 0,
      approvalPolicy: "draft_first",
      evidencePolicy: "public_only",
      autoAllow: false,
      traceLevel: "full_operation_ledger",
      idempotencyKey,
      mode: a.mode,
      planPreview,
      status: planBlocked ? ("blocked" as const) : ("queued" as const),
      error: planBlocked ? `plan_${planPreview.scheduling}: ${planPreview.conflicts[0]?.detail ?? intake.reason}` : undefined,
      modelPolicy: "openrouter/free-auto",
      runtime: "workflow",
      attempts: 0,
      maxAttempts,
      actionSliceCount: 0,
      queryCount: 0,
      mutationCount: 1,
      modelCallCount: 0,
      toolCallCount: 0,
      schedulerHandoffCount: 1,
      receiptCount: 0,
      nextRunAt: now,
      createdAt: now,
      updatedAt: now,
    }));
    if (planBlocked) {
      // Fail-closed: record the blocked admission decision in the trace ledger and do NOT start the
      // tool loop. The job is a terminal "blocked" record; resolving the conflict + re-running creates
      // a fresh job that re-evaluates the plan.
      await ctx.db.insert("traces", { roomId: a.roomId, ts: now, actor, type: "plan_blocked", summary: `PlanPreview blocked this run (${planPreview.scheduling}) on ${String(a.artifactId)}`, detail: `plan_preview · ${planPreview.scheduling} · conflicts=${planPreview.conflicts.map((c) => c.kind).join(",") || "none"} · ${planPreview.conflicts[0]?.detail ?? intake.reason}`.slice(0, 480) });
      return jobId;
    }
    await recordOperationEvent(ctx, {
      jobId,
      sequence: 1,
      kind: "mutation",
      name: "agentJobs.startFreeAuto",
      targetKind: "artifact",
      targetId: String(a.artifactId),
      countDelta: 1,
      affectedIds: [String(jobId), String(a.artifactId)],
      startedAt: now,
      completedAt: now,
    });
    await recordOperationEvent(ctx, {
      jobId,
      sequence: 2,
      kind: "scheduler",
      name: "agentWorkflows.freeAutoWorkflow",
      countDelta: 1,
      affectedIds: [String(jobId)],
      startedAt: now,
      completedAt: now,
    });
    const workflowId = await start(ctx, internal.agentWorkflows.freeAutoWorkflow, { jobId }, {
      onComplete: internal.agentWorkflows.freeAutoWorkflowComplete,
      context: { jobId },
    });
    await ctx.db.patch(jobId, { workflowId: String(workflowId), updatedAt: now });
    return jobId;
  },
});

/**
 * Bulk diligence fan-out (deep-review Workflow 1, "ParselyFi-style"): one command over a pasted
 * company list enqueues ONE queued agentJobs row per company — each with a per-company-key
 * idempotency key (so a company dedupes independently, not run-level) and its own freeAutoWorkflow,
 * bounded by the workpool's maxParallelism. Each child carries the same server-side PlanPreview gate.
 * Previously bulk was a single agent iterating companies sequentially inside one job.
 */
export const startBulkDiligence = mutation({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    companies: v.string(),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"))),
    maxAttempts: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    if (a.companies.length > 20_000) throw new Error("companies_too_long");
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const artifact = await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    requireJobArtifactAccess(artifact, actor);
    const rows = parseBulkCompanyIngest(a.companies);
    if (!rows.length) throw new Error("no_companies_parsed");
    if (rows.length > MAX_BULK_COMPANIES) throw new Error(`too_many_companies:${rows.length}>${MAX_BULK_COMPANIES}`);
    const now = Date.now();
    const maxAttempts = Math.max(1, Math.min(a.maxAttempts ?? 20, 100));

    // Affected-set + pending-proposal conflict are artifact-wide; compute once for the whole fan-out.
    const elementIds = (await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", a.artifactId)).collect()).map((e) => e.elementId);
    const pendingProposalRefs = (await ctx.db.query("proposals").withIndex("by_room_status", (q) => q.eq("roomId", a.roomId).eq("status", "pending")).collect())
      .filter((p) => String(p.artifactId) === String(a.artifactId))
      .map((p) => (p.op as { elementId?: string } | null)?.elementId)
      .filter((id): id is string => typeof id === "string");

    const jobs: Array<{ company: string; companyKey: string; jobId: string; status: string; reused: boolean }> = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const companyKey = companyKeyOf(row.company);
      if (!companyKey || seen.has(companyKey)) continue; // de-dup within this submission
      seen.add(companyKey);
      const goal = `Research and enrich the diligence row for ${row.company}${row.website ? ` (${row.website})` : ""} with source-backed evidence.`;
      const idempotencyKey = `bulk:${String(a.roomId)}:${String(a.artifactId)}:${actor.id}:${companyKey}`;
      // Per-company idempotency: reuse a live (non-terminal) job for this company instead of stacking.
      const prior = await ctx.db.query("agentJobs").withIndex("by_idempotency", (q) => q.eq("idempotencyKey", idempotencyKey)).order("desc").take(3);
      const reusable = prior.find((job) => String(job.roomId) === String(a.roomId) && !terminalStatuses.has(job.status));
      if (reusable) { jobs.push({ company: row.company, companyKey, jobId: String(reusable._id), status: reusable.status, reused: true }); continue; }

      const intake = classifyIntakeMessage(goal);
      const planPreview = buildPlanPreview({ decision: intake, targetArtifacts: [String(a.artifactId)], intendedWriteSet: elementIds, pendingProposals: pendingProposalRefs });
      const planBlocked = planPreview.scheduling !== "run_now";
      const jobId = await ctx.db.insert("agentJobs", clean({
        roomId: a.roomId,
        artifactId: a.artifactId,
        requester: actor,
        goal,
        entrypoint: "free",
        scope: "public_room",
        commandText: goal,
        request: { roomId: String(a.roomId), targetArtifactId: String(a.artifactId), commandText: goal, entrypoint: "free", scope: "public_room", approvalPolicy: "draft_first", evidencePolicy: "public_only", traceLevel: "full_operation_ledger", companyKey },
        priority: 0,
        approvalPolicy: "draft_first",
        evidencePolicy: "public_only",
        autoAllow: false,
        traceLevel: "full_operation_ledger",
        idempotencyKey,
        mode: a.mode,
        planPreview,
        status: planBlocked ? ("blocked" as const) : ("queued" as const),
        error: planBlocked ? `plan_${planPreview.scheduling}: ${planPreview.conflicts[0]?.detail ?? intake.reason}` : undefined,
        modelPolicy: "openrouter/free-auto",
        runtime: "workflow",
        attempts: 0,
        maxAttempts,
        actionSliceCount: 0,
        queryCount: 0,
        mutationCount: 1,
        modelCallCount: 0,
        toolCallCount: 0,
        schedulerHandoffCount: planBlocked ? 0 : 1,
        receiptCount: 0,
        nextRunAt: now,
        createdAt: now,
        updatedAt: now,
      }));
      if (planBlocked) {
        await ctx.db.insert("traces", { roomId: a.roomId, ts: now, actor, type: "plan_blocked", summary: `PlanPreview blocked bulk diligence for ${row.company} (${planPreview.scheduling})`, detail: `bulk · ${companyKey} · ${planPreview.scheduling}`.slice(0, 480) });
        jobs.push({ company: row.company, companyKey, jobId: String(jobId), status: "blocked", reused: false });
        continue;
      }
      const workflowId = await start(ctx, internal.agentWorkflows.freeAutoWorkflow, { jobId }, { onComplete: internal.agentWorkflows.freeAutoWorkflowComplete, context: { jobId } });
      await ctx.db.patch(jobId, { workflowId: String(workflowId), updatedAt: now });
      jobs.push({ company: row.company, companyKey, jobId: String(jobId), status: "queued", reused: false });
    }
    return { ok: true as const, count: jobs.length, jobs };
  },
});

export const list = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const jobs = await ctx.db.query("agentJobs").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(40);
    return jobs.filter((job) => canReadJob(job, actor)).slice(0, 20);
  },
});

export const attempts = query({
  args: { jobId: v.id("agentJobs"), requester: actorProofV },
  handler: async (ctx, { jobId, requester }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return [];
    const actor = await requireActorProof(ctx, job.roomId, requester);
    if (!canReadJob(job, actor)) return [];
    return ctx.db.query("agentJobAttempts").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect();
  },
});

export const detail = query({
  args: { jobId: v.id("agentJobs"), requester: actorProofV },
  handler: async (ctx, { jobId, requester }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    const actor = await requireActorProof(ctx, job.roomId, requester);
    if (!canReadJob(job, actor)) return null;
    const attempts = await ctx.db.query("agentJobAttempts").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect();
    const operations = await ctx.db.query("agentOperationEvents").withIndex("by_job_sequence", (q) => q.eq("jobId", jobId)).take(100);
    const receipts = await ctx.db.query("agentMutationReceipts").withIndex("by_job", (q) => q.eq("jobId", jobId)).order("desc").take(50);
    const modelJournal = await ctx.db.query("agentModelStepJournal").withIndex("by_job", (q) => q.eq("jobId", jobId)).order("desc").take(50);
    const leases = (await Promise.all((["active", "released", "expired", "stolen"] as const).map((status) =>
      ctx.db.query("agentLeases").withIndex("by_job_status", (q) => q.eq("jobId", jobId).eq("status", status)).take(25)
    ))).flat();
    const draftOperations = (await Promise.all((["pending", "approved", "rejected", "needs_rebase", "applied"] as const).map((status) =>
      ctx.db.query("agentDraftOperations").withIndex("by_job_status", (q) => q.eq("jobId", jobId).eq("status", status)).take(25)
    ))).flat();
    const latestRun = job.latestRunId ? await ctx.db.get(job.latestRunId) : null;
    const latestSteps = job.latestRunId
      ? await ctx.db.query("agentSteps").withIndex("by_run", (q) => q.eq("runId", job.latestRunId!)).take(80)
      : [];
    return { job, attempts, operations, receipts, modelJournal, leases, draftOperations, latestRun, latestSteps };
  },
});

export const cancel = mutation({
  args: { jobId: v.id("agentJobs"), requester: actorProofV },
  handler: async (ctx, { jobId, requester }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    const actor = await requireActorProof(ctx, job.roomId, requester);
    const room = await ctx.db.get(job.roomId);
    if (!room || (actor.id !== job.requester.id && actor.id !== room.hostId)) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    if (job.status === "completed" || job.status === "failed" || job.status === "cancelled") {
      return { ok: false as const, reason: "terminal" as const };
    }
    const now = Date.now();
    if (job.workflowId) await cancelWorkflow(ctx, components.workflow, job.workflowId as never);
    const activeLeases = await ctx.db.query("agentLeases").withIndex("by_job_status", (q) => q.eq("jobId", jobId).eq("status", "active")).collect();
    for (const lease of activeLeases) await ctx.db.patch(lease._id, { status: "released", releasedAt: now });
    await recordOperationEvent(ctx, {
      jobId,
      sequence: (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 3,
      kind: "checkpoint",
      name: "agentJobs.cancel",
      targetKind: "artifact",
      targetId: String(job.artifactId),
      status: "completed",
      countDelta: 1,
      affectedIds: [String(jobId), String(job.artifactId)],
      startedAt: now,
      completedAt: now,
    });
    await ctx.db.patch(jobId, {
      status: "cancelled",
      leaseId: "",
      leaseUntil: 0,
      error: "cancelled_by_user",
      mutationCount: (job.mutationCount ?? 0) + 1,
      updatedAt: now,
      completedAt: now,
    });
    return { ok: true as const };
  },
});

export const retry = mutation({
  args: {
    jobId: v.id("agentJobs"),
    requester: actorProofV,
    additionalAttempts: v.optional(v.number()),
  },
  handler: async (ctx, { jobId, requester, additionalAttempts }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    const actor = await requireActorProof(ctx, job.roomId, requester);
    const room = await ctx.db.get(job.roomId);
    if (!room || (actor.id !== job.requester.id && actor.id !== room.hostId)) {
      return { ok: false as const, reason: "forbidden" as const };
    }
    if (job.status === "completed" || job.status === "running") {
      return { ok: false as const, reason: "not_retryable" as const };
    }
    if (job.status === "blocked") {
      return { ok: false as const, reason: "blocked_requires_fresh_plan" as const };
    }
    const now = Date.now();
    const extra = Math.max(1, Math.min(additionalAttempts ?? 10, 50));
    const maxAttempts = Math.max(job.maxAttempts, job.attempts + extra);
    const workflowId = await start(ctx, internal.agentWorkflows.freeAutoWorkflow, { jobId }, {
      onComplete: internal.agentWorkflows.freeAutoWorkflowComplete,
      context: { jobId },
    });
    await ctx.db.patch(jobId, {
      status: "queued",
      maxAttempts,
      leaseId: "",
      leaseUntil: 0,
      nextRunAt: now,
      runtime: "workflow",
      workflowId: String(workflowId),
      error: undefined,
      updatedAt: now,
    });
    return { ok: true as const, maxAttempts };
  },
});

export const workflowState = internalMutation({
  args: { jobId: v.id("agentJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    const terminal = !job || job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "cancelled";
    return {
      terminal,
      status: job?.status ?? "missing",
      nextRunAt: job?.nextRunAt,
      attempts: job?.attempts ?? 0,
      maxAttempts: job?.maxAttempts ?? 0,
      now: Date.now(),
    };
  },
});

export const markWorkflowExceeded = internalMutation({
  args: { jobId: v.id("agentJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "cancelled") {
      return { ok: false as const, reason: "terminal_or_missing" as const };
    }
    const now = Date.now();
    await ctx.db.patch(jobId, {
      status: "failed",
      leaseId: "",
      leaseUntil: 0,
      error: "workflow_slice_limit_exceeded",
      updatedAt: now,
    });
    return { ok: true as const };
  },
});

export const sweepExpiredJobLeases = internalMutation({
  args: {
    now: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { now: nowArg, limit }) => {
    const now = nowArg ?? Date.now();
    const batchSize = Math.max(1, Math.min(limit ?? 50, 200));
    const running = await ctx.db
      .query("agentJobs")
      .withIndex("by_status_nextRunAt", (q) => q.eq("status", "running"))
      .take(batchSize);
    let expired = 0;

    for (const job of running) {
      if (!job.leaseUntil || job.leaseUntil > now) continue;
      expired += 1;
      const activeLeases = await ctx.db
        .query("agentLeases")
        .withIndex("by_job_status", (q) => q.eq("jobId", job._id).eq("status", "active"))
        .collect();
      for (const lease of activeLeases) {
        await ctx.db.patch(lease._id, { status: "expired", releasedAt: now });
      }

      const attempt = Math.max(1, job.attempts);
      const priorAttempt = await ctx.db
        .query("agentJobAttempts")
        .withIndex("by_job", (q) => q.eq("jobId", job._id).eq("attempt", attempt))
        .first();
      if (!priorAttempt) {
        const startedAt = Math.min(job.updatedAt ?? now, now);
        await ctx.db.insert("agentJobAttempts", {
          jobId: job._id,
          attempt,
          status: "failed",
          resolvedModel: job.modelPolicy,
          stopReason: "lease_expired",
          ms: Math.max(0, now - startedAt),
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          error: "job_lease_expired",
          startedAt,
          endedAt: now,
        });
      }

      await recordOperationEvent(ctx, {
        jobId: job._id,
        sequence: (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 4,
        kind: "lease",
        name: "agentJobs.sweepExpiredJobLeases",
        targetKind: "artifact",
        targetId: String(job.artifactId),
        status: "failed",
        countDelta: 1,
        affectedIds: [String(job._id), String(job.artifactId), ...activeLeases.map((lease) => String(lease._id))],
        startedAt: now,
        completedAt: now,
      });

      await ctx.db.patch(job._id, {
        status: "failed",
        leaseId: "",
        leaseUntil: 0,
        error: "job_lease_expired",
        mutationCount: (job.mutationCount ?? 0) + 1,
        updatedAt: now,
        completedAt: now,
      });
    }

    return { ok: true as const, scanned: running.length, expired };
  },
});

export const recordWorkflowComplete = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    workflowId: v.string(),
    resultKind: v.union(v.literal("success"), v.literal("failed"), v.literal("canceled")),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { jobId, workflowId, resultKind, error }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return { ok: false as const, reason: "missing" as const };
    if (job.workflowId && job.workflowId !== workflowId) return { ok: false as const, reason: "stale_workflow" as const };
    if (job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "cancelled") {
      return { ok: true as const, terminal: true as const };
    }
    if (resultKind === "success") return { ok: true as const, terminal: false as const };
    const now = Date.now();
    await ctx.db.patch(jobId, {
      status: resultKind === "canceled" ? "cancelled" : "failed",
      leaseId: "",
      leaseUntil: 0,
      error: resultKind === "canceled" ? "workflow_cancelled" : error ?? "workflow_failed",
      updatedAt: now,
    });
    return { ok: true as const, terminal: true as const };
  },
});

export const claimSlice = internalMutation({
  args: { jobId: v.id("agentJobs"), leaseId: v.string(), leaseMs: v.number() },
  handler: async (ctx, { jobId, leaseId, leaseMs }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    if (job.status === "completed" || job.status === "failed" || job.status === "blocked" || job.status === "cancelled") return null;
    const now = Date.now();
    if (job.status === "running" && job.leaseUntil && job.leaseUntil > now) return null;

    const art = await ctx.db.get(job.artifactId);
    if (!art || String(art.roomId) !== String(job.roomId)) {
      await ctx.db.patch(jobId, { status: "failed", error: "artifact_room_mismatch", updatedAt: now });
      return null;
    }
    let session = (await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", job.roomId)).collect())
      .find((s) => s.scope === "public");
    if (!session) {
      const sessionId = await ctx.db.insert("agentSessions", {
        roomId: job.roomId,
        agentId: "agent_room",
        agentName: "Room NodeAgent",
        scope: "public",
        status: "idle",
        lastAction: "started",
        updatedAt: now,
      });
      session = await ctx.db.get(sessionId) ?? undefined;
    }
    if (!session) {
      await ctx.db.patch(jobId, { status: "blocked", error: "agent_session_create_failed", updatedAt: now });
      return null;
    }

    const attempt = job.attempts + 1;
    const leaseUntil = now + Math.max(1_000, leaseMs);
    await ctx.db.patch(jobId, {
      status: "running",
      attempts: attempt,
      leaseId,
      leaseUntil,
      actionSliceCount: (job.actionSliceCount ?? 0) + 1,
      updatedAt: now,
    });
    await ctx.db.insert("agentLeases", {
      jobId,
      roomId: job.roomId,
      targetKind: "artifact",
      targetId: String(job.artifactId),
      mode: "write",
      status: "active",
      expiresAt: leaseUntil,
      createdAt: now,
    });
    await recordOperationEvent(ctx, {
      jobId,
      sequence: (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 2,
      kind: "lease",
      name: "agentJobs.claimSlice",
      targetKind: "artifact",
      targetId: String(job.artifactId),
      countDelta: 1,
      affectedIds: [String(jobId), String(job.artifactId)],
      startedAt: now,
      completedAt: now,
    });

    return {
      jobId,
      roomId: job.roomId,
      artifactId: job.artifactId,
      artifactTitle: art.title,
      artifactKind: art.kind,
      artifactMeta: art.meta,
      artifactVisibility: art.visibility ?? "room",
      requester: job.requester,
      goal: job.goal,
      mode: job.mode,
      modelPolicy: job.modelPolicy,
      cursor: job.cursor,
      handoff: job.handoff,
      attempt,
      maxAttempts: job.maxAttempts,
      sessionId: session._id,
      agentId: session.agentId,
      agentName: session.agentName,
    };
  },
});

export const finishSlice = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    leaseId: v.string(),
    attempt: v.number(),
    status: attemptStatusV,
    resolvedModel: v.string(),
    stopReason: v.string(),
    ms: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    costUsd: v.number(),
    runId: v.optional(v.id("agentRuns")),
    error: v.optional(v.string()),
    handoff: v.optional(v.any()),
    cursor: v.optional(v.any()),
    finalText: v.optional(v.string()),
    scheduledNextAt: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.jobId);
    if (!job) return { ok: false as const, reason: "job_not_found" as const };
    if (job.leaseId !== a.leaseId) return { ok: false as const, reason: "lease_mismatch" as const };
    const now = Date.now();
    await ctx.db.insert("agentJobAttempts", clean({
      jobId: a.jobId,
      runId: a.runId,
      attempt: a.attempt,
      status: a.status,
      resolvedModel: a.resolvedModel,
      stopReason: a.stopReason,
      ms: a.ms,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      costUsd: a.costUsd,
      error: a.error,
      scheduledNextAt: a.scheduledNextAt,
      startedAt: now - a.ms,
      endedAt: now,
    }));

    const nextStatus =
      a.status === "completed" ? "completed" :
      a.status === "failed" ? "failed" :
      a.status === "retrying" ? "retrying" :
      "paused";

    const patch: Record<string, unknown> = {
      status: nextStatus,
      leaseId: "",
      leaseUntil: 0,
      modelCallCount: (job.modelCallCount ?? 0) + 1,
      toolCallCount: (job.toolCallCount ?? 0) + (a.inputTokens || a.outputTokens ? 1 : 0),
      mutationCount: (job.mutationCount ?? 0) + 1,
      updatedAt: now,
    };
    if (a.runId) patch.latestRunId = a.runId;
    if (a.handoff !== undefined) patch.handoff = a.handoff;
    if (a.cursor !== undefined) patch.cursor = a.cursor;
    if (a.finalText !== undefined) patch.finalText = a.finalText;
    if (a.error !== undefined) patch.error = a.error;
    if (a.scheduledNextAt !== undefined) patch.nextRunAt = a.scheduledNextAt;
    if (nextStatus === "completed") patch.completedAt = now;
    const activeLeases = await ctx.db.query("agentLeases").withIndex("by_job_status", (q) => q.eq("jobId", a.jobId).eq("status", "active")).collect();
    for (const lease of activeLeases) await ctx.db.patch(lease._id, { status: "released", releasedAt: now });
    await recordOperationEvent(ctx, {
      jobId: a.jobId,
      runId: a.runId,
      sequence: (job.actionSliceCount ?? 0) + (job.queryCount ?? 0) + (job.mutationCount ?? 0) + (job.modelCallCount ?? 0) + (job.toolCallCount ?? 0) + (job.schedulerHandoffCount ?? 0) + 3,
      kind: "checkpoint",
      name: "agentJobs.finishSlice",
      targetKind: "artifact",
      targetId: String(job.artifactId),
      status: nextStatus === "failed" ? "failed" : "completed",
      countDelta: 1,
      affectedIds: [String(a.jobId), String(job.artifactId)],
      startedAt: now,
      completedAt: now,
    });
    await ctx.db.patch(a.jobId, patch as any);
    if (a.scheduledNextAt !== undefined && nextStatus !== "failed" && job.runtime !== "workflow") {
      await ctx.scheduler.runAfter(Math.max(0, a.scheduledNextAt - now), internal.agentJobRunner.runFreeAutoJobSlice, { jobId: a.jobId });
    }
    return { ok: true as const };
  },
});
