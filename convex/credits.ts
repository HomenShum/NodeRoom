/**
 * credits.ts — live credit wallet (Convex). The reserve→settle ledger that protects the
 * card in production. Mirrors the pure engine in src/nodeagent/core/creditLedger.ts, but
 * persisted: roomCredits is the materialized balance (fast reads + transactional reserve/
 * settle), creditLedger is the append-only audit, creditGrants the append-only top-ups.
 *
 * All credit MATH comes from src/nodeagent/core/creditModel (single source of truth — no
 * copied rates). reserve/settle/grant/pause are internalMutations (server-only) so a user
 * can never settle their own run at $0 or grant themselves credits. balance/usageEvents are
 * auth-gated queries for the room UI.
 *
 * Enforcement (calling reserve/settle from the agent run path) is wired separately behind a
 * flag so the live app is never broken by a 0-balance before grants are seeded. A room with
 * NO roomCredits row is "not enrolled" → unenforced.
 */
import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { actorProofV, requireActorProof } from "./lib";
import {
  creditsToUsd,
  DEFAULT_BUDGET_CAPS,
  estimateCostFor,
  usdToCredits,
  USD_PER_CREDIT,
} from "../src/nodeagent/core/creditModel";

const creditModeV = v.union(v.literal("quick"), v.literal("standard"), v.literal("deep"));
/** Reserve holds expire after this with no settle → swept + refunded (crashed-run holds). */
const RESERVATION_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_SWEEP_ROWS = 2_000;
const MAX_GLOBAL_ROOMS = 5_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}

type RoomCredits = Doc<"roomCredits">;

async function getRoomCredits(ctx: { db: any }, roomId: Id<"rooms">): Promise<RoomCredits | null> {
  // .first() (not .unique()) so a rare concurrent first-insert race never throws.
  return await ctx.db.query("roomCredits").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).first();
}

async function ensureRoomCredits(ctx: { db: any }, roomId: Id<"rooms">, now: number): Promise<RoomCredits> {
  const existing = await getRoomCredits(ctx, roomId);
  if (existing) return existing;
  const id = await ctx.db.insert("roomCredits", {
    roomId,
    availableCredits: 0,
    reservedCredits: 0,
    lifetimeSpentCredits: 0,
    paused: false,
    updatedAt: now,
  });
  return (await ctx.db.get(id))!;
}

function balanceView(rc: RoomCredits | null) {
  if (!rc) {
    // Not enrolled → unenforced. The live UI shows "not metered yet"; never fabricate a balance.
    return {
      enrolled: false,
      enforced: false,
      demo: false,
      paused: false,
      availableCredits: 0,
      reservedCredits: 0,
      lifetimeSpentCredits: 0,
      availableUsd: 0,
      reservedUsd: 0,
      lifetimeSpentUsd: 0,
      usdPerCredit: USD_PER_CREDIT,
    };
  }
  return {
    enrolled: true,
    enforced: true,
    demo: false,
    paused: rc.paused,
    availableCredits: round2(rc.availableCredits),
    reservedCredits: round2(rc.reservedCredits),
    lifetimeSpentCredits: round2(rc.lifetimeSpentCredits),
    availableUsd: round4(creditsToUsd(rc.availableCredits)),
    reservedUsd: round4(creditsToUsd(rc.reservedCredits)),
    lifetimeSpentUsd: round4(creditsToUsd(rc.lifetimeSpentCredits)),
    usdPerCredit: USD_PER_CREDIT,
  };
}

// ───────────────────────────── queries (auth-gated) ─────────────────────────────

export const balance = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    return balanceView(await getRoomCredits(ctx, roomId));
  },
});

export const usageEvents = query({
  args: { roomId: v.id("rooms"), requester: actorProofV, limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, requester, limit }) => {
    await requireActorProof(ctx, roomId, requester);
    const rows = await ctx.db
      .query("creditLedger")
      .withIndex("by_room", (q) => q.eq("roomId", roomId))
      .order("desc")
      .take(Math.min(200, Math.max(1, limit ?? 50)));
    return rows.map((r) => ({
      id: r._id,
      kind: r.kind,
      mode: r.mode,
      credits: r.credits,
      usd: r.usd,
      reservationKey: r.reservationKey,
      reason: r.reason,
      createdAt: r.createdAt,
    }));
  },
});

