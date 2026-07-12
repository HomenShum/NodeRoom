import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { actorV, type ActorValue } from "./lib";
import {
  WORKBOOK_SESSION_MAX_STAGED_CELLS,
  normalizeWorkbookOperations,
  workbookCoordinateInAddressSpace,
  type WorkbookAddressSpace,
} from "../src/nodeagent/skills/spreadsheet/workbookSessionContract";

const PUBLISH_EXECUTOR_TTL_MS = 10 * 60_000;

const scalarV = v.union(v.string(), v.number(), v.boolean(), v.null());
const stagedOperationV = v.object({
  elementId: v.string(),
  value: scalarV,
  baseVersion: v.number(),
  beforeValue: v.optional(v.any()),
});
const publishOutcomeV = v.object({
  elementId: v.string(),
  status: v.union(
    v.literal("applied"),
    v.literal("proposed"),
    v.literal("rejected"),
    v.literal("needs_rebase"),
    v.literal("locked"),
    v.literal("error"),
  ),
  version: v.optional(v.number()),
  mutationReceiptId: v.optional(v.string()),
  proposalId: v.optional(v.string()),
  expected: v.optional(v.number()),
  actual: v.optional(v.number()),
  detail: v.optional(v.string()),
});

type WorkbookCtx = QueryCtx | MutationCtx;
type DraftOperationDoc = Doc<"agentDraftOperations">;

async function requireWorkbookScope(ctx: WorkbookCtx, args: {
  jobId: Id<"agentJobs">;
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  actor: ActorValue;
}, options: { allowTerminal?: boolean } = {}) {
  const [job, artifact] = await Promise.all([ctx.db.get(args.jobId), ctx.db.get(args.artifactId)]);
  if (!job) throw new Error("workbook_job_not_found");
  if (String(job.roomId) !== String(args.roomId) || String(job.artifactId) !== String(args.artifactId)) {
    throw new Error("workbook_scope_mismatch");
  }
  if (!artifact || String(artifact.roomId) !== String(args.roomId) || artifact.kind !== "sheet") {
    throw new Error("workbook_sheet_required");
  }
  const addressSpace = workbookAddressSpace(artifact.meta);
  if (!addressSpace) throw new Error("workbook_excel_grid_required");
  if (args.actor.kind !== "agent") throw new Error("workbook_agent_required");
  if (!options.allowTerminal && ["completed", "cancelled", "failed", "blocked"].includes(job.status)) throw new Error("workbook_job_terminal");
  return { job, artifact, addressSpace };
}

function workbookAddressSpace(meta: unknown): WorkbookAddressSpace | null {
  const root = meta && typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, unknown> : {};
  const grid = root.excelGrid && typeof root.excelGrid === "object" && !Array.isArray(root.excelGrid)
    ? root.excelGrid as Record<string, unknown>
    : null;
  const rows = Number(grid?.rows);
  const columns = Number(grid?.columns);
  return Number.isInteger(rows) && rows > 0 && Number.isInteger(columns) && columns > 0 ? { rows, columns } : null;
}

async function findSession(ctx: WorkbookCtx, jobId: Id<"agentJobs">, artifactId: Id<"artifacts">) {
  return ctx.db.query("agentWorkbookSessions")
    .withIndex("by_job_artifact", (q) => q.eq("jobId", jobId).eq("artifactId", artifactId))
    .first();
}

