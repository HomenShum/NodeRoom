import {
  buildTraceObservabilityExport,
  type TraceObservabilityExport,
  type TraceObservabilitySpan,
  type TraceObservabilitySpanStatus,
  type TraceObservabilitySpanType,
} from "../../nodeagent/traces/traceObservability";
import { stableTraceHash } from "../../nodeagent/traces/traceRedaction";
import type { TraceRecord, TraceStep, TraceTone } from "./traceData";

export function traceRecordToObservabilityExport(record: TraceRecord): TraceObservabilityExport {
  const base = baseTimestamp(record);
  const rootId = `${record.id}:root`;
  const steps = record.steps.map((step, index) => stepToSpan(record.id, rootId, step, base, index));
  const lastEndedAt = Math.max(base, ...steps.map((span) => span.endedAt ?? span.startedAt));
  const spans: TraceObservabilitySpan[] = [
    {
      id: rootId,
      traceId: record.id,
      parentSpanId: null,
      name: record.title,
      type: record.kind === "agent" ? "agent" : "ui",
      status: toneToStatus(record.verdict?.tone),
      startedAt: base,
      endedAt: lastEndedAt,
      latencyMs: Math.max(0, lastEndedAt - base),
      attributes: {
        kind: record.kind,
        sourceTool: record.source.tool,
        sourceVersion: record.source.version,
        environment: record.source.env,
        model: record.source.model,
        verdict: record.verdict?.label,
        verdictTone: record.verdict?.tone,
        stepCount: record.steps.length,
        evidenceCardCount: record.evidenceCards?.length ?? 0,
        refutationCount: record.refutations?.length ?? 0,
      },
      input: record.subtitle,
      output: record.verdict?.label ?? `${record.steps.length} trace steps`,
    },
    ...steps,
  ];
  return buildTraceObservabilityExport({
    traceId: record.id,
    name: record.title,
    source: `noderoom.trace-surface.${record.kind}`,
    generatedAt: base,
    spans,
  });
}

function stepToSpan(traceId: string, parentSpanId: string, step: TraceStep, base: number, index: number): TraceObservabilitySpan {
  const startedAt = base + index * 100;
  const latencyMs = Math.max(25, Number(step.metrics?.find((m) => /ms|latency|duration/i.test(m.label))?.value.replace(/[^\d.]/g, "")) || 50);
  const endedAt = startedAt + latencyMs;
  const screenshotCount = Number(Boolean(step.screenshotUrl)) + (step.attachments?.filter((a) => a.kind === "screenshot").length ?? 0);
  const logCount = step.attachments?.filter((a) => a.kind === "log").length ?? 0;
  return {
    id: `${traceId}:step:${step.idx}:${stableTraceHash(step.label)}`,
    traceId,
    parentSpanId,
    name: step.label,
    type: stepToType(step),
    status: toneToStatus(step.status),
    startedAt,
    endedAt,
    latencyMs,
    attributes: {
      idx: step.idx,
      group: step.group,
      tone: step.status,
      targetArtifactId: step.targetArtifactId,
      targetElementId: step.targetElementId,
      screenshotCount,
      logCount,
      hasMetrics: (step.metrics?.length ?? 0) > 0,
      metricCount: step.metrics?.length ?? 0,
    },
    input: step.targetArtifactId ? `${step.targetArtifactId}${step.targetElementId ? `#${step.targetElementId}` : ""}` : step.group,
    output: step.detail ?? step.label,
  };
}

function stepToType(step: TraceStep): TraceObservabilitySpanType {
  const text = `${step.group ?? ""} ${step.label} ${step.detail ?? ""}`.toLowerCase();
  if (/(read_range|edit_cell|tool|lock|capture|lookup|get sec|search|fetch|retriev)/.test(text)) return "tool";
  if (/(verify|verdict|score|gate|golden|refut|proof|evidence)/.test(text)) return "proof";
  if (/(browser|click|screenshot|visual|frame|qa|playwright|flow|tab)/.test(text)) return "ui";
  if (/(model|agent|plan|reason)/.test(text)) return "agent";
  return "event";
}

function toneToStatus(tone: TraceTone | undefined): TraceObservabilitySpanStatus {
  if (tone === "risk") return "failed";
  return "completed";
}

function baseTimestamp(record: TraceRecord): number {
  const raw = record.raw as { generatedAt?: unknown } | undefined;
  const generatedAt = typeof raw?.generatedAt === "string" ? Date.parse(raw.generatedAt) : NaN;
  if (Number.isFinite(generatedAt)) return generatedAt;
  const parsed = Date.parse(record.ts);
  if (Number.isFinite(parsed)) return parsed;
  return 0;
}
