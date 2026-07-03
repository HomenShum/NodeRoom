import type { AgentMessage, AgentTraceEvent } from "./types";
import type { AgentStopSummary, HookCtx, NodeAgentHook, StopDecision } from "./hooks";

export const FRESH_CONTEXT_JUDGE_MARKER = "NODEAGENT FRESH JUDGE:";

export const DEFAULT_WRITE_TOOLS = [
  "edit_cell",
  "create_draft",
  "update_wiki",
  "write_cell_result",
  "write_locked_cell",
  "write_locked_cell_result",
  "write_locked_cells",
  "write_locked_cell_results",
  "append_notebook_outline",
  "create_btb_deliverable_package",
] as const;

export interface FreshContextRequiredTool {
  name: string;
  reason: string;
  outcome?: "attempted" | "success";
}

export interface FreshContextJudgeOptions {
  writeTools?: readonly string[];
  packageToolName?: string;
  requiredTools?: readonly FreshContextRequiredTool[];
  requireSuccessfulWrite?: boolean;
}

export interface FreshContextJudgeVerdict {
  verdict: "allow" | "not_done";
  missing: string[];
  reason: string;
  stopDecision: StopDecision;
}

export function createFreshContextJudgeHook(options: FreshContextJudgeOptions = {}): NodeAgentHook {
  return {
    preStop: (ctx, summary) => judgeFreshContext(ctx, summary, options).stopDecision,
  };
}

export function judgeFreshContext(
  ctx: HookCtx,
  _summary: AgentStopSummary,
  options: FreshContextJudgeOptions = {},
): FreshContextJudgeVerdict {
  const packageToolName = options.packageToolName ?? "create_btb_deliverable_package";
  const writeTools = new Set(options.writeTools ?? DEFAULT_WRITE_TOOLS);
  const missing: string[] = [];

  for (const requiredTool of options.requiredTools ?? []) {
    const satisfied = requiredTool.outcome === "attempted"
      ? hasAttemptedTool(ctx, requiredTool.name)
      : hasSuccessfulTool(ctx, requiredTool.name);
    if (!satisfied) missing.push(`${requiredTool.name}: ${requiredTool.reason}`);
  }

  if (looksLikeBtb(ctx.goal) && ctx.availableTools.includes(packageToolName) && !hasSuccessfulTool(ctx, packageToolName)) {
    missing.push(`${packageToolName}: required BTB deliverable package artifacts were not created`);
  }

  if (goalRequiresWrite(ctx.goal)) {
    const hasWrite = options.requireSuccessfulWrite
      ? hasAnySuccessfulTool(ctx, writeTools)
      : hasAnyAttemptedTool(ctx, writeTools);
    if (!hasWrite) missing.push("room-write: the user asked for a write/fill/update but no write tool receipt exists");
  }

  if (missing.length === 0) {
    return {
      verdict: "allow",
      missing,
      reason: "Required NodeRoom receipts are present.",
      stopDecision: { action: "allow", reason: "Required NodeRoom receipts are present." },
    };
  }

  const reason = `Missing proof before stop: ${missing.join("; ")}.`;
  return {
    verdict: "not_done",
    missing,
    reason,
    stopDecision: {
      action: "continue",
      reason,
      prompt: `${FRESH_CONTEXT_JUDGE_MARKER} ${reason} Continue through the real NodeRoom tool path. Do not claim completion in chat only.`,
    },
  };
}

function looksLikeBtb(goal: string): boolean {
  return /\b(bankertoolbench|btb-[a-z0-9]{6,}|btb\b|deliverable package)\b/i.test(goal);
}

function goalRequiresWrite(goal: string): boolean {
  return /\b(write|fill|edit|update|set|create|delete|recompute|commit|apply)\b/i.test(goal);
}

function hasAnyAttemptedTool(ctx: HookCtx, tools: ReadonlySet<string>): boolean {
  return [...tools].some((tool) => hasAttemptedTool(ctx, tool));
}

function hasAnySuccessfulTool(ctx: HookCtx, tools: ReadonlySet<string>): boolean {
  return [...tools].some((tool) => hasSuccessfulTool(ctx, tool));
}

function hasAttemptedTool(ctx: HookCtx, toolName: string): boolean {
  return ctx.trace.some((event) => event.tool === toolName)
    || ctx.messages.some((message) => message.role === "tool" && message.toolName === toolName);
}

function hasSuccessfulTool(ctx: HookCtx, toolName: string): boolean {
  return ctx.trace.some((event) => event.tool === toolName && isSuccessfulToolResult(event.result))
    || ctx.messages.some((message) =>
      message.role === "tool"
      && message.toolName === toolName
      && isSuccessfulToolResult(parseToolMessage(message)),
    );
}

function parseToolMessage(message: AgentMessage): unknown {
  try {
    return message.content ? JSON.parse(message.content) : undefined;
  } catch {
    return undefined;
  }
}

function isSuccessfulToolResult(result: unknown): boolean {
  if (!result || typeof result !== "object") return true;
  const object = result as Record<string, unknown>;
  if (object.pendingApproval === true || typeof object.draftId === "string") return true;
  if (object.conflict === true || object.locked === true) return false;
  if (object.ok === false || typeof object.error === "string") return false;
  return true;
}

export function summarizeTraceTools(trace: readonly AgentTraceEvent[]): Record<string, { attempts: number; successes: number }> {
  const summary: Record<string, { attempts: number; successes: number }> = {};
  for (const event of trace) {
    summary[event.tool] ??= { attempts: 0, successes: 0 };
    summary[event.tool].attempts += 1;
    if (isSuccessfulToolResult(event.result)) summary[event.tool].successes += 1;
  }
  return summary;
}
