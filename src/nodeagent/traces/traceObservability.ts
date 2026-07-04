import type { SpanData as AssistantO11ySpanData } from "@assistant-ui/react-o11y";
import type {
  LangfuseDocument,
  LangfuseObservation,
  LangfuseObservationType,
  OpenTelemetryDocument,
  OpenTelemetrySpan,
  OpenTelemetrySpanKind,
  TraceSpanAttribute,
} from "@evilmartians/agent-prism-types";
import type { NodeAgentTrace, TraceStep, TraceStepPhase } from "./traceTypes";
import { stableTraceHash } from "./traceRedaction";

export const TRACE_OBSERVABILITY_SCHEMA = "noderoom.trace.observability.v1" as const;

export type TraceObservabilitySpanType =
  | "agent"
  | "chain"
  | "event"
  | "eval"
  | "llm"
  | "memory"
  | "proof"
  | "retrieval"
  | "tool"
  | "ui";

export type TraceObservabilitySpanStatus = AssistantO11ySpanData["status"];

export type TraceObservabilityAttributeValue = string | number | boolean | null | undefined;

export interface TraceObservabilitySpan extends AssistantO11ySpanData {
  traceId: string;
  type: TraceObservabilitySpanType;
  status: TraceObservabilitySpanStatus;
  attributes: Record<string, TraceObservabilityAttributeValue>;
  input?: string;
  output?: string;
}

export interface TraceObservabilityExport {
  schema: typeof TRACE_OBSERVABILITY_SCHEMA;
  traceId: string;
  name: string;
  source: string;
  generatedAt: string;
  adapters: {
    agentPrism: "opentelemetry";
    assistantUi: "react-o11y";
    langfuse: "json";
    openTelemetry: "otlp-json";
  };
  spans: TraceObservabilitySpan[];
  assistantUi: {
    reactO11ySpans: AssistantO11ySpanData[];
    transcriptEvents: Array<{ id: string; role: "agent" | "tool" | "system"; text: string; status: TraceObservabilitySpanStatus }>;
  };
  openTelemetry: OpenTelemetryDocument;
  langfuse: LangfuseDocument;
}

export interface TraceObservabilityInput {
  traceId: string;
  name: string;
  source: string;
  generatedAt?: number;
  spans: TraceObservabilitySpan[];
}

export function buildTraceObservabilityExport(input: TraceObservabilityInput): TraceObservabilityExport {
  const spans = normalizeSpans(input.traceId, input.spans);
  return {
    schema: TRACE_OBSERVABILITY_SCHEMA,
    traceId: input.traceId,
    name: input.name,
    source: input.source,
    generatedAt: new Date(input.generatedAt ?? Date.now()).toISOString(),
    adapters: {
      agentPrism: "opentelemetry",
      assistantUi: "react-o11y",
      langfuse: "json",
      openTelemetry: "otlp-json",
    },
    spans,
    assistantUi: {
      reactO11ySpans: toAssistantO11ySpans(spans),
      transcriptEvents: spans.map((span) => ({
        id: span.id,
        role: span.type === "tool" ? "tool" : span.type === "agent" ? "agent" : "system",
        text: span.output ?? span.name,
        status: span.status,
      })),
    },
    openTelemetry: toOpenTelemetryDocument({ traceId: input.traceId, name: input.name, source: input.source, spans }),
    langfuse: toLangfuseDocument({ traceId: input.traceId, name: input.name, source: input.source, spans }),
  };
}

export function toAssistantO11ySpans(spans: TraceObservabilitySpan[]): AssistantO11ySpanData[] {
  return spans.map((span) => ({
    id: span.id,
    parentSpanId: span.parentSpanId,
    name: span.name,
    type: span.type,
    status: span.status,
    startedAt: span.startedAt,
    endedAt: span.endedAt,
    latencyMs: span.latencyMs,
  }));
}

