/**
 * simulate-credits.ts — offline credit/cost load simulator CLI.
 *
 *   npm run simulate:credits                       # all profiles, 30 days
 *   npm run simulate:credits -- --profile pilot-vc --days 7
 *   npm run simulate:credits -- --budget 150       # headroom: workspaces under $150/mo
 *   npm run simulate:credits:write                 # also write docs/eval/credit-simulation.json
 *
 * Fully offline (no secrets, no network) — LLM rates come from priceRun/modelPricing,
 * substrate + Convex marginal from dated assumptions in creditModel. Exits 1 if any
 * profile's per-room/day cost exceeds the pilot per-room daily cap, so it can gate CI.
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_PROFILE_KEYS,
  maxWorkspacesUnderBudget,
  simulateProfile,
  WORKLOAD_PROFILES,
  type SimResult,
} from "../src/benchmarks/costSimulator";
import {
  CREDIT_MODE_SPECS,
  DEFAULT_BUDGET_CAPS,
  DEMO_CREDIT_CONFIG,
  estimateCostFor,
  PRODUCTION_CALIBRATION,
  USD_PER_CREDIT,
} from "../src/nodeagent/core/creditModel";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const days = Number(arg("days", "30"));
const onlyProfile = arg("profile");
const budgetUsd = Number(arg("budget", String(DEFAULT_BUDGET_CAPS.globalMonthlyUsd)));
const jsonOutIdx = process.argv.indexOf("--json-out");
const jsonOut = jsonOutIdx >= 0 ? process.argv[jsonOutIdx + 1] : undefined;

const profileKeys = onlyProfile ? [onlyProfile] : ALL_PROFILE_KEYS;
const unknown = profileKeys.filter((k) => !WORKLOAD_PROFILES[k]);
if (unknown.length) {
  console.error(`Unknown profile(s): ${unknown.join(", ")}. Known: ${ALL_PROFILE_KEYS.join(", ")}`);
  process.exit(2);
}

const modeEstimates = Object.fromEntries(
  (Object.keys(CREDIT_MODE_SPECS) as Array<keyof typeof CREDIT_MODE_SPECS>).map((m) => [m, estimateCostFor(m)]),
);

const results: SimResult[] = profileKeys.map((k) => simulateProfile(WORKLOAD_PROFILES[k], { days }));

const totals = {
  days,
  usdPerCredit: USD_PER_CREDIT,
  demoGrantCredits: DEMO_CREDIT_CONFIG.startingCredits,
  demoGrantUsd: DEMO_CREDIT_CONFIG.startingUsd,
  sumTotalCostUsd: round2(results.reduce((s, r) => s + r.totalCostUsd, 0)),
  sumCreditsBurned: round2(results.reduce((s, r) => s + r.creditsBurned, 0)),
};

// Headroom: how many identical pilot-vc / finance-friend workspaces fit the budget.
const headroom = {
  budgetUsd,
  pilotVc: maxWorkspacesUnderBudget(WORKLOAD_PROFILES["pilot-vc"], budgetUsd, days),
  financeFriend: maxWorkspacesUnderBudget(WORKLOAD_PROFILES["finance-friend"], budgetUsd, days),
  gtmSales: maxWorkspacesUnderBudget(WORKLOAD_PROFILES["gtm-sales"], budgetUsd, days),
};

const failures = results.filter((r) => r.exceedsPerRoomDailyCap).map((r) => `${r.profileKey}: ${r.warnings.join("; ")}`);
const passed = failures.length === 0;

const report = {
  schema: 1 as const,
  gate: "credit_simulation_v1",
  generatedAt: new Date().toISOString(),
  calibration: PRODUCTION_CALIBRATION,
  caps: DEFAULT_BUDGET_CAPS,
  modeEstimates,
  results,
  totals,
  headroom,
  passed,
  failures,
};

printHuman(report);
if (jsonOut) {
  const out = resolve(dirname(fileURLToPath(import.meta.url)), "..", jsonOut);
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${out}`);
}
if (!passed) process.exitCode = 1;

function printHuman(r: typeof report): void {
  console.log("=".repeat(78));
  console.log(`NodeRoom credit simulation — ${days} day(s) · 1 credit = $${USD_PER_CREDIT}`);
  console.log(
    `Calibration: agentRuns n=${r.calibration.sampleSize} (${r.calibration.deployment}, ${r.calibration.capturedAt}) · LLM-only costUsd p50 $${r.calibration.costUsd.p50} avg $${r.calibration.costUsd.avg} p95 $${r.calibration.costUsd.p95}`,
  );
  console.log("=".repeat(78));
  console.log("\nPer-mode estimate (LLM via priceRun + substrate assumption; hard cap = LLM-only):");
  for (const [mode, e] of Object.entries(r.modeEstimates)) {
    console.log(
      `  ${mode.padEnd(9)} est $${e.estimateUsd.toFixed(3)} (LLM $${e.llmUsd.toFixed(3)} + sub $${e.substrateUsd.toFixed(3)}) ` +
        `· ${e.creditsLow}-${e.creditsHigh} cr · hold ${e.creditsRequired} cr · hard cap $${e.hardCapUsd.toFixed(2)}` +
        (e.requiresApproval ? " · approval required" : ""),
    );
  }
  console.log("\nWorkload profiles:");
  for (const s of r.results) {
    const flag = s.exceedsPerRoomDailyCap ? " ⚠ DAILY-CAP" : "";
    console.log(
      `\n  [${s.grounding}] ${s.profileKey} — ${s.label}${flag}\n` +
        `    ${s.users} user(s)/${s.rooms} room(s) · ${s.totalRuns} runs (q${s.runsByMode.quick}/s${s.runsByMode.standard}/d${s.runsByMode.deep})\n` +
        `    total $${s.totalCostUsd} (LLM $${s.llmCostUsd.toFixed(2)} + sub $${s.substrateCostUsd.toFixed(2)} + convex $${s.convexMarginalUsd.toFixed(4)})\n` +
        `    $${s.perRoomPerDayUsd.toFixed(2)}/room/day · $${s.perUserPerDayUsd.toFixed(2)}/user/day · $${s.perRunAvgUsd.toFixed(3)}/run · ${s.creditsBurned} credits`,
    );
    for (const w of s.warnings) console.log(`      • ${w}`);
  }
  console.log("\nHeadroom (max identical workspaces under $" + r.headroom.budgetUsd + "/mo):");
  console.log(
    `  pilot-vc:       ${r.headroom.pilotVc.workspaces} workspaces (${r.headroom.pilotVc.users} users) @ $${r.headroom.pilotVc.perWorkspaceMonthlyUsd}/mo each`,
  );
  console.log(
    `  finance-friend: ${r.headroom.financeFriend.workspaces} workspaces (${r.headroom.financeFriend.users} users) @ $${r.headroom.financeFriend.perWorkspaceMonthlyUsd}/mo each`,
  );
  console.log(
    `  gtm-sales:      ${r.headroom.gtmSales.workspaces} workspaces (${r.headroom.gtmSales.users} users) @ $${r.headroom.gtmSales.perWorkspaceMonthlyUsd}/mo each`,
  );
  console.log(`\nTotals across simulated profiles: $${r.totals.sumTotalCostUsd} · ${r.totals.sumCreditsBurned} credits`);
  console.log(passed ? "\n✅ PASS — no profile exceeds the per-room daily cap." : `\n❌ FAIL\n  ${failures.join("\n  ")}`);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
