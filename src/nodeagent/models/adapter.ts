/**
 * model(modelId) — ANY provider behind one AgentModel seam, routed by NodeBench's
 * shared model catalog (copied as ./modelCatalog.ts). The Vercel AI SDK abstracts
 * Anthropic / Google / OpenAI; the cheap + FREE models come through OpenRouter's
 * OpenAI-compatible endpoint. We own the loop + tools; the catalog owns ids +
 * pricing + provider routing.
 *
 * Reuse note (reference_attribution): modelCatalog.ts is copied verbatim from
 * NodeBench `shared/llm/modelCatalog.ts` — the canonical 47-model registry. Do
 * not hand-maintain a parallel pricing table here; reconcile in the catalog.
 *
 * Node-only (AI SDK). The deterministic scriptedModel (no AI SDK) is in scripted.ts.
 * Keys: ANTHROPIC_API_KEY · GOOGLE_GENERATIVE_AI_API_KEY · OPENAI_API_KEY · OPENROUTER_API_KEY.
 */

import { generateText, tool, type ModelMessage, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai, createOpenAI } from "@ai-sdk/openai";
import type { AgentModel, AgentMessage, AgentToolChoice, ToolCall } from "../core/types";
import { getProviderForModel, getModelPricing, resolveModelAlias } from "./modelCatalog";
import { isOpenRouterFreeAutoModel, selectOpenRouterFreeModels } from "./openRouterFreeModels";
import { redactPII } from "../guardrails/gateway";
import { assertProviderEgressAllowed, assertProviderRouteAllowed, type ProviderEgressArtifact, type ProviderRouteEntrypoint } from "../guardrails/egressPolicy";

