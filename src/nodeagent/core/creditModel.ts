/**
 * creditModel.ts — single source of truth for NodeRoom's COST/CREDIT dimension.
 *
 * Friction policy (zero-click / approval-required etc.) lives in budgetProfiles.ts /
 * runtimeProfiles.ts. This file owns the *money*: the credit unit, per-mode dollar
 * estimates + hard caps, the demo grant, and the pilot budget caps. The cost
 * simulator, the in-memory store, the UI, and the Convex backend (convex/credits.ts)
 * all import from HERE so no rate is ever copied (CLAUDE.md HONEST_SCORES).
 *
 * The LLM cost is derived from priceRun() over the SAME modelPricing table the
 * runtime uses. Non-LLM substrate (Linkup / Firecrawl / Browserbase) is invisible
 * to agentRuns.costUsd, so it is estimated here from published provider prices and
 * tagged as a dated ASSUMPTION — it is NOT covered by the in-run hard cap (that cap
 * only governs what checkSpendCeiling can see: LLM tokens).
 *
 * Calibration: the per-mode token/step shapes below are anchored to REAL production
 * agentRuns rows (see PRODUCTION_CALIBRATION), not invented. Re-run the calibration
 * query and update these if the live distribution shifts.
 */
import { getModelPricing, resolveModelAlias } from "../models/modelCatalog";
import type { NodeAgentBudgetProfile } from "./budgetProfiles";

/** LLM run cost in USD. Inlined from adapter.priceRun (same modelPricing table) so this
 *  module has NO AI-SDK dependency and is safe to import from Convex functions + scripts. */
function priceRun(modelId: string, inTok: number, outTok: number): number {
  const p = getModelPricing(resolveModelAlias(modelId));
  return (inTok * (p?.inputPer1M ?? 1) + outTok * (p?.outputPer1M ?? 5)) / 1_000_000;
}

// ---------------------------------------------------------------------------
// Credit unit. Internal ledger is USD (the honest unit); credits are the UI unit.
// 1 credit = $0.25 — the pilot spec. Change here and every surface follows.
// ---------------------------------------------------------------------------
export const USD_PER_CREDIT = 0.25;

export const usdToCredits = (usd: number): number => usd / USD_PER_CREDIT;
export const creditsToUsd = (credits: number): number => credits * USD_PER_CREDIT;
/** Credits to hold for a run: round up so a hold never under-covers the estimate. */
export const reserveCreditsFor = (estimateUsd: number): number =>
  Math.max(1, Math.ceil(usdToCredits(estimateUsd)));

// ---------------------------------------------------------------------------
// Production calibration (provenance). Source: agentRuns one-off query on the
// dev deployment zealous-goshawk-766, n=1639, captured 2026-06-27. costUsd is
// LLM-only. Used to size the per-mode token shapes + hard caps below.
// ---------------------------------------------------------------------------
export const PRODUCTION_CALIBRATION = {
  capturedAt: "2026-06-27",
  deployment: "zealous-goshawk-766",
  sampleSize: 1639,
  costUsd: { p50: 0.0836, avg: 0.2015, p95: 0.7019, max: 4.5973 },
  inputTokens: { p50: 67023, avg: 176874, p95: 672588, max: 4826919 },
  outputTokens: { p50: 2592, avg: 5760, p95: 24641, max: 57344 },
  steps: { p50: 6, avg: 8.42, p95: 24, max: 198 },
  // Of 1639 runs: 824 done, 286 step_budget, 194 spend_budget, 191 time_budget,
  // 141 error. The spend/step budget kills prove the in-run ceiling already fires.
  dominantModel: "z-ai/glm-5.2", // 1201/1639 runs — the cheap default lane.
} as const;

