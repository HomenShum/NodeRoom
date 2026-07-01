/**
 * Dynamic subagent dispatcher — the NodeRoom adaptation of LangChain's "dynamic subagents"
 * pattern. Instead of a code interpreter calling `task()`, the model calls `plan_and_dispatch`
 * as a regular tool. The runtime intercepts it (it needs model/tools/rt access that normal
 * tools don't have) and runs each subagent as an isolated `runAgent` call.
 *
 * Key differences from LangChain's approach:
 * - No code interpreter / QuickJS / Docker — works with every provider we support.
 * - The model writes a JSON plan (waves of subagents), not JS code.
 * - The runtime executes waves deterministically (Promise.all within a wave, sequential across waves).
 * - Each subagent gets isolated context (fresh messages[]), scoped tools, and a child trace.
 * - Results flow back as a single tool result — the parent's context stays clean.
 */

import { z } from "zod";
import type { AgentModel, AgentTool, AgentTraceEvent, AgentResult, RoomTools, AgentMessage } from "./types";
import type { AgentStreamEventDraft } from "./stream";
import { runAgent } from "./runtime";

/* ── Bounds ── */
const MAX_WAVES = 3;
const MAX_SUBAGENTS_PER_WAVE = 8;
const MAX_TOTAL_SUBAGENTS = 12;
const SUBAGENT_MAX_STEPS = 4;
const SUBAGENT_TIME_BUDGET_MS = 90_000;

/* ── Schema ── */
const subagentSpecSchema = z.object({
  role: z.string().describe("Short role name, e.g. 'researcher', 'auditor', 'evidence'"),
  goal: z.string().describe("The specific task for this subagent"),
  allowedTools: z.array(z.string()).describe("Tool names this subagent may use (subset of available tools)"),
  modelHint: z.string().optional().describe("Optional model preference, e.g. 'minimax/minimax-m3' for research"),
});

export const planAndDispatchSchema = z.object({
  waves: z.array(z.array(subagentSpecSchema)).min(1).max(MAX_WAVES)
    .describe("Execution waves — subagents within a wave run in parallel, waves run sequentially"),
  synthesisGoal: z.string().optional()
    .describe("What you (the parent) will do with the results after this tool returns, e.g. 'Merge findings into a summary sheet'"),
});

/* ── Tool definition (registered so the model can call it; execute is never called — runtime intercepts) ── */
export const PLAN_AND_DISPATCH_TOOL: AgentTool = {
  name: "plan_and_dispatch",
  description:
    "Decompose a complex task into subagent tasks and dispatch them in parallel waves. " +
    "Each subagent runs in ISOLATION with its own context and a scoped subset of tools — " +
    "the parent receives only the final results, keeping context clean. " +
    "Use for: bulk research across many entities, multi-perspective analysis, or any task " +
    "that would clutter your context with intermediate tool outputs. " +
    "Bounded: max 3 waves, 8 subagents per wave, 12 total. Each subagent gets 4 steps and 90s. " +
    "The subagent's allowedTools must be a subset of YOUR available tools. " +
    "After this returns, synthesize the results and write to the room.",
  schema: planAndDispatchSchema,
  execute: async () => ({ ok: false, error: "plan_and_dispatch is runtime-native and should never be called via execute()" }),
};

/* ── Types ── */
export interface SubagentSpec {
  role: string;
  goal: string;
  allowedTools: string[];
  modelHint?: string;
}

export interface SubagentResult {
  role: string;
  goal: string;
  ok: boolean;
  finalText: string;
  steps: number;
  toolCalls: Array<{ tool: string; status: string }>;
  error?: string;
}

export interface PlanAndDispatchResult {
  ok: boolean;
  subagentResults: SubagentResult[];
  totalSubagents: number;
  wavesCompleted: number;
  error?: string;
}

/* ── Runtime context passed from the parent's runAgent loop ── */
export interface SubagentRuntimeCtx {
  model: AgentModel;
  tools: AgentTool[];
  rt: RoomTools;
  parentGoal: string;
  parentStep: number;
  now: () => number;
  deadlineAt?: number;
  onTrace?: (event: AgentTraceEvent) => void;
  onStreamEvent?: (event: AgentStreamEventDraft) => void | Promise<void>;
  systemPrompt?: string;
  contextBuilder?: (rt: RoomTools, goal: string) => Promise<AgentMessage[]>;
}

