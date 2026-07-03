/**
 * costSimulator.ts — offline, deterministic cost/credit load model for NodeRoom.
 *
 * Answers the launch question: "how many users can I open to before my credit card
 * breaks, and what does each professional workflow cost?" It runs ZERO external
 * calls — every LLM rate comes from priceRun()/modelPricing via creditModel, and the
 * non-LLM substrate (Linkup/Firecrawl/Browserbase) and Convex marginal costs come
 * from the dated assumptions in creditModel. No randomness, so tests are stable.
 *
 * Workload profiles map the real professional workflows discussed for the pilot
 * (VC dealflow, GTM sales, bulk enrichment, people research, conference burst,
 * passive notebook capture, finance friend). Two are repo-grounded (parselyfi-bulk,
 * gtm-sales); the rest are tagged ASSUMPTION and should be calibrated as real
 * usage arrives.
 */
import {
  AGENT_CREDIT_MODES,
  type AgentCreditMode,
  CREDIT_MODE_SPECS,
  DEFAULT_BUDGET_CAPS,
  estimateCostFor,
  substrateCostUsd,
} from "../nodeagent/core/creditModel";

export type RunMode = AgentCreditMode;

// Convex Professional marginal-overage assumptions (2026-06-27, published pricing):
// included: 25M function calls + 250 action GB-hours / $25 dev/mo. Overage:
// $2 / 1M function calls, $0.30 / action GB-hour. At pilot scale you stay inside
// the flat base — these model only the MARGINAL cost beyond it, which is tiny.
export const CONVEX_MARGINAL = {
  flatBaseUsdPerMonth: 25,
  functionCallsPerRun: 60, // 1 action + cell/journal mutations + reads, conservative
  fnCallOverageUsdPer1M: 2,
  actionSecondsPerRun: 30, // avg agent action wall-time
  actionMemGb: 0.25,
  actionGbHourOverageUsd: 0.3,
} as const;

export function convexMarginalUsdPerRun(): number {
  const fnCall = (CONVEX_MARGINAL.functionCallsPerRun * CONVEX_MARGINAL.fnCallOverageUsdPer1M) / 1_000_000;
  const gbHours = (CONVEX_MARGINAL.actionSecondsPerRun / 3600) * CONVEX_MARGINAL.actionMemGb;
  const action = gbHours * CONVEX_MARGINAL.actionGbHourOverageUsd;
  return fnCall + action;
}

export type Grounding = "repo" | "assumption";

export interface WorkloadProfile {
  key: string;
  label: string;
  grounding: Grounding;
  description: string;
  users: number;
  rooms: number;
  /** Runs per user per day, by mode. Fractions model "every N days". */
  runsPerUserPerDay: Record<RunMode, number>;
  /** Peak concurrent foreground jobs (for the concurrency-cap check). */
  peakConcurrency: number;
  /** Fraction of runs served from entityResearchCache (0..1) — reduces effective cost. */
  cacheHitRate?: number;
  notes?: string;
}

