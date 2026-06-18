#!/usr/bin/env node
/**
 * liveflow · reconcile — the engine behind the liveflow skill.
 *
 * Consolidates a multi-entity ledger (QuickBooks / Xero / NetSuite / any JSON ledger), verifies it
 * against a golden reference, catches mis-keyed entries (categorization errors a cross-foot can't see),
 * and gates on "shippable without review?". Zero dependencies (Node 18+).
 *
 *   node reconcile.mjs [ledgerDir]            # default: ../examples
 *        --golden <file>     golden reference (default: <dir>/golden.q3.json)
 *        --ship-bar <pct>    reconcile bar to ship without review (default: golden.shipBarPct or 95)
 *        --json              machine-readable summary
 *        --trace-out <file>  also write a NodeRoom Trace bundle (renders in the Trace tab)
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const VALUE_FLAGS = new Set(["--golden", "--ship-bar", "--trace-out"]);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const positional = [];
for (let i = 0; i < args.length; i++) { const a = args[i]; if (VALUE_FLAGS.has(a)) { i++; continue; } if (!a.startsWith("--")) positional.push(a); }

const dir = positional[0] ?? join(HERE, "..", "examples");
const goldenPath = flag("--golden", join(dir, "golden.q3.json"));
const traceOut = flag("--trace-out", null);
const asJson = args.includes("--json");

const usd = (n) => `$${(n / 1e6).toFixed(2)}M`;
const k = (n) => `${n < 0 ? "−" : "+"}$${Math.abs(Math.round(n / 1e3))}K`;
const OPEX_NATURED = /marketing|advertis|payroll|rent|g&a|software|subscription|sales\s*&\s*marketing|travel|legal|insurance/i;
const COGS_NATURED = /materials|freight|inbound|manufactur|inventory|fulfillment/i;

// 1. load sources + golden reference
const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
const shipBar = Number(flag("--ship-bar", golden.shipBarPct ?? 95));
const tol = golden.tolerance ?? 1000;
const cats = Object.keys(golden.targets);
const ledgers = readdirSync(dir)
  .filter((f) => f.endsWith(".json") && basename(f) !== basename(goldenPath))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));

// 2. consolidate
const consolidated = Object.fromEntries(cats.map((c) => [c, 0]));
const entries = [];
for (const led of ledgers) for (const e of led.entries) { consolidated[e.category] = (consolidated[e.category] ?? 0) + e.amount; entries.push({ ...e, entity: led.entity }); }

// 3. mis-keys (a cost booked to the wrong category — cross-foots clean; only golden-ref catches it)
const misKeys = entries
  .map((e) => {
    if (e.category === "COGS" && OPEX_NATURED.test(e.desc)) return { ...e, expected: "OpEx" };
    if (e.category === "OpEx" && COGS_NATURED.test(e.desc)) return { ...e, expected: "COGS" };
    return null;
  })
  .filter(Boolean);

// post-fix consolidated (move each mis-key to its expected bucket) → residual variances
const fixed = { ...consolidated };
for (const m of misKeys) { fixed[m.category] -= m.amount; fixed[m.expected] = (fixed[m.expected] ?? 0) + m.amount; }

// 4. checks: per-category vs golden + per-entity foot
const checks = [];
for (const c of cats) checks.push({ name: `${c} vs golden`, pass: Math.abs(consolidated[c] - golden.targets[c]) <= tol, delta: consolidated[c] - golden.targets[c] });
for (const led of ledgers) { const sum = led.entries.reduce((s, e) => s + e.amount, 0); checks.push({ name: `${led.entity} foots`, pass: led.reportedTotal == null || Math.abs(sum - led.reportedTotal) <= tol }); }
const passed = checks.filter((c) => c.pass).length;
const pct = Math.round((passed / checks.length) * 100);
const shippable = pct >= shipBar;

// 5. queue: re-key each mis-key, then a variance for any residual category miss
const queue = [];
for (const m of misKeys) queue.push({ kind: "reconcile", title: `Re-key ${m.entity} ${m.id} ${k(m.amount).replace("+", "")} ${m.category}→${m.expected}`, detail: `"${m.desc}" → ${m.expected} reconciles to ${usd(fixed[m.expected])}` });
for (const c of cats) { const resid = fixed[c] - golden.targets[c]; if (Math.abs(resid) > tol) queue.push({ kind: "variance", title: `${c} variance`, detail: `After re-keys, ${c} = ${usd(fixed[c])} vs golden ${usd(golden.targets[c])} → residual ${k(resid)} to investigate` }); }

// ---- human report ----
if (!asJson) {
  const line = (c) => `${c.pass ? "✓" : "✗"} ${c.name}${c.delta != null && !c.pass ? ` (${k(c.delta)})` : ""}`;
  console.log(`\nliveflow · ${golden.period} close — ${ledgers.map((l) => l.entity).join(" · ")}\n`);
  console.log(`Consolidated:  ${cats.map((c) => `${c} ${usd(consolidated[c])}`).join("   ")}`);
  console.log(`Golden ref:    ${cats.map((c) => `${c} ${usd(golden.targets[c])}`).join("   ")}   (${golden.reference})\n`);
  console.log(`Golden-reference verify: ${passed}/${checks.length} checks → ${pct}% reconcile  (bar ${shipBar}%)`);
  for (const c of checks) console.log(`   ${line(c)}`);
  if (misKeys.length) {
    console.log(`\nCaught ${misKeys.length} mis-keyed ${misKeys.length === 1 ? "entry" : "entries"}:`);
    for (const m of misKeys) console.log(`   • ${m.entity} ${m.id} "${m.desc}" ${k(m.amount).replace("+", "")} booked ${m.category} — expected ${m.expected}`);
  }
  console.log(`\nShippable without review?  ${shippable ? "YES" : "NO"}   — ${pct}% reconcile ${shippable ? "meets" : "is below"} the ${shipBar}% bar.`);
  if (queue.length) { console.log(`\nQueued:`); queue.forEach((q, i) => console.log(`   ${i + 1}. ${q.kind} — ${q.title}\n        ${q.detail}`)); }
  console.log("");
} else {
  console.log(JSON.stringify({ period: golden.period, entities: ledgers.map((l) => l.entity), consolidated, golden: golden.targets, reconcilePct: pct, shipBar, shippable, misKeys, queue }, null, 2));
}

// ---- optional: NodeRoom Trace bundle (renders in the Trace work-surface tab) ----
if (traceOut) {
  let i = 0;
  const step = (group, label, status, detail, log) => ({ idx: ++i, group, label, status, detail, ...(log ? { attachments: [{ kind: "log", text: JSON.stringify(log, null, 2) }] } : {}) });
  const steps = [
    ...ledgers.map((l) => step("Ingest sources", `Pull ${l.entity} ${golden.period} ledger`, "ok", `${l.entries.length} entries · ${usd(l.entries.reduce((s, e) => s + e.amount, 0))}`, l.entries)),
    step("Consolidate", "Consolidate entities", "ok", cats.map((c) => `${c} ${usd(consolidated[c])}`).join(" · "), consolidated),
    step("Golden-reference verify", "Reconcile vs golden reference", shippable ? "ok" : "risk", `${passed}/${checks.length} checks · ${pct}% reconcile`, checks),
    ...misKeys.map((m) => step("Golden-reference verify", "Catch mis-keyed entry", "warn", `${m.entity} ${m.id} "${m.desc}" booked ${m.category} — expected ${m.expected} (cross-foots clean; only golden-ref catches it)`, m)),
    step("Triage", `Shippable without review? ${shippable ? "YES" : "NO"}`, shippable ? "ok" : "risk", `${pct}% reconcile ${shippable ? "meets" : "is below"} the ${shipBar}% bar.`),
    ...queue.map((q) => step("Triage", `Queue · ${q.kind === "variance" ? "COGS variance" : "reconcile"}`, "info", q.detail)),
  ];
  const bundle = {
    id: "ledger-consolidation",
    kind: "agent",
    title: `Agent run · ${golden.period} ledger consolidation (${ledgers.length} entities)`,
    subtitle: `${ledgers.map((l) => l.entity).join(" · ")} → golden-reference verify (liveflow skill; reconcile + verdict computed)`,
    ts: process.env.QA_TRACE_STAMP ?? "captured",
    source: { tool: "liveflow skill", version: "skills/liveflow/scripts/reconcile.mjs", env: "deterministic" },
    verdict: { label: `Shippable without review? ${shippable ? "YES" : "NO"} — ${pct}% reconcile`, tone: shippable ? "ok" : "risk" },
    steps,
    raw: { consolidated, golden: golden.targets, checks, pct, shipBar, shippable, misKeys, queue },
  };
  writeFileSync(traceOut, `${JSON.stringify(bundle, null, 2)}\n`);
  if (!asJson) console.log(`trace bundle → ${traceOut}`);
}

// Keep the non-zero gate, but let stdout/stderr flush before Node exits. A direct
// process.exit(1) can truncate the human report when the script is piped by CI.
process.exitCode = shippable ? 0 : 1; // non-zero when it needs review — usable as a CI/close gate