export function nodeAgentTraceToObservabilityExport(trace: NodeAgentTrace): TraceObservabilityExport {
  const rootStatus: TraceObservabilitySpanStatus =
    trace.final.status === "failed" || trace.final.status === "cancelled" ? "failed" : "completed";
  const rootId = spanId(`${trace.traceId}:root`);
  const spans: TraceObservabilitySpan[] = [
    {
      id: rootId,
      traceId: trace.traceId,
      parentSpanId: null,
      name: trace.plan.goal || trace.final.summary || "NodeAgent trace",
      type: "agent",
      status: rootStatus,
      startedAt: trace.createdAt,
      endedAt: trace.updatedAt,
      latencyMs: Math.max(0, trace.updatedAt - trace.createdAt),
      attributes: {
        schema: trace.schema,
        roomId: trace.roomId,
        agentJobId: trace.agentJobId,
        triggerKind: trace.trigger.kind,
        approvalRequired: trace.plan.approvalRequired,
        finalStatus: trace.final.status,
        benchmarkCaseId: trace.eval.benchmarkCaseId,
        score: trace.eval.score,
        passed: trace.eval.passed,
      },
      input: trace.trigger.prompt,
      output: trace.final.summary,
    },
    ...trace.steps.map((step) => nodeAgentStepToSpan(trace.traceId, rootId, step)),
  ];
  return buildTraceObservabilityExport({
    traceId: trace.traceId,
    name: trace.plan.goal || "NodeAgent trace",
    source: "nodeagent.trace.v1",
    generatedAt: trace.updatedAt,
    spans,
  });
}

function nodeAgentStepToSpan(traceId: string, parentSpanId: string, step: TraceStep): TraceObservabilitySpan {
  const startedAt = finiteTime(step.timings.startedAt, 0);
  const endedAt = finiteTime(step.timings.endedAt, startedAt + (step.timings.latencyMs ?? 1));
  return {
    id: spanId(step.stepId),
    traceId,
    parentSpanId,
    name: step.title,
    type: phaseToSpanType(step.phase),
    status: verdictToStatus(step.verdict?.status),
    startedAt,
    endedAt,
    latencyMs: Math.max(0, endedAt - startedAt),
    attributes: {
      phase: step.phase,
      summary: step.summary,
      tool: step.tool?.name,
      toolStatus: step.tool?.status,
      modelProvider: step.model?.provider,
      model: step.model?.model,
      inputTokens: step.model?.inputTokens,
      outputTokens: step.model?.outputTokens,
      costUsd: step.model?.costUsd ?? step.tool?.costUsd,
      inputRefs: step.inputRefs.length,
      outputRefs: step.outputRefs.length,
      verdict: step.verdict?.status,
      verdictReason: step.verdict?.reason,
    },
    input: step.inputRefs.map((ref) => ref.label ?? ref.refId).join(", ") || undefined,
    output: step.summary,
  };
}

function toOpenTelemetryDocument(input: Pick<TraceObservabilityInput, "traceId" | "name" | "source"> & { spans: TraceObservabilitySpan[] }): OpenTelemetryDocument {
  const traceId = traceIdHex(input.traceId);
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [
            attr("service.name", "noderoom"),
            attr("noderoom.trace.schema", TRACE_OBSERVABILITY_SCHEMA),
            attr("noderoom.trace.source", input.source),
            attr("noderoom.trace.name", input.name),
          ],
        },
        scopeSpans: [
          {
            scope: { name: "noderoom.trace-observability", version: "1" },
            spans: input.spans.map((span) => toOpenTelemetrySpan(traceId, span)),
          },
        ],
      },
    ],
  };
}

