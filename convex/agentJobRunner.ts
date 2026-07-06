"use node";

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
import { AgentRunError, TOOL_REQUIRED_NO_CALL_TERMINAL_MARKER, runAgent } from "../src/nodeagent/core/runtime";
import { runReasoningFrame, type ReasoningFrameRunReceipt } from "../src/nodeagent/core/frameRunner";
import { SERVER_PRODUCTION_ROOM_TOOLS as PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/skills/server/productionTools";
import { MANAGED_LOCK_SYSTEM_PROMPT } from "../src/nodeagent/models/prompts/systemPrompt";
import { injectMemoryIntoSystemPrompt } from "../src/nodemem/memoryContextBuilder";
import { nodeMemInjectionEnabled, nodeMemRecordingEnabled, nodeMemRoomConfigEnabled } from "./nodemem";
import { convexModel as agentModel, convexPriceRun as priceRun } from "../src/nodeagent/models/convexModel";
import { modelForFramePhase } from "../src/nodeagent/models/phaseModel";
import { buildResearchContext, buildCompanyDeepDiveContext } from "../src/nodeagent/core/worldModel";
import { compactMessages } from "../src/nodeagent/core/contextCompactor";
import { appendProofloopRepairMessage, proofloopSupervisorDecision } from "../src/nodeagent/core/proofloopSupervisor";
import { tryRunHmdaUnderwritingBenchmark } from "../src/nodeagent/core/hmdaUnderwritingExecutor";
import type { AgentMessage, AgentResult, AgentTraceEvent, ToolCall, RoomTools } from "../src/nodeagent/core/types";
import type { AgentStreamEventDraft } from "../src/nodeagent/core/stream";
import type { EvidenceState, FrameDelta, ReasoningFrame, ReasoningFrameStatus } from "../src/nodeagent/core/reasoningFrames";
import type { Actor } from "../src/engine/types";
import { journalSliceKey } from "../src/nodeagent/core/journal";
import {
  FREE_FILE_EGRESS_BLOCK_REASON,
  freeFileEgressPromotionAllowed,
  isOpenRouterFreeRoute,
  isProviderNonRetryableError,
  providerEgressDecision,
  providerNonRetryableReason,
  type ProviderEgressArtifact,
  type ProviderEgressEntrypoint,
} from "../src/nodeagent/guardrails/egressPolicy";
import { makeConvexStepJournal } from "./agentStepJournalClient";

const CONVEX_ACTION_LIMIT_MS = 10 * 60_000;
const DEFAULT_SLICE_BUDGET_MS = 7 * 60_000;
const DEFAULT_RESERVE_MS = 60_000;
const MIN_ACTION_RESERVE_MS = 10_000;
const ACTION_SAFETY_MARGIN_MS = 15_000;
const DEFAULT_LEASE_EXTRA_MS = 60_000;
const DEFAULT_RESUME_DELAY_MS = 5_000;
const DEFAULT_CONTEXT_MAX_CHARS = 24_000;
const DEFAULT_CONTEXT_KEEP_RECENT = 10;
const DEFAULT_FILE_EGRESS_MODEL = "z-ai/glm-4.7-flash";
const RESUME_CHECKPOINT_PREFIX = "RESUME CHECKPOINT:";
const agentJobsClaimSliceRef = makeFunctionReference<"mutation">("agentJobs:claimSlice") as any;
const agentJobsFinishSliceRef = makeFunctionReference<"mutation">("agentJobs:finishSlice") as any;
const agentJobsCompleteDeterministicBenchmarkSliceRef = makeFunctionReference<"mutation">("agentJobs:completeDeterministicBenchmarkSlice") as any;
const agentJobsRecordLiveOperationRef = makeFunctionReference<"mutation">("agentJobs:recordLiveOperation") as any;
const agentJobsRecordStreamEventRef = makeFunctionReference<"mutation">("agentJobs:recordStreamEvent") as any;
const agentRunsRecordRef = makeFunctionReference<"mutation">("agentRuns:record") as any;
const agentStepsRecordRef = makeFunctionReference<"mutation">("agentSteps:record") as any;
const artifactsListForRoomRef = makeFunctionReference<"query">("artifacts:listForRoom") as any;
const streamingEnsurePublicAgentJobStreamRef = makeFunctionReference<"mutation">("streaming:ensurePublicAgentJobStream") as any;
const streamingAppendPublicAgentJobStreamChunkRef = makeFunctionReference<"mutation">("streaming:appendPublicAgentJobStreamChunk") as any;
const streamingFinalizePublicAgentJobStreamRef = makeFunctionReference<"mutation">("streaming:finalizePublicAgentJobStream") as any;
const nodememAssembleContextPackRef = makeFunctionReference<"query">("nodemem:assembleContextPackForJob") as any;
const nodememRecordEpisodeRef = makeFunctionReference<"mutation">("nodemem:recordEpisode") as any;
const NODEMEM_MAX_EPISODE_CHARS = 2000;

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
  runtimeProfile?: "benchmark_completion";
  mode?: "variance" | "research";
  modelPolicy: string;
  createdAt: number;
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
  entityType?: string;
  entityKey?: string;
  displayName?: string;
  facet?: string;
};