// ---------------------------------------------------------------------------
// Non-LLM substrate unit prices (USD). DATED ASSUMPTIONS from published provider
// pricing (2026-06-27). No repo anchor — review when providers change. These feed
// the ESTIMATE and the SIMULATOR only; they are NOT part of the in-run hard cap.
// ---------------------------------------------------------------------------
export const PROVIDER_UNIT_PRICES = {
  // Linkup: Search ~$0.005–0.006/req, Fetch ~$0.001–0.005/req, async Research ~$0.25–2.50/req.
  linkupSearch: 0.006,
  linkupFetch: 0.003,
  linkupResearch: 1.0, // mid of the $0.25–2.50 band; deep/research mode only.
  // Firecrawl: scrape/crawl/map ~1 credit/page; paid credit ≈ $0.001.
  firecrawlPage: 0.001,
  // Browserbase: ~$0.10–0.12 / browser-HOUR ⇒ ~$0.002 / browser-minute.
  browserMinute: 0.002,
} as const;

// ---------------------------------------------------------------------------
// User-facing modes. Map onto a subset of the internal friction profiles.
// ---------------------------------------------------------------------------
export type AgentCreditMode = "quick" | "standard" | "deep";
export const AGENT_CREDIT_MODES: readonly AgentCreditMode[] = ["quick", "standard", "deep"] as const;
export const DEFAULT_CREDIT_MODE: AgentCreditMode = "standard";

export const MODE_TO_PROFILE: Record<AgentCreditMode, NodeAgentBudgetProfile> = {
  quick: "instant",
  standard: "standard",
  deep: "deep_diligence",
};

/** Reverse map. background/benchmark_completion fall back to the nearest user mode. */
export function modeFromProfile(profile: NodeAgentBudgetProfile): AgentCreditMode {
  switch (profile) {
    case "instant":
      return "quick";
    case "deep_diligence":
    case "benchmark_completion":
      return "deep";
    case "standard":
    case "background":
    default:
      return "standard";
  }
}

export interface CreditModeSpec {
  mode: AgentCreditMode;
  label: string;
  blurb: string;
  profile: NodeAgentBudgetProfile;
  /** In-run hard ceiling on LLM token spend (USD). Enforced by checkSpendCeiling. */
  hardCapUsd: number;
  /** Representative model + expected LLM shape for the estimate (real-data anchored). */
  model: string;
  expectedSteps: number;
  inputTokensPerRun: number;
  outputTokensPerRun: number;
  /** Typical non-LLM substrate calls for a run of this mode (estimate/sim only). */
  substrate: {
    linkupSearch: number;
    linkupFetch: number;
    linkupResearch: number;
    firecrawlPages: number;
    browserMinutes: number;
  };
  /** True ⇒ run must be explicitly approved before it spends (deep). */
  requiresApproval: boolean;
}

// Token shapes anchored to PRODUCTION_CALIBRATION percentiles:
//   quick   ≈ p50 run   standard ≈ avg/p75 run   deep ≈ p95→max run
// Hard caps give generous headroom over the LLM estimate so legitimate runs finish
// while runaways are killed (the existing checkSpendCeiling site does the killing).
export const CREDIT_MODE_SPECS: Record<AgentCreditMode, CreditModeSpec> = {
  quick: {
    mode: "quick",
    label: "Quick",
    blurb: "Fast first-touch lookup. Find the basics, cite a few sources.",
    profile: "instant",
    hardCapUsd: 0.75,
    model: "z-ai/glm-5.2",
    expectedSteps: 5,
    inputTokensPerRun: 60_000,
    outputTokensPerRun: 2_500,
    substrate: { linkupSearch: 6, linkupFetch: 3, linkupResearch: 0, firecrawlPages: 0, browserMinutes: 0 },
    requiresApproval: false,
  },
  standard: {
    mode: "standard",
    label: "Standard",
    blurb: "Evidence-backed packet: company, people, events, source links.",
    profile: "standard",
    hardCapUsd: 3.0,
    model: "z-ai/glm-5.2",
    expectedSteps: 9,
    inputTokensPerRun: 180_000,
    outputTokensPerRun: 6_000,
    substrate: { linkupSearch: 20, linkupFetch: 12, linkupResearch: 0, firecrawlPages: 6, browserMinutes: 0 },
    requiresApproval: false,
  },
  deep: {
    mode: "deep",
    label: "Deep",
    blurb: "Broad diligence: many sources, related companies, source capture.",
    profile: "deep_diligence",
    hardCapUsd: 10.0,
    model: "z-ai/glm-5.2",
    expectedSteps: 24,
    inputTokensPerRun: 650_000,
    outputTokensPerRun: 24_000,
    substrate: { linkupSearch: 30, linkupFetch: 20, linkupResearch: 1, firecrawlPages: 12, browserMinutes: 3 },
    requiresApproval: true,
  },
};

