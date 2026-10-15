import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeInteropModelRoute } from "../src/nodeagent/integrations/modelInterop";
import { DEFAULT_AGENT_MODEL } from "../convex/modelDefaults";
import {
  getProviderForModel,
  NODEAGENT_FREE_AUTO_MODEL,
  resolveModelAlias,
} from "../src/nodeagent/models/modelCatalog";
import {
  recordOpenRouterFreeRouteOutcome,
  resetOpenRouterFreeRouteHealth,
} from "../src/nodeagent/models/openRouterFreeModels";
import { QualityFailoverError } from "../src/nodeagent/models/qualityFailover";

const generateTextMock = vi.hoisted(() => vi.fn());

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

const OPENROUTER_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";
// The direct-Google fallback id is the default-model constant (was the literal "gemini-3.5-flash", deprecated 2026-10-08).
const GOOGLE_MODEL = DEFAULT_AGENT_MODEL;
const ROUTING_ENV = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_FREE_MODEL_CACHE_MS",
  "OPENROUTER_FREE_AUTO_LIMIT",
  "OPENROUTER_FREE_CANDIDATE_RETRIES",
  "OPENROUTER_FREE_CANDIDATE_TIMEOUT_MS",
  "OPENROUTER_FREE_REQUEST_TIMEOUT_MS",
  "OPENROUTER_FREE_REQUEST_RESERVE_MS",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "NODEAGENT_FREE_AUTO_GOOGLE_MODEL",
  "NODEAGENT_ALLOWED_PROVIDERS",
  "PROVIDER_EGRESS_ALLOWED_PROVIDERS",
  "PROVIDER_EGRESS_REQUIRE_ALLOWLIST",
  "NODEROOM_PRODUCTION",
] as const;

function clearRoutingEnv() {
  for (const name of ROUTING_ENV) delete process.env[name];
}

