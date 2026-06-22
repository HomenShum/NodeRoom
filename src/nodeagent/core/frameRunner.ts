import { AgentRunError, runAgent } from "./runtime";
import { buildContext } from "./worldModel";
import { buildFrameContextMessages, frameRuntimeGoal } from "./contextPack";
import { reduceFrameResult } from "./frameReducer";
import { verifyFrameOutcome, type FrameVerification } from "./frameVerifier";
import type { CompactionOpts } from "./contextCompactor";
import type { StepJournal } from "./journal";
import type {
  AgentHandoff,
  AgentMessage,
  AgentModel,
  AgentResult,
  AgentTool,
  AgentTraceEvent,
  RoomTools,
  ToolCall,
} from "./types";
import type { AgentStreamEventDraft } from "./stream";
import type { SpendLimits } from "../guardrails/gateway";
import type { FrameDelta, ReasoningFrame } from "./reasoningFrames";

export interface FrameToolSelection {
  allowedTools: AgentTool[];
  allowedToolNames: string[];
  missingToolNames: string[];
}

export interface RunReasoningFrameOptions {
  rt: RoomTools;
  frame: ReasoningFrame;
  model: AgentModel;
  tools: AgentTool[];
  maxSteps?: number;
  deadlineAt?: number;
  reserveMs?: number;
  initialMessages?: AgentMessage[];
  resumeToolCalls?: ToolCall[];
  journal?: StepJournal;
  spendLimits?: SpendLimits;
  priceStep?: (modelName: string, inputTokens: number, outputTokens: number) => number;
  compaction?: CompactionOpts;
  systemPrompt?: string;
  onTrace?: (event: AgentTraceEvent) => void;
  onTextDelta?: (text: string, step: number) => void | Promise<void>;
  onStreamEvent?: (event: AgentStreamEventDraft) => void | Promise<void>;
  onHandoff?: (handoff: AgentHandoff) => void;
  now?: () => number;
  goal?: string;
  includeRoomContext?: boolean;
  roomContextBuilder?: (rt: RoomTools, goal: string) => Promise<AgentMessage[]>;
  additionalInstructions?: string[];
}

export interface ReasoningFrameRunReceipt {
  frameId: string;
  status: ReasoningFrame["status"];
  allowedToolNames: string[];
  missingToolNames: string[];
  agentResult: AgentResult;
  stateDelta: FrameDelta;
  verification: FrameVerification;
  updatedFrame: ReasoningFrame;
  runtimeError?: string;
}

/** Skill-class tools are dynamically discoverable and the RAG step may prune them by relevance.
 *  Non-skill tools always pass through untouched (default behavior unchanged). */
const SKILL_CLASS_TOOL_NAMES = new Set<string>(["skill_search", "load_skill", "okf_search_skills"]);
/** Default top-k for skill RAG when a goal is provided. Bounded. */
export const DEFAULT_SKILL_RAG_K = 5;

function ragTokenize(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length > 1);
}

/**
 * Rank skill-class tools by lexical relevance to the goal and keep only the top-k.
 * Cheap, deterministic keyword scorer over name+description — the clear hook to swap in
 * OKF semantic search later (skill_search already prefers OKF at execute time).
 *
 * Only PRUNES skill-class tools; every non-skill tool is preserved. Tools already named in
 * `keepNames` (e.g. the frame's allowlist) are never pruned, so allowlist semantics are intact.
 */
export function selectRelevantSkills(
  goal: string,
  tools: AgentTool[],
  k: number = DEFAULT_SKILL_RAG_K,
  keepNames: ReadonlySet<string> = new Set(),
): AgentTool[] {
  const topK = Math.max(1, Math.min(k, 50)); // BOUND
  const skillTools = tools.filter((t) => SKILL_CLASS_TOOL_NAMES.has(t.name));
  const nonSkillTools = tools.filter((t) => !SKILL_CLASS_TOOL_NAMES.has(t.name));
  if (skillTools.length <= topK) return tools; // nothing to prune
  const q = new Set(ragTokenize(goal));
  const scored = skillTools.map((tool) => {
    if (keepNames.has(tool.name)) return { tool, score: Number.POSITIVE_INFINITY }; // pinned by allowlist
    if (q.size === 0) return { tool, score: 0 };
    const hay = new Set(ragTokenize(`${tool.name} ${tool.description}`));
    let hits = 0;
    for (const term of q) if (hay.has(term)) hits += 1;
    return { tool, score: hits / q.size };
  });
  scored.sort((a, b) => b.score - a.score);
  const kept = new Set(scored.slice(0, topK).map((s) => s.tool.name));
  return [...nonSkillTools, ...skillTools.filter((t) => kept.has(t.name))];
}

