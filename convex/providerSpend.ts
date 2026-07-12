import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { getRoomCreditGate, reserveRoomCredits, settleRoomCredits } from "./credits";
import { collectLaunchUsageSnapshot } from "./usageLimits";
import {
  creditModeForJob,
  creditsEnforcedFromEnv,
  evaluateLaunchAdmission,
  launchAdmissionModeFromEnv,
  launchPauseStateFromEnv,
  type LaunchAdmissionDecision,
} from "../src/launch/budgetPolicy";
import type { AgentCreditMode } from "../src/nodeagent/core/creditModel";

export type ProviderSpendRoute =
  | "private_agent"
  | "private_stream"
  | "voice_stt"
  | "voice_tts"
  | "capture"
  | "embedding";

export type ProviderMetering = "actual" | "unavailable";
export type ProviderCostBasis = "actual" | "estimate_upper_bound";

export type ProviderSpendAdmission = {
  roomId: Id<"rooms">;
  requesterId: string;
  route: ProviderSpendRoute;
  creditMode: AgentCreditMode;
  reservationKey: string;
  runId: Id<"agentRuns">;
  creditsReserved: boolean;
  execute: boolean;
  duplicateReason?: "in_flight" | "completed";
  startedAt: number;
  decision: LaunchAdmissionDecision;
};

const beginProviderSpendRef = makeFunctionReference<"mutation">("providerSpend:begin") as any;
const finishProviderSpendRef = makeFunctionReference<"mutation">("providerSpend:finish") as any;

type ActionLikeCtx = {
  runMutation: (ref: any, args: any) => Promise<any>;
};

export async function beginProviderSpend(ctx: ActionLikeCtx, args: {
  roomId: Id<"rooms">;
  requesterId: string;
  route: ProviderSpendRoute;
  metering: ProviderMetering;
  goal: string;
  modelHint?: string;
  creditMode?: AgentCreditMode;
  reservationKey?: string;
}): Promise<ProviderSpendAdmission> {
  const reservationKey = args.reservationKey?.trim() || `provider:${args.route}:${crypto.randomUUID()}`;
  const payload: Record<string, unknown> = {
    roomId: args.roomId,
    requesterId: args.requesterId,
    route: args.route,
    metering: args.metering,
    goal: args.goal.slice(0, 2_000),
    reservationKey,
  };
  if (args.modelHint?.trim()) payload.modelHint = args.modelHint.trim();
  if (args.creditMode) payload.creditMode = args.creditMode;
  const response = await ctx.runMutation(beginProviderSpendRef, payload) as {
    ok: boolean;
    error?: string;
    admission?: ProviderSpendAdmission;
  };
  if (!response.ok || !response.admission) throw new Error(response.error ?? "launch_admission:provider_begin_failed");
  return response.admission;
}

export async function completeProviderSpend(ctx: ActionLikeCtx, admission: ProviderSpendAdmission, result: {
  model: string;
  success: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  actualUsd?: number;
  error?: string;
}): Promise<void> {
  const actualAvailable = Number.isFinite(result.actualUsd);
  const actualUsd = actualAvailable
    ? Math.max(0, Number(result.actualUsd))
    : admission.decision.projectedUsd;
  const payload: Record<string, unknown> = {
    roomId: admission.roomId,
    requesterId: admission.requesterId,
    route: admission.route,
    creditMode: admission.creditMode,
    reservationKey: admission.reservationKey,
    runId: admission.runId,
    creditsReserved: admission.creditsReserved,
    projectedUsd: admission.decision.projectedUsd,
    model: result.model,
    inputTokens: Math.max(0, Math.floor(result.inputTokens ?? 0)),
    outputTokens: Math.max(0, Math.floor(result.outputTokens ?? 0)),
    actualUsd,
    costBasis: actualAvailable ? "actual" : "estimate_upper_bound",
    success: result.success,
    startedAt: admission.startedAt,
  };
  if (result.cachedInputTokens !== undefined) payload.cachedInputTokens = Math.max(0, Math.floor(result.cachedInputTokens));
  if (result.error) payload.error = result.error.slice(0, 320);
  await ctx.runMutation(finishProviderSpendRef, payload);
}

const routeV = v.union(
  v.literal("private_agent"),
  v.literal("private_stream"),
  v.literal("voice_stt"),
  v.literal("voice_tts"),
  v.literal("capture"),
  v.literal("embedding"),
);
const creditModeV = v.union(v.literal("quick"), v.literal("standard"), v.literal("deep"));
const costBasisV = v.union(v.literal("actual"), v.literal("estimate_upper_bound"));
const meteringV = v.union(v.literal("actual"), v.literal("unavailable"));

