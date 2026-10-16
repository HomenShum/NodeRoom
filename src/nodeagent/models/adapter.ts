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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai, createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import type { AgentModel, AgentMessage, AgentTool, AgentToolChoice, ToolCall } from "../core/types";
import {
  claudeEffortProviderOptions,
  forbidsForcedToolChoice,
  getProviderForModel,
  getModelPricing,
  isFreeModelId,
  isNodeAgentFreeAutoModel,
  lookupModelAlias,
  needsStrictTools,
  priceAggregateTokens,
  priceTokens,
  NODEAGENT_FREE_AUTO_MODEL,
  resolveModelAlias,
} from "./modelCatalog";
import { modelMaxOutputTokens } from "./outputTokens";
import { DEFAULT_AGENT_MODEL } from "../../../convex/modelDefaults";
import {
  OPENROUTER_FREE_AUTO_MODEL,
  isOpenRouterFreeAutoModel,
  openRouterFreeCandidateSignal,
  openRouterFreeCandidateTimeoutMs,
  openRouterFreeRequestReserveMs,
  openRouterFreeRequestSignal,
  openRouterFreeRequestTimeoutMs,
  openRouterFreeRouteHealthSnapshot,
  recordOpenRouterFreeRouteOutcome,
  restoreOpenRouterFreeRouteHealth,
  selectOpenRouterFreeModels,
  type OpenRouterFreeModelMode,
} from "./openRouterFreeModels";
import { QualityFailoverError, assessAgentToolTurnQuality, runQualityFailover, type QualityFailoverReceipt } from "./qualityFailover";
import { redactPII } from "../guardrails/gateway";
import {
  assertProviderEgressAllowed,
  assertProviderRouteAllowed,
  isProviderNonRetryableError,
  providerNonRetryableReason,
  type ProviderEgressArtifact,
  type ProviderRouteEntrypoint,
  type ProviderRouteReceipt,
} from "../guardrails/egressPolicy";

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

/**
 * How many provider requests one logical turn may issue. `withRetry` is the ONLY retry layer (the AI SDK's
 * own loop is pinned to 0), so every physical request is one attempt carrying its own reservation.
 * The ladder receipt policy is { maxRetries: 0, crossModelFallback: false }.
 */
export type DispatchPolicy = {
  maxRetries: number;
  crossModelFallback: boolean;
  /**
   * SPEC A.0.10: a free primary never falls back to a paid model unless this is `true` AND the request carries a
   * `SpendMeter` (`meteredDispatch` reserves the paid model's worst case before the request is issued).
   */
  allowPaidFallback?: boolean;
};
export const DEFAULT_DISPATCH_POLICY: DispatchPolicy = { maxRetries: 3, crossModelFallback: true };

/**
 * One provider request as the receipt needs it (SPEC A.0.3): what was asked for, what the adapter chose, the
 * model string the PROVIDER answered with (`echoedModel`, null when the request threw), its usage, its cost
 * (the settled price, or the full reservation when usage is unknown) and whether it was a fallback dispatch.
 */
export type DispatchRecord = {
  requestedModel: string;
  resolvedModel: string;
  echoedModel: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  costUsd: number;
  fallbackUsed: boolean;
};

/** A paid run issues at most a few hundred requests; the bound only guards a loop that lost its cap. */
export const MAX_DISPATCH_RECORDS = 4096;

/** Job-wide USD meter for a paid run. Moves at dispatches only (see `meteredDispatch`). */
export type SpendMeter = {
  maxUsd: number;
  spentUsd: number;
  requests: number;
  stoppedBy: null | "spend_budget" | "unpriced_model";
  /** One row per issued request, oldest first, capped at MAX_DISPATCH_RECORDS (`requests` keeps counting). */
  dispatches: DispatchRecord[];
};
export const createSpendMeter = (maxUsd: number): SpendMeter => ({ maxUsd, spentUsd: 0, requests: 0, stoppedBy: null, dispatches: [] });

/** A dispatch the budget cannot cover. `receipt.stopReason` is what runtime.ts turns into a `spend_budget` handoff. */
export class SpendBudgetError extends Error {
  readonly receipt = { stopReason: "spend_budget" as const };
  constructor(message: string) {
    super(message);
    this.name = "SpendBudgetError";
  }
}

/** An id the adapter can route but the catalog cannot price. Never reserved, never dispatched. */
export class UnpricedModelError extends SpendBudgetError {
  constructor(readonly modelId: string) {
    super(`no pricing row for "${modelId}"; add a verified row to modelCatalog.modelPricing before a paid run`);
    this.name = "UnpricedModelError";
  }
}

