/**
 * Durable free-auto job runner.
 *
 * One invocation is a bounded slice. It claims a lease, resumes from the stored
 * cursor, runs the same agent/tool protocol as the live action, writes telemetry,
 * checkpoints, then schedules the next slice if work remains.
 */

import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ConvexRoomTools } from "./convexRoomTools";
import { AgentRunError, runAgent } from "../src/nodeagent/core/runtime";
import { runReasoningFrame, type ReasoningFrameRunReceipt } from "../src/nodeagent/core/frameRunner";
import { PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import { MANAGED_LOCK_SYSTEM_PROMPT } from "../src/nodeagent/models/prompts/systemPrompt";
import { convexModel as agentModel, convexPriceRun as priceRun } from "../src/nodeagent/models/convexModel";
import { buildResearchContext } from "../src/nodeagent/core/worldModel";
import { compactMessages } from "../src/nodeagent/core/contextCompactor";
import type { AgentMessage, AgentResult, AgentTraceEvent, ToolCall } from "../src/nodeagent/core/types";
import type { EvidenceState, FrameDelta, ReasoningFrame, ReasoningFrameStatus } from "../src/nodeagent/core/reasoningFrames";
import type { Actor } from "../src/engine/types";
import { journalSliceKey } from "../src/nodeagent/core/journal";
import { assertProviderEgressAllowed, type ProviderEgressEntrypoint } from "../src/nodeagent/guardrails/egressPolicy";
import { makeConvexStepJournal } from "./agentStepJournalClient";

const CONVEX_ACTION_LIMIT_MS = 10 * 60_000;
const DEFAULT_SLICE_BUDGET_MS = 9 * 60_000;
const DEFAULT_RESERVE_MS = 30_000;
const MIN_ACTION_RESERVE_MS = 10_000;
const ACTION_SAFETY_MARGIN_MS = 15_000;
const DEFAULT_LEASE_EXTRA_MS = 60_000;
const DEFAULT_RESUME_DELAY_MS = 5_000;
const DEFAULT_CONTEXT_MAX_CHARS = 24_000;
const DEFAULT_CONTEXT_KEEP_RECENT = 10;
const agentJobsClaimSliceRef = makeFunctionReference<"mutation">("agentJobs:claimSlice") as any;
const agentJobsFinishSliceRef = makeFunctionReference<"mutation">("agentJobs:finishSlice") as any;
const agentRunsRecordRef = makeFunctionReference<"mutation">("agentRuns:record") as any;
const agentStepsRecordRef = makeFunctionReference<"mutation">("agentSteps:record") as any;
const artifactsListForRoomRef = makeFunctionReference<"query">("artifacts:listForRoom") as any;

type ClaimedJob = {
  jobId: Id<"agentJobs">;
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  requester: Actor;
  goal: string;
  entrypoint?: ProviderEgressEntrypoint;
  scope?: "public_room" | "private_user" | "team";
  approvalPolicy?: "read_only" | "draft_first" | "auto_commit_safe" | "host_review";
  evidencePolicy?: "public_only" | "private_allowed" | "mixed_requires_redaction";
  traceLevel?: "summary" | "standard" | "full_operation_ledger";
  routePolicy?: "fast_default" | "free_auto" | "top_paid" | "explicit";
  runtimePolicy?: "workflow_sliced";
  mode?: "variance" | "research";
  modelPolicy: string;
  cursor?: unknown;
  handoff?: unknown;
  attempt: number;
  maxAttempts: number;
  artifactTitle?: string;
  artifactKind?: string;
  artifactMeta?: unknown;
  artifactVisibility?: string;
  sessionId: Id<"agentSessions">;
  agentId: string;
  agentName: string;
  activeReasoningFrame?: ClaimedReasoningFrame;
};

type ClaimedReasoningFrame = {
  frameId: string;
  parentFrameId?: string;
  jobId?: string;
  goal: string;
  phase: ReasoningFrame["phase"];
  status: ReasoningFrameStatus;
  contextPack: ReasoningFrame["contextPack"];
  toolAllowlist: string[];
  stateDelta?: FrameDelta;
  evidenceState?: EvidenceState;
};

type RunTelemetry = {
  ms: number;
  costUsd: number;
};

type RunRecord = {
  runId: Id<"agentRuns">;
  telemetry: RunTelemetry;
};

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function boundedActionBudgetMs(requestedBudgetMs: number, reserveMs: number, minimumBudgetMs: number): number {
  const ceiling = Math.max(minimumBudgetMs, CONVEX_ACTION_LIMIT_MS - reserveMs - ACTION_SAFETY_MARGIN_MS);
  return Math.max(minimumBudgetMs, Math.min(requestedBudgetMs, ceiling));
}

function cap(s: string): string {
  return s.length > 2_000 ? s.slice(0, 2_000) + "...[truncated]" : s;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
}

function stepStatus(e: { tool: string; result: unknown }): "ok" | "conflict" | "locked" | "error" {
  const r = (e.result ?? {}) as { ok?: boolean; conflict?: boolean; locked?: boolean; error?: unknown; drafted?: boolean };
  if (e.tool === "edit_cell") { if (r.conflict) return "conflict"; if (r.locked) return "locked"; }
  if (e.tool.startsWith("write_locked_cell") && r.drafted) return "ok";
  if (r.error || r.ok === false) return "error";
  return "ok";
}

function batchElementIds(args: unknown) {
  const ops = (args as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops)) return [];
  return ops.map((op) => String((op as { elementId?: unknown } | null)?.elementId ?? "")).filter(Boolean);
}

