import type { NodeAgentTrace } from "../traces/traceTypes";
import {
  buildTraceObservabilityExport,
  nodeAgentTraceToObservabilityExport,
  type TraceObservabilityExport,
  type TraceObservabilitySpan,
} from "../traces/traceObservability";

export type LangSmithRunPayload = {
  id: string;
  name: string;
  run_type: "chain" | "llm" | "tool" | "retriever" | "embedding" | "prompt" | "parser";
  start_time: string;
  end_time?: string;
  parent_run_id?: string | null;
  inputs: Record<string, unknown>;
  outputs: Record<string, unknown>;
  extra: {
    metadata: Record<string, unknown>;
  };
};

export type LangSmithExportPayload = {
  project_name: string;
  trace_id: string;
  runs: LangSmithRunPayload[];
};

export type LangSmithExportMetadata = {
  proofloopRunId?: string;
  frameId?: string;
  modelRoute?: string;
  receiptPath?: string;
};

export type LangSmithExportSink = {
  send?: (payload: LangSmithExportPayload) => Promise<unknown>;
  batchIngestRuns?: (payload: { post: LangSmithRunPayload[] }) => Promise<unknown>;
  createRun?: (run: LangSmithRunPayload) => Promise<unknown>;
};

export type LangSmithExportResult =
  | { ok: true; skipped?: false; payload: LangSmithExportPayload }
  | { ok: true; skipped: true; reason: string; payload?: LangSmithExportPayload }
  | { ok: false; error: string; payload: LangSmithExportPayload };

export function shouldExportLangSmith(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODEROOM_LANGSMITH_ENABLED === "true" || env.NODEROOM_LANGSMITH_ENABLED === "1";
}

export function buildLangSmithPayload(input: {
  trace: NodeAgentTrace | TraceObservabilityExport;
  projectName?: string;
  metadata?: LangSmithExportMetadata;
}): LangSmithExportPayload {
  const exportDoc = isObservabilityExport(input.trace) ? input.trace : nodeAgentTraceToObservabilityExport(input.trace);
  return {
    project_name: input.projectName ?? "noderoom",
    trace_id: exportDoc.traceId,
    runs: exportDoc.spans.map((span) => langSmithRunFromSpan(span, input.metadata ?? {})),
  };
}

export async function exportLangSmithTrace(input: {
  trace: NodeAgentTrace | TraceObservabilityExport;
  sink?: LangSmithExportSink;
  projectName?: string;
  metadata?: LangSmithExportMetadata;
  env?: Record<string, string | undefined>;
}): Promise<LangSmithExportResult> {
  const env = input.env ?? process.env;
  const payload = buildLangSmithPayload({
    trace: input.trace,
    projectName: input.projectName ?? env.LANGSMITH_PROJECT,
    metadata: input.metadata,
  });
  if (!shouldExportLangSmith(env)) return { ok: true, skipped: true, reason: "disabled", payload };
  try {
    if (input.sink?.send) await input.sink.send(payload);
    else if (input.sink?.batchIngestRuns) await input.sink.batchIngestRuns({ post: payload.runs });
    else if (input.sink?.createRun) {
      for (const run of payload.runs) await input.sink.createRun(run);
    } else {
      return { ok: true, skipped: true, reason: "no_sink", payload };
    }
    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      payload,
    };
  }
}

export function traceObservabilityExportFromSpans(input: {
  traceId: string;
  name: string;
  source?: string;
  generatedAt?: number;
  spans: TraceObservabilitySpan[];
}): TraceObservabilityExport {
  return buildTraceObservabilityExport({
    traceId: input.traceId,
    name: input.name,
    source: input.source ?? "nodeagent.langsmith.interop",
    generatedAt: input.generatedAt,
    spans: input.spans,
  });
}

function langSmithRunFromSpan(span: TraceObservabilitySpan, metadata: LangSmithExportMetadata): LangSmithRunPayload {
  return {
    id: span.id,
    name: span.name,
    run_type: langSmithRunType(span.type),
    start_time: new Date(span.startedAt).toISOString(),
    end_time: span.endedAt == null ? undefined : new Date(span.endedAt).toISOString(),
    parent_run_id: span.parentSpanId ?? null,
    inputs: span.input ? { input: span.input } : {},
    outputs: span.output ? { output: span.output } : {},
    extra: {
      metadata: {
        ...span.attributes,
        traceId: span.traceId,
        spanType: span.type,
        status: span.status,
        proofloopRunId: metadata.proofloopRunId,
        frameId: metadata.frameId,
        modelRoute: metadata.modelRoute,
        receiptPath: metadata.receiptPath,
      },
    },
  };
}

function langSmithRunType(type: TraceObservabilitySpan["type"]): LangSmithRunPayload["run_type"] {
  if (type === "llm") return "llm";
  if (type === "tool") return "tool";
  if (type === "retrieval") return "retriever";
  return "chain";
}

function isObservabilityExport(value: NodeAgentTrace | TraceObservabilityExport): value is TraceObservabilityExport {
  return (value as TraceObservabilityExport).schema === "noderoom.trace.observability.v1";
}
