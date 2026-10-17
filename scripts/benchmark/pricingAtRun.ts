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
  contextWindow?: number;
  routeSnapshotId?: string;
};

export type RouteSnapshot = {
  routeSnapshotId: string;
  fetchedAt: string;
  source: "openrouter" | "unavailable";
  modelsById: Map<string, OpenRouterModelInfo>;
  error?: string;
};

export function priceFromOpenRouterInfo(info: OpenRouterModelInfo, routeSnapshotId: string): PricingAtRun | undefined {
  const prompt = Number(info.pricing?.prompt);
  const completion = Number(info.pricing?.completion);
  if (!Number.isFinite(prompt) || !Number.isFinite(completion)) return undefined;
  const cacheRead = Number(info.pricing?.input_cache_read);
  return {
    source: "openrouter_snapshot",
    inputPer1M: prompt * 1_000_000,
    outputPer1M: completion * 1_000_000,
    ...(Number.isFinite(cacheRead) ? { cachedInputPer1M: cacheRead * 1_000_000 } : {}),
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

export function costFromPricing(pricing: PricingAtRun, inputTokens: number, outputTokens: number): number {
  return (inputTokens * pricing.inputPer1M + outputTokens * pricing.outputPer1M) / 1_000_000;
}
