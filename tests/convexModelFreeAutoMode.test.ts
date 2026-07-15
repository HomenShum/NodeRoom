import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { AgentRunError, InMemoryRoomTools, ROOM_TOOLS, runAgent } from "../src/nodeagent";
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

function runtimeTools() {
  const engine = new RoomEngine();
  const demo = buildDemoRoom(engine);
  return new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
}

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
    delete process.env.NEBIUS_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    delete process.env.AGENT_FALLBACK_MODEL;
    delete process.env.AGENT_FALLBACK_MODELS;
    delete process.env.AGENT_QUALITY_CANDIDATE_TIMEOUT_MS;
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

  it("returns a required-tool miss to the runtime instead of preempting protocol recovery", async () => {
    const attempted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/models?output_modalities=text")) {
        return new Response(JSON.stringify({ data: freeModels }), { status: 200 });
      }
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      attempted.push(String(body.model));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "I will make that change." } }],
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

    expect(attempted).toEqual(["nvidia/nemotron-3-super-120b-a12b:free"]);
    expect(route.name).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    expect(step.text).toBe("I will make that change.");
    expect(step.toolCalls).toEqual([]);
    expect(step.usage).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: 1,
      costUsd: 0,
      costKind: "exact",
    });
    expect(step.providerRoute).toMatchObject({
      requestedModel: "nvidia/nemotron-3-super-120b-a12b:free",
      resolvedModel: "nvidia/nemotron-3-super-120b-a12b:free",
      provider: "openrouter",
      entrypoint: "free",
    });
    const health = openRouterFreeRouteHealthSnapshot();
    expect(health.find((entry) => entry.modelId === "nvidia/nemotron-3-super-120b-a12b:free")).toMatchObject({
      successes: 1,
      consecutiveFailures: 0,
    });
  });

  it("keeps a successful concrete fallback sticky and the failed primary cooling down", async () => {
    process.env.NEBIUS_API_KEY = "test-nebius-key";
    const attempted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      attempted.push(String(body.model));
      if (attempted.length === 1) {
        return new Response(JSON.stringify({
          choices: [{ message: { content: "" } }],
          usage: { prompt_tokens: 10, completion_tokens: 0 },
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({
        choices: [{ message: { content: `answer from ${body.model}` } }],
        usage: { prompt_tokens: 12, completion_tokens: 6 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const route = convexModel("nebius/zai-org/GLM-5.2", {
      entrypoint: "public_ask",
      fallbackModelIds: ["z-ai/glm-5.2"],
    });
    const first = await route.next({
      system: "Answer.",
      messages: [{ role: "user", content: "first turn" }],
      tools: [],
    });
    const resumed = convexModel("nebius/zai-org/GLM-5.2", {
      entrypoint: "public_ask",
      fallbackModelIds: ["z-ai/glm-5.2"],
      routeState: route.routeState?.(),
    });
    const second = await resumed.next({
      system: "Answer.",
      messages: [{ role: "user", content: "second turn" }],
      tools: [],
    });

    expect(attempted).toEqual(["zai-org/GLM-5.2", "z-ai/glm-5.2", "z-ai/glm-5.2"]);
    expect(route.name).toBe("z-ai/glm-5.2");
    expect(resumed.name).toBe("z-ai/glm-5.2");
    expect(resumed.routeState?.()).toMatchObject({ preferredModelId: "z-ai/glm-5.2" });
    expect(first.usage).toMatchObject({ inputTokens: 22, outputTokens: 6, modelCalls: 2 });
    expect(second.usage).toMatchObject({ inputTokens: 12, outputTokens: 6, modelCalls: 1 });
    const quality = (first.providerRoute as { qualityFailover?: { budget: { spentCostUsd: number } } } | undefined)?.qualityFailover;
    expect(first.usage?.costUsd).toBe(quality?.budget.spentCostUsd);
    expect(quality).toMatchObject({
      status: "succeeded",
      selectedRouteId: "z-ai/glm-5.2",
      routeAttempts: [
        { routeId: "nebius/zai-org/GLM-5.2", outcome: "quality_failure", reason: "empty_result" },
        { routeId: "z-ai/glm-5.2", outcome: "accepted" },
      ],
    });
  });

  it("stops concrete failover on provider policy rejection", async () => {
    process.env.NEBIUS_API_KEY = "test-nebius-key";
    const attempted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      attempted.push(String(body.model));
      return new Response("provider policy blocked", { status: 403 });
    }));

    const route = convexModel("nebius/zai-org/GLM-5.2", {
      entrypoint: "public_ask",
      fallbackModelIds: ["z-ai/glm-5.2"],
    });
    const error = await route.next({
      system: "Answer briefly.",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    }).then(() => undefined, (failure: unknown) => failure);

    expect(error).toBeInstanceOf(QualityFailoverError);
    if (!(error instanceof QualityFailoverError)) throw error;
    expect(attempted).toEqual(["zai-org/GLM-5.2"]);
    expect(error.receipt).toMatchObject({
      stopReason: "global_provider_failure",
      terminalFailure: { providerFailureCategory: "policy", providerFailureScope: "global" },
      routeAttempts: [{ outcome: "provider_failure", decision: "stop" }],
    });
  });

  it("does not issue a hidden blocking request after a failed stream", async () => {
    const attempted: string[] = [];
    const streamed: string[] = [];
    const encoder = new TextEncoder();
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string; stream?: boolean };
      attempted.push(String(body.model));
      expect(body.stream).toBe(true);
      let delivered = false;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!delivered) {
            delivered = true;
            controller.enqueue(encoder.encode(
              'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'
              + 'data: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":2,"prompt_tokens_details":{"cached_tokens":1}}}\n\n',
            ));
            return;
          }
          controller.error(new Error("stream transport failed"));
        },
      });
      return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }));

    const route = convexModel("z-ai/glm-5.2", { entrypoint: "public_ask" });
    const error = await route.next({
      system: "Answer briefly.",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      onTextDelta: (text) => {
        streamed.push(text);
      },
    }).then(() => undefined, (failure: unknown) => failure);

    expect(error).toBeInstanceOf(QualityFailoverError);
    expect(attempted).toEqual(["z-ai/glm-5.2"]);
    expect(streamed).toEqual([]);
    expect((error as QualityFailoverError).usage).toMatchObject({
      inputTokens: 5,
      outputTokens: 2,
      cachedInputTokens: 1,
      modelCalls: 1,
      costKind: "exact",
    });
    expect((error as QualityFailoverError).usage?.costUsd).toBeCloseTo(0.0000081, 10);
  });

  it("propagates failed failover usage and cached-token cost into AgentRunError", async () => {
    process.env.NEBIUS_API_KEY = "test-nebius-key";
    const attempted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      attempted.push(String(body.model));
      const isPrimary = attempted.length === 1;
      return new Response(JSON.stringify({
        choices: [{ message: { content: "" } }],
        usage: {
          prompt_tokens: isPrimary ? 10 : 12,
          completion_tokens: 0,
          prompt_tokens_details: { cached_tokens: isPrimary ? 4 : 2 },
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const route = convexModel("nebius/zai-org/GLM-5.2", {
      entrypoint: "public_ask",
      fallbackModelIds: ["z-ai/glm-5.2"],
    });

    const thrown = await runAgent({
      rt: runtimeTools(),
      goal: "answer the workbook question",
      model: route,
      tools: [],
      maxSteps: 2,
    }).then(() => undefined, (error: unknown) => error);

    expect(thrown).toBeInstanceOf(AgentRunError);
    const error = thrown as AgentRunError;
    expect(error.cause).toBeInstanceOf(QualityFailoverError);
    expect(attempted).toEqual(["zai-org/GLM-5.2", "z-ai/glm-5.2"]);
    expect(error.partial.usage).toMatchObject({
      inputTokens: 22,
      outputTokens: 0,
      cachedInputTokens: 6,
      modelCalls: 2,
    });
    expect(error.partial.usage.costUsd).toBeCloseTo(0.00001806, 10);
    expect((error.cause as QualityFailoverError).usage).toEqual(error.partial.usage);
  });

  it("lets runAgent terminate required-tool misses as protocol_stall after four calls", async () => {
    const attempted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      attempted.push(String(body.model));
      return new Response(JSON.stringify({
        choices: [{ message: { content: "I will update it." } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const result = await runAgent({
      rt: runtimeTools(),
      goal: "write 42 into the workbook cells",
      model: convexModel("z-ai/glm-5.2", { entrypoint: "public_ask" }),
      tools: ROOM_TOOLS,
      maxSteps: 8,
    });

    expect(attempted).toEqual(Array(4).fill("z-ai/glm-5.2"));
    expect(result.stopReason).toBe("step_budget");
    expect(result.handoff).toMatchObject({ terminalReason: "protocol_stall", remainingToolCalls: [] });
    expect(result.usage).toMatchObject({ modelCalls: 4, inputTokens: 40, outputTokens: 20 });
  });

  it("stops a same-provider auth failure but rotates to an authorized cross-provider route", async () => {
    process.env.NEBIUS_API_KEY = "test-nebius-key";
    const sameProviderAttempts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      sameProviderAttempts.push(String(body.model));
      return new Response("unauthorized", { status: 401 });
    }));
    const sameProvider = convexModel("z-ai/glm-5.2", {
      entrypoint: "public_ask",
      fallbackModelIds: ["z-ai/glm-4.7"],
    });
    const sameProviderError = await sameProvider.next({
      system: "Answer.",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    }).then(() => undefined, (error: unknown) => error);
    expect(sameProviderError).toBeInstanceOf(QualityFailoverError);
    expect(sameProviderAttempts).toEqual(["z-ai/glm-5.2"]);
    expect((sameProviderError as QualityFailoverError).receipt.stopReason).toBe("global_provider_failure");

    const crossProviderAttempts: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      crossProviderAttempts.push(String(body.model));
      if (crossProviderAttempts.length === 1) return new Response("unauthorized", { status: 401 });
      return new Response(JSON.stringify({
        choices: [{ message: { content: "fallback answer" } }],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    const crossProvider = convexModel("nebius/zai-org/GLM-5.2", {
      entrypoint: "public_ask",
      fallbackModelIds: ["z-ai/glm-5.2"],
    });
    const result = await crossProvider.next({
      system: "Answer.",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    });
    expect(crossProviderAttempts).toEqual(["zai-org/GLM-5.2", "z-ai/glm-5.2"]);
    expect(result.text).toBe("fallback answer");
  });

  it("retains a conservative reservation when catalog pricing cannot be measured exactly", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "answer" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const step = await convexModel("vendor/unknown-paid-model", { entrypoint: "public_ask" }).next({
      system: "Answer.",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    });
    expect(step.usage).toMatchObject({ inputTokens: 5, outputTokens: 2, modelCalls: 1, costKind: "estimated" });
    expect(step.usage?.costUsd).toBeGreaterThan(0);

    const result = await runAgent({
      rt: runtimeTools(),
      goal: "answer the question",
      model: convexModel("vendor/unknown-paid-model", { entrypoint: "public_ask" }),
      tools: [],
      maxSteps: 1,
      priceStep: () => 0.01,
    });
    expect(result.usage).toMatchObject({ modelCalls: 1, costKind: "estimated" });
    expect(result.usage.costUsd).toBeGreaterThan(0);
  });

  it("blocks an unknown paid route before the provider call when a hard turn budget is present", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const error = await convexModel("vendor/unknown-paid-model", { entrypoint: "public_ask" }).next({
      system: "Answer.",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      maxCostUsd: 0.01,
    }).then(() => undefined, (failure: unknown) => failure);

    expect(error).toBeInstanceOf(QualityFailoverError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((error as QualityFailoverError).receipt).toMatchObject({
      stopReason: "spend_budget",
      routeAttempts: [],
      skippedRoutes: [{ routeId: "vendor/unknown-paid-model", reason: "spend_budget" }],
    });
  });

  it("keeps cumulative paid failover reservations inside the remaining turn budget", async () => {
    process.env.NEBIUS_API_KEY = "test-nebius-key";
    const attempted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      attempted.push(String(body.model));
      return new Response("primary temporarily unavailable", { status: 503 });
    }));

    const error = await convexModel("nebius/zai-org/GLM-5.2", {
      entrypoint: "public_ask",
      fallbackModelIds: ["z-ai/glm-5.2"],
    }).next({
      system: "Answer.",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
      maxCostUsd: 0.03,
    }).then(() => undefined, (failure: unknown) => failure);

    expect(error).toBeInstanceOf(QualityFailoverError);
    expect(attempted).toEqual(["zai-org/GLM-5.2"]);
    expect((error as QualityFailoverError).receipt).toMatchObject({
      stopReason: "spend_budget",
      routeAttempts: [{ routeId: "nebius/zai-org/GLM-5.2", outcome: "provider_failure" }],
      skippedRoutes: [{ routeId: "z-ai/glm-5.2", reason: "spend_budget" }],
    });
    expect((error as QualityFailoverError).usage).toMatchObject({ modelCalls: 1, costKind: "estimated" });
  });

  it("blocks a paid route before calling it when its reservation exceeds the remaining run budget", async () => {
    process.env.NEBIUS_API_KEY = "test-nebius-key";
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "I will update it." } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await runAgent({
      rt: runtimeTools(),
      goal: "write 42 into the workbook cells",
      model: convexModel("nebius/zai-org/GLM-5.2", { entrypoint: "public_ask" }),
      tools: ROOM_TOOLS,
      maxSteps: 8,
      spendLimits: { maxCostUsd: 0.001 },
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.stopReason).toBe("spend_budget");
    expect(result.usage).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: 0,
      costKind: "exact",
    });
    expect(result.usage.costUsd).toBe(0);
  });

  it("counts no provider call when a direct provider key is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const error = await convexModel("gpt-5.4", { entrypoint: "public_ask" }).next({
      system: "Answer.",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    }).then(() => undefined, (failure: unknown) => failure);

    expect(error).toBeInstanceOf(QualityFailoverError);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((error as QualityFailoverError).usage).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: 0,
      costUsd: 0,
      costKind: "exact",
    });
  });

  it("labels a timed-out provider request estimated and checkpoints its cooldown", async () => {
    vi.useFakeTimers();
    process.env.NEBIUS_API_KEY = "test-nebius-key";
    process.env.AGENT_QUALITY_CANDIDATE_TIMEOUT_MS = "10000";
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        setTimeout(() => reject(new Error("provider fetch aborted after timeout")), 5);
      }, { once: true });
    })));

    const route = convexModel("nebius/zai-org/GLM-5.2", { entrypoint: "public_ask" });
    const pending = route.next({
      system: "Answer.",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    }).then(() => undefined, (failure: unknown) => failure);

    await vi.advanceTimersByTimeAsync(10_005);
    const error = await pending;

    expect(error).toBeInstanceOf(QualityFailoverError);
    const timeoutUsage = (error as QualityFailoverError).usage;
    expect(timeoutUsage).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      modelCalls: 1,
      costKind: "estimated",
    });
    expect(timeoutUsage?.costUsd).toBeGreaterThan(0);
    const timeoutAttempt = (error as QualityFailoverError).receipt.routeAttempts[0];
    expect(timeoutAttempt?.estimatedCostUsd).toBeGreaterThan(0);
    expect(timeoutAttempt?.costUsd).toBe(timeoutUsage?.costUsd);
    expect(route.routeState?.()).toMatchObject({
      cooldownUntil: { "nebius/zai-org/GLM-5.2": expect.any(Number) },
    });
  });

  it("accounts for Anthropic cache reads and labels unknown cache-write pricing estimated", async () => {
    process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
    let call = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      call += 1;
      return new Response(JSON.stringify({
        content: [{ type: "text", text: "answer" }],
        usage: {
          input_tokens: 20,
          cache_read_input_tokens: 80,
          cache_creation_input_tokens: call === 1 ? 0 : 10,
          output_tokens: 10,
        },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }));

    const exact = await convexModel("claude-sonnet-4.6", { entrypoint: "public_ask" }).next({
      system: "Answer.",
      messages: [{ role: "user", content: "hello" }],
      tools: [],
    });
    expect(exact.usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 10,
      cachedInputTokens: 80,
      cacheCreationInputTokens: 0,
      modelCalls: 1,
      costKind: "exact",
    });
    expect(exact.usage?.costUsd).toBeCloseTo(0.000234, 10);

    const estimated = await runAgent({
      rt: runtimeTools(),
      goal: "answer the question",
      model: convexModel("claude-sonnet-4.6", { entrypoint: "public_ask" }),
      tools: [],
      maxSteps: 1,
    });
    expect(estimated.usage).toMatchObject({
      inputTokens: 110,
      outputTokens: 10,
      cachedInputTokens: 80,
      cacheCreationInputTokens: 10,
      modelCalls: 1,
      costKind: "estimated",
    });
  });

  it("does not apply deployment fallback env without an artifact-authorized caller list", async () => {
    process.env.NEBIUS_API_KEY = "test-nebius-key";
    process.env.AGENT_FALLBACK_MODELS = "z-ai/glm-5.2";
    const attempted: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
      attempted.push(String(body.model));
      return new Response("provider unavailable", { status: 503 });
    }));
    const sayTool: AgentTool = {
      name: "say",
      description: "Return a message.",
      schema: z.object({ text: z.string() }),
      execute: async () => ({ ok: true }),
    };

    const route = convexModel("nebius/zai-org/GLM-5.2", { entrypoint: "public_ask" });
    const error = await route.next({
      system: "Call the tool.",
      messages: [{ role: "user", content: "finish" }],
      tools: [sayTool],
      toolChoice: "required",
    }).then(() => undefined, (failure: unknown) => failure);

    expect(error).toBeInstanceOf(QualityFailoverError);
    expect(attempted).toEqual(["zai-org/GLM-5.2"]);
  });
});
