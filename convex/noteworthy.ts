import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof } from "./lib";
import { enqueueRoomActivity, scanActivityRow } from "./roomActivity";

const sourceKindV = v.union(
  v.literal("node"),
  v.literal("element"),
  v.literal("artifact_element"),
  v.literal("artifact"),
  v.literal("upload"),
  v.literal("message"),
  v.literal("wiki_revision"),
);

const eventKindV = v.union(
  v.literal("content_committed"),
  v.literal("idle_after_typing"),
  v.literal("page_hidden"),
  v.literal("manual_save"),
  v.literal("artifact_imported"),
  v.literal("cell_committed"),
  v.literal("file_uploaded"),
  v.literal("manual_enqueue"),
);

const visibilityV = v.union(v.literal("private"), v.literal("room"), v.literal("public"));

/**
 * Compatibility wrapper for the older noteworthy API.
 *
 * The passive path now has one source of truth: roomActivityOutbox plus
 * roomActivity.scanActivityRow. Keep this mutation for existing callers, but
 * route all debounce, scan, job admission, and workflow handoff through the
 * unified roomActivity implementation.
 */
export const debounceActivityScan = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    sourceKind: sourceKindV,
    sourceId: v.string(),
    sourceVersion: v.number(),
    sourceHash: v.string(),
    visibility: visibilityV,
    ownerId: v.optional(v.string()),
    eventKind: eventKindV,
    debounceMs: v.optional(v.number()),
  },
  handler: async (ctx, a): Promise<{ outboxId: Id<"roomActivityOutbox">; dedupeKey: string; quietUntil: number }> => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    return enqueueRoomActivity(ctx, {
      roomId: a.roomId,
      sourceKind: a.sourceKind,
      sourceId: a.sourceId,
      sourceVersion: a.sourceVersion,
      sourceHash: a.sourceHash,
      eventKind: a.eventKind,
      actor,
      visibility: a.visibility,
      ownerId: a.ownerId,
      quietMs: a.debounceMs,
    });
  },
});

export const scanActivity = internalMutation({
  args: {
    roomId: v.id("rooms"),
    sourceKind: sourceKindV,
    sourceId: v.string(),
    expectedVersion: v.number(),
    expectedHash: v.string(),
  },
  handler: async (ctx, a) => {
    const rows = await ctx.db
      .query("roomActivityOutbox")
      .withIndex("by_room_source", (q) => q.eq("roomId", a.roomId).eq("sourceKind", a.sourceKind).eq("sourceId", a.sourceId))
      .order("desc")
      .take(25);
    if (!rows.length) return { ok: false, reason: "missing_outbox" };
    const row = rows.find((candidate) => candidate.sourceVersion === a.expectedVersion && candidate.sourceHash === a.expectedHash);
    if (!row) return { ok: false, reason: "superseded" };
    return scanActivityRow(ctx, row, Date.now());
  },
});

export const listRoomActivity = internalQuery({
  args: { roomId: v.id("rooms"), limit: v.optional(v.number()) },
  handler: async (ctx, a) => {
    return await ctx.db.query("roomActivityOutbox").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).order("desc").take(Math.max(1, Math.min(a.limit ?? 50, 200)));
  },
});