export type ModelAdapterOptions = {
  entrypoint?: ProviderRouteEntrypoint;
  artifacts?: ProviderEgressArtifact[];
  freeAutoMode?: OpenRouterFreeModelMode;
  /** Retry / cross-model-fallback policy. Defaults to today's behaviour (3 retries, fallback allowed). */
  dispatch?: DispatchPolicy;
  /** When set, every provider request reserves its worst-case cost here before it is issued. */
  meter?: SpendMeter;
  /**
   * Eval and smoke scripts only (SPEC-v9 D1: operator overrides stay pass-through). The id was typed by an operator (CLI flag,
   * `*_LIVE_MODEL`) or picked from the live OpenRouter list: the alias table still applies, but an id the catalog does not
   * know goes to the provider as written - it does not throw and a concrete `:free` id is not rewritten to the auto router,
   * so a run is measured under the label it was asked for. Server code never sets this; it stays fail-closed (A.0.10).
   */
  operatorSelected?: boolean;
};

/** Any catalog model behind the SAME seam — swap freely in the benchmark + the action. */
export function model(modelId: string, options: ModelAdapterOptions = {}): AgentModel {
  const aliasModelId = options.operatorSelected ? lookupModelAlias(modelId) : resolveModelAlias(modelId);
  const entrypoint = options.entrypoint ?? "system";
  const artifacts = options.artifacts ?? [];
  const freeAutoMode = options.freeAutoMode;
  const dispatchPolicy = options.dispatch ?? DEFAULT_DISPATCH_POLICY;
  const meter = options.meter;
  // free-auto resolves a concrete free model per call; record the actual one used so the
  // agentRuns audit captures which model produced the cells, not just the "openrouter/free-auto" alias.
  let resolvedModelId = aliasModelId;
  return {
    get name() { return resolvedModelId; },
    async next({ system, messages, tools, signal, toolChoice, maxCostUsd }) {
      assertProviderEgressAllowed({ model: aliasModelId, entrypoint, artifacts, env: process.env });
      const safeSystem = redactPII(system).text;
      const safeMessages = messages.map((m) => (m.role === "user" && m.content ? { ...m, content: redactPII(m.content).text } : m));
      const dispatch: DispatchContext = {
        policy: dispatchPolicy,
        requestedModel: modelId,
        meter,
        maxCostUsd,
        inputTokenUpperBound: meter ? requestInputTokenUpperBound(safeSystem, safeMessages, tools) : 0,
      };
      const sdkTools = Object.fromEntries(tools.map((t) => [t.name, tool({ description: t.description, inputSchema: t.schema })]));
      const { res, resolvedModel, providerRoute, qualityFailover } = await generateAgentText(
        aliasModelId,
        safeSystem,
        toSdkMessages(safeMessages),
        sdkTools,
        signal,
        entrypoint,
        artifacts,
        toolChoice,
        freeAutoMode,
        { messages: safeMessages, tools },
        dispatch,
      );
      resolvedModelId = resolvedModel;
      const toolCalls: ToolCall[] = (res.toolCalls ?? []).map((tc: { toolCallId: string; toolName: string; input?: Record<string, unknown>; providerMetadata?: Record<string, unknown> }) => ({ id: tc.toolCallId, tool: tc.toolName, args: tc.input ?? {}, providerMetadata: tc.providerMetadata }));
      return {
        text: res.text || undefined,
        toolCalls,
        done: toolCalls.length === 0,
        usage: { inputTokens: res.usage?.inputTokens ?? 0, outputTokens: res.usage?.outputTokens ?? 0, cachedInputTokens: (res.usage as { cachedInputTokens?: number } | undefined)?.cachedInputTokens ?? 0 },
        ...(providerRoute
          ? { providerRoute: qualityFailover ? { ...providerRoute, qualityFailover } : providerRoute }
          : {}),
      };
    },
  };
}

/** Back-compat alias (Convex action default). */
export const anthropicModel = (modelId = "claude-haiku-5-5"): AgentModel => model(modelId);

/** A plain text/JSON completion (no tools) — used by the eval's LLM-judge. */
export async function judge(modelId: string, prompt: string): Promise<string> {
  const safePrompt = redactPII(prompt).text;
  const res = await generatePromptText(resolveModelAlias(modelId), safePrompt);
  return res.text ?? "";
}

/**
 * Cost of usage SUMMED over several requests, from the catalog's pricing (per 1M tokens) — single source of truth,
 * no parallel table. Base-tier rates only: the long-context tier is a property of one request's prompt, so it is
 * never inferred from a total. A per-request `priceStep` must use `priceRequest`.
 */
export const priceRun = (modelId: string, inTok: number, outTok: number): number => {
  const p = getModelPricing(lookupModelAlias(modelId));
  return p ? priceAggregateTokens(p, inTok, outTok) : (inTok * 1 + outTok * 5) / 1_000_000;
};

/** Cost of ONE provider request (`inTok` is that request's prompt), tier-aware. This is the `priceStep` price. */
export const priceRequest = (modelId: string, inTok: number, outTok: number): number => {
  const p = getModelPricing(lookupModelAlias(modelId));
  return p ? priceTokens(p, inTok, outTok) : (inTok * 1 + outTok * 5) / 1_000_000;
};

/** Same formula as `priceRequest`, but an id with no pricing row throws instead of costing a guessed $1/$5. */
export const priceRequestStrict = (modelId: string, inTok: number, outTok: number): number => {
  const p = getModelPricing(lookupModelAlias(modelId));
  if (!p) throw new UnpricedModelError(modelId);
  return priceTokens(p, inTok, outTok);
};

