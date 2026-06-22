import type { AgentTraceEvent } from "../core/types";
import type { EvidenceReceipt, MutationReceipt, TraceRef, TraceStep, TraceToolReceipt } from "./traceTypes";
import { stableTraceHash } from "./traceRedaction";

export function traceRef(kind: TraceRef["kind"], refId: string, details: Omit<TraceRef, "kind" | "refId"> = {}): TraceRef {
  return { kind, refId, ...details };
}

export function toolReceiptFromEvent(event: AgentTraceEvent): TraceToolReceipt {
  const failed = hasError(event.result);
  return {
    name: event.tool,
    argsHash: stableTraceHash(event.args),
    resultHash: stableTraceHash(event.result),
    status: failed ? "failed" : "ok",
    latencyMs: event.ms,
  };
}

export function traceStepFromToolEvent(event: AgentTraceEvent, traceId: string, startedAt: number): TraceStep {
  const tool = toolReceiptFromEvent(event);
  const stepId = `${traceId}:tool:${String(event.step).padStart(3, "0")}:${slug(event.tool)}`;
  const outputRef = traceRef("tool_result", `${stepId}:result`, { hash: tool.resultHash, label: `${event.tool} result` });
  return {
    stepId,
    traceId,
    phase: event.tool === "handoff" ? "reason" : "tool_call",
    title: event.tool === "handoff" ? "Runtime handoff" : `Tool call: ${event.tool}`,
    summary: event.tool === "handoff"
      ? "Runtime produced a resumable handoff receipt."
      : `Called ${event.tool} and recorded args/result hashes.`,
    inputRefs: [traceRef("tool_result", `${stepId}:args`, { hash: tool.argsHash, label: `${event.tool} args` })],
    outputRefs: [outputRef],
    tool,
    timings: {
      startedAt,
      endedAt: startedAt + Math.max(0, event.ms),
      latencyMs: event.ms,
    },
    verdict: {
      status: tool.status === "failed" ? "failed" : "ok",
      reason: tool.status === "failed" ? "Tool result contained an error-shaped payload." : undefined,
    },
  };
}

export function makeEvidenceReceipt(args: {
  traceId: string;
  label: string;
  sourceRefs: TraceRef[];
  artifactRefs?: TraceRef[];
  fact?: unknown;
  verifier?: string;
  confidence?: number;
  status?: EvidenceReceipt["status"];
}): EvidenceReceipt {
  return {
    receiptId: `${args.traceId}:evidence:${slug(args.label)}`,
    traceId: args.traceId,
    label: args.label,
    sourceRefs: args.sourceRefs,
    artifactRefs: args.artifactRefs ?? [],
    factHash: args.fact === undefined ? undefined : stableTraceHash(args.fact),
    verifier: args.verifier,
    confidence: args.confidence,
    status: args.status ?? "needs_review",
  };
}

export function makeMutationReceipt(args: {
  traceId: string;
  targetRefs: TraceRef[];
  before?: unknown;
  after?: unknown;
  baseVersion?: number;
  payload: unknown;
  status: MutationReceipt["status"];
}): MutationReceipt {
  return {
    receiptId: `${args.traceId}:mutation:${stableTraceHash(args.payload).slice(-8)}`,
    traceId: args.traceId,
    targetRefs: args.targetRefs,
    beforeHash: args.before === undefined ? undefined : stableTraceHash(args.before),
    afterHash: args.after === undefined ? undefined : stableTraceHash(args.after),
    baseVersion: args.baseVersion,
    payloadHash: stableTraceHash(args.payload),
    status: args.status,
  };
}

function hasError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const object = value as Record<string, unknown>;
  return typeof object.error === "string" || object.ok === false;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "step";
}
