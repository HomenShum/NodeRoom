import type { AgentResult } from "../core/types";
import { NODEAGENT_TRACE_SCHEMA, type NodeAgentTrace, type NodeAgentTraceContextPack, type NodeAgentTracePlan, type NodeAgentTraceTrigger, type TraceRef, type TraceStep } from "./traceTypes";
import { traceStepFromToolEvent } from "./traceReceipts";
import { redactTraceText, stableTraceHash } from "./traceRedaction";

export interface BuildNodeAgentTraceArgs {
  traceId: string;
  roomId?: string;
  agentJobId?: string;
  startedAt: number;
  trigger: NodeAgentTraceTrigger;
  plan: NodeAgentTracePlan;
  contextPack: NodeAgentTraceContextPack;
  agentResult?: AgentResult;
  steps?: TraceStep[];
  outputArtifactRefs?: TraceRef[];
  proofArtifacts?: TraceRef[];
}

export function buildNodeAgentTrace(args: BuildNodeAgentTraceArgs): NodeAgentTrace {
  const runtimeSteps = (args.agentResult?.trace ?? []).map((event) => traceStepFromToolEvent(event, args.traceId, args.startedAt));
  const steps = [...(args.steps ?? []), ...runtimeSteps];
  const stopReason = args.agentResult?.stopReason;
  return {
    schema: NODEAGENT_TRACE_SCHEMA,
    traceId: args.traceId,
    roomId: args.roomId,
    agentJobId: args.agentJobId,
    createdAt: args.startedAt,
    updatedAt: args.agentResult?.budget.now ?? args.startedAt,
    trigger: redactTrigger(args.trigger),
    plan: args.plan,
    contextPack: args.contextPack,
    steps,
    evidence: [],
    mutations: [],
    approvals: [],
    eval: {
      proofArtifacts: args.proofArtifacts ?? [],
    },
    final: {
      outputArtifactRefs: args.outputArtifactRefs ?? [],
      summary: args.agentResult?.finalText ?? "",
      status: stopReason === "done" ? "completed" : stopReason === "error" ? "failed" : "needs_review",
    },
  };
}

function redactTrigger(trigger: NodeAgentTraceTrigger): NodeAgentTraceTrigger {
  return {
    ...trigger,
    prompt: trigger.prompt ? redactTraceText(trigger.prompt) : undefined,
  };
}

export class NodeAgentTraceRecorder {
  private trace: NodeAgentTrace;

  constructor(args: Omit<BuildNodeAgentTraceArgs, "agentResult">) {
    this.trace = buildNodeAgentTrace(args);
  }

  recordStep(step: TraceStep): void {
    this.trace.steps.push(step);
    this.trace.updatedAt = Math.max(this.trace.updatedAt, step.timings.endedAt ?? step.timings.startedAt);
  }

  applyAgentResult(result: AgentResult): void {
    const built = buildNodeAgentTrace({
      traceId: this.trace.traceId,
      roomId: this.trace.roomId,
      agentJobId: this.trace.agentJobId,
      startedAt: this.trace.createdAt,
      trigger: this.trace.trigger,
      plan: this.trace.plan,
      contextPack: this.trace.contextPack,
      agentResult: result,
      steps: this.trace.steps,
      outputArtifactRefs: this.trace.final.outputArtifactRefs,
      proofArtifacts: this.trace.eval.proofArtifacts,
    });
    this.trace = { ...built, evidence: this.trace.evidence, mutations: this.trace.mutations, approvals: this.trace.approvals };
  }

  snapshot(): NodeAgentTrace {
    return JSON.parse(JSON.stringify(this.trace)) as NodeAgentTrace;
  }
}

export function defaultTracePlan(goal: string, refs: { reads?: TraceRef[]; writes?: TraceRef[]; approvalRequired?: boolean; riskFlags?: string[] } = {}): NodeAgentTracePlan {
  return {
    goal,
    plannedReads: refs.reads ?? [],
    plannedWrites: refs.writes ?? [],
    approvalRequired: refs.approvalRequired ?? false,
    riskFlags: refs.riskFlags ?? [],
  };
}

export function traceIdForRun(prefix: string, value: unknown): string {
  return `${prefix}-${stableTraceHash(value).replace("fnv1a:", "")}`;
}