async function requireOrCreateSession(ctx: MutationCtx, args: {
  jobId: Id<"agentJobs">;
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
}) {
  const existing = await findSession(ctx, args.jobId, args.artifactId);
  if (existing) return existing;
  const now = Date.now();
  const sessionId = await ctx.db.insert("agentWorkbookSessions", {
    jobId: args.jobId,
    roomId: args.roomId,
    artifactId: args.artifactId,
    revision: 0,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  return (await ctx.db.get(sessionId))!;
}

async function findCommand(ctx: WorkbookCtx, args: {
  jobId: Id<"agentJobs">;
  artifactId: Id<"artifacts">;
  commandId: string;
}) {
  return ctx.db.query("agentDraftOperations")
    .withIndex("by_job_artifact_command", (q) => q
      .eq("jobId", args.jobId)
      .eq("artifactId", args.artifactId)
      .eq("commandId", args.commandId))
    .first();
}

async function recentSessionOperations(ctx: WorkbookCtx, args: {
  jobId: Id<"agentJobs">;
  artifactId: Id<"artifacts">;
}) {
  return ctx.db.query("agentDraftOperations")
    .withIndex("by_job_artifact_created", (q) => q.eq("jobId", args.jobId).eq("artifactId", args.artifactId))
    .order("desc")
    .take(100);
}

async function pendingStageRows(ctx: WorkbookCtx, args: { jobId: Id<"agentJobs">; artifactId: Id<"artifacts"> }) {
  const stages = await ctx.db.query("agentDraftOperations")
    .withIndex("by_job_artifact_operation_status", (q) => q
      .eq("jobId", args.jobId)
      .eq("artifactId", args.artifactId)
      .eq("operationName", "workbook.stage")
      .eq("status", "pending"))
    .take(WORKBOOK_SESSION_MAX_STAGED_CELLS + 1);
  if (stages.length > WORKBOOK_SESSION_MAX_STAGED_CELLS) throw new Error("workbook_pending_stage_invariant");
  return stages;
}

async function proposedWorkbookRows(ctx: WorkbookCtx, args: { jobId: Id<"agentJobs">; artifactId: Id<"artifacts"> }) {
  const rows = await Promise.all(["workbook.stage", "workbook.publish"].map((operationName) => ctx.db.query("agentDraftOperations")
    .withIndex("by_job_artifact_operation_status", (q) => q
      .eq("jobId", args.jobId)
      .eq("artifactId", args.artifactId)
      .eq("operationName", operationName)
      .eq("status", "proposed"))
    .take(WORKBOOK_SESSION_MAX_STAGED_CELLS + 2)));
  return rows.flat();
}

function commandReuseResult(existing: DraftOperationDoc, expectedName: string) {
  if (existing.operationName !== expectedName) {
    return { ok: false as const, reason: "workbook_command_id_reused" as const };
  }
  return { ...(existing.result as Record<string, unknown> ?? {}), idempotent: true };
}

function operationsFromStageRows(rows: DraftOperationDoc[]) {
  return rows.flatMap((row) => {
    const operations = Array.isArray((row.input as { operations?: unknown[] } | undefined)?.operations)
      ? (row.input as { operations: Array<{ elementId: string; value: unknown; baseVersion: number; beforeValue?: unknown }> }).operations
      : [];
    return operations.map((operation) => ({
      ...operation,
      stageOperationId: String(row._id),
    }));
  });
}

function mergePublishOutcomes(previous: unknown, incoming: Array<Record<string, unknown>>) {
  const prior = Array.isArray(previous) ? previous.filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object")) : [];
  const byElement = new Map(prior.map((outcome) => [String(outcome.elementId ?? ""), outcome]));
  for (const outcome of incoming) {
    const elementId = String(outcome.elementId ?? "");
    const existing = byElement.get(elementId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(outcome)) throw new Error(`workbook_outcome_conflict:${elementId}`);
    if (!existing) byElement.set(elementId, outcome);
  }
  return [...byElement.values()];
}

async function validateStageCoordinates(
  ctx: MutationCtx,
  artifact: Doc<"artifacts">,
  addressSpace: WorkbookAddressSpace,
  operations: Array<{ elementId: string; baseVersion: number }>,
) {
  const ordered = new Set(artifact.order);
  for (const operation of operations) {
    if (!workbookCoordinateInAddressSpace(operation.elementId, addressSpace) || !ordered.has(operation.elementId)) {
      throw new Error(`workbook_coordinate_outside_grid:${operation.elementId}`);
    }
    const element = await ctx.db.query("elements")
      .withIndex("by_artifact", (q) => q.eq("artifactId", artifact._id).eq("elementId", operation.elementId))
      .first();
    if (!element) throw new Error(`workbook_cell_missing:${operation.elementId}`);
    if (element.version !== operation.baseVersion) throw new Error(`workbook_stage_cell_conflict:${operation.elementId}:${element.version}`);
  }
}

function compactBeforeValue(value: unknown): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length <= 512 ? value : `${value.slice(0, 512)}...`;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length <= 512 ? serialized : `${serialized.slice(0, 512)}...`;
  } catch {
    return "[unavailable]";
  }
}

