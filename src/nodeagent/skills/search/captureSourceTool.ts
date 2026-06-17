/**
 * capture_source — agent tool. Opens a public URL in a REAL browser, screenshots it, and extracts
 * values WITH the on-screen box each came from (visual provenance). Server-only: needs a Node runtime
 * + capture keys, so it's an opt-in tool for server/worker agent runs — NOT added to the in-memory
 * browser demo tools (where it can't run). Returns a light summary (no raw PNG bytes); the producer /
 * Convex action persists screenshots + boxes into a Trace record.
 */
import { z } from "zod";
import type { AgentTool, RoomTools } from "../../core/types";
import { captureSource } from "../../capture/captureSource";

const schema = z.object({
  url: z.string().url(),
  goal: z.string().describe("what to find / extract on the page"),
});

export const captureSourceTool: AgentTool = {
  name: "capture_source",
  description: "Open a public URL in a real browser, screenshot it, and extract values with the on-screen highlight box each came from. Use for source-of-truth retrieval (filings, web data) where provenance matters.",
  schema,
  async execute(args: z.infer<typeof schema>, _rt: RoomTools) {
    const r = await captureSource({ url: args.url, goal: args.goal });
    // Light, trace-friendly summary — screenshots/boxes are persisted by the caller, not inlined here.
    return {
      ok: r.ok,
      url: r.url,
      title: r.title,
      data: r.data,
      error: r.error,
      steps: r.steps.map((s) => ({ phase: s.phase, label: s.label, status: s.status, hasScreenshot: !!s.screenshotPng, box: s.box ?? null })),
    };
  },
};
