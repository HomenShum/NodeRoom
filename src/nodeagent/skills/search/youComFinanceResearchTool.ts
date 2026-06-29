/**
 * You.com Finance Research tool for the NodeAgent.
 *
 * Searches a finance-optimized index (SEC filings, earnings, fundamentals, equity prices,
 * macro indicators, financial news) and synthesizes a cited Markdown answer.
 * Tool name: `you_finance_research`
 * Args:
 *   input (required) — finance research question or topic
 *   researchEffort (optional, default "deep") — "deep" | "exhaustive"
 */

import { z } from "zod";
import type { AgentTool, RoomTools } from "../../core/types";
import { youComFinanceResearch } from "./youComClient";

const schema = z.object({
  input: z.string().min(1).describe("Finance research question or topic (SEC filings, earnings, fundamentals, macro)"),
  researchEffort: z.enum(["deep", "exhaustive"]).optional().describe("Research depth (default: deep)"),
});

export const youComFinanceResearchTool: AgentTool = {
  name: "you_finance_research",
  description:
    "Perform finance-focused research using You.com. Searches SEC filings, earnings reports, " +
    "fundamentals, equity prices, macro indicators, and financial news. Synthesizes a cited " +
    "Markdown answer. Use for finance deep dives: company financials, SEC filings analysis, " +
    "earnings summaries, macro trends. Requires YOUCOM_API_KEY env var. Only 'deep' and " +
    "'exhaustive' effort levels supported.",
  schema,
  async execute(args: z.infer<typeof schema>, rt: RoomTools) {
    const result = await youComFinanceResearch({
      input: args.input,
      researchEffort: args.researchEffort,
    });

    if (result.ok && result.answer) {
      await rt.recordCapture?.({
        url: `https://you.com/finance_research?q=${encodeURIComponent(args.input)}`,
        goal: `You.com finance research: ${args.input.slice(0, 80)}`,
        ok: true,
        title: `You.com Finance Research · ${args.input.slice(0, 60)}`,
        data: result as unknown as Record<string, unknown>,
        steps: (result.citations ?? []).slice(0, 10).map((c) => ({
          phase: "Citation",
          label: c.title.slice(0, 80),
          status: "ok" as const,
          detail: c.url,
        })),
      });
    }

    return result;
  },
};