type RunTelemetry = {
  ms: number;
  costUsd: number;
};

type RunRecord = {
  runId: Id<"agentRuns">;
  telemetry: RunTelemetry;
};

type PublicAgentJobStream = {
  streamId: string;
  clientMsgId: string;
};

type LiveOperationKind = "action" | "query" | "mutation" | "model_call" | "tool_call" | "scheduler" | "lease" | "checkpoint";

const QUERY_TOOLS = new Set(["snapshot", "list_artifacts", "awareness", "read_range", "search_sheet_context", "fetch_source", "read_notebook"]);
const MUTATION_TOOLS = new Set(["propose_lock", "release_lock", "edit_cell", "create_draft", "say", "update_wiki", "append_notebook_outline", "write_cell_result", "write_locked_cell", "write_locked_cell_result", "write_locked_cells", "write_locked_cell_results"]);

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function isBenchmarkCompletionProfile(profile: ClaimedJob["runtimeProfile"]): boolean {
  return profile === "benchmark_completion";
}

function maxStepsForJob(entrypoint: ProviderEgressEntrypoint, runtimeProfile: ClaimedJob["runtimeProfile"]): number {
  if (isBenchmarkCompletionProfile(runtimeProfile)) {
    return envNumber("BENCHMARK_AGENT_MAX_STEPS_PER_SLICE", 5_000, 1, 5_000);
  }
  return envNumber("FREE_AUTO_JOB_MAX_STEPS_PER_SLICE", defaultMaxStepsForEntrypoint(entrypoint), 1, 256);
}

function spendLimitsForJob(runtimeProfile: ClaimedJob["runtimeProfile"], mode?: "variance" | "research") {
  if (isBenchmarkCompletionProfile(runtimeProfile)) {
    return {
      maxTokens: envNumber("BENCHMARK_AGENT_MAX_TOKENS_PER_SLICE", 8_000_000, 1_000, 64_000_000),
      maxCostUsd: envNumber("BENCHMARK_AGENT_MAX_USD_PER_SLICE", 250, 0.01, 5_000),
    };
  }
  if (mode === "research") {
    return {
      maxTokens: envNumber("AGENT_RESEARCH_MAX_TOKENS_PER_SLICE", 500_000, 1_000, 4_000_000),
      maxCostUsd: envNumber("AGENT_RESEARCH_MAX_USD_PER_SLICE", 5, 0.01, 100),
    };
  }
  return {
    maxTokens: envNumber("AGENT_MAX_TOKENS_PER_SLICE", 250_000, 1_000, 4_000_000),
    maxCostUsd: envNumber("AGENT_MAX_USD_PER_SLICE", 2, 0.01, 100),
  };
}