export const state = internalQuery({
  args: {
    jobId: v.id("agentJobs"),
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    actor: actorV,
  },
  handler: async (ctx, args) => {
    const { addressSpace } = await requireWorkbookScope(ctx, args);
    const [session, rows, pendingRows] = await Promise.all([
      findSession(ctx, args.jobId, args.artifactId),
      recentSessionOperations(ctx, args),
      pendingStageRows(ctx, args),
    ]);
    return {
      revision: session?.revision ?? 0,
      status: session?.status ?? "active",
      activeCommandId: session?.activeCommandId,
      pendingCount: operationsFromStageRows(pendingRows).length,
      operations: operationsFromStageRows(pendingRows),
      addressSpace,
      recent: rows.slice(0, 20).map((row) => ({
        commandId: row.commandId,
        operationName: row.operationName,
        status: row.status,
        result: row.result,
        createdAt: row.createdAt,
      })),
    };
  },
});

export const stage = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    actor: actorV,
    commandId: v.string(),
    expectedRevision: v.number(),
    reason: v.string(),
    operations: v.array(stagedOperationV),
  },
  handler: async (ctx, args) => {
    const { artifact, addressSpace } = await requireWorkbookScope(ctx, args);
    const existing = await findCommand(ctx, args);
    if (existing) return commandReuseResult(existing, "workbook.stage");
    const normalized = normalizeWorkbookOperations(args.operations);
    if (normalized.some((operation, index) => operation.elementId !== args.operations[index]?.elementId)) {
      throw new Error("workbook_coordinates_not_normalized");
    }
    for (const operation of args.operations) {
      if (!Number.isInteger(operation.baseVersion) || operation.baseVersion < 0) throw new Error("invalid_workbook_base_version");
    }
    await validateStageCoordinates(ctx, artifact, addressSpace, args.operations);

    const session = await requireOrCreateSession(ctx, args);
    if (session.status !== "active") return { ok: false as const, action: "stage" as const, revision: session.revision, reason: "workbook_publish_in_progress" as const };
    if (session.revision !== args.expectedRevision) {
      return { ok: false as const, action: "stage" as const, revision: session.revision, reason: "workbook_revision_conflict" as const };
    }

    const pendingRows = await pendingStageRows(ctx, args);
    const existingIds = new Set(operationsFromStageRows(pendingRows).map((operation) => operation.elementId));
    const duplicate = args.operations.find((operation) => existingIds.has(operation.elementId));
    if (duplicate) {
      return { ok: false as const, action: "stage" as const, revision: session.revision, reason: `workbook_coordinate_already_staged:${duplicate.elementId}` };
    }
    const pendingCount = existingIds.size + args.operations.length;
    if (pendingCount > WORKBOOK_SESSION_MAX_STAGED_CELLS) {
      return { ok: false as const, action: "stage" as const, revision: session.revision, reason: `workbook_stage_limit:${WORKBOOK_SESSION_MAX_STAGED_CELLS}` };
    }

    const now = Date.now();
    const revision = session.revision + 1;
    const result = { ok: true as const, action: "stage" as const, revision, pendingCount };
    const storedOperations = args.operations.map((operation) => ({
      ...operation,
      beforeValue: compactBeforeValue(operation.beforeValue),
    }));
    await ctx.db.insert("agentDraftOperations", {
      jobId: args.jobId,
      roomId: args.roomId,
      artifactId: args.artifactId,
      commandId: args.commandId,
      sessionRevision: revision,
      proposedBy: args.actor,
      operationName: "workbook.stage",
      input: { reason: args.reason, operations: storedOperations },
      affectedIds: args.operations.map((operation) => operation.elementId),
      status: "pending",
      result,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(session._id, { revision, updatedAt: now });
    return result;
  },
});

