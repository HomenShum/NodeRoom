/**
 * Convex-safe AgentModel implementation.
 *
 * The local eval/provider-parser path can keep using the Vercel AI SDK, but
 * Convex function modules should avoid importing it directly because the remote
 * analyzer can evaluate bundled dependencies before the Node action runs. This
 * file implements the small AgentModel seam with direct provider HTTP calls.
 */

import type { AgentMessage, AgentModel, AgentModelRouteState, AgentStep, AgentTool, AgentToolChoice, TokenUsage, ToolCall } from "../core/types";
import { getModelPricing, getProviderForModel, modelPricing, resolveModelAlias } from "./modelCatalog";
import {
  isOpenRouterFreeAutoModel,
  openRouterFreeCandidateTimeoutMs,
  openRouterFreeRequestReserveMs,
  openRouterFreeRequestSignal,
  openRouterFreeRequestTimeoutMs,
  recordOpenRouterFreeRouteOutcome,
  selectOpenRouterFreeModels,
  type OpenRouterFreeModelMode,
} from "./openRouterFreeModels";
import { openAiCompatibleTokenLimitParam } from "./openAiTokenLimit";
import { QualityFailoverError, assessAgentToolTurnQuality, classifyQualityFailoverProviderError, runQualityFailover, type QualityFailoverReceipt } from "./qualityFailover";
import { redactPII } from "../guardrails/gateway";
import { assertProviderRouteAllowed, isProviderNonRetryableError, type ProviderRouteEntrypoint, type ProviderRouteReceipt } from "../guardrails/egressPolicy";

type JsonObject = Record<string, unknown>;

type OpenAiToolCall = {
  id?: string;
  function?: { name?: string; arguments?: string };
};

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_call_id?: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    input_tokens_details?: { cached_tokens?: number };
  };
};

type OpenAiChatStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
  usage?: OpenAiChatResponse["usage"];
};

type OpenAiToolCallDelta = NonNullable<NonNullable<NonNullable<OpenAiChatStreamChunk["choices"]>[number]["delta"]>["tool_calls"]>[number];

type AnthropicResponse = {
  content?: Array<
    | { type: "text"; text?: string }
    | { type: "tool_use"; id?: string; name?: string; input?: JsonObject }
  >;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<
        | { text?: string }
        | { functionCall?: { name?: string; args?: JsonObject }; thoughtSignature?: string; thought_signature?: string }
      >;
    };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
    totalTokenCount?: number;
  };
};

const OPENROUTER_REFERER = "https://noderoom.local";
const OPENROUTER_TITLE = "NodeRoom benchmark";
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
const UNKNOWN_MODEL_RESERVE_INPUT_PER_1M = Object.values(modelPricing)
  .reduce((highest, pricing) => Math.max(highest, pricing.inputPer1M), 1);
const UNKNOWN_MODEL_RESERVE_OUTPUT_PER_1M = Object.values(modelPricing)
  .reduce((highest, pricing) => Math.max(highest, pricing.outputPer1M), 5);
const TRANSIENT_RE = /(\b429\b|\b5\d\d\b|rate.?limit|overloaded|temporar|timed?.?out|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|fetch failed|socket hang up|service unavailable)/i;

export type ConvexModelOptions = {
  entrypoint?: ProviderRouteEntrypoint;
  freeAutoMode?: OpenRouterFreeModelMode;
  /** Ordered, already-authorized fallback routes. Pass [] to keep an explicit model exact. */
  fallbackModelIds?: string[];
  /** Checkpointed concrete-route preference/cooldowns from a prior durable slice. */
  routeState?: AgentModelRouteState;
};

type ConcreteRouteState = {
  preferredModelId: string;
  cooldownUntil: Map<string, number>;
};

class ProviderStepError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown, readonly usage?: TokenUsage) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "ProviderStepError";
    this.cause = cause;
  }
}

function providerTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function openAiUsage(usage?: OpenAiChatResponse["usage"]): TokenUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = providerTokenCount(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = providerTokenCount(usage.completion_tokens ?? usage.output_tokens);
  const rawCachedInputTokens = usage.prompt_tokens_details?.cached_tokens
    ?? usage.input_tokens_details?.cached_tokens;
  const cachedInputTokens = rawCachedInputTokens === undefined ? 0 : providerTokenCount(rawCachedInputTokens);
  if (inputTokens === undefined || outputTokens === undefined || cachedInputTokens === undefined) return undefined;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
  };
}

function anthropicUsage(usage?: AnthropicResponse["usage"]): TokenUsage | undefined {
  if (!usage) return undefined;
  const uncached = providerTokenCount(usage.input_tokens);
  const outputTokens = providerTokenCount(usage.output_tokens);
  const cached = usage.cache_read_input_tokens === undefined ? 0 : providerTokenCount(usage.cache_read_input_tokens);
  const cacheCreation = usage.cache_creation_input_tokens === undefined ? 0 : providerTokenCount(usage.cache_creation_input_tokens);
  if (uncached === undefined || outputTokens === undefined || cached === undefined || cacheCreation === undefined) return undefined;
  return {
    inputTokens: uncached + cached + cacheCreation,
    outputTokens,
    cachedInputTokens: cached,
    cacheCreationInputTokens: cacheCreation,
  };
}

function geminiUsage(usage?: GeminiResponse["usageMetadata"]): TokenUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = providerTokenCount(usage.promptTokenCount);
  const outputTokens = providerTokenCount(usage.candidatesTokenCount);
  const cachedInputTokens = usage.cachedContentTokenCount === undefined ? 0 : providerTokenCount(usage.cachedContentTokenCount);
  if (inputTokens === undefined || outputTokens === undefined || cachedInputTokens === undefined) return undefined;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
  };
}

export function convexModel(modelId: string, options: ConvexModelOptions = {}): AgentModel {
  const aliasModelId = resolveModelAlias(modelId);
  const entrypoint = options.entrypoint ?? "system";
  const freeAutoMode = options.freeAutoMode;
  // Fallbacks must be authorized by the caller that owns artifact-aware egress context.
  // Non-durable/direct call sites remain exact even when deployment fallback env vars exist.
  const fallbackModelIds = normalizeFallbackModelIds(aliasModelId, options.fallbackModelIds ?? []);
  const concreteRouteState = hydrateConcreteRouteState(aliasModelId, fallbackModelIds, options.routeState);
  let resolvedModelId = aliasModelId;
  return {
    get name() {
      return resolvedModelId;
    },
    routeState() {
      return snapshotConcreteRouteState(concreteRouteState);
    },
    async next({ system, messages, tools, signal, onTextDelta, toolChoice, maxCostUsd }) {
      // Gateway PII firewall — redact PII/secrets from the system + user content before the prompt leaves.
      const safeSystem = redactPII(system).text;
      const safeMessages = messages.map((m) => (m.role === "user" && m.content ? { ...m, content: redactPII(m.content).text } : m));
      const { step, resolvedModel } = await generateConvexAgentStep(aliasModelId, safeSystem, safeMessages, tools, entrypoint, signal, onTextDelta, toolChoice, freeAutoMode, fallbackModelIds, concreteRouteState, maxCostUsd);
      resolvedModelId = resolvedModel;
      return step;
    },
  };
}

export function convexPriceRun(modelId: string, inTok: number, outTok: number): number {
  const pricing = getModelPricing(resolveModelAlias(modelId));
  return (inTok * (pricing?.inputPer1M ?? 1) + outTok * (pricing?.outputPer1M ?? 5)) / 1_000_000;
}

function exactConvexUsageCost(
  modelId: string,
  usage: Pick<TokenUsage, "inputTokens" | "outputTokens" | "cachedInputTokens" | "cacheCreationInputTokens">,
): number | undefined {
  const pricing = getModelPricing(resolveModelAlias(modelId));
  if (!pricing) return undefined;
  // The catalog does not yet carry provider cache-write rates. Never label a
  // cache-creation turn exact by silently charging it at the read/input rate.
  if ((usage.cacheCreationInputTokens ?? 0) > 0) return undefined;
  const cachedInputTokens = Math.min(usage.inputTokens, Math.max(0, usage.cachedInputTokens ?? 0));
  const uncachedInputTokens = Math.max(0, usage.inputTokens - cachedInputTokens);
  return (
    uncachedInputTokens * pricing.inputPer1M
    + cachedInputTokens * (pricing.cachedInputPer1M ?? pricing.inputPer1M)
    + usage.outputTokens * pricing.outputPer1M
  ) / 1_000_000;
}

