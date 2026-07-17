import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AgentTool } from "../src/nodeagent/core/types";
import { convexModel } from "../src/nodeagent/models/convexModel";
import { openRouterFreeRouteHealthSnapshot, resetOpenRouterFreeRouteHealth } from "../src/nodeagent/models/openRouterFreeModels";
import { QualityFailoverError } from "../src/nodeagent/models/qualityFailover";

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
    process.env.OPENROUTER_FREE_CANDIDATE_TIMEOUT_MS = "5000";
    process.env.OPENROUTER_FREE_REQUEST_TIMEOUT_MS = "90000";
    process.env.OPENROUTER_FREE_REQUEST_RESERVE_MS = "5000";
    resetOpenRouterFreeRouteHealth();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_FREE_MODEL_CACHE_MS;
    delete process.env.OPENROUTER_FREE_AUTO_LIMIT;
    delete process.env.OPENROUTER_FREE_CANDIDATE_TIMEOUT_MS;
    delete process.env.OPENROUTER_FREE_REQUEST_TIMEOUT_MS;
    delete process.env.OPENROUTER_FREE_REQUEST_RESERVE_MS;
    resetOpenRouterFreeRouteHealth();
    vi.useRealTimers();
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
      qualityFailover: {
        status: "succeeded",
        stopReason: "accepted",
        routeAttempts: [
          { routeId: "nvidia/nemotron-3-super-120b-a12b:free", outcome: "provider_failure" },
          { routeId: "qwen/qwen3-next-80b-a3b-instruct:free", outcome: "provider_failure" },
          { routeId: "cohere/north-mini-code:free", outcome: "accepted" },
        ],
      },
    });
    expect(openRouterFreeRouteHealthSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: "nvidia/nemotron-3-super-120b-a12b:free", consecutiveFailures: 1 }),
      expect.objectContaining({ modelId: "qwen/qwen3-next-80b-a3b-instruct:free", consecutiveFailures: 1 }),
      expect.objectContaining({ modelId: "cohere/north-mini-code:free", successes: 1, consecutiveFailures: 0 }),
    ]));
  });

  it("stops on a global provider gate and exposes the failed receipt on a typed error", async () => {
    const attempted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models?output_modalities=text")) {
        return new Response(JSON.stringify({ data: freeModels }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      attempted.push(String(body.model));
      return new Response("unauthorized", { status: 401 });
    }));

    const route = convexModel("openrouter/free-auto", { freeAutoMode: "structured", entrypoint: "free" });
    const error = await route.next({
      system: "Return JSON only.",
      messages: [{ role: "user", content: "emit a structured edit plan" }],
      tools: [],
    }).then(() => undefined, (failure: unknown) => failure);

    expect(error).toBeInstanceOf(QualityFailoverError);
    if (!(error instanceof QualityFailoverError)) throw error;
    expect(attempted).toEqual(["nvidia/nemotron-3-super-120b-a12b:free"]);
    expect(error.cause).toBeInstanceOf(Error);
    expect(error.receipt).toMatchObject({
      status: "blocked",
      stopReason: "global_provider_failure",
      terminalFailure: {
        failureClass: "provider",
        reason: "provider_auth_required",
        providerFailureScope: "global",
        providerFailureCategory: "auth",
      },
      routeAttempts: [{
        routeId: "nvidia/nemotron-3-super-120b-a12b:free",
        outcome: "provider_failure",
        decision: "stop",
        reason: "provider_auth_required",
      }],
    });
    expect(openRouterFreeRouteHealthSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        modelId: "nvidia/nemotron-3-super-120b-a12b:free",
        attempts: 1,
        successes: 0,
        consecutiveFailures: 1,
      }),
    ]));
  });

  it("rotates prose-only output and cools the route when a tool call is required", async () => {
    const attempted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models?output_modalities=text")) {
        return new Response(JSON.stringify({ data: freeModels }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      attempted.push(String(body.model));
      if (attempted.length === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "I will make that change." } }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: null,
            tool_calls: [{
              id: "call-say-1",
              type: "function",
              function: { name: "say", arguments: JSON.stringify({ text: "done" }) },
            }],
          },
        }],
        usage: { prompt_tokens: 12, completion_tokens: 7 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const sayTool: AgentTool = {
      name: "say",
      description: "Return a message.",
      schema: z.object({ text: z.string() }),
      execute: async () => ({ ok: true }),
    };
    const route = convexModel("openrouter/free-auto", { freeAutoMode: "structured", entrypoint: "free" });
    const step = await route.next({
      system: "Call the available tool.",
      messages: [{ role: "user", content: "finish the task" }],
      tools: [sayTool],
      toolChoice: "required",
    });

    expect(attempted).toEqual([
      "nvidia/nemotron-3-super-120b-a12b:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
    ]);
    expect(route.name).toBe("qwen/qwen3-next-80b-a3b-instruct:free");
    expect(step.toolCalls).toEqual([{
      id: "call-say-1",
      tool: "say",
      args: { text: "done" },
    }]);
    expect(step.providerRoute).toMatchObject({
      requestedModel: "qwen/qwen3-next-80b-a3b-instruct:free",
      resolvedModel: "qwen/qwen3-next-80b-a3b-instruct:free",
      provider: "openrouter",
      entrypoint: "free",
    });
    const health = openRouterFreeRouteHealthSnapshot();
    expect(health.find((entry) => entry.modelId === "nvidia/nemotron-3-super-120b-a12b:free")).toMatchObject({
      successes: 0,
      consecutiveFailures: 1,
    });
    expect(health.find((entry) => entry.modelId === "qwen/qwen3-next-80b-a3b-instruct:free")).toMatchObject({
      successes: 1,
      consecutiveFailures: 0,
    });
  });
});
