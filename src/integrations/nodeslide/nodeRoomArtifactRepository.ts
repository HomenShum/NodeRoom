import type { RoomEngine } from "../../engine/roomEngine";
import type { Actor, Member } from "../../engine/types";
import {
  assertCredentialFreeNodeSlideValue,
  authorizeNodeRoomNodeSlideOperation,
  nodeRoomNodeSlideOperation,
  type NodeRoomNodeSlideAuthorizationDecision,
} from "./hostAuthorization";
import type { NodeRoomNodeSlidePrincipal } from "./hostPrincipal";
import {
  NodeRoomNodeSlideCasError,
  planNodeSlidePatchForNodeRoom,
  translateNodeRoomArtifactToNodeSlide,
  type NodeRoomNodeSlidePatchCommand,
  type NodeRoomNodeSlideSnapshot,
  type NodeRoomNodeSlideTranslationReceipt,
} from "./storyboardTranslation";

export interface NodeRoomNodeSlideReceipt {
  id: string;
  deckId: string;
  deckVersion: number;
  patchId?: string;
  traceId?: string;
  recordedAt: number;
  operation:
    | "patch.applied"
    | "proposal.created"
    | "proposal.accepted"
    | "proposal.rejected"
    | "proposal.stale"
    | "custom";
  attributes: Record<string, string | number | boolean | null>;
  principalId: string;
  authorization: {
    schemaVersion: "nodeslide.authorization/v1";
    id: string;
    principalId: string;
    deckId: string;
    action: string;
    resource: { kind: string; id: string };
    authorizedAt: number;
    evidence: NodeRoomNodeSlideAuthorizationDecision["evidence"];
  };
}

export interface NodeRoomNodeSlidePatchResult {
  patch: NodeRoomNodeSlidePatchCommand & {
    status: "accepted";
    resultingDeckVersion: number;
    createdAt: number;
    updatedAt: number;
  };
  snapshot: NodeRoomNodeSlideSnapshot;
  affectedSlideIds: string[];
  affectedElementIds: string[];
  receipt: NodeRoomNodeSlideReceipt;
}

export type NodeRoomNodeSlideProposalResolution = {
  status: "accepted" | "rejected" | "stale";
  patch: NodeRoomNodeSlidePatchCommand & {
    status: "accepted" | "rejected" | "stale";
    createdAt: number;
    updatedAt: number;
  };
  snapshot: NodeRoomNodeSlideSnapshot;
  receipt: NodeRoomNodeSlideReceipt;
};

type StoredProposal = {
  command: NodeRoomNodeSlidePatchCommand;
  nodeRoomProposalId: string;
  createdAt: number;
};

/**
 * Memory-mode implementation of the production adapter contract. It is used
 * for deterministic parity proof; Convex uses the same pure authorization and
 * translation functions but persists through its existing tables.
 */
export class NodeRoomArtifactNodeSlideRepository {
  readonly descriptor = {
    adapter: "custom" as const,
    name: "NodeRoom artifact/CAS authority",
    invariants: {
      mutation_authority: "server" as const,
      version_cas: "server" as const,
      candidate_validation: "server" as const,
      trace_lineage: "server" as const,
      source_authorization: "server" as const,
      rollback: "server" as const,
    },
  };

  private readonly proposals = new Map<string, StoredProposal>();

  constructor(private readonly input: {
    engine: RoomEngine;
    roomId: string;
    actor: Actor;
    now?: () => number;
  }) {}

  async getDeck(args: { deckId: string; principal: NodeRoomNodeSlidePrincipal }): Promise<NodeRoomNodeSlideSnapshot | null> {
    const artifact = this.input.engine.getArtifact(args.deckId);
    if (!artifact) return null;
    this.authorize("deck.read", args.deckId, args.principal, args.deckId);
    return translateNodeRoomArtifactToNodeSlide(artifact).snapshot;
  }

