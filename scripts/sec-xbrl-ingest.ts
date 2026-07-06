/**
 * SEC/XBRL benchmark ingest — turns real SEC EDGAR filings into a scored audit
 * dataset. For each company: pulls companyfacts (public, no auth), aligns the
 * tie-out facts for either the latest selected form (default: 10-K) or an
 * explicit accession to one (accn, current-period end) — handling the dual
 * current/prior balance sheet — then emits a CLEAN task packet plus
 * deterministic INJECTED-error variants whose ground-truth violations come from
 * the same scorer the benchmark grades with (src/eval/secXbrlAudit.ts).
 *
 * Usage: tsx scripts/sec-xbrl-ingest.ts [--form 10-K|10-Q] [--accession ACCN] [CIK ...]
 *   default CIKs = a cross-sector large-cap set and default selection is each
 *   company's latest 10-K. Writes
 *   proofloop/datasets/sec-xbrl/benchmark.json (dataset) and refreshes
 *   fixtures.json (the clean facts, for unit tests).
 *
 * officialScoreClaim: false — DQC-identity audit inspired by FinAuditing, not
 * its official LLM-judged score.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { auditIdentities, violatedIdentityIds, type CompanyXbrlFacts, type XbrlFact } from "../src/eval/secXbrlAudit";

const UA = { "User-Agent": "NodeRoom ProofLoop research hshum2018@gmail.com" };
const INSTANT = ["Assets", "Liabilities", "StockholdersEquity", "LiabilitiesAndStockholdersEquity", "AssetsCurrent", "AssetsNoncurrent", "LiabilitiesCurrent", "LiabilitiesNoncurrent"];
const DURATION = ["NetIncomeLoss", "WeightedAverageNumberOfDilutedSharesOutstanding", "EarningsPerShareDiluted"];

const DEFAULT_CIKS: Array<{ cik: string; name: string }> = [
  { cik: "0000320193", name: "Apple Inc." },
  { cik: "0000789019", name: "Microsoft Corp." },
  { cik: "0000021344", name: "Coca-Cola Co." },
  { cik: "0000200406", name: "Johnson & Johnson" },
];

type Fact = { val: number; end: string; start: string | null; accn: string; filed: string; form: string };
type IngestOptions = { form: string; accession?: string };

async function companyFacts(cik: string): Promise<any> {
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, { headers: UA, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`EDGAR ${cik} -> ${r.status}`);
  return r.json();
}

function rowsFor(facts: any, tag: string): Fact[] {
  const c = facts.facts?.["us-gaap"]?.[tag];
  if (!c) return [];
  return Object.values(c.units).flat() as Fact[];
}

/** Align every tie-out tag to the selected filing's current period (one accn, one end). */
function alignSelectedFiling(facts: any, cik: string, name: string, options: IngestOptions): CompanyXbrlFacts & { accn: string; form: string; period: { instantEnd: string; durationStart: string | null } } {
  const assets = rowsFor(facts, "Assets").filter((f) =>
    options.accession
      ? sameAccession(f.accn, options.accession)
      : f.form === options.form);
  if (assets.length === 0) {
    throw new Error(options.accession
      ? `${name}: no Assets facts for accession ${options.accession}`
      : `${name}: no ${options.form} Assets`);
  }
  const selected = options.accession
    ? assets[0]
    : [...assets].sort((a, b) => (a.filed < b.filed ? 1 : -1))[0];
  const accn = selected.accn;
  const form = selected.form;
  const inThis = assets.filter((f) => f.accn === accn);
  const instantEnd = [...inThis.map((f) => f.end)].sort().at(-1)!; // current period = max balance-sheet date in this filing
  const niRows = rowsFor(facts, "NetIncomeLoss").filter((f) => f.accn === accn && f.end === instantEnd && f.start);
  const durationStart = niRows.length ? [...niRows].sort((a, b) => (a.start! < b.start! ? -1 : 1))[0].start! : null;

  const pick = (tag: string, isInstant: boolean): XbrlFact | null => {
    const rows = rowsFor(facts, tag).filter((f) => f.accn === accn && f.end === instantEnd && (isInstant ? !f.start : f.start === durationStart));
    const f = rows[0];
    return f ? { val: f.val, end: f.end, start: f.start ?? null } : null;
  };
  const out: Record<string, XbrlFact | null> = {};
  for (const t of INSTANT) out[t] = pick(t, true);
  for (const t of DURATION) out[t] = pick(t, false);
  return { cik, name, accn, form, facts: out, period: { instantEnd, durationStart } };
}

