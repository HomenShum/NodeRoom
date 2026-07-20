import type { Actor, Artifact, Member, Room } from "../../engine/types";
import {
  toNodeSlidePrincipalFromVerifiedActor,
  type NodeRoomNodeSlideMembershipRole,
  type NodeRoomNodeSlidePrincipal,
} from "./hostPrincipal";

export const NODEROOM_NODESLIDE_OPERATION_PROTOCOL = "operation-v1" as const;
export const NODEROOM_NODESLIDE_POLICY_VERSION = "1" as const;

export type NodeRoomNodeSlideRepositoryAction =
  | "deck.read"
  | "patch.apply"
  | "proposal.create"
  | "proposal.accept"
  | "proposal.reject"
  | "versions.list"
  | "receipt.store";

export type NodeRoomNodeSlideAuthorizationResource =
  | { kind: "deck"; id: string }
  | { kind: "patch"; id: string }
  | { kind: "proposal"; id: string }
  | { kind: "receipt"; id: string };

export interface NodeRoomNodeSlideOperationV1 {
  protocol: typeof NODEROOM_NODESLIDE_OPERATION_PROTOCOL;
  action: NodeRoomNodeSlideRepositoryAction;
  deckId: string;
  principal: NodeRoomNodeSlidePrincipal;
  resource: NodeRoomNodeSlideAuthorizationResource;
}

export interface NodeRoomNodeSlideAuthorizationEvidence {
  issuer: "noderoom";
  policyId: "noderoom.nodeslide.artifact-authority";
  policyVersion: typeof NODEROOM_NODESLIDE_POLICY_VERSION;
  evidenceId?: string;
}

export interface NodeRoomNodeSlideAuthorizationDecision {
  principal: NodeRoomNodeSlidePrincipal;
  membershipRole: NodeRoomNodeSlideMembershipRole;
  routePolicy: "member_read" | "member_proposal" | "host_write";
  writePolicy: "artifact_cas" | "artifact_cas_and_host_review";
  evidence: NodeRoomNodeSlideAuthorizationEvidence;
}

const READ_ACTIONS = new Set<NodeRoomNodeSlideRepositoryAction>([
  "deck.read",
  "versions.list",
]);
const PROPOSAL_ACTIONS = new Set<NodeRoomNodeSlideRepositoryAction>([
  "proposal.create",
]);
const HOST_WRITE_ACTIONS = new Set<NodeRoomNodeSlideRepositoryAction>([
  "patch.apply",
  "proposal.accept",
  "proposal.reject",
  "receipt.store",
]);

/**
 * Pure policy projection used by both the in-memory proof and the Convex host
 * wrapper. Authentication itself stays server-side: callers may invoke this
 * only with the actor returned by NodeRoom's existing ActorProof verifier.
 */
