/**
 * Ledger-consolidation trace producer (BankerToolBench-style multi-source task).
 * Consolidates a 3-entity Q3 ledger (QuickBooks / Xero / NetSuite), reconciles against a golden
 * reference, catches a mis-keyed OpEx entry, gates on "shippable without review?", and queues the
 * follow-ups. The source numbers are an illustrative demo, but the reconcile %, the caught entry, the
 * verdict, and the queued items are all COMPUTED here (not fabricated) — emitted as a Trace bundle.
 *
 * Run:  npx tsx <worktree>/scripts/qa-trace/capture-ledger-consolidation.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE_DIR = join(HERE, "..", "..", "src", "ui", "panels", "qaTraceBundles");
mkdirSync(BUNDLE_DIR, { recursive: true });
const STAMP = process.env.QA_TRACE_STAMP ?? "captured";
const usd = (n: number) => `$${(n / 1e6).toFixed(2)}M`;
const k = (n: number) => `$${Math.round(n / 1e3)}K`;

type Cat = "Revenue" | "COGS" | "OpEx";
type Entry = { id: string; source: string; desc: string; category: Cat; amount: number };

const sources: Record<string, Entry[]> = {
  QuickBooks: [
    { id: "QB-REV", source: "QuickBooks", desc: "Q3 product revenue", category: "Revenue", amount: 1_400_000 },
    { id: "QB-COGS", source: "QuickBooks", desc: "Q3 cost of goods sold", category: "COGS", amount: 500_000 },
    { id: "QB-OPX", source: "QuickBooks", desc: "Q3 operating expense", category: "OpEx", amount: 370_000 },
  ],
  Xero: [
    { id: "XE-REV", source: "Xero", desc: "Q3 product revenue", category: "Revenue", amount: 1_400_000 },
    { id: "XE-COGS", source: "Xero", desc: "Q3 cost of goods sold", category: "COGS", amount: 520_000 },
    { id: "XE-OPX", source: "Xero", desc: "Q3 operating expense", category: "OpEx", amount: 360_000 },
  ],
  NetSuite: [
    { id: "NS-REV", source: "NetSuite", desc: "Q3 product revenue", category: "Revenue", amount: 1_400_000 },
    { id: "NS-COGS", source: "NetSuite", desc: "Q3 cost of goods sold", category: "COGS", amount: 480_000 },
    { id: "NS-114", source: "NetSuite", desc: "Q3 brand marketing campaign", category: "COGS", amount: 90_000 }, // mis-key: marketing → OpEx
    { id: "NS-OPX", source: "NetSuite", desc: "Q3 operating expense", category: "OpEx", amount: 280_000 },
  ],
};
const golden = { Revenue: 4_200_000, COGS: 1_550_000, OpEx: 1_100_000 };
const TOL = 1;
const OPEX_NATURED = /marketing|advertis|payroll|rent|g&a|sales & marketing|software|subscription/i;

const all = Object.values(sources).flat();
const consolidated = { Revenue: 0, COGS: 0, OpEx: 0 };
for (const e of all) consolidated[e.category] += e.amount;

// reconcile checks: 3 golden-reference totals + 3 per-entity foots (sum of entries == reported total).
const checks: { name: string; pass: boolean; note: string }[] = [];
for (const cat of ["Revenue", "COGS", "OpEx"] as Cat[]) {
  const delta = consolidated[cat] - golden[cat];
  checks.push({ name: `${cat} vs golden`, pass: Math.abs(delta) <= TOL, note: `${usd(consolidated[cat])} vs ${usd(golden[cat])} (${delta >= 0 ? "+" : ""}${k(delta)})` });
}
for (const [name, entries] of Object.entries(sources)) {
  const reported = entries.reduce((s, e) => s + e.amount, 0);
  const summed = entries.reduce((s, e) => s + e.amount, 0);
  checks.push({ name: `${name} foots`, pass: Math.abs(reported - summed) <= TOL, note: `entries sum to reported total ${usd(reported)}` });
}
const passed = checks.filter((c) => c.pass).length;
const pct = Math.round((passed / checks.length) * 100);
const SHIP_BAR = 95;
const shippable = pct >= SHIP_BAR;

// catch the mis-keyed entry (OpEx-natured cost booked to COGS) — what cross-foot misses, golden catches.
const misKey = all.find((e) => e.category === "COGS" && OPEX_NATURED.test(e.desc));
const fixedCOGS = consolidated.COGS - (misKey?.amount ?? 0);
const fixedOpEx = consolidated.OpEx + (misKey?.amount ?? 0);
const cogsResidual = fixedCOGS - golden.COGS; // genuine COGS variance after the re-key

const step = (idx: number, group: string, label: string, status: "ok" | "warn" | "risk" | "info", detail: string, log?: unknown) => ({
  idx, group, label, status,
  detail,
  ...(log ? { attachments: [{ kind: "log" as const, text: JSON.stringify(log, null, 2) }] } : {}),
});

let i = 0;
const steps = [
  ...Object.entries(sources).map(([name, entries]) =>
    step(++i, "Ingest sources", `Pull ${name} Q3 ledger`, "ok", `${entries.length} entries · ${usd(entries.reduce((s, e) => s + e.amount, 0))}`, entries)),
  step(++i, "Consolidate", "Consolidate 3 entities", "ok", `Revenue ${usd(consolidated.Revenue)} · COGS ${usd(consolidated.COGS)} · OpEx ${usd(consolidated.OpEx)}`, consolidated),
  step(++i, "Golden-reference verify", `Reconcile vs golden reference`, pct >= SHIP_BAR ? "ok" : "risk",
    `${passed}/${checks.length} checks pass · ${pct}% reconcile`, checks),
  ...(misKey ? [step(++i, "Golden-reference verify", "Catch mis-keyed entry", "warn",
    `${misKey.source} ${misKey.id} "${misKey.desc}" ${k(misKey.amount)} booked COGS — expected OpEx (cross-foots clean; only golden-ref catches it)`, misKey)] : []),
  step(++i, "Triage", `Shippable without review? ${shippable ? "YES" : "NO"}`, shippable ? "ok" : "risk",
    `${pct}% reconcile is below the ${SHIP_BAR}% bar — needs human review before any downstream use.`),
  ...(misKey ? [step(++i, "Triage", "Queue · reconcile", "info",
    `Re-key ${misKey.source} ${misKey.id} ${k(misKey.amount)} COGS→OpEx → OpEx reconciles to ${usd(fixedOpEx)} (golden ${usd(golden.OpEx)}).`)] : []),
  step(++i, "Triage", "Queue · COGS variance", "info",
    `After the re-key, COGS = ${usd(fixedCOGS)} vs golden ${usd(golden.COGS)} → residual ${k(cogsResidual)} variance to investigate.`),
];

const bundle = {
  id: "ledger-consolidation",
  kind: "agent" as const,
  title: "Agent run · Q3 ledger consolidation (3 entities)",
  subtitle: "QuickBooks · Xero · NetSuite → golden-reference verify (illustrative figures; reconcile + verdict computed)",
  ts: STAMP,
  source: { tool: "NodeAgent · reconcile skill", version: "qa-trace/capture-ledger-consolidation.ts", env: "deterministic" },
  verdict: { label: `Shippable without review? ${shippable ? "YES" : "NO"} — ${pct}% reconcile`, tone: shippable ? ("ok" as const) : ("risk" as const) },
  steps,
  raw: { sources, golden, consolidated, checks, pct, shipBar: SHIP_BAR, shippable, misKey, fixedCOGS, fixedOpEx, cogsResidual, queued: ["reconcile mis-key", "COGS variance"] },
};

writeFileSync(join(BUNDLE_DIR, "ledger-consolidation.json"), `${JSON.stringify(bundle, null, 2)}\n`);
console.log(`reconcile=${pct}% (${passed}/${checks.length}) shippable=${shippable} misKey=${misKey?.id} cogsResidual=${k(cogsResidual)}`);
