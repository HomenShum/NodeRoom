"use node";

/**
 * The agent runtime on Convex.
 *
 * This is the production entry point. It is intentionally tiny: build a
 * ConvexRoomTools (the Convex-backed port), pick the real model, and call the
 * SAME runAgent the demo/tests use. The action returns a summary; the live
 * effects (locks, edits, traces, chat) are written through the mutations and
 * stream to every client via their reactive useQuery subscriptions.
 *
 * Requires the selected provider key in the Convex environment, e.g.
 *   npx convex env set OPENROUTER_API_KEY sk-or-...
 *
 * For thread/message persistence, retries past the 10-min action cap, and RAG,
 * wrap this with `@convex-dev/agent` + `@convex-dev/workflow` (see docs/STACK.md);
 * the harness below is the same loop those components run.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { actorProofV } from "./lib";
import { ConvexRoomTools } from "./convexRoomTools";
import type { Actor } from "../src/engine/types";

/** Explicit return type — breaks the circular inference from referencing `api` inside an action that is itself in `api`. */
type RunResult = {
  finalText: string; jobId: Id<"agentJobs">; roomId: Id<"rooms">; agentId: string; model: string; goal: string;
  steps: number; toolCalls: number; conflictsSurvived: number; inputTokens: number; outputTokens: number;
  costUsd: number; ms: number; exhausted: boolean; stopReason: string; remainingMs: number | null; deadlineAt: number;
  modelCalls: number; runId: Id<"agentRuns"> | null; handoff: unknown | null;
};
import { AgentRunError, runAgent } from "../src/nodeagent/core/runtime";
import type { AgentTraceEvent } from "../src/nodeagent/core/types";
import { SERVER_PRODUCTION_ROOM_TOOLS as PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/skills/server/productionTools";
import { MANAGED_LOCK_SYSTEM_PROMPT } from "../src/nodeagent/models/prompts/systemPrompt";
import { convexModel as agentModel, convexPriceRun as priceRun } from "../src/nodeagent/models/convexModel";
import { buildResearchContext, buildNoteContext, buildWallContext } from "../src/nodeagent/core/worldModel";
import { injectMemoryIntoSystemPrompt } from "../src/nodemem/memoryContextBuilder";
import { nodeMemInjectionEnabled, nodeMemRoomConfigEnabled } from "./nodemem";
import { runIdempotencyKey } from "../src/nodeagent/core/idempotency";
import { compactMessages } from "../src/nodeagent/core/contextCompactor";
import { journalSliceKey } from "../src/nodeagent/core/journal";
import {
  FREE_FILE_EGRESS_BLOCK_REASON,
  isOpenRouterFreeRoute,
  providerEgressDecision,
  type ProviderEgressArtifact,
  type ProviderEgressEntrypoint,
} from "../src/nodeagent/guardrails/egressPolicy";
import { buildPlanPreview, classifyIntakeMessage } from "../src/nodeagent/core/intakePreflight";
import { makeConvexStepJournal } from "./agentStepJournalClient";

const CONVEX_ACTION_LIMIT_MS = 10 * 60_000;
const DEFAULT_ACTION_RESERVE_MS = 30_000;
const MIN_ACTION_RESERVE_MS = 10_000;
const ACTION_SAFETY_MARGIN_MS = 15_000;
const DEFAULT_CONTEXT_MAX_CHARS = 24_000;
const DEFAULT_CONTEXT_KEEP_RECENT = 10;
const DEFAULT_FILE_EGRESS_MODEL = "z-ai/glm-4.7-flash";
const roomsFullRef = makeFunctionReference<"query">("rooms:full");
const agentJobsCreateOrReuseRef = makeFunctionReference<"mutation">("agentJobs:createOrReuse") as any;
const agentJobsFinishInteractiveRef = makeFunctionReference<"mutation">("agentJobs:finishInteractive") as any;
const agentJobsRecordLiveOperationRef = makeFunctionReference<"mutation">("agentJobs:recordLiveOperation") as any;
const agentRunsClaimOrReuseRef = makeFunctionReference<"mutation">("agentRuns:claimOrReuse") as any;
const agentRunsFinishRef = makeFunctionReference<"mutation">("agentRuns:finish") as any;
const agentStepsRecordRef = makeFunctionReference<"mutation">("agentSteps:record") as any;
const roomSpendSinceRef = makeFunctionReference<"query">("agentRuns:roomSpendSince") as any;
const globalSpendSinceRef = makeFunctionReference<"query">("agentRuns:globalSpendSince") as any;
// Credit wallet (Phase B). reserve→settle around the run. INERT unless CREDITS_ENFORCED=true; even
// then it only meters ENROLLED rooms (credits.reserve passes through unmetered for un-granted rooms),
// so the live /ask path is unchanged until Homen seeds grants + flips the flag.
const creditsReserveRef = makeFunctionReference<"mutation">("credits:reserve") as any;
const creditsSettleRef = makeFunctionReference<"mutation">("credits:settle") as any;
const creditsEnforced = (): boolean => process.env.CREDITS_ENFORCED === "true";
const artifactsListProposalsRef = makeFunctionReference<"query">("artifacts:listProposals") as any;
const postPrivateReplyRef = makeFunctionReference<"mutation">("messages:postPrivateAgentReply") as any;
const messagesSendAgentRef = makeFunctionReference<"mutation">("messages:sendAgent") as any;
const ensurePersonalPublicSessionRef = makeFunctionReference<"mutation">("collab:ensurePersonalPublicSession") as any;
const nodememAssembleContextPackRef = makeFunctionReference<"query">("nodemem:assembleContextPackForJob") as any;

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function boundedActionBudgetMs(requestedBudgetMs: number, reserveMs: number, minimumBudgetMs: number): number {
  const ceiling = Math.max(minimumBudgetMs, CONVEX_ACTION_LIMIT_MS - reserveMs - ACTION_SAFETY_MARGIN_MS);
  return Math.max(minimumBudgetMs, Math.min(requestedBudgetMs, ceiling));
}

function configuredFileEgressModel() {
  for (const candidate of [
    process.env.AGENT_FILE_EGRESS_MODEL,
    process.env.AGENT_MODEL_FILE_EGRESS,
    DEFAULT_FILE_EGRESS_MODEL,
    process.env.AGENT_MODEL,
    process.env.AGENT_TOP_PAID_MODEL,
  ]) {
    const value = candidate?.trim();
    if (value && !isOpenRouterFreeRoute(value)) return value;
  }
  return DEFAULT_FILE_EGRESS_MODEL;
}

function providerEgressArtifactsFromRoomState(roomState: { artifacts: Array<{ title: string; kind: string; meta?: unknown; visibility?: string }> }): ProviderEgressArtifact[] {
  return roomState.artifacts.map((art: { title: string; kind: string; meta?: unknown; visibility?: string }) => ({
    title: art.title,
    kind: art.kind,
    meta: art.meta,
    visibility: art.visibility,
  }));
}

function modelNameForEgress(modelName: string, entrypoint: ProviderEgressEntrypoint, artifacts: ProviderEgressArtifact[]) {
  const decision = providerEgressDecision({ model: modelName, entrypoint, artifacts, env: process.env });
  return !decision.ok && decision.reason === FREE_FILE_EGRESS_BLOCK_REASON ? configuredFileEgressModel() : modelName;
}

type LiveOperationKind = "action" | "query" | "mutation" | "model_call" | "tool_call" | "scheduler" | "lease" | "checkpoint";

const QUERY_TOOLS = new Set(["snapshot", "list_artifacts", "awareness", "read_range", "search_sheet_context", "fetch_source", "read_notebook"]);
const MUTATION_TOOLS = new Set(["propose_lock", "release_lock", "edit_cell", "create_draft", "say", "update_wiki", "append_notebook_outline", "write_cell_result", "write_locked_cell", "write_locked_cell_result", "write_locked_cells", "write_locked_cell_results"]);

function liveOperationKind(event: AgentTraceEvent): LiveOperationKind {
  if (event.tool === "handoff" || event.tool === "compaction") return "checkpoint";
  if (QUERY_TOOLS.has(event.tool)) return "query";
  if (MUTATION_TOOLS.has(event.tool)) return "mutation";
  return "tool_call";
}

function liveOperationName(event: AgentTraceEvent): string {
  const result = event.result as { error?: unknown; conflict?: unknown; locked?: unknown; pendingApproval?: unknown } | null;
  const suffix = toolResultFailed(result) ? " failed" : result?.conflict ? " conflict" : result?.locked ? " blocked" : result?.pendingApproval ? " needs review" : "";
  return `${event.tool}${suffix}`;
}

function toolResultFailed(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const object = result as Record<string, unknown>;
  if (object.pendingApproval === true) return false;
  return object.ok === false || typeof object.error === "string";
}

function notebookAffectedIds(args: unknown, result: unknown): string[] {
  const artifactId = String((args as { artifactId?: unknown } | null)?.artifactId ?? "");
  const blockIds = Array.isArray((result as { blockIds?: unknown[] } | null)?.blockIds)
    ? (result as { blockIds: unknown[] }).blockIds.map((id) => String(id || "")).filter(Boolean)
    : [];
  const out = new Set<string>();
  if (artifactId) out.add(artifactId);
  for (const blockId of blockIds) out.add(artifactId ? `${artifactId}:blk:${blockId}` : blockId);
  return [...out].slice(0, 20);
}

function liveOperationAffectedIds(event: AgentTraceEvent): string[] | undefined {
  const out = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string" && value.length <= 120) out.add(value);
    else if (Array.isArray(value)) for (const item of value) visit(item);
  };
  const args = event.args as { elementId?: unknown; elementIds?: unknown; artifactId?: unknown } | null;
  visit(args?.artifactId);
  visit(args?.elementId);
  visit(args?.elementIds);
  if (event.tool === "append_notebook_outline") for (const id of notebookAffectedIds(event.args, event.result)) out.add(id);
  return out.size ? [...out].slice(0, 20) : undefined;
}