export const begin = internalMutation({
  args: {
    roomId: v.id("rooms"),
    requesterId: v.string(),
    route: routeV,
    metering: meteringV,
    goal: v.string(),
    modelHint: v.optional(v.string()),
    creditMode: v.optional(creditModeV),
    reservationKey: v.string(),
  },
  handler: async (ctx, a) => {
    if (!a.requesterId.trim() || a.requesterId.length > 240) throw new Error("invalid_provider_requester");
    if (!a.goal.trim() || a.goal.length > 2_000) throw new Error("invalid_provider_goal");
    if (!a.reservationKey.trim() || a.reservationKey.length > 320) throw new Error("invalid_provider_reservation_key");

    const startedAt = Date.now();
    const launchMode = launchAdmissionModeFromEnv(process.env);
    const creditsEnforced = creditsEnforcedFromEnv(process.env);
    const creditMode = creditModeForJob({ creditMode: a.creditMode });
    const usage = await collectLaunchUsageSnapshot(ctx, {
      roomId: a.roomId,
      requesterId: a.requesterId,
    });
    const roomGate = await getRoomCreditGate(ctx, a.roomId);
    const decision = evaluateLaunchAdmission({
      launchMode,
      creditMode,
      creditsEnforced,
      roomEnrolled: roomGate.enrolled,
      roomPaused: roomGate.paused,
      availableCredits: roomGate.availableCredits,
      ...launchPauseStateFromEnv(process.env),
      usage,
    });
    if (!decision.allowed) return { ok: false as const, error: `launch_admission:${decision.code}` };
    if ((launchMode === "private_pilot" || launchMode === "public_launch") && a.metering === "unavailable") {
      return { ok: false as const, error: `launch_admission:provider_metering_required:${a.route}` };
    }

    const prior = await ctx.db.query("agentRuns")
      .withIndex("by_idempotency", (q) => q.eq("idempotencyKey", a.reservationKey))
      .order("desc")
      .first();
    if (prior) {
      if (String(prior.roomId) !== String(a.roomId)
        || prior.requesterId !== a.requesterId
        || prior.agentId !== `provider:${a.route}`) {
        throw new Error("provider_spend_idempotency_mismatch");
      }
      return {
        ok: true as const,
        admission: {
          roomId: a.roomId,
          requesterId: a.requesterId,
          route: a.route,
          creditMode,
          reservationKey: a.reservationKey,
          runId: prior._id,
          creditsReserved: false,
          execute: false,
          duplicateReason: prior.stopReason ? "completed" as const : "in_flight" as const,
          startedAt: prior.createdAt,
          decision,
        },
      };
    }

    const runId = await ctx.db.insert("agentRuns", {
      roomId: a.roomId,
      requesterId: a.requesterId,
      agentId: `provider:${a.route}`,
      model: a.modelHint?.trim() || "provider_pending",
      goal: a.goal,
      idempotencyKey: a.reservationKey,
      steps: 0,
      toolCalls: 0,
      conflictsSurvived: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      ms: 0,
      exhausted: false,
      createdAt: startedAt,
    });

    let creditsReserved = false;
    if (creditsEnforced) {
      const reservation = await reserveRoomCredits(ctx, {
        roomId: a.roomId,
        mode: creditMode,
        reservationKey: a.reservationKey,
        requesterId: a.requesterId,
        projectedUsd: decision.projectedUsd,
        requireEnrollment: launchMode === "private_pilot" || launchMode === "public_launch",
      });
      if (!reservation.ok) {
        const error = `launch_admission:${reservation.reason}`;
        await ctx.db.patch(runId, {
          model: a.modelHint?.trim() || "provider_not_started",
          stopReason: "launch_admission",
          handoff: { providerSpend: { route: a.route, error } },
        });
        return { ok: false as const, error };
      }
      creditsReserved = reservation.heldCredits > 0;
    }

    return {
      ok: true as const,
      admission: {
        roomId: a.roomId,
        requesterId: a.requesterId,
        route: a.route,
        creditMode,
        reservationKey: a.reservationKey,
        runId,
        creditsReserved,
        execute: true,
        startedAt,
        decision,
      },
    };
  },
});

export const finish = internalMutation({
  args: {
    roomId: v.id("rooms"),
    requesterId: v.string(),
    route: routeV,
    creditMode: creditModeV,
    reservationKey: v.string(),
    runId: v.id("agentRuns"),
    creditsReserved: v.boolean(),
    projectedUsd: v.number(),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cachedInputTokens: v.optional(v.number()),
    actualUsd: v.number(),
    costBasis: costBasisV,
    success: v.boolean(),
    error: v.optional(v.string()),
    startedAt: v.number(),
  },
  handler: async (ctx, a) => {
    const run = await ctx.db.get(a.runId);
    if (!run
      || String(run.roomId) !== String(a.roomId)
      || run.requesterId !== a.requesterId
      || run.idempotencyKey !== a.reservationKey) {
      throw new Error("provider_spend_run_mismatch");
    }
    if (run.stopReason) return { ok: true as const, idempotent: true as const };
    if (a.creditsReserved) {
      const reservationState = await ctx.db.query("creditReservations")
        .withIndex("by_reservation", (q) => q.eq("reservationKey", a.reservationKey))
        .first();
      if (!reservationState || String(reservationState.roomId) !== String(a.roomId)) {
        throw new Error("provider_spend_reservation_missing");
      }
      if (reservationState.status !== "active") throw new Error("provider_spend_reservation_already_resolved");
      const settled = await settleRoomCredits(ctx, {
        roomId: a.roomId,
        reservationKey: a.reservationKey,
        actualUsd: a.actualUsd,
        runId: a.runId,
      });
      if (!settled.ok) throw new Error(`provider_spend_settlement:${settled.reason}`);
    }
    const handoff = {
      providerSpend: {
        route: a.route,
        creditMode: a.creditMode,
        costBasis: a.costBasis,
        projectedUsd: a.projectedUsd,
        ...(a.error ? { error: a.error } : {}),
      },
    };
    const runPatch: Record<string, unknown> = {
      model: a.model,
      steps: 1,
      toolCalls: 0,
      conflictsSurvived: 0,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
      costUsd: Math.max(0, a.actualUsd),
      ms: Math.max(0, Date.now() - a.startedAt),
      exhausted: false,
      stopReason: a.success ? "done" : "error",
      handoff,
    };
    if (a.cachedInputTokens !== undefined) runPatch.cachedInputTokens = a.cachedInputTokens;
    await ctx.db.patch(a.runId, runPatch);
    return { ok: true as const, idempotent: false as const };
  },
});
