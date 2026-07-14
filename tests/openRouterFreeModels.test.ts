import { afterEach, describe, expect, it } from "vitest";
import { priceRun } from "../src/nodeagent/models/adapter";
import { getProviderForModel, resolveModelAlias } from "../src/nodeagent/models/modelCatalog";
import {
  OPENROUTER_FREE_AUTO_MODEL,
  discoverOpenRouterFreeModels,
  isFreeTextModel,
  openRouterFreeCandidateSignal,
  openRouterFreeCandidateTimeoutMs,
  openRouterFreeRequestSignal,
  openRouterFreeRequestTimeoutMs,
  openRouterFreeRouteHealthSnapshot,
  preferredOpenRouterFreeModelIds,
  rankOpenRouterFreeModels,
  recordOpenRouterFreeRouteOutcome,
  resetOpenRouterFreeRouteHealth,
  restoreOpenRouterFreeRouteHealth,
  selectOpenRouterFreeModels,
  type OpenRouterModelInfo,
} from "../src/nodeagent/models/openRouterFreeModels";

const models: OpenRouterModelInfo[] = [
  {
    id: "small/no-tools:free",
    pricing: { prompt: "0", completion: "0", request: "0" },
    context_length: 128_000,
    supported_parameters: ["max_tokens"],
  },
  {
    id: "cohere/north-mini-code:free",
    pricing: { prompt: "0", completion: "0", request: "0" },
    context_length: 256_000,
    supported_parameters: ["max_tokens", "tools", "tool_choice", "reasoning"],
  },
  {
    id: "qwen/qwen3-coder:free",
    pricing: { prompt: "0", completion: "0", request: "0" },
    context_length: 1_048_576,
    supported_parameters: ["max_tokens", "tools", "tool_choice"],
  },
  {
    id: "openai/gpt-oss-120b:free",
    pricing: { prompt: "0", completion: "0", request: "0" },
    context_length: 131_072,
    supported_parameters: ["max_tokens", "tools", "tool_choice", "reasoning"],
  },
  {
    id: "paid/model",
    pricing: { prompt: "0.1", completion: "0", request: "0" },
    context_length: 1_000_000,
    supported_parameters: ["tools"],
  },
];