function conservativeRequestInputTokenUpperBound(
  system: string,
  messages: AgentMessage[],
  tools: AgentTool[],
): number {
  const serialized = JSON.stringify({
    system,
    messages,
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: toolParameters(tool.name),
    })),
  });
  const utf8Bytes = new TextEncoder().encode(serialized).byteLength;
  const providerFramingAllowance = 64 * (messages.length + tools.length + 2);
  return utf8Bytes + providerFramingAllowance;
}

function convexAttemptCostReservationUsd(
  modelId: string,
  inputTokenUpperBound: number,
  maxCostUsd?: number,
): number {
  const pricing = getModelPricing(resolveModelAlias(modelId));
  if (!pricing && Number.isFinite(maxCostUsd)) {
    const budget = Math.max(0, maxCostUsd ?? 0);
    return budget + Math.max(1e-9, Math.max(1, budget) * 1e-9);
  }
  const inputPer1M = pricing?.inputPer1M ?? UNKNOWN_MODEL_RESERVE_INPUT_PER_1M;
  const outputPer1M = pricing?.outputPer1M ?? UNKNOWN_MODEL_RESERVE_OUTPUT_PER_1M;
  if (inputPer1M === 0 && outputPer1M === 0) return 0;
  return (
    inputTokenUpperBound * inputPer1M
    + modelMaxOutputTokens() * outputPer1M
  ) / 1_000_000;
}

async function generateConvexAgentStep(
  modelId: string,
  system: string,
  messages: AgentMessage[],
  tools: AgentTool[],
  entrypoint: ProviderRouteEntrypoint,
  signal?: AbortSignal,
  onTextDelta?: (text: string) => void | Promise<void>,
  toolChoice?: AgentToolChoice,
  freeAutoMode?: OpenRouterFreeModelMode,
  fallbackModelIds: string[] = [],
  concreteRouteState?: ConcreteRouteState,
  maxCostUsd?: number,
) {
  assertProviderRouteAllowed({ model: modelId, entrypoint, env: process.env });
  let providerRequests = 0;
  const onProviderRequest = () => {
    providerRequests += 1;
  };
  if (isOpenRouterFreeAutoModel(modelId)) {
    const requestStartedAt = Date.now();
    const requestSignal = openRouterFreeRequestSignal(signal);
    const candidateText = acceptedCandidateTextBuffer(onTextDelta);
    let aggregateInputTokens = 0;
    let aggregateOutputTokens = 0;
    let aggregateCachedInputTokens = 0;
    let aggregateCacheCreationInputTokens = 0;
    let aggregateCostKnown = true;
    const candidates = await selectOpenRouterFreeModels({
      mode: freeAutoMode ?? (tools.length ? "agent" : "chat"),
      limit: openRouterFreeAutoLimit(),
      signal: requestSignal,
    });
    const failover = await runQualityFailover({
      candidates,
      budget: {
        maxAttempts: Math.min(candidates.length, openRouterFreeAutoLimit()),
        deadlineAt: requestStartedAt + openRouterFreeRequestTimeoutMs(),
        reserveMs: openRouterFreeRequestReserveMs(),
        maxCostUsd,
      },
      attemptTimeoutMs: openRouterFreeCandidateTimeoutMs(),
      signal,
      execute: async (candidate, context) => {
        const providerRoute = assertProviderRouteAllowed({ model: candidate.id, entrypoint, env: process.env });
        // The controller owns this deadline; do not wrap it with openRouterFreeCandidateSignal.
        const candidateSignal = context.signal;
        const requestsBefore = providerRequests;
        let step: AgentStep;
        try {
          step = withProviderRoute(await withRetry(() => openAiCompatibleStep({
            endpoint: `${openRouterBaseUrl()}/chat/completions`,
            apiKey: envValue("OPENROUTER_API_KEY"),
            headers: openRouterHeaders(),
            modelId: candidate.id,
            system,
            messages,
            tools,
            signal: candidateSignal,
            onTextDelta: candidateText.sink(candidate.id),
            toolChoice,
            onProviderRequest,
          }), candidateSignal, 0), providerRoute);
        } catch (error) {
          const usage = errorTokenUsage(error);
          accumulateTokenUsage(usage, {
            input: (value) => { aggregateInputTokens += value; },
            output: (value) => { aggregateOutputTokens += value; },
            cached: (value) => { aggregateCachedInputTokens += value; },
            cacheCreation: (value) => { aggregateCacheCreationInputTokens += value; },
          });
          if (providerRequests > requestsBefore && !usage) aggregateCostKnown = false;
          throw error;
        }
        accumulateTokenUsage(step.usage, {
          input: (value) => { aggregateInputTokens += value; },
          output: (value) => { aggregateOutputTokens += value; },
          cached: (value) => { aggregateCachedInputTokens += value; },
          cacheCreation: (value) => { aggregateCacheCreationInputTokens += value; },
        });
        return step;
      },
      assessResult: (step) => assessConvexTurnQuality(step, tools, messages, toolChoice),
      classifyProviderFailure: (error) => {
        const failure = classifyQualityFailoverProviderError(error);
        return isProviderNonRetryableError(error) ? { ...failure, scope: "global" } : failure;
      },
      onRouteAttempt: async (attempt, candidate) => {
        await candidateText.settle(candidate.id, attempt.outcome === "accepted");
        if (
          attempt.outcome !== "accepted"
          && attempt.outcome !== "provider_failure"
          && attempt.outcome !== "quality_failure"
          && !(attempt.outcome === "aborted" && attempt.reason === "time_budget_exhausted")
        ) return;
        recordOpenRouterFreeRouteOutcome({
          modelId: candidate.id,
          ok: attempt.outcome === "accepted",
          latencyMs: attempt.durationMs,
          ...(attempt.outcome === "accepted" ? {} : { error: attempt.detail ?? attempt.reason }),
        });
      },
    });
    if (providerRequests > 0 && failover.receipt.routeAttempts.some((attempt) => attempt.reason === "candidate_timeout")) {
      aggregateCostKnown = false;
    }
    if (failover.ok) {
      return {
        step: {
          ...failover.result,
          usage: {
            inputTokens: aggregateInputTokens,
            outputTokens: aggregateOutputTokens,
            cachedInputTokens: aggregateCachedInputTokens,
            cacheCreationInputTokens: aggregateCacheCreationInputTokens,
            modelCalls: providerRequests,
            ...(aggregateCostKnown
              ? { costUsd: failover.receipt.budget.spentCostUsd, costKind: "exact" as const }
              : { costUsd: failover.receipt.budget.spentCostUsd, costKind: "estimated" as const }),
          },
          providerRoute: {
            ...(failover.result.providerRoute as ProviderRouteReceipt),
            qualityFailover: failover.receipt,
          },
        },
        resolvedModel: failover.candidate.id,
      };
    }
    throw convexQualityFailoverError(failover.receipt, failover.lastError, "openrouter/free-auto", {
      inputTokens: aggregateInputTokens,
      outputTokens: aggregateOutputTokens,
      cachedInputTokens: aggregateCachedInputTokens,
      cacheCreationInputTokens: aggregateCacheCreationInputTokens,
      modelCalls: providerRequests,
      costUsd: failover.receipt.budget.spentCostUsd,
      costKind: aggregateCostKnown ? "exact" as const : "estimated" as const,
    });
  }

  const state = concreteRouteState ?? { preferredModelId: modelId, cooldownUntil: new Map<string, number>() };
  const candidateIds = orderedConcreteCandidateIds(modelId, fallbackModelIds, state.preferredModelId);
  const inputTokenUpperBound = conservativeRequestInputTokenUpperBound(system, messages, tools);
  const candidates = candidateIds.map((id) => ({
    id,
    provider: getProviderForModel(id) ?? undefined,
    cooldownUntil: state.cooldownUntil.get(id),
    estimatedCostUsd: convexAttemptCostReservationUsd(id, inputTokenUpperBound, maxCostUsd),
  }));
  const concreteProviderRequestAttempts = new Set<number>();
  let aggregateInputTokens = 0;
  let aggregateOutputTokens = 0;
  let aggregateCachedInputTokens = 0;
  let aggregateCacheCreationInputTokens = 0;
  let aggregateCostKnown = true;
  let aggregateUsedCostReservation = false;
  const candidateText = acceptedCandidateTextBuffer(onTextDelta);
  const failover = await runQualityFailover({
    candidates,
    budget: { maxAttempts: candidateIds.length, maxCostUsd },
    attemptTimeoutMs: concreteCandidateTimeoutMs(),
    signal,
    execute: async (candidate, context) => {
      const providerRoute = assertProviderRouteAllowed({ model: candidate.id, entrypoint, env: process.env });
      const requestsBefore = providerRequests;
      const onCandidateProviderRequest = () => {
        concreteProviderRequestAttempts.add(context.attempt);
        onProviderRequest();
      };
      let step: AgentStep;
      try {
        step = withProviderRoute(
          await withRetry(
            () => providerStep(candidate.id, system, messages, tools, context.signal, candidateText.sink(candidate.id), toolChoice, onCandidateProviderRequest),
            context.signal,
            0,
          ),
          providerRoute,
        );
      } catch (error) {
        const usage = errorTokenUsage(error);
        accumulateTokenUsage(usage, {
          input: (value) => { aggregateInputTokens += value; },
          output: (value) => { aggregateOutputTokens += value; },
          cached: (value) => { aggregateCachedInputTokens += value; },
          cacheCreation: (value) => { aggregateCacheCreationInputTokens += value; },
        });
        if (providerRequests > requestsBefore && !usage) aggregateCostKnown = false;
        throw error;
      }
      accumulateTokenUsage(step.usage, {
        input: (value) => { aggregateInputTokens += value; },
        output: (value) => { aggregateOutputTokens += value; },
        cached: (value) => { aggregateCachedInputTokens += value; },
        cacheCreation: (value) => { aggregateCacheCreationInputTokens += value; },
      });
      return step;
    },
    assessResult: (step) => assessConvexTurnQuality(step, tools, messages, toolChoice),
    classifyProviderFailure: (error, candidate) => {
      const failure = classifyQualityFailoverProviderError(error);
      // Auth/quota are provider-account local when an explicitly authorized cross-provider
      // candidate exists. Policy/egress failures are global and must never be routed around.
      const candidateIndex = candidateIds.indexOf(candidate.id);
      const hasCrossProviderCandidate = candidateIndex >= 0 && candidateIds.slice(candidateIndex + 1).some((id) => {
        const provider = getProviderForModel(id);
        return !!provider && !!candidate.provider && provider !== candidate.provider;
      });
      return failure.scope === "global"
        && (failure.category === "auth" || failure.category === "quota")
        && hasCrossProviderCandidate
        ? { ...failure, scope: "candidate" as const }
        : failure;
    },
    onRouteAttempt: async (attempt, candidate) => {
      await candidateText.settle(candidate.id, attempt.outcome === "accepted");
      updateConcreteRouteState(state, candidate.id, attempt.outcome, attempt.providerFailureCategory);
    },
    measureCostUsd: ({ candidate, attempt, result, error }) => {
      if (!concreteProviderRequestAttempts.has(attempt)) return 0;
      const usage = result?.usage ?? errorTokenUsage(error);
      if (!usage) {
        aggregateCostKnown = false;
        aggregateUsedCostReservation = true;
        return undefined;
      }
      const measured = exactConvexUsageCost(candidate.id, usage);
      if (measured === undefined) {
        aggregateCostKnown = false;
        aggregateUsedCostReservation = true;
        return undefined;
      }
      return measured;
    },
  });
  if (providerRequests > 0 && failover.receipt.routeAttempts.some((attempt) => attempt.reason === "candidate_timeout")) {
    aggregateCostKnown = false;
  }
  if (!failover.ok) {
    throw convexQualityFailoverError(failover.receipt, failover.lastError ?? failover.lastResult, modelId, {
      inputTokens: aggregateInputTokens,
      outputTokens: aggregateOutputTokens,
      cachedInputTokens: aggregateCachedInputTokens,
      cacheCreationInputTokens: aggregateCacheCreationInputTokens,
      modelCalls: providerRequests,
      ...(aggregateCostKnown
        ? { costUsd: failover.receipt.budget.spentCostUsd, costKind: "exact" as const }
        : { costUsd: failover.receipt.budget.spentCostUsd, costKind: "estimated" as const }),
    });
  }
  return {
    step: {
      ...failover.result,
      usage: {
        inputTokens: aggregateInputTokens,
        outputTokens: aggregateOutputTokens,
        cachedInputTokens: aggregateCachedInputTokens,
        cacheCreationInputTokens: aggregateCacheCreationInputTokens,
        modelCalls: providerRequests,
        ...(aggregateCostKnown
          ? { costUsd: failover.receipt.budget.spentCostUsd, costKind: "exact" as const }
          : aggregateUsedCostReservation
            ? { costUsd: failover.receipt.budget.spentCostUsd, costKind: "estimated" as const }
            : {}),
      },
      providerRoute: {
        ...(failover.result.providerRoute as ProviderRouteReceipt),
        qualityFailover: failover.receipt,
      },
    },
    resolvedModel: failover.candidate.id,
  };
}