// ───────────────────────────── reserve / settle (server-only) ─────────────────────────────

export const reserve = internalMutation({
  args: {
    roomId: v.id("rooms"),
    mode: creditModeV,
    reservationKey: v.string(),
    jobId: v.optional(v.id("agentJobs")),
    now: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, mode, reservationKey, jobId, now }) => {
    const ts = now ?? Date.now();
    // IDEMPOTENT: a duplicate reserve for the same key does not double-hold.
    const existing = await ctx.db
      .query("creditLedger")
      .withIndex("by_reservation", (q) => q.eq("reservationKey", reservationKey))
      .collect();
    const existingReserve = existing.find((r) => r.kind === "reserve");
    if (existingReserve) {
      return { ok: true as const, idempotent: true, reservationKey, heldCredits: -existingReserve.credits, balance: balanceView(await getRoomCredits(ctx, roomId)) };
    }
    // Enforcement auto-scopes to ENROLLED rooms only. A room with no grant is unmetered →
    // pass through (never blocked). Homen enrolls a room by granting it credits.
    const rc = await getRoomCredits(ctx, roomId);
    if (!rc) {
      return { ok: true as const, idempotent: false, unenrolled: true, reservationKey, heldCredits: 0, balance: balanceView(null) };
    }
    const hold = estimateCostFor(mode).creditsRequired;

    // FAIL-CLOSED: paused room or insufficient credits → reject, do not start.
    if (rc.paused || rc.availableCredits < hold) {
      const reason = rc.paused ? "paused" : "insufficient_credits";
      await ctx.db.insert("creditLedger", { roomId, kind: "reject", mode, reservationKey, credits: 0, usd: 0, jobId, reason, createdAt: ts });
      return { ok: false as const, reason, heldCredits: 0, balance: balanceView(rc) };
    }

    await ctx.db.patch(rc._id, {
      availableCredits: round2(rc.availableCredits - hold),
      reservedCredits: round2(rc.reservedCredits + hold),
      updatedAt: ts,
    });
    await ctx.db.insert("creditLedger", {
      roomId,
      kind: "reserve",
      mode,
      reservationKey,
      credits: -hold,
      usd: -creditsToUsd(hold),
      jobId,
      createdAt: ts,
      expiresAt: ts + RESERVATION_TTL_MS,
    });
    return { ok: true as const, idempotent: false, reservationKey, heldCredits: hold, balance: balanceView(await getRoomCredits(ctx, roomId)) };
  },
});

