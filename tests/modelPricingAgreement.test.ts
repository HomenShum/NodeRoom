/**
 * Pricing agreement (SPEC Part A rule A.0.6): every pricing source in NodeRoom is loaded and must agree on
 * {inPerM, outPerM} per (id, transport).
 *
 * Pricing sources in this repo (enumerated; each is read below):
 *   1. modelCatalog.modelPricing        - the only hand-typed table (every row added by the refresh carries pricingAsOf)
 *   2. modelCatalog.getModelPricing     - accessor over (1)
 *   3. adapter.priceRun / priceRunStrict - the AI-SDK adapter's cost functions (the ladder meter uses priceRunStrict)
 *   4. convexModel.convexPriceRun       - the Convex-safe model's cost function
 *   5. creditModel.estimateCostFor      - credit estimates (a private priceRun over (1))
 * Other readers (Chat.tsx price chips, scripts/benchmark/run.ts catalogPricingAtRun, proofloopModelTracking) read (1)
 * and have no table of their own. A new hand-typed table must be added here or deleted.
 *
 * Vendor list prices were read 2026-10-10 (model-defaults frontier.json, platform.claude.com + ai.google.dev pricing).
 */
import { describe, expect, it } from "vitest";
import { priceRun, priceRunStrict, UnpricedModelError } from "../src/nodeagent/models/adapter";
import { convexPriceRun } from "../src/nodeagent/models/convexModel";
import { CREDIT_MODE_SPECS, estimateCostFor } from "../src/nodeagent/core/creditModel";
import { getModelPricing, modelPricing } from "../src/nodeagent/models/modelCatalog";

const PRICING_AS_OF = "2026-10-10";

/** (canonical id, wire id per transport) -> vendor list price per 1M tokens. */
const REFRESH_ROWS: Array<{ canonical: string; transport: string; id: string; inPerM: number; outPerM: number }> = [
  { canonical: "claude-haiku-5-5", transport: "anthropic", id: "claude-haiku-5-5", inPerM: 0.10, outPerM: 0.50 }, // <=100K-token tier
  { canonical: "claude-haiku-5-5", transport: "openrouter", id: "anthropic/claude-haiku-5.5", inPerM: 0.10, outPerM: 0.50 },
  { canonical: "claude-sonnet-5-5", transport: "anthropic", id: "claude-sonnet-5-5", inPerM: 2, outPerM: 10 },
  { canonical: "claude-sonnet-5-5", transport: "openrouter", id: "anthropic/claude-sonnet-5.5", inPerM: 2, outPerM: 10 },
  { canonical: "claude-opus-5-5", transport: "anthropic", id: "claude-opus-5-5", inPerM: 4, outPerM: 20 },
  { canonical: "claude-opus-5-5", transport: "openrouter", id: "anthropic/claude-opus-5.5", inPerM: 4, outPerM: 20 },
  // Intro price through 2026-12-31; $1.50 / $7.50 from 2027-01-01 (re-price then: NodeRoom CHANGELOG/server/model-defaults.md).
  { canonical: "gemini-3.8-flash", transport: "google", id: "gemini-3.8-flash", inPerM: 0.75, outPerM: 3.75 },
  { canonical: "gemini-3.6-flash", transport: "google", id: "gemini-3.6-flash", inPerM: 0.75, outPerM: 3.75 },
  { canonical: "gemini-3.5-flash-lite", transport: "google", id: "gemini-3.5-flash-lite", inPerM: 0.30, outPerM: 2.50 },
];

const M = 1_000_000;

describe("pricing sources agree per (id, transport)", () => {
  for (const row of REFRESH_ROWS) {
    it(`${row.canonical} on ${row.transport} (${row.id}) is $${row.inPerM}/$${row.outPerM} in every source`, () => {
      const table = modelPricing[row.id];
      const accessor = getModelPricing(row.id);
      expect(table, "modelPricing row").toBeDefined();
      expect(accessor).toBe(table);
      expect({ inPerM: table.inputPer1M, outPerM: table.outputPer1M }).toEqual({ inPerM: row.inPerM, outPerM: row.outPerM });
      expect(table.pricingAsOf).toBe(PRICING_AS_OF);

      // Cost functions, probed one million tokens at a time so the result IS the per-million price.
      for (const [source, cost] of [["priceRun", priceRun], ["priceRunStrict", priceRunStrict], ["convexPriceRun", convexPriceRun]] as const) {
        expect(cost(row.id, M, 0), `${source} input`).toBeCloseTo(row.inPerM, 9);
        expect(cost(row.id, 0, M), `${source} output`).toBeCloseTo(row.outPerM, 9);
      }
    });
  }

  it("the same model costs the same on its direct and OpenRouter transports", () => {
    const byCanonical = new Map<string, Array<{ inPerM: number; outPerM: number }>>();
    for (const r of REFRESH_ROWS) byCanonical.set(r.canonical, [...(byCanonical.get(r.canonical) ?? []), { inPerM: modelPricing[r.id].inputPer1M, outPerM: modelPricing[r.id].outputPer1M }]);
    for (const [canonical, prices] of byCanonical) {
      for (const p of prices) expect(p, canonical).toEqual(prices[0]);
    }
  });

  it("credit estimates price their model from the same table (creditModel's private priceRun)", () => {
    for (const mode of Object.keys(CREDIT_MODE_SPECS) as Array<keyof typeof CREDIT_MODE_SPECS>) {
      const spec = CREDIT_MODE_SPECS[mode];
      const price = getModelPricing(spec.model);
      expect(price, `${mode} model ${spec.model} must be priced`).not.toBeNull();
      const expected = (spec.inputTokensPerRun * price!.inputPer1M + spec.outputTokensPerRun * price!.outputPer1M) / M;
      expect(estimateCostFor(mode).llmUsd).toBeCloseTo(expected, 3); // creditModel rounds to 4 decimals (round4)
    }
  });

  it("every dated row in the table carries a parseable pricingAsOf", () => {
    for (const [id, row] of Object.entries(modelPricing)) {
      if (row.pricingAsOf !== undefined) expect(Number.isNaN(Date.parse(row.pricingAsOf)), id).toBe(false);
    }
  });

  it("an id with no row is refused by the strict price and guessed only by the legacy ones", () => {
    expect(() => priceRunStrict("gemini-9.9-unpriced-test", 1, 1)).toThrow(UnpricedModelError);
    expect(priceRun("gemini-9.9-unpriced-test", M, 0)).toBe(1); // legacy fallback, kept for unbudgeted callers
  });
});
