import { v } from "convex/values";
import { Debouncer } from "@ikhrustalev/convex-debouncer";
import type { DebouncerComponentApi } from "@ikhrustalev/convex-debouncer";
import { components, internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof, type ActorValue } from "./lib";

const DEFAULT_QUIET_MS = 12_000;
const MAX_QUIET_MS = 60_000;

const sourceKindV = v.union(v.literal("node"), v.literal("element"), v.literal("artifact_element"), v.literal("artifact"), v.literal("upload"), v.literal("message"), v.literal("wiki_revision"));
const eventKindV = v.union(
  v.literal("idle_after_typing"),
  v.literal("cell_committed"),
  v.literal("file_uploaded"),
  v.literal("manual_enqueue"),
  v.literal("content_committed"),
  v.literal("page_hidden"),
  v.literal("manual_save"),
  v.literal("artifact_imported"),
);
const visibilityV = v.union(v.literal("private"), v.literal("room"), v.literal("public"));

// The package runtime exports lib.schedule/status/cancel, but v0.1.2 publishes a stale generated
// ComponentApi type. Cast to the client API until the package republishes corrected generated types.
const roomActivityDebouncer = new Debouncer(components.debouncer as unknown as DebouncerComponentApi, {
  delay: DEFAULT_QUIET_MS,
  mode: "sliding",
});

function clampQuietMs(value: number | undefined): number {
  if (!Number.isFinite(value ?? DEFAULT_QUIET_MS)) return DEFAULT_QUIET_MS;
  return Math.max(1_000, Math.min(value ?? DEFAULT_QUIET_MS, MAX_QUIET_MS));
}

export function activityDedupeKey(args: {
  roomId: Id<"rooms">;
  sourceKind: "node" | "element" | "artifact_element" | "artifact" | "upload" | "message" | "wiki_revision";
  sourceId: string;
  eventKind: "idle_after_typing" | "cell_committed" | "file_uploaded" | "manual_enqueue" | "content_committed" | "page_hidden" | "manual_save" | "artifact_imported";
  ownerId?: string;
}) {
  return [
    "activity",
    String(args.roomId),
    args.sourceKind,
    args.sourceId,
    args.eventKind,
    args.ownerId ?? "room",
  ].join(":");
}

export async function enqueueRoomActivity(ctx: MutationCtx, args: {
  roomId: Id<"rooms">;
  sourceKind: "node" | "element" | "artifact_element" | "artifact" | "upload" | "message" | "wiki_revision";
  sourceId: string;
  sourceVersion?: number;
  sourceHash: string;
  eventKind: "idle_after_typing" | "cell_committed" | "file_uploaded" | "manual_enqueue" | "content_committed" | "page_hidden" | "manual_save" | "artifact_imported";
  actor?: ActorValue;
  visibility?: "private" | "room" | "public";
  ownerId?: string;
  quietMs?: number;
}) {
  const now = Date.now();
  const quietMs = clampQuietMs(args.quietMs);
  const dedupeKey = activityDedupeKey(args);
  const existing = await ctx.db.query("roomActivityOutbox").withIndex("by_dedupe", (q) => q.eq("dedupeKey", dedupeKey)).order("desc").first();
  const patch = {
    roomId: args.roomId,
    sourceKind: args.sourceKind,
    sourceId: args.sourceId,
    sourceVersion: args.sourceVersion,
    sourceHash: args.sourceHash,
    eventKind: args.eventKind,
    status: "queued" as const,
    actor: args.actor,
    visibility: args.visibility ?? "room" as const,
    ownerId: args.ownerId,
    dedupeKey,
    quietUntil: now + quietMs,
    updatedAt: now,
  };
  const rowId = existing && (existing.status === "queued" || existing.status === "running")
    ? (await ctx.db.patch(existing._id, patch), existing._id)
    : await ctx.db.insert("roomActivityOutbox", {
        ...patch,
        attempts: 0,
        createdAt: now,
      });

  await roomActivityDebouncer.schedule(
    ctx,
    "room-activity",
    dedupeKey,
    internal.roomActivity.scanDueActivity,
    { roomId: args.roomId, limit: 20 },
    { delay: quietMs, mode: "sliding" },
  );
  return { outboxId: rowId, dedupeKey, quietUntil: now + quietMs };
}

export const enqueueManual = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    sourceKind: sourceKindV,
    sourceId: v.string(),
    sourceVersion: v.optional(v.number()),
    sourceHash: v.string(),
    eventKind: v.optional(eventKindV),
    visibility: v.optional(visibilityV),
    ownerId: v.optional(v.string()),
    quietMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorProof(ctx, args.roomId, args.requester);
    return enqueueRoomActivity(ctx, { ...args, actor, eventKind: args.eventKind ?? "manual_enqueue" });
  },
});

export const scanDueActivity = internalMutation({
  args: { roomId: v.id("rooms"), limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, limit }) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("roomActivityOutbox")
      .withIndex("by_status_quietUntil", (q) => q.eq("status", "queued").lte("quietUntil", now))
      .take(Math.max(1, Math.min(limit ?? 20, 50)));
    let scanned = 0;
    for (const row of rows.filter((r) => String(r.roomId) === String(roomId))) {
      scanned++;
      const decision = classifyActivity(row);
      await ctx.db.patch(row._id, {
        status: decision.status,
        attempts: row.attempts + 1,
        decision,
        updatedAt: now,
        lastScannedAt: now,
      });
    }
    return { scanned };
  },
});

export const listRecent = query({
  args: { roomId: v.id("rooms"), requester: actorProofV, limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, requester, limit }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.query("roomActivityOutbox")
      .withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "queued"))
      .order("desc")
      .take(Math.max(1, Math.min(limit ?? 20, 50)));
  },
});

function classifyActivity(row: {
  sourceKind: "node" | "element" | "artifact_element" | "artifact" | "upload" | "message" | "wiki_revision";
  eventKind: "idle_after_typing" | "cell_committed" | "file_uploaded" | "manual_enqueue" | "content_committed" | "page_hidden" | "manual_save" | "artifact_imported";
  sourceHash: string;
}) {
  if (!row.sourceHash || row.sourceHash === "empty") {
    return { status: "ignored" as const, action: "ignore", reason: "empty_source" };
  }
  if (row.eventKind === "file_uploaded" || row.sourceKind === "upload") {
    return { status: "completed" as const, action: "index_file", next: "file_processing_job" };
  }
  if (row.eventKind === "cell_committed" || row.sourceKind === "element" || row.sourceKind === "artifact_element") {
    return { status: "completed" as const, action: "consider_room_work", next: "cache_first_noteworthiness" };
  }
  return { status: "completed" as const, action: "index_only", next: "okf_backlinks" };
}
