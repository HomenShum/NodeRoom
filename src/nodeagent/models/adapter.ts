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
import type { AgentModel, AgentMessage, AgentTool, AgentToolChoice, ToolCall } from "../core/types";
import {
  getProviderForModel,
  getModelPricing,
  isNodeAgentFreeAutoModel,
  NODEAGENT_FREE_AUTO_MODEL,
  resolveModelAlias,
} from "./modelCatalog";
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

export type ModelAdapterOptions = {
  entrypoint?: ProviderRouteEntrypoint;
  artifacts?: ProviderEgressArtifact[];
  freeAutoMode?: OpenRouterFreeModelMode;
};

/** Any catalog model behind the SAME seam — swap freely in the benchmark + the action. */
export function model(modelId: string, options: ModelAdapterOptions = {}): AgentModel {
  const aliasModelId = resolveModelAlias(modelId);
  const entrypoint = options.entrypoint ?? "system";
  const artifacts = options.artifacts ?? [];
  const freeAutoMode = options.freeAutoMode;
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

const NODEAGENT_PROVIDER_NEUTRAL_POLICY = "nodeagent_provider_neutral_free_first_v1" as const;
const DEFAULT_NODEAGENT_GOOGLE_FALLBACK_MODEL = "gemini-3-flash-preview";

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
      outcome: "accepted" | "provider_wide_exhausted" | "free_routes_cooling";
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
  freeAutoMode?: OpenRouterFreeModelMode,
  qualityContext?: { messages: AgentMessage[]; tools: AgentTool[] },
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
    });
  }
  if (!isOpenRouterFreeAutoModel(modelId)) {
    const call = async (id: string) => {
      const providerRoute = assertProviderRouteAllowed({ model: id, entrypoint, env: process.env });
      assertProviderEgressAllowed({ model: id, entrypoint, artifacts, env: process.env });
      const res = await withRetry(() => generateText({
        model: providerFor(id),
        system,
        messages,
        tools: sdkTools,
        toolChoice: Object.keys(sdkTools).length ? sdkToolChoiceForModel(id, toolChoice) : undefined,
        abortSignal: signal,
      }), signal);
      return { res, providerRoute };
    };
    try {
      return { ...await call(modelId), resolvedModel: modelId };
    } catch (error) {
      const fb = fallbackModelFor(modelId);
      if (!fb || signal?.aborted) throw error;
      return { ...await call(fb), resolvedModel: fb }; // primary exhausted retries → cross-model safety net
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
      const res = await withRetry(() => generateText({
        model: openrouter().chat(candidate.id),
        system,
        messages,
        tools: sdkTools,
        toolChoice: Object.keys(sdkTools).length ? sdkToolChoiceForModel(candidate.id, toolChoice) : undefined,
        abortSignal: context.signal,
      }), context.signal, openRouterFreeCandidateRetries());
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
      const res = await withRetry(() => generateText({
        model: google(fallbackModel),
        system: args.system,
        messages: args.messages,
        tools: args.sdkTools,
        toolChoice: Object.keys(args.sdkTools).length ? sdkToolChoiceForModel(fallbackModel, args.toolChoice) : undefined,
        abortSignal: args.signal,
      }), args.signal);
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
  outcome: "provider_wide_exhausted" | "free_routes_cooling";
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
  primaryOutcome: "accepted" | "provider_wide_exhausted" | "free_routes_cooling";
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

function openRouterFreeAutoLimit(): number {
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
