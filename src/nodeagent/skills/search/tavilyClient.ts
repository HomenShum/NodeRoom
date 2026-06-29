/**
 * Tavily Search API client for the NodeAgent.
 *
 * Tavily is an LLM-optimized search API built specifically for agents.
 * Returns clean, structured, context-aware web results with relevance scores.
 *
 * API: POST https://api.tavily.com/search
 * Auth: Bearer token (TAVILY_API_KEY env var, starts with "tvly-")
 *
 * Free tier: 1,000 API credits/month, no credit card required.
 */

const TAVILY_API = "https://api.tavily.com/search";

export interface TavilySearchHit {
  title: string;
  url: string;
  content: string;
  score: number;
  published_date?: string;
}

export interface TavilySearchResult {
  ok: boolean;
  error?: string;
  query: string;
  answer?: string;
  hits?: TavilySearchHit[];
}

export async function tavilySearch(args: {
  query: string;
  maxResults?: number;
  searchDepth?: "basic" | "advanced";
  topic?: "general" | "news" | "finance";
  includeAnswer?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  timeRange?: "day" | "week" | "month" | "year";
}): Promise<TavilySearchResult> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "TAVILY_API_KEY env var not set. Get a free key at https://app.tavily.com",
      query: args.query,
    };
  }

  const body: Record<string, unknown> = {
    query: args.query,
    max_results: Math.min(args.maxResults ?? 10, 20),
    search_depth: args.searchDepth ?? "basic",
    topic: args.topic ?? "general",
    include_answer: args.includeAnswer ?? true,
  };
  if (args.includeDomains?.length) body.include_domains = args.includeDomains;
  if (args.excludeDomains?.length) body.exclude_domains = args.excludeDomains;
  if (args.timeRange) body.time_range = args.timeRange;

  try {
    const res = await fetch(TAVILY_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (res.status === 432) {
      return { ok: false, error: "Tavily plan limit exceeded. Upgrade at https://app.tavily.com", query: args.query };
    }
    if (res.status === 433) {
      return { ok: false, error: "Tavily pay-as-you-go limit exceeded", query: args.query };
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, error: `Tavily API error: ${res.status} ${text}`.slice(0, 200), query: args.query };
    }

    const data = await res.json() as any;
    const hits: TavilySearchHit[] = (data.results ?? []).map((r: any) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: r.content ?? "",
      score: r.score ?? 0,
      published_date: r.published_date,
    }));

    return {
      ok: true,
      query: args.query,
      answer: data.answer,
      hits,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Tavily search failed: ${msg}`, query: args.query };
  }
}
