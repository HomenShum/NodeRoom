/**
 * Tavily Search tool for the NodeAgent.
 *
 * LLM-optimized web search via Tavily API. Returns clean, structured results
 * with relevance scores and optional LLM-generated answer synthesis.
 *
 * Tool name: `tavily_search`
 * Args:
 *   query (required) — natural language search query
 *   maxResults (optional, default 10) — number of results (max 20)
 *   searchDepth (optional, default "basic") — "basic" | "advanced"
 *   topic (optional, default "general") — "general" | "news" | "finance"
 *   includeAnswer (optional, default true) — include LLM-synthesized answer
 *   timeRange (optional) — "day" | "week" | "month" | "year"
 *   includeDomains (optional) — restrict to specific domains
 *   excludeDomains (optional) — exclude specific domains
 */

import { z } from "zod";
import type { AgentTool, RoomTools } from "../../core/types";
import { tavilySearch } from "./tavilyClient";

const schema = z.object({
  query: z.string().min(1).describe("Natural language search query"),
  maxResults: z.number().int().min(1).max(20).optional().describe("Max results to return (default 10, max 20)"),
  searchDepth: z.enum(["basic", "advanced"]).optional().describe("Search depth: 'basic' (fast, 1 credit) or 'advanced' (reranked, 2 credits)"),
  topic: z.enum(["general", "news", "finance"]).optional().describe("Search category: general, news, or finance"),
  includeAnswer: z.boolean().optional().describe("Include LLM-synthesized answer from results (default true)"),
  timeRange: z.enum(["day", "week", "month", "year"]).optional().describe("Time filter for results"),
  includeDomains: z.array(z.string()).optional().describe("Restrict results to these domains (e.g. ['bloomberg.com', 'reuters.com'])"),
  excludeDomains: z.array(z.string()).optional().describe("Exclude these domains from results"),
});

export const tavilySearchTool: AgentTool = {
  name: "tavily_search",
  description:
    "Search the web using Tavily — an LLM-optimized search API built for agents. " +
    "Returns clean, structured results with relevance scores and an optional synthesized answer. " +
    "Supports topic filtering (general/news/finance), time range, and domain include/exclude. " +
    "Use for person deep dives: finding recent news, interviews, company announcements, financial filings. " +
    "Use topic='finance' for SEC filings and financial data, topic='news' for recent coverage. " +
    "Requires TAVILY_API_KEY env var. Free tier: 1,000 credits/month.",
  schema,
  async execute(args: z.infer<typeof schema>, rt: RoomTools) {
    const result = await tavilySearch({
      query: args.query,
      maxResults: args.maxResults,
      searchDepth: args.searchDepth,
      topic: args.topic,
      includeAnswer: args.includeAnswer,
      includeDomains: args.includeDomains,
      excludeDomains: args.excludeDomains,
      timeRange: args.timeRange,
    });

    if (result.ok && result.hits) {
      await rt.recordCapture?.({
        url: `https://tavily.com/search?q=${encodeURIComponent(args.query)}`,
        goal: `Tavily search: ${args.query}`,
        ok: true,
        title: `Tavily · ${args.query.slice(0, 60)}`,
        data: result as unknown as Record<string, unknown>,
        steps: result.hits.slice(0, 10).map((h) => ({
          phase: "Search Result",
          label: `${h.title.slice(0, 70)} (${(h.score * 100).toFixed(0)}%)`,
          status: "ok" as const,
          detail: h.url,
        })),
      });
    }

    return result;
  },
};