/* ── The dispatcher — called by runtime.ts when it intercepts plan_and_dispatch ── */
export async function executePlanAndDispatch(
  args: z.infer<typeof planAndDispatchSchema>,
  ctx: SubagentRuntimeCtx,
): Promise<PlanAndDispatchResult> {
  const allSpecs = args.waves.flat();
  if (allSpecs.length > MAX_TOTAL_SUBAGENTS) {
    return {
      ok: false,
      subagentResults: [],
      totalSubagents: allSpecs.length,
      wavesCompleted: 0,
      error: `Too many subagents: ${allSpecs.length} > max ${MAX_TOTAL_SUBAGENTS}`,
    };
  }
  const availableTools = new Set(ctx.tools.map((tool) => tool.name));
  const invalidToolRequests = allSpecs.flatMap((spec) =>
    spec.allowedTools
      .filter((toolName) => toolName === PLAN_AND_DISPATCH_TOOL.name || !availableTools.has(toolName))
      .map((toolName) => `${spec.role}:${toolName}`),
  );
  if (invalidToolRequests.length > 0) {
    return {
      ok: false,
      subagentResults: [],
      totalSubagents: allSpecs.length,
      wavesCompleted: 0,
      error: `Invalid subagent allowedTools: ${invalidToolRequests.join(", ")}`,
    };
  }

  const results: SubagentResult[] = [];
  let wavesCompleted = 0;
  let stoppedForDeadline = false;

  for (let waveIdx = 0; waveIdx < args.waves.length; waveIdx++) {
    const wave = args.waves[waveIdx].slice(0, MAX_SUBAGENTS_PER_WAVE);
    if (wave.length === 0) continue;

    // Emit stream event for wave start
    ctx.onStreamEvent?.({
      kind: "tool_call_start",
      step: ctx.parentStep,
      toolName: "plan_and_dispatch",
      status: "started",
      title: `Wave ${waveIdx + 1}/${args.waves.length}: ${wave.length} subagent${wave.length > 1 ? "s" : ""}`,
    });

    // Run all subagents in this wave in parallel
    const waveResults = await Promise.all(
      wave.map((spec) => runSubagent(spec, ctx)),
    );
    results.push(...waveResults);
    wavesCompleted++;

    // Check if we've exhausted our time budget
    if (ctx.deadlineAt !== undefined && ctx.now() + 15_000 >= ctx.deadlineAt) {
      stoppedForDeadline = true;
      break;
    }
  }

  const failed = results.filter((r) => !r.ok);
  const ok = results.length > 0 && failed.length === 0 && !stoppedForDeadline;
  return {
    ok,
    subagentResults: results,
    totalSubagents: results.length,
    wavesCompleted,
    error: ok
      ? undefined
      : results.length === 0
        ? "No subagents ran"
        : stoppedForDeadline
          ? `Stopped before all waves completed: ${wavesCompleted}/${args.waves.length} waves`
          : `${failed.length}/${results.length} subagents failed`,
  };
}

async function runSubagent(spec: SubagentSpec, ctx: SubagentRuntimeCtx): Promise<SubagentResult> {
  const { model, tools, rt, systemPrompt, contextBuilder } = ctx;

  // Scope tools to the subagent's allowlist
  const allowedSet = new Set(spec.allowedTools);
  const scopedTools = tools.filter((t) => allowedSet.has(t.name));

  // Carve a time budget from the parent's remaining deadline
  const subDeadline = ctx.deadlineAt !== undefined
    ? Math.min(ctx.now() + SUBAGENT_TIME_BUDGET_MS, ctx.deadlineAt - 5_000)
    : ctx.now() + SUBAGENT_TIME_BUDGET_MS;

  try {
    const result: AgentResult = await runAgent({
      rt,
      goal: spec.goal,
      model,
      tools: scopedTools,
      maxSteps: SUBAGENT_MAX_STEPS,
      deadlineAt: subDeadline,
      reserveMs: 5_000,
      systemPrompt: systemPrompt ?? undefined,
      contextBuilder: contextBuilder ?? undefined,
      onTrace: (ev) => {
        // Forward subagent traces to the parent's trace handler with a prefixed tool name
        ctx.onTrace?.({
          ...ev,
          tool: `subagent:${spec.role}:${ev.tool}`,
        });
      },
    });

    const toolCalls = result.trace.map((t) => ({ tool: t.tool, status: toolResultStatus(t.result) }));
    const hasFailedTool = toolCalls.some((t) => t.status === "failed");
    return {
      role: spec.role,
      goal: spec.goal,
      ok: result.stopReason === "done" && !hasFailedTool,
      finalText: result.finalText || `(no output, stopped: ${result.stopReason})`,
      steps: result.steps,
      toolCalls,
      error: result.stopReason === "done" && !hasFailedTool ? undefined : `stopped: ${result.stopReason}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      role: spec.role,
      goal: spec.goal,
      ok: false,
      finalText: "",
      steps: 0,
      toolCalls: [],
      error: message,
    };
  }
}

function toolResultStatus(result: unknown): "ok" | "failed" {
  if (!result || typeof result !== "object") return "ok";
  const object = result as Record<string, unknown>;
  return object.ok === false || typeof object.error === "string" ? "failed" : "ok";
}
