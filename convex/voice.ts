import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";

export const assertVoiceRequester = internalQuery({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    return { id: actor.id, name: actor.name };
  },
});
