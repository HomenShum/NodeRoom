import { describe, expect, it } from "vitest";
import { openTelemetrySpanAdapter } from "@evilmartians/agent-prism-data";
import { traceRecordToObservabilityExport } from "../src/ui/panels/traceObservabilityData";
import type { TraceRecord } from "../src/ui/panels/traceData";

describe("trace observability adapters", () => {
  it("exports every TraceRecord step to react-o11y, AgentPrism OTLP, and Langfuse shapes", () => {
    const record: TraceRecord = {
      id: "agent-run-unit",
      kind: "agent",
      title: "Agent run · unit trace",
      subtitle: "prove all steps survive adapter normalization",
      ts: "2026-07-04T08:00:00.000Z",
      source: { tool: "NodeAgent", version: "unit", model: "scripted" },
      verdict: { label: "verified", tone: "ok" },
      steps: [
        { idx: 1, label: "read_range input cells", status: "ok", group: "tool", detail: "read A1:B4" },
        { idx: 2, label: "verify evidence receipt", status: "warn", group: "proof", detail: "needs human note" },
        { idx: 3, label: "mis-keyed entry blocked", status: "risk", group: "gate", detail: "golden mismatch" },
      ],
      raw: { generatedAt: "2026-07-04T08:00:00.000Z" },
    };

    const doc = traceRecordToObservabilityExport(record);

    expect(doc.schema).toBe("noderoom.trace.observability.v1");
    expect(doc.spans).toHaveLength(4);
    expect(doc.assistantUi.reactO11ySpans).toHaveLength(4);
    expect(doc.assistantUi.reactO11ySpans.map((span) => span.name)).toEqual([
      "Agent run · unit trace",
      "read_range input cells",
      "verify evidence receipt",
      "mis-keyed entry blocked",
    ]);
    expect(doc.langfuse.observations).toHaveLength(4);
    expect(doc.langfuse.observations.map((obs) => obs.type)).toEqual(["AGENT", "TOOL", "GUARDRAIL", "TOOL"]);

    const agentPrismSpans = openTelemetrySpanAdapter.convertRawDocumentsToSpans(doc.openTelemetry);
    expect(agentPrismSpans).toHaveLength(1);
    expect(agentPrismSpans[0].type).toBe("agent_invocation");
    expect(agentPrismSpans[0].children).toHaveLength(3);
    expect(agentPrismSpans[0].children?.map((span) => span.title)).toContain("mis-keyed entry blocked");
    expect(agentPrismSpans[0].children?.some((span) => span.status === "error")).toBe(true);
  });
});
