/**
 * The harness loop: context in, bounded model/tool loop, trace out.
 * Conflicts are returned to the model as normal tool data, so a stale write
 * becomes a re-read-and-retry instead of a silent overwrite.
 */

import type { AgentModel, AgentTool, RoomTools, AgentResult, AgentMessage, AgentTraceEvent, AgentStopReason, AgentHandoff, ToolCall, AgentStep, ToolArgumentErrorResult } from "./types";
import type { AgentStreamEventDraft } from "./stream";
import type { StepJournal } from "./journal";
import { checkSpendCeiling, type SpendLimits } from "../guardrails/gateway";
import { SYSTEM_PROMPT } from "../models/prompts/systemPrompt";
import { buildContext } from "./worldModel";
import { compactMessages, type CompactionOpts } from "./contextCompactor";
import { evaluateBtbTaskCoverage } from "../../eval/btbTaskCoverage";
import { executePlanAndDispatch, planAndDispatchSchema } from "./subagentDispatcher";
import {
  blockedToolResult,
  runPostToolHooks,
  runPreStopHooks,
  runPreToolHooks,
  runToolErrorHooks,
  type AgentStopSummary,
  type NodeAgentHook,
} from "./hooks";

function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return typeof error === "string" ? error : JSON.stringify(error) ?? String(error);
}

export class AgentRunError extends Error {
  constructor(
    public readonly cause: unknown,
    public readonly partial: AgentResult,
  ) {
    super(describeError(cause));
    this.name = "AgentRunError";
  }
}

const DEFAULT_RESERVE_MS = 15_000;
const BTB_PACKAGE_NUDGE = "BTB PACKAGE CONTRACT:";
const BTB_PACKAGE_ONLY_AFTER_NUDGES = 1;
const BTB_READ_TOOL_TURN_LIMIT = 24;
export const TOOL_REQUIRED_NO_CALL_MARKER = "tool_required_no_call";
export const TOOL_REQUIRED_NO_CALL_TERMINAL_MARKER = "tool_required_no_call_terminal";
const TOOL_REQUIRED_NO_CALL_TERMINAL_AFTER = 4;

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted|abort/i.test(error.message));
}

function toolResultFailed(result: unknown): boolean {
  if (!result || typeof result !== "object") return false;
  const object = result as Record<string, unknown>;
  if (object.pendingApproval === true) return false;
  return object.ok === false || typeof object.error === "string";
}

function toolArgumentErrorResult(toolName: string, issues: Array<{ path: PropertyKey[]; code: string; message: string }>): ToolArgumentErrorResult {
  const normalized = issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
    message: issue.message,
  }));
  const missingRequiredArgs = normalized
    .filter((issue) => issue.code === "invalid_type" && /required|undefined/i.test(issue.message))
    .map((issue) => issue.path)
    .filter(Boolean);
  return {
    ok: false,
    error: "tool_argument_error",
    failureKind: missingRequiredArgs.length ? "missing_required_arg" : "invalid_arg_type",
    missingRequiredArgs,
    issues: normalized,
    recovery: {
      action: "retry_tool_call",
      instruction: missingRequiredArgs.length
        ? `Retry ${toolName} with the missing required argument(s): ${missingRequiredArgs.join(", ")}.`
        : `Retry ${toolName} with arguments matching its advertised schema.`,
    },
  };
}

function recoverableProviderArgumentException(toolName: string, error: unknown): unknown | null {
  const detail = describeError(error);
  if (!/\b(ArgumentValidationError|Value does not match validator|invalid.*argument|validator)\b/i.test(detail)) return null;
  return {
    ok: false,
    error: "tool_argument_error",
    failureKind: "invalid_arg_type",
    toolName,
    detail,
    recovery: {
      action: "retry_tool_call",
      instruction: `Retry ${toolName} with clean argument values copied from list_artifacts/tool results. Do not paste filenames, XML/tool-call markup, or explanatory text into id fields.`,
    },
  };
}

function goalLooksLikeBtbPackageTask(goal: string, packageToolAvailable: boolean): boolean {
  return packageToolAvailable && /\b(bankertoolbench|btb-[a-z0-9]{6,}|btb\b|deliverable package)\b/i.test(goal);
}

function goalAllowsReadOnlyCompletion(goal: string): boolean {
  return /\b(report|list|count|summari[sz]e|read|inspect|describe|show|tell|answer|what|smoke)\b/i.test(goal);
}