export const runRoomAgent = action({
  args: {
    roomId: v.id("rooms"),
    artifactId: v.id("artifacts"),
    requester: actorProofV,
    goal: v.string(),
    maxSteps: v.optional(v.number()),
    mode: v.optional(v.union(v.literal("variance"), v.literal("research"))),
    // When set, run as this member's PERSONAL agent acting publicly (attributed via ownerId) instead of the shared Room agent.
    asOwner: v.optional(v.object({ id: v.string(), name: v.string() })),
  },
  handler: async (ctx, a): Promise<RunResult> => {
    const t0 = Date.now();
    if (a.goal.length > 2_000) throw new Error("goal_too_long");
    const roomState = await ctx.runQuery(roomsFullRef, { roomId: a.roomId, requester: a.requester });
    if (!roomState) throw new Error("room_not_found");
    const requester = roomState.members.find((m: { id: unknown; name?: string }) => String(m.id) === a.requester.actor.id);
    if (!requester) throw new Error("member_required");
    const targetArtifact = roomState.artifacts.find((art: { id: unknown }) => String(art.id) === String(a.artifactId)) as { id: unknown; version?: number; kind?: string; title?: string; order?: string[]; meta?: unknown } | undefined;
    if (!targetArtifact) throw new Error("artifact_room_mismatch");
    let actor: Actor;
    let sessionId: string;
    if (a.asOwner) {
      // Personal agent acting publicly for a member: edits the shared sheet + posts public chat, attributed
      // via ownerId. Reuses this whole runner (idempotency, jobs, CAS, proposals, traces) — no fork of the spine.
      if (a.asOwner.id !== a.requester.actor.id) throw new Error("owner_mismatch");
      const ownerId = a.requester.actor.id;
      const sid = await ctx.runMutation(ensurePersonalPublicSessionRef, { roomId: a.roomId, ownerId });
      actor = { kind: "agent", id: "agent_priv", name: "Your NodeAgent", scope: "public", ownerId };
      sessionId = String(sid);
    } else {
      const session = roomState.sessions.find((s: { scope?: string; ownerId?: string; agentId: string; agentName: string; id: unknown }) => s.scope === "public" && !s.ownerId);
      if (!session) throw new Error("agent_session_mismatch");
      actor = { kind: "agent", id: session.agentId, name: session.agentName, scope: "public" };
      sessionId = String(session.id);
    }
    // Production gate — cumulative daily spend cap. Per-run/slice ceilings bound ONE run; this bounds
    // the SUM across runs so a public /ask surface can't be driven into runaway cost (the cross-run
    // gap the spend ceilings cannot cover). Substrate: agentRuns.costUsd + the by_room index.
    const dailyCapUsd = envNumber("ROOM_MAX_USD_PER_DAY", 10, 0.1, 10_000);
    const spentToday: number = await ctx.runQuery(roomSpendSinceRef, { roomId: a.roomId, since: t0 - 24 * 60 * 60 * 1000 });
    if (spentToday >= dailyCapUsd) throw new Error("room_daily_spend_cap");
    // Experiment gate — global monthly budget across ALL rooms ($100 experiment: $75 LLM envelope).
    // The error carries distinct-room attribution so a breach is diagnosable at a glance:
    // many rooms = real-user growth (the signal we WANT — raise budget / start charging);
    // one room = runaway (the daily cap above should have contained it first — investigate).
    // truncated:true fails closed: an undercounted window must not wave runs through.
    const monthlyCapUsd = envNumber("GLOBAL_MAX_USD_PER_MONTH", 75, 1, 1_000_000);
    const monthly = await ctx.runQuery(globalSpendSinceRef, { since: t0 - 30 * 24 * 60 * 60 * 1000 });
    if (monthly.truncated || monthly.totalUsd >= monthlyCapUsd) {
      throw new Error(`global_monthly_spend_cap:spentUsd=${monthly.totalUsd.toFixed(2)}:rooms=${monthly.distinctRooms}:runs=${monthly.runCount}`);
    }
    // MVP demo posture: the old 10-step interactive default visibly paused mid-workflow in
    // live browser verification. Keep a hard bound, but bias the public `/ask` lane toward
    // completion so a normal demo does not require the user to know a manual "resume" command.
    const requestedSteps = a.maxSteps ?? (a.mode === "research" ? 80 : 40);
    const maxSteps = Math.max(1, Math.min(requestedSteps, a.mode === "research" ? 96 : 64));
    const idempotencyKey = runIdempotencyKey({ roomId: String(a.roomId), artifactId: String(a.artifactId), actorId: String(a.requester.actor.id), goal: a.goal });
    // Credit wallet reserve (flag-gated). Blocks an out-of-credits / paused ENROLLED room like the
    // spend caps above; un-enrolled rooms pass through unmetered. Settled with actual cost after finish
    // (and the sweep cron refunds the hold if a run dies before settling). Keyed by idempotencyKey so a
    // reused run does not double-hold.
    const creditReservationKey = idempotencyKey;
    const creditMode = a.mode === "research" ? "deep" : "standard";
    if (creditsEnforced()) {
      const reservation = await ctx.runMutation(creditsReserveRef, { roomId: a.roomId, mode: creditMode, reservationKey: creditReservationKey });
      if (reservation && reservation.ok === false) throw new Error(`credit_${reservation.reason}`);
    }
    const intake = classifyIntakeMessage(a.goal);
    const pendingProposals = await ctx.runQuery(artifactsListProposalsRef, { roomId: a.roomId, requester: a.requester }) as Array<{ artifactId?: unknown; op?: unknown }>;
    const pendingProposalRefs = pendingProposals
      .filter((p) => String(p.artifactId) === String(a.artifactId))
      .map((p) => (p.op as { elementId?: unknown } | null)?.elementId)
      .filter((id): id is string => typeof id === "string");
    const planPreview = buildPlanPreview({
      decision: intake,
      targetArtifacts: [String(a.artifactId)],
      intendedWriteSet: targetArtifact.order ?? [],
      pendingProposals: pendingProposalRefs,
    });
    if (planPreview.scheduling !== "run_now") {
      const finalText = `PlanPreview blocked this run (${planPreview.scheduling}): ${planPreview.conflicts[0]?.detail ?? intake.reason}`;
      const jobClaim = await ctx.runMutation(agentJobsCreateOrReuseRef, {
        roomId: a.roomId,
        artifactId: a.artifactId,
        requester: a.requester,
        goal: a.goal,
        entrypoint: "public_ask",
        scope: "public_room",
        modelPolicy: "not_started",
        idempotencyKey,
        mode: a.mode,
        maxAttempts: 1,
        approvalPolicy: "auto_commit_safe",
        evidencePolicy: "public_only",
        autoAllow: true,
        traceLevel: "full_operation_ledger",
        initialStatus: "blocked",
        planPreview,
        error: finalText,
        request: {
          roomId: String(a.roomId),
          targetArtifactId: String(a.artifactId),
          commandText: a.goal,
          entrypoint: "public_ask",
          scope: "public_room",
          approvalPolicy: "auto_commit_safe",
          evidencePolicy: "public_only",
          maxSteps,
          traceLevel: "full_operation_ledger",
          idempotencyKey,
        },
      }) as { jobId: Id<"agentJobs">; reused: boolean; status: string };
      const ms = Date.now() - t0;
      await ctx.runMutation(messagesSendAgentRef, {
        roomId: a.roomId,
        channel: "public",
        author: actor,
        text: finalText.slice(0, 4_000),
        clientMsgId: `plan-blocked-${String(jobClaim.jobId)}`,
        kind: "agent",
      });
      // Release the credit hold immediately — this run was blocked before any spend (no run yet).
      // (Other early exits before the run, e.g. egress-blocked, are reclaimed by the sweep cron.)
      if (creditsEnforced()) await ctx.runMutation(creditsSettleRef, { roomId: a.roomId, reservationKey: creditReservationKey, actualUsd: 0 });
      return {
        finalText,
        jobId: jobClaim.jobId,
        roomId: a.roomId,
        agentId: actor.id,
        model: "not_started",
        goal: a.goal,
        steps: 0,
        toolCalls: 0,
        conflictsSurvived: 0,
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        ms,
        exhausted: false,
        stopReason: "plan_blocked",
        remainingMs: null,
        deadlineAt: t0,
        modelCalls: 0,
        runId: null,
        handoff: { reason: "plan_blocked", planPreview },
      };
    }
    // Route promotion is per-LANE, by evidence (never price alone):
    //  - research (background synthesis): deepseek-v4-flash — first route to clear the v3 composite-
    //    synthesis benchmark 9/9 at $0.0034/run (docs/eval/results.json; ~300x cheaper than gemini-3.5-flash's
    //    measured $1.10/task). Evidence covers the fetch->synthesize->write shape ONLY.
    //  - interactive collaboration (lock/CAS/draft): stays on gemini-3.5-flash, the only route with a
    //    recorded L1-L4 collaboration-ladder pass. flash gets this lane only after it passes the ladder.
    const egressArtifacts = providerEgressArtifactsFromRoomState(roomState);
    const requestedModelName = a.mode === "research"
      ? (process.env.AGENT_RESEARCH_MODEL ?? "minimax/minimax-m3")
      : (process.env.AGENT_MODEL ?? "gemini-3.5-flash");
    const model = agentModel(modelNameForEgress(requestedModelName, "public_ask", egressArtifacts), { entrypoint: "public_ask" });
    const egressDecision = providerEgressDecision({
      model: model.name,
      entrypoint: "public_ask",
      artifacts: egressArtifacts,
      env: process.env,
    });
    if (!egressDecision.ok) throw new Error(`provider_egress_blocked:${egressDecision.reason}`);
    const actionReserveMs = Math.max(MIN_ACTION_RESERVE_MS, envNumber("AGENT_ACTION_RESERVE_MS", DEFAULT_ACTION_RESERVE_MS, 1_000, 120_000));
    const actionBudgetMs = boundedActionBudgetMs(
      envNumber("AGENT_ACTION_BUDGET_MS", CONVEX_ACTION_LIMIT_MS, 60_000, CONVEX_ACTION_LIMIT_MS),
      actionReserveMs,
      60_000,
    );
    const deadlineAt = t0 + actionBudgetMs;
    const compaction = {
      maxChars: envNumber("AGENT_CONTEXT_MAX_CHARS", DEFAULT_CONTEXT_MAX_CHARS, 4_000, 120_000),
      keepRecent: envNumber("AGENT_CONTEXT_KEEP_RECENT", DEFAULT_CONTEXT_KEEP_RECENT, 2, 40),
    };
    const cap = (value: unknown) => {
      const s = typeof value === "string" ? value : value === undefined ? "undefined" : JSON.stringify(value) ?? String(value);
      return s.length > 2000 ? s.slice(0, 2000) + "...[truncated]" : s;
    };
    const errorText = (error: unknown) => {
      if (error instanceof Error) return `${error.name}: ${error.message}`;
      return typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
    };
    const stepStatus = (e: { tool: string; result: unknown }): "ok" | "conflict" | "locked" | "error" => {
      const r = (e.result ?? {}) as { ok?: boolean; conflict?: boolean; locked?: boolean; error?: unknown; pendingApproval?: boolean; drafted?: boolean };
      if (e.tool === "edit_cell") { if (r.conflict) return "conflict"; if (r.locked) return "locked"; }
      if (e.tool.startsWith("write_locked_cell") && r.drafted) return "ok";
      if (r.pendingApproval) return "ok"; // review mode: proposal filed = success, not an error
      if (r.error || r.ok === false) return "error";
      return "ok";
    };
    const batchElementIds = (args: unknown) => {
      const ops = (args as { ops?: unknown } | null)?.ops;
      if (!Array.isArray(ops)) return [];
      return ops.map((op) => String((op as { elementId?: unknown } | null)?.elementId ?? "")).filter(Boolean);
    };
    const traceStep = (e: { tool: string; args: unknown; result: unknown; ms: number }, i: number) => {
      const elementId = e.tool === "edit_cell" || e.tool === "write_locked_cell" || e.tool === "write_locked_cell_result"
        ? (String((e.args as { elementId?: string }).elementId ?? "") || undefined)
        : undefined;
      const affectedObjectIds = elementId
        ? [elementId]
        : e.tool === "write_locked_cells" || e.tool === "write_locked_cell_results"
          ? batchElementIds(e.args)
          : e.tool === "append_notebook_outline"
            ? notebookAffectedIds(e.args, e.result)
            : undefined;
      const mutationReceiptId = typeof (e.result as { mutationReceiptId?: unknown } | null)?.mutationReceiptId === "string"
        ? (e.result as { mutationReceiptId: Id<"agentMutationReceipts"> }).mutationReceiptId
        : undefined;
      const batchMutationReceiptIds = Array.isArray((e.result as { results?: unknown[] } | null)?.results)
        ? ((e.result as { results: Array<{ mutationReceiptId?: unknown }> }).results)
          .map((result) => typeof result.mutationReceiptId === "string" ? result.mutationReceiptId as Id<"agentMutationReceipts"> : undefined)
          .filter((id): id is Id<"agentMutationReceipts"> => Boolean(id))
        : [];
      return {
        idx: i, tool: e.tool, args: cap(JSON.stringify(e.args)), result: cap(JSON.stringify(e.result)), status: stepStatus(e), ms: e.ms,
        elementId,
        affectedObjectIds,
        mutationReceiptIds: mutationReceiptId ? [mutationReceiptId] : batchMutationReceiptIds.length ? batchMutationReceiptIds : undefined,
      };
    };
    const checkpointCursor = async (r: {
      messages: unknown[];
      handoff?: { remainingToolCalls?: unknown[] };
      stopReason: string;
    }) => {
      const compacted = await compactMessages(r.messages as any, compaction);
      return {
        messages: compacted.messages,
        remainingToolCalls: r.handoff?.remainingToolCalls ?? [],
        stopReason: r.stopReason,
        compacted: compacted.compacted,
        elided: compacted.elided,
        updatedAt: Date.now(),
      };
    };
    // Idempotency (async_reliability layer 1): a double-submit / client retry must not launch a second
    // concurrent run racing the same locks/CAS. ATOMIC claim-or-reuse (one serializable mutation) — no
    // TOCTOU window between the dedup check and the claim. Runtime-proven in tests/idempotencyRuntime.test.ts.
    const jobClaim = await ctx.runMutation(agentJobsCreateOrReuseRef, {
      roomId: a.roomId,
      artifactId: a.artifactId,
      requester: a.requester,
      goal: a.goal,
      entrypoint: "public_ask",
      scope: "public_room",
      modelPolicy: model.name,
      idempotencyKey,
      mode: a.mode,
      maxAttempts: a.mode === "research" ? 40 : 20,
      approvalPolicy: "auto_commit_safe",
      evidencePolicy: "public_only",
      autoAllow: true,
      traceLevel: "full_operation_ledger",
      request: {
        roomId: String(a.roomId),
        targetArtifactId: String(a.artifactId),
        commandText: a.goal,
        entrypoint: "public_ask",
        scope: "public_room",
        approvalPolicy: "auto_commit_safe",
        evidencePolicy: "public_only",
        maxSteps,
        traceLevel: "full_operation_ledger",
        idempotencyKey,
      },
    }) as { jobId: Id<"agentJobs">; reused: boolean; status: string; latestRunId?: Id<"agentRuns"> };
    const jobId = jobClaim.jobId;
    const rt = new ConvexRoomTools(ctx, a.roomId, a.artifactId, actor, sessionId, jobId);
    const modelJournal = makeConvexStepJournal({
      ctx,
      jobId,
      sliceKey: journalSliceKey({
        entrypoint: "public_ask",
        jobId: String(jobId),
        artifactId: String(a.artifactId),
        artifactVersion: targetArtifact.version ?? null,
        goal: a.goal,
        mode: a.mode ?? "variance",
        modelPolicy: model.name,
        maxSteps,
      }),
      modelName: () => model.name,
    });
    const claim = await ctx.runMutation(agentRunsClaimOrReuseRef, { jobId, roomId: a.roomId, agentId: actor.id, model: model.name, goal: a.goal, idempotencyKey }) as {
      runId: Id<"agentRuns">;
      reused: boolean;
      row: null | {
        _id: Id<"agentRuns">; model: string; steps: number; toolCalls: number; conflictsSurvived: number;
        inputTokens: number; outputTokens: number; costUsd: number; ms: number; exhausted: boolean;
        stopReason?: string; remainingMs?: number; deadlineAt?: number; handoff?: unknown;
      };
    };
    if (claim.reused && claim.row) {
      const row = claim.row;
      return {
        finalText: row.stopReason ? "Deduplicated: an identical run just completed." : "Deduplicated: an identical run is already in progress.",
        jobId, roomId: a.roomId, agentId: actor.id, model: row.model, goal: a.goal,
        steps: row.steps, toolCalls: row.toolCalls, conflictsSurvived: row.conflictsSurvived,
        inputTokens: row.inputTokens, outputTokens: row.outputTokens, costUsd: row.costUsd, ms: row.ms, exhausted: row.exhausted,
        stopReason: row.stopReason ?? "in_flight", remainingMs: row.remainingMs ?? null, deadlineAt: row.deadlineAt ?? deadlineAt,
        modelCalls: 0, runId: row._id, handoff: row.handoff ?? null,
      };
    }
    const runId = claim.runId;
    let liveSequence = 1_000;
    const liveWrites: Array<Promise<unknown>> = [];
    const recordLiveOperation = (args: {
      kind: LiveOperationKind;
      name: string;
      status?: "started" | "completed" | "failed" | "skipped";
      countDelta?: number;
      affectedIds?: string[];
      startedAt?: number;
      completedAt?: number;
    }) => {
      const write = ctx.runMutation(agentJobsRecordLiveOperationRef, {
        jobId,
        runId,
        sequence: liveSequence++,
        ...args,
      }).catch(() => null);
      liveWrites.push(write);
      return write;
    };
    await recordLiveOperation({
      kind: "action",
      name: "agent.runRoomAgent",
      status: "started",
      countDelta: 1,
      startedAt: t0,
    });
    await recordLiveOperation({
      kind: "model_call",
      name: model.name,
      status: "started",
      startedAt: Date.now(),
    });

    const persistFailure = async (error: unknown) => {
      const partial = error instanceof AgentRunError ? error.partial : undefined;
      const rootError = error instanceof AgentRunError ? error.cause : error;
      const ms = Date.now() - t0;
      const inputTokens = partial?.usage.inputTokens ?? 0;
      const outputTokens = partial?.usage.outputTokens ?? 0;
      const costUsd = priceRun(model.name, inputTokens, outputTokens);
      const conflictsSurvived = partial?.trace.filter((t) => t.tool === "edit_cell" && (t.result as { conflict?: boolean })?.conflict).length ?? 0;
      const telemetry = {
        roomId: a.roomId, agentId: actor.id, model: model.name, goal: a.goal,
        steps: partial?.steps ?? 0, toolCalls: partial?.trace.length ?? 0, conflictsSurvived,
        inputTokens, outputTokens, costUsd, ms, exhausted: partial?.exhausted ?? false,
        stopReason: partial?.stopReason ?? "error",
        remainingMs: partial?.budget.remainingMs,
        deadlineAt,
        handoff: partial?.handoff,
      };
      await ctx.runMutation(agentRunsFinishRef, { runId, model: model.name, steps: telemetry.steps, toolCalls: telemetry.toolCalls, conflictsSurvived, inputTokens, outputTokens, costUsd, ms, exhausted: telemetry.exhausted, stopReason: telemetry.stopReason, remainingMs: telemetry.remainingMs, deadlineAt, handoff: telemetry.handoff });
      // Settle the credit hold with the ACTUAL (failure-path) cost. No-op unless enforced + enrolled.
      if (creditsEnforced()) await ctx.runMutation(creditsSettleRef, { roomId: a.roomId, reservationKey: creditReservationKey, actualUsd: costUsd, runId });
      await recordLiveOperation({
        kind: "checkpoint",
        name: "agent.runRoomAgent failed",
        status: "failed",
        countDelta: 1,
        completedAt: Date.now(),
      });
      await Promise.allSettled(liveWrites);
      await ctx.runMutation(agentJobsFinishInteractiveRef, {
        jobId,
        runId,
        status: "failed",
        finalText: "Agent run failed.",
        error: errorText(rootError),
        resolvedModel: model.name,
        stopReason: telemetry.stopReason,
        ms,
        inputTokens,
        outputTokens,
        costUsd,
        modelCalls: partial?.usage.modelCalls ?? 0,
        toolCalls: telemetry.toolCalls,
      });
      const priorSteps = partial?.trace.map(traceStep) ?? [];
      await ctx.runMutation(agentStepsRecordRef, {
        jobId, runId, roomId: a.roomId, agentId: actor.id,
        steps: [...priorSteps, {
          idx: priorSteps.length,
          tool: "run_error",
          args: cap(JSON.stringify({ goal: a.goal, mode: a.mode ?? "variance", maxSteps })),
          result: cap(errorText(rootError)),
          status: "error",
          ms,
        }],
      });
    };

    let result;
    try {
      // NodeMem Phase 3: when injection is enabled (NODEMEM_MODE=active_ab), fetch the
      // ContextPack from Convex and inject it into the system prompt as bounded memory context.
      let systemPrompt: string = MANAGED_LOCK_SYSTEM_PROMPT;
      if (nodeMemInjectionEnabled() || nodeMemRoomConfigEnabled()) {
        try {
          const pack = await ctx.runQuery(nodememAssembleContextPackRef, {
            roomId: a.roomId,
            goal: a.goal,
            userId: String(a.requester.actor.id),
            maxFacts: 30,
            // budget intentionally omitted — the query resolves the per-room budget (600 bounded / 1200 full)
          });
          if (pack) {
            const budget = (pack as { maxTokensBudget?: number }).maxTokensBudget ?? 1200;
            systemPrompt = injectMemoryIntoSystemPrompt(systemPrompt, pack as never, { maxTokens: budget });
          }
        } catch {
          // Memory injection must never block the agent run — fail silently to the base prompt.
        }
      }
      result = await runAgent({
        rt,
        goal: a.goal,
        model,
        tools: PRODUCTION_ROOM_TOOLS,
        systemPrompt,
        maxSteps,
        // Route the JIT context by artifact kind so the agent can edit ANY artifact, not just the
        // variance sheet: research sheet → research builder; note → note builder; wall → wall builder;
        // any other sheet → the default variance/sheet builder (runtime falls back when undefined).
        contextBuilder: a.mode === "research" ? buildResearchContext : targetArtifact.kind === "note" ? buildNoteContext : targetArtifact.kind === "wall" ? buildWallContext : undefined,
        compaction,
        journal: modelJournal,
        deadlineAt,
        reserveMs: actionReserveMs,
        // P0-4: interactive runs get the same token + dollar ceiling as the durable lane.
        spendLimits: {
          maxTokens: envNumber("AGENT_MAX_TOKENS_PER_RUN", 250_000, 1_000, 4_000_000),
          maxCostUsd: envNumber("AGENT_MAX_USD_PER_RUN", 2, 0.01, 100),
        },
        priceStep: (modelName, inputTokens, outputTokens) => priceRun(modelName, inputTokens, outputTokens),
        onTrace: (event) => {
          void recordLiveOperation({
            kind: liveOperationKind(event),
            name: liveOperationName(event),
            status: toolResultFailed(event.result) ? "failed" : "completed",
            countDelta: 1,
            affectedIds: liveOperationAffectedIds(event),
            completedAt: Date.now(),
          });
        },
      });
    } catch (error) {
      await persistFailure(error);
      throw error;
    }
    const ms = Date.now() - t0;

    const costUsd = priceRun(model.name, result.usage.inputTokens, result.usage.outputTokens);
    const conflictsSurvived = result.trace.filter((t) => t.tool === "edit_cell" && (t.result as { conflict?: boolean })?.conflict).length;
    const telemetry = {
      roomId: a.roomId, agentId: actor.id, model: model.name, goal: a.goal,
      steps: result.steps, toolCalls: result.trace.length, conflictsSurvived,
      inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cachedInputTokens: result.usage.cachedInputTokens ?? 0, costUsd, ms, exhausted: result.exhausted,
      stopReason: result.stopReason,
      remainingMs: result.budget.remainingMs,
      deadlineAt,
      handoff: result.handoff,
    };
    // Patch the claimed run row with final telemetry + the APPEND-ONLY step-level trace (audit + trajectory eval).
    await ctx.runMutation(agentRunsFinishRef, { runId, model: model.name, steps: telemetry.steps, toolCalls: telemetry.toolCalls, conflictsSurvived, inputTokens: telemetry.inputTokens, outputTokens: telemetry.outputTokens, costUsd, ms, exhausted: telemetry.exhausted, stopReason: telemetry.stopReason, remainingMs: telemetry.remainingMs, deadlineAt, handoff: telemetry.handoff });
    // Settle the credit hold with the ACTUAL cost. No-op unless enforced + enrolled.
    if (creditsEnforced()) await ctx.runMutation(creditsSettleRef, { roomId: a.roomId, reservationKey: creditReservationKey, actualUsd: costUsd, runId });
    const done = result.stopReason === "done" && !result.exhausted;
    const scheduledNextAt = done ? undefined : Date.now() + 5_000;
    const cursor = done ? undefined : await checkpointCursor(result);
    await recordLiveOperation({
      kind: "model_call",
      name: model.name,
      status: "completed",
      countDelta: result.usage.modelCalls,
      completedAt: Date.now(),
    });
    await recordLiveOperation({
      kind: "checkpoint",
      name: done ? "agent.runRoomAgent completed" : "agent.runRoomAgent paused",
      status: done ? "completed" : "skipped",
      countDelta: 1,
      completedAt: Date.now(),
    });
    await Promise.allSettled(liveWrites);
    await ctx.runMutation(agentJobsFinishInteractiveRef, {
      jobId,
      runId,
      status: done ? "completed" : "paused",
      finalText: result.finalText,
      handoff: result.handoff,
      cursor,
      scheduledNextAt,
      scheduleWorkflow: !done,
      resolvedModel: model.name,
      stopReason: telemetry.stopReason,
      ms,
      inputTokens: telemetry.inputTokens,
      outputTokens: telemetry.outputTokens,
      costUsd,
      modelCalls: result.usage.modelCalls,
      toolCalls: telemetry.toolCalls,
    });
    await ctx.runMutation(agentStepsRecordRef, {
      jobId, runId, roomId: a.roomId, agentId: actor.id,
      steps: result.trace.map(traceStep),
    });
    // Persistent-visibility guarantee: a run that never say()'d would otherwise end with ZERO
    // visible text in the room — finalText only lands on the agentJobs row, which the chat feed
    // does not render. Post it as a normal agent message, idempotent on runId so a client retry
    // cannot double-post. (Memory mode already does this client-side; this is live-mode parity.)
    const saidSomething = result.trace.some((t) =>
      t.tool === "say" && !(t.result && typeof t.result === "object" && "error" in (t.result as Record<string, unknown>)));
    const visibleFallback = result.finalText.trim() || fallbackVisibleAgentSummary(result.trace);
    if (!saidSomething && visibleFallback) {
      await ctx.runMutation(messagesSendAgentRef, {
        roomId: a.roomId,
        channel: actor.scope === "private" && actor.ownerId ? actor.ownerId : "public",
        author: actor,
        text: visibleFallback.slice(0, 4_000),
        clientMsgId: `final-${String(runId)}`,
        kind: "agent",
      });
    }
    return {
      finalText: result.finalText,
      jobId,
      ...telemetry,
      remainingMs: result.budget.remainingMs ?? null,
      handoff: result.handoff ?? null,
      modelCalls: result.usage.modelCalls,
      runId,
    };
  },
});

