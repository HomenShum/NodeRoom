/**
 * SEC/XBRL audit benchmark runner — headless capability lane.
 *
 * Presents each real filing's US-GAAP facts + the tie-out identities to a model
 * (direct OpenRouter chat completions by default), asks which identities are VIOLATED, then scores
 * the model's flags against the deterministic ground truth from
 * src/eval/secXbrlAudit.ts. No LLM judge — the grader is arithmetic. Emits a
 * scorecard + receipt.
 *
 * Usage: tsx scripts/sec-xbrl-audit-bench.ts [--models m1,m2] [--limit N]
 *   default models = free OpenRouter models that cleared the gauge.
 *
 * officialScoreClaim: false — capability/shadow lane, not the official
 * FinAuditing score.
 */
import "./benchmark/loadEnv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { IDENTITY_CATALOG, scoreAudit, type CompanyXbrlFacts } from "../src/eval/secXbrlAudit";

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const KEY = process.env.OPENROUTER_API_KEY ?? "";
const DEFAULT_MODELS = ["nvidia/nemotron-3-super-120b-a12b:free", "cohere/north-mini-code:free"];

type Item = { id: string; company: CompanyXbrlFacts; injected: boolean; groundTruthViolatedIds: string[] };
type Row = {
  model: string;
  itemId: string;
  injected: boolean;
  groundTruthViolatedIds: string[];
  flagged: string[] | null;
  f1: number;
  perfect: boolean;
  caughtAny: boolean;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function factsBlock(c: CompanyXbrlFacts): string {
  const lines = Object.entries(c.facts)
    .filter(([, f]) => f)
    .map(([tag, f]) => `  us-gaap:${tag} = ${f!.val}${f!.start ? ` (period ${f!.start}..${f!.end})` : ` (as of ${f!.end})`}`);
  return lines.join("\n");
}

function prompt(item: Item): string {
  const ids = IDENTITY_CATALOG.map((i) => `  - ${i.id}: ${i.label}`).join("\n");
  return `You are auditing a US-GAAP 10-K filing for internal consistency. Below are the company's reported XBRL facts (base units — raw USD or shares), and a set of accounting identities that MUST hold in a valid filing.

FACTS (${item.company.name}, accession ${item.company.accn}):
${factsBlock(item.company)}

IDENTITIES TO CHECK:
${ids}

For each identity whose required facts are ALL present, compute both sides and compare (allow small rounding differences; EPS within $0.02). Identities missing a required fact CANNOT be checked — do NOT flag them.

Return ONLY a JSON array of the ids of the identities that are VIOLATED (do not hold). If every checkable identity holds, return []. No prose, just the JSON array.`;
}

async function callModel(model: string, content: string): Promise<string[] | null> {
  try {
    const r = await fetch(OPENROUTER, {
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "user", content }], temperature: 0, max_tokens: 400 }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const text: string = j.choices?.[0]?.message?.content ?? "";
    const m = text.match(/\[[^\]]*\]/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return null;
  }
}