export interface CostEstimate {
  mode: AgentCreditMode;
  /** LLM cost from priceRun over the same modelPricing the runtime uses. */
  llmUsd: number;
  /** Non-LLM substrate cost (estimate only; NOT covered by the hard cap). */
  substrateUsd: number;
  /** Honest total midpoint = llm + substrate. */
  estimateUsd: number;
  estimateUsdLow: number;
  estimateUsdHigh: number;
  /** In-run hard ceiling on LLM spend (USD). */
  hardCapUsd: number;
  creditsLow: number;
  creditsHigh: number;
  /** Credits to hold up front (ceil of the high estimate). */
  creditsRequired: number;
  requiresApproval: boolean;
}

export function substrateCostUsd(s: CreditModeSpec["substrate"]): number {
  return (
    s.linkupSearch * PROVIDER_UNIT_PRICES.linkupSearch +
    s.linkupFetch * PROVIDER_UNIT_PRICES.linkupFetch +
    s.linkupResearch * PROVIDER_UNIT_PRICES.linkupResearch +
    s.firecrawlPages * PROVIDER_UNIT_PRICES.firecrawlPage +
    s.browserMinutes * PROVIDER_UNIT_PRICES.browserMinute
  );
}

/** Honest pre-run estimate for a mode. LLM via priceRun; substrate via published prices. */
export function estimateCostFor(mode: AgentCreditMode): CostEstimate {
  const spec = CREDIT_MODE_SPECS[mode];
  const llmUsd = priceRun(spec.model, spec.inputTokensPerRun, spec.outputTokensPerRun);
  const substrateUsd = substrateCostUsd(spec.substrate);
  const estimateUsd = llmUsd + substrateUsd;
  // Real runs vary ±; ±40% band, honest about uncertainty.
  const estimateUsdLow = round2(estimateUsd * 0.6);
  const estimateUsdHigh = round2(estimateUsd * 1.4);
  return {
    mode,
    llmUsd: round4(llmUsd),
    substrateUsd: round4(substrateUsd),
    estimateUsd: round4(estimateUsd),
    estimateUsdLow,
    estimateUsdHigh,
    hardCapUsd: spec.hardCapUsd,
    creditsLow: round2(usdToCredits(estimateUsdLow)),
    creditsHigh: round2(usdToCredits(estimateUsdHigh)),
    creditsRequired: reserveCreditsFor(estimateUsdHigh),
    requiresApproval: spec.requiresApproval,
  };
}

// ---------------------------------------------------------------------------
// Demo grant (memory mode) + pilot budget caps. From the pilot spec.
// ---------------------------------------------------------------------------
export const DEMO_CREDIT_CONFIG = {
  /** Individual-pilot free grant: 20 credits = $5.00. Lets the UpscaleX demo run
   *  several times so a user can "come back, revisit every day". */
  startingCredits: 20,
  get startingUsd() {
    return creditsToUsd(this.startingCredits);
  },
} as const;

/** Pilot wallet rails. The credit hold is the UX layer; THESE are the safety floor.
 *  Reconcile the live defaults (usageLimits.ts vs agent.ts) against these. */
export const DEFAULT_BUDGET_CAPS = {
  globalMonthlyUsd: 150, // GLOBAL_MAX_USD_PER_MONTH ceiling for the whole pilot.
  perRoomDailyUsd: 5,
  perRoomMonthlyUsd: 50,
  perUserDailyUsd: 2, // reserved for when per-user attribution lands (v2).
  concurrentForegroundJobsGlobal: 10,
  concurrentForegroundJobsPerRoom: 2,
  concurrentDeepJobsPerRoom: 1,
} as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