function toOpenTelemetrySpan(traceId: string, span: TraceObservabilitySpan): OpenTelemetrySpan {
  const attributes = attrs({
    ...span.attributes,
    "noderoom.span.type": span.type,
    "noderoom.span.status": span.status,
    "gen_ai.operation.name": genAiOperation(span.type),
    "gen_ai.agent.name": "NodeRoom",
    "gen_ai.tool.name": span.type === "tool" ? span.attributes.tool ?? span.name : undefined,
    "function.name": span.type === "tool" ? span.attributes.tool ?? span.name : undefined,
    "input.value": span.input,
    "output.value": span.output,
    "gen_ai.request.model": span.attributes.model,
    "gen_ai.usage.input_tokens": span.attributes.inputTokens,
    "gen_ai.usage.output_tokens": span.attributes.outputTokens,
    "gen_ai.usage.total_tokens": totalTokens(span.attributes.inputTokens, span.attributes.outputTokens),
    "gen_ai.usage.cost": span.attributes.costUsd,
  });
  return {
    traceId,
    spanId: spanId(span.id),
    parentSpanId: span.parentSpanId ? spanId(span.parentSpanId) : undefined,
    name: span.name,
    kind: spanKind(span.type),
    startTimeUnixNano: msToNs(span.startedAt),
    endTimeUnixNano: msToNs(span.endedAt ?? span.startedAt + (span.latencyMs ?? 1)),
    attributes,
    status: {
      code: span.status === "failed" ? "STATUS_CODE_ERROR" : span.status === "running" ? "STATUS_CODE_UNSET" : "STATUS_CODE_OK",
      message: typeof span.attributes.verdictReason === "string" ? span.attributes.verdictReason : undefined,
    },
    flags: 1,
  };
}

function toLangfuseDocument(input: Pick<TraceObservabilityInput, "traceId" | "name" | "source"> & { spans: TraceObservabilitySpan[] }): LangfuseDocument {
  const now = new Date().toISOString();
  const observations: LangfuseObservation[] = input.spans.map((span) => ({
    id: span.id,
    traceId: input.traceId,
    projectId: "noderoom-local",
    environment: "local",
    parentObservationId: span.parentSpanId,
    startTime: new Date(span.startedAt).toISOString(),
    endTime: new Date(span.endedAt ?? span.startedAt + (span.latencyMs ?? 1)).toISOString(),
    name: span.name,
    metadata: span.attributes,
    type: langfuseType(span.type),
    level: span.status === "failed" ? "ERROR" : span.status === "skipped" ? "WARNING" : "DEFAULT",
    input: span.input ?? null,
    output: span.output ?? null,
    statusMessage: typeof span.attributes.verdictReason === "string" ? span.attributes.verdictReason : null,
    createdAt: now,
    updatedAt: now,
    latency: span.latencyMs ?? undefined,
    model: typeof span.attributes.model === "string" ? span.attributes.model : null,
    usageDetails: usageDetails(span),
    costDetails: costDetails(span),
  }));
  const startedAt = Math.min(...input.spans.map((span) => span.startedAt));
  const endedAt = Math.max(...input.spans.map((span) => span.endedAt ?? span.startedAt));
  return {
    trace: {
      id: input.traceId,
      projectId: "noderoom-local",
      name: input.name,
      timestamp: new Date(Number.isFinite(startedAt) ? startedAt : Date.now()).toISOString(),
      environment: "local",
      tags: ["noderoom", "proofloop", input.source],
      bookmarked: false,
      release: null,
      version: null,
      public: false,
      input: input.spans[0]?.input ?? null,
      output: input.spans[0]?.output ?? null,
      metadata: { schema: TRACE_OBSERVABILITY_SCHEMA, source: input.source },
      createdAt: now,
      updatedAt: now,
      scores: [],
      latency: Number.isFinite(endedAt - startedAt) ? endedAt - startedAt : undefined,
      observations,
    },
    observations,
  };
}

