/**
 * You.com Search tool for the NodeAgent.
 *
 * Real-time web+news search via You.com Search API.
 * Tool name: `you_search`
 * Args:
 *   query (required) — search query string
 *   count (optional, default 10) — number of results (max 20)
 *   freshness (optional) — "day" | "week" | "month" | "year"
 *   country (optional) — country code for locale filtering
 */

import { z } from "zod";
import type { AgentTool, RoomTools } from "../../core/types";
import { youComSearch } from "./youComClient";

const schema = z.object({
  query: z.string().min(1).describe("Search query string"),
  count: z.number().int().min(1).max(20).optional().describe("Number of results (default 10, max 20)"),
  freshness: z.enum(["day", "week", "month", "year"]).optional().describe("Time filter for results"),
  country: z.string().optional().describe("Country code for locale filtering (e.g. 'us')"),
});

export const youComSearchTool: AgentTool = {
  name: "you_search",
  description:
    "Search the web in real-time using You.com. Returns news articles, web pages, and " +
    "publicly available information. Use for person deep dives: finding recent news, " +
    "interviews, social media profiles, company announcements, and public appearances. " +
    "Requires YOUCOM_API_KEY env var.",
  schema,
  async execute(args: z.infer<typeof schema>, rt: RoomTools) {
    const result = await youComSearch({
      query: args.query,
      count: args.count,
      freshness: args.freshness,
      country: args.country,
    });

    if (result.ok && result.hits) {
      await rt.recordCapture?.({
        url: `https://you.com/search?q=${encodeURIComponent(args.query)}`,
        goal: `You.com search: ${args.query}`,
        ok: true,
        title: `You.com Search · ${args.query.slice(0, 60)}`,
        data: result as unknown as Record<string, unknown>,
        steps: result.hits.slice(0, 10).map((h) => ({
          phase: "Search Result",
          label: h.title.slice(0, 80),
          status: "ok" as const,
          detail: h.url,
        })),
      });
    }

    return result;
  },
};