function convexQualityFailoverError(
  receipt: QualityFailoverReceipt,
  cause?: unknown,
  routeLabel = "openrouter/free-auto",
  usage?: TokenUsage,
): QualityFailoverError {
  const attempted = receipt.routeAttempts.map((attempt) => attempt.routeId).join(", ") || "no route attempts";
  if (receipt.stopReason === "time_budget") {
    return new QualityFailoverError(
      `${routeLabel} request deadline exceeded after ${attempted}`,
      receipt,
      cause,
      usage,
    );
  }
  if (receipt.stopReason === "aborted") {
    return new QualityFailoverError(
      `${routeLabel} request aborted after ${attempted}`,
      receipt,
      cause,
      usage,
    );
  }
  const failure = cause
    ?? receipt.terminalFailure?.detail
    ?? receipt.terminalFailure?.reason
    ?? receipt.stopReason;
  return new QualityFailoverError(
    `${routeLabel} failed for ${attempted}: ${shortProviderError(failure)}`,
    receipt,
    cause,
    usage,
  );
}

function assessConvexTurnQuality(
  step: AgentStep,
  tools: AgentTool[],
  messages: AgentMessage[],
  toolChoice?: AgentToolChoice,
) {
  // Required-tool protocol recovery belongs to runAgent, which can add corrective context,
  // validate schemas as ordinary tool results, and terminate with a typed protocol_stall receipt.
  // Rejecting here would turn a recoverable four-turn protocol into a generic one-call route error.
  if (toolChoice === "required") return { ok: true as const };
  return assessAgentToolTurnQuality({
    text: step.text,
    toolCalls: step.toolCalls,
    tools,
    messages,
    requiredToolCall: false,
  });
}

function orderedConcreteCandidateIds(
  primaryModelId: string,
  fallbackModelIds: readonly string[],
  preferredModelId: string,
): string[] {
  const authorized = [primaryModelId, ...normalizeFallbackModelIds(primaryModelId, fallbackModelIds)];
  if (!authorized.includes(preferredModelId)) return authorized;
  return [preferredModelId, ...authorized.filter((id) => id !== preferredModelId)];
}

function hydrateConcreteRouteState(
  primaryModelId: string,
  fallbackModelIds: readonly string[],
  persisted?: AgentModelRouteState,
): ConcreteRouteState {
  const allowed = [primaryModelId, ...normalizeFallbackModelIds(primaryModelId, fallbackModelIds)];
  const preferred = persisted?.preferredModelId
    ? resolveModelAlias(persisted.preferredModelId)
    : primaryModelId;
  const now = Date.now();
  const cooldownUntil = new Map<string, number>();
  for (const [candidateId, until] of Object.entries(persisted?.cooldownUntil ?? {})) {
    const normalized = resolveModelAlias(candidateId);
    if (allowed.includes(normalized) && Number.isFinite(until) && until > now) {
      cooldownUntil.set(normalized, until);
    }
  }
  return {
    preferredModelId: allowed.includes(preferred) ? preferred : primaryModelId,
    cooldownUntil,
  };
}

function snapshotConcreteRouteState(state: ConcreteRouteState): AgentModelRouteState {
  const now = Date.now();
  const cooldownUntil: Record<string, number> = {};
  for (const [candidateId, until] of state.cooldownUntil) {
    if (Number.isFinite(until) && until > now) cooldownUntil[candidateId] = until;
  }
  return {
    preferredModelId: state.preferredModelId,
    ...(Object.keys(cooldownUntil).length ? { cooldownUntil } : {}),
  };
}

function errorTokenUsage(error: unknown): TokenUsage | undefined {
  if (error instanceof ProviderStepError) return error.usage;
  if (!error || typeof error !== "object") return undefined;
  const usage = (error as { usage?: unknown }).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const candidate = usage as Partial<TokenUsage>;
  if (!Number.isFinite(candidate.inputTokens) || !Number.isFinite(candidate.outputTokens)) return undefined;
  return candidate as TokenUsage;
}