/** Deterministic perturbations → known-violation task variants. */
function injectedVariants(clean: CompanyXbrlFacts): Array<{ label: string; company: CompanyXbrlFacts }> {
  const variants: Array<{ label: string; company: CompanyXbrlFacts }> = [];
  const clone = (): CompanyXbrlFacts => JSON.parse(JSON.stringify(clean));
  const A = clean.facts.Assets;
  if (A) {
    const c = clone();
    (c.facts.Assets as XbrlFact).val = A.val + 1_000_000_000; // $1B overstatement
    variants.push({ label: "assets_overstated_1b", company: c });
  }
  const NI = clean.facts.NetIncomeLoss;
  if (NI && clean.facts.EarningsPerShareDiluted && clean.facts.WeightedAverageNumberOfDilutedSharesOutstanding) {
    const c = clone();
    (c.facts.NetIncomeLoss as XbrlFact).val = -NI.val; // DQC_0015-style sign error
    variants.push({ label: "net_income_sign_error", company: c });
  }
  return variants;
}

async function main() {
  const { ciks, options } = parseArgs(process.argv.slice(2));
  const targets = ciks.length ? ciks.map((cik) => ({ cik: cik.padStart(10, "0"), name: cik })) : DEFAULT_CIKS;
  const cleanCompanies: Array<CompanyXbrlFacts & { accn: string; form?: string; period: unknown }> = [];
  const dataset: Array<{ id: string; company: CompanyXbrlFacts; injected: boolean; groundTruthViolatedIds: string[] }> = [];

  for (const t of targets) {
    try {
      const facts = await companyFacts(t.cik);
      const aligned = alignSelectedFiling(facts, t.cik, t.name, options);
      cleanCompanies.push(aligned);
      const cleanTruth = violatedIdentityIds(aligned);
      dataset.push({ id: `${t.cik}-clean`, company: stripMeta(aligned), injected: false, groundTruthViolatedIds: cleanTruth });
      for (const v of injectedVariants(aligned)) {
        dataset.push({ id: `${t.cik}-${v.label}`, company: stripMeta(v.company), injected: true, groundTruthViolatedIds: violatedIdentityIds(v.company) });
      }
      const applicable = auditIdentities(aligned).filter((r) => r.applicable).length;
      console.log(`${t.name}: ${aligned.form} accn ${aligned.accn} end ${aligned.period && (aligned.period as any).instantEnd} · ${applicable} identities applicable · clean violations ${cleanTruth.length}`);
      await new Promise((r) => setTimeout(r, 200)); // stay under SEC 10 req/s
    } catch (e) {
      console.error(`SKIP ${t.name}: ${(e as Error).message}`);
    }
  }

  const outDir = resolve("proofloop/datasets/sec-xbrl");
  mkdirSync(outDir, { recursive: true });
  const selection = options.accession ? `accession ${options.accession}` : `latest ${options.form} per CIK`;
  writeFileSync(resolve(outDir, "benchmark.json"), JSON.stringify({ source: `SEC EDGAR companyfacts (us-gaap), ${selection}, (accn,end)-aligned`, officialScoreClaim: false, generatedFor: "deterministic tie-out audit", items: dataset }, null, 2));
  writeFileSync(resolve(outDir, "fixtures.json"), JSON.stringify({ source: `SEC EDGAR companyfacts API (us-gaap), ${selection}, (accn,end)-aligned`, companies: cleanCompanies.map(stripMeta) }, null, 2));
  console.log(`\nwrote ${dataset.length} task items across ${cleanCompanies.length} filings -> proofloop/datasets/sec-xbrl/benchmark.json`);
}

function stripMeta(c: CompanyXbrlFacts): CompanyXbrlFacts {
  return { cik: c.cik, name: c.name, accn: c.accn, facts: c.facts };
}

function parseArgs(args: string[]): { ciks: string[]; options: IngestOptions } {
  const ciks: string[] = [];
  const options: IngestOptions = { form: "10-K" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--form") {
      options.form = String(args[++i] ?? options.form).toUpperCase();
    } else if (arg.startsWith("--form=")) {
      options.form = arg.slice("--form=".length).toUpperCase();
    } else if (arg === "--accession") {
      options.accession = args[++i];
    } else if (arg.startsWith("--accession=")) {
      options.accession = arg.slice("--accession=".length);
    } else {
      ciks.push(arg);
    }
  }
  return { ciks, options };
}

function sameAccession(a: string, b: string): boolean {
  const compact = (value: string) => value.replace(/-/g, "").trim().toLowerCase();
  return a === b || compact(a) === compact(b);
}

void dirname; // keep import if unused by bundler config
main().catch((e) => { console.error(e); process.exit(1); });