export const settle = internalMutation({
  args: {
    roomId: v.id("rooms"),
    reservationKey: v.string(),
    actualUsd: v.number(),
    runId: v.optional(v.id("agentRuns")),
    now: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, reservationKey, actualUsd, runId, now }) => {
    const ts = now ?? Date.now();
    const rows = await ctx.db
      .query("creditLedger")
      .withIndex("by_reservation", (q) => q.eq("reservationKey", reservationKey))
      .collect();
    // IDEMPOTENT: already settled → no-op.
    if (rows.some((r) => r.kind === "settle")) {
      return { ok: true as const, idempotent: true, balance: balanceView(await getRoomCredits(ctx, roomId)) };
    }
    // Unenrolled room (no balance row) → the run was unmetered; settle is a graceful no-op.
    // (Checked BEFORE the reserveRow lookup: an unenrolled reserve inserts no ledger row.)
    const rc = await getRoomCredits(ctx, roomId);
    if (!rc) {
      return { ok: true as const, idempotent: false, unenrolled: true, balance: balanceView(null) };
    }
    // Reserve must belong to THIS room (defense against a cross-room reservationKey collision).
    const reserveRow = rows.find((r) => r.kind === "reserve");
    if (!reserveRow || reserveRow.roomId !== roomId) {
      return { ok: false as const, reason: "unknown_reservation", balance: balanceView(rc) };
    }
    const hold = -reserveRow.credits; // positive
    const actualCredits = Math.max(0, usdToCredits(Math.max(0, actualUsd)));

    let available = rc.availableCredits;
    let reserved = rc.reservedCredits - hold; // release the hold
    let lifetimeSpent = rc.lifetimeSpentCredits;
    let refundedCredits = 0;
    let overspentCredits = 0;
    let settledCredits: number;

    if (actualCredits <= hold) {
      settledCredits = actualCredits;
      refundedCredits = hold - actualCredits;
      available += refundedCredits;
      lifetimeSpent += settledCredits;
    } else {
      const overage = actualCredits - hold;
      const coverable = Math.min(overage, available);
      available -= coverable;
      overspentCredits = overage - coverable; // uncovered remainder (the per-room/global cap is the backstop)
      settledCredits = hold + coverable;
      lifetimeSpent += settledCredits;
    }

    await ctx.db.patch(rc._id, {
      availableCredits: round2(Math.max(0, available)),
      reservedCredits: round2(Math.max(0, reserved)),
      lifetimeSpentCredits: round2(lifetimeSpent),
      updatedAt: ts,
    });
    await ctx.db.insert("creditLedger", {
      roomId,
      kind: "settle",
      mode: reserveRow.mode,
      reservationKey,
      credits: -round2(usdToCredits(actualUsd)),
      usd: -round4(actualUsd),
      runId,
      reason: overspentCredits > 0 ? "overspent" : undefined,
      createdAt: ts,
    });
    if (refundedCredits > 0) {
      await ctx.db.insert("creditLedger", {
        roomId,
        kind: "refund",
        mode: reserveRow.mode,
        reservationKey,
        credits: round2(refundedCredits),
        usd: round4(creditsToUsd(refundedCredits)),
        runId,
        createdAt: ts,
      });
    }
    return {
      ok: true as const,
      idempotent: false,
      settledCredits: round2(settledCredits),
      refundedCredits: round2(refundedCredits),
      overspentCredits: round2(overspentCredits),
      balance: balanceView(await getRoomCredits(ctx, roomId)),
    };
  },
});

// ───────────────────────────── grants + kill switch (server-only) ─────────────────────────────