/**
 * Worst-case USD for ONE provider request: the whole input upper bound at the input price plus the
 * output cap the request carries at the output price. A price-less id is refused, never estimated.
 * Throws `SpendBudgetError` when that exceeds `remainingUsd` (equality is admitted).
 */
export function reserveDispatch(modelId: string, inputTokenUpperBound: number, remainingUsd: number): number {
  const resolved = lookupModelAlias(modelId);
  const p = getModelPricing(resolved);
  if (!p) throw new UnpricedModelError(modelId);
  // The prompt upper bound picks the tier, so a long prompt reserves at the long-context rates.
  const reserveUsd = priceTokens(p, inputTokenUpperBound, modelMaxOutputTokens(resolved));
  if (reserveUsd > remainingUsd) {
    throw new SpendBudgetError(`dispatch to ${modelId} reserves $${reserveUsd.toFixed(6)}, above the $${Math.max(0, remainingUsd).toFixed(6)} left`);
  }
  return reserveUsd;
}

type DispatchContext = {
  policy: DispatchPolicy;
  /** The id the caller asked `model()` for; recorded on every dispatch row. */
  requestedModel?: string;
  meter?: SpendMeter;
  /** Remaining dollars the runtime handed to this turn (`next({ maxCostUsd })`). */
  maxCostUsd?: number;
  inputTokenUpperBound: number;
};

/** Bytes bound tokens (>= 1 byte per token); framing allowance mirrors convexModel's. Used only for reservations. */
export function requestInputTokenUpperBound(system: string, messages: AgentMessage[], tools: AgentTool[]): number {
  const toolSchemas = tools.map((t) => {
    try { return { name: t.name, description: t.description, parameters: z.toJSONSchema(t.schema as z.ZodType) }; }
    catch { return { name: t.name, description: t.description, parameters: "x".repeat(2_048) }; }
  });
  const bytes = new TextEncoder().encode(JSON.stringify({ system, messages, tools: toolSchemas })).byteLength;
  return bytes + 64 * (messages.length + tools.length + 2);
}

/**
 * Run one provider request under the meter. Reserve BEFORE the request (so a request that would cross the
 * cap is never issued), then settle to the priced usage. A request that throws, or answers without usage,
 * keeps its full reservation: unknown usage is charged at the worst case. No meter = no change.
 */
/**
 * The model string the PROVIDER answered with, read from the raw response body (`modelVersion` for Google,
 * `model` for Anthropic / OpenAI-compatible). The AI SDK's `response.modelId` is not used: @ai-sdk/google fills it
 * with the id that was REQUESTED, so it can never show Google serving a request under another model.
 */
export function providerEchoedModel(res: { response?: { body?: unknown } }): string | null {
  const body = res.response?.body;
  if (typeof body !== "object" || body === null) return null;
  const { modelVersion, model: model_ } = body as { modelVersion?: unknown; model?: unknown };
  const echoed = typeof modelVersion === "string" ? modelVersion : typeof model_ === "string" ? model_ : null;
  return echoed && echoed.trim() ? echoed : null;
}

async function meteredDispatch<T extends { usage?: { inputTokens?: number; outputTokens?: number }; response?: { body?: unknown } }>(
  ctx: DispatchContext,
  modelId: string,
  run: () => Promise<T>,
  fallbackUsed = false,
): Promise<T> {
  const meter = ctx.meter;
  if (!meter) return run();
  // A refused reservation or an unpriced id is terminal for the job: nothing may dispatch after it, whatever
  // path (retry, fallback, candidate loop) asks next.
  if (meter.stoppedBy) {
    throw new SpendBudgetError(`dispatch to ${modelId} refused: the meter already stopped (${meter.stoppedBy})`);
  }
  const remaining = Math.min(meter.maxUsd - meter.spentUsd, ctx.maxCostUsd ?? Number.POSITIVE_INFINITY);
  let reserveUsd: number;
  try {
    reserveUsd = reserveDispatch(modelId, ctx.inputTokenUpperBound, remaining);
  } catch (error) {
    meter.stoppedBy = error instanceof UnpricedModelError ? "unpriced_model" : "spend_budget";
    throw error;
  }
  meter.spentUsd += reserveUsd;
  meter.requests += 1;
  const record: DispatchRecord = {
    requestedModel: ctx.requestedModel ?? modelId,
    resolvedModel: modelId,
    echoedModel: null,
    usage: null,
    costUsd: reserveUsd, // unknown usage is charged at the worst case
    fallbackUsed,
  };
  if (meter.dispatches.length < MAX_DISPATCH_RECORDS) meter.dispatches.push(record);
  const res = await run();
  record.echoedModel = providerEchoedModel(res);
  const input = res.usage?.inputTokens;
  const output = res.usage?.outputTokens;
  if (Number.isFinite(input) && Number.isFinite(output)) {
    const settled = priceRequestStrict(modelId, input as number, output as number);
    meter.spentUsd += settled - reserveUsd;
    record.usage = { inputTokens: input as number, outputTokens: output as number };
    record.costUsd = settled;
  }
  return res;
}