export function selectFrameTools(frame: ReasoningFrame, tools: AgentTool[], goal?: string): FrameToolSelection {
  // `available`/`missingToolNames` are computed against the ORIGINAL tool set so RAG pruning of an
  // irrelevant skill tool never produces a false "missing tool" for the allowlist.
  const available = new Set(tools.map((tool) => tool.name));
  const allowed = new Set(frame.toolAllowlist);
  // RAG select (only when a goal is provided): prune low-relevance skill-class tools BEFORE the
  // name-filter. Allowlisted tools are pinned, so default (no goal) behavior is unchanged.
  const candidateTools =
    goal && goal.trim() ? selectRelevantSkills(goal, tools, DEFAULT_SKILL_RAG_K, allowed) : tools;
  const allowedTools = candidateTools.filter((tool) => allowed.has(tool.name));
  return {
    allowedTools,
    allowedToolNames: allowedTools.map((tool) => tool.name),
    missingToolNames: frame.toolAllowlist.filter((toolName) => !available.has(toolName)),
  };
}

function updateFrame(frame: ReasoningFrame, stateDelta: FrameDelta, verification: FrameVerification): ReasoningFrame {
  return {
    ...frame,
    status: verification.status,
    stateDelta,
    evidenceState: verification.evidenceState ?? frame.evidenceState,
  };
}

function receipt(args: {
  frame: ReasoningFrame;
  selection: FrameToolSelection;
  agentResult: AgentResult;
  stateDelta: FrameDelta;
  verification: FrameVerification;
  runtimeError?: string;
}): ReasoningFrameRunReceipt {
  const updatedFrame = updateFrame(args.frame, args.stateDelta, args.verification);
  return {
    frameId: args.frame.frameId,
    status: updatedFrame.status,
    allowedToolNames: args.selection.allowedToolNames,
    missingToolNames: args.selection.missingToolNames,
    agentResult: args.agentResult,
    stateDelta: args.stateDelta,
    verification: args.verification,
    updatedFrame,
    runtimeError: args.runtimeError,
  };
}

export async function runReasoningFrame(opts: RunReasoningFrameOptions): Promise<ReasoningFrameRunReceipt> {
  const goal = opts.goal ?? frameRuntimeGoal(opts.frame);
  // Pass the goal so skill-class tools are RAG-selected (top-k) before the allowlist filter.
  const selection = selectFrameTools(opts.frame, opts.tools, goal);
  const includeRoomContext = opts.includeRoomContext ?? true;
  const roomContextBuilder = opts.roomContextBuilder ?? buildContext;

  const contextBuilder = async (rt: RoomTools, activeGoal: string) => {
    const roomMessages = includeRoomContext ? await roomContextBuilder(rt, activeGoal) : [];
    return buildFrameContextMessages(opts.frame, {
      roomMessages,
      additionalInstructions: opts.additionalInstructions,
    });
  };

  try {
    const agentResult = await runAgent({
      rt: opts.rt,
      goal,
      model: opts.model,
      tools: selection.allowedTools,
      maxSteps: opts.maxSteps,
      deadlineAt: opts.deadlineAt,
      reserveMs: opts.reserveMs,
      initialMessages: opts.initialMessages,
      resumeToolCalls: opts.resumeToolCalls,
      journal: opts.journal,
      spendLimits: opts.spendLimits,
      priceStep: opts.priceStep,
      compaction: opts.compaction,
      contextBuilder,
      systemPrompt: opts.systemPrompt,
      onTrace: opts.onTrace,
      onTextDelta: opts.onTextDelta,
      onStreamEvent: opts.onStreamEvent,
      onHandoff: opts.onHandoff,
      now: opts.now,
    });
    const stateDelta = reduceFrameResult(opts.frame, agentResult);
    const verification = verifyFrameOutcome(opts.frame, agentResult, stateDelta);
    return receipt({ frame: opts.frame, selection, agentResult, stateDelta, verification });
  } catch (error) {
    if (!(error instanceof AgentRunError)) throw error;
    const stateDelta = reduceFrameResult(opts.frame, error.partial);
    const verification = verifyFrameOutcome(opts.frame, error.partial, stateDelta);
    return receipt({
      frame: opts.frame,
      selection,
      agentResult: error.partial,
      stateDelta,
      verification,
      runtimeError: error.message,
    });
  }
}
