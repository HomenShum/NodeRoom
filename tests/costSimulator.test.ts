import { describe, it, expect } from "vitest";
import {
  AGENT_CREDIT_MODES,
  CREDIT_MODE_SPECS,
  DEFAULT_BUDGET_CAPS,
  DEMO_CREDIT_CONFIG,
  estimateCostFor,
  reserveCreditsFor,
  USD_PER_CREDIT,
  usdToCredits,
  creditsToUsd,
} from "../src/nodeagent/core/creditModel";
import {
  maxWorkspacesUnderBudget,
  projectFleetMonthlyUsd,
  simulateProfile,
  WORKLOAD_PROFILES,
} from "../src/benchmarks/costSimulator";

// Scenario-based: real personas (VC team, GTM rep, conference burst, bulk enrichment),
// short-running burst AND long-running sustained accumulation, plus adversarial bounds.

describe("creditModel — unit + estimate invariants", () => {
  it("credit unit round-trips and matches the $0.25 spec", () => {
    expect(USD_PER_CREDIT).toBe(0.25);
    expect(creditsToUsd(usdToCredits(4.2))).toBeCloseTo(4.2, 6);
    expect(usdToCredits(5)).toBe(20); // $5 grant = 20 credits
  });

  it("reserve never under-covers and is at least 1 credit", () => {
    expect(reserveCreditsFor(0)).toBe(1);
    expect(reserveCreditsFor(0.01)).toBe(1);
    expect(creditsToUsd(reserveCreditsFor(0.7))).toBeGreaterThanOrEqual(0.7);
    expect(creditsToUsd(reserveCreditsFor(2.49))).toBeGreaterThanOrEqual(2.49);
  });

  it("modes are strictly ordered quick < standard < deep on cost, cap, and credits", () => {
    const q = estimateCostFor("quick");
    const s = estimateCostFor("standard");
    const d = estimateCostFor("deep");
    expect(q.estimateUsd).toBeLessThan(s.estimateUsd);
    expect(s.estimateUsd).toBeLessThan(d.estimateUsd);
    expect(q.hardCapUsd).toBeLessThan(s.hardCapUsd);
    expect(s.hardCapUsd).toBeLessThan(d.hardCapUsd);
    expect(q.creditsRequired).toBeLessThanOrEqual(s.creditsRequired);
    expect(s.creditsRequired).toBeLessThanOrEqual(d.creditsRequired);
  });

  it("HONEST: the in-run hard cap exceeds the LLM estimate (room to finish, not to run away)", () => {
    for (const mode of AGENT_CREDIT_MODES) {
      const e = estimateCostFor(mode);
      // hard cap governs LLM only — it must clear the LLM estimate with headroom...
      expect(e.hardCapUsd).toBeGreaterThan(e.llmUsd);
      // ...and stay within an order of magnitude of it (not a blank check).
      expect(e.hardCapUsd).toBeLessThan(e.llmUsd * 20 + 1);
    }
  });

  it("DETERMINISTIC: estimateCostFor is pure (same input → identical output)", () => {
    expect(estimateCostFor("standard")).toEqual(estimateCostFor("standard"));
  });

  it("only deep requires explicit approval", () => {
    expect(estimateCostFor("quick").requiresApproval).toBe(false);
    expect(estimateCostFor("standard").requiresApproval).toBe(false);
    expect(estimateCostFor("deep").requiresApproval).toBe(true);
    expect(CREDIT_MODE_SPECS.deep.requiresApproval).toBe(true);
  });

  it("estimates land near the real calibration (LLM-only) — quick ≈ p50, deep ≫ standard", () => {
    // glm-5.2 anchored estimates should be the right order of magnitude vs production.
    expect(estimateCostFor("quick").llmUsd).toBeGreaterThan(0.02);
    expect(estimateCostFor("quick").llmUsd).toBeLessThan(0.25);
    expect(estimateCostFor("deep").llmUsd).toBeGreaterThan(estimateCostFor("standard").llmUsd * 2);
  });
});

