import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { applyCellEditCore } from "./artifacts";
import { actorProofV, requireActorProof, sha256Hex, type ActorValue } from "./lib";

const CASEFLOW_SCHEMA_VERSIONS = {
  approval: "nodekit.approval/v1",
  artifact: "nodekit.artifact/v1",
  case: "nodekit.case/v1",
  event: "nodekit.caseflow-event/v1",
  exception: "nodekit.exception/v1",
  proposal: "nodekit.proposal/v1",
  receipt: "nodekit.receipt/v1",
  run: "nodekit.run/v1",
} as const;

const MAX_TITLE_LENGTH = 200;
const MAX_PRIMARY_JOB_LENGTH = 2_000;
const MAX_STAGE_COUNT = 32;
const MAX_STAGE_TEXT_LENGTH = 160;
const MAX_EXCEPTION_TEXT_LENGTH = 2_000;
const CANONICAL_ELEMENT_ID = "nodekit:caseflow:canonical";
const TERMINAL_RUN_STATUSES = new Set(["cancelled", "completed", "failed_safely"]);

type DbCtx = QueryCtx | MutationCtx;
type Requester = { actor: ActorValue; token?: string };
type CaseflowScope = {
  actor: ActorValue;
  member: Doc<"members">;
  room: Doc<"rooms">;
};

function requiredText(value: unknown, label: string, maxLength: number): string {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`caseflow_${label}_required`);
  if (normalized.length > maxLength) throw new Error(`caseflow_${label}_too_long`);
  return normalized;
}

function optionalText(value: unknown, maxLength: number): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length > maxLength) throw new Error("caseflow_text_too_long");
  return normalized;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("caseflow_value_not_json");
  return serialized;
}

async function contentHash(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}

async function requireScope(
  ctx: DbCtx,
  roomId: Id<"rooms">,
  requester: Requester,
): Promise<CaseflowScope> {
  const actor = await requireActorProof(ctx, roomId, requester);
  const [member, room] = await Promise.all([
    ctx.db.get(actor.id as Id<"members">),
    ctx.db.get(roomId),
  ]);
  if (!member || String(member.roomId) !== String(roomId)) throw new Error("caseflow_member_scope_mismatch");
  if (!room || room.status !== "live") throw new Error("caseflow_room_not_live");
  return { actor, member, room };
}

function requireOwnedRecord<T extends { roomId: Id<"rooms">; ownerMemberId: Id<"members"> }>(
  scope: CaseflowScope,
  record: T | null,
): T {
  if (
    !record ||
    String(record.roomId) !== String(scope.room._id) ||
    String(record.ownerMemberId) !== String(scope.member._id)
  ) {
    throw new Error("caseflow_owner_scope_mismatch");
  }
  return record;
}

async function emit(
  ctx: MutationCtx,
  scope: CaseflowScope,
  args: {
    runId?: Id<"nodekitCaseflowRuns">;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload?: unknown;
    occurredAt?: number;
  },
) {
  const previous = await ctx.db
    .query("nodekitCaseflowEvents")
    .withIndex("by_aggregate_sequence", (q) => q.eq("aggregateId", args.aggregateId))
    .order("desc")
    .first();
  return ctx.db.insert("nodekitCaseflowEvents", {
    roomId: scope.room._id,
    ownerMemberId: scope.member._id,
    runId: args.runId,
    schemaVersion: CASEFLOW_SCHEMA_VERSIONS.event,
    aggregateType: args.aggregateType,
    aggregateId: args.aggregateId,
    eventType: args.eventType,
    sequence: (previous?.sequence ?? 0) + 1,
    payload: args.payload ?? {},
    occurredAt: args.occurredAt ?? Date.now(),
  });
}

function portableCase(record: Doc<"nodekitCaseflowCases">) {
  return {
    caseId: String(record._id),
    createdAt: iso(record.createdAt),
    currentRunId: record.currentRunId ? String(record.currentRunId) : null,
    primaryJob: record.primaryJob,
    schemaVersion: record.schemaVersion,
    status: record.status,
    title: record.title,
    updatedAt: iso(record.updatedAt),
  };
}

