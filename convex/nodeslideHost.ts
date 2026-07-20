import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { applyCellEditCore, resolveProposalCore } from "./artifacts";
import { actorProofV, requireActorProof, requireArtifactInRoom, sha256Hex, type ActorValue } from "./lib";
import { enqueueRoomActivity } from "./roomActivity";
import type { Artifact } from "../src/engine/types";
import {
  assertCredentialFreeNodeSlideValue,
  authorizeNodeRoomNodeSlideOperation,
  nodeRoomNodeSlideOperation,
  type NodeRoomNodeSlideAuthorizationDecision,
  type NodeRoomNodeSlideRepositoryAction,
} from "../src/integrations/nodeslide/hostAuthorization";
import {
  nodeSlidePermissionsForMembership,
  toNodeSlidePrincipalFromVerifiedActor,
  type NodeRoomNodeSlidePermission,
} from "../src/integrations/nodeslide/hostPrincipal";
import {
  NodeRoomNodeSlideCasError,
  planNodeSlidePatchForNodeRoom,
  translateNodeRoomArtifactToNodeSlide,
  type NodeRoomNodeSlidePatchCommand,
} from "../src/integrations/nodeslide/storyboardTranslation";

type DbCtx = QueryCtx | MutationCtx;
type Requester = { actor: ActorValue; token?: string };

const mountedDeckArgs = {
  roomId: v.id("rooms"),
  artifactId: v.id("artifacts"),
  requester: actorProofV,
};

export const getMountedDeck = query({
  args: mountedDeckArgs,
  handler: async (ctx, args) => {
    const deck = await loadDeckArtifact(ctx, args.roomId, args.artifactId);
    const authorization = await authorizeOperation(ctx, {
      ...args,
      action: "deck.read",
      resourceId: String(args.artifactId),
    });
    const translated = translateNodeRoomArtifactToNodeSlide(deck);
    return {
      snapshot: translated.snapshot,
      translationReceipt: translated.receipt,
      authorization: authorizationReceipt(authorization, {
        action: "deck.read",
        deckId: String(args.artifactId),
        resource: { kind: "deck", id: String(args.artifactId) },
        authorizedAt: Date.now(),
      }),
    };
  },
});

export const applyMountedPatch = mutation({
  args: { ...mountedDeckArgs, patch: v.any() },
  handler: async (ctx, args) => {
    const patch = parsePatchCommand(args.patch);
    const deck = await loadDeckArtifact(ctx, args.roomId, args.artifactId);
    const authorization = await authorizeOperation(ctx, {
      ...args,
      action: "patch.apply",
      resourceId: patch.id,
      recordEvidence: true,
    });
    let mutation;
    try {
      mutation = planNodeSlidePatchForNodeRoom(deck, patch);
    } catch (error) {
      if (error instanceof NodeRoomNodeSlideCasError) {
        return { ok: false as const, reason: "conflict" as const, expected: error.expected, actual: error.actual };
      }
      throw error;
    }
    const result = await applyCellEditCore(ctx, {
      roomId: args.roomId,
      artifactId: args.artifactId,
      elementId: mutation.elementId,
      kind: mutation.kind,
      value: mutation.value,
      baseVersion: mutation.baseVersion,
      actor: authorization.actor,
    });
    if (!result.ok) return result;
    const updated = await loadDeckArtifact(ctx, args.roomId, args.artifactId);
    const translated = translateNodeRoomArtifactToNodeSlide(updated);
    const receipt = await storeOperationReceipt(ctx, {
      roomId: args.roomId,
      actor: authorization.actor,
      action: "patch.apply",
      operation: "patch.applied",
      deckId: String(args.artifactId),
      deckVersion: translated.snapshot.deck.version,
      resource: { kind: "patch", id: patch.id },
      patchId: patch.id,
      traceId: patch.traceId,
      authorization,
      attributes: {
        nodeRoomElementId: mutation.elementId,
        nodeSlideElementId: mutation.nodeSlideElementId,
        translationFingerprint: translated.receipt.fingerprint,
      },
    });
    return {
      ok: true as const,
      snapshot: translated.snapshot,
      translationReceipt: translated.receipt,
      affectedSlideIds: [mutation.slideId],
      affectedElementIds: [mutation.nodeSlideElementId],
      receipt,
    };
  },
});