async function main() {
  if (!KEY) { console.error("OPENROUTER_API_KEY not set"); process.exit(1); }
  const models = (arg("--models") ?? DEFAULT_MODELS.join(",")).split(",").map((s) => s.trim());
  const limit = arg("--limit") ? Number(arg("--limit")) : Infinity;
  const ds = JSON.parse(readFileSync(resolve("proofloop/datasets/sec-xbrl/benchmark.json"), "utf8")) as { items: Item[] };
  const items = ds.items.slice(0, limit);

  const rows: Row[] = [];
  for (const model of models) {
    for (const item of items) {
      const flagged = await callModel(model, prompt(item));
      if (flagged === null) {
        rows.push({ model, itemId: item.id, injected: item.injected, groundTruthViolatedIds: item.groundTruthViolatedIds, flagged: null, f1: 0, perfect: false, caughtAny: false });
        continue;
      }
      const s = scoreAudit(flagged, item.groundTruthViolatedIds);
      const caughtAny = item.groundTruthViolatedIds.some((id) => flagged.includes(id));
      rows.push({ model, itemId: item.id, injected: item.injected, groundTruthViolatedIds: item.groundTruthViolatedIds, flagged, f1: s.f1, perfect: s.perfect, caughtAny });
    }
  }

  const perModel = models.map((model) => {
    const mr = rows.filter((r) => r.model === model && r.flagged !== null);
    const errored = rows.filter((r) => r.model === model && r.flagged === null).length;
    const macroF1 = mr.length ? mr.reduce((a, r) => a + r.f1, 0) / mr.length : 0;
    const exact = mr.length ? mr.filter((r) => r.perfect).length / mr.length : 0;
    const injExact = mr.filter((r) => r.injected && r.perfect).length;
    const injAny = mr.filter((r) => r.injected && r.caughtAny).length;
    const injTotal = mr.filter((r) => r.injected).length;
    return { model, scored: mr.length, errored, macroF1, exactMatchRate: exact, injectedExact: `${injExact}/${injTotal}`, injectedAnyCaught: `${injAny}/${injTotal}` };
  });

  const runId = process.env.SEC_XBRL_RUN_ID ?? "local";
  const outDir = resolve(".proofloop/runs/sec-xbrl", runId);
  mkdirSync(outDir, { recursive: true });
  const receipt = {
    schema: "sec-xbrl-audit-bench-v2",
    officialScoreClaim: false,
    harness: "sec-xbrl-audit-bench-v2",
    runner: "direct_openrouter_chat",
    nodeAgentToolLoop: false,
    grader: "deterministic (src/eval/secXbrlAudit.ts)",
    models,
    itemCount: items.length,
    perModel,
    rows,
  };
  writeFileSync(resolve(outDir, "receipt.json"), JSON.stringify(receipt, null, 2));
  const redactedReceiptPath = resolve("docs/eval/SEC_XBRL_AUDIT_RECEIPT.redacted.json");
  writeFileSync(redactedReceiptPath, `${JSON.stringify(redactedReceipt(receipt), null, 2)}\n`);

  const md = [
    "# SEC/XBRL Audit Benchmark — capability lane (shadow, not official)",
    "",
    `Grader: deterministic arithmetic (no LLM judge). Items: ${items.length} real EDGAR latest-form/accession variants. Data: SEC EDGAR companyfacts (public). Runner: direct OpenRouter chat completions, not NodeAgent tool-loop.`,
    "",
    "| Model | Scored | Errored | Macro-F1 | Exact-match | Injected exact | Injected any-caught |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...perModel.map((m) => `| \`${m.model}\` | ${m.scored} | ${m.errored} | ${m.macroF1.toFixed(3)} | ${(m.exactMatchRate * 100).toFixed(0)}% | ${m.injectedExact} | ${m.injectedAnyCaught} |`),
    "",
    `Per-item redacted receipt: \`${redactedReceiptPath.replace(/\\/g, "/")}\`.`,
    "",
    "_officialScoreClaim: false — DQC-inspired deterministic identity checks, scored arithmetically. Not the official XBRL-US DQC suite and not the official FinAuditing LLM-judged score._",
  ].join("\n");
  writeFileSync(resolve(outDir, "scorecard.md"), md);
  writeFileSync(resolve("docs/eval/SEC_XBRL_AUDIT_SCORECARD.md"), `${md}\n`);
  console.log(md);
  console.log(`\nwrote ${outDir}/receipt.json + scorecard.md and ${redactedReceiptPath}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

function redactedReceipt(receipt: {
  schema: string;
  officialScoreClaim: false;
  harness: string;
  runner: string;
  nodeAgentToolLoop: boolean;
  grader: string;
  models: string[];
  itemCount: number;
  perModel: unknown;
  rows: Row[];
}) {
  return {
    schema: receipt.schema,
    officialScoreClaim: receipt.officialScoreClaim,
    harness: receipt.harness,
    runner: receipt.runner,
    nodeAgentToolLoop: receipt.nodeAgentToolLoop,
    grader: receipt.grader,
    models: receipt.models,
    itemCount: receipt.itemCount,
    perModel: receipt.perModel,
    rows: receipt.rows.map((row) => ({
      model: row.model,
      itemId: row.itemId,
      injected: row.injected,
      groundTruthViolatedIds: row.groundTruthViolatedIds,
      flagged: row.flagged,
      f1: row.f1,
      perfect: row.perfect,
      caughtAny: row.caughtAny,
    })),
  };
}
