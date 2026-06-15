import { z } from "zod";
import type { AgentTool } from "../../core/types";

export const LINKUP_SEARCH_TOOL: AgentTool = {
  name: "linkup_search",
  description: "External web search placeholder for fresh research. Policy: use local room/OKF/source evidence first unless the user explicitly asks for fresh web research.",
  schema: z.object({
    query: z.string(),
    depth: z.enum(["standard", "deep"]),
    expectedSourceType: z.enum(["company_site", "news", "filing", "market_research"]).optional(),
  }),
  execute: async (args: { query: string; depth: "standard" | "deep"; expectedSourceType?: string }) => ({
    ok: false,
    error: "linkup_search_not_configured",
    policy: "Check local room, OKF, spreadsheet, trace, and literal sources before external search.",
    requested: args,
  }),
};

