/**
 * You.com Research tool for the NodeAgent.
 *
 * Multi-step reasoning research that reads sources and synthesizes a cited Markdown answer.
 * Tool name: `you_research`
 * Args:
 *   input (required) — research question or topic
 *   researchEffort (optional, default "standard") — "lite" | "standard" | "deep" | "exhaustive"
 */

import { z } from "zod";
import type { AgentTool, RoomTools } from "../../core/types";
import { youComResearch } from "./youComClient";

const schema = z.object({
  input: z.string().min(1).describe("Research question or topic to investigate"),
  researchEffort: z.enum(["lite", "standard", "deep", "exhaustive"]).optional().describe("Research depth (default: standard)"),
});

export const youComResearchTool: AgentTool = {
  name: "you_research",
  description:
    "Perform multi-step research using You.com. Reads multiple sources, synthesizes a " +
    "cited Markdown answer with references. Use for complex research questions that require " +
    "synthesis across sources: person backgrounds, company histories, technology landscapes. " +
    "Requires YOUCOM_API_KEY env var. Slower than you_search but produces cited synthesis.",
  schema,
  async execute(args: z.infer<typeof schema>, rt: RoomTools) {
    const result = await youComResearch({
      input: args.input,
      researchEffort: args.researchEffort,
    });

    if (result.ok && result.answer) {
      await rt.recordCapture?.({
        url: `https://you.com/research?q=${encodeURIComponent(args.input)}`,
        goal: `You.com research: ${args.input.slice(0, 80)}`,
        ok: true,
        title: `You.com Research · ${args.input.slice(0, 60)}`,
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