// OpenRouter = OpenAI-compatible endpoint; this is how the cheap/free models are reached.
// Built lazily (per call) so process.env.OPENROUTER_API_KEY is read AFTER .env.local loads —
// the direct providers already read their key lazily; this matches them.
const openrouter = () => createOpenAI({
  apiKey: envValue("OPENROUTER_API_KEY"),
  baseURL: envValue("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1",
  headers: { "HTTP-Referer": "https://noderoom.local", "X-Title": "NodeRoom benchmark" },
});

const nebius = () => createOpenAI({
  apiKey: envValue("NEBIUS_API_KEY"),
  baseURL: envValue("NEBIUS_BASE_URL") ?? "https://api.tokenfactory.nebius.com/v1",
});

/** Route an id to its provider via the catalog (native prefixes → direct SDK; else → OpenRouter). */
function providerFor(modelId: string): LanguageModel {
  switch (getProviderForModel(modelId)) {
    case "openai": return openai(modelId);
    case "anthropic": return anthropic(modelId);
    case "gemini": return google(modelId);
    case "openrouter": return openrouter().chat(modelId); // OpenRouter speaks Chat Completions, not the Responses API
    case "nebius": return nebius().chat(modelId.replace(/^nebius\//i, ""));
    default: throw new Error(`model(): no provider for "${modelId}" (add it to modelCatalog.modelPricing)`);
  }
}

/** Any catalog model behind the SAME seam — swap freely in the benchmark + the action. */
export function model(modelId: string, options: { entrypoint?: ProviderRouteEntrypoint; artifacts?: ProviderEgressArtifact[] } = {}): AgentModel {
  const aliasModelId = resolveModelAlias(modelId);
  const entrypoint = options.entrypoint ?? "system";
  const artifacts = options.artifacts ?? [];
  // free-auto resolves a concrete free model per call; record the actual one used so the
  // agentRuns audit captures which model produced the cells, not just the "openrouter/free-auto" alias.
  let resolvedModelId = aliasModelId;
  return {
    get name() { return resolvedModelId; },
    async next({ system, messages, tools, signal, toolChoice }) {
      assertProviderEgressAllowed({ model: aliasModelId, entrypoint, artifacts, env: process.env });
      const safeSystem = redactPII(system).text;
      const safeMessages = messages.map((m) => (m.role === "user" && m.content ? { ...m, content: redactPII(m.content).text } : m));
      const sdkTools = Object.fromEntries(tools.map((t) => [t.name, tool({ description: t.description, inputSchema: t.schema })]));
      const { res, resolvedModel } = await generateAgentText(aliasModelId, safeSystem, toSdkMessages(safeMessages), sdkTools, signal, entrypoint, artifacts, toolChoice);
      resolvedModelId = resolvedModel;
      const toolCalls: ToolCall[] = (res.toolCalls ?? []).map((tc: { toolCallId: string; toolName: string; input?: Record<string, unknown>; providerMetadata?: Record<string, unknown> }) => ({ id: tc.toolCallId, tool: tc.toolName, args: tc.input ?? {}, providerMetadata: tc.providerMetadata }));
      return {
        text: res.text || undefined,
        toolCalls,
        done: toolCalls.length === 0,
        usage: { inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0, cachedInputTokens: (res.usage as { cachedInputTokens?: number } | undefined)?.cachedInputTokens ?? 0 },
      };
    },
  };
}

/** Back-compat alias (Convex action default). */
export const anthropicModel = (modelId = "claude-haiku-4-5"): AgentModel => model(modelId);

/** A plain text/JSON completion (no tools) — used by the eval's LLM-judge. */
export async function judge(modelId: string, prompt: string): Promise<string> {
  const safePrompt = redactPII(prompt).text;
  const res = await generatePromptText(resolveModelAlias(modelId), safePrompt);
  return res.text ?? "";
}

/** Cost from the catalog's pricing (per 1M tokens) — single source of truth, no parallel table. */
export const priceRun = (modelId: string, inTok: number, outTok: number): number => {
  const p = getModelPricing(resolveModelAlias(modelId));
  return (inTok * (p?.inputPer1M ?? 1) + outTok * (p?.outputPer1M ?? 5)) / 1_000_000;
};

// Our AgentMessage[] → the AI SDK's message shape (kept loose; SDK part types are version-specific).
type SdkToolSet = Record<string, any>;
type GenerateTextResultAny = any;

// ── Production reliability: retry transient failures (429/5xx/network) with exp backoff + jitter,
// honoring the deadline AbortSignal, plus an optional cross-model fallback. (async_reliability layer 2)
const TRANSIENT_RE = /(\b429\b|\b5\d\d\b|rate.?limit|overloaded|temporar|timed?.?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up|service unavailable)/i;
export function isTransientError(error: unknown): boolean {
  if (error instanceof Error && (error.name === "AbortError" || /\baborted\b/i.test(error.message))) return false; // deadline abort → never retry
  const m = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return TRANSIENT_RE.test(m);
}
/** attempt 1→2s, 2→6s, 3→18s, + up to 30% jitter (no thundering herd). */
export function retryBackoffMs(attempt: number): number {
  const base = 2000 * Math.pow(3, attempt - 1);
  return base + Math.floor(Math.random() * 0.3 * base);
}
function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); }, { once: true });
  });
}
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try { return await fn(); }
    catch (error) {
      lastError = error;
      if (signal?.aborted || !isTransientError(error) || attempt > maxRetries) throw error;
      await abortableSleep(retryBackoffMs(attempt), signal); // interrupted if the deadline fires → hands off
    }
  }
  throw lastError;
}
/** Optional cross-model safety net after the primary path's retries exhaust (e.g. free-tier outage). */
function fallbackModelFor(modelId: string): string | undefined {
  const fb = process.env.AGENT_FALLBACK_MODEL?.trim();
  return fb && resolveModelAlias(fb) !== modelId ? resolveModelAlias(fb) : undefined;
}

