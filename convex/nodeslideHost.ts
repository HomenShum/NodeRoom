import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalQuery, type QueryCtx } from "./_generated/server";
import { actorProofV, requireActorProof, requireArtifactInRoom } from "./lib";
import {
  nodeSlidePermissionsForMembership,
  toNodeSlidePrincipalFromVerifiedActor,
  type NodeRoomNodeSlidePermission,
} from "../src/integrations/nodeslide/hostPrincipal";

const nodeSlidePermissionV = v.union(
  v.literal("nodeslide:read"),
  v.literal("nodeslide:propose"),
  v.literal("nodeslide:write"),
);

type ActorProof = {
  actor: {
    kind: "user" | "agent";
    id: string;
    name: string;
    scope?: "public" | "private";
    ownerId?: string;
  };
  token?: string;
};

/**
 * Production NodeSlide host fence. Host wrapper queries/mutations call this in
 * their own Convex transaction before touching a deck repository. The client
 * can request a route, but cannot assert membership, roles, or write grants.
 */
export async function requireNodeSlideHostAuthorization(
  ctx: QueryCtx,
  args: {
    roomId: Id<"rooms">;
    requester: ActorProof;
    permission: NodeRoomNodeSlidePermission;
    artifactId?: Id<"artifacts">;
  },
) {
  const actor = await requireActorProof(ctx, args.roomId, args.requester);
  const member = await ctx.db.get(actor.id as Id<"members">);
  if (!member || String(member.roomId) !== String(args.roomId)) {
    throw new Error("actor_not_in_room");
  }
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

/** Server-only proof/debug surface; production wrappers import the fence above. */
export const authorize = internalQuery({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    permission: nodeSlidePermissionV,
    artifactId: v.optional(v.id("artifacts")),
  },
  handler: (ctx, args) => requireNodeSlideHostAuthorization(ctx, args),
});