export function authorizeNodeRoomNodeSlideOperation(input: {
  operation: NodeRoomNodeSlideOperationV1;
  verifiedActor: Actor;
  member: Pick<Member, "id" | "name" | "role" | "roomId">;
  room: Pick<Room, "id" | "status" | "autoAllow">;
  artifact: Pick<Artifact, "id" | "roomId" | "visibility" | "createdBy" | "meta">;
  evidenceId?: string;
}): NodeRoomNodeSlideAuthorizationDecision {
  const { operation, verifiedActor, member, room, artifact } = input;
  if (operation.protocol !== NODEROOM_NODESLIDE_OPERATION_PROTOCOL) {
    throw new Error("nodeslide_operation_protocol_invalid");
  }
  if (verifiedActor.kind !== "user") throw new Error("nodeslide_user_actor_required");
  if (
    member.id !== verifiedActor.id ||
    member.name !== verifiedActor.name ||
    member.roomId !== room.id
  ) {
    throw new Error("nodeslide_membership_mismatch");
  }
  if (room.status !== "live") throw new Error("nodeslide_room_not_live");
  if (artifact.roomId !== room.id || artifact.id !== operation.deckId) {
    throw new Error("nodeslide_deck_scope_mismatch");
  }
  if (!artifact.meta?.tags?.includes("noderoom:deck")) {
    throw new Error("nodeslide_deck_artifact_required");
  }
  if (
    artifact.visibility === "private" &&
    (!artifact.createdBy || artifact.createdBy.kind !== "user" || artifact.createdBy.id !== verifiedActor.id)
  ) {
    throw new Error("nodeslide_artifact_not_visible");
  }

  const principal = toNodeSlidePrincipalFromVerifiedActor({
    actor: verifiedActor,
    membershipRole: member.role,
    hostAuthVerified: true,
    allowDeckWrites: member.role === "host",
  });
  if (operation.principal.userId !== principal.userId) {
    throw new Error("nodeslide_principal_actor_mismatch");
  }
  if (!sameStringSet(operation.principal.roles, principal.roles)) {
    throw new Error("nodeslide_principal_roles_untrusted");
  }
  if (!sameStringSet(operation.principal.permissions, principal.permissions)) {
    throw new Error("nodeslide_principal_permissions_untrusted");
  }
  assertResourceMatchesOperation(operation);

  let routePolicy: NodeRoomNodeSlideAuthorizationDecision["routePolicy"];
  let writePolicy: NodeRoomNodeSlideAuthorizationDecision["writePolicy"];
  if (READ_ACTIONS.has(operation.action)) {
    routePolicy = "member_read";
    writePolicy = "artifact_cas";
  } else if (PROPOSAL_ACTIONS.has(operation.action)) {
    routePolicy = "member_proposal";
    writePolicy = "artifact_cas_and_host_review";
  } else if (HOST_WRITE_ACTIONS.has(operation.action)) {
    if (member.role !== "host") throw new Error("nodeslide_host_required");
    routePolicy = "host_write";
    writePolicy = "artifact_cas_and_host_review";
  } else {
    throw new Error("nodeslide_action_forbidden");
  }

  return {
    principal,
    membershipRole: member.role,
    routePolicy,
    writePolicy,
    evidence: {
      issuer: "noderoom",
      policyId: "noderoom.nodeslide.artifact-authority",
      policyVersion: NODEROOM_NODESLIDE_POLICY_VERSION,
      ...(input.evidenceId ? { evidenceId: input.evidenceId } : {}),
    },
  };
}

export function nodeRoomNodeSlideOperation(input: {
  action: NodeRoomNodeSlideRepositoryAction;
  deckId: string;
  principal: NodeRoomNodeSlidePrincipal;
  resourceId?: string;
}): NodeRoomNodeSlideOperationV1 {
  return {
    protocol: NODEROOM_NODESLIDE_OPERATION_PROTOCOL,
    action: input.action,
    deckId: canonicalId(input.deckId, "deckId"),
    principal: input.principal,
    resource: resourceForAction(input.action, input.resourceId ?? input.deckId),
  };
}

export function assertCredentialFreeNodeSlideValue(value: unknown, path = "value"): void {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertCredentialFreeNodeSlideValue(entry, `${path}[${index}]`));
    return;
  }
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (/^(token|requester|actorProof|jwt|cookie|secret|authorizationHeader)$/i.test(key)) {
      throw new Error(`nodeslide_credential_field_forbidden:${path}.${key}`);
    }
    assertCredentialFreeNodeSlideValue(entry, `${path}.${key}`);
  }
}

function resourceForAction(
  action: NodeRoomNodeSlideRepositoryAction,
  id: string,
): NodeRoomNodeSlideAuthorizationResource {
  const canonical = canonicalId(id, "resourceId");
  if (action === "patch.apply") return { kind: "patch", id: canonical };
  if (action === "proposal.create" || action === "proposal.accept" || action === "proposal.reject") {
    return { kind: "proposal", id: canonical };
  }
  if (action === "receipt.store") return { kind: "receipt", id: canonical };
  return { kind: "deck", id: canonical };
}

function assertResourceMatchesOperation(operation: NodeRoomNodeSlideOperationV1): void {
  const expectedKind = resourceForAction(operation.action, operation.resource.id).kind;
  if (operation.resource.kind !== expectedKind) {
    throw new Error("nodeslide_authorization_resource_mismatch");
  }
  canonicalId(operation.resource.id, "resource.id");
  assertCredentialFreeNodeSlideValue(operation);
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function canonicalId(value: string, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`nodeslide_${label}_invalid`);
  }
  return value;
}
