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

export function selectFrameTools(frame: ReasoningFrame, tools: AgentTool[]): FrameToolSelection {
  const available = new Set(tools.map((tool) => tool.name));
  const allowed = new Set(frame.toolAllowlist);
  const allowedTools = tools.filter((tool) => allowed.has(tool.name));
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
  const selection = selectFrameTools(opts.frame, opts.tools);
  const goal = opts.goal ?? frameRuntimeGoal(opts.frame);
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
