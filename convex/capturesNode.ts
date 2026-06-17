"use node";
/**
 * Live-capture action (Node runtime). Runs our observe/act/extract pipeline with the Firecrawl
 * substrate (pure fetch → safe in Convex; the interactive Browserbase substrate needs a Node worker
 * with playwright, so it is NOT imported here). Stores each screenshot in Convex storage, then persists
 * a Trace record. Honest: a failed capture is still persisted with ok:false so the UI shows the truth.
 *
 * Needs env on the deployment: FIRECRAWL_API_KEY (substrate) + ANTHROPIC_API_KEY or OPENAI_API_KEY
 * (reasoner). With them unset, runCapture returns ok:false and we persist that — never a fake success.
 */
import { v } from "convex/values";
import { makeFunctionReference } from "convex/server";
import { action } from "./_generated/server";
import { actorProofV } from "./lib";
import { runCapture } from "../src/nodeagent/capture/pipeline";
import { firecrawlSubstrate } from "../src/nodeagent/capture/substrate/firecrawl";
import { aiSdkReasoner } from "../src/nodeagent/capture/reasoning";

// Import-only the Firecrawl substrate + pipeline + reasoner (NOT the barrel / browserbase) so the
// Convex bundle never pulls playwright-core.
const assertMemberRef = makeFunctionReference<"query">("captures:assertMember") as any;
const recordRef = makeFunctionReference<"mutation">("captures:record") as any;

export const capture = action({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    url: v.string(),
    goal: v.string(),
    modelId: v.optional(v.string()),
    allowHosts: v.optional(v.array(v.string())),
  },
  handler: async (ctx, a): Promise<{ ok: boolean; error?: string; recordId: string }> => {
    await ctx.runQuery(assertMemberRef, { roomId: a.roomId, requester: a.requester }); // admission control

    const r = await runCapture({
      url: a.url,
      goal: a.goal,
      reasoner: aiSdkReasoner(a.modelId),
      substrate: firecrawlSubstrate(),
      allowHosts: a.allowHosts,
    });

    const steps: Array<{ phase: string; label: string; status: string; detail?: string; box?: { x: number; y: number; w: number; h: number }; screenshotId?: string }> = [];
    for (const s of r.steps) {
      let screenshotId: string | undefined;
      if (s.screenshotPng && s.screenshotPng.byteLength) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Uint8Array is a valid BlobPart at runtime; BlobPart (a DOM type) isn't in Convex's Node tsconfig lib.
        screenshotId = (await ctx.storage.store(new Blob([s.screenshotPng as any], { type: "image/png" }))) as string;
      }
      const step: (typeof steps)[number] = { phase: s.phase, label: s.label, status: s.status };
      if (s.detail !== undefined) step.detail = s.detail;
      if (s.box) step.box = s.box;
      if (screenshotId) step.screenshotId = screenshotId;
      steps.push(step);
    }

    const recordId = (await ctx.runMutation(recordRef, {
      roomId: a.roomId, url: a.url, goal: a.goal, title: r.title, ok: r.ok, error: r.error,
      ts: Date.now(), steps, data: r.data,
    })) as string;

    return { ok: r.ok, error: r.error, recordId };
  },
});