function fallbackVisibleAgentSummary(trace: Array<{ tool: string; args: unknown; result: unknown }>): string {
  for (const step of [...trace].reverse()) {
    if (!step.tool.startsWith("write_locked_cell") && step.tool !== "edit_cell") continue;
    const result = step.result as { ok?: boolean; pendingApproval?: boolean; drafted?: boolean; error?: unknown } | null;
    if (result?.error || result?.ok === false) continue;
    const args = step.args as { elementId?: unknown; value?: unknown; ops?: Array<{ elementId?: unknown; value?: unknown }> } | null;
    const op = Array.isArray(args?.ops) ? args?.ops[0] : args;
    const elementId = typeof op?.elementId === "string" ? op.elementId : "the requested cell";
    const value = op?.value === undefined ? "" : ` = ${String(op.value)}`;
    if (result?.pendingApproval) return `Filed the requested proposal for ${elementId}${value}.`;
    if (result?.drafted) return `Drafted the requested edit for ${elementId}${value}.`;
    return `Completed the requested room edit: ${elementId}${value}.`;
  }
  return trace.length ? "Completed the requested room work." : "";
}

/** Summarize the room (artifacts + sheet state) as bounded, read-only context for a private consult. */
/** Shared between runPrivateAgent (blocking fallback) and the streaming httpAction
 *  (convex/http.ts) so the two private-reply paths can never drift apart in tone or rules. */