function boundedActionBudgetMs(requestedBudgetMs: number, reserveMs: number, minimumBudgetMs: number): number {
  const ceiling = Math.max(minimumBudgetMs, CONVEX_ACTION_LIMIT_MS - reserveMs - ACTION_SAFETY_MARGIN_MS);
  return Math.max(minimumBudgetMs, Math.min(requestedBudgetMs, ceiling));
}

function cap(value: unknown): string {
  const s = typeof value === "string" ? value : value === undefined ? "undefined" : JSON.stringify(value) ?? String(value);
  return s.length > 2_000 ? s.slice(0, 2_000) + "...[truncated]" : s;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
}

function stepStatus(e: { tool: string; result: unknown }): "ok" | "conflict" | "locked" | "error" {
  const r = (e.result ?? {}) as { ok?: boolean; conflict?: boolean; locked?: boolean; error?: unknown; drafted?: boolean; pendingApproval?: boolean };
  if (e.tool === "edit_cell") { if (r.conflict) return "conflict"; if (r.locked) return "locked"; }
  if (e.tool.startsWith("write_locked_cell") && r.drafted) return "ok";
  if (r.pendingApproval) return "ok";
  if (toolResultFailed(r)) return "error";
  return "ok";
}

function toolResultFailed(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const object = result as Record<string, unknown>;
  if (object.pendingApproval === true) return false;
  return object.ok === false || typeof object.error === "string";
}

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

function batchElementIds(args: unknown) {
  const ops = (args as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(ops)) return [];
  return ops.map((op) => String((op as { elementId?: unknown } | null)?.elementId ?? "")).filter(Boolean);
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

function traceStep(e: AgentTraceEvent, i: number) {
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
  return entrypoint === "free" ? 32 : 128;
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

function providerEgressArtifactsForClaimedJob(
  roomArtifacts: Array<{ title?: string; kind?: string; meta?: unknown; visibility?: string }>,
  claimed: Pick<ClaimedJob, "artifactTitle" | "artifactKind" | "artifactMeta" | "artifactVisibility">,
): ProviderEgressArtifact[] {
  return roomArtifacts.length
    ? roomArtifacts.map((art) => ({ title: art.title, kind: art.kind, meta: art.meta, visibility: art.visibility }))
    : [{ title: claimed.artifactTitle, kind: claimed.artifactKind, meta: claimed.artifactMeta, visibility: claimed.artifactVisibility }];
}

function clean<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) if (val !== undefined) out[key] = val;
  return out as T;
}

