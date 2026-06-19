import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";

export const roomExportManifest = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    const [room, members, artifacts, traces, sourceCaptures, evidenceFacts, agentArtifacts] = await Promise.all([
      ctx.db.get(roomId),
      ctx.db.query("members").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect(),
      ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect(),
      ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect(),
      ctx.db.query("sourceCaptures").withIndex("by_room_hash", (q) => q.eq("roomId", roomId)).collect(),
      ctx.db.query("evidenceFacts").withIndex("by_room_fact", (q) => q.eq("roomId", roomId)).collect(),
      collectAgentArtifacts(ctx, roomId),
    ]);
    if (!room) throw new Error("room_not_found");
    const messages = await collectRoomMessages(ctx, roomId, ["public", ...members.map((member) => String(member._id))]);
    return {
      policy: "privacy_export_manifest_v1",
      room: { id: room._id, code: room.code, title: room.title, status: room.status, createdAt: room.createdAt },
      counts: {
        members: members.length,
        artifacts: artifacts.length,
        messages: messages.length,
        traces: traces.length,
        sourceCaptures: sourceCaptures.length,
        evidenceFacts: evidenceFacts.length,
        agentArtifacts: agentArtifacts.length,
      },
      note: "This manifest inventories room-scoped data. Binary storage export and verified deletion remain operator-runbook work until the export/delete plan is fully implemented.",
    };
  },
});

export const requestRoomDeletion = mutation({
  args: { roomId: v.id("rooms"), requester: actorProofV, reason: v.optional(v.string()) },
  handler: async (ctx, { roomId, requester, reason }) => {
    const actor = await requireActorProof(ctx, roomId, requester);
    const member = await ctx.db.get(actor.id as Id<"members">);
    if (!member || member.role !== "host") throw new Error("host_required_for_deletion_request");
    const room = await ctx.db.get(roomId);
    if (!room) throw new Error("room_not_found");
    await ctx.db.patch(roomId, { status: "ended" });
    const traceId = await ctx.db.insert("traces", {
      roomId,
      ts: Date.now(),
      actor,
      type: "privacy:deletion_requested",
      summary: "Room deletion requested",
      detail: JSON.stringify({
        reason,
        status: "operator_runbook_required",
        scope: "room_scoped_product_data_and_storage",
      }),
    });
    return {
      ok: true,
      traceId,
      status: "operator_runbook_required",
      note: "The room is ended and the deletion request is auditable. Physical purge/export verification is deliberately not claimed by this mutation.",
    };
  },
});

async function collectAgentArtifacts(ctx: QueryCtx, roomId: Id<"rooms">) {
  const rows = await Promise.all((["private", "room", "public"] as const).map((visibility) =>
    ctx.db.query("agentArtifacts")
      .withIndex("by_room_visibility_updated", (q) => q.eq("roomId", roomId).eq("visibility", visibility))
      .collect(),
  ));
  return rows.flat();
}

async function collectRoomMessages(ctx: QueryCtx, roomId: Id<"rooms">, channels: string[]) {
  const rows = await Promise.all(channels.map((channel) =>
    ctx.db.query("messages")
      .withIndex("by_room_channel", (q) => q.eq("roomId", roomId).eq("channel", channel))
      .collect(),
  ));
  return rows.flat();
}