async function generateAgentText(
  modelId: string,
  system: string,
  messages: ModelMessage[],
  sdkTools: SdkToolSet,
  signal?: AbortSignal,
  entrypoint: ProviderRouteEntrypoint = "system",
  artifacts: ProviderEgressArtifact[] = [],
  toolChoice?: AgentToolChoice,
): Promise<{ res: GenerateTextResultAny; resolvedModel: string }> {
  if (!isOpenRouterFreeAutoModel(modelId)) {
    const call = (id: string) => {
      assertProviderRouteAllowed({ model: id, entrypoint, env: process.env });
      assertProviderEgressAllowed({ model: id, entrypoint, artifacts, env: process.env });
      return withRetry(() => generateText({
        model: providerFor(id),
        system,
        messages,
        tools: sdkTools,
        toolChoice: Object.keys(sdkTools).length ? sdkToolChoiceForModel(id, toolChoice) : undefined,
        abortSignal: signal,
      }), signal);
    };
    try {
      return { res: await call(modelId), resolvedModel: modelId };
    } catch (error) {
      const fb = fallbackModelFor(modelId);
      if (!fb || signal?.aborted) throw error;
      return { res: await call(fb), resolvedModel: fb }; // primary exhausted retries → cross-model safety net
    }
  }
  const candidates = await selectOpenRouterFreeModels({
    mode: Object.keys(sdkTools).length ? "agent" : "chat",
    limit: openRouterFreeAutoLimit(),
    signal,
  });
  let lastError: unknown;
  const attempted: string[] = [];
  for (const candidate of candidates) {
    attempted.push(candidate.id);
    try {
      assertProviderRouteAllowed({ model: candidate.id, entrypoint, env: process.env });
      assertProviderEgressAllowed({ model: candidate.id, entrypoint, artifacts, env: process.env });
      return { res: await withRetry(() => generateText({
        model: openrouter().chat(candidate.id),
        system,
        messages,
        tools: sdkTools,
        toolChoice: Object.keys(sdkTools).length ? sdkToolChoiceForModel(candidate.id, toolChoice) : undefined,
        abortSignal: signal,
      }), signal), resolvedModel: candidate.id };
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;
    }
  }
  throw new Error(`openrouter/free-auto failed for ${attempted.join(", ")}: ${shortProviderError(lastError)}`);
}

async function generatePromptText(modelId: string, prompt: string): Promise<GenerateTextResultAny> {
  if (!isOpenRouterFreeAutoModel(modelId)) {
    assertProviderRouteAllowed({ model: modelId, entrypoint: "system", env: process.env });
    return generateText({ model: providerFor(modelId), prompt });
  }
  const candidates = await selectOpenRouterFreeModels({ mode: "chat", limit: openRouterFreeAutoLimit() });
  let lastError: unknown;
  const attempted: string[] = [];
  for (const candidate of candidates) {
    attempted.push(candidate.id);
    try {
      assertProviderRouteAllowed({ model: candidate.id, entrypoint: "system", env: process.env });
      return await generateText({ model: openrouter().chat(candidate.id), prompt });
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`openrouter/free-auto prompt failed for ${attempted.join(", ")}: ${shortProviderError(lastError)}`);
}

function openRouterFreeAutoLimit(): number {
  const raw = Number(envValue("OPENROUTER_FREE_AUTO_LIMIT") ?? 8);
  return Number.isFinite(raw) ? Math.max(1, Math.min(20, raw)) : 8;
}

function shortProviderError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of Object.values(process.env)) {
    const trimmed = value?.trim();
    if (trimmed && trimmed.length > 12) message = message.replaceAll(trimmed, "[redacted]");
    if (value && value.length > 12) message = message.replaceAll(value, "[redacted]");
  }
  return message.replace(/\s+/g, " ").slice(0, 240);
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function sdkToolChoiceForModel(modelId: string, requested?: AgentToolChoice): AgentToolChoice {
  const choice = requested ?? "auto";
  if (choice === "required" && getProviderForModel(modelId) === "openrouter" && /^(?:qwen\/qwen3(?:[.-]|$)|qwen3(?:[.-]|$))/i.test(modelId)) {
    return "auto";
  }
  return choice;
}

function toSdkMessages(messages: AgentMessage[]): ModelMessage[] {
  const out = messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "assistant") {
      const parts: unknown[] = [];
      if (m.content) parts.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) parts.push({ type: "tool-call", toolCallId: tc.id, toolName: tc.tool, input: tc.args, ...(tc.providerMetadata ? { providerOptions: tc.providerMetadata } : {}) });
      return { role: "assistant", content: parts.length ? parts : m.content };
    }
    return { role: "tool", content: [{ type: "tool-result", toolCallId: m.toolCallId, toolName: m.toolName, output: { type: "text", value: m.content } }] };
  });
  return out as ModelMessage[];
}
