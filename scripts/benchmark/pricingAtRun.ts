/**
 * Pricing the benchmark records on every row (`pricingAtRun`). The OpenRouter /models snapshot of the run wins
 * (dated by `fetchedAt` + `routeSnapshotId`); the catalog row is the fallback; a flagged $1/$5 `fallback_estimate`
 * is the last resort. Split out of run.ts, which runs the benchmark on import, so the pricing agreement test
 * (SPEC A.0.6) can load these paths.
 */
import { getModelPricing, lookupModelAlias, type ModelPricing } from "../../src/nodeagent/models/modelCatalog";
import type { OpenRouterModelInfo } from "../../src/nodeagent/models/openRouterFreeModels";

export type PricingAtRun = {
  source: "openrouter_snapshot" | "catalog" | "fallback_estimate";
  inputPer1M: number;
  outputPer1M: number;
  cachedInputPer1M?: number;
  /** Prompt-size tiers from the snapshot's `pricing.overrides` (OpenRouter: applies when the prompt is strictly above the threshold). */
  promptTiers?: PromptTier[];
  contextWindow?: number;
  routeSnapshotId?: string;
};

export type PromptTier = { aboveInputTokens: number; inputPer1M: number; outputPer1M: number; cachedInputPer1M?: number };

export type RouteSnapshot = {
  routeSnapshotId: string;
  fetchedAt: string;
  source: "openrouter" | "unavailable";
  modelsById: Map<string, OpenRouterModelInfo>;
  error?: string;
};

// A token-count override (`min_prompt_tokens`, no clock window) is a prompt-size tier. Time-window overrides are already
// reflected in the top-level rates "that apply right now" (OpenRouter models API), so they are not tiers.
export function promptTiersOf(pricing: object | undefined): PromptTier[] {
  const p = (pricing ?? {}) as Record<string, unknown>;
  const per1M = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) && v !== undefined && v !== null ? Number((Number(v) * 1_000_000).toPrecision(12)) : fallback);
  const prompt = Number((Number(p.prompt) * 1_000_000).toPrecision(12));
  const completion = Number((Number(p.completion) * 1_000_000).toPrecision(12));
  const cacheRead = Number((Number(p.input_cache_read) * 1_000_000).toPrecision(12));
  // The typed pricing is string rates; `overrides` is the one array in the served object.
  const raw = p.overrides;
  const overrides: Array<Record<string, unknown>> = Array.isArray(raw) ? raw : [];
  return overrides
    .filter((o) => o && typeof o === "object" && Number.isFinite(Number(o.min_prompt_tokens)) && o.utc_start === undefined && o.utc_end === undefined && o.utc_days === undefined)
    .map((o) => {
      const cached = per1M(o.input_cache_read, cacheRead);
      return {
        aboveInputTokens: Number(o.min_prompt_tokens),
        inputPer1M: per1M(o.prompt, prompt),
        outputPer1M: per1M(o.completion, completion),
        ...(Number.isFinite(cached) ? { cachedInputPer1M: cached } : {}),
      };
    })
    .sort((a, b) => a.aboveInputTokens - b.aboveInputTokens);
}

export function priceFromOpenRouterInfo(info: OpenRouterModelInfo, routeSnapshotId: string): PricingAtRun | undefined {
  const prompt = Number(info.pricing?.prompt);
  const completion = Number(info.pricing?.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return undefined;
  const cacheRead = Number(info.pricing?.input_cache_read);
  const tiers = promptTiersOf(info.pricing);
  return {
    source: "openrouter_snapshot",
    inputPer1M: prompt * 1_000_000,
    outputPer1M: completion * 1_000_000,
    ...(Number.isFinite(cacheRead) ? { cachedInputPer1M: cacheRead * 1_000_000 } : {}),
    ...(tiers.length ? { promptTiers: tiers } : {}),
    contextWindow: info.context_length ?? info.top_provider?.context_length,
    routeSnapshotId,
  };
}

export function catalogPricingAtRun(modelId: string): PricingAtRun {
  const pricing: ModelPricing | null = getModelPricing(lookupModelAlias(modelId));
  if (!pricing) {
    return {
      source: "fallback_estimate",
      inputPer1M: 1,
      outputPer1M: 5,
    };
  }
  return {
    source: "catalog",
    inputPer1M: pricing.inputPer1M,
    outputPer1M: pricing.outputPer1M,
    ...(pricing.cachedInputPer1M != null ? { cachedInputPer1M: pricing.cachedInputPer1M } : {}),
    contextWindow: pricing.contextWindow,
  };
}

export function pricingAtRunFor(modelId: string, snapshot?: RouteSnapshot): PricingAtRun {
  const resolved = lookupModelAlias(modelId);
  const fromSnapshot = snapshot?.modelsById.get(resolved);
  if (snapshot && fromSnapshot) return priceFromOpenRouterInfo(fromSnapshot, snapshot.routeSnapshotId) ?? catalogPricingAtRun(resolved);
  return catalogPricingAtRun(resolved);
}

/** Usage SUMMED over several requests, at base rates: a floor, since a total cannot say which prompts crossed a tier. */
export function costFromPricing(pricing: PricingAtRun, inputTokens: number, outputTokens: number): number {
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}

/** ONE request, billed at the snapshot's tier for this request's own prompt (uncached input, like `priceRequest`). */
export function costForRequest(pricing: PricingAtRun, inputTokens: number, outputTokens: number): number {
  const tier = pricing.promptTiers?.filter((t) => inputTokens > t.aboveInputTokens).at(-1) ?? pricing;
  return (inputTokens * tier.inputPer1M + outputTokens * tier.outputPer1M) / 1_000_000;
}