function traceStep(e: AgentTraceEvent, i: number) {
  const elementId = e.tool === "edit_cell" || e.tool === "write_locked_cell" || e.tool === "write_locked_cell_result"
    ? (String((e.args as { elementId?: string }).elementId ?? "") || undefined)
    : undefined;
  const affectedObjectIds = elementId
    ? [elementId]
    : e.tool === "write_locked_cells" || e.tool === "write_locked_cell_results"
      ? batchElementIds(e.args)
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
    idx: i,
    tool: e.tool,
    args: cap(JSON.stringify(e.args)),
    result: cap(JSON.stringify(e.result)),
    status: stepStatus(e),
    ms: e.ms,
    elementId,
    affectedObjectIds,
    mutationReceiptIds: mutationReceiptId ? [mutationReceiptId] : batchMutationReceiptIds.length ? batchMutationReceiptIds : undefined,
  };
}

function cursorFrameId(cursor: unknown): string | undefined {
  const value = cursor as { frameId?: unknown } | undefined;
  return typeof value?.frameId === "string" ? value.frameId : undefined;
}

function messagesFromCursor(cursor: unknown, frameId?: string): AgentMessage[] | undefined {
  const value = cursor as { messages?: unknown } | undefined;
  if (frameId && cursorFrameId(cursor) && cursorFrameId(cursor) !== frameId) return undefined;
  return Array.isArray(value?.messages) ? value.messages as AgentMessage[] : undefined;
}

function remainingToolCallsFromCursor(cursor: unknown, frameId?: string): ToolCall[] | undefined {
  const value = cursor as { remainingToolCalls?: unknown } | undefined;
  if (frameId && cursorFrameId(cursor) && cursorFrameId(cursor) !== frameId) return undefined;
  return Array.isArray(value?.remainingToolCalls) ? value.remainingToolCalls as ToolCall[] : undefined;
}

function backoffMs(attempt: number): number {
  return Math.min(5 * 60_000, Math.max(5_000, 2 ** Math.min(attempt, 8) * 1_000));
}

function runnerEntrypoint(job: Pick<ClaimedJob, "entrypoint" | "modelPolicy">): ProviderEgressEntrypoint {
  if (job.entrypoint) return job.entrypoint;
  return job.modelPolicy === "openrouter/free-auto" ? "free" : "public_ask";
}

function defaultMaxStepsForEntrypoint(entrypoint: ProviderEgressEntrypoint): number {
  return entrypoint === "free" ? 3 : 8;
}

function clean<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) if (val !== undefined) out[key] = val;
  return out as T;
}

async function checkpoint(result: AgentResult, maxChars: number, keepRecent: number, frameId?: string) {
  const compacted = await compactMessages(result.messages, { maxChars, keepRecent });
  return {
    frameId,
    messages: compacted.messages,
    remainingToolCalls: result.handoff?.remainingToolCalls ?? [],
    stopReason: result.stopReason,
    compacted: compacted.compacted,
    elided: compacted.elided,
    updatedAt: Date.now(),
  };
}