export const discard = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    actor: actorV,
    commandId: v.string(),
    expectedRevision: v.number(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkbookScope(ctx, args);
    const existing = await findCommand(ctx, args);
    if (existing) return commandReuseResult(existing, "workbook.discard");
    const session = await requireOrCreateSession(ctx, args);
    if (session.status !== "active") return { ok: false as const, action: "discard" as const, revision: session.revision, reason: "workbook_publish_in_progress" as const };
    if (session.revision !== args.expectedRevision) {
      return { ok: false as const, action: "discard" as const, revision: session.revision, reason: "workbook_revision_conflict" as const };
    }
    const pendingRows = await pendingStageRows(ctx, args);
    const now = Date.now();
    for (const row of pendingRows) await ctx.db.patch(row._id, { status: "rejected", resolvedAt: now, updatedAt: now });
    const revision = session.revision + 1;
    const result = { ok: true as const, action: "discard" as const, revision, pendingCount: 0 };
    await ctx.db.insert("agentDraftOperations", {
      jobId: args.jobId,
      roomId: args.roomId,
      artifactId: args.artifactId,
      commandId: args.commandId,
      sessionRevision: revision,
      proposedBy: args.actor,
      operationName: "workbook.discard",
      input: { reason: args.reason, discardedOperationIds: pendingRows.map((row) => String(row._id)) },
      affectedIds: operationsFromStageRows(pendingRows).map((operation) => operation.elementId),
      status: "applied",
      result,
      createdAt: now,
      updatedAt: now,
      resolvedAt: now,
    });
    await ctx.db.patch(session._id, { revision, updatedAt: now });
    return result;
  },
});

export const beginPublish = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    actor: actorV,
    commandId: v.string(),
    expectedRevision: v.number(),
    executorToken: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireWorkbookScope(ctx, args);
    const existing = await findCommand(ctx, args);
    if (existing) {
      const reused = commandReuseResult(existing, "workbook.publish") as Record<string, unknown>;
      if (reused.reason === "workbook_command_id_reused") return reused;
      if (existing.status === "approved") {
        const now = Date.now();
        if (existing.executorToken && existing.executorToken !== args.executorToken && (existing.executorExpiresAt ?? 0) > now) {
          return { ok: false as const, action: "publish" as const, revision: existing.sessionRevision ?? 0, reason: "workbook_publish_executor_active" as const };
        }
        await ctx.db.patch(existing._id, { executorToken: args.executorToken, executorExpiresAt: now + PUBLISH_EXECUTOR_TTL_MS, updatedAt: now });
      }
      return { ...reused, publishOperationId: String(existing._id) };
    }
    const session = await requireOrCreateSession(ctx, args);
    if (session.status !== "active") return { ok: false as const, action: "publish" as const, revision: session.revision, reason: "workbook_publish_in_progress" as const };
    if (session.revision !== args.expectedRevision) {
      return { ok: false as const, action: "publish" as const, revision: session.revision, reason: "workbook_revision_conflict" as const };
    }
    const pendingRows = await pendingStageRows(ctx, args);
    const operations = operationsFromStageRows(pendingRows);
    const now = Date.now();
    if (!operations.length) {
      const revision = session.revision + 1;
      const result = { ok: true as const, action: "publish" as const, revision, pendingCount: 0, outcomes: [], reason: "workbook_no_changes" as const };
      const operationId = await ctx.db.insert("agentDraftOperations", {
        jobId: args.jobId,
        roomId: args.roomId,
        artifactId: args.artifactId,
        commandId: args.commandId,
        sessionRevision: revision,
        proposedBy: args.actor,
        operationName: "workbook.publish",
        input: { reason: args.reason, stageOperationIds: [] },
        affectedIds: [],
        status: "applied",
        result,
        createdAt: now,
        updatedAt: now,
        resolvedAt: now,
      });
      await ctx.db.patch(session._id, { revision, updatedAt: now });
      return { ...result, publishOperationId: String(operationId) };
    }

    const prepared = {
      ok: true as const,
      action: "publish" as const,
      revision: session.revision,
      phase: "prepared" as const,
      pendingCount: operations.length,
      operations,
      outcomes: [],
    };
    const publishOperationId = await ctx.db.insert("agentDraftOperations", {
      jobId: args.jobId,
      roomId: args.roomId,
      artifactId: args.artifactId,
      commandId: args.commandId,
      sessionRevision: session.revision,
      proposedBy: args.actor,
      operationName: "workbook.publish",
      input: { reason: args.reason, stageOperationIds: pendingRows.map((row) => String(row._id)), operations },
      affectedIds: operations.map((operation) => operation.elementId),
      status: "approved",
      executorToken: args.executorToken,
      executorExpiresAt: now + PUBLISH_EXECUTOR_TTL_MS,
      result: prepared,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(session._id, { status: "publishing", activeCommandId: args.commandId, updatedAt: now });
    return { ...prepared, publishOperationId: String(publishOperationId) };
  },
});