function portableRun(record: Doc<"nodekitCaseflowRuns">) {
  return {
    caseId: String(record.caseId),
    createdAt: iso(record.createdAt),
    currentStageId: record.currentStageId,
    nextAction: record.nextAction,
    nextActionOwner: record.nextActionOwner,
    runId: String(record._id),
    schemaVersion: record.schemaVersion,
    stages: record.stages,
    status: record.status,
    updatedAt: iso(record.updatedAt),
  };
}

async function portableArtifact(ctx: DbCtx, record: Doc<"nodekitCaseflowArtifacts">) {
  const versions = await ctx.db
    .query("nodekitCaseflowArtifactVersions")
    .withIndex("by_artifact_version", (q) => q.eq("artifactId", record._id))
    .collect();
  return {
    artifactId: String(record._id),
    caseId: String(record.caseId),
    canonicalVersion: record.canonicalVersion,
    createdAt: iso(record.createdAt),
    kind: record.kind,
    nodeRoomArtifactId: String(record.nodeRoomArtifactId),
    runId: String(record.runId),
    schemaVersion: record.schemaVersion,
    title: record.title,
    updatedAt: iso(record.updatedAt),
    versions: versions.map((version) => ({
      content: version.content,
      contentHash: version.contentHash,
      createdAt: iso(version.createdAt),
      ...(version.proposalId ? { proposalId: String(version.proposalId) } : {}),
      version: version.version,
    })),
  };
}

function portableProposal(record: Doc<"nodekitCaseflowProposals">) {
  return {
    artifactId: String(record.artifactId),
    baseVersion: record.baseVersion,
    createdAt: iso(record.createdAt),
    patch: record.patch,
    proposalId: String(record._id),
    rationale: record.rationale,
    schemaVersion: record.schemaVersion,
    status: record.status,
    ...(record.decidedAt ? { decidedAt: iso(record.decidedAt) } : {}),
  };
}

function portableApproval(record: Doc<"nodekitCaseflowApprovals">) {
  return {
    approvalId: String(record._id),
    comment: record.comment,
    decidedAt: iso(record.decidedAt),
    decision: record.decision,
    proposalId: String(record.proposalId),
    schemaVersion: record.schemaVersion,
  };
}

function portableException(record: Doc<"nodekitCaseflowExceptions">) {
  return {
    code: record.code,
    exceptionId: String(record._id),
    message: record.message,
    preservedState: record.preservedState,
    raisedAt: iso(record.raisedAt),
    resolution: record.resolution ?? null,
    runId: String(record.runId),
    schemaVersion: record.schemaVersion,
    status: record.status,
    ...(record.resolvedAt ? { resolvedAt: iso(record.resolvedAt) } : {}),
  };
}

function portableEvent(record: Doc<"nodekitCaseflowEvents">) {
  return {
    actor: { type: "user", id: String(record.ownerMemberId) },
    aggregateId: record.aggregateId,
    aggregateType: record.aggregateType,
    eventId: String(record._id),
    eventType: record.eventType,
    occurredAt: iso(record.occurredAt),
    payload: record.payload,
    schemaVersion: record.schemaVersion,
    sequence: record.sequence,
  };
}

function portableReceipt(record: Doc<"nodekitCaseflowReceipts">) {
  return {
    ...(record.body as Record<string, unknown>),
    receiptId: String(record._id),
    receiptHash: record.receiptHash,
  };
}

async function ownedCase(ctx: DbCtx, scope: CaseflowScope, caseId: Id<"nodekitCaseflowCases">) {
  return requireOwnedRecord(scope, await ctx.db.get(caseId));
}

async function ownedRun(ctx: DbCtx, scope: CaseflowScope, runId: Id<"nodekitCaseflowRuns">) {
  return requireOwnedRecord(scope, await ctx.db.get(runId));
}

