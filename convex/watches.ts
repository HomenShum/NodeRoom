/**
 * Watch + notifications backend.
 *
 * Design: "Notifications: instant (mentions, watched rows) / hourly (run
 * digests) / daily (rest); watch = W/swipe".
 *
 * Policy (tiers, dedupe keys, eviction) is single-sourced in the PURE module
 * src/notifications/tiers.ts so the client groups notifications with the exact
 * same rules the server used to record them.
 *
 * Storage model: fan-out-on-READ. recordNotifiable stores each notifiable ONCE
 * per (dedupeKey, digest window); listNotifications resolves recipients at
 * query time (mention → recipientId, watched_write → the reader's own watches,
 * run_digest → room-wide). No per-recipient row explosion. The tradeoff is
 * honest and documented: readAt lives on the shared event row, so for
 * room-wide kinds (run_digest) "read" is a room-level state, while mention
 * rows are only ever visible to their one recipient (effectively per-person).
 *
 * Reliability: BOUND (WATCHES_MAX_PER_MEMBER, NOTIFICATIONS_MAX_PER_ROOM +
 * oldest-read-first eviction, every scan behind .take()), HONEST_STATUS
 * (watch_limit_reached throws instead of silently dropping; recordNotifiable
 * reports deduped:true instead of pretending a fresh insert), DETERMINISTIC
 * (dedupeKeyFor sorted+escaped keys).
 *
 * Staged in docs/design/WATCHES_SCHEMA_SNIPPET.md (wave 1); applied wave 2
 * with one addition: markNotificationsRead (the snippet's "wave-2 markRead").
 */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";
import { notificationKindV, watchTargetKindV } from "./watchesTables";
import {
  NOTIFICATIONS_EVICT_BATCH,
  NOTIFICATIONS_MAX_PER_ROOM,
  NOTIFICATIONS_PAGE,
  WATCHES_MAX_PER_MEMBER,
  capNotifications,
  dedupeKeyFor,
  digestWindows,
  tierFor,
} from "../src/notifications/tiers";

/** Idempotent watch toggle (W key / swipe). Same input twice → changed:false. */
export const setWatch = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    targetKind: watchTargetKindV,
    targetId: v.string(),
    on: v.boolean(),
  },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const now = Date.now();
    const existing = await ctx.db
      .query("watches")
      .withIndex("by_room_member", (q) => q.eq("roomId", a.roomId).eq("memberId", actor.id))
      .filter((q) =>
        q.and(q.eq(q.field("targetKind"), a.targetKind), q.eq(q.field("targetId"), a.targetId)),
      )
      .unique();
    if (existing) {
      if (existing.on === a.on) return { on: a.on, changed: false }; // idempotent
      await ctx.db.patch(existing._id, { on: a.on, updatedAt: now });
      return { on: a.on, changed: true };
    }
    if (!a.on) return { on: false, changed: false }; // un-watching something never watched: no-op
    // BOUND: cap watch rows per member per room. Reuse the stalest OFF row's
    // slot when full; if every row is an active watch, fail honestly.
    const mine = await ctx.db
      .query("watches")
      .withIndex("by_room_member", (q) => q.eq("roomId", a.roomId).eq("memberId", actor.id))
      .take(WATCHES_MAX_PER_MEMBER);
    if (mine.length >= WATCHES_MAX_PER_MEMBER) {
      const reusable = mine
        .filter((w) => !w.on)
        .sort((x, y) => x.updatedAt - y.updatedAt)[0];
      if (!reusable) throw new Error("watch_limit_reached"); // HONEST_STATUS
      await ctx.db.delete(reusable._id);
    }
    await ctx.db.insert("watches", {
      roomId: a.roomId,
      memberId: actor.id,
      targetKind: a.targetKind,
      targetId: a.targetId,
      on: true,
      createdAt: now,
      updatedAt: now,
    });
    return { on: true, changed: true };
  },
});

/** Requester's ACTIVE watches in this room (drives W-key state + swipe affordance). */
export const listWatches = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const rows = await ctx.db
      .query("watches")
      .withIndex("by_room_member", (q) => q.eq("roomId", a.roomId).eq("memberId", actor.id))
      .take(WATCHES_MAX_PER_MEMBER);
    return rows
      .filter((w) => w.on)
      .map((w) => ({ targetKind: w.targetKind, targetId: w.targetId, updatedAt: w.updatedAt }));
  },
});

/**
 * Record one notifiable event (server-side writers only — mention parser,
 * artifact write path, agent-run completion). Tier is COMPUTED here via
 * tierFor(kind, isWatchedTarget, isMention); clients never supply it.
 *
 * Dedupe: caller passes a deterministic dedupeKey (build it with
 * dedupeKeyFor(...) — e.g. mentions key on {roomId, kind, from, to} so a spam
 * burst collapses into ONE row whose count grows). For digest tiers the
 * current UTC window key is appended, so per-run spam collapses into one row
 * per window and a new hour/day re-opens the bucket. A deduped repeat clears
 * readAt so real new activity re-surfaces.
 */