  async applyPatch(args: {
    deckId: string;
    principal: NodeRoomNodeSlidePrincipal;
    patch: NodeRoomNodeSlidePatchCommand;
  }): Promise<NodeRoomNodeSlidePatchResult> {
    const artifact = this.requireArtifact(args.deckId);
    const authorization = this.authorize("patch.apply", args.deckId, args.principal, args.patch.id);
    const mutation = planNodeSlidePatchForNodeRoom(artifact, args.patch);
    const result = this.input.engine.applyEdit({
      roomId: this.input.roomId,
      actor: this.input.actor,
      op: {
        opId: args.patch.id,
        artifactId: args.deckId,
        elementId: mutation.elementId,
        kind: mutation.kind,
        value: mutation.value,
        baseVersion: mutation.baseVersion,
      },
    });
    if (!result.ok) {
      if (result.reason === "conflict") throw new NodeRoomNodeSlideCasError(result.expected, result.actual);
      throw new NodeRoomNodeSlideRepositoryError("invalid_state", result.reason);
    }
    const mounted = translateNodeRoomArtifactToNodeSlide(this.requireArtifact(args.deckId));
    const now = this.now();
    const receipt = this.receipt({
      operation: "patch.applied",
      action: "patch.apply",
      resource: { kind: "patch", id: args.patch.id },
      deckId: args.deckId,
      deckVersion: mounted.snapshot.deck.version,
      principal: args.principal,
      authorization,
      patchId: args.patch.id,
      traceId: args.patch.traceId,
      attributes: {
        nodeRoomElementId: mutation.elementId,
        nodeSlideElementId: mutation.nodeSlideElementId,
        translationFingerprint: mounted.receipt.fingerprint,
      },
      now,
    });
    this.recordReceipt(receipt);
    return {
      patch: { ...args.patch, status: "accepted", resultingDeckVersion: mounted.snapshot.deck.version, createdAt: now, updatedAt: now },
      snapshot: mounted.snapshot,
      affectedSlideIds: [mutation.slideId],
      affectedElementIds: [mutation.nodeSlideElementId],
      receipt,
    };
  }

  async createProposal(args: {
    deckId: string;
    principal: NodeRoomNodeSlidePrincipal;
    patch: NodeRoomNodeSlidePatchCommand;
  }): Promise<NodeRoomNodeSlidePatchCommand & { status: "ready"; createdAt: number; updatedAt: number }> {
    const artifact = this.requireArtifact(args.deckId);
    const authorization = this.authorize("proposal.create", args.deckId, args.principal, args.patch.id);
    const mutation = planNodeSlidePatchForNodeRoom(artifact, args.patch);
    const proposal = this.input.engine.createProposal({
      roomId: this.input.roomId,
      artifactId: args.deckId,
      author: this.input.actor,
      op: {
        opId: args.patch.id,
        artifactId: args.deckId,
        elementId: mutation.elementId,
        kind: mutation.kind,
        value: mutation.value,
        baseVersion: mutation.baseVersion,
      },
      review: { kind: "agent_edit", reason: args.patch.summary, status: "needs_review" },
    });
    const now = this.now();
    this.proposals.set(proposal.id, { command: args.patch, nodeRoomProposalId: proposal.id, createdAt: now });
    const receipt = this.receipt({
      operation: "proposal.created",
      action: "proposal.create",
      resource: { kind: "proposal", id: proposal.id },
      deckId: args.deckId,
      deckVersion: artifact.version,
      principal: args.principal,
      authorization,
      patchId: args.patch.id,
      traceId: args.patch.traceId,
      attributes: { nodeRoomProposalId: proposal.id, nodeRoomElementId: mutation.elementId },
      now,
    });
    this.recordReceipt(receipt);
    return { ...args.patch, id: proposal.id, status: "ready", createdAt: now, updatedAt: now };
  }

