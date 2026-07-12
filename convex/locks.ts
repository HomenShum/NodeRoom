/**
 * Backend for propose_lock / release_lock.
 *
 * Locks protect an affected element range. For spreadsheet artifacts the range
 * is expanded through formula dependencies before the lock is granted, so a
 * write to a driver cell also protects downstream formula cells from concurrent
 * human or agent edits.
 */

import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { actorProofV, actorV, activeLockOn, LOCK_TTL_MS, requireActorInRoom, requireActorProof, requireAgentSession, requireArtifactInRoom, sameActor } from "./lib";
import { mergeBlockedDrafts } from "./drafts";
import { expandElementIdsWithSpreadsheetDependencies } from "./spreadsheetIndexLib";

export const proposeLock = internalMutation({
  args: { roomId: v.id("rooms"), artifactId: v.id("artifacts"), elementIds: v.array(v.string()), holder: actorV, sessionId: v.string(), reason: v.string() },
  handler: async (ctx, a) => {
    await requireArtifactInRoom(ctx, a.roomId, a.artifactId);
    await requireActorInRoom(ctx, a.roomId, a.holder);
    await requireAgentSession(ctx, a.roomId, a.sessionId, a.holder);
    const elementIds = await expandElementIdsWithSpreadsheetDependencies(ctx, a.artifactId, a.elementIds);

    let ownedLock: Awaited<ReturnType<typeof activeLockOn>> | null = null;
    for (const id of elementIds) {
      const lk = await activeLockOn(ctx, a.artifactId, id);
      if (lk && (!sameActor(lk.holder, a.holder) || String(lk.sessionId) !== String(a.sessionId))) {
        return { ok: false as const, reason: `range already locked by ${lk.holder.name}`, lockId: lk._id };
      }
      if (lk) {
        if (ownedLock && String(ownedLock._id) !== String(lk._id)) {
          return { ok: false as const, reason: "range spans multiple active locks", lockId: lk._id };
        }
        ownedLock = lk;
      }
    }

    const now = Date.now();
    if (ownedLock) {
      const requested = [...elementIds].sort().join("\n");
      const held = [...ownedLock.elementIds].sort().join("\n");
      if (requested !== held) {
        return { ok: false as const, reason: "holder already owns a different active range", lockId: ownedLock._id };
      }
      await ctx.db.patch(ownedLock._id, { expiresAt: now + LOCK_TTL_MS, reason: a.reason });
      return { ok: true as const, lockId: ownedLock._id, idempotent: true as const };
    }

    // Lease TTL (shared LOCK_TTL_MS) — a crashed holder's lock auto-expires; the write path renews it.
    const lockId = await ctx.db.insert("locks", {
      roomId: a.roomId,
      artifactId: a.artifactId,
      elementIds,
      holder: a.holder,
      sessionId: a.sessionId,
      reason: a.reason,
      status: "active",
      createdAt: now,
      expiresAt: now + LOCK_TTL_MS,
    });
    if (a.holder.kind === "agent") {
      await ctx.db.patch(a.sessionId as never, {
        status: "working",
        heldLockId: String(lockId),
        lastAction: `locked ${elementIds.join(",")}`,
        updatedAt: now,
      });
    }
    const expansion = elementIds.length > a.elementIds.length
      ? `; expanded to [${elementIds.join(", ")}] via spreadsheet dependencies`
      : "";
    await ctx.db.insert("traces", {
      roomId: a.roomId,
      ts: now,
      actor: a.holder,
      type: "lock_acquired",
      summary: `${a.holder.name} locked ${elementIds.join(", ")} - ${a.reason}`,
      detail: `propose_lock [${a.elementIds.join(", ")}]${expansion} reason="${a.reason}" -> ok`,
    });
    return { ok: true as const, lockId };
  },
});

