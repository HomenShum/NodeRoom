/**
 * The harness loop: context in, bounded model/tool loop, trace out.
 * Conflicts are returned to the model as normal tool data, so a stale write
 * becomes a re-read-and-retry instead of a silent overwrite.
 */

import type { AgentModel, AgentTool, RoomTools, AgentResult, AgentMessage, AgentTraceEvent, AgentStopReason, AgentHandoff, ToolCall, AgentStep } from "./types";
import type { StepJournal } from "./journal";
import { checkSpendCeiling, type SpendLimits } from "../guardrails/gateway";
import { SYSTEM_PROMPT } from "../models/prompts/systemPrompt";
import { buildContext } from "./worldModel";
import { compactMessages, type CompactionOpts } from "./contextCompactor";

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

function isAbortLike(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || /aborted|abort/i.test(error.message));
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
  onHandoff?: (handoff: AgentHandoff) => void;
  now?: () => number;
}): Promise<AgentResult> {
  const { rt, goal, model, tools } = opts;
  const maxSteps = opts.maxSteps ?? 8;
  const now = opts.now ?? (() => Date.now());
  const startedAt = now();
  const reserveMs = Math.max(0, opts.reserveMs ?? DEFAULT_RESERVE_MS);
  const deadlineAt = opts.deadlineAt;

  const messages: AgentMessage[] = [];
  const trace: AgentTraceEvent[] = [];
  let finalText = "";
  let inputTokens = 0, outputTokens = 0, modelCalls = 0, costUsd = 0;
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
  const shouldHandoffForTime = () => deadlineAt !== undefined && now() + reserveMs >= deadlineAt;
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
        ? `Paused after reaching the ${maxSteps}-step budget.`
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
    usage: { inputTokens, outputTokens, modelCalls },
  });
  const emitHandoff = (
    step: number,
    reason: Exclude<AgentStopReason, "done">,
    attempted: number,
    remainingToolCalls: ToolCall[] = [],
  ) => {
    const handoff = makeHandoff(reason, attempted, remainingToolCalls);
    const ev: AgentTraceEvent = { step, tool: "handoff", args: { reason, deadlineAt, reserveMs }, result: handoff, ms: 0 };
    trace.push(ev);
    opts.onTrace?.(ev);
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
  const executeCall = async (call: ToolCall, step: number) => {
    const t0 = now();
    const tool = tools.find((x) => x.name === call.tool);
    let result: unknown;

    if (!tool) {
      result = { error: `unknown tool: ${call.tool}` };
    } else {
      const parsed = tool.schema.safeParse(call.args);
      try {
        result = parsed.success
          ? await tool.execute(parsed.data, rt)
          : { error: "invalid arguments", issues: parsed.error.issues };
      } catch (error) {
        result = { error: describeError(error) };
        const ev: AgentTraceEvent = { step, tool: call.tool, args: call.args, result, ms: now() - t0 };
        trace.push(ev);
        opts.onTrace?.(ev);
        messages.push({ role: "tool", toolCallId: call.id, toolName: call.tool, content: JSON.stringify(result) });
        throw error;
      }
    }

    const ev: AgentTraceEvent = { step, tool: call.tool, args: call.args, result, ms: now() - t0 };
    trace.push(ev);
    opts.onTrace?.(ev);
    messages.push({ role: "tool", toolCallId: call.id, toolName: call.tool, content: JSON.stringify(result) });
  };

  // Goal-progress accounting for the two harness guards (read-loop breaker + done-without-writes
  // bounce). Counts WRITE-intent tool calls across the whole run; each guard fires at most once.
  const WRITE_TOOLS = new Set(["edit_cell", "create_draft", "update_wiki", "write_cell_result", "write_locked_cell", "write_locked_cell_result", "write_locked_cells", "write_locked_cell_results"]);
  let writeCalls = 0;
  let lockCalls = 0;
  let readNudged = false;
  let doneNudged = false;
  const managedWriteToolsAvailable = tools.some((tool) => tool.name.startsWith("write_locked_cell"));
  const goalRequiresWrite = /\b(write|fill|edit|update|set|create|delete|recompute|commit|apply)\b/i.test(goal);
  const finishWriteInstruction = managedWriteToolsAvailable
    ? "Finish the task now: use read_range if you still need current versions, then call write_locked_cells or write_locked_cell_results for the affected range when possible (pendingApproval or drafted results are SUCCESS - never retry them)."
    : "Finish the task now: propose_lock the target cells, then edit_cell each of them with the values implied by what you read (batch the edit_cell calls in one turn; a pendingApproval result is SUCCESS - never retry it).";

  try {
    if (opts.initialMessages?.length) messages.push(...opts.initialMessages);
    else messages.push(...await (opts.contextBuilder ?? buildContext)(rt, goal));

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
        }
      }

      // Exactly-once journal: a retried slice REPLAYS a completed step's recorded output instead of
      // re-calling (and re-billing) the model. Tools still re-execute — safe because writes are CAS-idempotent.
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
          fresh = await model.next({
            system: opts.systemPrompt ?? SYSTEM_PROMPT,
            messages: modelInput,
            tools,
            signal: signal.signal,
            onTextDelta: opts.onTextDelta ? (text) => opts.onTextDelta?.(text, step) : undefined,
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
          costUsd += opts.priceStep?.(model.name, fresh.usage.inputTokens, fresh.usage.outputTokens) ?? 0;
        }
        out = fresh;
      }
      if (out.text) finalText = out.text;

      if (out.done || out.toolCalls.length === 0) {
        const hasFinalText = !!(out.text?.trim() || finalText.trim());
        const stillNeedsWrite = goalRequiresWrite && writeCalls === 0 && lockCalls === 0;
        // Goal-completion guard: a run that ends with ZERO writes (no edit/draft/wiki/result calls)
        // almost certainly wandered — observed live: gemini-flash spent 9 read-only calls hunting
        // source data across artifacts, then declared done with no proposals (the trio-room 0/3
        // incident). Bounce ONCE with a redirect; accept whatever it decides next (termination safe).
        if ((stillNeedsWrite || (writeCalls === 0 && lockCalls === 0 && !doneNudged)) && step < maxSteps - 1) {
          doneNudged = true;
          if (out.text) messages.push({ role: "assistant", content: out.text });
          const prefix = stillNeedsWrite
            ? "HARNESS NOTE: the user asked for a write/fill/update, so a text-only answer is not complete - no cells were written or proposed."
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
        return finish("done", step + 1, false);
      }

      messages.push({ role: "assistant", content: out.text ?? "", toolCalls: out.toolCalls });

      for (const c of out.toolCalls) {
        if (WRITE_TOOLS.has(c.tool)) writeCalls++;
        else if (c.tool === "propose_lock") lockCalls++;
      }

      for (const call of out.toolCalls) {
        if (shouldHandoffForTime()) {
          const handoff = emitHandoff(step, "time_budget", attemptedSteps, out.toolCalls.slice(out.toolCalls.indexOf(call)));
          return finish("time_budget", attemptedSteps, true, handoff);
        }
        // P1-3: remember the calls AFTER this one — if it throws, they are unexecuted and must ride
        // the error handoff (the throwing call itself records a tool_result before re-throwing).
        pendingToolCalls = out.toolCalls.slice(out.toolCalls.indexOf(call) + 1);
        await executeCall(call, step);
      }
      pendingToolCalls = [];

      // Read-loop breaker: 3+ full turns of pure reads with no lock/write yet → ONE steering note,
      // appended AFTER this turn's tool results so the tool_use/tool_result pairing stays intact.
      // The harness owns the budget; a model deep in research-mode reliably burns all 10 steps
      // re-reading otherwise (the trio-room 0/3 incident's other half).
      if (step >= 2 && writeCalls === 0 && lockCalls === 0 && !readNudged) {
        readNudged = true;
        messages.push({ role: "user", content: `HARNESS NOTE: every tool call so far has been a read. The table in your context already holds the data - stop reading. Next turn: ${finishWriteInstruction}` });
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