export const createMountedProposal = mutation({
  args: { ...mountedDeckArgs, patch: v.any() },
  handler: async (ctx, args) => {
    const patch = parsePatchCommand(args.patch);
    const deck = await loadDeckArtifact(ctx, args.roomId, args.artifactId);
    const authorization = await authorizeOperation(ctx, {
      ...args,
      action: "proposal.create",
      resourceId: patch.id,
      recordEvidence: true,
    });
    const planned = planNodeSlidePatchForNodeRoom(deck, patch);
    const pending = await ctx.db
      .query("proposals")
      .withIndex("by_room_status", (q) => q.eq("roomId", args.roomId).eq("status", "pending"))
      .collect();
    const existing = pending.find((proposal) =>
      String(proposal.artifactId) === String(args.artifactId) &&
      proposal.author.kind === authorization.actor.kind &&
      proposal.author.id === authorization.actor.id &&
      sameProposalOp(proposal.op, {
        opId: patch.id,
        artifactId: String(args.artifactId),
        elementId: planned.elementId,
        kind: planned.kind,
        value: planned.value,
        baseVersion: planned.baseVersion,
      }));
    const proposalId = existing?._id ?? await ctx.db.insert("proposals", {
      roomId: args.roomId,
      artifactId: args.artifactId,
      op: {
        opId: patch.id,
        artifactId: String(args.artifactId),
        elementId: planned.elementId,
        kind: planned.kind,
        value: planned.value,
        baseVersion: planned.baseVersion,
      },
      author: authorization.actor,
      review: { kind: "agent_edit", reason: patch.summary, status: "needs_review" },
      status: "pending",
      createdAt: Date.now(),
    });
    await ctx.db.insert("traces", {
      roomId: args.roomId,
      ts: Date.now(),
      actor: authorization.actor,
      type: "edit_proposed",
      summary: `${authorization.actor.name} proposed a NodeSlide edit to ${planned.elementId}`,
      detail: `nodeslide proposal ${String(proposalId)} - patch ${patch.id} - base v${planned.baseVersion}`,
    });
    await enqueueDeckActivity(ctx, {
      roomId: args.roomId,
      artifactId: args.artifactId,
      elementId: planned.elementId,
      sourceVersion: planned.baseVersion,
      sourceHash: await sha256Hex(JSON.stringify(planned.value)),
      actor: authorization.actor,
    });
    const receipt = await storeOperationReceipt(ctx, {
      roomId: args.roomId,
      actor: authorization.actor,
      action: "proposal.create",
      operation: "proposal.created",
      deckId: String(args.artifactId),
      deckVersion: deck.version,
      resource: { kind: "proposal", id: String(proposalId) },
      patchId: patch.id,
      traceId: patch.traceId,
      authorization,
      attributes: { nodeRoomProposalId: String(proposalId), nodeRoomElementId: planned.elementId },
    });
    return { proposalId, receipt };
  },
});

export const resolveMountedProposal = mutation({
  args: {
    ...mountedDeckArgs,
    proposalId: v.id("proposals"),
    decision: v.union(v.literal("accept"), v.literal("reject")),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal || String(proposal.artifactId) !== String(args.artifactId)) {
      return { ok: false as const, reason: "not_found" as const };
    }
    const action = args.decision === "accept" ? "proposal.accept" as const : "proposal.reject" as const;
    const authorization = await authorizeOperation(ctx, {
      ...args,
      action,
      resourceId: String(args.proposalId),
      recordEvidence: true,
    });
    const result = await resolveProposalCore(ctx, {
      proposalId: args.proposalId,
      approve: args.decision === "accept",
      requester: args.requester,
    });
    if (!result.ok && result.reason !== "conflict") {
      return { ...result, status: "failed" as const };
    }
    const deck = await loadDeckArtifact(ctx, args.roomId, args.artifactId);
    const translated = translateNodeRoomArtifactToNodeSlide(deck);
    const stale = !result.ok && result.reason === "conflict";
    const operation = stale
      ? "proposal.stale"
      : args.decision === "accept" && result.ok
        ? "proposal.accepted"
        : "proposal.rejected";
    const receipt = await storeOperationReceipt(ctx, {
      roomId: args.roomId,
      actor: authorization.actor,
      action,
      operation,
      deckId: String(args.artifactId),
      deckVersion: deck.version,
      resource: { kind: "proposal", id: String(args.proposalId) },
      patchId: objectString(proposal.op, "opId"),
      authorization,
      attributes: { decision: args.decision, nodeRoomProposalId: String(args.proposalId) },
    });
    return {
      ...(result.ok ? { ok: true as const } : result),
      status: stale ? "stale" as const : args.decision === "accept" ? "accepted" as const : "rejected" as const,
      snapshot: translated.snapshot,
      translationReceipt: translated.receipt,
      receipt,
    };
  },
});

