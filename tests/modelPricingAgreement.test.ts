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
import { priceRun, priceRunStrict, reserveDispatch, UnpricedModelError } from "../src/nodeagent/models/adapter";
import { convexPriceRun } from "../src/nodeagent/models/convexModel";
import { CREDIT_MODE_SPECS, estimateCostFor } from "../src/nodeagent/core/creditModel";
import { calculateRequestCost, getModelPricing, modelPricing } from "../src/nodeagent/models/modelCatalog";
import { modelMaxOutputTokens } from "../src/nodeagent/models/outputTokens";

const PRICING_AS_OF = "2026-10-10";

/** (canonical id, wire id per transport) -> vendor list price per 1M tokens. */
type RefreshRow = {
  canonical: string; transport: string; id: string; inPerM: number; outPerM: number;
  /** Rates for a prompt above `aboveInputTokens` (SPEC §1.3: claude-haiku-5-5 is $0.50/$2.50 above 100K). */
  longContext?: { aboveInputTokens: number; inPerM: number; outPerM: number };
};
const HAIKU_LONG = { aboveInputTokens: 100_000, inPerM: 0.50, outPerM: 2.50 };
const REFRESH_ROWS: RefreshRow[] = [
  { canonical: "claude-haiku-5-5", transport: "anthropic", id: "claude-haiku-5-5", inPerM: 0.10, outPerM: 0.50, longContext: HAIKU_LONG }, // <=100K-token tier
  { canonical: "claude-haiku-5-5", transport: "openrouter", id: "anthropic/claude-haiku-5.5", inPerM: 0.10, outPerM: 0.50, longContext: HAIKU_LONG },
  { canonical: "claude-sonnet-5-5", transport: "anthropic", id: "claude-sonnet-5-5", inPerM: 2, outPerM: 10 },
  { canonical: "claude-sonnet-5-5", transport: "openrouter", id: "anthropic/claude-sonnet-5.5", inPerM: 2, outPerM: 10 },
  { canonical: "claude-opus-5-5", transport: "anthropic", id: "claude-opus-5-5", inPerM: 4, outPerM: 20 },
  { canonical: "claude-opus-5-5", transport: "openrouter", id: "anthropic/claude-opus-5.5", inPerM: 4, outPerM: 20 },
  // Intro price through 2026-12-31; $1.50 / $7.50 from 2027-01-01 (re-price then: NodeRoom CHANGELOG/server/model-defaults.md).
  { canonical: "gemini-3.8-flash", transport: "google", id: "gemini-3.8-flash", inPerM: 0.75, outPerM: 3.75 },
  { canonical: "gemini-3.6-flash", transport: "google", id: "gemini-3.6-flash", inPerM: 0.75, outPerM: 3.75 },
  { canonical: "gemini-3.5-flash-lite", transport: "google", id: "gemini-3.5-flash-lite", inPerM: 0.30, outPerM: 2.50 },
  // The id claude-opus-4.7 now resolves to (it used to be rewritten to 4-8); frontier.json + pi-ai catalog agree on $5/$25.
  { canonical: "claude-opus-4-7", transport: "anthropic", id: "claude-opus-4-7", inPerM: 5, outPerM: 25 },
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
      expect(table.longContext && { aboveInputTokens: table.longContext.aboveInputTokens, inPerM: table.longContext.inputPer1M, outPerM: table.longContext.outputPer1M }).toEqual(row.longContext);

      // Cost functions, probed at the base tier: 100K prompt tokens (the tier edge itself) or 100K output tokens,
      // scaled to per-million, so the result IS the base per-million price whether or not the row is tiered.
      const P = 100_000;
      for (const [source, cost] of [["priceRun", priceRun], ["priceRunStrict", priceRunStrict], ["convexPriceRun", convexPriceRun]] as const) {
        expect(cost(row.id, P, 0) * (M / P), `${source} input`).toBeCloseTo(row.inPerM, 9);
        expect(cost(row.id, 0, M), `${source} output`).toBeCloseTo(row.outPerM, 9);
      }
    });

    if (row.longContext) {
      const tier = row.longContext;
      it(`${row.id} bills a prompt above ${tier.aboveInputTokens} tokens at $${tier.inPerM}/$${tier.outPerM} in every cost and reservation path`, () => {
        const above = tier.aboveInputTokens + 1;
        const out = 1_000;
        const expectedLong = (above * tier.inPerM + out * tier.outPerM) / M;
        const expectedBase = (tier.aboveInputTokens * row.inPerM + out * row.outPerM) / M;
        for (const [source, cost] of [["priceRun", priceRun], ["priceRunStrict", priceRunStrict], ["convexPriceRun", convexPriceRun], ["calculateRequestCost", calculateRequestCost]] as const) {
          expect(cost(row.id, above, out), `${source} above the edge`).toBeCloseTo(expectedLong, 12);
          expect(cost(row.id, tier.aboveInputTokens, out), `${source} at the edge (the lower tier includes it)`).toBeCloseTo(expectedBase, 12);
        }
        // Reservation: the review's case, 120K prompt + the 8192-token cap, must reserve $0.08048, not $0.016096.
        const cap = modelMaxOutputTokens(row.id);
        const reserve = reserveDispatch(row.id, 120_000, Number.POSITIVE_INFINITY);
        expect(reserve).toBeCloseTo((120_000 * tier.inPerM + cap * tier.outPerM) / M, 12);
        if (row.id === "claude-haiku-5-5") expect(reserve).toBeCloseTo(0.08048, 9);
      });
    }
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