// Our AgentMessage[] → the AI SDK's message shape (kept loose; SDK part types are version-specific).
type SdkToolSet = Record<string, any>;
type GenerateTextResultAny = any;

const NODEAGENT_PROVIDER_NEUTRAL_POLICY = "nodeagent_provider_neutral_free_first_v1" as const;
const DEFAULT_NODEAGENT_GOOGLE_FALLBACK_MODEL = DEFAULT_AGENT_MODEL;

type ProviderNeutralBilling = {
  /** This describes route pricing, not the account's eventual invoice or free-tier entitlement. */
  free: boolean;
  classification: "openrouter_zero_price_route" | "catalog_priced" | "pricing_unverified";
  inputPer1M?: number;
  outputPer1M?: number;
  basis: string[];
};

type ProviderNeutralRouteReceipt = ProviderRouteReceipt & {
  providerNeutral: {
    policy: typeof NODEAGENT_PROVIDER_NEUTRAL_POLICY;
    requestedModel: typeof NODEAGENT_FREE_AUTO_MODEL;
    primary: {
      route: typeof OPENROUTER_FREE_AUTO_MODEL;
      outcome: "accepted" | "provider_wide_exhausted" | "free_routes_cooling" | "free_routes_exhausted";
      reason?: string;
      qualityFailover?: QualityFailoverReceipt;
    };
    selected: {
      route: "openrouter_free" | "google_direct";
      model: string;
      provider: "openrouter" | "gemini";
      billing: ProviderNeutralBilling;
    };
  };
};