describe("costSimulator — workload profiles", () => {
  it("demo grant of 20 credits ($5) buys several standard packets but at most ~1 deep", () => {
    const grant = DEMO_CREDIT_CONFIG.startingCredits;
    const standardHold = estimateCostFor("standard").creditsRequired;
    const deepHold = estimateCostFor("deep").creditsRequired;
    expect(Math.floor(grant / standardHold)).toBeGreaterThanOrEqual(3); // "come back daily"
    expect(Math.floor(grant / deepHold)).toBeLessThanOrEqual(2); // deep is rationed
  });

  it("SHORT-running burst: conference-room 1 day stays bounded and flags concurrency", () => {
    const r = simulateProfile(WORKLOAD_PROFILES["conference-room"], { days: 1 });
    expect(r.totalRuns).toBeGreaterThan(0);
    expect(r.totalCostUsd).toBeGreaterThan(0);
    expect(r.totalCostUsd).toBeLessThan(50); // a single event day is not a wallet event
    expect(r.exceedsConcurrencyCap).toBe(true); // 5 peak > 2/room → excess queues (expected)
  });

  it("LONG-running sustained: pilot-vc 30-day accumulation is affordable", () => {
    const r = simulateProfile(WORKLOAD_PROFILES["pilot-vc"], { days: 30 });
    expect(r.days).toBe(30);
    // The flagship VC team over a month should sit comfortably under the workspace cap.
    expect(r.totalCostUsd).toBeLessThan(DEFAULT_BUDGET_CAPS.perRoomMonthlyUsd * r.rooms);
    expect(r.perRunAvgUsd).toBeGreaterThan(0);
  });

  it("cache reuse lowers effective cost (parselyfi-bulk dedupe is real savings)", () => {
    const cached = simulateProfile(WORKLOAD_PROFILES["parselyfi-bulk"], { days: 7 });
    const noCache = simulateProfile({ ...WORKLOAD_PROFILES["parselyfi-bulk"], cacheHitRate: 0 }, { days: 7 });
    expect(cached.totalCostUsd).toBeLessThan(noCache.totalCostUsd);
  });

  it("credits-burned scales monotonically with days (no negative / no shrink over time)", () => {
    const d1 = simulateProfile(WORKLOAD_PROFILES["ta-studio"], { days: 1 });
    const d7 = simulateProfile(WORKLOAD_PROFILES["ta-studio"], { days: 7 });
    const d30 = simulateProfile(WORKLOAD_PROFILES["ta-studio"], { days: 30 });
    expect(d1.creditsBurned).toBeGreaterThanOrEqual(0);
    expect(d7.creditsBurned).toBeGreaterThan(d1.creditsBurned);
    expect(d30.creditsBurned).toBeGreaterThan(d7.creditsBurned);
  });

  it("notebook-passive is passive-heavy: spend stays tiny (suggestions don't bill)", () => {
    const r = simulateProfile(WORKLOAD_PROFILES["notebook-passive"], { days: 30 });
    expect(r.runsByMode.deep).toBe(0);
    expect(r.totalCostUsd).toBeLessThan(DEFAULT_BUDGET_CAPS.perRoomDailyUsd * 30);
  });

  it("ADVERSARIAL: every profile reports finite, non-negative money fields", () => {
    for (const key of Object.keys(WORKLOAD_PROFILES)) {
      const r = simulateProfile(WORKLOAD_PROFILES[key], { days: 30 });
      for (const v of [r.totalCostUsd, r.llmCostUsd, r.substrateCostUsd, r.creditsBurned, r.perRunAvgUsd]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe("headroom — how many users can I open to?", () => {
  it("bigger budget → at least as many workspaces (monotonic)", () => {
    const lo = maxWorkspacesUnderBudget(WORKLOAD_PROFILES["pilot-vc"], 75);
    const hi = maxWorkspacesUnderBudget(WORKLOAD_PROFILES["pilot-vc"], 300);
    expect(hi.workspaces).toBeGreaterThanOrEqual(lo.workspaces);
    expect(hi.users).toBeGreaterThanOrEqual(lo.users);
  });

  it("a $150/mo budget admits a real-but-bounded pilot, not 200 unlimited users", () => {
    const vc = maxWorkspacesUnderBudget(WORKLOAD_PROFILES["pilot-vc"], 150);
    expect(vc.workspaces).toBeGreaterThanOrEqual(1);
    // Sanity: the fleet cost for that many workspaces stays within budget.
    expect(projectFleetMonthlyUsd(WORKLOAD_PROFILES["pilot-vc"], vc.workspaces)).toBeLessThanOrEqual(150);
  });
});
