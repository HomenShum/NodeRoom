import { describe, expect, it } from "vitest";
import {
  buildNodeAgentTrace,
  defaultTracePlan,
  redactTraceText,
  stableTraceHash,
  traceContextPackFromContext,
  traceExcellenceLevel,
  summarizeTrace,
  type AgentResult,
} from "../src/nodeagent";

const budget = {
  startedAt: 1000,
  now: 1050,
  reserveMs: 0,
  elapsedMs: 50,
  maxSteps: 4,
  attemptedSteps: 1,
};

describe("nodeagent trace spine", () => {
  it("turns runtime tool events into redacted workpaper receipts", () => {
    const contextPack = traceContextPackFromContext(
      {
        globalGoal: "Prove the finance source before editing cells.",
        currentArtifactDigest: "artifact:sheet_123; range:C4:D5",
        relevantCacheKeys: ["entityResearchCache:company:acme:revenue"],
        relevantOkfConceptIds: ["okf:source_evidence"],
        openQuestions: ["Need revenue citation"],
        constraints: ["No durable memory without trace provenance."],
        expectedOutputSchema: "source_backed_cell_payload_v1",
      },
      { frameId: "rf_trace_spine", missingEvidenceRefs: ["source:wbd-10k"] },
    );

    const result: AgentResult = {
      finalText: "Source-backed revenue update is ready for review.",
      steps: 1,
      exhausted: false,
      stopReason: "done",
      budget,
      trace: [
        {
          step: 1,
          tool: "fetch_source",
          args: { url: "https://example.com/10k", apiKey: "sk-live-nodeagent-secret" },
          result: { ok: true, sourceRef: "source:wbd-10k", fact: "Total revenues = 41321" },
          ms: 42,
        },
      ],
      messages: [],
      usage: { inputTokens: 10, outputTokens: 4, modelCalls: 1 },
    };

    const trace = buildNodeAgentTrace({
      traceId: "trace_unit_1",
      roomId: "room_finance",
      agentJobId: "job_1",
      startedAt: budget.startedAt,
      trigger: {
        kind: "spreadsheet",
        prompt: "Update revenue, contact banker@example.com",
        selectedArtifactIds: ["sheet_123"],
        openedSurface: "workSurface.trace",
      },
      plan: defaultTracePlan("Update revenue with source proof.", {
        reads: [{ kind: "cell", refId: "sheet_123!C4", label: "Revenue input" }],
        writes: [{ kind: "cell", refId: "sheet_123!D4", label: "Revenue output" }],
        approvalRequired: true,
        riskFlags: ["financial_fact"],
      }),
      contextPack,
      agentResult: result,
    });

    expect(trace.schema).toBe("nodeagent.trace.v1");
    expect(trace.contextPack.includedRefs.map((ref) => ref.refId)).toContain("okf:source_evidence");
    expect(trace.contextPack.excludedRefs[0].ref.refId).toBe("source:wbd-10k");
    expect(trace.steps).toHaveLength(1);
    expect(trace.steps[0].tool?.name).toBe("fetch_source");
    expect(trace.steps[0].tool?.argsHash).toMatch(/^fnv1a:/);
    expect(trace.steps[0].outputRefs[0].hash).toBe(trace.steps[0].tool?.resultHash);
    expect(JSON.stringify(trace)).not.toContain("sk-live-nodeagent-secret");
    expect(trace.trigger.prompt).not.toContain("banker@example.com");
    expect(redactTraceText("send to banker@example.com")).toContain("[redacted]");
    expect(stableTraceHash({ b: 2, a: 1 })).toBe(stableTraceHash({ a: 1, b: 2 }));
    expect(traceExcellenceLevel(trace)).toBe(3);
    expect(summarizeTrace(trace)).toContain("L3 evidence links");
    expect(trace.final.status).toBe("completed");
  });
});