function accumulateTokenUsage(
  usage: TokenUsage | undefined,
  sinks: {
    input(value: number): void;
    output(value: number): void;
    cached(value: number): void;
    cacheCreation(value: number): void;
  },
): void {
  if (!usage) return;
  sinks.input(usage.inputTokens ?? 0);
  sinks.output(usage.outputTokens ?? 0);
  sinks.cached(usage.cachedInputTokens ?? 0);
  sinks.cacheCreation(usage.cacheCreationInputTokens ?? 0);
}

function updateConcreteRouteState(
  state: ConcreteRouteState,
  candidateId: string,
  outcome: "accepted" | "provider_failure" | "quality_failure" | "control_failure" | "aborted",
  providerFailureCategory?: string,
): void {
  if (outcome === "accepted") {
    state.preferredModelId = candidateId;
    state.cooldownUntil.delete(candidateId);
    return;
  }
  if (outcome !== "provider_failure" && outcome !== "quality_failure") return;
  const cooldownMs = providerFailureCategory === "auth" || providerFailureCategory === "quota"
    ? 5 * 60_000
    : outcome === "quality_failure"
      ? 60_000
      : 30_000;
  state.cooldownUntil.set(candidateId, Date.now() + cooldownMs);
}

async function providerStep(
  modelId: string,
  system: string,
  messages: AgentMessage[],
  tools: AgentTool[],
  signal?: AbortSignal,
  onTextDelta?: (text: string) => void | Promise<void>,
  toolChoice?: AgentToolChoice,
  onProviderRequest?: () => void,
) {
  const provider = getProviderForModel(modelId);
  if (provider === "openai") {
    return openAiCompatibleStep({
      endpoint: "https://api.openai.com/v1/chat/completions",
      apiKey: requireEnv("OPENAI_API_KEY"),
      headers: {},
      modelId,
      system,
      messages,
      tools,
      signal,
      onTextDelta,
      toolChoice,
      onProviderRequest,
    });
  }
  if (provider === "openrouter") {
    return openAiCompatibleStep({
      endpoint: `${openRouterBaseUrl()}/chat/completions`,
      apiKey: envValue("OPENROUTER_API_KEY"),
      headers: openRouterHeaders(),
      modelId,
      system,
      messages,
      tools,
      signal,
      onTextDelta,
      toolChoice,
      onProviderRequest,
    });
  }
  if (provider === "nebius") {
    const nebiusModelId = modelId.replace(/^nebius\//i, "");
    return openAiCompatibleStep({
      endpoint: `${nebiusBaseUrl()}/chat/completions`,
      apiKey: requireEnv("NEBIUS_API_KEY"),
      headers: {},
      modelId: nebiusModelId,
      system,
      messages,
      tools,
      signal,
      onTextDelta,
      toolChoice,
      onProviderRequest,
    });
  }
  if (provider === "anthropic") return anthropicStep(modelId, system, messages, tools, signal, onProviderRequest);
  if (provider === "gemini") {
    if (onTextDelta) {
      const deltas: string[] = [];
      const step = await geminiStreamStep(modelId, system, messages, tools, signal, (text) => {
        deltas.push(text);
      }, onProviderRequest);
      await emitBufferedText(deltas, onTextDelta);
      return step;
    }
    return geminiStep(modelId, system, messages, tools, signal, onProviderRequest);
  }
  throw new Error(`convexModel(): no provider for "${modelId}"`);
}

async function openAiCompatibleStep(args: {
  endpoint: string;
  apiKey?: string;
  headers: Record<string, string>;
  modelId: string;
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  signal?: AbortSignal;
  onTextDelta?: (text: string) => void | Promise<void>;
  toolChoice?: AgentToolChoice;
  onProviderRequest?: () => void;
}) {
  if (args.onTextDelta) {
    const deltas: string[] = [];
    const step = await openAiCompatibleStreamStep({ ...args, onTextDelta: (text) => {
      deltas.push(text);
    } });
    await emitBufferedText(deltas, args.onTextDelta);
    return step;
  }

  return openAiCompatibleBlockingStep(args);
}

function acceptedCandidateTextBuffer(onTextDelta?: (text: string) => void | Promise<void>) {
  const chunks = new Map<string, string[]>();
  return {
    sink(candidateId: string): ((text: string) => void) | undefined {
      if (!onTextDelta) return undefined;
      const buffered: string[] = [];
      chunks.set(candidateId, buffered);
      return (text: string) => {
        if (text) buffered.push(text);
      };
    },
    async settle(candidateId: string, accepted: boolean): Promise<void> {
      const buffered = chunks.get(candidateId) ?? [];
      chunks.delete(candidateId);
      if (accepted && onTextDelta) await emitBufferedText(buffered, onTextDelta);
    },
  };
}

async function emitBufferedText(
  chunks: readonly string[],
  onTextDelta: (text: string) => void | Promise<void>,
): Promise<void> {
  for (const chunk of chunks) {
    try {
      await onTextDelta(chunk);
    } catch {
      // Public stream telemetry must not change model routing or tool execution.
    }
  }
}

async function openAiCompatibleBlockingStep(args: {
  endpoint: string;
  apiKey?: string;
  headers: Record<string, string>;
  modelId: string;
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  signal?: AbortSignal;
  toolChoice?: AgentToolChoice;
  onProviderRequest?: () => void;
}) {
  const res = await postJson<OpenAiChatResponse>(args.endpoint, {
    model: args.modelId,
    messages: [{ role: "system", content: args.system }, ...toOpenAiMessages(args.messages)],
    tools: args.tools.length ? args.tools.map(openAiTool) : undefined,
    tool_choice: args.tools.length ? openAiCompatibleToolChoice(args.modelId, args.endpoint, args.toolChoice) : undefined,
    ...openAiCompatibleTokenLimitParam(args.modelId, args.endpoint, modelMaxOutputTokens()),
    ...openAiCompatibleProviderOptions(args.modelId, args.endpoint),
  }, {
    ...args.headers,
    ...(args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {}),
  }, args.signal, args.onProviderRequest);

  const message = res.choices?.[0]?.message ?? {};
  const toolCalls = (message.tool_calls ?? []).map((tc): ToolCall => ({
    id: tc.id || crypto.randomUUID(),
    tool: tc.function?.name ?? "unknown_tool",
    args: parseJsonObject(tc.function?.arguments ?? "{}"),
  }));
  const usage = openAiUsage(res.usage);
  return {
    text: message.content || undefined,
    toolCalls,
    done: toolCalls.length === 0,
    ...(usage ? { usage } : {}),
  };
}

async function openAiCompatibleStreamStep(args: {
  endpoint: string;
  apiKey?: string;
  headers: Record<string, string>;
  modelId: string;
  system: string;
  messages: AgentMessage[];
  tools: AgentTool[];
  signal?: AbortSignal;
  onTextDelta: (text: string) => void | Promise<void>;
  toolChoice?: AgentToolChoice;
  onProviderRequest?: () => void;
}) {
  args.onProviderRequest?.();
  const res = await fetch(args.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...args.headers,
      ...(args.apiKey ? { Authorization: `Bearer ${args.apiKey}` } : {}),
    },
    body: JSON.stringify(removeUndefined({
      model: args.modelId,
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "system", content: args.system }, ...toOpenAiMessages(args.messages)],
      tools: args.tools.length ? args.tools.map(openAiTool) : undefined,
      tool_choice: args.tools.length ? openAiCompatibleToolChoice(args.modelId, args.endpoint, args.toolChoice) : undefined,
      ...openAiCompatibleTokenLimitParam(args.modelId, args.endpoint, modelMaxOutputTokens()),
      ...openAiCompatibleProviderOptions(args.modelId, args.endpoint),
    })),
    signal: args.signal,
  });

  const toolCallParts = new Map<number, { id?: string; name?: string; argsText: string }>();
  let lastToolCallIndex = -1;
  let text = "";
  let usage: OpenAiChatResponse["usage"] | undefined;

  try {
    await readSse(res, async (data) => {
      let parsed: OpenAiChatStreamChunk;
      try {
        parsed = JSON.parse(data) as OpenAiChatStreamChunk;
      } catch {
        return;
      }
      if (parsed.usage) usage = parsed.usage;
      for (const choice of parsed.choices ?? []) {
        const delta = choice.delta;
        const textDelta = delta?.content ?? "";
        if (textDelta) {
          text += textDelta;
          await args.onTextDelta(textDelta);
        }
        for (const toolDelta of delta?.tool_calls ?? []) {
          const index = inferOpenAiStreamToolIndex(toolDelta, toolCallParts, lastToolCallIndex);
          lastToolCallIndex = index;
          const current = toolCallParts.get(index) ?? { argsText: "" };
          if (toolDelta.id) current.id = toolDelta.id;
          if (toolDelta.function?.name) current.name = toolDelta.function.name;
          if (toolDelta.function?.arguments) current.argsText += toolDelta.function.arguments;
          toolCallParts.set(index, current);
        }
      }
    });
  } catch (error) {
    throw new ProviderStepError(error, usage ? openAiUsage(usage) : undefined);
  }

  const toolCalls = [...toolCallParts.entries()]
    .sort(([a], [b]) => a - b)
    .filter(([, tc]) => shouldKeepOpenAiStreamToolCall(tc))
    .map(([, tc]): ToolCall => ({
      id: tc.id || crypto.randomUUID(),
      tool: tc.name ?? "unknown_tool",
      args: parseOpenAiStreamToolArgs(tc.name, tc.argsText),
    }));
  const tokenUsage = openAiUsage(usage);
  return {
    text: text || undefined,
    toolCalls,
    done: toolCalls.length === 0,
    ...(tokenUsage ? { usage: tokenUsage } : {}),
  };
}