  async resolveProposal(args: {
    deckId: string;
    principal: NodeRoomNodeSlidePrincipal;
    proposalId: string;
    decision: "accept" | "reject";
  }): Promise<NodeRoomNodeSlideProposalResolution> {
    const stored = this.proposals.get(args.proposalId);
    if (!stored) throw new NodeRoomNodeSlideRepositoryError("not_found", "nodeslide_proposal_not_found");
    const action = args.decision === "accept" ? "proposal.accept" : "proposal.reject";
    const authorization = this.authorize(action, args.deckId, args.principal, args.proposalId);
    const existing = this.input.engine.getProposal(stored.nodeRoomProposalId);
    if (!existing) throw new NodeRoomNodeSlideRepositoryError("not_found", "nodeslide_proposal_not_found");
    const now = this.now();
    let status: NodeRoomNodeSlideProposalResolution["status"];
    if (existing.status === "approved") status = "accepted";
    else if (existing.status === "rejected") status = "rejected";
    else {
      const result = this.input.engine.resolveProposal(
        stored.nodeRoomProposalId,
        args.decision === "accept",
        this.input.actor,
      );
      if (args.decision === "reject") status = "rejected";
      else if (result?.ok) status = "accepted";
      else if (result?.reason === "conflict") status = "stale";
      else throw new NodeRoomNodeSlideRepositoryError("invalid_state", result?.reason ?? "proposal_resolution_failed");
    }
    const mounted = translateNodeRoomArtifactToNodeSlide(this.requireArtifact(args.deckId));
    const receipt = this.receipt({
      operation: status === "accepted" ? "proposal.accepted" : status === "rejected" ? "proposal.rejected" : "proposal.stale",
      action,
      resource: { kind: "proposal", id: args.proposalId },
      deckId: args.deckId,
      deckVersion: mounted.snapshot.deck.version,
      principal: args.principal,
      authorization,
      patchId: stored.command.id,
      traceId: stored.command.traceId,
      attributes: { nodeRoomProposalId: stored.nodeRoomProposalId, decision: args.decision },
      now,
    });
    this.recordReceipt(receipt);
    return {
      status,
      patch: { ...stored.command, status, createdAt: stored.createdAt, updatedAt: now },
      snapshot: mounted.snapshot,
      receipt,
    };
  }

  async listVersions(args: {
    deckId: string;
    principal: NodeRoomNodeSlidePrincipal;
    limit?: number;
  }): Promise<Array<{ id: string; deckId: string; version: number; label: string; source: "system"; snapshot: NodeRoomNodeSlideSnapshot; createdAt: number }>> {
    this.authorize("versions.list", args.deckId, args.principal, args.deckId);
    const mounted = translateNodeRoomArtifactToNodeSlide(this.requireArtifact(args.deckId));
    return [{
      id: `noderoom-version:${args.deckId}:${mounted.snapshot.deck.version}`,
      deckId: args.deckId,
      version: mounted.snapshot.deck.version,
      label: "Current NodeRoom artifact snapshot (memory history is not persisted)",
      source: "system" as const,
      snapshot: mounted.snapshot,
      createdAt: mounted.snapshot.deck.updatedAt,
    }].slice(0, args.limit ?? 1);
  }

  async storeReceipt(args: {
    deckId: string;
    principal: NodeRoomNodeSlidePrincipal;
    receipt: {
      id: `custom-receipt:${string}`;
      operation: "custom";
      deckId: string;
      deckVersion: number;
      patchId?: string;
      traceId?: string;
      recordedAt: number;
      attributes: Record<string, string | number | boolean | null>;
    };
  }): Promise<NodeRoomNodeSlideReceipt> {
    if (args.receipt.deckId !== args.deckId) throw new NodeRoomNodeSlideRepositoryError("invalid_state", "receipt_deck_mismatch");
    assertCredentialFreeNodeSlideValue(args.receipt);
    const authorization = this.authorize("receipt.store", args.deckId, args.principal, args.receipt.id);
    const receipt = this.receipt({
      operation: "custom",
      action: "receipt.store",
      resource: { kind: "receipt", id: args.receipt.id },
      deckId: args.deckId,
      deckVersion: args.receipt.deckVersion,
      principal: args.principal,
      authorization,
      patchId: args.receipt.patchId,
      traceId: args.receipt.traceId,
      attributes: args.receipt.attributes,
      now: args.receipt.recordedAt,
      id: args.receipt.id,
    });
    this.recordReceipt(receipt);
    return receipt;
  }

