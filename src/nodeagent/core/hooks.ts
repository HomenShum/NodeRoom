import type {
  AgentBudgetSnapshot,
  AgentMessage,
  AgentTraceEvent,
  ToolCall,
  ToolFailureKind,
} from "./types";
import type { MutationReceipt } from "../traces/traceTypes";

export type ToolResult = unknown;

export interface HookCtx {
  goal: string;
  step: number;
  startedAt: number;
  modelName: string;
  availableTools: readonly string[];
  messages: readonly AgentMessage[];
  trace: readonly AgentTraceEvent[];
  budget: AgentBudgetSnapshot;
  now: () => number;
}

export interface BlockedTool {
  blocked: true;
  reason: string;
  failureKind?: ToolFailureKind;
  recovery?: string;
  metadata?: Record<string, unknown>;
}

export interface RecoveryPlan {
  action: "surface_error" | "recover" | "handoff";
  reason: string;
  instruction?: string;
  toolResult?: ToolResult;
  nextGoal?: string;
}

export interface ArtifactPatch {
  artifactId?: string;
  targetRefs: string[];
  baseVersion?: number;
  payload: unknown;
  sourceTraceIds?: string[];
}

export type CommitDecision =
  | { action: "allow"; reason?: string }
  | { action: "block"; reason: string; recovery?: string }
  | { action: "rebase"; reason: string; patch: ArtifactPatch };

export interface AgentStopSummary {
  proposedStopReason: "done";
  finalText: string;
  steps: number;
  exhausted: boolean;
}

export type StopDecision =
  | { action: "allow"; reason?: string }
  | { action: "continue"; reason: string; prompt?: string }
  | { action: "block"; reason: string; prompt?: string }
  | { action: "handoff"; reason: string; prompt?: string; nextGoal?: string };

export type NodeAgentHook = {
  preTool?: (ctx: HookCtx, call: ToolCall) => Promise<ToolCall | BlockedTool> | ToolCall | BlockedTool;
  postTool?: (ctx: HookCtx, call: ToolCall, result: ToolResult) => Promise<void> | void;
  toolError?: (ctx: HookCtx, call: ToolCall, error: unknown) => Promise<RecoveryPlan> | RecoveryPlan;
  preCommit?: (ctx: HookCtx, patch: ArtifactPatch) => Promise<CommitDecision> | CommitDecision;
  postCommit?: (ctx: HookCtx, receipt: MutationReceipt) => Promise<void> | void;
  preStop?: (ctx: HookCtx, summary: AgentStopSummary) => Promise<StopDecision> | StopDecision;
};

export async function runPreToolHooks(
  hooks: readonly NodeAgentHook[],
  ctx: HookCtx,
  call: ToolCall,
): Promise<{ call: ToolCall; blocked?: BlockedTool }> {
  let nextCall = call;
  for (const hook of hooks) {
    if (!hook.preTool) continue;
    const decision = await hook.preTool(ctx, nextCall);
    if (isBlockedTool(decision)) return { call: nextCall, blocked: decision };
    nextCall = { ...decision, id: call.id };
  }
  return { call: nextCall };
}

export async function runPostToolHooks(
  hooks: readonly NodeAgentHook[],
  ctx: HookCtx,
  call: ToolCall,
  result: ToolResult,
): Promise<void> {
  for (const hook of hooks) {
    await hook.postTool?.(ctx, call, result);
  }
}

export async function runToolErrorHooks(
  hooks: readonly NodeAgentHook[],
  ctx: HookCtx,
  call: ToolCall,
  error: unknown,
): Promise<RecoveryPlan | undefined> {
  let fallback: RecoveryPlan | undefined;
  for (const hook of hooks) {
    if (!hook.toolError) continue;
    const plan = await hook.toolError(ctx, call, error);
    if (plan.action !== "surface_error") return plan;
    fallback = plan;
  }
  return fallback;
}

export async function runPreStopHooks(
  hooks: readonly NodeAgentHook[],
  ctx: HookCtx,
  summary: AgentStopSummary,
): Promise<StopDecision> {
  for (const hook of hooks) {
    if (!hook.preStop) continue;
    const decision = await hook.preStop(ctx, summary);
    if (decision.action !== "allow") return decision;
  }
  return { action: "allow" };
}

export function blockedToolResult(blocked: BlockedTool): {
  ok: false;
  error: "tool_blocked";
  failureKind: ToolFailureKind;
  reason: string;
  recovery?: { action: "retry_or_continue"; instruction: string };
  metadata?: Record<string, unknown>;
} {
  return {
    ok: false,
    error: "tool_blocked",
    failureKind: blocked.failureKind ?? "permission_denied",
    reason: blocked.reason,
    recovery: blocked.recovery
      ? { action: "retry_or_continue", instruction: blocked.recovery }
      : undefined,
    metadata: blocked.metadata,
  };
}

function isBlockedTool(value: ToolCall | BlockedTool): value is BlockedTool {
  return "blocked" in value && value.blocked === true;
}