export const listMountedVersions = query({
  args: { ...mountedDeckArgs, limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const deck = await loadDeckArtifact(ctx, args.roomId, args.artifactId);
    const authorization = await authorizeOperation(ctx, {
      ...args,
      action: "versions.list",
      resourceId: String(args.artifactId),
    });
    const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 100), 500));
    const rows = await ctx.db
      .query("elementVersions")
      .withIndex("by_artifact_element", (q) => q.eq("artifactId", args.artifactId))
      .order("desc")
      .take(limit);
    const translated = translateNodeRoomArtifactToNodeSlide(deck);
    return {
      current: translated.snapshot,
      objectHistory: rows.map((row) => ({
        elementId: row.elementId,
        version: row.version,
        value: row.value,
        truncated: row.truncated,
        updatedBy: row.updatedBy,
        kind: row.kind,
        ts: row.ts,
      })),
      authorization: authorizationReceipt(authorization, {
        action: "versions.list",
        deckId: String(args.artifactId),
        resource: { kind: "deck", id: String(args.artifactId) },
        authorizedAt: Date.now(),
      }),
    };
  },
});

export const storeMountedReceipt = mutation({
  args: { ...mountedDeckArgs, receipt: v.any() },
  handler: async (ctx, args) => {
    const receipt = parseCustomReceipt(args.receipt, String(args.artifactId));
    const authorization = await authorizeOperation(ctx, {
      ...args,
      action: "receipt.store",
      resourceId: receipt.id,
      recordEvidence: true,
    });
    return storeOperationReceipt(ctx, {
      roomId: args.roomId,
      actor: authorization.actor,
      action: "receipt.store",
      operation: "custom",
      deckId: String(args.artifactId),
      deckVersion: receipt.deckVersion,
      resource: { kind: "receipt", id: receipt.id },
      patchId: receipt.patchId,
      traceId: receipt.traceId,
      authorization,
      attributes: receipt.attributes,
      receiptId: receipt.id,
      recordedAt: receipt.recordedAt,
    });
  },
});

async function authorizeOperation(
  ctx: DbCtx,
  args: {
    roomId: Id<"rooms">;
    artifactId: Id<"artifacts">;
    requester: Requester;
    action: NodeRoomNodeSlideRepositoryAction;
    resourceId: string;
    recordEvidence?: boolean;
  },
): Promise<NodeRoomNodeSlideAuthorizationDecision & { actor: ActorValue }> {
  const actor = await requireActorProof(ctx, args.roomId, args.requester);
  const [member, room, artifact] = await Promise.all([
    ctx.db.get(actor.id as Id<"members">),
    ctx.db.get(args.roomId),
    requireArtifactInRoom(ctx, args.roomId, args.artifactId),
  ]);
  if (!member || !room) throw new Error("nodeslide_host_context_missing");
  const principal = toNodeSlidePrincipalFromVerifiedActor({
    actor,
    membershipRole: member.role,
    hostAuthVerified: true,
    allowDeckWrites: member.role === "host",
  });
  const decision = authorizeNodeRoomNodeSlideOperation({
    operation: nodeRoomNodeSlideOperation({
      action: args.action,
      deckId: String(args.artifactId),
      principal,
      resourceId: args.resourceId,
    }),
    verifiedActor: actor,
    member: { id: String(member._id), name: member.name, role: member.role, roomId: String(member.roomId) },
    room: { id: String(room._id), status: room.status, autoAllow: room.autoAllow },
    artifact: artifactForPolicy(artifact),
  });
  if (!args.recordEvidence) return { ...decision, actor };
  const evidenceTraceId = await (ctx as MutationCtx).db.insert("traces", {
    roomId: args.roomId,
    ts: Date.now(),
    actor,
    type: "nodeslide_authorized",
    summary: `Authorized ${args.action} for ${artifact.title}`,
    detail: `operation-v1 - ${args.action} - ${args.resourceId} - ${decision.routePolicy} - ${decision.writePolicy}`,
  });
  return {
    ...decision,
    actor,
    evidence: { ...decision.evidence, evidenceId: String(evidenceTraceId) },
  };
}

async function loadDeckArtifact(
  ctx: DbCtx,
  roomId: Id<"rooms">,
  artifactId: Id<"artifacts">,
): Promise<Artifact> {
  const artifact = await requireArtifactInRoom(ctx, roomId, artifactId);
  const elements = await ctx.db
    .query("elements")
    .withIndex("by_artifact", (q) => q.eq("artifactId", artifactId))
    .collect();
  return {
    id: String(artifact._id),
    roomId: String(artifact.roomId),
    kind: artifact.kind,
    title: artifact.title,
    version: artifact.version,
    order: artifact.order,
    updatedAt: artifact.updatedAt,
    createdBy: artifact.createdBy,
    visibility: artifact.visibility,
    meta: artifact.meta,
    elements: Object.fromEntries(elements.map((element) => [element.elementId, {
      id: element.elementId,
      version: element.version,
      value: element.value,
      updatedAt: element.updatedAt,
      updatedBy: element.updatedBy,
    }])),
  };
}