  translationReceipt(deckId: string): NodeRoomNodeSlideTranslationReceipt {
    return translateNodeRoomArtifactToNodeSlide(this.requireArtifact(deckId)).receipt;
  }

  private authorize(
    action: Parameters<typeof nodeRoomNodeSlideOperation>[0]["action"],
    deckId: string,
    principal: NodeRoomNodeSlidePrincipal,
    resourceId: string,
  ): NodeRoomNodeSlideAuthorizationDecision {
    const room = this.input.engine.getRoom(this.input.roomId);
    const artifact = this.input.engine.getArtifact(deckId);
    const member = this.input.engine.listMembers(this.input.roomId).find((candidate) => candidate.id === this.input.actor.id);
    if (!room || !artifact || !member) throw new NodeRoomNodeSlideRepositoryError("forbidden", "nodeslide_host_context_missing");
    return authorizeNodeRoomNodeSlideOperation({
      operation: nodeRoomNodeSlideOperation({ action, deckId, principal, resourceId }),
      verifiedActor: this.input.actor,
      member,
      room,
      artifact,
    });
  }

  private requireArtifact(deckId: string) {
    const artifact = this.input.engine.getArtifact(deckId);
    if (!artifact || artifact.roomId !== this.input.roomId) {
      throw new NodeRoomNodeSlideRepositoryError("not_found", "nodeslide_deck_not_found");
    }
    return artifact;
  }

  private receipt(input: {
    operation: NodeRoomNodeSlideReceipt["operation"];
    action: string;
    resource: { kind: string; id: string };
    deckId: string;
    deckVersion: number;
    principal: NodeRoomNodeSlidePrincipal;
    authorization: NodeRoomNodeSlideAuthorizationDecision;
    patchId?: string;
    traceId?: string;
    attributes: Record<string, string | number | boolean | null>;
    now: number;
    id?: string;
  }): NodeRoomNodeSlideReceipt {
    return {
      id: input.id ?? `receipt:${input.operation}:${input.resource.id}:${input.deckVersion}`,
      deckId: input.deckId,
      deckVersion: input.deckVersion,
      ...(input.patchId ? { patchId: input.patchId } : {}),
      ...(input.traceId ? { traceId: input.traceId } : {}),
      recordedAt: input.now,
      operation: input.operation,
      attributes: input.attributes,
      principalId: input.principal.userId,
      authorization: {
        schemaVersion: "nodeslide.authorization/v1",
        id: `authorization:${input.action}:${input.resource.id}`,
        principalId: input.principal.userId,
        deckId: input.deckId,
        action: input.action,
        resource: input.resource,
        authorizedAt: input.now,
        evidence: input.authorization.evidence,
      },
    };
  }

  private recordReceipt(receipt: NodeRoomNodeSlideReceipt): void {
    assertCredentialFreeNodeSlideValue(receipt);
    this.input.engine.recordTrace(
      this.input.roomId,
      this.input.actor,
      "nodeslide_receipt",
      `${receipt.operation} for ${receipt.deckId} at v${receipt.deckVersion}`,
      { artifactId: receipt.deckId, receiptId: receipt.id, patchId: receipt.patchId ?? "" },
      JSON.stringify(receipt),
    );
  }

  private now(): number {
    return this.input.now?.() ?? Date.now();
  }
}

export class NodeRoomNodeSlideRepositoryError extends Error {
  constructor(
    readonly code: "not_found" | "conflict" | "forbidden" | "invalid_state",
    message: string,
  ) {
    super(message);
    this.name = "NodeRoomNodeSlideRepositoryError";
  }
}

export function nodeRoomNodeSlidePrincipalForMember(member: Member): NodeRoomNodeSlidePrincipal {
  const permissions = member.role === "host"
    ? ["nodeslide:read", "nodeslide:propose", "nodeslide:write", "nodeslide:approve", "nodeslide:export"] as const
    : ["nodeslide:read", "nodeslide:propose", "nodeslide:export"] as const;
  return {
    userId: member.id,
    roles: [`noderoom:${member.role}`],
    permissions,
  };
}
