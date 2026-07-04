import { useMemo, type CSSProperties } from "react";
import type { TraceObservabilityExport, TraceObservabilitySpan } from "../../nodeagent/traces/traceObservability";
import type { TraceRecord } from "./traceData";
import { traceRecordToObservabilityExport } from "./traceObservabilityData";

interface SpanRow {
  span: TraceObservabilitySpan;
  depth: number;
}

export function TraceObservability({ record }: { record: TraceRecord }) {
  const doc = useMemo(() => traceRecordToObservabilityExport(record), [record]);
  const rows = useMemo(() => flattenSpans(doc.spans), [doc]);
  const range = useMemo(() => timeRange(doc.spans), [doc]);
  const exportJson = useMemo(() => JSON.stringify(exportPayload(doc), null, 2), [doc]);
  const href = `data:application/json;charset=utf-8,${encodeURIComponent(exportJson)}`;

  return (
    <div className="r-tracevu-o11y" data-testid="trace-observability">
      <header className="r-tracevu-o11y-head">
        <div className="r-tracevu-o11y-badges" aria-label="Trace adapters">
          <span data-testid="trace-observability-count">{rows.length} spans</span>
          <span>AgentPrism OTLP</span>
          <span>react-o11y</span>
          <span>Langfuse JSON</span>
          <span>assistant-ui events</span>
        </div>
        <a className="r-tracevu-download" href={href} download={`${record.id}-observability.json`} data-testid="trace-observability-download">
          Export JSON
        </a>
      </header>

      <div className="r-tracevu-o11y-table" role="tree" aria-label="Observability spans">
        <div className="r-tracevu-o11y-table-head" aria-hidden="true">
          <span>Span</span>
          <span>Type</span>
          <span>Status</span>
          <span>Timeline</span>
        </div>
        {rows.map(({ span, depth }) => {
          const pos = spanPosition(span, range);
          return (
            <div
              key={span.id}
              className="r-tracevu-o11y-row"
              data-testid="trace-observability-span"
              data-status={span.status}
              data-type={span.type}
              role="treeitem"
              aria-level={depth + 1}
              style={{ "--depth": depth } as CSSProperties}
            >
              <span className="r-tracevu-o11y-name" title={span.name}>{span.name}</span>
              <span className="r-tracevu-o11y-type">{span.type}</span>
              <span className="r-tracevu-o11y-status">{span.status}</span>
              <span className="r-tracevu-o11y-timeline">
                <span
                  className="r-tracevu-o11y-bar"
                  style={{
                    "--bar-left": `${pos.left}%`,
                    "--bar-width": `${pos.width}%`,
                  } as CSSProperties}
                  aria-label={`${span.name}: ${span.latencyMs ?? 0}ms`}
                />
                <span className="r-tracevu-o11y-ms">{span.latencyMs ?? 0}ms</span>
              </span>
            </div>
          );
        })}
      </div>

      <details className="r-tracevu-o11y-raw">
        <summary>Adapter payload</summary>
        <pre data-testid="trace-observability-json">{exportJson}</pre>
      </details>
    </div>
  );
}

function flattenSpans(spans: TraceObservabilitySpan[]): SpanRow[] {
  const byParent = new Map<string | null, TraceObservabilitySpan[]>();
  for (const span of spans) {
    const parent = span.parentSpanId ?? null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), span]);
  }
  for (const bucket of byParent.values()) bucket.sort((a, b) => a.startedAt - b.startedAt || a.name.localeCompare(b.name));
  const rows: SpanRow[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const span of byParent.get(parent) ?? []) {
      rows.push({ span, depth });
      visit(span.id, depth + 1);
    }
  };
  visit(null, 0);
  return rows;
}

function timeRange(spans: TraceObservabilitySpan[]): { start: number; end: number } {
  const start = Math.min(...spans.map((span) => span.startedAt));
  const end = Math.max(...spans.map((span) => span.endedAt ?? span.startedAt));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return { start: 0, end: 1 };
  return { start, end };
}

function spanPosition(span: TraceObservabilitySpan, range: { start: number; end: number }): { left: number; width: number } {
  const total = Math.max(1, range.end - range.start);
  const left = clamp(((span.startedAt - range.start) / total) * 100);
  const rawWidth = (((span.endedAt ?? span.startedAt) - span.startedAt) / total) * 100;
  return { left, width: clamp(Math.max(1.5, rawWidth)) };
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Number(value.toFixed(2))));
}

function exportPayload(doc: TraceObservabilityExport) {
  return {
    schema: doc.schema,
    traceId: doc.traceId,
    adapters: doc.adapters,
    assistantUi: doc.assistantUi,
    openTelemetry: doc.openTelemetry,
    langfuse: doc.langfuse,
  };
}