describe("OpenRouter free auto routing", () => {
  afterEach(() => resetOpenRouterFreeRouteHealth());

  it("bounds each candidate below the caller deadline so fallback can rotate", () => {
    expect(openRouterFreeCandidateTimeoutMs({})).toBe(45_000);
    expect(openRouterFreeCandidateTimeoutMs({ OPENROUTER_FREE_CANDIDATE_TIMEOUT_MS: "1" })).toBe(5_000);
    expect(openRouterFreeCandidateTimeoutMs({ OPENROUTER_FREE_CANDIDATE_TIMEOUT_MS: "999999" })).toBe(120_000);

    const parent = new AbortController();
    parent.abort();
    expect(openRouterFreeCandidateSignal(parent.signal, { OPENROUTER_FREE_CANDIDATE_TIMEOUT_MS: "5000" }).aborted).toBe(true);
  });

  it("bounds the whole free-auto request independently of candidate rotation", () => {
    expect(openRouterFreeRequestTimeoutMs({})).toBe(90_000);
    expect(openRouterFreeRequestTimeoutMs({ OPENROUTER_FREE_REQUEST_TIMEOUT_MS: "1" })).toBe(10_000);
    expect(openRouterFreeRequestTimeoutMs({ OPENROUTER_FREE_REQUEST_TIMEOUT_MS: "999999" })).toBe(300_000);

    const parent = new AbortController();
    parent.abort();
    expect(openRouterFreeRequestSignal(parent.signal, { OPENROUTER_FREE_REQUEST_TIMEOUT_MS: "10000" }).aborted).toBe(true);
  });

  it("filters to zero-priced text models", () => {
    expect(isFreeTextModel(models[0])).toBe(true);
    expect(isFreeTextModel(models[4])).toBe(false);
  });

  it("ranks tool-capable free models by capability signals", () => {
    const ranked = rankOpenRouterFreeModels(models, "agent");
    expect(ranked.map((m) => m.id)).toEqual(["cohere/north-mini-code:free", "qwen/qwen3-coder:free", "openai/gpt-oss-120b:free"]);
    expect(ranked[0].reasons).toContain("latest coding/agent specialist");
  });

  it("prefers JSON-capable models for no-tool structured edit-plan calls", () => {
    const ranked = rankOpenRouterFreeModels([
      ...models,
      {
        id: "nvidia/nemotron-3-super-120b-a12b:free",
        pricing: { prompt: "0", completion: "0", request: "0" },
        context_length: 1_000_000,
        supported_parameters: ["max_tokens", "response_format", "structured_outputs", "tool_choice", "tools"],
      },
    ], "structured");

    expect(ranked[0].id).toBe("nvidia/nemotron-3-super-120b-a12b:free");
    expect(ranked.findIndex((m) => m.id === "nvidia/nemotron-3-super-120b-a12b:free"))
      .toBeLessThan(ranked.findIndex((m) => m.id === "cohere/north-mini-code:free"));
  });

  it("skips operator-quarantined free-auto candidates before routing", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ data: models }), { status: 200 });

    const selected = await selectOpenRouterFreeModels({
      fetchImpl,
      forceRefresh: true,
      mode: "agent",
      env: { NODEAGENT_QUARANTINED_MODELS: "qwen/qwen3-coder:free=rate_limited" },
    });

    expect(selected.map((m) => m.id)).toEqual(["cohere/north-mini-code:free", "openai/gpt-oss-120b:free"]);
  });

  it("uses the latest passing live-canary pool while allowing an operator override", () => {
    expect(preferredOpenRouterFreeModelIds()).toEqual([
      "cohere/north-mini-code:free",
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "tencent/hy3:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
      "openrouter/free",
    ]);
    expect(preferredOpenRouterFreeModelIds({
      OPENROUTER_FREE_PREFERRED_MODELS: "qwen/qwen3-coder:free, openai/gpt-oss-120b:free",
    })).toEqual(["qwen/qwen3-coder:free", "openai/gpt-oss-120b:free"]);
  });

  it("cools down failed routes and promotes recent successful routes", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ data: models }), { status: 200 });
    const env = {
      OPENROUTER_FREE_PREFERRED_MODELS: "",
      OPENROUTER_FREE_FAILURE_COOLDOWN_MS: "5000",
    };

    recordOpenRouterFreeRouteOutcome({
      modelId: "cohere/north-mini-code:free",
      ok: false,
      latencyMs: 30_000,
      error: new Error("provider timeout"),
      now: 10_000,
      env,
    });
    recordOpenRouterFreeRouteOutcome({
      modelId: "openai/gpt-oss-120b:free",
      ok: true,
      latencyMs: 2_000,
      now: 10_000,
      env,
    });

    const selected = await selectOpenRouterFreeModels({
      fetchImpl,
      forceRefresh: true,
      mode: "agent",
      env,
      now: 11_000,
    });

    expect(selected.map((model) => model.id)).toEqual([
      "openai/gpt-oss-120b:free",
      "qwen/qwen3-coder:free",
    ]);
    expect(openRouterFreeRouteHealthSnapshot()).toEqual(expect.arrayContaining([
      expect.objectContaining({ modelId: "cohere/north-mini-code:free", consecutiveFailures: 1, cooldownUntil: 15_000 }),
      expect.objectContaining({ modelId: "openai/gpt-oss-120b:free", successes: 1, cooldownUntil: 10_000 }),
    ]));
  });

  it("does not immediately hammer every route when all candidates are cooling down", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ data: models }), { status: 200 });
    const env = { OPENROUTER_FREE_FAILURE_COOLDOWN_MS: "5000", OPENROUTER_FREE_PREFERRED_MODELS: "" };
    for (const modelId of ["cohere/north-mini-code:free", "qwen/qwen3-coder:free", "openai/gpt-oss-120b:free"]) {
      recordOpenRouterFreeRouteOutcome({ modelId, ok: false, latencyMs: 50, error: new Error("503"), now: 10_000, env });
    }

    await expect(selectOpenRouterFreeModels({
      fetchImpl,
      forceRefresh: true,
      mode: "agent",
      env,
      now: 11_000,
    })).rejects.toThrow(/candidates cooling down; retry in 4s/i);
  });

  it("restores recent route health while dropping stale cache entries", () => {
    restoreOpenRouterFreeRouteHealth([
      {
        modelId: "MODEL/FAST:FREE",
        attempts: 2,
        successes: 1,
        consecutiveFailures: 0,
        lastLatencyMs: 1200,
        lastAttemptAt: 99_999_000,
        cooldownUntil: 99_999_000,
      },
      {
        modelId: "model/stale:free",
        attempts: 1,
        successes: 0,
        consecutiveFailures: 1,
        lastLatencyMs: 5000,
        lastAttemptAt: 1,
        cooldownUntil: 10_000,
      },
    ], 100_000_000);

    expect(openRouterFreeRouteHealthSnapshot()).toEqual([
      expect.objectContaining({ modelId: "model/fast:free", attempts: 2, successes: 1 }),
    ]);
  });

  it("fails explicitly when every free-auto candidate is quarantined", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ data: models }), { status: 200 });

    await expect(selectOpenRouterFreeModels({
      fetchImpl,
      forceRefresh: true,
      mode: "agent",
      env: { NODEAGENT_QUARANTINED_PROVIDERS: "openrouter=incident" },
    })).rejects.toThrow(/candidates quarantined/i);
  });

  it("keeps free-auto opt-in instead of hiding it behind generic aliases", () => {
    expect(resolveModelAlias("openrouter")).toBe("z-ai/glm-5.2");
    expect(resolveModelAlias("auto")).toBe("gemini-3.5-flash");
    expect(resolveModelAlias("free")).toBe(OPENROUTER_FREE_AUTO_MODEL);
    expect(resolveModelAlias("free-auto")).toBe(OPENROUTER_FREE_AUTO_MODEL);
    expect(resolveModelAlias("kimi")).toBe("moonshotai/kimi-k2.7-code");
    expect(resolveModelAlias("kimi-free")).toBe("cohere/north-mini-code:free");
    expect(resolveModelAlias("minimax")).toBe("minimax/minimax-m3");
  });

  it("treats discovered slash ids and free-auto as OpenRouter models", () => {
    expect(getProviderForModel(OPENROUTER_FREE_AUTO_MODEL)).toBe("openrouter");
    expect(getProviderForModel("nvidia/nemotron-3-super-120b-a12b:free")).toBe("openrouter");
  });

  it("reports zero cost for free routes", () => {
    expect(priceRun("openrouter/free-auto", 100_000, 10_000)).toBe(0);
    expect(priceRun("qwen/qwen3-coder:free", 100_000, 10_000)).toBe(0);
    expect(priceRun("openrouter/owl-alpha", 100_000, 10_000)).toBe(0);
  });

  it("does not mask aborted discovery as a static fallback", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl: typeof fetch = async () => {
      throw new Error("aborted");
    };

    await expect(discoverOpenRouterFreeModels({
      fetchImpl,
      forceRefresh: true,
      signal: controller.signal,
    })).rejects.toThrow("aborted");
  });
});
