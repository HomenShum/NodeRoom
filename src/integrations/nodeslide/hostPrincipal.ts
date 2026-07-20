import type { Actor } from "../../engine/types";

export type NodeRoomNodeSlideMembershipRole = "host" | "member";

export type NodeRoomNodeSlidePermission =
  | "nodeslide:read"
  | "nodeslide:propose"
  | "nodeslide:write";

/**
 * Structural subset of the portable NodeSlide principal contract.
 *
 * This intentionally does not import an unpublished NodeSlide package. The
 * package consumer proof checks the shape at runtime; a versioned package can
 * replace this structural seam once it is published or installed from a
 * pinned artifact.
 */
export interface NodeRoomNodeSlidePrincipal {
  userId: string;
  roles: readonly string[];
  permissions: readonly NodeRoomNodeSlidePermission[];
}

export interface VerifiedNodeRoomActorForNodeSlide {
  actor: Actor;
  membershipRole: NodeRoomNodeSlideMembershipRole;
  /**
   * Must be set only after NodeRoom has verified its existing ActorProof and
   * room membership. This adapter is normalization, not an auth replacement.
   */
  hostAuthVerified: true;
  allowDeckWrites?: boolean;
}

/**
 * Normalize a host-verified NodeRoom actor for a NodeSlide repository port.
 * NodeRoom remains the identity and authorization authority.
 */
export function toNodeSlidePrincipalFromVerifiedActor(
  input: VerifiedNodeRoomActorForNodeSlide,
): NodeRoomNodeSlidePrincipal {
  if (input.hostAuthVerified !== true) {
    throw new Error("NodeSlide principal normalization requires verified NodeRoom host auth.");
  }

  const actorRole =
    input.actor.kind === "agent"
      ? `noderoom:agent:${input.actor.scope ?? "public"}`
      : `noderoom:${input.membershipRole}`;
  const permissions: NodeRoomNodeSlidePermission[] = [
    "nodeslide:read",
    "nodeslide:propose",
  ];
  if (input.allowDeckWrites === true) permissions.push("nodeslide:write");

  return {
    userId: input.actor.id,
    roles: [actorRole],
    permissions,
  };
}
