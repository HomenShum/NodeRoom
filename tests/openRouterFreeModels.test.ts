import { describe, expect, it } from "vitest";
import { priceRun } from "../src/nodeagent/models/adapter";
import { getProviderForModel, resolveModelAlias } from "../src/nodeagent/models/modelCatalog";
import {
  OPENROUTER_FREE_AUTO_MODEL,
  discoverOpenRouterFreeModels,
  isFreeTextModel,
  rankOpenRouterFreeModels,
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
  it("filters to zero-priced text models", () => {
    expect(isFreeTextModel(models[0])).toBe(true);
    expect(isFreeTextModel(models[3])).toBe(false);
  });

  it("ranks tool-capable free models by capability signals", () => {
    const ranked = rankOpenRouterFreeModels(models, "agent");
    expect(ranked.map((m) => m.id)).toEqual(["qwen/qwen3-coder:free", "openai/gpt-oss-120b:free"]);
    expect(ranked[0].reasons).toContain("coding/agent specialist");
  });

  it("skips operator-quarantined free-auto candidates before routing", async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ data: models }), { status: 200 });

    const selected = await selectOpenRouterFreeModels({
      fetchImpl,
      forceRefresh: true,
      mode: "agent",
      env: { NODEAGENT_QUARANTINED_MODELS: "qwen/qwen3-coder:free=rate_limited" },
    });

    expect(selected.map((m) => m.id)).toEqual(["openai/gpt-oss-120b:free"]);
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
    expect(resolveModelAlias("openrouter")).toBe("moonshotai/kimi-k2.6");
    expect(resolveModelAlias("auto")).toBe("gemini-3.5-flash");
    expect(resolveModelAlias("free")).toBe(OPENROUTER_FREE_AUTO_MODEL);
    expect(resolveModelAlias("free-auto")).toBe(OPENROUTER_FREE_AUTO_MODEL);
    expect(resolveModelAlias("kimi")).toBe("moonshotai/kimi-k2.6:free");
    expect(resolveModelAlias("minimax-m2.7")).toBe("minimax/minimax-m2.7");
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
