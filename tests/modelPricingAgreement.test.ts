/**
 * Pricing agreement (SPEC Part A rule A.0.6): every pricing source in NodeRoom is loaded and must agree on
 * {inPerM, outPerM} per (id, transport).
 *
 * Pricing sources in this repo (enumerated; each is read below or excluded with its reason):
 *   1. modelCatalog.modelPricing          - the only hand-typed table (every row added by the refresh carries pricingAsOf)
 *   2. modelCatalog.getModelPricing       - accessor over (1)
 *   3. adapter.priceRun / priceRequest / priceRequestStrict - the AI-SDK adapter's cost functions. `priceRun` prices usage
 *      SUMMED over requests (base tier only); `priceRequest*` price ONE request (tier-aware); the ladder meter uses
 *      priceRequestStrict
 *   4. convexModel.convexPriceRun / convexPriceRequest - the Convex-safe model's aggregate and per-request cost functions
 *   5. creditModel.estimateCostFor        - credit estimates (a private priceRun over (1), aggregate)
 *   6. proofloopModelTracking             - estimateModelCostUsd over (1), aggregate
 *   7. scripts/benchmark/run.ts           - pricingAtRunFor PREFERS the OpenRouter /models snapshot (priceFromOpenRouterInfo,
 *      dated by that run's `fetchedAt` + `routeSnapshotId`, recorded on every row's pricingAtRun) and falls back to (1)
 *      (catalogPricingAtRun) or a flagged $1/$5 `fallback_estimate`
 *   8. scripts/proofloop-proxy-model-sweep.ts - prices from the live OpenRouter /models catalog fetched when the sweep
 *      runs (dated `fetchedAt` per row); it has no fallback table
 * Sources 7 and 8 own no table, but their per-token -> per-1M CONVERSION is code that can disagree with (1) (a x1e5 for
 * a x1e6 is a tenfold undercharge), so both run on a dated OpenRouter /models fixture below and must produce the
 * catalog's {inPerM, outPerM} for every OpenRouter-transport row. 7 is loaded through scripts/benchmark/pricingAtRun.ts
 * (split out of run.ts, which runs the benchmark on import); 8 runs as the script itself in --dry-run.
 * Chat.tsx price chips read (1). A new hand-typed table must be added here or deleted.
 *
 * Vendor list prices were read 2026-10-10 (model-defaults frontier.json, platform.claude.com + ai.google.dev pricing).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { priceRequest, priceRequestStrict, priceRun, reserveDispatch, UnpricedModelError } from "../src/nodeagent/models/adapter";
import { convexPriceRequest, convexPriceRun } from "../src/nodeagent/models/convexModel";
import { CREDIT_MODE_SPECS, estimateCostFor } from "../src/nodeagent/core/creditModel";
import { calculateRequestCost, getModelPricing, modelPricing } from "../src/nodeagent/models/modelCatalog";
import { modelMaxOutputTokens } from "../src/nodeagent/models/outputTokens";
import { proofloopModelCostFieldsForRun } from "../src/eval/proofloopModelTracking";
import { catalogPricingAtRun, pricingAtRunFor, type RouteSnapshot } from "../scripts/benchmark/pricingAtRun";

const PRICING_AS_OF = "2026-10-10";

/** (canonical id, wire id per transport) -> vendor list price per 1M tokens. */
type RefreshRow = {
  canonical: string; transport: string; id: string; inPerM: number; outPerM: number;
  /** Cache-read rate of the row's own tier (vendor page: Haiku 5.5 "Cache read $0.01 / $0.05"); `null` = the vendor page lists none, so the row must carry none. */
  cachedInPerM?: number | null;
  /** Rates for a prompt above `aboveInputTokens` (SPEC §1.3: claude-haiku-5-5 is $0.50/$2.50 above 100K). */
  longContext?: { aboveInputTokens: number; inPerM: number; outPerM: number; cachedInPerM?: number };
};
const HAIKU_LONG = { aboveInputTokens: 100_000, inPerM: 0.50, outPerM: 2.50, cachedInPerM: 0.05 };
const REFRESH_ROWS: RefreshRow[] = [
  { canonical: "claude-haiku-5-5", transport: "anthropic", id: "claude-haiku-5-5", inPerM: 0.10, outPerM: 0.50, cachedInPerM: 0.01, longContext: HAIKU_LONG }, // <=100K-token tier
  { canonical: "claude-haiku-5-5", transport: "openrouter", id: "anthropic/claude-haiku-5.5", inPerM: 0.10, outPerM: 0.50, cachedInPerM: 0.01, longContext: HAIKU_LONG },
  { canonical: "claude-sonnet-5-5", transport: "anthropic", id: "claude-sonnet-5-5", inPerM: 2, outPerM: 10, cachedInPerM: 0.10 }, // frontier.json "cache read $0.10"
  { canonical: "claude-sonnet-5-5", transport: "openrouter", id: "anthropic/claude-sonnet-5.5", inPerM: 2, outPerM: 10 },
  { canonical: "claude-opus-5-5", transport: "anthropic", id: "claude-opus-5-5", inPerM: 4, outPerM: 20, cachedInPerM: 0.20 }, // frontier.json "cache read $0.20"
  { canonical: "claude-opus-5-5", transport: "openrouter", id: "anthropic/claude-opus-5.5", inPerM: 4, outPerM: 20 },
  // Intro price through 2026-12-31; $1.50 / $7.50 from 2027-01-01 (re-price then: NodeRoom CHANGELOG/server/model-defaults.md).
  { canonical: "gemini-3.8-flash", transport: "google", id: "gemini-3.8-flash", inPerM: 0.75, outPerM: 3.75, cachedInPerM: 0.075 },
  { canonical: "gemini-3.6-flash", transport: "google", id: "gemini-3.6-flash", inPerM: 0.75, outPerM: 3.75 },
  { canonical: "gemini-3.5-flash-lite", transport: "google", id: "gemini-3.5-flash-lite", inPerM: 0.30, outPerM: 2.50, cachedInPerM: 0.03 },
  // The id claude-opus-4.7 now resolves to (it used to be rewritten to 4-8). frontier.json lists only "$5 in / $25 out": no cached rate.
  { canonical: "claude-opus-4-7", transport: "anthropic", id: "claude-opus-4-7", inPerM: 5, outPerM: 25, cachedInPerM: null },
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
      expect(table.longContext && { aboveInputTokens: table.longContext.aboveInputTokens, inPerM: table.longContext.inputPer1M, outPerM: table.longContext.outputPer1M, cachedInPerM: table.longContext.cachedInputPer1M }).toEqual(row.longContext);
      if (row.cachedInPerM === null) expect(table.cachedInputPer1M, "the vendor page lists no cache-read rate").toBeUndefined();
      else if (row.cachedInPerM !== undefined) expect(table.cachedInputPer1M, "cache-read rate of the row's own tier").toBe(row.cachedInPerM);

      // Cost functions, probed at the base tier: 100K prompt tokens (the tier edge itself) or 100K output tokens,
      // scaled to per-million, so the result IS the base per-million price whether or not the row is tiered.
      const P = 100_000;
      for (const [source, cost] of [["priceRun", priceRun], ["priceRequest", priceRequest], ["priceRequestStrict", priceRequestStrict], ["convexPriceRun", convexPriceRun], ["convexPriceRequest", convexPriceRequest]] as const) {
        expect(cost(row.id, P, 0) * (M / P), `${source} input`).toBeCloseTo(row.inPerM, 9);
        expect(cost(row.id, 0, M), `${source} output`).toBeCloseTo(row.outPerM, 9);
      }
      // Source 6 (proofloopModelTracking.estimateModelCostUsd, private) is reached through the exported cost-fields function with
      // no reported cost: 100K in + 1M out must cost (100K x in + 1M x out) / 1M from the same row, aggregate (base tier).
      const fields = proofloopModelCostFieldsForRun({ modelId: row.id, tokensIn: P, tokensOut: M });
      expect(fields.costAccounting.source, `${row.id} proofloop estimate source`).toBe("catalog_estimate");
      expect(fields.costUsd, "proofloopModelTracking").toBeCloseTo((P * row.inPerM + M * row.outPerM) / M, 7); // the source rounds to 8 decimals
    });

    if (row.longContext) {
      const tier = row.longContext;
      it(`${row.id} bills a prompt above ${tier.aboveInputTokens} tokens at $${tier.inPerM}/$${tier.outPerM} in every cost and reservation path`, () => {
        const above = tier.aboveInputTokens + 1;
        const out = 1_000;
        const expectedLong = (above * tier.inPerM + out * tier.outPerM) / M;
        const expectedBase = (tier.aboveInputTokens * row.inPerM + out * row.outPerM) / M;
        // Per-REQUEST prices (a prompt above the edge is one request's prompt): the tier applies.
        for (const [source, cost] of [["priceRequest", priceRequest], ["priceRequestStrict", priceRequestStrict], ["convexPriceRequest", convexPriceRequest], ["calculateRequestCost", calculateRequestCost]] as const) {
          expect(cost(row.id, above, out), `${source} above the edge`).toBeCloseTo(expectedLong, 12);
          expect(cost(row.id, tier.aboveInputTokens, out), `${source} at the edge (the lower tier includes it)`).toBeCloseTo(expectedBase, 12);
        }
        // Per-AGGREGATE prices: usage summed over requests has no single prompt, so no tier is ever inferred from it.
        const expectedFlat = (above * row.inPerM + out * row.outPerM) / M;
        for (const [source, cost] of [["priceRun", priceRun], ["convexPriceRun", convexPriceRun]] as const) {
          expect(cost(row.id, above, out), `${source} on summed usage`).toBeCloseTo(expectedFlat, 12);
        }
        expect(proofloopModelCostFieldsForRun({ modelId: row.id, tokensIn: above, tokensOut: out }).costUsd, "proofloopModelTracking on summed usage").toBeCloseTo(expectedFlat, 7);
        // Cache reads above the edge bill at the tier's own cache-read rate (was the tier INPUT rate: $0.50/M, not $0.05/M).
        if (tier.cachedInPerM !== undefined) {
          expect(calculateRequestCost(row.id, above, 0, true), "cached tokens above the edge").toBeCloseTo((above * tier.cachedInPerM) / M, 12);
          expect(calculateRequestCost(row.id, tier.aboveInputTokens, 0, true), "cached tokens at the edge").toBeCloseTo((tier.aboveInputTokens * (row.cachedInPerM ?? 0)) / M, 12);
        }
        // Reservation: the review's case, 120K prompt + the 8192-token cap, must reserve $0.08048, not $0.016096.
        const cap = modelMaxOutputTokens(row.id);
        const reserve = reserveDispatch(row.id, 120_000, Number.POSITIVE_INFINITY);
        expect(reserve).toBeCloseTo((120_000 * tier.inPerM + cap * tier.outPerM) / M, 12);
        if (row.id === "claude-haiku-5-5") expect(reserve).toBeCloseTo(0.08048, 9);
      });
    }
  }

  it("two sub-100K requests whose prompts sum past 100K cost the sum of two base-tier requests, not one long-context request", () => {
    // Review case: priceRun("claude-haiku-5-5", 120000, 2000) used to be $0.065 (tiered on the SUM) while the two settled
    // 60K/1K requests cost $0.013 (5x overstatement).
    const id = "claude-haiku-5-5";
    const perRequest = priceRequest(id, 60_000, 1_000);
    expect(perRequest).toBeCloseTo((60_000 * 0.10 + 1_000 * 0.50) / M, 12);
    expect(2 * perRequest).toBeCloseTo(0.013, 9);
    expect(convexPriceRequest(id, 60_000, 1_000) * 2).toBeCloseTo(0.013, 9);
    for (const [source, cost] of [["priceRun", priceRun], ["convexPriceRun", convexPriceRun]] as const) {
      expect(cost(id, 120_000, 2_000), `${source} on the summed usage`).toBeCloseTo(2 * perRequest, 12);
    }
    // One genuine 120K request is still billed at the tier.
    expect(priceRequest(id, 120_000, 2_000)).toBeCloseTo((120_000 * 0.50 + 2_000 * 2.50) / M, 12);
    expect(priceRequest(id, 120_000, 2_000)).toBeCloseTo(0.065, 9);
  });

  it("sources 7 and 8 (OpenRouter-snapshot readers) hold no hand-typed price table of their own", () => {
    // pricingAtRun.ts keeps exactly one numeric price pair: the flagged `fallback_estimate` ($1/$5) for an id with no row anywhere.
    const pricing = readFileSync("scripts/benchmark/pricingAtRun.ts", "utf8");
    expect([...pricing.matchAll(/(?:input|output)Per1M:\s*\d/g)].length).toBe(2);
    expect(pricing).toMatch(/source: "fallback_estimate",\s*inputPer1M: 1,\s*outputPer1M: 5,/);
    expect(pricing).toMatch(/source: "openrouter_snapshot"/);
    expect(readFileSync("scripts/benchmark/run.ts", "utf8")).toContain('from "./pricingAtRun"'); // run.ts reads the module under test, not a copy
    const sweep = readFileSync("scripts/proofloop-proxy-model-sweep.ts", "utf8");
    expect([...sweep.matchAll(/(?:input|output|cachedInput)Per1M:\s*\d/g)]).toEqual([]);
    expect(sweep).toContain("fetchedAt");
  });

  describe("sources 7 and 8 on a dated OpenRouter /models fixture", () => {
    // The OpenRouter /models response of 2026-10-10 (snapshot read for SPEC §1.2), USD per TOKEN as OpenRouter serves it.
    // Literal strings on purpose: the per-token -> per-1M conversion is what these tests exercise.
    const FIXTURE_FETCHED_AT = "2026-10-10T00:00:00.000Z";
    const OPENROUTER_MODELS_2026_10_10 = {
      data: [
        { id: "anthropic/claude-haiku-5.5", context_length: 1_000_000, pricing: { prompt: "0.0000001", completion: "0.0000005", input_cache_read: "0.00000001" }, supported_parameters: ["tools"] },
        { id: "anthropic/claude-sonnet-5.5", context_length: 1_000_000, pricing: { prompt: "0.000002", completion: "0.00001", input_cache_read: "0.0000001" }, supported_parameters: ["tools"] },
        { id: "anthropic/claude-opus-5.5", context_length: 1_000_000, pricing: { prompt: "0.000004", completion: "0.00002", input_cache_read: "0.0000002" }, supported_parameters: ["tools"] },
      ],
    };
    const openRouterRows = REFRESH_ROWS.filter((r) => r.transport === "openrouter");

    it("the fixture covers every OpenRouter-transport refresh row", () => {
      expect(openRouterRows.map((r) => r.id).sort()).toEqual(OPENROUTER_MODELS_2026_10_10.data.map((m) => m.id).sort());
    });

    it("source 7: benchmark/pricingAtRun prices each OpenRouter row from the snapshot at the catalog's {inPerM, outPerM}; the catalog fallback agrees too", () => {
      const snapshot: RouteSnapshot = {
        routeSnapshotId: "fixture-2026-10-10",
        fetchedAt: FIXTURE_FETCHED_AT,
        source: "openrouter",
        modelsById: new Map(OPENROUTER_MODELS_2026_10_10.data.map((m) => [m.id, m])),
      };
      for (const row of REFRESH_ROWS) {
        const table = modelPricing[row.id];
        const fromCatalog = catalogPricingAtRun(row.id);
        expect(fromCatalog.source, row.id).toBe("catalog");
        expect({ inPerM: fromCatalog.inputPer1M, outPerM: fromCatalog.outputPer1M }, `${row.id} catalog fallback`).toEqual({ inPerM: table.inputPer1M, outPerM: table.outputPer1M });
        if (row.transport !== "openrouter") continue;
        const fromSnapshot = pricingAtRunFor(row.id, snapshot);
        expect(fromSnapshot.source, row.id).toBe("openrouter_snapshot");
        expect(fromSnapshot.routeSnapshotId).toBe("fixture-2026-10-10");
        expect(fromSnapshot.inputPer1M, `${row.id} snapshot input`).toBeCloseTo(table.inputPer1M, 9);
        expect(fromSnapshot.outputPer1M, `${row.id} snapshot output`).toBeCloseTo(table.outputPer1M, 9);
        if (table.cachedInputPer1M !== undefined) expect(fromSnapshot.cachedInputPer1M, `${row.id} snapshot cache read`).toBeCloseTo(table.cachedInputPer1M, 9);
      }
    });

    describe("source 8: scripts/proofloop-proxy-model-sweep.ts (--dry-run, the script itself)", () => {
      let dir: string | undefined;
      afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        if (dir) rmSync(dir, { recursive: true, force: true });
        dir = undefined;
      });

      it("records pricingAtRun per model at the catalog's {inPerM, outPerM}", async () => {
        dir = mkdtempSync(join(tmpdir(), "pricing-sweep-"));
        const { externalBenchmarkLocalTaskIds } = await import("../proofloop/benchmarks/common/local-tasks");
        const out = join(dir, "sweep.json");
        const requested: string[] = [];
        vi.stubGlobal("fetch", async (input: string | URL | Request) => {
          requested.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
          return new Response(JSON.stringify(OPENROUTER_MODELS_2026_10_10), { status: 200, headers: { "content-type": "application/json" } });
        });
        vi.spyOn(console, "log").mockImplementation(() => {});
        const argvBefore = process.argv;
        const exitBefore = process.exitCode;
        process.argv = ["node", "proofloop-proxy-model-sweep.ts", "--dry-run", "--allow-failures", "--id", externalBenchmarkLocalTaskIds()[0],
          "--models", openRouterRows.map((r) => r.id).join(","),
          "--json-out", out, "--md-out", join(dir, "sweep.md"), "--html-out", join(dir, "sweep.html"), "--adapter-out-root", join(dir, "runs")];
        vi.resetModules();
        try {
          await import("../scripts/proofloop-proxy-model-sweep");
        } finally {
          process.argv = argvBefore;
          process.exitCode = exitBefore;
        }
        expect(requested).toEqual(["https://openrouter.ai/api/v1/models"]);
        const rows = JSON.parse(readFileSync(out, "utf8")).rows as Array<{ modelId: string; pricingAtRun: { inputPer1M: number; outputPer1M: number; cachedInputPer1M: number | null; fetchedAt: string } | null }>;
        expect(rows.map((r) => r.modelId).sort()).toEqual(openRouterRows.map((r) => r.id).sort());
        for (const row of rows) {
          const table = modelPricing[row.modelId];
          expect(row.pricingAtRun, row.modelId).not.toBeNull();
          expect(row.pricingAtRun!.inputPer1M, `${row.modelId} input`).toBeCloseTo(table.inputPer1M, 9);
          expect(row.pricingAtRun!.outputPer1M, `${row.modelId} output`).toBeCloseTo(table.outputPer1M, 9);
          if (table.cachedInputPer1M !== undefined) expect(row.pricingAtRun!.cachedInputPer1M, `${row.modelId} cache read`).toBeCloseTo(table.cachedInputPer1M, 9);
        }
      }, 30_000);
    });
  });

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

  // Retired ids kept for persisted rows. Their prices are origin/main's own undated dotted rows moved to the hyphenated wire id
  // (no vendor page was read for them, so no price was invented and no pricingAsOf is claimed). Every source must still agree on them,
  // under either spelling.
  it.each([
    { dotted: "claude-opus-4.1", id: "claude-opus-4-1", inPerM: 15, outPerM: 75, cachedInPerM: 1.5 },
    { dotted: "claude-haiku-3.5", id: "claude-haiku-3-5", inPerM: 0.8, outPerM: 4, cachedInPerM: 0.08 },
  ])("retired $id keeps origin/main's undated price in every source, under either spelling", ({ dotted, id, inPerM, outPerM, cachedInPerM }) => {
    expect(modelPricing[id]).toMatchObject({ inputPer1M: inPerM, outputPer1M: outPerM, cachedInputPer1M: cachedInPerM });
    expect(modelPricing[id].pricingAsOf, "undated on purpose: main never dated it").toBeUndefined();
    const P = 100_000;
    for (const name of [id, dotted]) {
      for (const [source, cost] of [["priceRun", priceRun], ["priceRequest", priceRequest], ["priceRequestStrict", priceRequestStrict], ["convexPriceRun", convexPriceRun], ["convexPriceRequest", convexPriceRequest]] as const) {
        expect(cost(name, P, 0) * (M / P), `${source} ${name} input`).toBeCloseTo(inPerM, 9);
        expect(cost(name, 0, M), `${source} ${name} output`).toBeCloseTo(outPerM, 9);
      }
      expect(proofloopModelCostFieldsForRun({ modelId: name, tokensIn: P, tokensOut: M }).costUsd, `proofloopModelTracking ${name}`).toBeCloseTo((P * inPerM + M * outPerM) / M, 7);
    }
  });

  it("every dated row in the table carries a parseable pricingAsOf", () => {
    for (const [id, row] of Object.entries(modelPricing)) {
      if (row.pricingAsOf !== undefined) expect(Number.isNaN(Date.parse(row.pricingAsOf)), id).toBe(false);
    }
  });

  it("an id with no row is refused by the strict price and guessed only by the legacy ones", () => {
    expect(() => priceRequestStrict("gemini-9.9-unpriced-test", 1, 1)).toThrow(UnpricedModelError);
    expect(priceRun("gemini-9.9-unpriced-test", M, 0)).toBe(1); // legacy fallback, kept for unbudgeted callers
  });
});