// ── Production reliability: retry transient failures (429/5xx/network) with exp backoff + jitter,
// honoring the deadline AbortSignal, plus an optional cross-model fallback. (async_reliability layer 2)
const TRANSIENT_RE = /(\b429\b|\b5\d\d\b|rate.?limit|overloaded|temporar|timed?.?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up|service unavailable)/i;
export function isTransientError(error: unknown): boolean {
  if (error instanceof SpendBudgetError) return false; // a refused reservation is a decision, not an outage: never retry it
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
async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, maxRetries = DEFAULT_DISPATCH_POLICY.maxRetries): Promise<T> {
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
function fallbackModelFor(modelId: string, dispatch: DispatchContext): string | undefined {
  if (!dispatch.policy.crossModelFallback) return undefined;
  const fb = process.env.AGENT_FALLBACK_MODEL?.trim();
  const resolved = fb ? resolveModelAlias(fb) : undefined;
  if (!resolved || resolved === modelId) return undefined;
  // Cost class is preserved (A.0.10): free -> paid needs an explicit allowPaidFallback and a meter to reserve against.
  if (isFreeModelId(modelId) && !isFreeModelId(resolved) && !(dispatch.policy.allowPaidFallback === true && dispatch.meter)) return undefined;
  return resolved;
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
  freeAutoMode?: OpenRouterFreeModelMode,
  qualityContext?: { messages: AgentMessage[]; tools: AgentTool[] },
  dispatch: DispatchContext = { policy: DEFAULT_DISPATCH_POLICY, inputTokenUpperBound: 0 },
): Promise<{
  res: GenerateTextResultAny;
  resolvedModel: string;
  providerRoute?: ProviderRouteReceipt;
  qualityFailover?: QualityFailoverReceipt;
}> {
  if (isNodeAgentFreeAutoModel(modelId)) {
    return generateProviderNeutralAgentText({
      system,
      messages,
      sdkTools,
      signal,
      entrypoint,
      artifacts,
      toolChoice,
      freeAutoMode,
      qualityContext,
      dispatch,
    });
  }
  if (!isOpenRouterFreeAutoModel(modelId)) {
    const call = async (id: string, fallbackUsed: boolean) => {
      const providerRoute = assertProviderRouteAllowed({ model: id, entrypoint, env: process.env });
      assertProviderEgressAllowed({ model: id, entrypoint, artifacts, env: process.env });
      const res = await withRetry(() => meteredDispatch(dispatch, id, () => generateText({
        model: providerFor(id),
        system,
        messages,
        tools: sdkToolsForModel(sdkTools, id, toolChoice),
        toolChoice: Object.keys(sdkTools).length ? sdkToolChoiceForModel(id, toolChoice) : undefined,
        maxOutputTokens: modelMaxOutputTokens(id),
        maxRetries: 0, // withRetry is the only retry layer: every physical request is one reserved attempt
        ...claudeEffortProviderOptions(id), // explicit SPEC §1.3 effort: a vendor default change cannot move the lane
        abortSignal: signal,
      }), fallbackUsed), signal, dispatch.policy.maxRetries);
      return { res, providerRoute };
    };
    try {
      return { ...await call(modelId, false), resolvedModel: modelId };
    } catch (error) {
      // A refused reservation is the budget's decision, not an outage: no fallback model may be tried after it.
      if (error instanceof SpendBudgetError) throw error;
      const fb = fallbackModelFor(modelId, dispatch);
      if (!fb || signal?.aborted) throw error;
      return { ...await call(fb, true), resolvedModel: fb }; // primary exhausted retries → cross-model safety net
    }
  }
  hydrateOpenRouterFreeRouteHealth();
  const requestStartedAt = Date.now();
  const requestSignal = openRouterFreeRequestSignal(signal);
  const candidates = await selectOpenRouterFreeModels({
    mode: freeAutoMode ?? (Object.keys(sdkTools).length ? "agent" : "chat"),
    limit: openRouterFreeAutoLimit(),
    signal: requestSignal,
  });
  const routed = await runQualityFailover({
    candidates: candidates.map((candidate) => ({ ...candidate, provider: "openrouter" })),
    budget: {
      maxAttempts: candidates.length,
      deadlineAt: requestStartedAt + openRouterFreeRequestTimeoutMs(),
      reserveMs: openRouterFreeRequestReserveMs(),
    },
    attemptTimeoutMs: openRouterFreeCandidateTimeoutMs(),
    signal,
    execute: async (candidate, context) => {
      const providerRoute = assertProviderRouteAllowed({ model: candidate.id, entrypoint, env: process.env });
      assertProviderEgressAllowed({ model: candidate.id, entrypoint, artifacts, env: process.env });
      const res = await withRetry(() => meteredDispatch(dispatch, candidate.id, () => generateText({
        model: openrouter().chat(candidate.id),
        system,
        messages,
        tools: sdkToolsForModel(sdkTools, candidate.id, toolChoice),
        toolChoice: Object.keys(sdkTools).length ? sdkToolChoiceForModel(candidate.id, toolChoice) : undefined,
        maxOutputTokens: modelMaxOutputTokens(candidate.id),
        maxRetries: 0,
        abortSignal: context.signal,
      })), context.signal, Math.min(openRouterFreeCandidateRetries(), dispatch.policy.maxRetries));
      return { res, providerRoute };
    },
    assessResult: ({ res }) => assessAgentToolTurnQuality({
      text: res?.text,
      toolCalls: ((res?.toolCalls ?? []) as Array<{ toolName: string; input?: unknown }>).map((call) => ({
        tool: call.toolName,
        args: (call.input ?? {}) as Record<string, unknown>,
      })),
      tools: qualityContext?.tools ?? [],
      messages: qualityContext?.messages,
      requiredToolCall: Object.keys(sdkTools).length > 0 && toolChoice === "required",
    }),
    onRouteAttempt: (attempt, candidate) => {
      if (attempt.outcome === "accepted") {
        recordAndPersistOpenRouterFreeRouteOutcome({ modelId: candidate.id, ok: true, latencyMs: attempt.durationMs });
      } else if (
        attempt.outcome === "provider_failure"
        || attempt.outcome === "quality_failure"
        || (attempt.outcome === "aborted" && attempt.reason === "time_budget_exhausted")
      ) {
        recordAndPersistOpenRouterFreeRouteOutcome({
          modelId: candidate.id,
          ok: false,
          latencyMs: attempt.durationMs,
          error: new Error(attempt.detail ?? attempt.reason),
        });
      }
    },
  });
  if (routed.ok) {
    return {
      res: routed.result.res,
      resolvedModel: routed.candidate.id,
      providerRoute: routed.result.providerRoute,
      qualityFailover: routed.receipt,
    };
  }
  throw adapterQualityFailoverError(routed.receipt, routed.lastError);
}

async function generateProviderNeutralAgentText(args: {
  system: string;
  messages: ModelMessage[];
  sdkTools: SdkToolSet;
  signal?: AbortSignal;
  entrypoint: ProviderRouteEntrypoint;
  artifacts: ProviderEgressArtifact[];
  toolChoice?: AgentToolChoice;
  freeAutoMode?: OpenRouterFreeModelMode;
  qualityContext?: { messages: AgentMessage[]; tools: AgentTool[] };
  dispatch: DispatchContext;
}): Promise<{
  res: GenerateTextResultAny;
  resolvedModel: string;
  providerRoute: ProviderRouteReceipt;
  qualityFailover?: QualityFailoverReceipt;
}> {
  try {
    const primary = await generateAgentText(
      OPENROUTER_FREE_AUTO_MODEL,
      args.system,
      args.messages,
      args.sdkTools,
      args.signal,
      args.entrypoint,
      args.artifacts,
      args.toolChoice,
      args.freeAutoMode,
      args.qualityContext,
      args.dispatch,
    );
    if (!primary.providerRoute) {
      throw new Error(`${NODEAGENT_FREE_AUTO_MODEL} primary route returned no provider receipt`);
    }
    return {
      ...primary,
      providerRoute: providerNeutralRouteReceipt({
        selectedReceipt: primary.providerRoute,
        resolvedModel: primary.resolvedModel,
        primaryOutcome: "accepted",
      }),
    };
  } catch (primaryError) {
    const unavailable = openRouterPrimaryUnavailable(primaryError);
    if (!unavailable || args.signal?.aborted) throw primaryError;
    // The direct Google route is a cross-model fallback (free OpenRouter -> paid Gemini): a policy that forbids
    // cross-model fallback forbids it, and a refused reservation is never recovered from. Cost class is preserved
    // (A.0.10): the paid leg also needs an explicit allowPaidFallback and a meter to reserve against, exactly the
    // guard `fallbackModelFor` applies to every other free -> paid fallback.
    const paidLegAuthorized = args.dispatch.policy.allowPaidFallback === true && !!args.dispatch.meter;
    if (primaryError instanceof SpendBudgetError || !args.dispatch.policy.crossModelFallback || !paidLegAuthorized) throw primaryError;

    const configuredKey = envValue("GOOGLE_GENERATIVE_AI_API_KEY");
    if (!configuredKey) {
      throw providerNeutralRecoveryError(
        primaryError,
        `${unavailable.reason}; direct Google fallback is unavailable because GOOGLE_GENERATIVE_AI_API_KEY is not configured`,
      );
    }

    const fallbackModel = resolveModelAlias(
      envValue("NODEAGENT_FREE_AUTO_GOOGLE_MODEL") ?? DEFAULT_NODEAGENT_GOOGLE_FALLBACK_MODEL,
    );
    if (getProviderForModel(fallbackModel) !== "gemini") {
      throw providerNeutralRecoveryError(
        primaryError,
        `${unavailable.reason}; NODEAGENT_FREE_AUTO_GOOGLE_MODEL must resolve to a direct Gemini model`,
      );
    }

    let providerRoute: ProviderRouteReceipt;
    try {
      providerRoute = assertProviderRouteAllowed({ model: fallbackModel, entrypoint: args.entrypoint, env: process.env });
      assertProviderEgressAllowed({ model: fallbackModel, entrypoint: args.entrypoint, artifacts: args.artifacts, env: process.env });
    } catch (policyError) {
      throw providerNeutralRecoveryError(
        primaryError,
        `${unavailable.reason}; direct Google fallback blocked before provider call: ${shortProviderError(policyError)}`,
        policyError,
      );
    }

    try {
      const res = await withRetry(() => meteredDispatch(args.dispatch, fallbackModel, () => generateText({
        model: google(fallbackModel),
        system: args.system,
        messages: args.messages,
        tools: args.sdkTools,
        toolChoice: Object.keys(args.sdkTools).length ? sdkToolChoiceForModel(fallbackModel, args.toolChoice) : undefined,
        maxOutputTokens: modelMaxOutputTokens(fallbackModel),
        maxRetries: 0,
        abortSignal: args.signal,
      }), true), args.signal, args.dispatch.policy.maxRetries);
      return {
        res,
        resolvedModel: fallbackModel,
        providerRoute: providerNeutralRouteReceipt({
          selectedReceipt: providerRoute,
          resolvedModel: fallbackModel,
          primaryOutcome: unavailable.outcome,
          primaryReason: unavailable.reason,
          primaryQualityFailover: unavailable.receipt,
        }),
      };
    } catch (fallbackError) {
      throw providerNeutralRecoveryError(
        primaryError,
        `${unavailable.reason}; direct Google fallback failed: ${shortProviderError(fallbackError)}`,
        fallbackError,
      );
    }
  }
}

function openRouterPrimaryUnavailable(error: unknown): {
  outcome: "provider_wide_exhausted" | "free_routes_cooling" | "free_routes_exhausted";
  reason: string;
  receipt?: QualityFailoverReceipt;
} | undefined {
  if (error instanceof QualityFailoverError) {
    const terminal = error.receipt.terminalFailure;
    if (terminal?.failureClass === "provider"
      && terminal.providerFailureScope === "global"
      && terminal.providerFailureCategory === "quota") {
      return { outcome: "provider_wide_exhausted", reason: terminal.reason, receipt: error.receipt };
    }
    if (terminal?.providerFailureScope === "global") return undefined;
    if (["no_candidates", "candidates_exhausted", "attempt_budget", "time_budget", "cooldown"]
      .includes(error.receipt.stopReason)) {
      return {
        outcome: "free_routes_exhausted",
        reason: `provider_free_routes_${error.receipt.stopReason}`,
        receipt: error.receipt,
      };
    }
    return undefined;
  }
  if (/openrouter\/free-auto candidates cooling down/i.test(shortProviderError(error))) {
    return { outcome: "free_routes_cooling", reason: "provider_free_routes_cooling" };
  }
  const reason = providerNonRetryableReason(error);
  return reason && /quota|credit/i.test(reason)
    ? { outcome: "provider_wide_exhausted", reason }
    : undefined;
}

function providerNeutralRecoveryError(
  primaryError: unknown,
  detail: string,
  cause: unknown = primaryError,
): Error {
  const message = `${NODEAGENT_FREE_AUTO_MODEL} could not recover after OpenRouter free-route unavailability: ${detail}`;
  if (primaryError instanceof QualityFailoverError) {
    return new QualityFailoverError(message, primaryError.receipt, cause, primaryError.usage);
  }
  return new Error(message, { cause });
}

function providerNeutralRouteReceipt(args: {
  selectedReceipt: ProviderRouteReceipt;
  resolvedModel: string;
  primaryOutcome: "accepted" | "provider_wide_exhausted" | "free_routes_cooling" | "free_routes_exhausted";
  primaryReason?: string;
  primaryQualityFailover?: QualityFailoverReceipt;
}): ProviderNeutralRouteReceipt {
  const provider = args.selectedReceipt.provider;
  if (provider !== "openrouter" && provider !== "gemini") {
    throw new Error(`${NODEAGENT_FREE_AUTO_MODEL} selected unsupported provider ${provider}`);
  }
  const selectedRoute = provider === "openrouter" ? "openrouter_free" : "google_direct";
  const billing = providerNeutralBilling(args.resolvedModel, provider);
  return {
    ...args.selectedReceipt,
    requestedModel: NODEAGENT_FREE_AUTO_MODEL,
    resolvedModel: args.resolvedModel,
    basis: [
      `requested:${NODEAGENT_FREE_AUTO_MODEL}`,
      `resolved:${args.resolvedModel}`,
      `provider_neutral_policy:${NODEAGENT_PROVIDER_NEUTRAL_POLICY}`,
      `primary_route:${OPENROUTER_FREE_AUTO_MODEL}`,
      `primary_outcome:${args.primaryOutcome}`,
      ...(args.primaryReason ? [`primary_reason:${args.primaryReason}`] : []),
      ...args.selectedReceipt.basis.map((basis) => `selected_route:${basis}`),
      ...billing.basis.map((basis) => `billing:${basis}`),
    ],
    providerNeutral: {
      policy: NODEAGENT_PROVIDER_NEUTRAL_POLICY,
      requestedModel: NODEAGENT_FREE_AUTO_MODEL,
      primary: {
        route: OPENROUTER_FREE_AUTO_MODEL,
        outcome: args.primaryOutcome,
        ...(args.primaryReason ? { reason: args.primaryReason } : {}),
        ...(args.primaryQualityFailover ? { qualityFailover: args.primaryQualityFailover } : {}),
      },
      selected: {
        route: selectedRoute,
        model: args.resolvedModel,
        provider,
        billing,
      },
    },
  };
}

function providerNeutralBilling(
  resolvedModel: string,
  provider: "openrouter" | "gemini",
): ProviderNeutralBilling {
  const pricing = getModelPricing(resolvedModel);
  if (provider === "openrouter"
    && resolvedModel.toLowerCase().endsWith(":free")
    && pricing?.inputPer1M === 0
    && pricing.outputPer1M === 0) {
    return {
      free: true,
      classification: "openrouter_zero_price_route",
      inputPer1M: 0,
      outputPer1M: 0,
      basis: ["provider:openrouter", "model_suffix::free", "catalog_input_per_1m:0", "catalog_output_per_1m:0"],
    };
  }
  if (pricing) {
    return {
      free: false,
      classification: "catalog_priced",
      inputPer1M: pricing.inputPer1M,
      outputPer1M: pricing.outputPer1M,
      basis: [
        `provider:${provider}`,
        `catalog_input_per_1m:${pricing.inputPer1M}`,
        `catalog_output_per_1m:${pricing.outputPer1M}`,
        "account_free_tier:not_asserted",
      ],
    };
  }
  return {
    free: false,
    classification: "pricing_unverified",
    basis: [`provider:${provider}`, "account_free_tier:not_asserted", "catalog_pricing:missing"],
  };
}

function qualityAttemptedRoutes(receipt: QualityFailoverReceipt): string[] {
  return receipt.routeAttempts.map((attempt) => attempt.routeId);
}

function adapterQualityFailoverError(
  receipt: QualityFailoverReceipt,
  cause?: unknown,
): QualityFailoverError {
  const attempted = qualityAttemptedRoutes(receipt).join(", ") || "no route attempts";
  if (receipt.stopReason === "time_budget") {
    return new QualityFailoverError(
      `openrouter/free-auto request deadline exceeded after ${attempted}`,
      receipt,
      cause,
    );
  }
  if (receipt.stopReason === "aborted") {
    return new QualityFailoverError(
      `openrouter/free-auto request aborted after ${attempted}`,
      receipt,
      cause,
    );
  }
  const failure = cause
    ?? receipt.terminalFailure?.detail
    ?? receipt.terminalFailure?.reason
    ?? receipt.stopReason;
  return new QualityFailoverError(
    `openrouter/free-auto failed for ${attempted}: ${shortProviderError(failure)}`,
    receipt,
    cause,
  );
}

async function generatePromptText(modelId: string, prompt: string): Promise<GenerateTextResultAny> {
  if (!isOpenRouterFreeAutoModel(modelId)) {
    assertProviderRouteAllowed({ model: modelId, entrypoint: "system", env: process.env });
    return generateText({ model: providerFor(modelId), prompt });
  }
  hydrateOpenRouterFreeRouteHealth();
  const requestSignal = openRouterFreeRequestSignal();
  const candidates = await selectOpenRouterFreeModels({ mode: "chat", limit: openRouterFreeAutoLimit(), signal: requestSignal });
  let lastError: unknown;
  const attempted: string[] = [];
  for (const candidate of candidates) {
    attempted.push(candidate.id);
    const candidateSignal = openRouterFreeCandidateSignal(requestSignal);
    const candidateStarted = Date.now();
    try {
      assertProviderRouteAllowed({ model: candidate.id, entrypoint: "system", env: process.env });
      const res = await withRetry(
        () => generateText({ model: openrouter().chat(candidate.id), prompt, abortSignal: candidateSignal }),
        candidateSignal,
        openRouterFreeCandidateRetries(),
      );
      recordAndPersistOpenRouterFreeRouteOutcome({ modelId: candidate.id, ok: true, latencyMs: Date.now() - candidateStarted });
      return res;
    } catch (error) {
      recordAndPersistOpenRouterFreeRouteOutcome({ modelId: candidate.id, ok: false, latencyMs: Date.now() - candidateStarted, error });
      if (requestSignal.aborted) {
        throw new Error(`openrouter/free-auto prompt deadline exceeded after ${attempted.join(", ")}`);
      }
      if (isProviderNonRetryableError(error)) throw error;
      lastError = error;
    }
  }
  throw new Error(`openrouter/free-auto prompt failed for ${attempted.join(", ")}: ${shortProviderError(lastError)}`);
}

/** Candidates one `openrouter/free-auto` request fans out over (OPENROUTER_FREE_AUTO_LIMIT, default 8, max 20). */
export function openRouterFreeAutoLimit(): number {
  const raw = Number(envValue("OPENROUTER_FREE_AUTO_LIMIT") ?? 8);
  return Number.isFinite(raw) ? Math.max(1, Math.min(20, raw)) : 8;
}

function openRouterFreeCandidateRetries(): number {
  const raw = Number(envValue("OPENROUTER_FREE_CANDIDATE_RETRIES") ?? 0);
  return Number.isFinite(raw) ? Math.max(0, Math.min(2, Math.trunc(raw))) : 0;
}

let openRouterFreeHealthHydrated = false;

function openRouterFreeHealthPersistenceEnabled(): boolean {
  return process.env.NODE_ENV !== "test" && process.env.OPENROUTER_FREE_HEALTH_PERSIST !== "0";
}

function openRouterFreeHealthPath(): string {
  return resolve(process.env.OPENROUTER_FREE_HEALTH_PATH?.trim() || ".proofloop/openrouter-free-route-health.json");
}

function hydrateOpenRouterFreeRouteHealth(): void {
  if (openRouterFreeHealthHydrated) return;
  openRouterFreeHealthHydrated = true;
  if (!openRouterFreeHealthPersistenceEnabled()) return;
  const path = openRouterFreeHealthPath();
  if (!existsSync(path)) return;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as { routes?: ReturnType<typeof openRouterFreeRouteHealthSnapshot> };
    restoreOpenRouterFreeRouteHealth(value.routes ?? []);
  } catch {
    // Ignore a corrupt local cache; the next route outcome replaces it atomically.
  }
}