function normalizeSpans(traceId: string, spans: TraceObservabilitySpan[]): TraceObservabilitySpan[] {
  return spans.map((span) => {
    const startedAt = finiteTime(span.startedAt, 0);
    const endedAt = span.endedAt == null ? null : Math.max(startedAt, finiteTime(span.endedAt, startedAt));
    return {
      ...span,
      traceId,
      id: spanId(span.id),
      parentSpanId: span.parentSpanId ? spanId(span.parentSpanId) : null,
      startedAt,
      endedAt,
      latencyMs: span.latencyMs ?? (endedAt == null ? null : Math.max(0, endedAt - startedAt)),
      attributes: span.attributes ?? {},
    };
  });
}

function phaseToSpanType(phase: TraceStepPhase): TraceObservabilitySpanType {
  if (phase === "tool_call") return "tool";
  if (phase === "retrieve") return "retrieval";
  if (phase === "eval") return "eval";
  if (phase === "ui_verify") return "ui";
  if (phase === "reason") return "llm";
  if (phase === "mutation" || phase === "approval" || phase === "evidence_capture" || phase === "proposal") return "proof";
  return phase === "plan" ? "chain" : "event";
}

function verdictToStatus(status: NonNullable<TraceStep["verdict"]>["status"] | undefined): TraceObservabilitySpanStatus {
  if (status === "failed" || status === "blocked") return "failed";
  return "completed";
}

function genAiOperation(type: TraceObservabilitySpanType): string {
  if (type === "agent") return "invoke_agent";
  if (type === "llm") return "chat";
  if (type === "tool" || type === "retrieval" || type === "proof") return "execute_tool";
  return "invoke_agent";
}

function spanKind(type: TraceObservabilitySpanType): OpenTelemetrySpanKind {
  if (type === "tool" || type === "retrieval") return "SPAN_KIND_CLIENT";
  if (type === "agent") return "SPAN_KIND_SERVER";
  return "SPAN_KIND_INTERNAL";
}

function langfuseType(type: TraceObservabilitySpanType): LangfuseObservationType {
  if (type === "agent") return "AGENT";
  if (type === "tool") return "TOOL";
  if (type === "llm") return "GENERATION";
  if (type === "retrieval") return "RETRIEVER";
  if (type === "eval") return "EVALUATOR";
  if (type === "proof") return "GUARDRAIL";
  if (type === "chain") return "CHAIN";
  return "SPAN";
}

function usageDetails(span: TraceObservabilitySpan): LangfuseObservation["usageDetails"] {
  const input = numeric(span.attributes.inputTokens);
  const output = numeric(span.attributes.outputTokens);
  const total = input + output;
  return total > 0 ? { input, output, total } : undefined;
}

function costDetails(span: TraceObservabilitySpan): LangfuseObservation["costDetails"] {
  const total = numeric(span.attributes.costUsd);
  return total > 0 ? { total } : undefined;
}

function totalTokens(input: TraceObservabilityAttributeValue, output: TraceObservabilityAttributeValue): number | undefined {
  const total = numeric(input) + numeric(output);
  return total > 0 ? total : undefined;
}

function attrs(values: Record<string, TraceObservabilityAttributeValue>): TraceSpanAttribute[] {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => attr(key, value as string | number | boolean));
}

function attr(key: string, value: string | number | boolean): TraceSpanAttribute {
  if (typeof value === "boolean") return { key, value: { boolValue: value } };
  if (typeof value === "number") return { key, value: { intValue: String(value) } };
  return { key, value: { stringValue: value } };
}

function numeric(value: TraceObservabilityAttributeValue): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function finiteTime(value: number | undefined | null, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function msToNs(ms: number): string {
  return String(BigInt(Math.max(0, Math.round(ms))) * 1_000_000n);
}

function traceIdHex(value: string): string {
  return stableHex(value, 32);
}

function spanId(value: string): string {
  return stableHex(value, 16);
}

function stableHex(value: unknown, length: number): string {
  const base = stableTraceHash(value).replace(/^fnv1a:/, "");
  return base.repeat(Math.ceil(length / base.length)).slice(0, length);
}
