// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { reserveCreditsFor } from "../src/nodeagent/core/creditModel";
import { completeProviderSpend } from "../convex/providerSpend";

const modules = import.meta.glob("../convex/**/*.ts");
for (const moduleName of [
  "../convex/agent.ts",
  "../convex/agentJobRunner.ts",
  "../convex/agentWorkflows.ts",
  "../convex/embeddingRunner.ts",
  "../convex/capturesNode.ts",
]) delete (modules as Record<string, unknown>)[moduleName];

const providerSpendInternal = (internal as any).providerSpend;
const ENV_KEYS = ["NODEAGENT_LAUNCH_MODE", "CREDITS_ENFORCED"] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

async function setup(credits = 100) {
  const t = convexTest(schema, modules);
  const roomId = await t.run((ctx) => ctx.db.insert("rooms", {
    code: `PS${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    title: "Provider spend",
    hostId: "host",
    autoAllow: false,
    status: "live" as const,
    createdAt: Date.now(),
  }));
  if (credits > 0) await t.mutation(internal.credits.grantCredits, { roomId, credits, source: "pilot" });
  return { t, roomId };
}

function beginArgs(roomId: any, overrides: Record<string, unknown> = {}) {
  return {
    roomId,
    requesterId: "user-1",
    route: "private_agent" as const,
    metering: "actual" as const,
    goal: "Explain the variance",
    modelHint: "test-model",
    creditMode: "quick" as const,
    reservationKey: `provider-${crypto.randomUUID()}`,
    ...overrides,
  };
}

describe.sequential("direct provider spend boundary", () => {
  beforeEach(() => {
    process.env.NODEAGENT_LAUNCH_MODE = "public_launch";
    process.env.CREDITS_ENFORCED = "true";
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("fails closed before claim or reserve when launch metering is unavailable", async () => {
    const { t, roomId } = await setup();
    const result = await t.mutation(providerSpendInternal.begin, beginArgs(roomId, {
      route: "voice_stt",
      metering: "unavailable",
    }));
    expect(result).toEqual({ ok: false, error: "launch_admission:provider_metering_required:voice_stt" });
    const runs = await t.run((ctx) => ctx.db.query("agentRuns").collect());
    const reservations = await t.run((ctx) => ctx.db.query("creditReservations").collect());
    expect(runs).toHaveLength(0);
    expect(reservations).toHaveLength(0);
  });

  it("atomically claims and holds projected hard-cap exposure with requester attribution", async () => {
    const { t, roomId } = await setup();
    const result = await t.mutation(providerSpendInternal.begin, beginArgs(roomId, { reservationKey: "private-1" }));
    expect(result.ok).toBe(true);
    expect(result.admission).toMatchObject({ execute: true, creditsReserved: true, reservationKey: "private-1" });
    expect(result.admission.decision.projectedUsd).toBe(result.admission.decision.hardCapUsd);
    expect(result.admission.decision.requiredCredits).toBe(reserveCreditsFor(result.admission.decision.projectedUsd));
    const reservation = await t.run((ctx) => ctx.db.query("creditReservations")
      .withIndex("by_reservation", (q) => q.eq("reservationKey", "private-1"))
      .unique());
    expect(reservation).toMatchObject({
      requesterId: "user-1",
      projectedUsd: result.admission.decision.projectedUsd,
      heldCredits: result.admission.decision.requiredCredits,
      status: "active",
    });
  });

  it("deduplicates a stable key before a second provider execution", async () => {
    const { t, roomId } = await setup();
    const args = beginArgs(roomId, { reservationKey: "stable-stream-1", route: "private_stream" });
    const first = await t.mutation(providerSpendInternal.begin, args);
    const second = await t.mutation(providerSpendInternal.begin, args);
    expect(first.admission.execute).toBe(true);
    expect(second.admission).toMatchObject({ execute: false, duplicateReason: "in_flight", runId: first.admission.runId });
    const runs = await t.run((ctx) => ctx.db.query("agentRuns").collect());
    const reservations = await t.run((ctx) => ctx.db.query("creditReservations").collect());
    expect(runs).toHaveLength(1);
    expect(reservations).toHaveLength(1);
  });

  it("serializes concurrent admission so pending exposure blocks a second standard request", async () => {
    const { t, roomId } = await setup();
    const [a, b] = await Promise.all([
      t.mutation(providerSpendInternal.begin, beginArgs(roomId, { creditMode: "standard", reservationKey: "standard-a" })),
      t.mutation(providerSpendInternal.begin, beginArgs(roomId, { creditMode: "standard", reservationKey: "standard-b" })),
    ]);
    const results = [a, b];
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.find((result) => !result.ok)?.error).toBe("launch_admission:room_daily_spend_cap");
  });

  it("makes finish idempotent and never repatches a resolved run with a new amount", async () => {
    const { t, roomId } = await setup();
    const started = await t.mutation(providerSpendInternal.begin, beginArgs(roomId, { reservationKey: "finish-once" }));
    const finishArgs = {
      roomId,
      requesterId: "user-1",
      route: "private_agent" as const,
      creditMode: "quick" as const,
      reservationKey: "finish-once",
      runId: started.admission.runId,
      creditsReserved: true,
      projectedUsd: started.admission.decision.projectedUsd,
      model: "test-model",
      inputTokens: 100,
      outputTokens: 20,
      actualUsd: 0.1,
      costBasis: "actual" as const,
      success: true,
      startedAt: Date.now() - 10,
    };
    expect(await t.mutation(providerSpendInternal.finish, finishArgs)).toMatchObject({ ok: true, idempotent: false });
    expect(await t.mutation(providerSpendInternal.finish, { ...finishArgs, actualUsd: 9 })).toMatchObject({ ok: true, idempotent: true });
    const run = await t.run((ctx) => ctx.db.get(started.admission.runId)) as any;
    expect(run?.costUsd).toBe(0.1);
    const settles = await t.run((ctx) => ctx.db.query("creditLedger")
      .withIndex("by_reservation", (q) => q.eq("reservationKey", "finish-once"))
      .collect());
    expect(settles.filter((row) => row.kind === "settle")).toHaveLength(1);
  });

  it("settles an unpriced launch response at the admitted hard-cap exposure", async () => {
    const { t, roomId } = await setup();
    const started = await t.mutation(providerSpendInternal.begin, beginArgs(roomId, { reservationKey: "unpriced-cap" }));
    await completeProviderSpend({
      runMutation: (_reference, args) => t.mutation(providerSpendInternal.finish, args),
    }, started.admission, {
      model: "test-model",
      success: false,
      error: "provider returned no usage",
    });

    const run = await t.run((ctx) => ctx.db.get(started.admission.runId));
    expect(run).toMatchObject({
      costUsd: started.admission.decision.projectedUsd,
      stopReason: "error",
      handoff: { providerSpend: { costBasis: "estimate_upper_bound" } },
    });
    const reservation = await t.run((ctx) => ctx.db.query("creditReservations")
      .withIndex("by_reservation", (q) => q.eq("reservationKey", "unpriced-cap"))
      .unique());
    expect(reservation).toMatchObject({
      status: "resolved",
      actualUsd: started.admission.decision.projectedUsd,
    });
  });

  it("allows unmetered development work without creating a wallet hold", async () => {
    process.env.NODEAGENT_LAUNCH_MODE = "development";
    process.env.CREDITS_ENFORCED = "false";
    const { t, roomId } = await setup(0);
    const result = await t.mutation(providerSpendInternal.begin, beginArgs(roomId, {
      route: "embedding",
      metering: "unavailable",
      reservationKey: "local-embedding",
    }));
    expect(result.admission).toMatchObject({ execute: true, creditsReserved: false });
    const reservations = await t.run((ctx) => ctx.db.query("creditReservations").collect());
    expect(reservations).toHaveLength(0);
  });
});
