import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openRouterFreeRouteHealthSnapshot, resetOpenRouterFreeRouteHealth } from "../src/nodeagent/models/openRouterFreeModels";

const generateTextMock = vi.hoisted(() => vi.fn(async (options: { model: { id: string } }) => ({
  text: JSON.stringify({ selectedModel: options.model.id }),
  toolCalls: [],
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
    resetOpenRouterFreeRouteHealth();
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

  it("fails over within one request when the first two free routes fail", async () => {
    generateTextMock
      .mockRejectedValueOnce(new Error("Provider request failed 503: first route unavailable"))
      .mockRejectedValueOnce(new Error("Provider request failed 429: second route rate limited"));
    const { model } = await import("../src/nodeagent/models/adapter");
    const route = model("openrouter/free-auto", { freeAutoMode: "structured" });

    const step = await route.next({
      system: "Return JSON only.",
      messages: [{ role: "user", content: "emit a structured edit plan" }],
      tools: [],
    });

    expect(generateTextMock).toHaveBeenCalledTimes(3);
    expect(generateTextMock.mock.calls.map((call) => call[0].model.id)).toEqual([
      "nvidia/nemotron-3-super-120b-a12b:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "cohere/north-mini-code:free",
    ]);
    expect(route.name).toBe("cohere/north-mini-code:free");
    expect(step.text).toContain("cohere/north-mini-code:free");
    expect(openRouterFreeRouteHealthSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: "nvidia/nemotron-3-super-120b-a12b:free", consecutiveFailures: 1 }),
      expect.objectContaining({ modelId: "qwen/qwen3-next-80b-a3b-instruct:free", consecutiveFailures: 1 }),
      expect.objectContaining({ modelId: "cohere/north-mini-code:free", successes: 1, consecutiveFailures: 0 }),
    ]));
  });
});
