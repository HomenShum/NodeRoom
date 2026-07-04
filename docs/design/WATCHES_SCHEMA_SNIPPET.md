# Watches + Notifications — schema snippet & staged functions (wave-1 → wave-2 handoff)

Design contract: **"Notifications: instant (mentions, watched rows) / hourly (run
digests) / daily (rest); watch = W/swipe."**

`convex/schema.ts` was owned by another agent in wave 1, so the watch layer ships
in three pieces that are already in the tree, plus ONE paste for the integrator:

| Piece | Status |
| --- | --- |
| `convex/watchesTables.ts` — table definitions (typecheck-clean standalone) | shipped, wave 1 |
| `src/notifications/tiers.ts` — pure tier/dedupe/eviction policy | shipped + scenario-tested, wave 1 |
| `tests/notificationTiers.test.ts` — scenario tests for the pure module | shipped, wave 1 |
| schema diff + `convex/watches.ts` (below) | **integrator paste, wave 2** |

Honesty label: the `convex/watches.ts` code below is hand-reviewed against the
repo's existing conventions (`requireActorProof`, `withIndex`, `.take()` bounds —
patterns lifted from `convex/roomActivity.ts` / `convex/agentArtifacts.ts`) but it
can only COMPILE once the schema diff lands, because `ctx.db.query("watches")`
needs the tables in `defineSchema`. After pasting, run:

```bash
npx tsc --noEmit --project convex/tsconfig.json
npm run typecheck
npx vitest run tests/notificationTiers.test.ts
```

## 1. Exact `convex/schema.ts` diff (6 lines)

Import block (schema.ts currently lines 18–20):

```diff
 import { defineSchema, defineTable } from "convex/server";
 import { v } from "convex/values";
 import { refutationVerdictV } from "./lib";
+import { notificationEventsTable, watchesTable } from "./watchesTables";
```

End of the `defineSchema({ ... })` map — insert immediately before the closing
`});` (the last table today is `nodeMemContextPacks`):

```diff
     .index("by_mode", ["mode", "createdAt"]),
+
+  // Watches + notifications (design: instant = mentions/watched rows; hourly = run digests; daily = rest).
+  watches: watchesTable,
+  notificationEvents: notificationEventsTable,
 });
```

## 2. `convex/watches.ts` — complete function code (create this file verbatim)

```ts
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
 * run_digest → room-wide). No per-recipient row explosion.
 *
 * Reliability: BOUND (WATCHES_MAX_PER_MEMBER, NOTIFICATIONS_MAX_PER_ROOM +
 * oldest-read-first eviction, every scan behind .take()), HONEST_STATUS
 * (watch_limit_reached throws instead of silently dropping; recordNotifiable
 * reports deduped:true instead of pretending a fresh insert), DETERMINISTIC
 * (dedupeKeyFor sorted+escaped keys).
 */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
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
 * dedupeKeyFor(...) — e.g. { roomId, kind, actorId: runId, targetId }). For
 * digest tiers the current UTC window key is appended, so per-run spam
 * collapses into one row per window and a new hour/day re-opens the bucket.
 * A deduped repeat clears readAt so real new activity re-surfaces.
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

/** Requester-scoped notifications, newest 50 (fan-out-on-read). */
export const listNotifications = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, a) => {
    const actor = await requireActorProof(ctx, a.roomId, a.requester);
    const myWatches = await ctx.db
      .query("watches")
      .withIndex("by_room_member", (q) => q.eq("roomId", a.roomId).eq("memberId", actor.id))
      .take(WATCHES_MAX_PER_MEMBER);
    const watched = new Set(
      myWatches.filter((w) => w.on).map((w) => `${w.targetKind}:${w.targetId}`),
    );
    const recent = await ctx.db
      .query("notificationEvents")
      .withIndex("by_room_created", (q) => q.eq("roomId", a.roomId))
      .order("desc")
      .take(NOTIFICATIONS_MAX_PER_ROOM);
    const mine = recent.filter((ev) => {
      if (ev.kind === "mention") return ev.recipientId === actor.id;
      if (ev.kind === "watched_write") {
        return ev.targetKind != null && ev.targetId != null &&
          watched.has(`${ev.targetKind}:${ev.targetId}`);
      }
      return true; // run_digest: room-wide
    });
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
```

## 3. Wave-2 wiring notes (writers + UI)

- **Mentions (instant)** — the message send path parses `@name` → member, then
  `ctx.runMutation(internal.watches.recordNotifiable, { roomId, kind: "mention",
  actorId, recipientId: String(member._id), dedupeKey: dedupeKeyFor({ roomId:
  String(roomId), kind: "mention", msg: clientMsgId, to: String(member._id) }) })`.
- **Watched writes (instant when watched, daily otherwise)** — the spreadsheet /
  artifact commit path fires one notifiable per touched row with `dedupeKey:
  dedupeKeyFor({ roomId, kind: "watched_write", run: runId ?? opId, target:
  rowId })` so a 500-write agent burst collapses per row per run.
- **Run digests (hourly)** — agent-run completion fires `kind: "run_digest"`
  with `dedupeKey: dedupeKeyFor({ roomId, kind: "run_digest", run: runId })`.
- **UI** — group by `tier`; terracotta chip for agent `actorId` provenance,
  amber = needs review, green = success only. `watch = W/swipe`: W key on the
  focused row and swipe on mobile both call `setWatch` (idempotent, safe to
  double-fire). Read receipts: a wave-2 `markRead` mutation patches `readAt`
  (owner-scoped) — eviction already prefers read rows.

## 4. Scenario coverage already green (wave 1)

`tests/notificationTiers.test.ts` — analyst watching 3 rows through a 500-write
agent burst (instant only for watched rows), digest bucket stability across the
2026 US DST spring-forward/fall-back edges (UTC bucketing), per-run dedupe
collapse incl. delimiter-injection adversarial keys, oldest-read-first cap
eviction (burst + 48h sustained accumulation), and hostile inputs (NaN
timestamps, negative caps, unknown kinds).