export const WORKLOAD_PROFILES: Record<string, WorkloadProfile> = {
  "pilot-vc": {
    key: "pilot-vc",
    label: "UpscaleX / VC dealflow team",
    grounding: "assumption",
    description: "4 analysts triaging dealflow: quick lookups + standard diligence packets, occasional deep dive.",
    users: 4,
    rooms: 5,
    runsPerUserPerDay: { quick: 2, standard: 1, deep: 0.2 },
    peakConcurrency: 2,
    cacheHitRate: 0.15,
    notes: "The flagship demo: research UpscaleX → events, portfolio companies, people.",
  },
  "finance-friend": {
    key: "finance-friend",
    label: "Finance / GTM friend (solo tester)",
    grounding: "assumption",
    description: "One trusted tester kicking the tires: a few quick lookups, the odd standard packet.",
    users: 1,
    rooms: 3,
    runsPerUserPerDay: { quick: 2, standard: 0.5, deep: 0.1 },
    peakConcurrency: 1,
  },
  "gtm-sales": {
    key: "gtm-sales",
    label: "GTM sales lead enrichment",
    grounding: "repo",
    description: "Sales rep enriching leads: company/person enrichment, relationship map, CRM-ready notes.",
    users: 1,
    rooms: 1,
    runsPerUserPerDay: { quick: 3, standard: 1, deep: 0 },
    peakConcurrency: 2,
    cacheHitRate: 0.2,
    notes: "Grounded in the runway/GTM plan flows (src/nodeagent/core/plans.ts).",
  },
  "conference-room": {
    key: "conference-room",
    label: "Conference / event room (burst)",
    grounding: "assumption",
    description: "10 people in one shared room during an event: lots of notes, passive suggestions, bursty approved research.",
    users: 10,
    rooms: 1,
    runsPerUserPerDay: { quick: 1, standard: 0.5, deep: 0.1 },
    peakConcurrency: 5,
    notes: "Stress case for foreground concurrency + passive-suggestion debounce.",
  },
  "notebook-passive": {
    key: "notebook-passive",
    label: "Notebook capture (passive-heavy)",
    grounding: "assumption",
    description: "Messy-notes capture: mostly passive suggestions (no spend), low research-approval rate.",
    users: 1,
    rooms: 2,
    runsPerUserPerDay: { quick: 1, standard: 0.3, deep: 0 },
    peakConcurrency: 1,
    notes: "Passive suggestions are suggestions-only (0 paid jobs); only approved research spends.",
  },
  "parselyfi-bulk": {
    key: "parselyfi-bulk",
    label: "Parselyfi bulk company enrichment",
    grounding: "repo",
    description: "Batch enrichment over a large company list with heavy dedupe/cache reuse.",
    users: 1,
    rooms: 1,
    runsPerUserPerDay: { quick: 50, standard: 0, deep: 0 },
    peakConcurrency: 4,
    cacheHitRate: 0.45,
    notes: "Grounded in the demo room company list (src/engine/demoRoom.ts); entityResearchCache cuts repeats.",
  },
  "ta-studio": {
    key: "ta-studio",
    label: "TA Studio people/company research",
    grounding: "assumption",
    description: "Talent/people research: background profiles, company links, contact map, high evidence use.",
    users: 1,
    rooms: 2,
    runsPerUserPerDay: { quick: 1, standard: 2, deep: 0.3 },
    peakConcurrency: 2,
    cacheHitRate: 0.1,
  },
};

export interface ModeBreakdown {
  mode: RunMode;
  runs: number;
  cachedRuns: number;
  llmUsd: number;
  substrateUsd: number;
  creditsBurned: number;
}

export interface SimResult {
  profileKey: string;
  label: string;
  grounding: Grounding;
  days: number;
  users: number;
  rooms: number;
  totalRuns: number;
  runsByMode: Record<RunMode, number>;
  breakdown: ModeBreakdown[];
  llmCostUsd: number;
  substrateCostUsd: number;
  convexMarginalUsd: number;
  providerCostUsd: number; // llm + substrate
  totalCostUsd: number; // provider + convex marginal
  creditsBurned: number;
  perUserPerDayUsd: number;
  perRoomPerDayUsd: number;
  perRunAvgUsd: number;
  peakConcurrency: number;
  // gate signals
  costLimitPerDayUsd: number;
  exceedsPerRoomDailyCap: boolean;
  exceedsPerRoomMonthlyCap: boolean;
  exceedsConcurrencyCap: boolean;
  warnings: string[];
}

export interface SimulateOptions {
  days?: number;
  /** Override the per-room daily USD cap used for the gate (defaults to pilot caps). */
  costLimitPerDayUsd?: number;
}

/** Effective per-run cost for a mode, after cache hits (cached runs cost ~0 LLM/substrate). */
function modeCost(mode: RunMode): { llmUsd: number; substrateUsd: number; creditsHigh: number } {
  const est = estimateCostFor(mode);
  const spec = CREDIT_MODE_SPECS[mode];
  return {
    llmUsd: est.llmUsd,
    substrateUsd: substrateCostUsd(spec.substrate),
    creditsHigh: est.creditsRequired,
  };
}

