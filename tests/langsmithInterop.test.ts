import { describe, expect, it } from "vitest";
import { buildLangSmithPayload, exportLangSmithTrace, traceObservabilityExportFromSpans } from "../src/nodeagent";

describe("LangSmith interop exporter", () => {
  it("builds LangSmith runs with trace metadata, hierarchy, costs, and receipt links", async () => {
    const trace = traceObservabilityExportFromSpans({
      traceId: "trace-ls-1",
      name: "ProofLoop run",
      generatedAt: 1000,
      spans: [
        {
          id: "root",
          traceId: "trace-ls-1",
          parentSpanId: null,
          name: "NodeAgent",
          type: "agent",
          status: "completed",
          startedAt: 1000,
          endedAt: 1100,
          latencyMs: 100,
          attributes: { model: "gpt-5.4-mini", inputTokens: 10, outputTokens: 5, costUsd: 0.01 },
          input: "goal",
          output: "done",
        },
        {
          id: "tool",
          traceId: "trace-ls-1",
          parentSpanId: "root",
          name: "fetch_source",
          type: "tool",
          status: "completed",
          startedAt: 1010,
          endedAt: 1050,
          latencyMs: 40,
          attributes: { tool: "fetch_source" },
          output: "source ok",
        },
      ],
    });

    const payload = buildLangSmithPayload({
      trace,
      projectName: "interop-test",
      metadata: {
        proofloopRunId: "pl-run-1",
        frameId: "rf-1",
        modelRoute: "langchain:openai:gpt-5.4-mini",
        receiptPath: ".proofloop/runs/pl-run-1/verifier-receipt.json",
      },
    });

    expect(payload.project_name).toBe("interop-test");
    expect(payload.runs[1]).toMatchObject({
      parent_run_id: payload.runs[0].id,
      run_type: "tool",
      extra: {
        metadata: {
          proofloopRunId: "pl-run-1",
          frameId: "rf-1",
          modelRoute: "langchain:openai:gpt-5.4-mini",
          receiptPath: ".proofloop/runs/pl-run-1/verifier-receipt.json",
        },
      },
    });
    expect(payload.runs[0].extra.metadata.costUsd).toBe(0.01);

    const sent: unknown[] = [];
    const exported = await exportLangSmithTrace({
      trace,
      projectName: "interop-test",
      sink: { send: async (body) => { sent.push(body); } },
      env: { NODEROOM_LANGSMITH_ENABLED: "true" },
    });

    expect(exported.ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it("does not throw when LangSmith export fails", async () => {
    const trace = traceObservabilityExportFromSpans({
      traceId: "trace-ls-fail",
      name: "ProofLoop run",
      spans: [],
    });

    const result = await exportLangSmithTrace({
      trace,
      sink: { send: async () => { throw new Error("network down"); } },
      env: { NODEROOM_LANGSMITH_ENABLED: "true" },
    });

    expect(result).toMatchObject({ ok: false, error: "network down" });
  });
});