async function ownedArtifact(ctx: DbCtx, scope: CaseflowScope, artifactId: Id<"nodekitCaseflowArtifacts">) {
  return requireOwnedRecord(scope, await ctx.db.get(artifactId));
}

async function ownedProposal(ctx: DbCtx, scope: CaseflowScope, proposalId: Id<"nodekitCaseflowProposals">) {
  return requireOwnedRecord(scope, await ctx.db.get(proposalId));
}

async function ownedException(ctx: DbCtx, scope: CaseflowScope, exceptionId: Id<"nodekitCaseflowExceptions">) {
  return requireOwnedRecord(scope, await ctx.db.get(exceptionId));
}

const scopeArgs = {
  roomId: v.id("rooms"),
  requester: actorProofV,
};

export const createCase = mutation({
  args: {
    ...scopeArgs,
    title: v.string(),
    primaryJob: v.string(),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const now = Date.now();
    const caseId = await ctx.db.insert("nodekitCaseflowCases", {
      roomId: scope.room._id,
      ownerMemberId: scope.member._id,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.case,
      title: requiredText(args.title, "title", MAX_TITLE_LENGTH),
      primaryJob: requiredText(args.primaryJob, "primary_job", MAX_PRIMARY_JOB_LENGTH),
      status: "ready",
      createdAt: now,
      updatedAt: now,
    });
    const record = await ctx.db.get(caseId);
    if (!record) throw new Error("caseflow_case_insert_failed");
    await emit(ctx, scope, {
      aggregateType: "case",
      aggregateId: String(caseId),
      eventType: "case.created",
      payload: portableCase(record),
      occurredAt: now,
    });
    return portableCase(record);
  },
});

const stageV = v.object({
  id: v.optional(v.string()),
  label: v.optional(v.string()),
  owner: v.optional(v.string()),
});