export function simulateProfile(profile: WorkloadProfile, opts: SimulateOptions = {}): SimResult {
  const days = Math.max(1, Math.floor(opts.days ?? 30));
  const cacheHitRate = clamp01(profile.cacheHitRate ?? 0);
  const convexPerRun = convexMarginalUsdPerRun();

  const breakdown: ModeBreakdown[] = [];
  const runsByMode = { quick: 0, standard: 0, deep: 0 } as Record<RunMode, number>;
  let llmCostUsd = 0;
  let substrateCostUsd_ = 0;
  let creditsBurned = 0;
  let totalRuns = 0;

  for (const mode of AGENT_CREDIT_MODES) {
    const runsFloat = profile.runsPerUserPerDay[mode] * profile.users * days;
    const runs = round2(runsFloat);
    if (runs <= 0) {
      breakdown.push({ mode, runs: 0, cachedRuns: 0, llmUsd: 0, substrateUsd: 0, creditsBurned: 0 });
      continue;
    }
    const cachedRuns = round2(runs * cacheHitRate);
    const billableRuns = runs - cachedRuns;
    const c = modeCost(mode);
    const llm = billableRuns * c.llmUsd;
    const sub = billableRuns * c.substrateUsd;
    const credits = billableRuns * c.creditsHigh;
    llmCostUsd += llm;
    substrateCostUsd_ += sub;
    creditsBurned += credits;
    runsByMode[mode] = runs;
    totalRuns += runs;
    breakdown.push({
      mode,
      runs,
      cachedRuns,
      llmUsd: round4(llm),
      substrateUsd: round4(sub),
      creditsBurned: round2(credits),
    });
  }

  const convexMarginalUsd = totalRuns * convexPerRun;
  const providerCostUsd = llmCostUsd + substrateCostUsd_;
  const totalCostUsd = providerCostUsd + convexMarginalUsd;

  const perUserPerDayUsd = totalCostUsd / Math.max(1, profile.users) / days;
  const perRoomPerDayUsd = totalCostUsd / Math.max(1, profile.rooms) / days;
  const perRunAvgUsd = totalRuns > 0 ? totalCostUsd / totalRuns : 0;

  const costLimitPerDayUsd = opts.costLimitPerDayUsd ?? DEFAULT_BUDGET_CAPS.perRoomDailyUsd;
  const exceedsPerRoomDailyCap = perRoomPerDayUsd > costLimitPerDayUsd;
  const exceedsPerRoomMonthlyCap = totalCostUsd / Math.max(1, profile.rooms) / days * 30 > DEFAULT_BUDGET_CAPS.perRoomMonthlyUsd;
  const exceedsConcurrencyCap = profile.peakConcurrency > DEFAULT_BUDGET_CAPS.concurrentForegroundJobsPerRoom;

  const warnings: string[] = [];
  if (exceedsPerRoomDailyCap)
    warnings.push(
      `per-room/day $${perRoomPerDayUsd.toFixed(2)} > cap $${costLimitPerDayUsd.toFixed(2)} — runs will hit the room daily cap.`,
    );
  if (exceedsPerRoomMonthlyCap)
    warnings.push(`per-room/month projects > $${DEFAULT_BUDGET_CAPS.perRoomMonthlyUsd} cap.`);
  if (exceedsConcurrencyCap)
    warnings.push(
      `peak concurrency ${profile.peakConcurrency} > per-room foreground cap ${DEFAULT_BUDGET_CAPS.concurrentForegroundJobsPerRoom} — excess queues (expected for burst).`,
    );

  return {
    profileKey: profile.key,
    label: profile.label,
    grounding: profile.grounding,
    days,
    users: profile.users,
    rooms: profile.rooms,
    totalRuns: round2(totalRuns),
    runsByMode,
    breakdown,
    llmCostUsd: round4(llmCostUsd),
    substrateCostUsd: round4(substrateCostUsd_),
    convexMarginalUsd: round4(convexMarginalUsd),
    providerCostUsd: round4(providerCostUsd),
    totalCostUsd: round2(totalCostUsd),
    creditsBurned: round2(creditsBurned),
    perUserPerDayUsd: round4(perUserPerDayUsd),
    perRoomPerDayUsd: round4(perRoomPerDayUsd),
    perRunAvgUsd: round4(perRunAvgUsd),
    peakConcurrency: profile.peakConcurrency,
    costLimitPerDayUsd,
    exceedsPerRoomDailyCap,
    exceedsPerRoomMonthlyCap,
    exceedsConcurrencyCap,
    warnings,
  };
}

/** Project total monthly cost for a fleet of N identical workspaces of a profile. */
export function projectFleetMonthlyUsd(profile: WorkloadProfile, workspaces: number, days = 30): number {
  const one = simulateProfile(profile, { days });
  return round2(one.totalCostUsd * workspaces);
}

/**
 * Headroom answer to "how many users can I open to?" Given a monthly USD budget and
 * a representative profile, returns the max identical workspaces that fit, plus the
 * implied user count.
 */
export function maxWorkspacesUnderBudget(
  profile: WorkloadProfile,
  monthlyBudgetUsd: number,
  days = 30,
): { workspaces: number; users: number; perWorkspaceMonthlyUsd: number } {
  const one = simulateProfile(profile, { days });
  const per = one.totalCostUsd;
  const workspaces = per > 0 ? Math.floor(monthlyBudgetUsd / per) : 0;
  return {
    workspaces,
    users: workspaces * profile.users,
    perWorkspaceMonthlyUsd: round2(per),
  };
}

export const ALL_PROFILE_KEYS = Object.keys(WORKLOAD_PROFILES);

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