function successfulTurn(modelId: string) {
  return {
    text: JSON.stringify({ selectedModel: modelId }),
    toolCalls: [] as Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }>,
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

/**
 * The paid Gemini leg is a free -> paid fallback (SPEC A.0.10): it needs an explicit allowPaidFallback AND a meter to
 * reserve against. Every test below that expects the leg to run authorizes it; the default-policy test refuses it.
 */
async function runNeutralRoute() {
  const { createSpendMeter, model } = await import("../src/nodeagent/models/adapter");
  const route = model(NODEAGENT_FREE_AUTO_MODEL, {
    freeAutoMode: "structured",
    entrypoint: "system",
    dispatch: { maxRetries: 3, crossModelFallback: true, allowPaidFallback: true },
    meter: createSpendMeter(1),
  });
  const step = await route.next({
    system: "Return JSON only.",
    messages: [{ role: "user", content: "emit a structured edit plan" }],
    tools: [],
  });
  return { route, step };
}

describe("provider-neutral NodeAgent free-first routing", () => {
  beforeEach(() => {
    clearRoutingEnv();
    generateTextMock.mockReset();
    generateTextMock.mockImplementation(async (options: { model: { id: string } }) => successfulTurn(options.model.id));
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_FREE_MODEL_CACHE_MS = "0";
    process.env.OPENROUTER_FREE_AUTO_LIMIT = "1";
    process.env.OPENROUTER_FREE_CANDIDATE_RETRIES = "0";
    process.env.OPENROUTER_FREE_CANDIDATE_TIMEOUT_MS = "5000";
    process.env.OPENROUTER_FREE_REQUEST_TIMEOUT_MS = "90000";
    process.env.OPENROUTER_FREE_REQUEST_RESERVE_MS = "5000";
    resetOpenRouterFreeRouteHealth();
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({
      data: [{
        id: OPENROUTER_MODEL,
        pricing: { prompt: "0", completion: "0", request: "0" },
        context_length: 1_000_000,
        supported_parameters: ["max_tokens", "response_format", "structured_outputs", "tool_choice", "tools"],
      }],
    }), { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearRoutingEnv();
    resetOpenRouterFreeRouteHealth();
  });

  it("uses the governed OpenRouter free ladder first and preserves concrete identity", async () => {
    const { route, step } = await runNeutralRoute();

    expect(generateTextMock.mock.calls.map((call) => call[0].model)).toEqual([
      { provider: "openrouter", id: OPENROUTER_MODEL },
    ]);
    expect(route.name).toBe(OPENROUTER_MODEL);
    expect(step.providerRoute).toMatchObject({
      requestedModel: NODEAGENT_FREE_AUTO_MODEL,
      resolvedModel: OPENROUTER_MODEL,
      provider: "openrouter",
      providerNeutral: {
        policy: "nodeagent_provider_neutral_free_first_v1",
        primary: { route: "openrouter/free-auto", outcome: "accepted" },
        selected: {
          route: "openrouter_free",
          model: OPENROUTER_MODEL,
          provider: "openrouter",
          billing: { free: true, classification: "openrouter_zero_price_route" },
        },
      },
      qualityFailover: { status: "succeeded", selectedRouteId: OPENROUTER_MODEL },
    });
  });

  it("falls back to direct Gemini only after provider-wide OpenRouter quota exhaustion", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
    generateTextMock
      .mockRejectedValueOnce(new Error("AI_RetryError: Failed after 3 attempts. Last error: Rate limit exceeded: free-models-per-day-high-balance."))
      .mockImplementationOnce(async (options: { model: { id: string } }) => successfulTurn(options.model.id));

    const { route, step } = await runNeutralRoute();

    expect(generateTextMock.mock.calls.map((call) => call[0].model)).toEqual([
      { provider: "openrouter", id: OPENROUTER_MODEL },
      { provider: "google", id: GOOGLE_MODEL },
    ]);
    expect(route.name).toBe(GOOGLE_MODEL);
    expect(step.providerRoute).toMatchObject({
      requestedModel: NODEAGENT_FREE_AUTO_MODEL,
      resolvedModel: GOOGLE_MODEL,
      provider: "gemini",
      providerNeutral: {
        primary: {
          route: "openrouter/free-auto",
          outcome: "provider_wide_exhausted",
          reason: "provider_quota_exhausted",
          qualityFailover: {
            stopReason: "global_provider_failure",
            terminalFailure: { providerFailureScope: "global", providerFailureCategory: "quota" },
          },
        },
        selected: {
          route: "google_direct",
          model: GOOGLE_MODEL,
          provider: "gemini",
          billing: {
            free: false,
            classification: "catalog_priced",
            // gemini-3.8-flash vendor list price, read 2026-10-10 (SPEC A.2.9 R-row; pricingAsOf in modelCatalog).
            // Was 1.5 / 9 for the deprecated gemini-3.5-flash.
            inputPer1M: 0.75,
            outputPer1M: 3.75,
          },
        },
      },
    });
    expect(step.providerRoute?.basis).toContain("billing:account_free_tier:not_asserted");
  });

  it("never dispatches paid Gemini under the default policy: no allowPaidFallback and no meter, so the free failure is the answer", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
    generateTextMock.mockRejectedValue(new Error("AI_RetryError: Failed after 3 attempts. Last error: Rate limit exceeded: free-models-per-day-high-balance."));
    const { createSpendMeter, model } = await import("../src/nodeagent/models/adapter");
    // The first failure cools the free route, so later attempts see the cooldown instead of the quota error: both are the free route's own failure.
    const FREE_FAILURE = /Rate limit exceeded|candidates cooling down/;
    const turn = { system: "Return JSON only.", messages: [{ role: "user" as const, content: "emit a structured edit plan" }], tools: [] };

    // Default dispatch policy (3 retries, cross-model fallback allowed) - what every unconfigured caller gets.
    await expect(model(NODEAGENT_FREE_AUTO_MODEL, { freeAutoMode: "structured", entrypoint: "system" }).next(turn)).rejects.toThrow(FREE_FAILURE);
    // Authorization without a reservation is not enough either, nor a meter without authorization.
    await expect(model(NODEAGENT_FREE_AUTO_MODEL, { freeAutoMode: "structured", entrypoint: "system", dispatch: { maxRetries: 3, crossModelFallback: true, allowPaidFallback: true } }).next(turn)).rejects.toThrow(FREE_FAILURE);
    await expect(model(NODEAGENT_FREE_AUTO_MODEL, { freeAutoMode: "structured", entrypoint: "system", meter: createSpendMeter(1) }).next(turn)).rejects.toThrow(FREE_FAILURE);

    const dispatched = generateTextMock.mock.calls.map((call) => call[0].model.provider);
    expect(dispatched.length).toBeGreaterThan(0);
    expect(dispatched.every((provider) => provider === "openrouter"), `no paid request was made: ${dispatched.join(",")}`).toBe(true);
  });

  it("never falls back to paid Gemini when the dispatch policy forbids cross-model fallback", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
    generateTextMock.mockRejectedValue(new Error("AI_RetryError: Failed after 3 attempts. Last error: Rate limit exceeded: free-models-per-day-high-balance."));
    const { model } = await import("../src/nodeagent/models/adapter");
    // The same quota exhaustion as above, but under the ladder receipt policy: the free route's failure is the answer.
    const route = model(NODEAGENT_FREE_AUTO_MODEL, { freeAutoMode: "structured", entrypoint: "system", dispatch: { maxRetries: 0, crossModelFallback: false } });

    await expect(route.next({ system: "Return JSON only.", messages: [{ role: "user", content: "emit a structured edit plan" }], tools: [] })).rejects.toThrow(/Rate limit exceeded/);
    expect(generateTextMock.mock.calls.map((call) => call[0].model)).toEqual([{ provider: "openrouter", id: OPENROUTER_MODEL }]);
  });

  it("falls back to direct Gemini when every governed free route is cooling", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
    recordOpenRouterFreeRouteOutcome({
      modelId: OPENROUTER_MODEL,
      ok: false,
      latencyMs: 1_000,
      error: new Error("provider route unavailable"),
    });

    const { route, step } = await runNeutralRoute();

    expect(generateTextMock.mock.calls.map((call) => call[0].model)).toEqual([
      { provider: "google", id: GOOGLE_MODEL },
    ]);
    expect(route.name).toBe(GOOGLE_MODEL);
    expect(step.providerRoute).toMatchObject({
      requestedModel: NODEAGENT_FREE_AUTO_MODEL,
      resolvedModel: GOOGLE_MODEL,
      provider: "gemini",
      providerNeutral: {
        primary: {
          route: "openrouter/free-auto",
          outcome: "free_routes_cooling",
          reason: "provider_free_routes_cooling",
        },
        selected: {
          route: "google_direct",
          model: GOOGLE_MODEL,
          billing: { free: false, classification: "catalog_priced" },
        },
      },
    });
  });

  it("falls back after the governed free ladder exhausts candidate-scoped failures", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
    generateTextMock
      .mockRejectedValueOnce(new Error("Provider request failed 503: route unavailable"))
      .mockImplementationOnce(async (options: { model: { id: string } }) => successfulTurn(options.model.id));

    const { route, step } = await runNeutralRoute();

    expect(generateTextMock.mock.calls.map((call) => call[0].model)).toEqual([
      { provider: "openrouter", id: OPENROUTER_MODEL },
      { provider: "google", id: GOOGLE_MODEL },
    ]);
    expect(route.name).toBe(GOOGLE_MODEL);
    expect(step.providerRoute).toMatchObject({
      providerNeutral: {
        primary: {
          outcome: "free_routes_exhausted",
          reason: "provider_free_routes_candidates_exhausted",
          qualityFailover: { stopReason: "candidates_exhausted" },
        },
        selected: { route: "google_direct", model: GOOGLE_MODEL },
      },
    });
  });

  it("does not cross providers for a global authentication boundary", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
    generateTextMock.mockRejectedValueOnce(new Error("Provider request failed 401: Unauthorized"));

    const error = await runNeutralRoute().then(() => undefined, (failure: unknown) => failure);

    expect(error).toBeInstanceOf(QualityFailoverError);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
    expect(generateTextMock.mock.calls[0]?.[0].model).toEqual({ provider: "openrouter", id: OPENROUTER_MODEL });
  });

  it("does not call Google when its credential is missing", async () => {
    generateTextMock.mockRejectedValueOnce(new Error("Provider request failed 429: free-models-per-day-high-balance"));

    const error = await runNeutralRoute().then(() => undefined, (failure: unknown) => failure);

    expect(error).toBeInstanceOf(QualityFailoverError);
    expect(String((error as Error).message)).toContain("GOOGLE_GENERATIVE_AI_API_KEY is not configured");
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("checks provider policy before calling the configured Google fallback", async () => {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-google-key";
    process.env.NODEAGENT_ALLOWED_PROVIDERS = "openrouter";
    generateTextMock.mockRejectedValueOnce(new Error("Provider request failed 429: free-models-per-day-high-balance"));

    const error = await runNeutralRoute().then(() => undefined, (failure: unknown) => failure);

    expect(error).toBeInstanceOf(QualityFailoverError);
    expect(String((error as Error).message)).toContain("provider_route_blocked:provider_not_allowed");
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes the logical alias without mislabeling it as OpenRouter", () => {
    expect(resolveModelAlias("nodeagent-free-auto")).toBe(NODEAGENT_FREE_AUTO_MODEL);
    expect(getProviderForModel(NODEAGENT_FREE_AUTO_MODEL)).toBeNull();
    expect(normalizeInteropModelRoute("nodeagent-free-auto")).toMatchObject({
      modelId: NODEAGENT_FREE_AUTO_MODEL,
      provider: "nodeagent",
      runtime: "native",
      routePolicy: "proxy",
    });
  });
});