function goalForbidsMaterialWrites(goal: string): boolean {
  return /\b(?:do not|don't|dont|never)\s+(?:create|edit|write|update|fill|set|delete|commit|apply)\b/i.test(goal)
    || /\b(?:read[- ]only|report\b.*\bonly|count\b.*\bonly|without\s+(?:creating|editing|writing)|no\s+\w*\s*(?:artifacts?|cells?)\s+(?:created|edited|written))\b/i.test(goal);
}

function btbTaskIdFromGoal(goal: string): string | undefined {
  return goal.match(/\bbtb-[a-z0-9]{6,}\b/i)?.[0];
}

function btbPackageCoverageFailure(goal: string, toolName: string, args: unknown): unknown | null {
  if (toolName !== "create_btb_deliverable_package") return null;
  const expectedTaskId = btbTaskIdFromGoal(goal);
  const input = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const actualTaskId = typeof input.taskId === "string" ? input.taskId.trim() : undefined;
  if (expectedTaskId && actualTaskId && actualTaskId !== expectedTaskId) {
    return {
      ok: false,
      error: "btb_package_task_id_mismatch",
      failureKind: "task_id_mismatch",
      expectedTaskId,
      actualTaskId,
      recovery: {
        action: "retry_tool_call",
        instruction: `Retry create_btb_deliverable_package with taskId exactly "${expectedTaskId}". Do not include XML/tool-call text, artifact ids, or any suffix in taskId.`,
      },
    };
  }
  const coverage = evaluateBtbTaskCoverage(goal, JSON.stringify(args));
  if (coverage.requiredTickers.length <= 1 || coverage.ok) return null;
  return {
    ok: false,
    error: "btb_package_task_coverage_gate_failed",
    failureKind: "task_coverage",
    requiredTickers: coverage.requiredTickers,
    missingTickers: coverage.missingTickers,
    detail: coverage.detail,
    recovery: {
      action: "retry_tool_call",
      instruction: `Do not create a one-company package. Read or compute rows for the missing requested ticker/entities (${coverage.missingTickers.join(", ")}), then retry create_btb_deliverable_package with rows and narrative explicitly covering all required ticker/entities: ${coverage.requiredTickers.join(", ")}.`,
    },
  };
}

function btbPackageCompletionText(goal: string, args: unknown, result: unknown): string | null {
  if (toolResultFailed(result)) return null;
  const object = result && typeof result === "object" ? result as Record<string, unknown> : {};
  if (object.ok !== true) return null;
  const input = args && typeof args === "object" ? args as Record<string, unknown> : {};
  const taskId = typeof input.taskId === "string" && input.taskId.trim()
    ? input.taskId.trim()
    : btbTaskIdFromGoal(goal) ?? "BTB task";
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : "deliverable package";
  const artifacts = Array.isArray(object.artifacts)
    ? object.artifacts
      .map((artifact) => artifact && typeof artifact === "object" ? artifact as Record<string, unknown> : null)
      .filter((artifact): artifact is Record<string, unknown> => !!artifact)
    : [];
  const fileNames = artifacts
    .map((artifact) => typeof artifact.title === "string" ? artifact.title : undefined)
    .filter((title): title is string => !!title)
    .filter((title) => /\.(xlsx|xlsm|pptx|docx|pdf)$/i.test(title));
  const coverage = evaluateBtbTaskCoverage(goal, JSON.stringify(args));
  const coverageText = coverage.requiredTickers.length > 1
    ? ` Coverage confirmed for ${coverage.requiredTickers.join(", ")}.`
    : "";
  const fileText = fileNames.length
    ? ` Files created: ${fileNames.join(", ")}.`
    : " XLSX, XLSM, PPTX, DOCX, and PDF artifacts created.";
  return `BTB task ${taskId} complete. Deliverable package created: ${title}.${fileText}${coverageText}`;
}

function sayTextFromArgs(args: unknown): string | null {
  const text = args && typeof args === "object" ? (args as Record<string, unknown>).text : undefined;
  return typeof text === "string" && text.trim() ? text.trim() : null;
}

function countToolCalls(messages: AgentMessage[], toolNames: Set<string>): number {
  let count = 0;
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.toolCalls ?? []) if (toolNames.has(call.tool)) count += 1;
    }
  }
  return count;
}

function countUserNotes(messages: AgentMessage[], prefix: string): number {
  return messages.filter((message) => message.role === "user" && message.content?.startsWith(prefix)).length;
}

function countUserNotesContaining(messages: AgentMessage[], text: string): number {
  return messages.filter((message) => message.role === "user" && message.content?.includes(text)).length;
}

function countToolResults(messages: AgentMessage[], toolNames: Set<string>, outcome: "success" | "failure"): number {
  let count = 0;
  for (const message of messages) {
    if (message.role !== "tool" || !message.toolName || !toolNames.has(message.toolName)) continue;
    let parsed: unknown;
    try {
      parsed = message.content ? JSON.parse(message.content) : undefined;
    } catch {
      parsed = undefined;
    }
    const failed = toolResultFailed(parsed);
    if ((outcome === "failure" && failed) || (outcome === "success" && !failed)) count += 1;
  }
  return count;
}

const MANAGED_SCALAR_WRITE_TOOLS = new Set(["write_locked_cell", "write_locked_cell_result"]);
const WRITE_TARGET_KEYS = ["elementId", "cellId", "id", "cell", "cellKey", "targetCell", "target", "targetId", "element_id", "cell_id"];
const WRITE_VALUE_KEYS = ["value", "newValue", "new_value", "result", "text", "content", "expectedValue", "expected_value"];

function hasAnyArg(args: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => args[key] !== undefined && args[key] !== null && args[key] !== "");
}