function recordAndPersistOpenRouterFreeRouteOutcome(args: Parameters<typeof recordOpenRouterFreeRouteOutcome>[0]): void {
  hydrateOpenRouterFreeRouteHealth();
  recordOpenRouterFreeRouteOutcome(args);
  if (!openRouterFreeHealthPersistenceEnabled()) return;
  const path = openRouterFreeHealthPath();
  const temporary = `${path}.${process.pid}.tmp`;
  mkdirSync(dirname(path), { recursive: true });
  const routes = openRouterFreeRouteHealthSnapshot().map(({ lastError: _lastError, ...route }) => route);
  writeFileSync(temporary, `${JSON.stringify({ schema: 1, generatedAt: new Date().toISOString(), routes }, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
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

/** `strict: true` on every tool definition exactly when a forced tool choice was downgraded to `auto` (SPEC §1.3). */
function sdkToolsForModel(sdkTools: SdkToolSet, modelId: string, requested?: AgentToolChoice): SdkToolSet {
  if (!needsStrictTools(modelId, requested)) return sdkTools;
  return Object.fromEntries(Object.entries(sdkTools).map(([name, t]) => [name, { ...t, strict: true }]));
}

function sdkToolChoiceForModel(modelId: string, requested?: AgentToolChoice): AgentToolChoice {
  const choice = requested ?? "auto";
  // Claude 5.5 Sonnet/Opus 400 on a forced tool_choice (SPEC §1.3). `auto` is the transport hint; the harness
  // validates required writes after the turn (convexModel.ts assessConvexTurnQuality / runtime required-tool check).
  if (choice === "required" && forbidsForcedToolChoice(modelId)) return "auto";
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
