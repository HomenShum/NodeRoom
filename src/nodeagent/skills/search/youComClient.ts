/**
 * You.com API client for the NodeAgent.
 *
 * Three endpoints:
 *  - Search API: GET https://ydc-index.io/v1/search — real-time web+news results
 *  - Research API: POST https://api.you.com/v1/research — multi-step reasoning, cited Markdown
 *  - Finance Research API: POST https://api.you.com/v1/finance_research — finance-optimized index
 *
 * Auth: X-API-Key header, key from YOUCOM_API_KEY env var.
 */

const SEARCH_API = "https://ydc-index.io/v1/search";
const RESEARCH_API = "https://api.you.com/v1/research";
const FINANCE_RESEARCH_API = "https://api.you.com/v1/finance_research";

function apiKey(): string {
  const key = process.env.YOUCOM_API_KEY;
  if (!key) throw new Error("YOUCOM_API_KEY env var not set");
  return key;
}

export interface YouComSearchHit {
  title: string;
  url: string;
  description: string;
  published_date?: string;
}

export interface YouComSearchResult {
  ok: boolean;
  error?: string;
  query: string;
  hits?: YouComSearchHit[];
}

export async function youComSearch(args: {
  query: string;
  count?: number;
  freshness?: "day" | "week" | "month" | "year";
  country?: string;
}): Promise<YouComSearchResult> {
  const params = new URLSearchParams({ q: args.query });
  if (args.count) params.set("num", String(Math.min(args.count, 20)));
  if (args.freshness) params.set("freshness", args.freshness);
  if (args.country) params.set("country", args.country);

  try {
    const res = await fetch(`${SEARCH_API}?${params}`, {
      method: "GET",
      headers: { "X-API-Key": apiKey() },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { ok: false, error: `You.com Search API error: ${res.status}`, query: args.query };
    }
    const data = await res.json() as any;
    const hits: YouComSearchHit[] = (data.hits ?? []).map((h: any) => ({
      title: h.title ?? "",
      url: h.url ?? "",
      description: h.description ?? "",
      published_date: h.published_date,
    }));
    return { ok: true, query: args.query, hits };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `You.com search failed: ${msg}`, query: args.query };
  }
}

export interface YouComResearchResult {
  ok: boolean;
  error?: string;
  input: string;
  answer?: string;
  citations?: Array<{ title: string; url: string }>;
}

export async function youComResearch(args: {
  input: string;
  researchEffort?: "lite" | "standard" | "deep" | "exhaustive";
}): Promise<YouComResearchResult> {
  try {
    const res = await fetch(RESEARCH_API, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: args.input,
        research_effort: args.researchEffort ?? "standard",
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      return { ok: false, error: `You.com Research API error: ${res.status}`, input: args.input };
    }
    const data = await res.json() as any;
    return {
      ok: true,
      input: args.input,
      answer: data.answer ?? data.response ?? "",
      citations: (data.citations ?? []).map((c: any) => ({
        title: c.title ?? "",
        url: c.url ?? c.link ?? "",
      })),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `You.com research failed: ${msg}`, input: args.input };
  }
}

export interface YouComFinanceResearchResult {
  ok: boolean;
  error?: string;
  input: string;
  answer?: string;
  citations?: Array<{ title: string; url: string }>;
}

export async function youComFinanceResearch(args: {
  input: string;
  researchEffort?: "deep" | "exhaustive";
}): Promise<YouComFinanceResearchResult> {
  try {
    const res = await fetch(FINANCE_RESEARCH_API, {
      method: "POST",
      headers: {
        "X-API-Key": apiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: args.input,
        research_effort: args.researchEffort ?? "deep",
      }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) {
      return { ok: false, error: `You.com Finance Research API error: ${res.status}`, input: args.input };
    }
    const data = await res.json() as any;
    return {
      ok: true,
      input: args.input,
      answer: data.answer ?? data.response ?? "",
      citations: (data.citations ?? []).map((c: any) => ({
        title: c.title ?? "",
        url: c.url ?? c.link ?? "",
      })),
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `You.com finance research failed: ${msg}`, input: args.input };
  }
}