export const recordPublishProgress = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    artifactId: v.id("artifacts"),
    commandId: v.string(),
    publishOperationId: v.id("agentDraftOperations"),
    executorToken: v.string(),
    outcomes: v.array(publishOutcomeV),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.publishOperationId);
    if (!row || row.operationName !== "workbook.publish" || String(row.jobId) !== String(args.jobId)
      || String(row.artifactId) !== String(args.artifactId) || row.commandId !== args.commandId) {
      throw new Error("workbook_publish_command_not_found");
    }
    if (row.status !== "approved") return { ok: true as const, idempotent: true };
    if (row.executorToken !== args.executorToken || (row.executorExpiresAt ?? 0) <= Date.now()) throw new Error("workbook_publish_executor_fenced");
    const previous = row.result as Record<string, unknown> | undefined;
    const outcomes = mergePublishOutcomes(previous?.outcomes, args.outcomes as Array<Record<string, unknown>>);
    await ctx.db.patch(row._id, {
      result: { ...previous, outcomes },
      executorExpiresAt: Date.now() + PUBLISH_EXECUTOR_TTL_MS,
      updatedAt: Date.now(),
    });
    return { ok: true as const };
  },
});

export const assertPublishFence = internalQuery({
  args: {
    jobId: v.id("agentJobs"),
    artifactId: v.id("artifacts"),
    commandId: v.string(),
    publishOperationId: v.id("agentDraftOperations"),
    executorToken: v.string(),
  },
  handler: async (ctx, args) => {
    const [job, row, session] = await Promise.all([
      ctx.db.get(args.jobId),
      ctx.db.get(args.publishOperationId),
      findSession(ctx, args.jobId, args.artifactId),
    ]);
    const ok = Boolean(
      job && !["completed", "cancelled", "failed", "blocked"].includes(job.status)
      && row && row.status === "approved" && row.commandId === args.commandId
      && row.executorToken === args.executorToken && (row.executorExpiresAt ?? 0) > Date.now()
      && session?.status === "publishing" && session.activeCommandId === args.commandId,
    );
    return { ok, reason: ok ? undefined : "workbook_publish_fenced" };
  },
});

