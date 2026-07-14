import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { openRouterFreeRouteHealthSnapshot, resetOpenRouterFreeRouteHealth } from "../src/nodeagent/models/openRouterFreeModels";
import { QualityFailoverError } from "../src/nodeagent/models/qualityFailover";

const generateTextMock = vi.hoisted(() => vi.fn(async (options: { model: { id: string } }) => ({
  text: JSON.stringify({ selectedModel: options.model.id }),
  toolCalls: [] as Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }>,
  usage: { inputTokens: 10, outputTokens: 5 },
})));

vi.mock("ai", () => ({
  generateText: generateTextMock,
  tool: (definition: unknown) => definition,
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({
    chat: (id: string) => ({ provider: "openrouter", id }),
  }),
  openai: (id: string) => ({ provider: "openai", id }),
}));

vi.mock("@ai-sdk/anthropic", () => ({
  anthropic: (id: string) => ({ provider: "anthropic", id }),
}));

vi.mock("@ai-sdk/google", () => ({
  google: (id: string) => ({ provider: "google", id }),
}));

describe("model adapter free-auto modes", () => {
  beforeEach(() => {
    generateTextMock.mockClear();
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_FREE_MODEL_CACHE_MS = "0";
    process.env.OPENROUTER_FREE_AUTO_LIMIT = "3";
    process.env.OPENROUTER_FREE_CANDIDATE_RETRIES = "0";
    process.env.OPENROUTER_FREE_CANDIDATE_TIMEOUT_MS = "5000";
    process.env.OPENROUTER_FREE_REQUEST_TIMEOUT_MS = "90000";
    process.env.OPENROUTER_FREE_REQUEST_RESERVE_MS = "5000";
    resetOpenRouterFreeRouteHealth();
    delete process.env.NODEAGENT_QUARANTINED_MODELS;
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      data: [
        {
          id: "cohere/north-mini-code:free",
          pricing: { prompt: "0", completion: "0", request: "0" },
          context_length: 256_000,
          supported_parameters: ["max_tokens", "tools", "tool_choice", "reasoning"],
        },
        {
          id: "nvidia/nemotron-3-super-120b-a12b:free",
          pricing: { prompt: "0", completion: "0", request: "0" },
          context_length: 1_000_000,
          supported_parameters: ["max_tokens", "response_format", "structured_outputs", "tool_choice", "tools"],
        },
        {
          id: "qwen/qwen3-next-80b-a3b-instruct:free",
          pricing: { prompt: "0", completion: "0", request: "0" },
          context_length: 1_000_000,
          supported_parameters: ["max_tokens", "response_format", "structured_outputs", "tool_choice", "tools"],
        },
      ],
    }), { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_FREE_MODEL_CACHE_MS;
    delete process.env.OPENROUTER_FREE_AUTO_LIMIT;
    delete process.env.OPENROUTER_FREE_CANDIDATE_RETRIES;
    delete process.env.OPENROUTER_FREE_CANDIDATE_TIMEOUT_MS;
    delete process.env.OPENROUTER_FREE_REQUEST_TIMEOUT_MS;
    delete process.env.OPENROUTER_FREE_REQUEST_RESERVE_MS;
    resetOpenRouterFreeRouteHealth();
    vi.useRealTimers();
  });

  it("honors structured free-auto mode for no-tool JSON planning calls", async () => {
    const { model } = await import("../src/nodeagent/models/adapter");
    const route = model("openrouter/free-auto", { freeAutoMode: "structured" });

    await route.next({
      system: "Return JSON only.",
      messages: [{ role: "user", content: "emit a structured edit plan" }],
      tools: [],
    });

    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock.mock.calls[0]?.[0].model.id).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    expect(route.name).toBe("nvidia/nemotron-3-super-120b-a12b:free");
  });

  it("defaults SpreadsheetBench model-edit-plan free-auto runs to structured mode", () => {
    const source = readFileSync("scripts/spreadsheetbench-run.ts", "utf8");
    expect(source).toContain('mode === "model-edit-plan" ? "structured" : undefined');
  });

  it("fails over within one request when the first route fails and the second hangs", async () => {
    vi.useFakeTimers();
    generateTextMock
      .mockRejectedValueOnce(new Error("Provider request failed 503: first route unavailable"))
      .mockImplementationOnce(() => new Promise<never>(() => undefined));
    const { model } = await import("../src/nodeagent/models/adapter");
    const route = model("openrouter/free-auto", { freeAutoMode: "structured" });

    const settled = route.next({
      system: "Return JSON only.",
      messages: [{ role: "user", content: "emit a structured edit plan" }],
      tools: [],
    }).then((step) => ({ ok: true as const, step }), (error: unknown) => ({ ok: false as const, error }));

    await vi.advanceTimersByTimeAsync(0);
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await settled;
    if (!result.ok) throw result.error;
    const { step } = result;

    expect(generateTextMock).toHaveBeenCalledTimes(3);
    expect(generateTextMock.mock.calls.map((call) => call[0].model.id)).toEqual([
      "nvidia/nemotron-3-super-120b-a12b:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "cohere/north-mini-code:free",
    ]);
    expect(route.name).toBe("cohere/north-mini-code:free");
    expect(step.text).toContain("cohere/north-mini-code:free");
    const receipt = (step.providerRoute as unknown as {
      qualityFailover?: { routeAttempts: Array<{ outcome: string; reason: string }> };
    }).qualityFailover;
    expect(receipt?.routeAttempts).toMatchObject([
      { outcome: "provider_failure", reason: "provider_transient_failure" },
      { outcome: "provider_failure", reason: "candidate_timeout" },
      { outcome: "accepted", reason: "accepted" },
    ]);
    expect(openRouterFreeRouteHealthSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: "nvidia/nemotron-3-super-120b-a12b:free", consecutiveFailures: 1 }),
      expect.objectContaining({ modelId: "qwen/qwen3-next-80b-a3b-instruct:free", consecutiveFailures: 1 }),
      expect.objectContaining({ modelId: "cohere/north-mini-code:free", successes: 1, consecutiveFailures: 0 }),
    ]));
  });

  it("persists a terminal time-budget attempt and throws its typed receipt", async () => {
    vi.useFakeTimers();
    process.env.OPENROUTER_FREE_AUTO_LIMIT = "1";
    process.env.OPENROUTER_FREE_CANDIDATE_TIMEOUT_MS = "10000";
    process.env.OPENROUTER_FREE_REQUEST_TIMEOUT_MS = "10000";
    process.env.OPENROUTER_FREE_REQUEST_RESERVE_MS = "5000";
    generateTextMock.mockImplementationOnce(() => new Promise<never>(() => undefined));
    const { model } = await import("../src/nodeagent/models/adapter");
    const route = model("openrouter/free-auto", { freeAutoMode: "structured" });

    const settled = route.next({
      system: "Return JSON only.",
      messages: [{ role: "user", content: "emit a structured edit plan" }],
      tools: [],
    }).then(() => undefined, (error: unknown) => error);

    await vi.advanceTimersByTimeAsync(0);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    const error = await settled;

    expect(error).toBeInstanceOf(QualityFailoverError);
    if (!(error instanceof QualityFailoverError)) throw error;
    expect(error.message).toContain("request deadline exceeded");
    expect(error.receipt).toMatchObject({
      status: "blocked",
      stopReason: "time_budget",
      budget: { reserveMs: 5_000, attemptsUsed: 1 },
      routeAttempts: [{
        routeId: "nvidia/nemotron-3-super-120b-a12b:free",
        outcome: "aborted",
        decision: "stop",
        reason: "time_budget_exhausted",
      }],
    });
    expect(openRouterFreeRouteHealthSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modelId: "nvidia/nemotron-3-super-120b-a12b:free",
        attempts: 1,
        successes: 0,
        consecutiveFailures: 1,
        lastError: "time_budget_exhausted",
      }),
    ]));
  });

  it("rotates a prose-only route and cools it when the runtime requires a tool call", async () => {
    generateTextMock
      .mockResolvedValueOnce({
        text: "I would inspect the workbook first.",
        toolCalls: [],
        usage: { inputTokens: 10, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        text: "",
        toolCalls: [{ toolCallId: "inspect-1", toolName: "inspect_workbook", input: { instruction: "repair B2" } }],
        usage: { inputTokens: 12, outputTokens: 6 },
      });
    const { model } = await import("../src/nodeagent/models/adapter");
    const route = model("openrouter/free-auto", { freeAutoMode: "agent" });

    const step = await route.next({
      system: "Inspect before writing.",
      messages: [{ role: "user", content: "Repair the workbook." }],
      tools: [{
        name: "inspect_workbook",
        description: "Inspect workbook targets.",
        schema: z.object({ instruction: z.string() }),
        execute: async () => ({ ok: true }),
      }],
      toolChoice: "required",
    });

    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(generateTextMock.mock.calls.map((call) => call[0].model.id)).toEqual([
      "cohere/north-mini-code:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
    ]);
    expect(step.toolCalls).toEqual([expect.objectContaining({ tool: "inspect_workbook" })]);
    expect(route.name).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    const quality = (step.providerRoute as unknown as { qualityFailover?: { routeAttempts?: Array<{ outcome: string; reason: string }> } })?.qualityFailover;
    expect(quality?.routeAttempts).toEqual([
      expect.objectContaining({ outcome: "quality_failure", reason: "incomplete_result" }),
      expect.objectContaining({ outcome: "accepted" }),
    ]);
    expect(openRouterFreeRouteHealthSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: "cohere/north-mini-code:free", successes: 0, consecutiveFailures: 1 }),
      expect.objectContaining({ modelId: "nvidia/nemotron-3-super-120b-a12b:free", successes: 1, consecutiveFailures: 0 }),
    ]));
  });
});
