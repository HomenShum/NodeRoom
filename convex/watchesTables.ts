/**
 * Watch + notification TABLE DEFINITIONS — standalone this wave.
 *
 * convex/schema.ts is owned by another agent this wave, so these tables live
 * here as exported defineTable values. They are inert until the integrator
 * applies the exact schema.ts diff in docs/design/WATCHES_SCHEMA_SNIPPET.md
 * (which also stages the full convex/watches.ts function code).
 *
 * Design contract: "Notifications: instant (mentions, watched rows) /
 * hourly (run digests) / daily (rest); watch = W/swipe".
 *
 * Tier / dedupe / eviction policy is single-sourced in the pure module
 * src/notifications/tiers.ts (convex files already import from ../src —
 * see convex/agent.ts).
 */
import { defineTable } from "convex/server";
import { v } from "convex/values";

export const watchTargetKindV = v.union(v.literal("row"), v.literal("artifact"));

export const notificationKindV = v.union(
  v.literal("mention"),
  v.literal("watched_write"),
  v.literal("run_digest"),
);

export const notificationTierV = v.union(
  v.literal("instant"),
  v.literal("hourly"),
  v.literal("daily"),
);

/**
 * One row per (room, member, targetKind, targetId). setWatch is idempotent:
 * toggling keeps the row and flips `on` (audit-friendly, no insert/delete
 * churn). BOUND: WATCHES_MAX_PER_MEMBER (src/notifications/tiers.ts) caps
 * rows per member per room; setWatch throws watch_limit_reached above it.
 */
export const watchesTable = defineTable({
  roomId: v.id("rooms"),
  /** String(member._id) — matches requireActorProof's returned actor id. */
  memberId: v.string(),
  targetKind: watchTargetKindV,
  /** Row id within the artifact (targetKind "row") or String(artifact._id) (targetKind "artifact"). */
  targetId: v.string(),
  on: v.boolean(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_room_member", ["roomId", "memberId"])
  .index("by_room_target", ["roomId", "targetKind", "targetId"]);

/**
 * Notifiable events, fan-out-on-read: stored once per (dedupeKey, digest
 * window); recipients are resolved at query time (mention → recipientId,
 * watched_write → the reader's own watches, run_digest → room-wide).
 * BOUND: NOTIFICATIONS_MAX_PER_ROOM with oldest-read-first eviction
 * (capNotifications) on every insert, so the table never accumulates.
 */
export const notificationEventsTable = defineTable({
  roomId: v.id("rooms"),
  kind: notificationKindV,
  /** Computed server-side via tierFor(kind, isWatchedTarget, isMention) — never client-supplied. */
  tier: notificationTierV,
  actorId: v.optional(v.string()),
  targetKind: v.optional(watchTargetKindV),
  targetId: v.optional(v.string()),
  /** Mention recipient: String(member._id). Unset for watched_write / run_digest. */
  recipientId: v.optional(v.string()),
  /** Caller dedupe key + digest window suffix (see recordNotifiable in the snippet doc). */
  dedupeKey: v.string(),
  /** Digest bucket key ("hourly:…" / "daily:…") for non-instant tiers. */
  windowKey: v.optional(v.string()),
  payload: v.optional(v.record(v.string(), v.string())),
  /** Dedupe collapse counter — how many raw notifiables this row absorbed. */
  count: v.number(),
  readAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index("by_room_created", ["roomId", "createdAt"])
  .index("by_room_dedupe", ["roomId", "dedupeKey"]);
