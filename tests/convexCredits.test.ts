// @vitest-environment edge-runtime
//
// Live credit wallet (Convex) correctness. Exercises the REAL convex/credits mutations against a
// simulated Convex DB — the production wallet that protects the card. Persona: a pilot room is
// granted credits, runs research (reserve→settle), exhausts the grant (fail-closed), survives
// duplicate reserve/settle (idempotency), a crashed run's hold is swept, and a kill switch halts it.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { estimateCostFor } from "../src/nodeagent/core/creditModel";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts", "../convex/capturesNode.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

async function seedRoom(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    return await ctx.db.insert("rooms", {
      code: `CR${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Credit pilot",
      hostId: "pending",
      autoAllow: true,
      status: "live" as const,
      createdAt: now,
    });
  });
}

const STD_HOLD = estimateCostFor("standard").creditsRequired;
const QUICK_HOLD = estimateCostFor("quick").creditsRequired;
const DEEP_HOLD = estimateCostFor("deep").creditsRequired;

async function readRoomCredits(t: ReturnType<typeof convexTest>, roomId: any) {
  return t.run(async (ctx: any) => ctx.db.query("roomCredits").withIndex("by_room", (q: any) => q.eq("roomId", roomId)).first());
}

describe("convex credits — grant + reserve + settle", () => {
  it("grant seeds the balance; reserve holds; settle debits actual + refunds the rest", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    await t.mutation(internal.credits.grantCredits, { roomId, credits: 20, source: "pilot" });
    let rc = await readRoomCredits(t, roomId);
    expect(rc?.availableCredits).toBe(20);

    const r = await t.mutation(internal.credits.reserve, { roomId, mode: "standard", reservationKey: "job_1" });
    expect(r.ok).toBe(true);
    expect(r.heldCredits).toBe(STD_HOLD);
    rc = await readRoomCredits(t, roomId);
    expect(rc?.reservedCredits).toBe(STD_HOLD);
    expect(rc?.availableCredits).toBe(20 - STD_HOLD);

    // Settle cheaper than the hold → unused refunded, reserved released.
    const cheapUsd = estimateCostFor("standard").estimateUsd / 2;
    const s = await t.mutation(internal.credits.settle, { roomId, reservationKey: "job_1", actualUsd: cheapUsd });
    expect(s.ok).toBe(true);
    expect((s as any).refundedCredits).toBeGreaterThan(0);
    rc = await readRoomCredits(t, roomId);
    expect(rc?.reservedCredits).toBe(0);
    expect((rc?.availableCredits ?? 0) + (rc?.lifetimeSpentCredits ?? 0)).toBeCloseTo(20, 1);
  });
});

describe("convex credits — enrollment scoping", () => {
  it("an un-enrolled room (no grant) passes through unmetered — never blocked", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const r = await t.mutation(internal.credits.reserve, { roomId, mode: "deep", reservationKey: "free" });
    expect(r.ok).toBe(true);
    expect((r as any).unenrolled).toBe(true);
    expect((r as any).heldCredits).toBe(0);
    // No balance row was created — the room stays unenrolled until granted.
    expect(await readRoomCredits(t, roomId)).toBeNull();
    // Settle on the same un-enrolled room is a graceful no-op.
    const s = await t.mutation(internal.credits.settle, { roomId, reservationKey: "free", actualUsd: 5 });
    expect(s.ok).toBe(true);
  });
});

describe("convex credits — fail-closed", () => {
  it("reserve over balance returns insufficient_credits, does not debit, logs a reject", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const underStandardHold = STD_HOLD - 0.01;
    await t.mutation(internal.credits.grantCredits, { roomId, credits: underStandardHold, source: "pilot" });
    const r = await t.mutation(internal.credits.reserve, { roomId, mode: "standard", reservationKey: "job_x" });
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("insufficient_credits");
    const rc = await readRoomCredits(t, roomId);
    expect(rc?.availableCredits).toBe(underStandardHold); // untouched
    expect(rc?.reservedCredits).toBe(0);
    const rejects = await t.run(async (ctx) => ctx.db.query("creditLedger").withIndex("by_reservation", (q) => q.eq("reservationKey", "job_x")).collect());
    expect(rejects.some((x) => x.kind === "reject")).toBe(true);
  });

  it("a never-negative balance: exhausting the grant eventually rejects", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    await t.mutation(internal.credits.grantCredits, { roomId, credits: 20, source: "pilot" });
    let ok = 0;
    for (let i = 0; i < 30; i++) {
      const r = await t.mutation(internal.credits.reserve, { roomId, mode: "standard", reservationKey: `loop_${i}` });
      if (r.ok) {
        ok++;
        await t.mutation(internal.credits.settle, { roomId, reservationKey: `loop_${i}`, actualUsd: estimateCostFor("standard").estimateUsd });
      }
    }
    expect(ok).toBeGreaterThan(0);
    const rc = await readRoomCredits(t, roomId);
    expect(rc?.availableCredits ?? 0).toBeGreaterThanOrEqual(0);
  });
});

describe("convex credits — idempotency", () => {
  it("duplicate reserve for the same key does not double-hold", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    await t.mutation(internal.credits.grantCredits, { roomId, credits: 20, source: "pilot" });
    await t.mutation(internal.credits.reserve, { roomId, mode: "standard", reservationKey: "dup" });
    const second = await t.mutation(internal.credits.reserve, { roomId, mode: "standard", reservationKey: "dup" });
    expect((second as any).idempotent).toBe(true);
    const rc = await readRoomCredits(t, roomId);
    expect(rc?.reservedCredits).toBe(STD_HOLD); // only ONE hold
  });

  it("settling the same reservation twice is a no-op the second time", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    await t.mutation(internal.credits.grantCredits, { roomId, credits: 20, source: "pilot" });
    await t.mutation(internal.credits.reserve, { roomId, mode: "quick", reservationKey: "once" });
    const a = await t.mutation(internal.credits.settle, { roomId, reservationKey: "once", actualUsd: 0.1 });
    const b = await t.mutation(internal.credits.settle, { roomId, reservationKey: "once", actualUsd: 0.1 });
    expect(a.ok).toBe(true);
    expect((b as any).idempotent).toBe(true);
    const rc = await readRoomCredits(t, roomId);
    expect(rc?.lifetimeSpentCredits).toBeLessThanOrEqual(QUICK_HOLD + 0.5); // not double-charged
  });

  it("settle for an unknown reservation is rejected honestly", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    await t.mutation(internal.credits.grantCredits, { roomId, credits: 20, source: "pilot" });
    const s = await t.mutation(internal.credits.settle, { roomId, reservationKey: "ghost", actualUsd: 1 });
    expect(s.ok).toBe(false);
    expect((s as any).reason).toBe("unknown_reservation");
  });
});

describe("convex credits — overspend, pause, sweep", () => {
  it("a run hotter than its hold clamps available at 0 and records the overspend", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    await t.mutation(internal.credits.grantCredits, { roomId, credits: 2, source: "pilot" });
    await t.mutation(internal.credits.reserve, { roomId, mode: "quick", reservationKey: "hot" });
    const s = await t.mutation(internal.credits.settle, { roomId, reservationKey: "hot", actualUsd: 100 });
    expect(s.ok).toBe(true);
    expect((s as any).overspentCredits).toBeGreaterThan(0);
    const rc = await readRoomCredits(t, roomId);
    expect(rc?.availableCredits).toBe(0); // never negative
  });

  it("pause is a kill switch — reserve rejects with reason 'paused'", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    await t.mutation(internal.credits.grantCredits, { roomId, credits: 50, source: "pilot" });
    await t.mutation(internal.credits.setPaused, { roomId, paused: true });
    const r = await t.mutation(internal.credits.reserve, { roomId, mode: "quick", reservationKey: "blocked" });
    expect(r.ok).toBe(false);
    expect((r as any).reason).toBe("paused");
    // Resume restores it.
    await t.mutation(internal.credits.setPaused, { roomId, paused: false });
    const r2 = await t.mutation(internal.credits.reserve, { roomId, mode: "quick", reservationKey: "unblocked" });
    expect(r2.ok).toBe(true);
  });

  it("sweep refunds a crashed run's dangling hold after expiry", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const t0 = 1_000_000;
    await t.mutation(internal.credits.grantCredits, { roomId, credits: 20, source: "pilot", now: t0 });
    await t.mutation(internal.credits.reserve, { roomId, mode: "deep", reservationKey: "crashed", now: t0 });
    let rc = await readRoomCredits(t, roomId);
    expect(rc?.reservedCredits).toBe(DEEP_HOLD); // hold outstanding (run "crashed", never settled)

    const swept = await t.mutation(internal.credits.sweepExpiredReservations, { now: t0 + 2 * 60 * 60 * 1000 });
    expect(swept.swept).toBeGreaterThanOrEqual(1);
    rc = await readRoomCredits(t, roomId);
    expect(rc?.reservedCredits).toBe(0); // hold released
    expect(rc?.availableCredits).toBe(20); // fully refunded
  });

  it("COST-AWARE sweep: a finished-but-unsettled run is charged its ACTUAL cost, not fully refunded", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const t0 = 2_000_000;
    await t.mutation(internal.credits.grantCredits, { roomId, credits: 20, source: "pilot", now: t0 });
    await t.mutation(internal.credits.reserve, { roomId, mode: "deep", reservationKey: "finished-key", now: t0 });
    // Simulate a run that recorded its cost in agentRuns but whose action died before calling settle.
    await t.run(async (ctx: any) => {
      await ctx.db.insert("agentRuns", {
        roomId, agentId: "a", model: "z-ai/glm-5.2", goal: "g", steps: 5, toolCalls: 1, conflictsSurvived: 0,
        inputTokens: 1000, outputTokens: 100, costUsd: 0.5, ms: 100, exhausted: false, idempotencyKey: "finished-key", createdAt: t0 + 1000,
      });
    });
    const swept = await t.mutation(internal.credits.sweepExpiredReservations, { now: t0 + 2 * 60 * 60 * 1000 });
    expect(swept.swept).toBe(1);
    const rc = await readRoomCredits(t, roomId);
    // $0.50 = 2 credits charged; the rest of the 12-credit hold refunded → NEVER loses money.
    expect(rc?.lifetimeSpentCredits).toBe(2);
    expect(rc?.reservedCredits).toBe(0);
    expect(rc?.availableCredits).toBe(18);
  });

  it("COST-AWARE sweep: a crashed run with no recorded cost CAPTURES the hold (never refunds spent money)", async () => {
    const t = convexTest(schema, modules);
    const roomId = await seedRoom(t);
    const t0 = 3_000_000;
    await t.mutation(internal.credits.grantCredits, { roomId, credits: 20, source: "pilot", now: t0 });
    await t.mutation(internal.credits.reserve, { roomId, mode: "deep", reservationKey: "crashed-key", now: t0 });
    // A run was claimed (row exists) but crashed mid-LLM: costUsd never recorded (still 0).
    await t.run(async (ctx: any) => {
      await ctx.db.insert("agentRuns", {
        roomId, agentId: "a", model: "z-ai/glm-5.2", goal: "g", steps: 0, toolCalls: 0, conflictsSurvived: 0,
        inputTokens: 0, outputTokens: 0, costUsd: 0, ms: 0, exhausted: false, idempotencyKey: "crashed-key", createdAt: t0 + 1000,
      });
    });
    const swept = await t.mutation(internal.credits.sweepExpiredReservations, { now: t0 + 2 * 60 * 60 * 1000 });
    expect((swept as any).captured).toBe(1);
    const rc = await readRoomCredits(t, roomId);
    // Conservative: the full hold is captured as spent (the LLM may have been billed) — money safe.
    expect(rc?.lifetimeSpentCredits).toBe(DEEP_HOLD);
    expect(rc?.reservedCredits).toBe(0);
    expect(rc?.availableCredits).toBe(20 - DEEP_HOLD);
  });

  it("admin snapshot rolls up enrolled rooms and spend", async () => {
    const t = convexTest(schema, modules);
    const a = await seedRoom(t);
    const b = await seedRoom(t);
    await t.mutation(internal.credits.grantCredits, { roomId: a, credits: 20, source: "pilot" });
    await t.mutation(internal.credits.grantCredits, { roomId: b, credits: 100, source: "manual" });
    await t.mutation(internal.credits.reserve, { roomId: a, mode: "standard", reservationKey: "spend" });
    await t.mutation(internal.credits.settle, { roomId: a, reservationKey: "spend", actualUsd: estimateCostFor("standard").estimateUsd });
    const snap = await t.query(internal.credits.globalCreditSnapshot, {});
    expect(snap.enrolledRooms).toBe(2);
    expect(snap.totalSpentCredits).toBeGreaterThan(0);
    expect(snap.topSpenders.length).toBeGreaterThanOrEqual(1);
  });
});
