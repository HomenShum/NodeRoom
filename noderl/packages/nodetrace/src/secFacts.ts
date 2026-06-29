/**
 * SEC EDGAR data-API lane — the authoritative, structured, FREE source for SEC filings (no scraping,
 * no Browserbase, no box; runs in-Convex via plain fetch). Sidesteps EDGAR's HTML 403 because this is
 * the official data API (data.sec.gov), which serves any client that declares a User-Agent.
 *
 * SSRF: URLs are constructed against FIXED SEC hosts from a ticker/CIK + a concept tag — never an
 * arbitrary user URL — so there's no SSRF surface here.
 *
 * Set SEC_USER_AGENT to a real contact (SEC asks for one); a default is used otherwise.
 */
const SEC_UA = (process.env.SEC_USER_AGENT ?? "NodeRoom Diligence (contact: you@example.com)").trim();

/** Friendly term → ordered candidate us-gaap tags (first that returns annual data wins). */
const CONCEPT_ALIASES: Record<string, string[]> = {
  revenue: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"],
  revenues: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax"],
  "net income": ["NetIncomeLoss"],
  "net income loss": ["NetIncomeLoss"],
  "operating income": ["OperatingIncomeLoss"],
  "gross profit": ["GrossProfit"],
  assets: ["Assets"],
  "total assets": ["Assets"],
  liabilities: ["Liabilities"],
  "total liabilities": ["Liabilities"],
  "stockholders equity": ["StockholdersEquity"],
  cash: ["CashAndCashEquivalentsAtCarryingValue"],
  "research and development": ["ResearchAndDevelopmentExpense"],
  "cost of revenue": ["CostOfRevenue", "CostOfGoodsAndServicesSold"],
  eps: ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
};

export interface SecFact { value: number; fiscalYear?: number; end?: string; form?: string; accn?: string }
export interface SecFactsResult {
  ok: boolean;
  company?: string;
  cik?: string;
  concept?: string;
  tag?: string;
  unit?: string;
  sourceUrl?: string;
  facts?: SecFact[];
  error?: string;
}

async function resolveCik(company: string): Promise<{ cik: string; title: string } | null> {
  const t = company.trim();
  if (/^\d{1,10}$/.test(t)) return { cik: t.padStart(10, "0"), title: company };
  const res = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: { "user-agent": SEC_UA } });
  if (!res.ok) return null;
  const map = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
  const want = t.toUpperCase();
  for (const k of Object.keys(map)) {
    if (map[k].ticker?.toUpperCase() === want) return { cik: String(map[k].cik_str).padStart(10, "0"), title: map[k].title };
  }
  return null;
}

interface XbrlUnit { end?: string; val?: number; accn?: string; fy?: number; fp?: string; form?: string }

export async function fetchSecFacts(opts: { company: string; concept: string; limit?: number }): Promise<SecFactsResult> {
  const cikInfo = await resolveCik(opts.company);
  if (!cikInfo) return { ok: false, error: `could not resolve ticker/CIK for "${opts.company}"` };

  const tags = CONCEPT_ALIASES[opts.concept.toLowerCase().trim()] ?? [opts.concept];
  for (const tag of tags) {
    const sourceUrl = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cikInfo.cik}/us-gaap/${tag}.json`;
    const res = await fetch(sourceUrl, { headers: { "user-agent": SEC_UA } });
    if (!res.ok) continue; // tag not reported by this filer → try the next candidate
    const data = (await res.json()) as { label?: string; units?: Record<string, XbrlUnit[]> };
    const unit = Object.keys(data.units ?? {})[0];
    if (!unit) continue;
    const annual = (data.units![unit] ?? [])
      .filter((r) => r.form === "10-K" && r.fp === "FY" && typeof r.val === "number")
      .sort((a, b) => (b.fy ?? 0) - (a.fy ?? 0));
    // de-dupe by fiscal year (XBRL repeats prior-year comparatives across filings)
    const seen = new Set<number>();
    const facts: SecFact[] = [];
    for (const r of annual) {
      if (r.fy == null || seen.has(r.fy)) continue;
      seen.add(r.fy);
      facts.push({ value: r.val!, fiscalYear: r.fy, end: r.end, form: r.form, accn: r.accn });
      if (facts.length >= (opts.limit ?? 4)) break;
    }
    if (facts.length) return { ok: true, company: cikInfo.title, cik: cikInfo.cik, concept: data.label ?? tag, tag, unit, sourceUrl, facts };
  }
  return { ok: false, company: cikInfo.title, cik: cikInfo.cik, error: `no annual 10-K data for "${opts.concept}" (tags tried: ${tags.join(", ")})` };
}