function artifactForPolicy(artifact: Awaited<ReturnType<typeof requireArtifactInRoom>>) {
  return {
    id: String(artifact._id),
    roomId: String(artifact.roomId),
    visibility: artifact.visibility,
    createdBy: artifact.createdBy,
    meta: artifact.meta,
  };
}

async function storeOperationReceipt(
  ctx: MutationCtx,
  input: {
    roomId: Id<"rooms">;
    actor: ActorValue;
    action: NodeRoomNodeSlideRepositoryAction;
    operation: "patch.applied" | "proposal.created" | "proposal.accepted" | "proposal.rejected" | "proposal.stale" | "custom";
    deckId: string;
    deckVersion: number;
    resource: { kind: "deck" | "patch" | "proposal" | "receipt"; id: string };
    patchId?: string;
    traceId?: string;
    authorization: NodeRoomNodeSlideAuthorizationDecision;
    attributes: Record<string, string | number | boolean | null>;
    receiptId?: string;
    recordedAt?: number;
  },
) {
  const recordedAt = input.recordedAt ?? Date.now();
  // A caller may preserve an older producer timestamp on a custom receipt,
  // but host authorization is always a distinct, later server event.
  const authorizedAt = Math.max(Date.now(), recordedAt + 1);
  const receipt = {
    id: input.receiptId ?? `receipt:${input.operation}:${input.resource.id}:${input.deckVersion}`,
    deckId: input.deckId,
    deckVersion: input.deckVersion,
    ...(input.patchId ? { patchId: input.patchId } : {}),
    ...(input.traceId ? { traceId: input.traceId } : {}),
    recordedAt,
    operation: input.operation,
    attributes: input.attributes,
    principalId: input.authorization.principal.userId,
    authorization: authorizationReceipt(input.authorization, {
      action: input.action,
      deckId: input.deckId,
      resource: input.resource,
      authorizedAt,
    }),
  };
  assertCredentialFreeNodeSlideValue(receipt);
  const traceRowId = await ctx.db.insert("traces", {
    roomId: input.roomId,
    ts: recordedAt,
    actor: input.actor,
    type: "nodeslide_receipt",
    summary: `${input.operation} for ${input.deckId} at v${input.deckVersion}`,
    detail: JSON.stringify(receipt),
  });
  return { ...receipt, traceRowId: String(traceRowId) };
}

function authorizationReceipt(
  authorization: NodeRoomNodeSlideAuthorizationDecision,
  input: {
    action: NodeRoomNodeSlideRepositoryAction;
    deckId: string;
    resource: { kind: "deck" | "patch" | "proposal" | "receipt"; id: string };
    authorizedAt: number;
  },
) {
  return {
    schemaVersion: "nodeslide.authorization/v1" as const,
    id: `authorization:${input.action}:${input.resource.id}`,
    principalId: authorization.principal.userId,
    deckId: input.deckId,
    action: input.action,
    resource: input.resource,
    authorizedAt: input.authorizedAt,
    evidence: authorization.evidence,
  };
}

async function enqueueDeckActivity(
  ctx: MutationCtx,
  args: {
    roomId: Id<"rooms">;
    artifactId: Id<"artifacts">;
    elementId: string;
    sourceVersion: number;
    sourceHash: string;
    actor: ActorValue;
  },
) {
  try {
    await enqueueRoomActivity(ctx, {
      roomId: args.roomId,
      sourceKind: "artifact_element",
      sourceId: `${String(args.artifactId)}:${args.elementId}`,
      sourceVersion: args.sourceVersion,
      sourceHash: args.sourceHash,
      eventKind: "content_committed",
      actor: args.actor,
      visibility: "room",
    });
  } catch {
    // Activity enrichment is additive. The proposal and receipt remain durable
    // even if the passive scanner component is unavailable in a local harness.
  }
}