export const recordNotifiable = internalMutation({
  args: {
    roomId: v.id("rooms"),
    kind: notificationKindV,
    actorId: v.optional(v.string()),
    targetKind: v.optional(watchTargetKindV),
    targetId: v.optional(v.string()),
    /** Mention recipient: String(member._id). Required when kind === "mention". */
    recipientId: v.optional(v.string()),
    dedupeKey: v.string(),
    payload: v.optional(v.record(v.string(), v.string())),
  },
  handler: async (ctx, a) => {
    if (a.kind === "mention" && !a.recipientId) throw new Error("mention_requires_recipient");
    const now = Date.now();
    // Does ANY member actively watch this target? (drives instant tier)
    let isWatchedTarget = false;
    const tk = a.targetKind;
    const tid = a.targetId;
    if (tk && tid) {
      const watch = await ctx.db
        .query("watches")
        .withIndex("by_room_target", (q) =>
          q.eq("roomId", a.roomId).eq("targetKind", tk).eq("targetId", tid),
        )
        .filter((q) => q.eq(q.field("on"), true))
        .first();
      isWatchedTarget = watch !== null;
    }
    const tier = tierFor(a.kind, isWatchedTarget, a.kind === "mention");
    const windows = digestWindows(now);
    const windowKey =
      tier === "hourly" ? windows.hourlyKey : tier === "daily" ? windows.dailyKey : undefined;
    const dedupeKey = windowKey
      ? dedupeKeyFor({ base: a.dedupeKey, window: windowKey })
      : a.dedupeKey;
    // BOUND dedupe probe: exact-match index, .take(1).
    const dupes = await ctx.db
      .query("notificationEvents")
      .withIndex("by_room_dedupe", (q) => q.eq("roomId", a.roomId).eq("dedupeKey", dedupeKey))
      .take(1);
    const dupe = dupes[0];
    if (dupe) {
      await ctx.db.patch(dupe._id, {
        count: dupe.count + 1,
        updatedAt: now,
        payload: a.payload ?? dupe.payload,
        readAt: undefined, // repeat activity re-surfaces as unread
      });
      return { deduped: true, tier, windowKey, id: dupe._id };
    }
    const id = await ctx.db.insert("notificationEvents", {
      roomId: a.roomId,
      kind: a.kind,
      tier,
      actorId: a.actorId,
      targetKind: a.targetKind,
      targetId: a.targetId,
      recipientId: a.recipientId,
      dedupeKey,
      windowKey,
      payload: a.payload,
      count: 1,
      createdAt: now,
      updatedAt: now,
    });
    // BOUND: per-room cap with oldest-read-first eviction. Steady state keeps
    // the table <= MAX+1, so the take() window always covers every row.
    const recent = await ctx.db
      .query("notificationEvents")
      .withIndex("by_room_created", (q) => q.eq("roomId", a.roomId))
      .order("desc")
      .take(NOTIFICATIONS_MAX_PER_ROOM + NOTIFICATIONS_EVICT_BATCH);
    if (recent.length > NOTIFICATIONS_MAX_PER_ROOM) {
      const { evicted } = capNotifications(recent, NOTIFICATIONS_MAX_PER_ROOM);
      for (const ev of evicted) await ctx.db.delete(ev._id);
    }
    return { deduped: false, tier, windowKey, id };
  },
});

/** The requester's active watch targets as "kind:id" keys (bounded read). */
async function watchedTargetsFor(
  ctx: QueryCtx | MutationCtx,
  roomId: Id<"rooms">,
  memberId: string,
): Promise<Set<string>> {
  const mine = await ctx.db
    .query("watches")
    .withIndex("by_room_member", (q) => q.eq("roomId", roomId).eq("memberId", memberId))
    .take(WATCHES_MAX_PER_MEMBER);
  return new Set(mine.filter((w) => w.on).map((w) => `${w.targetKind}:${w.targetId}`));
}

/** Fan-out-on-read recipient rule — ONE implementation for list + markRead.
 *  mention → only its recipient; watched_write → only readers watching the
 *  target; run_digest → room-wide. Mislabeled events (watched_write without a
 *  target) are visible to no one rather than leaking room-wide. */
function visibleTo(ev: Doc<"notificationEvents">, memberId: string, watched: Set<string>): boolean {
  if (ev.kind === "mention") return ev.recipientId === memberId;
  if (ev.kind === "watched_write") {
    return ev.targetKind != null && ev.targetId != null && watched.has(`${ev.targetKind}:${ev.targetId}`);
  }
  return true; // run_digest: room-wide
}

/** Requester-scoped notifications, newest 50 (fan-out-on-read). */
export const listNotifications = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const watched = await watchedTargetsFor(ctx, a.roomId, actor.id);
    const recent = await ctx.db
      .query("notificationEvents")
      .withIndex("by_room_created", (q) => q.eq("roomId", a.roomId))
      .order("desc")
      .take(NOTIFICATIONS_MAX_PER_ROOM);
    const mine = recent.filter((ev) => visibleTo(ev, actor.id, watched));
    return mine.slice(0, NOTIFICATIONS_PAGE).map((ev) => ({
      id: ev._id,
      kind: ev.kind,
      tier: ev.tier,
      actorId: ev.actorId,
      targetKind: ev.targetKind,
      targetId: ev.targetId,
      windowKey: ev.windowKey,
      payload: ev.payload,
      count: ev.count,
      readAt: ev.readAt,
      createdAt: ev.createdAt,
    }));
  },
});

/**
 * Mark every notification the requester can SEE as read (the inbox's
 * "mark all read"). Requester-scoped through the same visibleTo rule as
 * listNotifications: A marking read never touches B's mentions. run_digest
 * rows are room-wide, so their read state is honestly room-level (documented
 * fan-out-on-read tradeoff). BOUND: one take() window, never a full scan.
 */
export const markNotificationsRead = mutation({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const watched = await watchedTargetsFor(ctx, a.roomId, actor.id);
    const recent = await ctx.db
      .query("notificationEvents")
      .withIndex("by_room_created", (q) => q.eq("roomId", a.roomId))
      .order("desc")
      .take(NOTIFICATIONS_MAX_PER_ROOM);
    const now = Date.now();
    let marked = 0;
    for (const ev of recent) {
      if (ev.readAt != null) continue;
      if (!visibleTo(ev, actor.id, watched)) continue;
      await ctx.db.patch(ev._id, { readAt: now, updatedAt: now });
      marked += 1;
    }
    return { marked };
  },
});