export const grantCredits = internalMutation({
  args: {
    roomId: v.id("rooms"),
    credits: v.number(),
    source: v.union(v.literal("pilot"), v.literal("promo"), v.literal("manual"), v.literal("paid")),
    note: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  handler: async (ctx, { roomId, credits, source, note, now }) => {
    const ts = now ?? Date.now();
    const add = Math.max(0, credits);
    const rc = await ensureRoomCredits(ctx, roomId, ts);
    await ctx.db.patch(rc._id, { availableCredits: round2(rc.availableCredits + add), updatedAt: ts });
    await ctx.db.insert("creditGrants", { roomId, credits: add, source, note, createdAt: ts });
    await ctx.db.insert("creditLedger", { roomId, kind: "refund", reservationKey: `grant_${ts}`, credits: add, usd: creditsToUsd(add), reason: `grant:${source}`, note, createdAt: ts });
    return balanceView(await getRoomCredits(ctx, roomId));
  },
});

export const setPaused = internalMutation({
  args: { roomId: v.id("rooms"), paused: v.boolean(), now: v.optional(v.number()) },
  handler: async (ctx, { roomId, paused, now }) => {
    const ts = now ?? Date.now();
    const rc = await ensureRoomCredits(ctx, roomId, ts);
    await ctx.db.patch(rc._id, { paused, updatedAt: ts });
    return balanceView(await getRoomCredits(ctx, roomId));
  },
});

/** The job/run path checks this before starting work (kill switch + enrollment gate). */
export const roomGate = internalQuery({
  args: { roomId: v.id("rooms") },
  handler: async (ctx, { roomId }) => {
    const rc = await getRoomCredits(ctx, roomId);
    return { enrolled: !!rc, paused: rc?.paused ?? false, availableCredits: rc?.availableCredits ?? 0 };
  },
});

// ───────────────────────────── reservation sweep (cron) ─────────────────────────────

export const sweepExpiredReservations = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, { now }) => {
    const ts = now ?? Date.now();
    // Oldest-expired-first, bounded. The by_expiry range excludes rows with no expiresAt
    // (settle/refund/reject/grant), so we scan ONLY expired RESERVE holds — and always reach the
    // oldest stranded ones regardless of total ledger size (a newest-first scan could starve them).
    const expired = await ctx.db
      .query("creditLedger")
      .withIndex("by_expiry", (q) => q.gte("expiresAt", 1).lte("expiresAt", ts))
      .order("asc")
      .take(MAX_SWEEP_ROWS);
    let swept = 0;
    let captured = 0;
    for (const row of expired) {
      if (row.kind !== "reserve") continue;
      const sibs = await ctx.db
        .query("creditLedger")
        .withIndex("by_reservation", (q) => q.eq("reservationKey", row.reservationKey))
        .collect();
      if (sibs.some((s) => s.kind === "settle" || s.kind === "refund")) continue; // already resolved
      const rc = await getRoomCredits(ctx, row.roomId);
      if (!rc) continue;
      const hold = -row.credits; // positive
      // COST-AWARE so a crashed run can't silently refund money the LLM already billed:
      //  - finished run (agentRuns.costUsd > 0) → charge the ACTUAL cost, refund the remainder;
      //  - claimed-but-unsettled run (row exists, cost 0) → CAPTURE the hold (assume it spent — never lose money);
      //  - no run row at all (never started) → refund the full hold.
      const run = await ctx.db
        .query("agentRuns")
        .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", row.reservationKey))
        .order("desc")
        .first();
      let actualUsd: number;
      let resolution: "settled" | "captured" | "refunded";
      if (run && run.costUsd > 0) {
        actualUsd = run.costUsd;
        resolution = "settled";
      } else if (run) {
        actualUsd = creditsToUsd(hold);
        resolution = "captured";
      } else {
        actualUsd = 0;
        resolution = "refunded";
      }
      const actualCredits = Math.max(0, Math.min(hold, usdToCredits(actualUsd))); // capped at the hold
      const refund = hold - actualCredits;
      await ctx.db.patch(rc._id, {
        availableCredits: round2(rc.availableCredits + refund),
        reservedCredits: round2(Math.max(0, rc.reservedCredits - hold)),
        lifetimeSpentCredits: round2(rc.lifetimeSpentCredits + actualCredits),
        updatedAt: ts,
      });
      await ctx.db.insert("creditLedger", { roomId: row.roomId, kind: "settle", mode: row.mode, reservationKey: row.reservationKey, credits: -round2(actualCredits), usd: -round4(actualUsd), runId: run?._id, reason: `swept_${resolution}`, createdAt: ts });
      if (refund > 0) {
        await ctx.db.insert("creditLedger", { roomId: row.roomId, kind: "refund", mode: row.mode, reservationKey: row.reservationKey, credits: round2(refund), usd: round4(creditsToUsd(refund)), reason: "expired_reservation", createdAt: ts });
      }
      swept++;
      if (resolution === "captured") captured++;
    }
    return { swept, captured, scanned: expired.length, truncated: expired.length === MAX_SWEEP_ROWS };
  },
});

// ───────────────────────────── admin snapshot ─────────────────────────────

export const globalCreditSnapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rooms = await ctx.db.query("roomCredits").take(MAX_GLOBAL_ROOMS);
    const totalAvailable = rooms.reduce((s, r) => s + r.availableCredits, 0);
    const totalReserved = rooms.reduce((s, r) => s + r.reservedCredits, 0);
    const totalSpent = rooms.reduce((s, r) => s + r.lifetimeSpentCredits, 0);
    const topSpenders = [...rooms]
      .sort((a, b) => b.lifetimeSpentCredits - a.lifetimeSpentCredits)
      .slice(0, 10)
      .map((r) => ({ roomId: r.roomId, spentCredits: round2(r.lifetimeSpentCredits), spentUsd: round4(creditsToUsd(r.lifetimeSpentCredits)), paused: r.paused }));
    return {
      enrolledRooms: rooms.length,
      totalAvailableCredits: round2(totalAvailable),
      totalReservedCredits: round2(totalReserved),
      totalSpentCredits: round2(totalSpent),
      totalSpentUsd: round4(creditsToUsd(totalSpent)),
      globalMonthlyCapUsd: DEFAULT_BUDGET_CAPS.globalMonthlyUsd,
      topSpenders,
      truncated: rooms.length === MAX_GLOBAL_ROOMS,
    };
  },
});