function normalizeClaimedFrame(frame: ClaimedReasoningFrame, jobId: string): ReasoningFrame {
  return {
    frameId: frame.frameId,
    parentFrameId: frame.parentFrameId,
    jobId,
    goal: frame.goal,
    phase: frame.phase,
    status: frame.status,
    contextPack: frame.contextPack,
    toolAllowlist: frame.toolAllowlist,
    stateDelta: frame.stateDelta,
    evidenceState: frame.evidenceState,
  };
}

function frameStatusForFinish(receipt: ReasoningFrameRunReceipt | undefined, result: AgentResult, canContinue: boolean): ReasoningFrameStatus | undefined {
  if (!receipt) return undefined;
  if (result.stopReason !== "done" || result.exhausted) return canContinue ? "pending" : "failed";
  return receipt.status;
}

export const runFreeAutoJobSlice = internalAction({
  args: { jobId: v.id("agentJobs") },
  handler: async (ctx, { jobId }) => {
    const t0 = Date.now();
    const reserveMs = Math.max(MIN_ACTION_RESERVE_MS, envNumber("FREE_AUTO_JOB_RESERVE_MS", DEFAULT_RESERVE_MS, 1_000, 120_000));
    const sliceBudgetMs = boundedActionBudgetMs(
      envNumber("FREE_AUTO_JOB_SLICE_BUDGET_MS", DEFAULT_SLICE_BUDGET_MS, 30_000, CONVEX_ACTION_LIMIT_MS),
      reserveMs,
      30_000,
    );
    const leaseId = crypto.randomUUID();
    const claimed = await ctx.runMutation(agentJobsClaimSliceRef, {
      jobId,
      leaseId,
      leaseMs: sliceBudgetMs + reserveMs + DEFAULT_LEASE_EXTRA_MS,
    }) as ClaimedJob | null;
    if (!claimed) return { ok: false as const, reason: "not_claimed" as const };

    const actor: Actor = { kind: "agent", id: claimed.agentId, name: claimed.agentName, scope: "public" };
    const rt = new ConvexRoomTools(ctx, claimed.roomId, claimed.artifactId, actor, String(claimed.sessionId), claimed.jobId);
    const entrypoint = runnerEntrypoint(claimed);
    const modelPolicy = claimed.modelPolicy || (entrypoint === "free" ? "openrouter/free-auto" : process.env.AGENT_MODEL ?? "gemini-3.5-flash");
    const resolvedModelPolicy = modelPolicy === "openrouter/free-auto"
      ? process.env.FREE_AUTO_JOB_MODEL ?? modelPolicy
      : modelPolicy;
    const model = agentModel(resolvedModelPolicy, { entrypoint });
    const contextMaxChars = envNumber("FREE_AUTO_JOB_CONTEXT_MAX_CHARS", DEFAULT_CONTEXT_MAX_CHARS, 4_000, 120_000);
    const contextKeepRecent = envNumber("FREE_AUTO_JOB_CONTEXT_KEEP_RECENT", DEFAULT_CONTEXT_KEEP_RECENT, 2, 40);
    const maxSteps = envNumber("FREE_AUTO_JOB_MAX_STEPS_PER_SLICE", defaultMaxStepsForEntrypoint(entrypoint), 1, 12);
    const deadlineAt = t0 + sliceBudgetMs;
    const activeFrame = claimed.activeReasoningFrame
      ? normalizeClaimedFrame(claimed.activeReasoningFrame, String(claimed.jobId))
      : undefined;
    const modelJournal = makeConvexStepJournal({
      ctx,
      jobId: claimed.jobId,
      sliceKey: journalSliceKey({
        entrypoint,
        jobId: String(claimed.jobId),
        artifactId: String(claimed.artifactId),
        frameId: activeFrame?.frameId,
        goal: claimed.goal,
        mode: claimed.mode ?? "variance",
        modelPolicy: resolvedModelPolicy,
        cursor: claimed.cursor ?? null,
        handoff: claimed.handoff ?? null,
        maxSteps,
      }),
      modelName: () => model.name,
    });

    const recordRun = async (result: AgentResult, extraStep?: { tool: string; result: string }): Promise<RunRecord> => {
      const ms = Date.now() - t0;
      const costUsd = priceRun(model.name, result.usage.inputTokens, result.usage.outputTokens);
      const conflictsSurvived = result.trace.filter((t) => t.tool === "edit_cell" && (t.result as { conflict?: boolean })?.conflict).length;
      const telemetry = {
        jobId: claimed.jobId,
        roomId: claimed.roomId,
        agentId: actor.id,
        model: model.name,
        goal: claimed.goal,
        steps: result.steps,
        toolCalls: result.trace.length,
        conflictsSurvived,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd,
        ms,
        exhausted: result.exhausted,
        stopReason: result.stopReason,
        remainingMs: result.budget.remainingMs,
        deadlineAt,
        handoff: result.handoff,
      };
      const runId = await ctx.runMutation(agentRunsRecordRef, telemetry);
      const steps = result.trace.map(traceStep);
      if (extraStep) {
        steps.push({
          idx: steps.length,
          tool: extraStep.tool,
          args: cap(JSON.stringify({ jobId: String(claimed.jobId), attempt: claimed.attempt })),
          result: cap(extraStep.result),
          status: "error" as const,
          ms,
          elementId: undefined,
          affectedObjectIds: undefined,
          mutationReceiptIds: undefined,
        });
      }
      await ctx.runMutation(agentStepsRecordRef, {
        jobId: claimed.jobId,
        runId,
        roomId: claimed.roomId,
        agentId: actor.id,
        steps,
      });
      return { runId, telemetry };
    };

    try {
      const roomArtifacts = await ctx.runQuery(artifactsListForRoomRef, { roomId: claimed.roomId }) as Array<{ title: string; kind: string; meta?: unknown; visibility?: string }>;
      assertProviderEgressAllowed({
        model: model.name,
        entrypoint,
        artifacts: roomArtifacts.length
          ? roomArtifacts.map((art) => ({ title: art.title, kind: art.kind, meta: art.meta, visibility: art.visibility }))
          : [{ title: claimed.artifactTitle, kind: claimed.artifactKind, meta: claimed.artifactMeta, visibility: claimed.artifactVisibility }],
        env: process.env,
      });
      const activeFrameId = activeFrame?.frameId;
      const initialMessages = messagesFromCursor(claimed.cursor, activeFrameId);
      const resumeToolCalls = remainingToolCallsFromCursor(claimed.cursor, activeFrameId);
      let frameReceipt: ReasoningFrameRunReceipt | undefined;
      const result = activeFrame
        ? (frameReceipt = await runReasoningFrame({
          rt,
          frame: activeFrame,
          model,
          tools: PRODUCTION_ROOM_TOOLS,
          systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
          maxSteps,
          initialMessages,
          resumeToolCalls,
          includeRoomContext: !initialMessages,
          roomContextBuilder: claimed.mode === "research" ? buildResearchContext : undefined,
          compaction: { maxChars: contextMaxChars, keepRecent: contextKeepRecent },
          journal: modelJournal,
          deadlineAt,
          reserveMs,
          spendLimits: {
            maxTokens: envNumber("AGENT_MAX_TOKENS_PER_SLICE", 250_000, 1_000, 4_000_000),
            maxCostUsd: envNumber("AGENT_MAX_USD_PER_SLICE", 2, 0.01, 100),
          },
          priceStep: (modelName: string, inputTokens: number, outputTokens: number) => priceRun(modelName, inputTokens, outputTokens),
        })).agentResult
        : await runAgent({
        rt,
        goal: claimed.goal,
        model,
        tools: PRODUCTION_ROOM_TOOLS,
        systemPrompt: MANAGED_LOCK_SYSTEM_PROMPT,
        maxSteps,
        initialMessages,
        resumeToolCalls,
        contextBuilder: initialMessages ? undefined : claimed.mode === "research" ? buildResearchContext : undefined,
        compaction: { maxChars: contextMaxChars, keepRecent: contextKeepRecent },
        journal: modelJournal,
        deadlineAt,
        reserveMs,
        // Gateway spend ceiling — cap a single slice's token AND dollar spend. priceStep makes the
        // USD half reachable (P0-4: without it the gate received costUsd=0 and maxCostUsd was dead
        // surface — one env var pointing free-auto at a paid model meant unbounded spend).
        spendLimits: {
          maxTokens: envNumber("AGENT_MAX_TOKENS_PER_SLICE", 250_000, 1_000, 4_000_000),
          maxCostUsd: envNumber("AGENT_MAX_USD_PER_SLICE", 2, 0.01, 100),
        },
        priceStep: (modelName: string, inputTokens: number, outputTokens: number) => priceRun(modelName, inputTokens, outputTokens),
      });
      const { runId, telemetry } = await recordRun(result);
      const done = result.stopReason === "done" && !result.exhausted;
      const canContinue = !done && claimed.attempt < claimed.maxAttempts;
      const frameStatus = frameStatusForFinish(frameReceipt, result, canContinue);
      const frameBlocked = frameStatus === "blocked";
      const scheduledNextAt = canContinue || (frameReceipt && done && !frameBlocked) ? Date.now() + DEFAULT_RESUME_DELAY_MS : undefined;
      const cursor = done ? undefined : await checkpoint(result, contextMaxChars, contextKeepRecent, activeFrameId);

      await ctx.runMutation(agentJobsFinishSliceRef, clean({
        jobId: claimed.jobId,
        leaseId,
        attempt: claimed.attempt,
        status: frameBlocked ? "blocked" : done ? "completed" : canContinue ? "handoff" : "failed",
        resolvedModel: model.name,
        stopReason: result.stopReason,
        ms: telemetry.ms,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costUsd: telemetry.costUsd,
        runId,
        handoff: result.handoff,
        cursor,
        finalText: result.finalText,
        error: frameBlocked ? frameReceipt?.verification.blockedReason ?? frameReceipt?.verification.reason : done || canContinue ? undefined : "max_attempts_exceeded",
        scheduledNextAt,
        frameId: activeFrameId,
        frameStatus,
        frameDelta: frameReceipt?.stateDelta,
        frameEvidenceState: frameReceipt?.verification.evidenceState,
        frameResultRef: frameReceipt ? {
          verification: frameReceipt.verification,
          allowedToolNames: frameReceipt.allowedToolNames,
          missingToolNames: frameReceipt.missingToolNames,
          runtimeError: frameReceipt.runtimeError,
        } : undefined,
      }));

      return { ok: true as const, done, stopReason: result.stopReason, runId };
    } catch (error) {
      const partial = error instanceof AgentRunError ? error.partial : undefined;
      const rootError = error instanceof AgentRunError ? error.cause : error;
      const fallback: AgentResult = partial ?? {
        finalText: "",
        steps: 0,
        exhausted: false,
        stopReason: "error",
        budget: {
          startedAt: t0,
          now: Date.now(),
          deadlineAt,
          reserveMs,
          elapsedMs: Date.now() - t0,
          remainingMs: Math.max(0, deadlineAt - Date.now()),
          usableMs: Math.max(0, deadlineAt - Date.now() - reserveMs),
          maxSteps,
          attemptedSteps: 0,
        },
        trace: [],
        messages: [],
        usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 },
      };
      const { runId, telemetry } = await recordRun(fallback, { tool: "job_error", result: errorText(rootError) });
      const canRetry = claimed.attempt < claimed.maxAttempts;
      const delayMs = canRetry ? backoffMs(claimed.attempt) : undefined;
      const scheduledNextAt = delayMs ? Date.now() + delayMs : undefined;
      const activeFrameId = claimed.activeReasoningFrame?.frameId;
      const cursor = fallback.messages.length ? await checkpoint(fallback, contextMaxChars, contextKeepRecent, activeFrameId) : undefined;

      await ctx.runMutation(agentJobsFinishSliceRef, clean({
        jobId: claimed.jobId,
        leaseId,
        attempt: claimed.attempt,
        status: canRetry ? "retrying" : "failed",
        resolvedModel: model.name,
        stopReason: fallback.stopReason,
        ms: telemetry.ms,
        inputTokens: fallback.usage.inputTokens,
        outputTokens: fallback.usage.outputTokens,
        costUsd: telemetry.costUsd,
        runId,
        error: errorText(rootError),
        handoff: fallback.handoff,
        cursor,
        scheduledNextAt,
        frameId: activeFrameId,
        frameStatus: canRetry ? "pending" : "failed",
      }));

      return { ok: false as const, retrying: canRetry, error: errorText(rootError), runId };
    }
  },
});