export function privateAgentSystemPrompt(requesterName: string): string {
  return `You are ${requesterName}'s PRIVATE NodeAgent inside a live collaborative room (a shared spreadsheet, notes, and chat). You may READ the room as context, but your reply is PRIVATE to ${requesterName} until they choose to promote it to the public chat. Be concise (2-4 sentences), concrete, and grounded in the room context. You only advise — never claim to have edited shared data.`;
}

export function summarizeRoomForPrivate(roomState: {
  room: { title: string };
  members: unknown[];
  artifacts: Array<{ kind: string; title: string; version: number; order: string[]; elements: Record<string, { value?: unknown }> }>;
}): string {
  const lines: string[] = [`Room "${roomState.room.title}" · ${roomState.members.length} members`];
  for (const art of roomState.artifacts.slice(0, 4)) {
    lines.push(`Artifact "${art.title}" [${art.kind}] v${art.version}`);
    if (art.kind === "sheet") {
      const rows: string[] = [];
      for (const k of art.order) { const r = String(k).split("__")[0]; if (!rows.includes(r)) rows.push(r); }
      for (const rid of rows.slice(0, 8)) {
        const label = art.elements[`${rid}__label`]?.value ?? rid;
        const q3 = art.elements[`${rid}__q3`]?.value ?? "";
        const variance = art.elements[`${rid}__variance`]?.value ?? "";
        lines.push(`  - ${String(label)}: Q3=${String(q3)} variance=${variance ? String(variance) : "(empty)"}`);
      }
    }
  }
  const text = lines.join("\n");
  return text.length > 1800 ? text.slice(0, 1800) + "…" : text;
}

