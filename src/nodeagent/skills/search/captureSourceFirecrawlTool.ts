/**
 * Convex-safe capture_source tool.
 *
 * Browserbase is the exact-box worker substrate, but it pulls in Playwright and should not be bundled
 * into Convex or the browser demo. This tool keeps the production Convex agent path on Firecrawl:
 * screenshot + markdown observation, then our own reasoning model extracts structured values.
 */
import { z } from "zod";
import type { AgentTool, RoomTools } from "../../core/types";
import { runCapture } from "../../capture/pipeline";
import { aiSdkReasoner } from "../../capture/reasoning";
import { firecrawlSubstrate } from "../../capture/substrate/firecrawl";

const schema = z.object({
  url: z.string().url(),
  goal: z.string().describe("what to find or extract on the source page"),
});

export const captureSourceFirecrawlTool: AgentTool = {
  name: "capture_source",
  description:
    "Capture a public source page with Firecrawl, screenshot it, and extract structured values with evidence. " +
    "Use when a finance/GTM claim needs source-of-truth web evidence; use fetch_source for cheaper text-only snippets.",
  schema,
  async execute(args: z.infer<typeof schema>, rt: RoomTools) {
    const r = await runCapture({
      url: args.url,
      goal: args.goal,
      reasoner: aiSdkReasoner(process.env.CAPTURE_REASONING_MODEL),
      substrate: firecrawlSubstrate(),
    });
    // Persist (screenshots + boxes) so this agent capture renders in the Trace tab. Server port only; no-op elsewhere.
    await rt.recordCapture?.({ url: r.url, goal: args.goal, ok: r.ok, title: r.title, error: r.error, data: r.data, steps: r.steps });
    return {
      ok: r.ok,
      url: r.url,
      title: r.title,
      data: r.data,
      ...(r.error ? { error: r.error } : {}),
      steps: r.steps.map((s) => ({
        phase: s.phase,
        label: s.label,
        status: s.status,
        hasScreenshot: !!s.screenshotPng,
        box: s.box ?? null,
      })),
    };
  },
};