function exactSingleCellSetFromGoal(goal: string): { elementId: string; value: string } | null {
  const matches = [...goal.matchAll(/\bset\s+([A-Za-z][A-Za-z0-9_]*__[A-Za-z][A-Za-z0-9_]*)\s+(?:exactly\s+)?(?:to|=)\s+["\u201c]([^"\u201d]+)["\u201d]/gi)];
  if (matches.length !== 1) return null;
  const [, elementId, value] = matches[0];
  if (!elementId || value === undefined) return null;
  return { elementId, value };
}

function repairManagedScalarWriteCallFromGoal(call: ToolCall, goal: string): ToolCall {
  if (!MANAGED_SCALAR_WRITE_TOOLS.has(call.tool)) return call;
  const args = call.args && typeof call.args === "object" ? call.args : {};
  if (hasAnyArg(args, WRITE_TARGET_KEYS) && hasAnyArg(args, WRITE_VALUE_KEYS)) return call;
  const exact = exactSingleCellSetFromGoal(goal);
  if (!exact) return call;
  return {
    ...call,
    args: {
      ...args,
      elementId: args.elementId ?? args.cellId ?? exact.elementId,
      value: args.value ?? args.newValue ?? exact.value,
      reason: typeof args.reason === "string" && args.reason.trim() ? args.reason : "exact user-requested cell write",
    },
    providerMetadata: {
      ...call.providerMetadata,
      argumentRepair: "exact_single_cell_set_from_goal",
    },
  };
}

function btbSystemPrompt(base: string, taskId?: string, requiredCoverageTerms: string[] = []): string {
  return `${base}

BTB DELIVERABLE PACKAGE CONTRACT:
- If the user task is BankerToolBench/BTB and create_btb_deliverable_package is available, the run is not complete until that tool creates the package artifacts.
- Uploaded source workbooks are separate room artifacts. Always call list_artifacts and pass the selected source workbook's artifactId to search_sheet_context/read_range. Reading A1-style cells without artifactId reads the primary blank Sheet 1 and is not source evidence.
- For uploaded workbook evidence, prefer source_open_literal with sourceArtifactId plus row and no column to read a compact row. Use individual source_open_literal cell calls only for isolated missing values; do not walk whole workbooks cell by cell.
- Do not keep rereading the same source workbook or task brief after you have enough values to make a banker-facing first package. Use the room trace for provenance.
- The package tool is the required final write. Call it with taskId ${taskId ? `"${taskId}"` : "from the user's prompt"}, concise title, narrative, sourceArtifactIds when known, and rows for the key outputs you computed.
- The package must be benchmark-ready: no placeholder rows, no needs_review/TBD values, no "reviewer can populate later" caveats, and no prose saying source values could not be retrieved. If values are missing, keep using source tools or hand off honestly; do not package a partial.
${requiredCoverageTerms.length > 1 ? `- Multi-entity coverage gate: the package title, narrative, and rows must explicitly cover every requested ticker/entity: ${requiredCoverageTerms.join(", ")}. A one-company package for this task is rejected.` : ""}
- A text-only answer, say-only completion, or another read-only turn does not satisfy a BTB package request.`;
}

export async function runAgent(opts: {
  rt: RoomTools;
  goal: string;
  model: AgentModel;
  tools: AgentTool[];
  maxSteps?: number;
  /** Wall-clock stop point. Used by Convex actions to leave room for trace persistence before the 10-minute cap. */
  deadlineAt?: number;
  /** Time reserved for persistence/cleanup before deadlineAt. Defaults to 15s. */
  reserveMs?: number;
  /** Resume a prior slice from persisted message history instead of rebuilding opening context. */
  initialMessages?: AgentMessage[];
  /** Tool calls returned by the previous slice after it ran out of budget mid-turn. */
  resumeToolCalls?: ToolCall[];
  /** Exactly-once journal: on a slice retry, replay a completed step's model output instead of re-calling (re-billing) the model. */
  journal?: StepJournal;
  /** LLM gateway spend ceiling — stop (with a resumable handoff) before a model call once the per-run token cap is hit. */
  spendLimits?: SpendLimits;
  /** P0-4: price a completed step in USD so maxCostUsd actually fires — without this the gate
   *  receives costUsd:0 and the dollar half of the ceiling is dead surface (HONEST_STATUS class).
   *  Pass priceRun (src/nodeagent/models/adapter.ts) or convexPriceRun (src/nodeagent/models/convexModel.ts) from the caller. */
  priceStep?: (modelName: string, inputTokens: number, outputTokens: number) => number;
  /** Keep the model's context bounded on long runs. */
  compaction?: CompactionOpts;
  /** Override the JIT context assembly. Defaults to buildContext. */
  contextBuilder?: (rt: RoomTools, goal: string) => Promise<AgentMessage[]>;
  /** Override the concurrency protocol prompt. Defaults to the explicit lock/CAS prompt. */
  systemPrompt?: string;
  onTrace?: (e: AgentTraceEvent) => void;
  /** Optional provider text delta hook. Used by durable public jobs to stream actual LLM prose. */
  onTextDelta?: (text: string, step: number) => void | Promise<void>;
  /** Optional UI-message-shaped lifecycle hook. Used by durable jobs to show tool/step parts beside text. */
  onStreamEvent?: (event: AgentStreamEventDraft) => void | Promise<void>;
  onHandoff?: (handoff: AgentHandoff) => void;
  /** Runtime policy/proof hooks for NodeRoom tool gates, trace receipts, and fresh-context stop checks. */
  hooks?: NodeAgentHook[];
  now?: () => number;
}): Promise<AgentResult> {
  const { rt, goal, model, tools } = opts;
  const hooks = opts.hooks ?? [];
  const maxSteps = opts.maxSteps ?? 8;
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const reserveMs = Math.max(0, opts.reserveMs ?? DEFAULT_RESERVE_MS);
  const deadlineAt = opts.deadlineAt;

  const messages: AgentMessage[] = [];
  const trace: AgentTraceEvent[] = [];
  let finalText = "";
  let inputTokens = 0, outputTokens = 0, modelCalls = 0, costUsd = 0, cachedInputTokens = 0;
  let attemptedSteps = 0;
  // P1-3: tool calls not yet executed in the current turn — preserved on an error handoff so the
  // resume cursor never carries unpaired assistant tool_use blocks.
  let pendingToolCalls: ToolCall[] = [];

  const budget = (attempted: number) => {
    const t = now();
    const remainingMs = deadlineAt === undefined ? undefined : Math.max(0, deadlineAt - t);
    return {
      startedAt,
      now: t,
      deadlineAt,
      reserveMs,
      elapsedMs: Math.max(0, t - startedAt),
      remainingMs,
      usableMs: remainingMs === undefined ? undefined : Math.max(0, remainingMs - reserveMs),
      maxSteps,
      attemptedSteps: attempted,
    };
  };
  const hookCtx = (step: number) => ({
    goal,
    step,
    startedAt,
    modelName: model.name,
    availableTools: tools.map((tool) => tool.name),
    messages,
    trace,
    budget: budget(attemptedSteps),
    now,
  });
  const shouldHandoffForTime = () => deadlineAt !== undefined && now() + reserveMs >= deadlineAt;
  const emitStreamEvent = (event: AgentStreamEventDraft) => {
    try {
      const result = opts.onStreamEvent?.({ createdAt: now(), ...event });
      if (result && typeof (result as Promise<void>).catch === "function") void (result as Promise<void>).catch(() => undefined);
    } catch {
      // Streaming telemetry must never change the model/tool control flow.
    }
  };
  const latestAssistantText = () => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.content) return m.content;
    }
    return finalText || undefined;
  };
  const makeHandoff = (
    reason: Exclude<AgentStopReason, "done">,
    attempted: number,
    remainingToolCalls: ToolCall[] = [],
  ): AgentHandoff => ({
    reason,
    summary: reason === "time_budget"
      ? `Paused before the action deadline with ${budget(attempted).usableMs ?? 0}ms usable budget remaining.`
      : reason === "step_budget"
        ? `Checkpointed after this run slice used its configured step window; resume with preserved trace, context, and remaining work.`
        : reason === "spend_budget"
          ? "Paused at the spend ceiling (per-run token/cost cap)."
          : "Paused after an agent runtime error.",
    nextGoal: goal,
    remainingToolCalls,
    messageCount: messages.length,
    traceCount: trace.length,
    latestAssistantText: latestAssistantText(),
  });
  const finish = (
    stopReason: AgentStopReason,
    attempted: number,
    exhausted: boolean,
    handoff?: AgentHandoff,
  ): AgentResult => ({
    finalText: finalText || handoff?.summary || "",
    steps: attempted,
    exhausted,
    stopReason,
    handoff,
    budget: budget(attempted),
    trace,
    messages,
    usage: { inputTokens, outputTokens, modelCalls, cachedInputTokens },
  });
  const emitHandoff = (
    step: number,
    reason: Exclude<AgentStopReason, "done">,
    attempted: number,
    remainingToolCalls: ToolCall[] = [],
    customSummary?: string,
  ) => {
    const handoff = makeHandoff(reason, attempted, remainingToolCalls);
    if (customSummary) handoff.summary = customSummary;
    const ev: AgentTraceEvent = { step, tool: "handoff", args: { reason, deadlineAt, reserveMs }, result: handoff, ms: 0 };
    trace.push(ev);
    opts.onTrace?.(ev);
    emitStreamEvent({
      kind: "warning",
      step,
      status: "skipped",
      title: "Agent paused",
      text: handoff.summary,
      metadata: { reason, remainingToolCalls: remainingToolCalls.length },
    });
    opts.onHandoff?.(handoff);
    return handoff;
  };
  const modelSignal = () => {
    if (deadlineAt === undefined) return { signal: undefined, cancel: () => undefined };
    const controller = new AbortController();
    const timeoutMs = Math.max(0, deadlineAt - reserveMs - now());
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), timeoutMs);
    return {
      signal: controller.signal,
      cancel: () => clearTimeout(timer),
    };
  };
  const executeCall = async (call: ToolCall, step: number): Promise<unknown> => {
    const t0 = now();
    const prepared = await runPreToolHooks(hooks, hookCtx(step), call);
    const activeCall = repairManagedScalarWriteCallFromGoal({ ...prepared.call, id: call.id }, goal);
    replaceAssistantToolCall(call.id, activeCall);
    const tool = tools.find((x) => x.name === activeCall.tool);
    let result: unknown;
    emitStreamEvent({
      kind: "tool_call_start",
      step,
      toolCallId: call.id,
      toolName: activeCall.tool,
      status: "started",
      input: activeCall.args,
    });

    if (prepared.blocked) {
      result = blockedToolResult(prepared.blocked);
    } else if (!tool) {
      result = { ok: false, error: `unknown tool: ${activeCall.tool}`, failureKind: "unknown_tool" };
    } else if (activeCall.tool === "plan_and_dispatch") {
      const parsed = planAndDispatchSchema.safeParse(activeCall.args);
      if (parsed.success) {
        result = await executePlanAndDispatch(parsed.data, {
          model, tools, rt, parentGoal: goal, parentStep: step, now,
          deadlineAt, onTrace: opts.onTrace, onStreamEvent: emitStreamEvent,
          systemPrompt: opts.systemPrompt, contextBuilder: opts.contextBuilder,
        });
      } else {
        result = toolArgumentErrorResult("plan_and_dispatch", parsed.error.issues);
      }
    } else {
      const parsed = tool.schema.safeParse(activeCall.args);
      try {
        if (parsed.success) {
          result = btbPackageCoverageFailure(goal, activeCall.tool, parsed.data) ?? await tool.execute(parsed.data, rt);
        } else {
          result = toolArgumentErrorResult(activeCall.tool, parsed.error.issues);
        }
      } catch (error) {
        const recoverable = recoverableProviderArgumentException(activeCall.tool, error);
        const hookRecovery = await runToolErrorHooks(hooks, hookCtx(step), activeCall, error);
        result = recoverable ?? hookRecovery?.toolResult ?? {
          ok: false,
          error: describeError(error),
          recovery: hookRecovery,
        };
        const ev: AgentTraceEvent = { step, tool: activeCall.tool, args: activeCall.args, result, ms: now() - t0 };
        trace.push(ev);
        opts.onTrace?.(ev);
        emitStreamEvent({
          kind: "tool_call_result",
          step,
          toolCallId: call.id,
          toolName: activeCall.tool,
          status: "failed",
          input: activeCall.args,
          output: result,
          error: describeError(error),
          metadata: { ms: ev.ms },
        });
        messages.push({ role: "tool", toolCallId: call.id, toolName: activeCall.tool, content: JSON.stringify(result) });
        await runPostToolHooks(hooks, hookCtx(step), activeCall, result);
        if (recoverable || hookRecovery?.action === "recover") return result;
        throw error;
      }
    }

    const ev: AgentTraceEvent = { step, tool: activeCall.tool, args: activeCall.args, result, ms: now() - t0 };
    trace.push(ev);
    opts.onTrace?.(ev);
    emitStreamEvent({
      kind: "tool_call_result",
      step,
      toolCallId: call.id,
      toolName: activeCall.tool,
      status: toolResultFailed(result) ? "failed" : "completed",
      input: activeCall.args,
      output: result,
      metadata: { ms: ev.ms },
    });
    messages.push({ role: "tool", toolCallId: call.id, toolName: activeCall.tool, content: JSON.stringify(result) });
    await runPostToolHooks(hooks, hookCtx(step), activeCall, result);
    return result;
  };

  const replaceAssistantToolCall = (toolCallId: string, nextCall: ToolCall) => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "assistant" || !message.toolCalls?.length) continue;
      const callIndex = message.toolCalls.findIndex((item) => item.id === toolCallId);
      if (callIndex === -1) continue;
      message.toolCalls = message.toolCalls.map((item, itemIndex) => itemIndex === callIndex ? nextCall : item);
      return;
    }
  };

  const finishDoneOrContinue = async (
    step: number,
    attempted: number,
    summary: AgentStopSummary,
  ): Promise<AgentResult | null> => {
    const decision = await runPreStopHooks(hooks, hookCtx(step), summary);
    if (decision.action === "allow") return finish("done", attempted, false);
    const prompt = decision.prompt ?? `NODEAGENT FRESH JUDGE: ${decision.reason}`;
    if ((decision.action === "continue" || decision.action === "block") && step < maxSteps - 1) {
      messages.push({ role: "user", content: prompt });
      return null;
    }
    const handoff = emitHandoff(
      attempted,
      "step_budget",
      attempted,
      [],
      `Pre-stop gate blocked completion: ${decision.reason}`,
    );
    return finish("step_budget", attempted, true, handoff);
  };

  // Goal-progress accounting for the two harness guards (read-loop breaker + done-without-writes
  // bounce). Counts WRITE-intent tool calls across the whole run; each guard fires at most once.
  const WRITE_TOOLS = new Set(["edit_cell", "create_draft", "update_wiki", "append_notebook_outline", "write_cell_result", "write_locked_cell", "write_locked_cell_result", "write_locked_cells", "write_locked_cell_results", "create_btb_deliverable_package"]);
  let writeCalls = 0;
  let lockCalls = 0;
  let readNudged = false;
  let doneNudged = false;
  let requiredNoToolNudges = 0;
  const managedWriteToolsAvailable = tools.some((tool) => tool.name.startsWith("write_locked_cell"));
  const btbPackageToolAvailable = tools.some((tool) => tool.name === "create_btb_deliverable_package");
  const btbPackageTools = new Set(["create_btb_deliverable_package"]);
  const btbPackageTask = goalLooksLikeBtbPackageTask(goal, btbPackageToolAvailable);
  const btbTaskId = btbTaskIdFromGoal(goal);
  const btbRequiredCoverageTerms = evaluateBtbTaskCoverage(goal, "").requiredTickers;
  const btbCoverageInstruction = btbRequiredCoverageTerms.length > 1
    ? ` Include explicit package rows/narrative for every requested ticker/entity: ${btbRequiredCoverageTerms.join(", ")}; a one-company package will be rejected.`
    : "";
  const goalRequiresWrite = !goalForbidsMaterialWrites(goal) && /\b(write|fill|edit|update|set|create|delete|recompute|commit|apply)\b/i.test(goal);
  const goalRequiresPackage = btbPackageTask;
  const readOnlyCompletionAllowed = !goalRequiresWrite && !goalRequiresPackage && goalAllowsReadOnlyCompletion(goal);
  const finishWriteInstruction = goalRequiresPackage
    ? `Finish the task now: call create_btb_deliverable_package with taskId ${btbTaskId ? `exactly "${btbTaskId}"` : "from the user prompt"}, a concise title/narrative, sourceArtifactIds for the uploaded files used, and rows for the key computed outputs.${btbCoverageInstruction} The package tool creates the required .xlsx, .xlsm, .pptx, .docx, .pdf, and manifest artifacts; do not keep explaining in chat. Do not call it with placeholders, needs_review/TBD values, or "reviewer can populate later" caveats.`
    : managedWriteToolsAvailable
    ? "Finish the task now: use read_range if you still need current versions, then call write_locked_cells or write_locked_cell_results for the affected range when possible (pendingApproval or drafted results are SUCCESS - never retry them)."
    : "Finish the task now: propose_lock the target cells, then edit_cell each of them with the values implied by what you read (batch the edit_cell calls in one turn; a pendingApproval result is SUCCESS - never retry it).";
  const btbPackageInstruction = `${BTB_PACKAGE_NUDGE} This official BTB run still has no deliverable package. Your next model turn must call create_btb_deliverable_package${btbTaskId ? ` with taskId "${btbTaskId}"` : ""} only if the package rows are benchmark-ready.${btbCoverageInstruction} Stop reading unless a named value is missing from the package rows; if values are missing, prefer source_open_literal row-level calls ({sourceArtifactId,row}) and use individual cells only for isolated missing values. Never package placeholders, needs_review/TBD values, or "reviewer can populate later" caveats.`;

  try {
    if (opts.initialMessages?.length) messages.push(...opts.initialMessages);
    else messages.push(...await (opts.contextBuilder ?? buildContext)(rt, goal));
    if (messages.length) {
      writeCalls = countToolCalls(messages, WRITE_TOOLS);
      lockCalls = countToolCalls(messages, new Set(["propose_lock"]));
      readNudged = countUserNotes(messages, "HARNESS NOTE: every tool call so far has been a read.") > 0;
      requiredNoToolNudges = countUserNotesContaining(messages, TOOL_REQUIRED_NO_CALL_MARKER);
      doneNudged = countUserNotes(messages, "HARNESS NOTE: the user asked for a write/fill/update") > 0
        || countUserNotes(messages, "HARNESS NOTE: the user asked for a BTB deliverable package") > 0
        || countUserNotes(messages, "HARNESS NOTE: this run cannot be complete") > 0
        || countUserNotes(messages, "HARNESS NOTE: the provider returned an empty no-op") > 0
        || requiredNoToolNudges > 0;
    }
    let btbPackageSuccesses = countToolResults(messages, btbPackageTools, "success");
    let btbPackageFailures = countToolResults(messages, btbPackageTools, "failure");
    let btbPackageNudges = countUserNotes(messages, BTB_PACKAGE_NUDGE);
    if (goalRequiresPackage && btbPackageSuccesses === 0 && btbPackageNudges === 0 && opts.initialMessages?.length) {
      messages.push({ role: "user", content: btbPackageInstruction });
      btbPackageNudges += 1;
    }

    if (opts.resumeToolCalls?.length) {
      attemptedSteps = 1;
      for (const call of opts.resumeToolCalls) {
        if (shouldHandoffForTime()) {
          const handoff = emitHandoff(0, "time_budget", attemptedSteps, opts.resumeToolCalls.slice(opts.resumeToolCalls.indexOf(call)));
          return finish("time_budget", attemptedSteps, true, handoff);
        }
        pendingToolCalls = opts.resumeToolCalls.slice(opts.resumeToolCalls.indexOf(call) + 1); // P1-3
        await executeCall(call, 0);
      }
      pendingToolCalls = [];
    }

    for (let step = 0; step < maxSteps; step++) {
      if (shouldHandoffForTime()) {
        const handoff = emitHandoff(step, "time_budget", attemptedSteps);
        return finish("time_budget", attemptedSteps, true, handoff);
      }
      attemptedSteps = step + 1;
      let modelInput = messages;
      if (opts.compaction) {
        const c = await compactMessages(messages, opts.compaction);
        modelInput = c.messages;
        if (c.compacted) {
          const ev: AgentTraceEvent = { step, tool: "compaction", args: { elided: c.elided }, result: { before: c.before, after: c.after }, ms: 0 };
          trace.push(ev);
          opts.onTrace?.(ev);
          emitStreamEvent({
            kind: "warning",
            step,
            status: "completed",
            title: "Context compacted",
            metadata: { elided: c.elided, before: c.before, after: c.after },
          });
        }
      }

      // Exactly-once journal: a retried slice REPLAYS a completed step's recorded output instead of
      // re-calling (and re-billing) the model. Tools still re-execute — safe because writes are CAS-idempotent.
      const packageOnlyTools = goalRequiresPackage && btbPackageSuccesses === 0 && btbPackageNudges >= BTB_PACKAGE_ONLY_AFTER_NUDGES
        ? tools.filter((tool) => btbPackageTools.has(tool.name))
        : tools;
      const packageOnlyMode = packageOnlyTools.length > 0 && packageOnlyTools.every((tool) => btbPackageTools.has(tool.name));
      const offeredTools = packageOnlyTools.length ? packageOnlyTools : tools;
      const requiresToolThisTurn = offeredTools.length > 0 && (
        (goalRequiresPackage && btbPackageSuccesses === 0)
        || (goalRequiresWrite && writeCalls === 0 && lockCalls === 0)
      );
      const cached = await opts.journal?.get(step);
      let out: AgentStep;
      if (cached) {
        out = cached;
      } else {
        // Gateway spend ceiling — stop before a billable call once the per-run token OR dollar cap
        // is hit (resumable). costUsd accumulates via opts.priceStep (P0-4: previously hardcoded 0,
        // which made maxCostUsd unable to ever fire).
        if (opts.spendLimits) {
          const gate = checkSpendCeiling({ inputTokens, outputTokens, costUsd }, opts.spendLimits);
          if (!gate.ok) {
            const handoff = emitHandoff(step, "spend_budget", attemptedSteps);
            return finish("spend_budget", attemptedSteps, true, handoff);
          }
        }
        const signal = modelSignal();
        let fresh: AgentStep;
        try {
          emitStreamEvent({
            kind: "step_start",
            step,
            status: "started",
            title: `Model turn ${step + 1}`,
            metadata: { model: model.name, maxSteps, step: step + 1 },
          });
          fresh = await model.next({
            system: goalRequiresPackage ? btbSystemPrompt(opts.systemPrompt ?? SYSTEM_PROMPT, btbTaskId, btbRequiredCoverageTerms) : opts.systemPrompt ?? SYSTEM_PROMPT,
            messages: modelInput,
            tools: offeredTools,
            signal: signal.signal,
            onTextDelta: opts.onTextDelta ? (text) => opts.onTextDelta?.(text, step) : undefined,
            toolChoice: requiresToolThisTurn ? "required" : "auto",
          });
        } catch (error) {
          if (signal.signal?.aborted || (shouldHandoffForTime() && isAbortLike(error))) {
            const handoff = emitHandoff(step, "time_budget", attemptedSteps);
            return finish("time_budget", attemptedSteps, true, handoff);
          }
          throw error;
        } finally {
          signal.cancel();
        }
        await opts.journal?.record(step, fresh);
        modelCalls++; // count + bill ONLY a real model call (a replayed step was already billed)
        if (fresh.usage) {
          inputTokens += fresh.usage.inputTokens;
          outputTokens += fresh.usage.outputTokens;
          cachedInputTokens += fresh.usage.cachedInputTokens ?? 0;
          costUsd += opts.priceStep?.(model.name, fresh.usage.inputTokens, fresh.usage.outputTokens) ?? 0;
        }
        out = fresh;
      }
      if (out.text) finalText = out.text;

      // Emit reasoning/plan stream events when the model produces text alongside tool calls.
      // Step 0 text → "plan" (game plan); later steps → "reasoning" (thoughts).
      if (out.text?.trim() && out.toolCalls.length > 0) {
        emitStreamEvent({
          kind: step === 0 ? "plan" : "reasoning",
          step,
          status: "completed",
          text: out.text.trim(),
          metadata: step === 0 ? { goal } : undefined,
        });
      }

      if (out.done || out.toolCalls.length === 0) {
        const hasFinalText = !!(out.text?.trim() || finalText.trim());
        const stillNeedsWrite = (goalRequiresWrite && writeCalls === 0 && lockCalls === 0) || (goalRequiresPackage && btbPackageSuccesses === 0);
        const noRequiredToolCall = requiresToolThisTurn && out.toolCalls.length === 0;
        if (noRequiredToolCall && (doneNudged || packageOnlyMode)) {
          if (out.text) messages.push({ role: "assistant", content: out.text });
          requiredNoToolNudges += 1;
          messages.push({
            role: "user",
            content: `HARNESS NOTE: ${TOOL_REQUIRED_NO_CALL_MARKER} ${requiredNoToolNudges}/${TOOL_REQUIRED_NO_CALL_TERMINAL_AFTER}. The provider returned text/no-op output after the runtime required a tool call for this required-write task. Refresh context around the required action and continue with an actual tool call now. ${goalRequiresPackage ? finishWriteInstruction : ""}`,
          });
          emitStreamEvent({
            kind: "warning",
            step,
            status: "skipped",
            title: "Required tool call missing",
            text: "Provider returned no tool call during a required-write turn; NodeAgent refreshed the instruction and preserved the trace for the next slice.",
            metadata: { requiredNoToolNudges, requiredAfter: TOOL_REQUIRED_NO_CALL_TERMINAL_AFTER, goalRequiresPackage, goalRequiresWrite },
          });
          if (requiredNoToolNudges < TOOL_REQUIRED_NO_CALL_TERMINAL_AFTER && step < maxSteps - 1) {
            continue;
          }
          const handoff = emitHandoff(
            step + 1,
            "step_budget",
            step + 1,
            [],
            `required tool call missing after ${requiredNoToolNudges} required tool-use turn${requiredNoToolNudges === 1 ? "" : "s"}; checkpointed with a narrowed instruction so the next slice can force the required ${goalRequiresPackage ? "deliverable package tool" : "write tool"}.`,
          );
          return finish("step_budget", step + 1, true, handoff);
        }
        if (goalRequiresPackage && btbPackageSuccesses === 0 && packageOnlyMode) {
          if (out.text) messages.push({ role: "assistant", content: out.text });
          messages.push({
            role: "user",
            content: `${BTB_PACKAGE_NUDGE} The model was offered only create_btb_deliverable_package but returned no tool call. This benchmark task is incomplete; do not fabricate a fallback package.`,
          });
          const handoff = emitHandoff(step + 1, "step_budget", step + 1);
          return finish("step_budget", step + 1, true, handoff);
        }
        // Goal-completion guard: a run that ends with ZERO writes (no edit/draft/wiki/result calls)
        // almost certainly wandered — observed live: gemini-flash spent 9 read-only calls hunting
        // source data across artifacts, then declared done with no proposals (the trio-room 0/3
        // incident). Bounce ONCE with a redirect; accept whatever it decides next (termination safe).
        if ((stillNeedsWrite || (!readOnlyCompletionAllowed && writeCalls === 0 && lockCalls === 0 && !doneNudged)) && step < maxSteps - 1) {
          doneNudged = true;
          if (out.text) messages.push({ role: "assistant", content: out.text });
          const prefix = stillNeedsWrite
            ? goalRequiresPackage && btbPackageSuccesses === 0
              ? "HARNESS NOTE: the user asked for a BTB deliverable package, so a text-only answer is not complete - no package artifacts were created."
              : "HARNESS NOTE: the user asked for a write/fill/update, so a text-only answer is not complete - no cells were written or proposed."
            : "HARNESS NOTE: this run cannot be complete - no cells were written or proposed.";
          messages.push({ role: "user", content: `${prefix} You already have the data you need in context. ${finishWriteInstruction}` });
          continue;
        }
        if (stillNeedsWrite) {
          const handoff = emitHandoff(step + 1, "step_budget", step + 1);
          return finish("step_budget", step + 1, true, handoff);
        }
        if (writeCalls === 0 && lockCalls === 0 && !hasFinalText) {
          if (step < maxSteps - 1) {
            messages.push({ role: "user", content: `HARNESS NOTE: the provider returned an empty no-op completion. Continue with an actual answer or tool call. ${finishWriteInstruction}` });
            continue;
          }
          const handoff = emitHandoff(step + 1, "step_budget", step + 1);
          return finish("step_budget", step + 1, true, handoff);
        }
        if (out.text) messages.push({ role: "assistant", content: out.text });
        const doneResult = await finishDoneOrContinue(step, step + 1, {
          proposedStopReason: "done",
          finalText,
          steps: step + 1,
          exhausted: false,
        });
        if (doneResult) return doneResult;
        continue;
      }

      let toolCallsForTurn = out.toolCalls;
      let truncatedBtbToolCalls = 0;
      let failedBtbPackageThisTurn = false;
      if (goalRequiresPackage && btbPackageSuccesses === 0) {
        const packageCalls = out.toolCalls.filter((call) => btbPackageTools.has(call.tool));
        if (packageCalls.length > 0 && packageCalls.length < out.toolCalls.length) {
          toolCallsForTurn = packageCalls;
          truncatedBtbToolCalls = out.toolCalls.length - packageCalls.length;
        } else if (packageCalls.length === 0 && out.toolCalls.length > BTB_READ_TOOL_TURN_LIMIT && out.toolCalls.every((call) => !WRITE_TOOLS.has(call.tool))) {
          toolCallsForTurn = out.toolCalls.slice(0, BTB_READ_TOOL_TURN_LIMIT);
          truncatedBtbToolCalls = out.toolCalls.length - toolCallsForTurn.length;
        }
        if (truncatedBtbToolCalls > 0) {
          emitStreamEvent({
            kind: "warning",
            step,
            status: "skipped",
            title: "BTB read batch limited",
            text: `Skipped ${truncatedBtbToolCalls} excess read-only tool call(s) so the next turn can create the required package.`,
            metadata: { originalToolCalls: out.toolCalls.length, executedToolCalls: toolCallsForTurn.length, skippedToolCalls: truncatedBtbToolCalls },
          });
        }
      }

      messages.push({ role: "assistant", content: out.text ?? "", toolCalls: toolCallsForTurn });

      for (const c of toolCallsForTurn) {
        if (WRITE_TOOLS.has(c.tool)) writeCalls++;
        else if (c.tool === "propose_lock") lockCalls++;
      }

      for (const [callIndex, call] of toolCallsForTurn.entries()) {
        if (shouldHandoffForTime()) {
          const handoff = emitHandoff(step, "time_budget", attemptedSteps, toolCallsForTurn.slice(callIndex));
          return finish("time_budget", attemptedSteps, true, handoff);
        }
        // P1-3: remember the calls AFTER this one — if it throws, they are unexecuted and must ride
        // the error handoff (the throwing call itself records a tool_result before re-throwing).
        pendingToolCalls = toolCallsForTurn.slice(callIndex + 1);
        const result = await executeCall(call, step);
        if (btbPackageTools.has(call.tool)) {
          if (toolResultFailed(result)) {
            btbPackageFailures++;
            failedBtbPackageThisTurn = true;
          }
          else {
            btbPackageSuccesses++;
            finalText = btbPackageCompletionText(goal, call.args, result) ?? finalText;
          }
        }
        if (call.tool === "say" && !toolResultFailed(result)) {
          finalText = sayTextFromArgs(call.args) ?? finalText;
          if (pendingToolCalls.length === 0 && !goalRequiresWrite && !goalRequiresPackage) {
            const doneResult = await finishDoneOrContinue(step, step + 1, {
              proposedStopReason: "done",
              finalText,
              steps: step + 1,
              exhausted: false,
            });
            if (doneResult) return doneResult;
          }
        }
      }
      pendingToolCalls = [];

      // Read-loop breaker: 3+ full turns of pure reads with no lock/write yet → ONE steering note,
      // appended AFTER this turn's tool results so the tool_use/tool_result pairing stays intact.
      // The harness owns the budget; a model deep in research-mode reliably burns all 10 steps
      // re-reading otherwise (the trio-room 0/3 incident's other half).
      if (goalRequiresPackage && btbPackageSuccesses > 0) {
        const doneResult = await finishDoneOrContinue(step, step + 1, {
          proposedStopReason: "done",
          finalText,
          steps: step + 1,
          exhausted: false,
        });
        if (doneResult) return doneResult;
        continue;
      }
      if (goalRequiresPackage && btbPackageSuccesses === 0 && failedBtbPackageThisTurn) {
        btbPackageNudges = Math.max(btbPackageNudges + 1, BTB_PACKAGE_ONLY_AFTER_NUDGES);
        messages.push({
          role: "user",
          content: `${BTB_PACKAGE_NUDGE} The package tool rejected the previous call. Fix the rejected arguments/content and retry create_btb_deliverable_package now${btbTaskId ? ` with taskId "${btbTaskId}"` : ""}. Use scalar row values only, remove placeholder/dummy/TBD values, and do not reopen broad source-reading unless the rejection explicitly named missing task coverage.${btbCoverageInstruction}`,
        });
      }
      if (goalRequiresPackage && btbPackageSuccesses === 0 && truncatedBtbToolCalls > 0) {
        btbPackageNudges = Math.max(btbPackageNudges + 1, BTB_PACKAGE_ONLY_AFTER_NUDGES);
        messages.push({
          role: "user",
          content: `${BTB_PACKAGE_NUDGE} The previous model turn requested ${out.toolCalls.length} tool calls; the runtime executed ${toolCallsForTurn.length} and skipped ${truncatedBtbToolCalls} excess read-only calls to keep this benchmark moving. Use the completed reads and room context now. Next turn must call create_btb_deliverable_package${btbTaskId ? ` with taskId "${btbTaskId}"` : ""}; do not issue another bulk read batch.${btbCoverageInstruction}`,
        });
      }
      if (step >= 2 && writeCalls === 0 && lockCalls === 0 && !readNudged) {
        readNudged = true;
        messages.push({ role: "user", content: `HARNESS NOTE: every tool call so far has been a read. The table in your context already holds the data - stop reading. Next turn: ${finishWriteInstruction}` });
      } else if (goalRequiresPackage && btbPackageSuccesses === 0 && step >= 1) {
        btbPackageNudges += 1;
        messages.push({ role: "user", content: btbPackageNudges >= 2 ? `${btbPackageInstruction} This is a required write gate, not optional guidance.` : btbPackageInstruction });
      }
    }

    const handoff = emitHandoff(maxSteps, "step_budget", maxSteps);
    return finish("step_budget", maxSteps, true, handoff);
  } catch (error) {
    if (error instanceof AgentRunError) throw error;
    // P1-3: preserve the unexecuted tool calls. With remainingToolCalls=[] (the old default), the
    // checkpointed cursor held an assistant message whose trailing tool_use blocks had no paired
    // tool_results — every durable-lane resume then 400'd at the provider until maxAttempts killed
    // the job. Resume replays these via resumeToolCalls, completing the pairs before the next model call.
    const handoff = emitHandoff(attemptedSteps, "error", attemptedSteps, pendingToolCalls);
    throw new AgentRunError(error, finish("error", attemptedSteps, false, handoff));
  }
}