/**
 * Private NodeAgent — a per-user consult. Reads the room as context, makes ONE model call (no tools, so
 * it never mutates canonical state), and posts a reply to the requester's OWN private channel. Output is
 * private until the user promotes it. Distinct from runRoomAgent (which edits the shared sheet publicly).
 */
export const runPrivateAgent = action({
  args: { roomId: v.id("rooms"), requester: actorProofV, goal: v.string() },
  handler: async (ctx, a): Promise<{ ok: boolean; answer: string; model: string }> => {
    if (a.goal.length > 2_000) throw new Error("goal_too_long");
    const roomState = await ctx.runQuery(roomsFullRef, { roomId: a.roomId, requester: a.requester });
    if (!roomState) throw new Error("room_not_found");
    const requester = roomState.members.find((m: { id: unknown }) => String(m.id) === a.requester.actor.id) as { id: unknown; name: string } | undefined;
    if (!requester) throw new Error("member_required");
    const egressArtifacts = providerEgressArtifactsFromRoomState(roomState);
    const model = agentModel(modelNameForEgress(process.env.AGENT_MODEL ?? "gemini-3.5-flash", "private_agent", egressArtifacts), { entrypoint: "private_agent" });
    const egressDecision = providerEgressDecision({
      model: model.name,
      entrypoint: "private_agent",
      artifacts: egressArtifacts,
      env: process.env,
    });
    if (!egressDecision.ok) throw new Error(`provider_egress_blocked:${egressDecision.reason}`);
    const system = privateAgentSystemPrompt(requester.name);
    const userMsg = `ROOM CONTEXT\n${summarizeRoomForPrivate(roomState)}\n\n${requester.name} asks: ${a.goal}`;
    let answer = "";
    try {
      const step = await model.next({ system, messages: [{ role: "user", content: userMsg }], tools: [] });
      answer = (step.text ?? "").trim();
    } catch (error) {
      answer = `(private agent error: ${error instanceof Error ? error.message : "model call failed"})`;
    }
    if (!answer) answer = "I read the room but have nothing to add yet — ask me something specific about the data.";
    const clientMsgId = `priv-${String(requester.id)}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    await ctx.runMutation(postPrivateReplyRef, { roomId: a.roomId, ownerId: String(requester.id), text: answer, clientMsgId });
    return { ok: true, answer, model: model.name };
  },
});