function parsePatchCommand(value: unknown): NodeRoomNodeSlidePatchCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("nodeslide_patch_invalid");
  const patch = value as Partial<NodeRoomNodeSlidePatchCommand>;
  const operation = patch.operations?.[0];
  if (
    typeof patch.id !== "string" ||
    typeof patch.deckId !== "string" ||
    !isVersion(patch.baseDeckVersion) ||
    !patch.scope ||
    patch.scope.deckId !== patch.deckId ||
    !Array.isArray(patch.operations) ||
    patch.operations.length !== 1 ||
    !operation ||
    operation.op !== "replace_text" ||
    typeof operation.slideId !== "string" ||
    typeof operation.elementId !== "string" ||
    typeof operation.text !== "string" ||
    (operation.sourceIds !== undefined &&
      (!Array.isArray(operation.sourceIds) || operation.sourceIds.some((id) => typeof id !== "string"))) ||
    typeof patch.summary !== "string" ||
    !patch.baseElementVersions ||
    !versionMapIsValid(patch.baseElementVersions) ||
    !patch.baseSlideVersions ||
    !versionMapIsValid(patch.baseSlideVersions)
  ) {
    throw new Error("nodeslide_patch_invalid");
  }
  assertCredentialFreeNodeSlideValue(value);
  return patch as NodeRoomNodeSlidePatchCommand;
}

function parseCustomReceipt(value: unknown, deckId: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("nodeslide_receipt_invalid");
  const receipt = value as Record<string, unknown>;
  if (
    typeof receipt.id !== "string" ||
    !receipt.id.startsWith("custom-receipt:") ||
    receipt.deckId !== deckId ||
    receipt.operation !== "custom" ||
    typeof receipt.deckVersion !== "number" ||
    typeof receipt.recordedAt !== "number" ||
    !receipt.attributes ||
    typeof receipt.attributes !== "object" ||
    Array.isArray(receipt.attributes)
  ) {
    throw new Error("nodeslide_receipt_invalid");
  }
  if (!Object.values(receipt.attributes).every(isReceiptAttribute)) {
    throw new Error("nodeslide_receipt_invalid");
  }
  assertCredentialFreeNodeSlideValue(value);
  return {
    id: receipt.id,
    deckVersion: receipt.deckVersion,
    recordedAt: receipt.recordedAt,
    patchId: typeof receipt.patchId === "string" ? receipt.patchId : undefined,
    traceId: typeof receipt.traceId === "string" ? receipt.traceId : undefined,
    attributes: receipt.attributes as Record<string, string | number | boolean | null>,
  };
}

function isVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function versionMapIsValid(value: object): boolean {
  return Object.values(value).every(isVersion);
}

function isReceiptAttribute(value: unknown): value is string | number | boolean | null {
  return value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
}

function sameProposalOp(left: unknown, right: Record<string, unknown>): boolean {
  if (!left || typeof left !== "object" || Array.isArray(left)) return false;
  const candidate = left as Record<string, unknown>;
  return candidate.artifactId === right.artifactId &&
    candidate.elementId === right.elementId &&
    candidate.kind === right.kind &&
    candidate.baseVersion === right.baseVersion &&
    stableJson(candidate.value) === stableJson(right.value);
}

function objectString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result = (value as Record<string, unknown>)[key];
  return typeof result === "string" ? result : undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const nodeSlidePermissionV = v.union(
  v.literal("nodeslide:read"),
  v.literal("nodeslide:propose"),
  v.literal("nodeslide:write"),
  v.literal("nodeslide:approve"),
  v.literal("nodeslide:export"),
);

/**
 * Compatibility fence retained for the existing server-side callers. New
 * operation-v1 wrappers above use the stricter action/resource policy.
 */
export async function requireNodeSlideHostAuthorization(
  ctx: QueryCtx,
  args: {
    roomId: Id<"rooms">;
    requester: Requester;
    permission: NodeRoomNodeSlidePermission;
    artifactId?: Id<"artifacts">;
  },
) {
  const actor = await requireActorProof(ctx, args.roomId, args.requester);
  const member = await ctx.db.get(actor.id as Id<"members">);
  if (!member || String(member.roomId) !== String(args.roomId)) throw new Error("actor_not_in_room");
  if (args.artifactId) await requireArtifactInRoom(ctx, args.roomId, args.artifactId);
  const permissions = nodeSlidePermissionsForMembership(member.role);
  if (!permissions.includes(args.permission)) throw new Error("nodeslide_route_forbidden");
  return {
    actor,
    membershipRole: member.role,
    principal: toNodeSlidePrincipalFromVerifiedActor({
      actor,
      membershipRole: member.role,
      hostAuthVerified: true,
      allowDeckWrites: member.role === "host",
    }),
  };
}

/** Server-only compatibility proof surface. */
export const authorize = internalQuery({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    permission: nodeSlidePermissionV,
    artifactId: v.optional(v.id("artifacts")),
  },
  handler: (ctx, args) => requireNodeSlideHostAuthorization(ctx, args),
});