async function anthropicStep(
  modelId: string,
  system: string,
  messages: AgentMessage[],
  tools: AgentTool[],
  signal?: AbortSignal,
  onProviderRequest?: () => void,
) {
  const res = await postJson<AnthropicResponse>("https://api.anthropic.com/v1/messages", {
    model: modelId,
    max_tokens: modelMaxOutputTokens(),
    system,
    messages: toAnthropicMessages(messages),
    tools: tools.length ? tools.map(anthropicTool) : undefined,
  }, {
    "x-api-key": requireEnv("ANTHROPIC_API_KEY"),
    "anthropic-version": "2023-06-01",
  }, signal, onProviderRequest);

  const parts = res.content ?? [];
  const text = parts
    .filter((p): p is { type: "text"; text?: string } => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");
  const toolCalls = parts
    .filter((p): p is { type: "tool_use"; id?: string; name?: string; input?: JsonObject } => p.type === "tool_use")
    .map((p): ToolCall => ({
      id: p.id || crypto.randomUUID(),
      tool: p.name ?? "unknown_tool",
      args: p.input ?? {},
    }));
  const usage = anthropicUsage(res.usage);
  return {
    text: text || undefined,
    toolCalls,
    done: toolCalls.length === 0,
    ...(usage ? { usage } : {}),
  };
}

async function geminiStep(
  modelId: string,
  system: string,
  messages: AgentMessage[],
  tools: AgentTool[],
  signal?: AbortSignal,
  onProviderRequest?: () => void,
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"))}`;
  const res = await postJson<GeminiResponse>(url, {
    systemInstruction: { parts: [{ text: system }] },
    contents: toGeminiContents(messages),
    tools: tools.length ? [{ functionDeclarations: tools.map(geminiTool) }] : undefined,
    generationConfig: { maxOutputTokens: modelMaxOutputTokens() },
  }, {}, signal, onProviderRequest);

  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p): p is { text?: string } => "text" in p)
    .map((p) => p.text ?? "")
    .join("");
  const toolCalls = parts
    .filter((p): p is { functionCall: { name?: string; args?: JsonObject }; thoughtSignature?: string; thought_signature?: string } => "functionCall" in p)
    .map((p): ToolCall => ({
      id: crypto.randomUUID(),
      tool: p.functionCall.name ?? "unknown_tool",
      args: p.functionCall.args ?? {},
      providerMetadata: p.thoughtSignature || p.thought_signature ? { geminiThoughtSignature: p.thoughtSignature ?? p.thought_signature } : undefined,
    }));
  const usage = geminiUsage(res.usageMetadata);
  return {
    text: text || undefined,
    toolCalls,
    done: toolCalls.length === 0,
    ...(usage ? { usage } : {}),
  };
}