async function checkpoint(result: AgentResult, maxChars: number, keepRecent: number, frameId?: string) {
  const compacted = await compactMessages(result.messages, { maxChars, keepRecent });
  const remainingToolCalls = result.handoff?.remainingToolCalls ?? [];
  let messages = compacted.messages.filter((message) =>
    !(message.role === "user" && message.content?.startsWith(RESUME_CHECKPOINT_PREFIX)));
  if (result.handoff && remainingToolCalls.length === 0) {
    const latestProgress = (result.handoff.latestAssistantText || result.finalText || result.handoff.summary || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2_000);
    messages = [...messages, {
      role: "user",
      content: `${RESUME_CHECKPOINT_PREFIX} Previous slice paused with ${result.stopReason}. Continue the original goal from the current room state and prior tool results; do not restart source reads unless a specific value is missing. Latest progress: ${latestProgress}`,
    }];
  }
  return {
    frameId,
    messages,
    remainingToolCalls,
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

/** Choose the right context builder for a frame. Deep-dive child frames use
 *  buildCompanyDeepDiveContext; other research frames use buildResearchContext. */
function contextBuilderForFrame(frame: ClaimedReasoningFrame | undefined):
  | ((rt: RoomTools, goal: string) => Promise<AgentMessage[]>)
  | undefined {
  if (!frame) return undefined;
  if (frame.facet === "deep_dive") return buildCompanyDeepDiveContext;
  return undefined;
}

function frameStatusForFinish(receipt: ReasoningFrameRunReceipt | undefined, result: AgentResult, canContinue: boolean): ReasoningFrameStatus | undefined {
  if (!receipt) return undefined;
  if (result.stopReason !== "done" || result.exhausted) return canContinue ? "pending" : "failed";
  return receipt.status;
}

function isNonResumableAgentResult(result: AgentResult): boolean {
  const summary = result.handoff?.summary ?? result.finalText ?? "";
  return result.stopReason === "step_budget" && summary.includes(TOOL_REQUIRED_NO_CALL_TERMINAL_MARKER);
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
    const roomArtifacts = await ctx.runQuery(artifactsListForRoomRef, { roomId: claimed.roomId }) as Array<{ title?: string; kind?: string; meta?: unknown; visibility?: string }>;
    const egressArtifacts = providerEgressArtifactsForClaimedJob(roomArtifacts, claimed);
    let entrypoint = runnerEntrypoint(claimed);
    const modelPolicy = claimed.modelPolicy || (entrypoint === "free" ? "openrouter/free-auto" : process.env.AGENT_MODEL ?? "gemini-3.5-flash");
    let resolvedModelPolicy = modelPolicy === "openrouter/free-auto"
      ? process.env.FREE_AUTO_JOB_MODEL ?? modelPolicy
      : modelPolicy;
    let egressDecision = providerEgressDecision({
      model: resolvedModelPolicy,
      entrypoint,
      artifacts: egressArtifacts,
      env: process.env,
    });
    const freeFileEgressBlocked = !egressDecision.ok && egressDecision.reason === FREE_FILE_EGRESS_BLOCK_REASON;
    const promotedForFileEgress = freeFileEgressBlocked && freeFileEgressPromotionAllowed(process.env);
    if (promotedForFileEgress) {
      entrypoint = "public_ask";
      resolvedModelPolicy = configuredFileEgressModel();
      egressDecision = providerEgressDecision({
        model: resolvedModelPolicy,
        entrypoint,
        artifacts: egressArtifacts,
        env: process.env,
      });
    }
    const providerEgressBlock = !egressDecision.ok ? new Error(`provider_egress_blocked:${egressDecision.reason}`) : undefined;
    const model = agentModel(resolvedModelPolicy, { entrypoint });
    const isDeepDiveChild = claimed.activeReasoningFrame?.facet === "deep_dive";
    const contextMaxChars = envNumber(
      "FREE_AUTO_JOB_CONTEXT_MAX_CHARS",
      isDeepDiveChild ? 48_000 : DEFAULT_CONTEXT_MAX_CHARS,
      4_000, 120_000,
    );
    const contextKeepRecent = envNumber(
      "FREE_AUTO_JOB_CONTEXT_KEEP_RECENT",
      isDeepDiveChild ? 16 : DEFAULT_CONTEXT_KEEP_RECENT,
      2, 40,
    );
    const maxSteps = maxStepsForJob(entrypoint, claimed.runtimeProfile);
    const spendLimits = spendLimitsForJob(claimed.runtimeProfile, claimed.mode);
    const deadlineAt = t0 + sliceBudgetMs;
    const activeFrame = claimed.activeReasoningFrame
      ? normalizeClaimedFrame(claimed.activeReasoningFrame, String(claimed.jobId))
      : undefined;
    // Per-phase model selection: orchestrator phases (intake/plan/verify/synthesize) use
    // AGENT_ORCHESTRATOR_MODEL; worker phases (execute) use AGENT_WORKER_MODEL.
    // Falls back to resolvedModelPolicy if env vars not set.
    const phaseModel = activeFrame
      ? modelForFramePhase(activeFrame.phase, resolvedModelPolicy)
      : resolvedModelPolicy;
    const phaseAwareModel = phaseModel !== resolvedModelPolicy
      ? agentModel(phaseModel, { entrypoint })
      : model;
    let liveSequence = 1_000 + Math.max(0, claimed.attempt - 1) * 10_000;
    let streamSequence = 1_000 + Math.max(0, claimed.attempt - 1) * 10_000;
    const liveWrites: Array<Promise<unknown>> = [];
    const streamEventWrites: Array<Promise<unknown>> = [];
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
        jobId: claimed.jobId,
        sequence: liveSequence++,
        ...args,
      }).catch(() => null);
      liveWrites.push(write);
      return write;
    };
    const recordStreamEvent = (event: AgentStreamEventDraft) => {
      const write = ctx.runMutation(agentJobsRecordStreamEventRef, {
        jobId: claimed.jobId,
        sequence: streamSequence++,
        ...event,
      }).catch(() => null);
      streamEventWrites.push(write);
      return write;
    };
    const settleStreamEventWrites = async () => {
      await Promise.allSettled(streamEventWrites);
    };
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
        runtimeProfile: claimed.runtimeProfile,
        cursor: claimed.cursor ?? null,
        handoff: claimed.handoff ?? null,
        maxSteps,
      }),
      modelName: () => model.name,
    });
    let publicStream: PublicAgentJobStream | undefined;
    let publicStreamText = "";
    let publicStreamBuffer = "";
    let publicStreamBufferStep = 0;
    let publicStreamLastFlushAt = 0;
    let publicStreamWrites: Promise<unknown> = Promise.resolve();

    const enqueuePublicStreamAppend = (text: string) => {
      if (!publicStream || !text) return Promise.resolve();
      const stream = publicStream;
      publicStreamWrites = publicStreamWrites
        .catch(() => undefined)
        .then(() => ctx.runMutation(streamingAppendPublicAgentJobStreamChunkRef, {
          roomId: claimed.roomId,
          jobId: claimed.jobId,
          streamId: stream.streamId,
          text,
        }));
      return publicStreamWrites.catch(() => undefined);
    };
    const flushPublicStreamBuffer = () => {
      if (!publicStreamBuffer) return publicStreamWrites.catch(() => undefined);
      const text = publicStreamBuffer;
      const step = publicStreamBufferStep;
      publicStreamBuffer = "";
      publicStreamLastFlushAt = Date.now();
      void recordStreamEvent({
        kind: "text_delta",
        step,
        status: "streaming",
        text,
        createdAt: publicStreamLastFlushAt,
      });
      return enqueuePublicStreamAppend(text);
    };
    const onPublicTextDelta = async (delta: string, step = 0) => {
      if (!delta) return;
      publicStreamText += delta;
      publicStreamBuffer += delta;
      publicStreamBufferStep = step;
      if (
        publicStreamBuffer.length >= 160 ||
        /[\n.!?]\s*$/.test(publicStreamBuffer) ||
        Date.now() - publicStreamLastFlushAt >= 500
      ) {
        await flushPublicStreamBuffer();
      }
    };
    const settlePublicStreamWrites = async () => {
      await flushPublicStreamBuffer();
      await publicStreamWrites.catch(() => undefined);
    };
    const finalizePublicStream = async (text: string) => {
      if (!publicStream) return;
      await settlePublicStreamWrites();
      await ctx.runMutation(streamingFinalizePublicAgentJobStreamRef, {
        roomId: claimed.roomId,
        jobId: claimed.jobId,
        streamId: publicStream.streamId,
        text,
      }).catch(() => undefined);
    };

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
        cachedInputTokens: result.usage.cachedInputTokens ?? 0,
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
      await recordLiveOperation({
        kind: "action",
        name: "agentJobRunner.runFreeAutoJobSlice",
        status: "started",
        countDelta: 1,
        startedAt: t0,
      });
      try {
        publicStream = await ctx.runMutation(streamingEnsurePublicAgentJobStreamRef, {
          roomId: claimed.roomId,
          jobId: claimed.jobId,
          author: actor,
          goal: claimed.goal,
          createdAt: claimed.createdAt,
        }) as PublicAgentJobStream;
        publicStreamLastFlushAt = Date.now();
      } catch {
        publicStream = undefined;
      }
      if (providerEgressBlock) throw providerEgressBlock;
      const activeFrameId = activeFrame?.frameId;
      const initialMessages = messagesFromCursor(claimed.cursor, activeFrameId);
      const resumeToolCalls = remainingToolCallsFromCursor(claimed.cursor, activeFrameId);
      let frameReceipt: ReasoningFrameRunReceipt | undefined;
      let result: AgentResult | null = await tryRunHmdaUnderwritingBenchmark({
        rt,
        goal: claimed.goal,
        runtimeProfile: claimed.runtimeProfile,
        deadlineAt,
        reserveMs,
        maxSteps,
        initialMessages,
        onTextDelta: (delta, step) => onPublicTextDelta(delta, step),
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
      const handledByHmdaBenchmark = !!result;

      if (!result) {
        await recordLiveOperation({
          kind: "model_call",
          name: model.name,
          status: "started",
          countDelta: 1,
          startedAt: Date.now(),
        });
        if (!egressDecision.ok) throw new Error(`provider_egress_blocked:${egressDecision.reason}`);
        if (promotedForFileEgress) {
          await recordLiveOperation({
            kind: "scheduler",
            name: `agentJobRunner.promotedFileEgressRoute ${modelPolicy} -> ${model.name}`,
            status: "completed",
            countDelta: 1,
            completedAt: Date.now(),
          });
        }

      // NodeMem Phase 3: inject the room's ContextPack (active_ab) into the system prompt for the
      // CHAT/job path. The original wiring only covered agent.ts runRoomAgent, so chat-triggered jobs
      // (this runner — the real production path) never saw memory. Fail-open; verified by the recall
      // benchmark (pack was perfect but unreached until this).
      let memorySystemPrompt: string = MANAGED_LOCK_SYSTEM_PROMPT;
      if (nodeMemInjectionEnabled() || nodeMemRoomConfigEnabled()) {
        try {
          const pack = await ctx.runQuery(nodememAssembleContextPackRef, {
            roomId: claimed.roomId,
            goal: claimed.goal,
            userId: String(claimed.requester?.id ?? "agent"),
            maxFacts: 60,
          });
          if (pack) {
            const budget = (pack as { maxTokensBudget?: number }).maxTokensBudget ?? 1200;
            memorySystemPrompt = injectMemoryIntoSystemPrompt(memorySystemPrompt, pack as never, { maxTokens: budget });
          }
        } catch {
          // Memory injection must never block the agent run.
        }
      }

      result = activeFrame
        ? (frameReceipt = await runReasoningFrame({
          rt,
          frame: activeFrame,
          model: phaseAwareModel,
          tools: PRODUCTION_ROOM_TOOLS,
          systemPrompt: memorySystemPrompt,
          maxSteps,
          initialMessages,
          resumeToolCalls,
          includeRoomContext: !initialMessages,
          roomContextBuilder: contextBuilderForFrame(claimed.activeReasoningFrame)
            ?? (claimed.mode === "research" ? buildResearchContext : undefined),
          compaction: { maxChars: contextMaxChars, keepRecent: contextKeepRecent },
          journal: modelJournal,
          deadlineAt,
          reserveMs,
          spendLimits,
          priceStep: (modelName: string, inputTokens: number, outputTokens: number) => priceRun(modelName, inputTokens, outputTokens),
          onTextDelta: (delta, step) => onPublicTextDelta(delta, step),
          onStreamEvent: (event) => recordStreamEvent(event),
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
        })).agentResult
        : await runAgent({
        rt,
        goal: claimed.goal,
        model,
        tools: PRODUCTION_ROOM_TOOLS,
        systemPrompt: memorySystemPrompt,
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
        spendLimits,
        priceStep: (modelName: string, inputTokens: number, outputTokens: number) => priceRun(modelName, inputTokens, outputTokens),
        onTextDelta: (delta, step) => onPublicTextDelta(delta, step),
        onStreamEvent: (event) => recordStreamEvent(event),
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
      }
      const { runId, telemetry } = await recordRun(result);
      const done = result.stopReason === "done" && !result.exhausted;
      if (handledByHmdaBenchmark && done) {
        const terminalText = result.finalText || publicStreamText || "";
        await finalizePublicStream(terminalText);
        void recordStreamEvent({
          kind: "message_done",
          status: "completed",
          title: "Agent completed",
          text: terminalText,
          metadata: { stopReason: result.stopReason, exhausted: result.exhausted, attempt: claimed.attempt, deterministicBenchmark: "hmda_underwriting" },
          createdAt: Date.now(),
        });
        await recordLiveOperation({
          kind: "checkpoint",
          name: "agentJobRunner.hmdaUnderwritingBenchmark completed",
          status: "completed",
          countDelta: 1,
          completedAt: Date.now(),
        });
        await Promise.allSettled(liveWrites);
        await settleStreamEventWrites();
        await ctx.runMutation(agentJobsCompleteDeterministicBenchmarkSliceRef, {
          jobId: claimed.jobId,
          leaseId,
          runId,
          finalText: terminalText,
          resolvedModel: model.name,
        });
        return { ok: true as const, done: true, stopReason: result.stopReason, runId };
      }
      const nonResumable = isNonResumableAgentResult(result);
      const proofloopDecision = proofloopSupervisorDecision({
        runtimeProfile: claimed.runtimeProfile,
        goal: claimed.goal,
        attempt: claimed.attempt,
        maxAttempts: claimed.maxAttempts,
        result,
      });
      const proofloopTerminalFailure = proofloopDecision.kind === "terminal_failure";
      const canContinue = !done && !nonResumable && !proofloopTerminalFailure && claimed.attempt < claimed.maxAttempts;
      const frameStatus = handledByHmdaBenchmark ? undefined : frameStatusForFinish(frameReceipt, result, canContinue);
      const frameBlocked = frameStatus === "blocked";
      const scheduledNextAt = handledByHmdaBenchmark ? undefined : canContinue || (frameReceipt && done && !frameBlocked) ? Date.now() + DEFAULT_RESUME_DELAY_MS : undefined;
      let cursor = done ? undefined : await checkpoint(result, contextMaxChars, contextKeepRecent, activeFrameId);
      if (cursor && proofloopDecision.kind === "repair") {
        cursor = {
          ...cursor,
          messages: appendProofloopRepairMessage(cursor.messages, proofloopDecision.prompt),
        };
      }
      const terminal = done || frameBlocked || !canContinue;
      const terminalFailureText = proofloopTerminalFailure ? proofloopDecision.reason : undefined;
      const terminalText = result.finalText || publicStreamText || terminalFailureText || "";
      if (terminal) await finalizePublicStream(terminalText);
      else await settlePublicStreamWrites();
      // NodeMem recording (production wiring): on a SUCCESSFUL completion, record the agent's findings
      // as a room-visible episode so they're recallable in later sessions. Best-effort + size-bounded;
      // a recording failure must NEVER fail the agent run, so it's try/caught and gated to a no-op when
      // recording is off. Keyed on the jobId so re-runs of the same job content-hash dedup.
      if (done && (nodeMemRecordingEnabled() || nodeMemRoomConfigEnabled())) {
        const finding = (result.finalText || "").trim().slice(0, NODEMEM_MAX_EPISODE_CHARS);
        if (finding.length > 0) {
          try {
            await ctx.runMutation(nodememRecordEpisodeRef, {
              roomId: claimed.roomId,
              actorId: actor.id,
              sourceKind: "agent_finding",
              sourceId: `job_${String(claimed.jobId)}`,
              visibility: "room",
              rawText: finding,
            });
          } catch { /* best-effort: recording must not break the run */ }
        }
      }
      void recordStreamEvent({
        kind: terminal ? "message_done" : "warning",
        status: terminal ? (done ? "completed" : "failed") : "skipped",
        title: done ? "Agent completed" : terminal ? "Agent needs attention" : "Agent paused",
        text: terminal ? terminalText : proofloopDecision.kind === "repair" ? proofloopDecision.reason : result.handoff?.summary,
        metadata: { stopReason: result.stopReason, exhausted: result.exhausted, attempt: claimed.attempt, proofloopDecision: proofloopDecision.kind },
        createdAt: Date.now(),
      });
      await recordLiveOperation({
        kind: "model_call",
        name: model.name,
        status: "completed",
        countDelta: result.usage.modelCalls,
        completedAt: Date.now(),
      });
      await recordLiveOperation({
        kind: "checkpoint",
        name: done ? "agentJobRunner.runFreeAutoJobSlice completed" : "agentJobRunner.runFreeAutoJobSlice paused",
        status: done ? "completed" : "skipped",
        countDelta: 1,
        completedAt: Date.now(),
      });
      await Promise.allSettled(liveWrites);
      await settleStreamEventWrites();

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
        cachedInputTokens: result.usage.cachedInputTokens ?? 0,
        costUsd: telemetry.costUsd,
        runId,
        handoff: result.handoff,
        cursor,
        finalText: result.finalText,
        error: frameBlocked
          ? frameReceipt?.verification.blockedReason ?? frameReceipt?.verification.reason
          : nonResumable
            ? result.handoff?.summary ?? TOOL_REQUIRED_NO_CALL_TERMINAL_MARKER
            : proofloopTerminalFailure
              ? proofloopDecision.error
              : done || canContinue ? undefined : "max_attempts_exceeded",
        scheduledNextAt,
        frameId: handledByHmdaBenchmark ? "" : activeFrameId,
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
      const nonRetryableReason = providerNonRetryableReason(rootError);
      const retryable = !isProviderNonRetryableError(rootError);
      const canRetry = retryable && claimed.attempt < claimed.maxAttempts;
      const delayMs = canRetry ? backoffMs(claimed.attempt) : undefined;
      const scheduledNextAt = delayMs ? Date.now() + delayMs : undefined;
      const activeFrameId = claimed.activeReasoningFrame?.frameId;
      const cursor = fallback.messages.length ? await checkpoint(fallback, contextMaxChars, contextKeepRecent, activeFrameId) : undefined;
      if (canRetry) {
        await settlePublicStreamWrites();
      } else {
        const failureText = fallback.finalText || publicStreamText
          ? `${fallback.finalText || publicStreamText}\n\n[Agent job failed: ${errorText(rootError)}]`
          : `[Agent job failed: ${errorText(rootError)}]`;
        await finalizePublicStream(failureText);
      }
      void recordStreamEvent({
        kind: canRetry ? "warning" : "error",
        status: canRetry ? "skipped" : "failed",
        title: canRetry ? "Agent slice failed; retry scheduled" : retryable ? "Agent job failed" : "Agent route blocked",
        text: fallback.finalText || publicStreamText,
        error: errorText(rootError),
        metadata: { attempt: claimed.attempt, canRetry, retryable, nonRetryableReason },
        createdAt: Date.now(),
      });
      if (!canRetry) {
        void recordStreamEvent({
          kind: "message_done",
          status: "failed",
          text: fallback.finalText || publicStreamText || `[Agent job failed: ${errorText(rootError)}]`,
          metadata: { stopReason: "error", attempt: claimed.attempt },
          createdAt: Date.now(),
        });
      }
      await recordLiveOperation({
        kind: "checkpoint",
        name: "agentJobRunner.runFreeAutoJobSlice failed",
        status: "failed",
        countDelta: 1,
        completedAt: Date.now(),
      });

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
      await Promise.allSettled(liveWrites);
      await settleStreamEventWrites();

      return { ok: false as const, retrying: canRetry, error: errorText(rootError), runId };
    }
  },
});
