import type { AgentJobAttemptTelemetry, AgentJobDetailTelemetry, AgentJobTelemetry, AgentRunTelemetry } from "../../app/store";
import type { Message, TraceEvent } from "../../engine/types";
import type { WorkArtifactStatus } from "./workArtifactTypes";

export interface LivePerformanceSummary {
  roomId: string;
  status: WorkArtifactStatus;
  messageCount: number;
  humanMessageCount: number;
  agentMessageCount: number;
  runCount: number;
  traceEventCount: number;
  agentTraceCount: number;
  latestActivityAt?: number;
  latestAgentText?: string;
  job?: {
    id: string;
    status: string;
    runtime?: string;
    modelPolicy: string;
    attempts: number;
    maxAttempts: number;
    stopReason?: string;
    nextRunAt?: number;
    toolCallCount?: number;
    modelCallCount?: number;
    receiptCount?: number;
  };
  run?: AgentRunTelemetry;
  attempts: Array<{
    attempt: number;
    status: string;
    resolvedModel: string;
    stopReason: string;
    ms: number;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  }>;
  detailCounts: {
    operations: number;
    streamEvents: number;
    streamParts: number;
    reasoningFrames: number;
    receipts: number;
    leases: number;
    draftOperations: number;
    latestSteps: number;
  };
}

const AGENT_RUN_CLIENT_MSG_ID_RE = /^(?:pubstream|privstream|final|plan-blocked)-(.+)$/;

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function agentRunId(message: Message): string | null {
  if (message.author.kind !== "agent") return null;
  const match = AGENT_RUN_CLIENT_MSG_ID_RE.exec(message.clientMsgId ?? "");
  return match ? match[1] : null;
}

function summaryStatus(job: AgentJobTelemetry | null | undefined, attempts: AgentJobAttemptTelemetry[], traces: TraceEvent[]): WorkArtifactStatus {
  const jobStatus = job?.status.toLowerCase();
  if (jobStatus && /\b(failed|error)\b/.test(jobStatus)) return "failed";
  if (jobStatus && /\b(running|queued|pending|paused|scheduled)\b/.test(jobStatus)) return "running";
  if (attempts.some((attempt) => /\b(failed|error)\b/i.test(attempt.status))) return "needs_review";
  if (traces.some((trace) => /\b(failed|blocked|denied|conflict|error)\b/i.test(`${trace.type} ${trace.summary} ${trace.detail ?? ""}`))) return "needs_review";
  return traces.length || job || attempts.length ? "ready" : "empty";
}

function latestAt(messages: Message[], traces: TraceEvent[], job?: AgentJobTelemetry | null): number | undefined {
  const values = [
    ...messages.map((message) => message.createdAt),
    ...traces.map((trace) => trace.ts),
    job?.updatedAt,
  ].filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return values.length ? Math.max(...values) : undefined;
}

export function buildLivePerformanceSummary(args: {
  roomId: string;
  messages: Message[];
  traces: TraceEvent[];
  run?: AgentRunTelemetry | null;
  job?: AgentJobTelemetry | null;
  attempts?: AgentJobAttemptTelemetry[];
  detail?: AgentJobDetailTelemetry | null;
}): LivePerformanceSummary {
  const messages = [...args.messages].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const traces = [...args.traces].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  const agentMessages = messages.filter((message) => message.author.kind === "agent");
  const attempts = args.attempts ?? [];
  const detail = args.detail ?? null;
  const job = args.job ?? null;

  return {
    roomId: args.roomId,
    status: summaryStatus(job, attempts, traces),
    messageCount: messages.length,
    humanMessageCount: messages.filter((message) => message.author.kind !== "agent").length,
    agentMessageCount: agentMessages.length,
    runCount: unique(agentMessages.map(agentRunId)).length,
    traceEventCount: traces.length,
    agentTraceCount: traces.filter((trace) => trace.actor.kind === "agent" || trace.type.startsWith("agent_")).length,
    latestActivityAt: latestAt(messages, traces, job),
    latestAgentText: agentMessages[agentMessages.length - 1]?.text,
    job: job ? {
      id: job.id,
      status: job.status,
      runtime: job.runtime,
      modelPolicy: job.modelPolicy,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      stopReason: job.stopReason,
      nextRunAt: job.nextRunAt,
      toolCallCount: job.toolCallCount,
      modelCallCount: job.modelCallCount,
      receiptCount: job.receiptCount,
    } : undefined,
    run: args.run ?? undefined,
    attempts: attempts.map((attempt) => ({
      attempt: attempt.attempt,
      status: attempt.status,
      resolvedModel: attempt.resolvedModel,
      stopReason: attempt.stopReason,
      ms: attempt.ms,
      inputTokens: attempt.inputTokens,
      outputTokens: attempt.outputTokens,
      costUsd: attempt.costUsd,
    })),
    detailCounts: {
      operations: detail?.operations.length ?? 0,
      streamEvents: detail?.streamEvents.length ?? 0,
      streamParts: detail?.streamParts.length ?? 0,
      reasoningFrames: detail?.reasoningFrames.length ?? 0,
      receipts: detail?.receipts.length ?? 0,
      leases: detail?.leases.length ?? 0,
      draftOperations: detail?.draftOperations.length ?? 0,
      latestSteps: detail?.latestSteps.length ?? 0,
    },
  };
}