async function geminiStreamStep(
  modelId: string,
  system: string,
  messages: AgentMessage[],
  tools: AgentTool[],
  signal: AbortSignal | undefined,
  onTextDelta: (text: string) => void | Promise<void>,
  onProviderRequest?: () => void,
) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(requireEnv("GOOGLE_GENERATIVE_AI_API_KEY"))}`;
  onProviderRequest?.();
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(removeUndefined({
      systemInstruction: { parts: [{ text: system }] },
      contents: toGeminiContents(messages),
      tools: tools.length ? [{ functionDeclarations: tools.map(geminiTool) }] : undefined,
      generationConfig: { maxOutputTokens: modelMaxOutputTokens() },
    })),
    signal,
  });

  let text = "";
  const toolCalls: ToolCall[] = [];
  let usage: GeminiResponse["usageMetadata"] | undefined;

  try {
    await readSse(res, async (data) => {
      let parsed: GeminiResponse;
      try {
        parsed = JSON.parse(data) as GeminiResponse;
      } catch {
        return;
      }
      if (parsed.usageMetadata) usage = parsed.usageMetadata;
      const parts = parsed.candidates?.[0]?.content?.parts ?? [];
      for (const part of parts) {
        if ("text" in part) {
          const delta = part.text ?? "";
          if (delta) {
            text += delta;
            await onTextDelta(delta);
          }
        } else if ("functionCall" in part) {
          toolCalls.push({
            id: crypto.randomUUID(),
            tool: part.functionCall?.name ?? "unknown_tool",
            args: part.functionCall?.args ?? {},
            providerMetadata: part.thoughtSignature || part.thought_signature ? { geminiThoughtSignature: part.thoughtSignature ?? part.thought_signature } : undefined,
          });
        }
      }
    });
  } catch (error) {
    throw new ProviderStepError(error, usage ? geminiUsage(usage) : undefined);
  }

  const tokenUsage = geminiUsage(usage);
  return {
    text: text || undefined,
    toolCalls,
    done: toolCalls.length === 0,
    ...(tokenUsage ? { usage: tokenUsage } : {}),
  };
}

function toOpenAiMessages(messages: AgentMessage[]): OpenAiMessage[] {
  return messages.map((m) => {
    if (m.role === "user") return { role: "user", content: m.content };
    if (m.role === "assistant") {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls?.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.tool, arguments: JSON.stringify(tc.args) },
        })),
      };
    }
    return {
      role: "tool",
      tool_call_id: m.toolCallId,
      name: m.toolName,
      content: m.content,
    };
  });
}

function toAnthropicMessages(messages: AgentMessage[]) {
  return messages.map((m) => {
    if (m.role === "assistant") {
      const content: unknown[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        content.push({ type: "tool_use", id: tc.id, name: tc.tool, input: tc.args });
      }
      return { role: "assistant", content };
    }
    if (m.role === "tool") {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }],
      };
    }
    return { role: "user", content: m.content };
  });
}

function toGeminiContents(messages: AgentMessage[]) {
  return messages.map((m) => {
    if (m.role === "assistant") {
      const parts: unknown[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const tc of m.toolCalls ?? []) {
        const thoughtSignature = typeof tc.providerMetadata?.geminiThoughtSignature === "string" ? tc.providerMetadata.geminiThoughtSignature : undefined;
        parts.push({
          functionCall: { name: tc.tool, args: tc.args },
          ...(thoughtSignature ? { thoughtSignature } : {}),
        });
      }
      return { role: "model", parts };
    }
    if (m.role === "tool") {
      return {
        role: "user",
        parts: [{
          functionResponse: {
            name: m.toolName,
            response: parseJsonObject(m.content, { result: m.content }),
          },
        }],
      };
    }
    return { role: "user", parts: [{ text: m.content }] };
  });
}

function openAiTool(tool: AgentTool) {
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toolParameters(tool.name),
    },
  };
}

function anthropicTool(tool: AgentTool) {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: toolParameters(tool.name),
  };
}

function geminiTool(tool: AgentTool) {
  return {
    name: tool.name,
    description: tool.description,
    parameters: toolParameters(tool.name),
  };
}

export function toolParameters(toolName: string): JsonObject {
  const string = { type: "string" };
  const number = { type: "number" };
  const integer = { type: "integer" };
  const boolean = { type: "boolean" };
  const any = {};
  const stringArray = { type: "array", items: string };
  const numberRecord = { type: "object", additionalProperties: number };
  const evidence = {
    type: "object",
    properties: {
      id: string,
      kind: { type: "string", enum: ["upload", "source", "computed", "manual"] },
      label: string,
      source: string,
      sourceStorageId: string,
      sourceArtifactId: string,
      providerFileId: string,
      sheetName: string,
      row: number,
      column: string,
      page: number,
      bbox: {
        type: "object",
        properties: {
          x: number,
          y: number,
          width: number,
          height: number,
          unit: { type: "string", enum: ["px", "pt", "normalized"] },
        },
      },
      url: string,
      snippet: string,
      confidence: number,
    },
    required: ["kind", "label"],
  };
  const bbox = {
    type: "object",
    properties: {
      x: number,
      y: number,
      width: number,
      height: number,
      unit: { type: "string", enum: ["px", "pt", "normalized"] },
    },
    required: ["x", "y", "width", "height"],
  };
  const op = {
    type: "object",
    properties: { elementId: string, value: any, baseVersion: { type: "integer" } },
    required: ["elementId", "value", "baseVersion"],
  };
  const scalarWriteKind = { type: "string", enum: ["set", "create", "delete"] };
  const resultWriteKind = { type: "string", enum: ["set", "create"] };
  const fontColor = { type: "string", pattern: "^#?(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$" };
  const managedScalarWriteProperties = {
    elementId: string,
    cellId: string,
    id: string,
    cell: string,
    cellKey: string,
    targetCell: string,
    target: string,
    targetId: string,
    element_id: string,
    cell_id: string,
    value: any,
    newValue: any,
    new_value: any,
    result: any,
    formula: string,
    numFmt: string,
    num_fmt: string,
    numberFormat: string,
    number_format: string,
    fontColor,
    font_color: fontColor,
    text: any,
    content: any,
    expectedValue: any,
    expected_value: any,
    baseVersion: integer,
    base_version: integer,
    currentVersion: integer,
    current_version: integer,
    version: integer,
    kind: scalarWriteKind,
  };
  const managedScalarWriteOp = {
    type: "object",
    properties: managedScalarWriteProperties,
    required: [],
  };
  const managedResultWriteProperties = {
    ...managedScalarWriteProperties,
    status: { type: "string", enum: ["empty", "running", "complete", "needs_review", "failed", "gap"] },
    confidence: number,
    normalizedValue: any,
    formula: string,
    error: string,
    evidence: { type: "array", items: evidence },
    kind: resultWriteKind,
  };
  const managedResultWriteOp = {
    type: "object",
    properties: managedResultWriteProperties,
    required: ["evidence"],
  };
  const managedScalarBatchProperties = {
    ops: { type: "array", items: managedScalarWriteOp },
    cells: { type: "array", items: managedScalarWriteOp },
    elementIds: any,
    cellIds: any,
    ids: any,
    targets: any,
    targetCells: any,
    id: any,
    cell: any,
    targetCell: any,
    target: any,
    values: any,
    newValues: any,
    newValue: any,
    new_value: any,
    results: any,
    result: any,
    formulas: any,
    formula: any,
    numFmts: any,
    numFmt: any,
    numberFormats: any,
    numberFormat: any,
    fontColors: any,
    fontColor: any,
    text: any,
    content: any,
    expectedValue: any,
    baseVersions: any,
    base_versions: any,
    versions: any,
    base_version: any,
    currentVersions: any,
    currentVersion: any,
    kinds: any,
    kind: scalarWriteKind,
    reason: string,
    artifactId: string,
  };
  const managedResultBatchProperties = {
    ...managedScalarBatchProperties,
    ops: { type: "array", items: managedResultWriteOp },
    cells: { type: "array", items: managedResultWriteOp },
    statuses: any,
    status: any,
    confidences: any,
    confidence: any,
    normalizedValues: any,
    normalizedValue: any,
    formulas: any,
    formula: any,
    errors: any,
    error: any,
    evidences: any,
    evidence: any,
    kind: resultWriteKind,
  };
  const chartPoint = {
    type: "object",
    properties: { label: string, value: number, sourceRef: string, estimated: boolean },
    required: ["label", "value"],
  };
  const evidenceCardInput = {
    type: "object",
    properties: {
      label: string,
      sourceRef: string,
      quote: string,
      kind: { type: "string", enum: ["source", "upload", "computed", "manual"] },
      confidence: number,
      status: { type: "string", enum: ["verified", "needs_review", "manual", "estimated"] },
    },
    required: ["label"],
  };
  const evidenceCard = {
    type: "object",
    properties: {
      id: string,
      label: string,
      sourceRef: string,
      quote: string,
      kind: { type: "string", enum: ["source", "upload", "computed", "manual"] },
      confidence: number,
      status: { type: "string", enum: ["verified", "needs_review", "manual", "estimated"] },
      reviewNote: string,
    },
    required: ["id", "label", "sourceRef", "quote", "kind", "confidence", "status"],
  };
  const stringOrStringArray = { anyOf: [stringArray, string] };
  const workbookOperation = {
    type: "object",
    properties: { elementId: string, baseVersion: integer, value: any, formula: string, result: any, numFmt: string, fontColor },
    required: ["elementId"],
  };
  const schemas: Record<string, JsonObject> = {
    inspect_workbook: {
      type: "object",
      properties: { instruction: string, artifactId: string, query: string, maxCells: integer },
      required: ["instruction"],
    },
    execute_workbook_structure_repair: {
      type: "object",
      properties: { instruction: string, artifactId: string, repairId: string },
      required: ["instruction", "repairId"],
    },
    execute_verified_workbook_plan: {
      type: "object",
      properties: {
        instruction: string,
        artifactId: string,
        query: string,
        maxCells: integer,
        reason: string,
      },
      required: ["instruction"],
    },
    verify_workbook: {
      type: "object",
      properties: {
        instruction: string,
        artifactId: string,
        operations: { type: "array", items: workbookOperation },
        afterWrite: boolean,
      },
      required: ["instruction", "operations"],
    },
    read_range: { type: "object", properties: { elementIds: stringOrStringArray, artifactId: string }, required: [] },
    search_sheet_context: { type: "object", properties: { query: string, artifactId: string, limit: integer }, required: ["query"] },
    list_artifacts: { type: "object", properties: {}, required: [] },
    propose_lock: { type: "object", properties: { elementIds: stringOrStringArray, reason: string, artifactId: string }, required: ["elementIds", "reason"] },
    edit_cell: { type: "object", properties: { elementId: string, value: any, baseVersion: integer, kind: { type: "string", enum: ["set", "create", "delete"] }, artifactId: string }, required: ["elementId", "value", "baseVersion"] },
    write_cell_result: {
      type: "object",
      properties: {
        elementId: string,
        value: any,
        baseVersion: integer,
        status: { type: "string", enum: ["empty", "running", "complete", "needs_review", "failed", "gap"] },
        confidence: number,
        normalizedValue: any,
        formula: string,
        error: string,
        evidence: { type: "array", items: evidence },
        kind: { type: "string", enum: ["set", "create"] },
        artifactId: string,
      },
      required: ["elementId", "value", "baseVersion", "evidence"],
    },
    update_wiki: {
      type: "object",
      properties: { artifactId: string, content: string, citesArtifactIds: stringArray, baseVersion: integer, elementId: string },
      required: ["artifactId", "content", "citesArtifactIds", "baseVersion"],
    },
    reconcile_cell: {
      type: "object",
      properties: { elementId: string, expectedValue: any, baseVersion: integer, artifactId: string },
      required: ["elementId", "expectedValue", "baseVersion"],
    },
    run_algorithm_artifact: {
      type: "object",
      properties: {
        artifactId: string,
        artifact: {
          type: "object",
          properties: {
            schema: integer,
            algorithmId: string,
            name: string,
            description: string,
            kind: { type: "string", enum: ["spreadsheet_formula"] },
            language: { type: "string", enum: ["formula_dsl", "noderoom_dsl"] },
            inputs: { type: "array", items: { type: "object", properties: { id: string, elementId: string, label: string }, required: ["id", "elementId"] } },
            outputs: { type: "array", items: { type: "object", properties: { id: string, elementId: string, expression: string, format: { type: "string", enum: ["number", "currency", "percent"] }, label: string }, required: ["id", "elementId", "expression"] } },
            constraints: { type: "object", properties: { deterministic: boolean, noNetwork: boolean, noRandom: boolean, noDateNow: boolean, maxInputs: integer, maxOutputs: integer } },
            evidencePolicy: { type: "object", properties: { requireSourceCells: boolean } },
            tests: { type: "array", items: { type: "object", properties: { name: string, inputs: numberRecord, expected: numberRecord, tolerance: number }, required: ["name", "inputs", "expected"] } },
          },
          required: ["schema", "algorithmId", "name", "kind", "language", "inputs", "outputs"],
        },
      },
      required: ["artifact"],
    },
    create_draft: { type: "object", properties: { ops: { type: "array", items: op }, blockedByLockId: string, note: string, artifactId: string }, required: ["ops", "blockedByLockId", "note"] },
    release_lock: { type: "object", properties: { lockId: string }, required: ["lockId"] },
    say: { type: "object", properties: { text: string }, required: ["text"] },
    fetch_source: { type: "object", properties: { url: string }, required: ["url"] },
    founder_profile: { type: "object", properties: { linkedinUrl: string, fullName: string, company: string }, required: [] },
    write_locked_cell: {
      type: "object",
      properties: { ...managedScalarWriteProperties, reason: string, artifactId: string },
      required: [],
    },
    write_locked_cells: {
      type: "object",
      properties: managedScalarBatchProperties,
      required: [],
    },
    write_locked_cell_result: {
      type: "object",
      properties: { ...managedResultWriteProperties, reason: string, artifactId: string },
      required: ["evidence"],
    },
    write_locked_cell_results: {
      type: "object",
      properties: managedResultBatchProperties,
      required: [],
    },
    okf_list_concepts: { type: "object", properties: { type: string, tags: stringArray, pathPrefix: string, status: string, confidenceMin: number, timestampAfter: string, visibility: { type: "string", enum: ["public", "private", "redacted"] }, limit: integer }, required: [] },
    okf_read_concept: { type: "object", properties: { conceptId: string }, required: ["conceptId"] },
    okf_full_text_search: { type: "object", properties: { query: string, fields: { type: "array", items: { type: "string", enum: ["title", "description", "body", "citations"] } }, type: string, tags: stringArray, pathPrefix: string, status: string, confidenceMin: number, timestampAfter: string, visibility: { type: "string", enum: ["public", "private", "redacted"] }, limit: integer }, required: ["query"] },
    okf_semantic_search: { type: "object", properties: { query: string, type: string, tags: stringArray, pathPrefix: string, status: string, confidenceMin: number, timestampAfter: string, visibility: { type: "string", enum: ["public", "private", "redacted"] }, limit: integer }, required: ["query"] },
    okf_search_skills: { type: "object", properties: { query: string, skill_categories: stringArray, skill_trust_min: { type: "string", enum: ["untrusted", "community", "verified"] }, limit: integer }, required: ["query"] },
    okf_filter: { type: "object", properties: { type: string, tags: stringArray, pathPrefix: string, status: string, confidenceMin: number, timestampAfter: string, visibility: { type: "string", enum: ["public", "private", "redacted"] }, limit: integer }, required: [] },
    okf_glob: { type: "object", properties: { pattern: string, limit: integer }, required: ["pattern"] },
    okf_regex: { type: "object", properties: { pattern: string, pathPrefix: string, caseSensitive: boolean, limit: integer }, required: ["pattern"] },
    okf_backlinks: { type: "object", properties: { conceptId: string, depth: integer, limit: integer }, required: ["conceptId"] },
    okf_expand_neighbors: { type: "object", properties: { conceptId: string, linkDepth: integer, includeCitations: boolean, includeBacklinks: boolean, limit: integer }, required: ["conceptId", "linkDepth"] },
    source_resolve_citation: { type: "object", properties: { evidenceId: string }, required: ["evidenceId"] },
    source_open_literal: { type: "object", properties: { sourceArtifactId: string, page: integer, row: number, column: string, bbox }, required: ["sourceArtifactId"] },
    source_compare_claim: {
      type: "object",
      properties: {
        claim: string,
        evidenceRefs: {
          type: "array",
          items: { type: "object", properties: { evidenceId: string, conceptId: string, citationId: string, sourceArtifactId: string }, required: ["evidenceId"] },
        },
      },
      required: ["claim", "evidenceRefs"],
    },
    build_evidence_cards: { type: "object", properties: { evidence: { type: "array", items: evidenceCardInput } }, required: ["evidence"] },
    compute_runway_milestones: { type: "object", properties: { company: string, cashUsd: number, monthlyBurnUsd: number, momGrowthRate: number, source: string }, required: ["company", "cashUsd", "monthlyBurnUsd"] },
    validate_chart_against_source_cells: { type: "object", properties: { sourceCells: numberRecord, series: { type: "array", items: chartPoint }, tolerance: number }, required: ["sourceCells", "series"] },
    render_chart_artifact: { type: "object", properties: { title: string, chartSvg: string, narrative: string, sourceRefs: stringArray }, required: ["title", "chartSvg"] },
    generate_banker_coach_cues: { type: "object", properties: { company: string, claim: string, evidenceCards: { type: "array", items: evidenceCard }, runwayMonths: number, status: string }, required: ["company", "claim", "evidenceCards"] },
    create_review_round_update: { type: "object", properties: { roomTitle: string, company: string, materialChanges: stringArray, openQuestions: stringArray, nextActions: stringArray, sourceRefs: stringArray }, required: ["roomTitle", "materialChanges"] },
    export_downstream_draft: {
      type: "object",
      properties: {
        artifact: {
          type: "object",
          properties: { id: string, title: string, kind: string, body: string, sourceArtifactIds: stringArray, sourceUrls: stringArray, createdAt: number },
          required: ["id", "title", "kind", "body", "sourceArtifactIds", "sourceUrls"],
        },
        destinations: { type: "array", items: { type: "string", enum: ["gmail", "notion", "slack", "linear", "linkedin", "crm_csv"] } },
      },
      required: ["artifact"],
    },
    create_btb_deliverable_package: {
      type: "object",
      properties: {
        taskId: string,
        title: string,
        narrative: string,
        rows: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: string,
              values: { type: "object", additionalProperties: any },
            },
            required: ["label", "values"],
          },
        },
        sourceUrls: stringArray,
        sourceArtifactIds: stringArray,
      },
      required: ["title", "narrative"],
    },
    set_artifact_meta: { type: "object", properties: { artifactId: string, title: string, summary: string, tags: stringArray }, required: ["artifactId"] },
    define_columns: {
      type: "object",
      properties: {
        artifactId: string,
        baseVersion: number,
        mode: { type: "string", enum: ["replace", "merge"] },
        columns: { type: "array", items: { type: "object", properties: { label: string, type: { type: "string", enum: ["text", "number", "date", "currency", "boolean", "json"] }, agentWritable: boolean }, required: ["label"] } },
      },
      required: ["baseVersion", "columns"],
    },
    read_notebook: { type: "object", properties: { artifactId: string }, required: [] },
    update_notebook_block: {
      type: "object",
      properties: {
        artifactId: string,
        blockId: string,
        baseTextHash: string,
        action: { type: "string", enum: ["replace", "append_children", "annotate"] },
        content: string,
        reason: string,
      },
      required: ["blockId", "action", "content"],
    },
    plan_notebook_enrichment: {
      type: "object",
      properties: { artifactId: string, maxTargets: integer },
      required: [],
    },
    append_notebook_outline: {
      type: "object",
      properties: {
        artifactId: string,
        title: string,
        parentBlockId: string,
        mode: { type: "string", enum: ["append", "merge"] },
        sections: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              title: string,
              bullets: {
                type: "array",
                minItems: 1,
                items: {
                  anyOf: [
                    { type: "string" },
                    {
                      type: "object",
                      properties: {
                        text: string,
                        claim: boolean,
                        evidence: { type: "array", items: { type: "object", additionalProperties: any } },
                      },
                      required: ["text"],
                    },
                  ],
                },
              },
            },
            required: ["title", "bullets"],
          },
        },
      },
      required: ["sections"],
    },
    capture_source: { type: "object", properties: { url: string, goal: string }, required: ["url", "goal"] },
    sec_facts: { type: "object", properties: { company: string, concept: string }, required: ["company", "concept"] },
    cite_in_file: { type: "object", properties: { target: string, label: string, fileName: string }, required: ["target"] },
    skill_search: { type: "object", properties: { query: string, k: integer, skill_categories: stringArray, skill_trust_min: { type: "string", enum: ["untrusted", "community", "verified"] } }, required: ["query"] },
    load_skill: { type: "object", properties: { idOrUrl: string }, required: ["idOrUrl"] },
    you_search: { type: "object", properties: { query: string, count: integer, freshness: { type: "string", enum: ["day", "week", "month", "year"] }, country: string }, required: ["query"] },
    you_research: { type: "object", properties: { input: string, researchEffort: { type: "string", enum: ["lite", "standard", "deep", "exhaustive"] } }, required: ["input"] },
    you_finance_research: { type: "object", properties: { input: string, researchEffort: { type: "string", enum: ["deep", "exhaustive"] } }, required: ["input"] },
    tavily_search: { type: "object", properties: { query: string, maxResults: integer, searchDepth: { type: "string", enum: ["basic", "advanced"] }, topic: { type: "string", enum: ["general", "news", "finance"] }, includeAnswer: boolean, timeRange: { type: "string", enum: ["day", "week", "month", "year"] }, includeDomains: stringArray, excludeDomains: stringArray }, required: ["query"] },
    github_profile: { type: "object", properties: { username: string, includeRepos: boolean, includeContributions: boolean, includeLanguages: boolean }, required: ["username"] },
    plan_and_dispatch: {
      type: "object",
      properties: {
        waves: {
          type: "array",
          minItems: 1,
          maxItems: 3,
          items: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              properties: {
                role: { type: "string" },
                goal: { type: "string" },
                allowedTools: { type: "array", items: { type: "string" } },
                modelHint: { type: "string" },
              },
              required: ["role", "goal", "allowedTools"],
            },
          },
        },
        synthesisGoal: { type: "string" },
      },
      required: ["waves"],
    },
  };
  return schemas[toolName] ?? { type: "object", properties: {}, required: [] };
}

async function readSse(res: Response, onData: (data: string) => Promise<void>): Promise<void> {
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Provider stream failed ${res.status}: ${detail.slice(0, 500)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const processLine = async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === "[DONE]") return;
    await onData(data);
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      await processLine(line);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) await processLine(buffer);
}

async function postJson<T>(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  signal?: AbortSignal,
  onProviderRequest?: () => void,
): Promise<T> {
  onProviderRequest?.();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(removeUndefined(body)),
    signal,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Provider request failed ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text) as T;
}

function removeUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeUndefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as JsonObject)
      .filter(([, val]) => val !== undefined)
      .map(([key, val]) => [key, removeUndefined(val)]),
  );
}

function inferOpenAiStreamToolIndex(
  toolDelta: OpenAiToolCallDelta,
  toolCallParts: Map<number, { id?: string; name?: string; argsText: string }>,
  lastToolCallIndex: number,
): number {
  if (typeof toolDelta.index === "number") return toolDelta.index;
  if (toolDelta.id) {
    const existing = [...toolCallParts.entries()].find(([, part]) => part.id === toolDelta.id);
    if (existing) return existing[0];
  }
  const hasNewIdentity = !!toolDelta.id || !!toolDelta.function?.name;
  const hasArgsOnly = !!toolDelta.function?.arguments && !toolDelta.id && !toolDelta.function?.name;
  if (hasArgsOnly && lastToolCallIndex >= 0) return lastToolCallIndex;
  if (hasNewIdentity) return Math.max(-1, ...toolCallParts.keys()) + 1;
  return lastToolCallIndex >= 0 ? lastToolCallIndex : Math.max(-1, ...toolCallParts.keys()) + 1;
}

function shouldKeepOpenAiStreamToolCall(tc: { name?: string; argsText: string }): boolean {
  if (!tc.name) return false;
  if (tc.argsText.trim()) return true;
  const required = toolParameters(tc.name).required;
  return !Array.isArray(required) || required.length === 0;
}

function parseOpenAiStreamToolArgs(name: string | undefined, argsText: string): JsonObject {
  const text = argsText.trim();
  if (!text) return {};
  const parsed = parseJsonObject(text, { __parseFailed: true });
  if (parsed.__parseFailed) {
    throw new Error(`stream_tool_args_invalid_json:${name ?? "unknown_tool"}`);
  }
  return parsed;
}

function parseJsonObject(text: string, fallback: JsonObject = {}): JsonObject {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : fallback;
  } catch {
    return fallback;
  }
}

function requireEnv(name: string): string {
  const value = envValue(name);
  if (!value) throw new Error(`${name} is required for convexModel provider calls`);
  return value;
}

function openRouterBaseUrl(): string {
  return envValue("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1";
}

function nebiusBaseUrl(): string {
  return envValue("NEBIUS_BASE_URL") ?? "https://api.tokenfactory.nebius.com/v1";
}

function modelMaxOutputTokens(): number {
  return envNumber("AGENT_MODEL_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS, 1_024, 32_000);
}

function envNumber(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(envValue(name) ?? fallback);
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function openAiCompatibleProviderOptions(modelId: string, endpoint: string): JsonObject {
  // GLM/Qwen hybrid-thinking models served through OpenRouter/vLLM can spend the entire
  // output cap on hidden thinking, and Qwen rejects required tool_choice while thinking.
  // Keep NodeAgent tool turns in instruction-following mode unless a caller deliberately
  // overrides the model route.
  if (!isOpenRouterEndpoint(endpoint) || !isOpenRouterHybridThinkingModel(modelId)) return {};
  return { chat_template_kwargs: { enable_thinking: false } };
}

function openAiCompatibleToolChoice(modelId: string, endpoint: string, requested?: AgentToolChoice): AgentToolChoice {
  const choice = requested ?? "auto";
  // Alibaba-hosted Qwen via OpenRouter rejects `tool_choice: "required"` in thinking mode.
  // NodeAgent still validates required writes/packages after the turn, so provider-level `auto`
  // is the compatible transport hint while the harness remains strict.
  if (choice === "required" && isOpenRouterEndpoint(endpoint) && isOpenRouterQwenHybridThinkingModel(modelId)) {
    return "auto";
  }
  return choice;
}

function isOpenRouterEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).hostname.includes("openrouter.ai");
  } catch {
    return endpoint.includes("openrouter");
  }
}

function isOpenRouterHybridThinkingModel(modelId: string): boolean {
  return /^(?:z-ai\/glm-|glm-)/i.test(modelId) || isOpenRouterQwenHybridThinkingModel(modelId);
}

function isOpenRouterQwenHybridThinkingModel(modelId: string): boolean {
  return /^(?:qwen\/qwen3(?:[.-]|$)|qwen3(?:[.-]|$))/i.test(modelId);
}

function openRouterHeaders(): Record<string, string> {
  return {
    "HTTP-Referer": OPENROUTER_REFERER,
    "X-Title": OPENROUTER_TITLE,
  };
}

export function configuredConvexModelFallbacks(
  modelId: string,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = env.AGENT_FALLBACK_MODELS?.trim() || env.AGENT_FALLBACK_MODEL?.trim() || "";
  return normalizeFallbackModelIds(modelId, raw.split(/[\r\n,]+/));
}

function normalizeFallbackModelIds(modelId: string, values: readonly string[]): string[] {
  const primary = resolveModelAlias(modelId);
  const seen = new Set([primary]);
  const result: string[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) continue;
    const resolved = resolveModelAlias(value.trim());
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
    if (result.length >= 3) break;
  }
  return result;
}

function concreteCandidateTimeoutMs(): number {
  const raw = Number(envValue("AGENT_QUALITY_CANDIDATE_TIMEOUT_MS") ?? 120_000);
  return Number.isFinite(raw) ? Math.max(10_000, Math.min(240_000, raw)) : 120_000;
}

function openRouterFreeAutoLimit(): number {
  const raw = Number(envValue("OPENROUTER_FREE_AUTO_LIMIT") ?? 8);
  return Number.isFinite(raw) ? Math.max(1, Math.min(20, raw)) : 8;
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function withProviderRoute<T extends AgentStep>(step: T, providerRoute: ProviderRouteReceipt): T & { providerRoute: ProviderRouteReceipt } {
  return { ...step, providerRoute };
}

function isTransientError(error: unknown): boolean {
  if (error instanceof Error && (error.name === "AbortError" || /\baborted\b/i.test(error.message))) return false;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return TRANSIENT_RE.test(message);
}

function retryBackoffMs(attempt: number): number {
  const base = 2_000 * Math.pow(3, attempt - 1);
  return base + Math.floor(Math.random() * 0.3 * base);
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    }, { once: true });
  });
}

async function withRetry<T>(fn: () => Promise<T>, signal?: AbortSignal, maxRetries = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (signal?.aborted || !isTransientError(error) || attempt > maxRetries) throw error;
      await abortableSleep(retryBackoffMs(attempt), signal);
    }
  }
  throw lastError;
}

function shortProviderError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of Object.values(process.env)) {
    if (value && value.length > 12) message = message.replaceAll(value, "[redacted]");
  }
  return message.replace(/\s+/g, " ").slice(0, 240);
}
