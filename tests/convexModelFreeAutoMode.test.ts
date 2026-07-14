import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convexModel } from "../src/nodeagent/models/convexModel";
import { openRouterFreeRouteHealthSnapshot, resetOpenRouterFreeRouteHealth } from "../src/nodeagent/models/openRouterFreeModels";

const freeModels = [
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
];

describe("Convex free-auto model routing", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_FREE_MODEL_CACHE_MS = "0";
    process.env.OPENROUTER_FREE_AUTO_LIMIT = "3";
    resetOpenRouterFreeRouteHealth();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_FREE_MODEL_CACHE_MS;
    delete process.env.OPENROUTER_FREE_AUTO_LIMIT;
    resetOpenRouterFreeRouteHealth();
  });

  it("rotates past two failed HTTP routes and returns the third concrete model", async () => {
    const attempted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models?output_modalities=text")) {
        return new Response(JSON.stringify({ data: freeModels }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      attempted.push(String(body.model));
      if (attempted.length === 1) return new Response("first route unavailable", { status: 503 });
      if (attempted.length === 2) return new Response("second route rate limited", { status: 429 });
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ selectedModel: body.model }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const route = convexModel("openrouter/free-auto", { freeAutoMode: "structured", entrypoint: "free" });
    const step = await route.next({
      system: "Return JSON only.",
      messages: [{ role: "user", content: "emit a structured edit plan" }],
      tools: [],
    });

    expect(attempted).toEqual([
      "nvidia/nemotron-3-super-120b-a12b:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "cohere/north-mini-code:free",
    ]);
    expect(route.name).toBe("cohere/north-mini-code:free");
    expect(step.text).toContain("cohere/north-mini-code:free");
    expect(step.providerRoute).toMatchObject({
      requestedModel: "cohere/north-mini-code:free",
      resolvedModel: "cohere/north-mini-code:free",
      provider: "openrouter",
      entrypoint: "free",
    });
    expect(openRouterFreeRouteHealthSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: "nvidia/nemotron-3-super-120b-a12b:free", consecutiveFailures: 1 }),
      expect.objectContaining({ modelId: "qwen/qwen3-next-80b-a3b-instruct:free", consecutiveFailures: 1 }),
      expect.objectContaining({ modelId: "cohere/north-mini-code:free", successes: 1, consecutiveFailures: 0 }),
    ]));
  });
});
