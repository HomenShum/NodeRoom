/**
 * aiSdkReasoner — the default ReasoningModel, provider-agnostic via the Vercel AI SDK (already a repo
 * dep). Pick the provider by model id; the AI SDK clients auto-read ANTHROPIC_API_KEY / OPENAI_API_KEY
 * from the environment. This is the "bring your own reasoning model" seam: swap this impl (or its id)
 * to route act/observe/extract through any model — Claude, GPT, a local endpoint — without touching the
 * pipeline. Vision models additionally get the screenshot, so observe/extract can reason over pixels.
 */
import { generateObject, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { claudeEffortProviderOptions, getProviderForModel, resolveModelAlias } from "../models/modelCatalog";
import type { ReasoningModel } from "./types";

// Trim env keys: a stray trailing \r (Windows copy/pipe artifact in `convex env set`) would otherwise
// produce a malformed "Authorization: Bearer …\r" header and break the provider call.
const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY?.trim() });
const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY?.trim() });

function providerFor(modelId: string): LanguageModel {
  if (modelId.startsWith("gpt") || modelId.startsWith("o1") || modelId.startsWith("o3") || modelId.startsWith("o4")) return openai(modelId);
  return anthropic(modelId); // default + all claude-* ids
}

export function aiSdkReasoner(modelId = "claude-haiku-5-5"): ReasoningModel {
  // SPEC A.0.10: `convex/capturesNode.ts` passes a client-supplied modelId, and providerFor() picks a provider by prefix alone,
  // so an id the catalog does not know would still dispatch. The resolver throws for it; an unknown free-looking id resolves to
  // `openrouter/free-auto`, which this Anthropic/OpenAI seam cannot serve, so it is refused rather than sent under the raw name.
  // One guard here covers every caller (capturesNode, captureSource, the Firecrawl tool); the RESOLVED id is what dispatches.
  const routeId = resolveModelAlias(modelId);
  const provider = getProviderForModel(routeId);
  if (provider !== "anthropic" && provider !== "openai") throw new Error(`capture_reasoner_route_unsupported:${routeId}`);
  return {
    name: modelId,
    async decide<T>({ system, instruction, context, schema, signal }: {
      system: string; instruction: string; context: import("./types").ReasoningContext; schema: import("zod").ZodType<T>; signal?: AbortSignal;
    }): Promise<T> {
      const text = [
        instruction,
        "",
        `PAGE: ${context.title} — ${context.url}`,
        "ACCESSIBILITY TREE / TEXT:",
        context.a11y,
      ].join("\n");
      const content: Array<{ type: "text"; text: string } | { type: "image"; image: Uint8Array }> = [{ type: "text", text }];
      if (context.screenshot) content.push({ type: "image", image: context.screenshot.png });
      const { object } = await generateObject({
        model: providerFor(routeId),
        schema, // zod schema → generateObject validates the result to T
        system,
        messages: [{ role: "user", content }],
        ...claudeEffortProviderOptions(routeId), // explicit SPEC §1.3 effort for claude-*-5-5
        abortSignal: signal,
      });
      return object as T;
    },
  };
}