export const releaseLock = internalMutation({
  args: { lockId: v.id("locks"), actor: actorV },
  handler: async (ctx, { lockId, actor }) => {
    const lock = await ctx.db.get(lockId);
    if (!lock || lock.status !== "active") return { ok: false as const, reason: "not_active", merged: [] };
    await requireActorInRoom(ctx, lock.roomId, actor);
    if (!sameActor(lock.holder, actor)) {
      await ctx.db.insert("traces", {
        roomId: lock.roomId,
        ts: Date.now(),
        actor,
        type: "lock_denied",
        summary: `${actor.name} tried to release a lock held by ${lock.holder.name}`,
        detail: `release_lock ${lockId} -> denied: not holder`,
      });
      return { ok: false as const, reason: "not_holder", merged: [] };
    }
    const now = Date.now();
    await ctx.db.patch(lockId, { status: "released", releasedAt: now });
    if (actor.kind === "agent") await ctx.db.patch(lock.sessionId as never, { status: "done", heldLockId: undefined, lastAction: "released lock", updatedAt: now });
    await ctx.db.insert("traces", {
      roomId: lock.roomId,
      ts: now,
      actor,
      type: "lock_released",
      summary: `${actor.name} released the lock on ${lock.elementIds.join(", ")}`,
      detail: `release_lock ${lockId} -> smart-merge waiting drafts`,
    });
    const merged = await mergeBlockedDrafts(ctx, lock.roomId, lockId);
    return { ok: true as const, merged };
  },
});

export const activeLocks = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.query("locks").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "active")).collect();
  },
});

/**
 * P1-2 janitor: sweep TTL-expired locks. Before this, an expired lock had THREE live bugs —
 * it rendered locked-forever in the UI (status filters ignore expiry), its blocked drafts stayed
 * "pending" permanently (mergeBlockedDrafts only fired on explicit release), and zombie rows grew
 * the unbounded active-lock scans. The sweep transitions status, clears the agent session's
 * heldLockId, AND fires the smart-merge — the full release path, not just a status flip.
 * Wired via convex/crons.ts (interval). Table-scan is bounded: locks are per-activity, short-lived.
 */
export const sweepExpiredLocks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const all = await ctx.db.query("locks").collect();
    const expired = all.filter((l) => l.status === "active" && l.expiresAt !== undefined && l.expiresAt <= now);
    for (const lock of expired) {
      await ctx.db.patch(lock._id, { status: "released", releasedAt: now });
      if (lock.holder.kind === "agent") {
        try { await ctx.db.patch(lock.sessionId as never, { status: "idle", heldLockId: undefined, lastAction: "lock lease expired", updatedAt: now }); } catch { /* session gone */ }
      }
      await ctx.db.insert("traces", {
        roomId: lock.roomId,
        ts: now,
        actor: lock.holder,
        type: "lock_expired",
        summary: `${lock.holder.name}'s lock on ${lock.elementIds.join(", ")} expired (lease TTL)`,
        detail: `janitor swept lock ${lock._id} -> smart-merge waiting drafts`,
      });
      await mergeBlockedDrafts(ctx, lock.roomId, lock._id);
    }
    return { swept: expired.length };
  },
});

/**
 * P1-6 human lock takeover (Hex "Yoink" semantics): the room HOST can force-release a stuck agent
 * lock instead of waiting out the TTL. Reuses the full release path (session clear + smart-merge);
 * the conflict-as-data CAS loop absorbs any post-takeover stale writes from the original holder.
 * Host-only: takeover is a moderation power, not a peer race.
 */
export const hostForceReleaseLock = mutation({
  args: { roomId: v.id("rooms"), lockId: v.id("locks"), requester: actorProofV },
  handler: async (ctx, { roomId, lockId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    const room = await ctx.db.get(roomId);
    if (!room || room.hostId !== requester.actor.id) return { ok: false as const, reason: "host_only" as const, merged: [] };
    const lock = await ctx.db.get(lockId);
    if (!lock || String(lock.roomId) !== String(roomId) || lock.status !== "active") return { ok: false as const, reason: "not_active" as const, merged: [] };
    const now = Date.now();
    await ctx.db.patch(lockId, { status: "released", releasedAt: now });
    if (lock.holder.kind === "agent") {
      try { await ctx.db.patch(lock.sessionId as never, { status: "idle", heldLockId: undefined, lastAction: `lock taken over by ${requester.actor.name}`, updatedAt: now }); } catch { /* session gone */ }
    }
    await ctx.db.insert("traces", {
      roomId,
      ts: now,
      actor: requester.actor,
      type: "lock_takeover",
      summary: `${requester.actor.name} (host) took over ${lock.holder.name}'s lock on ${lock.elementIds.join(", ")}`,
      detail: `hostForceReleaseLock ${lockId} -> smart-merge waiting drafts`,
    });
    const merged = await mergeBlockedDrafts(ctx, roomId, lockId);
    return { ok: true as const, merged };
  },
});