export const startRun = mutation({
  args: {
    ...scopeArgs,
    caseId: v.id("nodekitCaseflowCases"),
    stages: v.array(stageV),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const caseRecord = await ownedCase(ctx, scope, args.caseId);
    if (caseRecord.currentRunId) {
      const current = await ctx.db.get(caseRecord.currentRunId);
      if (current && !TERMINAL_RUN_STATUSES.has(current.status)) return portableRun(current);
    }
    if (args.stages.length === 0) throw new Error("caseflow_run_stages_required");
    if (args.stages.length > MAX_STAGE_COUNT) throw new Error("caseflow_too_many_stages");
    const seen = new Set<string>();
    const stages = args.stages.map((stage, index) => {
      const id = requiredText(stage.id ?? `stage-${index + 1}`, "stage_id", MAX_STAGE_TEXT_LENGTH);
      if (seen.has(id)) throw new Error("caseflow_duplicate_stage_id");
      seen.add(id);
      return {
        id,
        label: requiredText(stage.label ?? stage.id ?? `Stage ${index + 1}`, "stage_label", MAX_STAGE_TEXT_LENGTH),
        owner: optionalText(stage.owner ?? "system", MAX_STAGE_TEXT_LENGTH) || "system",
        status: (index === 0 ? "active" : "pending") as "active" | "pending",
      };
    });
    const now = Date.now();
    const runId = await ctx.db.insert("nodekitCaseflowRuns", {
      roomId: scope.room._id,
      ownerMemberId: scope.member._id,
      caseId: caseRecord._id,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.run,
      status: "active",
      stages,
      currentStageId: stages[0].id,
      nextAction: stages[0].label,
      nextActionOwner: stages[0].owner,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(caseRecord._id, { currentRunId: runId, status: "in_progress", updatedAt: now });
    const run = await ctx.db.get(runId);
    if (!run) throw new Error("caseflow_run_insert_failed");
    await emit(ctx, scope, {
      runId,
      aggregateType: "run",
      aggregateId: String(runId),
      eventType: "run.started",
      payload: portableRun(run),
      occurredAt: now,
    });
    await emit(ctx, scope, {
      runId,
      aggregateType: "run",
      aggregateId: String(runId),
      eventType: "stage.entered",
      payload: { stageId: run.currentStageId },
      occurredAt: now,
    });
    return portableRun(run);
  },
});

export const enterStage = mutation({
  args: {
    ...scopeArgs,
    runId: v.id("nodekitCaseflowRuns"),
    stageId: v.string(),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const run = await ownedRun(ctx, scope, args.runId);
    if (TERMINAL_RUN_STATUSES.has(run.status)) throw new Error(`caseflow_run_terminal:${run.status}`);
    const targetIndex = run.stages.findIndex((stage) => stage.id === args.stageId);
    if (targetIndex < 0) throw new Error("caseflow_stage_not_found");
    const stages = run.stages.map((stage, index) => ({
      ...stage,
      status: (index < targetIndex ? "completed" : index === targetIndex ? "active" : "pending") as
        "completed" | "active" | "pending",
    }));
    const now = Date.now();
    const nextAction = optionalText(args.nextAction ?? stages[targetIndex].label, MAX_STAGE_TEXT_LENGTH) || stages[targetIndex].label;
    const nextActionOwner = optionalText(args.nextActionOwner ?? stages[targetIndex].owner, MAX_STAGE_TEXT_LENGTH) || stages[targetIndex].owner;
    await ctx.db.patch(run._id, {
      stages,
      currentStageId: args.stageId,
      nextAction,
      nextActionOwner,
      updatedAt: now,
    });
    await emit(ctx, scope, {
      runId: run._id,
      aggregateType: "run",
      aggregateId: String(run._id),
      eventType: "stage.entered",
      payload: { stageId: args.stageId, nextAction, nextActionOwner },
      occurredAt: now,
    });
    const updated = await ctx.db.get(run._id);
    if (!updated) throw new Error("caseflow_run_missing_after_stage");
    return portableRun(updated);
  },
});

export const createArtifact = mutation({
  args: {
    ...scopeArgs,
    caseId: v.id("nodekitCaseflowCases"),
    runId: v.id("nodekitCaseflowRuns"),
    kind: v.optional(v.string()),
    title: v.string(),
    content: v.any(),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const [caseRecord, run] = await Promise.all([
      ownedCase(ctx, scope, args.caseId),
      ownedRun(ctx, scope, args.runId),
    ]);
    if (String(run.caseId) !== String(caseRecord._id)) throw new Error("caseflow_run_case_mismatch");
    const title = requiredText(args.title, "artifact_title", MAX_TITLE_LENGTH);
    const kind = optionalText(args.kind ?? "generic", MAX_STAGE_TEXT_LENGTH) || "generic";
    const now = Date.now();
    const nodeRoomArtifactId = await ctx.db.insert("artifacts", {
      roomId: scope.room._id,
      kind: "sheet",
      title,
      version: 1,
      order: [CANONICAL_ELEMENT_ID],
      updatedAt: now,
      createdBy: scope.actor,
      visibility: "private",
      meta: {
        integration: "nodekit-caseflow",
        caseId: String(caseRecord._id),
        runId: String(run._id),
        caseflowKind: kind,
      },
    });
    await ctx.db.insert("elements", {
      artifactId: nodeRoomArtifactId,
      elementId: CANONICAL_ELEMENT_ID,
      version: 1,
      value: args.content,
      updatedAt: now,
      updatedBy: scope.actor,
    });
    const artifactId = await ctx.db.insert("nodekitCaseflowArtifacts", {
      roomId: scope.room._id,
      ownerMemberId: scope.member._id,
      caseId: caseRecord._id,
      runId: run._id,
      nodeRoomArtifactId,
      canonicalElementId: CANONICAL_ELEMENT_ID,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.artifact,
      kind,
      title,
      canonicalVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("nodekitCaseflowArtifactVersions", {
      artifactId,
      version: 1,
      content: args.content,
      contentHash: await contentHash(args.content),
      createdAt: now,
    });
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) throw new Error("caseflow_artifact_insert_failed");
    await emit(ctx, scope, {
      runId: run._id,
      aggregateType: "artifact",
      aggregateId: String(artifactId),
      eventType: "artifact.created",
      payload: { artifactId: String(artifactId), nodeRoomArtifactId: String(nodeRoomArtifactId), version: 1 },
      occurredAt: now,
    });
    return portableArtifact(ctx, artifact);
  },
});

export const createProposal = mutation({
  args: {
    ...scopeArgs,
    artifactId: v.id("nodekitCaseflowArtifacts"),
    baseVersion: v.number(),
    patch: v.any(),
    rationale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const artifact = await ownedArtifact(ctx, scope, args.artifactId);
    if (!Number.isSafeInteger(args.baseVersion) || args.baseVersion < 1) throw new Error("caseflow_invalid_base_version");
    if (args.baseVersion !== artifact.canonicalVersion) {
      throw new Error(`caseflow_stale_proposal_base:${args.baseVersion}:${artifact.canonicalVersion}`);
    }
    const now = Date.now();
    const proposalId = await ctx.db.insert("nodekitCaseflowProposals", {
      roomId: scope.room._id,
      ownerMemberId: scope.member._id,
      artifactId: artifact._id,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.proposal,
      baseVersion: args.baseVersion,
      patch: args.patch,
      patchHash: await contentHash(args.patch),
      rationale: optionalText(args.rationale, MAX_PRIMARY_JOB_LENGTH),
      status: "pending",
      createdAt: now,
    });
    const proposal = await ctx.db.get(proposalId);
    if (!proposal) throw new Error("caseflow_proposal_insert_failed");
    await emit(ctx, scope, {
      runId: artifact.runId,
      aggregateType: "proposal",
      aggregateId: String(proposalId),
      eventType: "proposal.created",
      payload: portableProposal(proposal),
      occurredAt: now,
    });
    return portableProposal(proposal);
  },
});

export const decideProposal = mutation({
  args: {
    ...scopeArgs,
    proposalId: v.id("nodekitCaseflowProposals"),
    decision: v.union(v.literal("accepted"), v.literal("rejected")),
    comment: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const proposal = await ownedProposal(ctx, scope, args.proposalId);
    const artifact = await ownedArtifact(ctx, scope, proposal.artifactId);
    if (proposal.status !== "pending") {
      const approval = await ctx.db
        .query("nodekitCaseflowApprovals")
        .withIndex("by_proposal", (q) => q.eq("proposalId", proposal._id))
        .unique();
      const repeatedDecisionMatches = approval?.decision === args.decision && (
        proposal.status === args.decision ||
        (proposal.status === "conflicted" && args.decision === "accepted")
      );
      if (!approval || !repeatedDecisionMatches) throw new Error(`caseflow_proposal_already_${proposal.status}`);
      return {
        approval: portableApproval(approval),
        artifact: await portableArtifact(ctx, artifact),
        proposal: portableProposal(proposal),
        reused: true,
      };
    }

    const now = Date.now();
    const approvalId = await ctx.db.insert("nodekitCaseflowApprovals", {
      roomId: scope.room._id,
      ownerMemberId: scope.member._id,
      proposalId: proposal._id,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.approval,
      decision: args.decision,
      comment: optionalText(args.comment, MAX_PRIMARY_JOB_LENGTH),
      decidedAt: now,
    });
    const approval = await ctx.db.get(approvalId);
    if (!approval) throw new Error("caseflow_approval_insert_failed");

    if (args.decision === "accepted" && proposal.baseVersion !== artifact.canonicalVersion) {
      await ctx.db.patch(proposal._id, { status: "conflicted", decidedAt: now });
      await emit(ctx, scope, {
        runId: artifact.runId,
        aggregateType: "proposal",
        aggregateId: String(proposal._id),
        eventType: "proposal.conflicted",
        payload: { canonicalVersion: artifact.canonicalVersion },
        occurredAt: now,
      });
      const conflicted = await ctx.db.get(proposal._id);
      if (!conflicted) throw new Error("caseflow_proposal_missing_after_conflict");
      return {
        approval: portableApproval(approval),
        artifact: await portableArtifact(ctx, artifact),
        proposal: portableProposal(conflicted),
        reused: false,
      };
    }

    if (args.decision === "accepted") {
      const applied = await applyCellEditCore(ctx, {
        roomId: scope.room._id,
        artifactId: artifact.nodeRoomArtifactId,
        elementId: artifact.canonicalElementId,
        kind: "set",
        value: proposal.patch,
        baseVersion: proposal.baseVersion,
        actor: scope.actor,
      });
      if (!applied.ok) {
        if (applied.reason !== "conflict") throw new Error(`caseflow_artifact_apply_failed:${applied.reason}`);
        await ctx.db.patch(proposal._id, { status: "conflicted", decidedAt: now });
        await emit(ctx, scope, {
          runId: artifact.runId,
          aggregateType: "proposal",
          aggregateId: String(proposal._id),
          eventType: "proposal.conflicted",
          payload: { canonicalVersion: artifact.canonicalVersion, actual: applied.actual },
          occurredAt: now,
        });
      } else {
        await ctx.db.patch(artifact._id, { canonicalVersion: applied.version, updatedAt: now });
        await ctx.db.insert("nodekitCaseflowArtifactVersions", {
          artifactId: artifact._id,
          version: applied.version,
          content: proposal.patch,
          contentHash: proposal.patchHash,
          proposalId: proposal._id,
          createdAt: now,
        });
        await ctx.db.patch(proposal._id, { status: "accepted", decidedAt: now });
        await emit(ctx, scope, {
          runId: artifact.runId,
          aggregateType: "artifact",
          aggregateId: String(artifact._id),
          eventType: "artifact.version_created",
          payload: { proposalId: String(proposal._id), version: applied.version },
          occurredAt: now,
        });
        await emit(ctx, scope, {
          runId: artifact.runId,
          aggregateType: "proposal",
          aggregateId: String(proposal._id),
          eventType: "proposal.accepted",
          payload: { approvalId: String(approvalId) },
          occurredAt: now,
        });
      }
    } else {
      await ctx.db.patch(proposal._id, { status: "rejected", decidedAt: now });
      await emit(ctx, scope, {
        runId: artifact.runId,
        aggregateType: "proposal",
        aggregateId: String(proposal._id),
        eventType: "proposal.rejected",
        payload: { approvalId: String(approvalId) },
        occurredAt: now,
      });
    }

    const [updatedArtifact, updatedProposal] = await Promise.all([
      ctx.db.get(artifact._id),
      ctx.db.get(proposal._id),
    ]);
    if (!updatedArtifact || !updatedProposal) throw new Error("caseflow_decision_state_missing");
    return {
      approval: portableApproval(approval),
      artifact: await portableArtifact(ctx, updatedArtifact),
      proposal: portableProposal(updatedProposal),
      reused: false,
    };
  },
});

export const raiseException = mutation({
  args: {
    ...scopeArgs,
    runId: v.id("nodekitCaseflowRuns"),
    code: v.string(),
    message: v.string(),
    preservedState: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const run = await ownedRun(ctx, scope, args.runId);
    if (TERMINAL_RUN_STATUSES.has(run.status)) throw new Error(`caseflow_run_terminal:${run.status}`);
    const now = Date.now();
    const exceptionId = await ctx.db.insert("nodekitCaseflowExceptions", {
      roomId: scope.room._id,
      ownerMemberId: scope.member._id,
      runId: run._id,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.exception,
      code: requiredText(args.code, "exception_code", MAX_STAGE_TEXT_LENGTH),
      message: requiredText(args.message, "exception_message", MAX_EXCEPTION_TEXT_LENGTH),
      preservedState: args.preservedState ?? {},
      status: "open",
      raisedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: "blocked",
      nextAction: "Resolve exception",
      nextActionOwner: "user",
      updatedAt: now,
    });
    await emit(ctx, scope, {
      runId: run._id,
      aggregateType: "run",
      aggregateId: String(run._id),
      eventType: "exception.raised",
      payload: { code: args.code, exceptionId: String(exceptionId) },
      occurredAt: now,
    });
    const exception = await ctx.db.get(exceptionId);
    if (!exception) throw new Error("caseflow_exception_insert_failed");
    return portableException(exception);
  },
});

export const resolveException = mutation({
  args: {
    ...scopeArgs,
    exceptionId: v.id("nodekitCaseflowExceptions"),
    resolution: v.optional(v.string()),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const exception = await ownedException(ctx, scope, args.exceptionId);
    const run = await ownedRun(ctx, scope, exception.runId);
    if (exception.status === "resolved") {
      return { exception: portableException(exception), run: portableRun(run), reused: true };
    }
    const now = Date.now();
    const resolution = optionalText(args.resolution ?? "resolved", MAX_EXCEPTION_TEXT_LENGTH) || "resolved";
    const nextAction = optionalText(args.nextAction ?? "Continue run", MAX_STAGE_TEXT_LENGTH) || "Continue run";
    const nextActionOwner = optionalText(args.nextActionOwner ?? "system", MAX_STAGE_TEXT_LENGTH) || "system";
    await ctx.db.patch(exception._id, { status: "resolved", resolution, resolvedAt: now });
    await ctx.db.patch(run._id, { status: "active", nextAction, nextActionOwner, updatedAt: now });
    await emit(ctx, scope, {
      runId: run._id,
      aggregateType: "run",
      aggregateId: String(run._id),
      eventType: "exception.resolved",
      payload: { exceptionId: String(exception._id), resolution },
      occurredAt: now,
    });
    const [updatedException, updatedRun] = await Promise.all([
      ctx.db.get(exception._id),
      ctx.db.get(run._id),
    ]);
    if (!updatedException || !updatedRun) throw new Error("caseflow_exception_resolution_missing");
    return { exception: portableException(updatedException), run: portableRun(updatedRun), reused: false };
  },
});

export const completeRun = mutation({
  args: {
    ...scopeArgs,
    runId: v.id("nodekitCaseflowRuns"),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const run = await ownedRun(ctx, scope, args.runId);
    if (run.status === "completed") {
      const receipt = await ctx.db
        .query("nodekitCaseflowReceipts")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .unique();
      if (!receipt) throw new Error("caseflow_completed_run_missing_receipt");
      return { receipt: portableReceipt(receipt), run: portableRun(run), reused: true };
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) throw new Error(`caseflow_run_terminal:${run.status}`);
    const openException = await ctx.db
      .query("nodekitCaseflowExceptions")
      .withIndex("by_run_status", (q) => q.eq("runId", run._id).eq("status", "open"))
      .first();
    if (openException) throw new Error("caseflow_run_has_unresolved_exceptions");

    const caseRecord = await ownedCase(ctx, scope, run.caseId);
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: "completed",
      nextAction: "Review receipt",
      nextActionOwner: "user",
      stages: run.stages.map((stage) => ({ ...stage, status: "completed" as const })),
      updatedAt: now,
    });
    await ctx.db.patch(caseRecord._id, { status: "completed", updatedAt: now });
    await emit(ctx, scope, {
      runId: run._id,
      aggregateType: "run",
      aggregateId: String(run._id),
      eventType: "run.completed",
      payload: {},
      occurredAt: now,
    });

    const artifacts = await ctx.db
      .query("nodekitCaseflowArtifacts")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    const proposalGroups = await Promise.all(artifacts.map((artifact) =>
      ctx.db.query("nodekitCaseflowProposals")
        .withIndex("by_artifact", (q) => q.eq("artifactId", artifact._id))
        .collect()
    ));
    const events = await ctx.db
      .query("nodekitCaseflowEvents")
      .withIndex("by_run", (q) => q.eq("runId", run._id))
      .collect();
    const receiptBody = {
      applicationRefs: {
        nodeRoomArtifactIds: artifacts.map((artifact) => String(artifact.nodeRoomArtifactId)),
        /** Domain receipts stay application-owned; none are fabricated for generic conformance. */
        domainReceiptIds: [] as string[],
      },
      artifactIds: artifacts.map((artifact) => String(artifact._id)),
      caseId: String(caseRecord._id),
      eventIds: events.map((event) => String(event._id)),
      generatedAt: iso(now),
      proposalIds: proposalGroups.flat().map((proposal) => String(proposal._id)),
      runId: String(run._id),
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.receipt,
      status: "completed" as const,
    };
    const receiptId = await ctx.db.insert("nodekitCaseflowReceipts", {
      roomId: scope.room._id,
      ownerMemberId: scope.member._id,
      runId: run._id,
      schemaVersion: CASEFLOW_SCHEMA_VERSIONS.receipt,
      body: receiptBody,
      receiptHash: await contentHash(receiptBody),
      createdAt: now,
    });
    const receipt = await ctx.db.get(receiptId);
    if (!receipt) throw new Error("caseflow_receipt_insert_failed");
    await emit(ctx, scope, {
      runId: run._id,
      aggregateType: "run",
      aggregateId: String(run._id),
      eventType: "receipt.created",
      payload: { receiptId: String(receiptId), receiptHash: receipt.receiptHash },
      occurredAt: now,
    });
    const updatedRun = await ctx.db.get(run._id);
    if (!updatedRun) throw new Error("caseflow_run_missing_after_completion");
    return { receipt: portableReceipt(receipt), run: portableRun(updatedRun), reused: false };
  },
});

export const snapshot = query({
  args: scopeArgs,
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.roomId, args.requester);
    const [cases, runs, artifacts, proposals, exceptions, events, receipts] = await Promise.all([
      ctx.db.query("nodekitCaseflowCases")
        .withIndex("by_room_owner", (q) => q.eq("roomId", scope.room._id).eq("ownerMemberId", scope.member._id))
        .collect(),
      ctx.db.query("nodekitCaseflowRuns")
        .withIndex("by_room_owner", (q) => q.eq("roomId", scope.room._id).eq("ownerMemberId", scope.member._id))
        .collect(),
      ctx.db.query("nodekitCaseflowArtifacts")
        .withIndex("by_room_owner", (q) => q.eq("roomId", scope.room._id).eq("ownerMemberId", scope.member._id))
        .collect(),
      ctx.db.query("nodekitCaseflowProposals")
        .withIndex("by_room_owner", (q) => q.eq("roomId", scope.room._id).eq("ownerMemberId", scope.member._id))
        .collect(),
      ctx.db.query("nodekitCaseflowExceptions")
        .withIndex("by_room_owner", (q) => q.eq("roomId", scope.room._id).eq("ownerMemberId", scope.member._id))
        .collect(),
      ctx.db.query("nodekitCaseflowEvents")
        .withIndex("by_room_owner", (q) => q.eq("roomId", scope.room._id).eq("ownerMemberId", scope.member._id))
        .collect(),
      ctx.db.query("nodekitCaseflowReceipts")
        .withIndex("by_room_owner", (q) => q.eq("roomId", scope.room._id).eq("ownerMemberId", scope.member._id))
        .collect(),
    ]);
    const proposalIds = new Set(proposals.map((proposal) => String(proposal._id)));
    const approvalGroups = await Promise.all(proposals.map((proposal) =>
      ctx.db.query("nodekitCaseflowApprovals")
        .withIndex("by_proposal", (q) => q.eq("proposalId", proposal._id))
        .collect()
    ));
    return {
      approvals: approvalGroups.flat()
        .filter((approval) => proposalIds.has(String(approval.proposalId)))
        .map(portableApproval),
      artifacts: await Promise.all(artifacts.map((artifact) => portableArtifact(ctx, artifact))),
      cases: cases.map(portableCase),
      events: events.map(portableEvent),
      exceptions: exceptions.map(portableException),
      proposals: proposals.map(portableProposal),
      receipts: receipts.map(portableReceipt),
      runs: runs.map(portableRun),
    };
  },
});