export const finishPublish = internalMutation({
  args: {
    jobId: v.id("agentJobs"),
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    actor: actorV,
    commandId: v.string(),
    publishOperationId: v.id("agentDraftOperations"),
    executorToken: v.string(),
    resolution: v.union(v.literal("completed"), v.literal("proposed"), v.literal("needs_rebase"), v.literal("retryable")),
    reason: v.optional(v.string()),
    outcomes: v.array(publishOutcomeV),
  },
  handler: async (ctx, args) => {
    await requireWorkbookScope(ctx, args, { allowTerminal: true });
    const row = await ctx.db.get(args.publishOperationId);
    if (!row || row.operationName !== "workbook.publish" || String(row.jobId) !== String(args.jobId)
      || String(row.artifactId) !== String(args.artifactId) || row.commandId !== args.commandId) {
      throw new Error("workbook_publish_command_not_found");
    }
    if (row.status !== "approved") return { ...(row.result as Record<string, unknown> ?? {}), idempotent: true };
    if (row.executorToken !== args.executorToken) throw new Error("workbook_publish_executor_fenced");
    const session = await findSession(ctx, args.jobId, args.artifactId);
    if (!session || session.status !== "publishing" || session.activeCommandId !== args.commandId) {
      throw new Error("workbook_publish_session_mismatch");
    }

    const now = Date.now();
    const stageOperationIds = Array.isArray((row.input as { stageOperationIds?: unknown[] } | undefined)?.stageOperationIds)
      ? (row.input as { stageOperationIds: string[] }).stageOperationIds
      : [];
    if (args.resolution !== "retryable") {
      const stageStatus = args.resolution === "completed" ? "applied" : args.resolution === "proposed" ? "proposed" : "needs_rebase";
      for (const stageOperationId of stageOperationIds) {
        const stageRow = await ctx.db.get(stageOperationId as Id<"agentDraftOperations">);
        if (!stageRow || stageRow.operationName !== "workbook.stage") continue;
        await ctx.db.patch(stageRow._id, {
          status: stageStatus,
          proposalIds: args.outcomes.map((outcome) => outcome.proposalId).filter((id): id is string => Boolean(id)),
          result: { ...(stageRow.result as Record<string, unknown> ?? {}), publishCommandId: args.commandId, outcomes: args.outcomes },
          updatedAt: now,
          resolvedAt: now,
        });
      }
    }
    const revision = session.revision + 1;
    const pendingCount = args.resolution === "retryable" ? operationsFromStageRows(await pendingStageRows(ctx, args)).length : 0;
    const result = {
      ok: args.resolution === "completed" || args.resolution === "proposed",
      action: "publish" as const,
      revision,
      pendingCount,
      outcomes: args.outcomes,
      ...(args.reason ? { reason: args.reason } : {}),
    };
    await ctx.db.patch(row._id, {
      sessionRevision: revision,
      status: args.resolution === "needs_rebase" ? "needs_rebase" : args.resolution === "proposed" ? "proposed" : "applied",
      proposalIds: args.outcomes.map((outcome) => outcome.proposalId).filter((id): id is string => Boolean(id)),
      result,
      updatedAt: now,
      resolvedAt: now,
    });
    await ctx.db.patch(session._id, {
      revision,
      status: args.resolution === "proposed" ? "awaiting_approval" : "active",
      activeCommandId: undefined,
      updatedAt: now,
    });
    return result;
  },
});

export async function resolveWorkbookProposal(ctx: MutationCtx, args: {
  proposalId: Id<"proposals">;
  jobId?: Id<"agentJobs">;
  artifactId: Id<"artifacts">;
  resolution: "applied" | "rejected";
  version?: number;
  mutationReceiptId?: Id<"agentMutationReceipts">;
}) {
  if (!args.jobId) return;
  const proposedRows = await proposedWorkbookRows(ctx, { jobId: args.jobId, artifactId: args.artifactId });
  const proposalId = String(args.proposalId);
  const matching = proposedRows.filter((row) => String(row.artifactId) === String(args.artifactId) && row.proposalIds?.includes(proposalId));
  if (!matching.length) return;
  const now = Date.now();
  for (const row of matching) {
    const result = row.result as Record<string, unknown> | undefined;
    const outcomes = Array.isArray(result?.outcomes)
      ? (result.outcomes as Array<Record<string, unknown>>).map((outcome) => outcome.proposalId === proposalId
        ? {
          ...outcome,
          status: args.resolution,
          ...(args.version !== undefined ? { version: args.version } : {}),
          ...(args.mutationReceiptId ? { mutationReceiptId: String(args.mutationReceiptId) } : {}),
        }
        : outcome)
      : [];
    const hasProposed = outcomes.some((outcome) => outcome.status === "proposed");
    const hasRejected = outcomes.some((outcome) => outcome.status === "rejected");
    const status = hasProposed ? "proposed" : hasRejected ? "rejected" : "applied";
    await ctx.db.patch(row._id, {
      status,
      proposalIds: row.proposalIds?.filter((id) => id !== proposalId),
      result: { ...result, ok: !hasRejected, outcomes, ...(hasRejected ? { reason: "workbook_proposal_rejected" } : {}) },
      updatedAt: now,
      ...(status === "proposed" ? {} : { resolvedAt: now }),
    });
  }
  const remaining = await proposedWorkbookRows(ctx, { jobId: args.jobId, artifactId: args.artifactId });
  if (!remaining.length) {
    const session = await findSession(ctx, args.jobId, args.artifactId);
    if (session?.status === "awaiting_approval") {
      await ctx.db.patch(session._id, { status: "active", activeCommandId: undefined, revision: session.revision + 1, updatedAt: now });
    }
  }
}
