import type { ModelPricing } from "./modelCatalog";
import { providerHealthDecision } from "../guardrails/providerHealth";

export const OPENROUTER_FREE_AUTO_MODEL = "openrouter/free-auto";
export const OPENROUTER_FREE_META_MODEL = "openrouter/free";

export type OpenRouterFreeModelMode = "chat" | "agent" | "structured" | "vision" | "coding";

export type OpenRouterModelInfo = {
  id: string;
  name?: string;
  description?: string;
  created?: number;
  context_length?: number;
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
  };
  pricing?: Record<string, string | undefined>;
  supported_parameters?: string[];
  /** OpenRouter data-policy metadata (shape best-effort — see permitsTraining + the production-
   *  readiness note: whether this field is reliably present per-model needs LIVE verification). */
  data_policy?: { training?: boolean; canTrain?: boolean; [k: string]: unknown };
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
};

export type RankedOpenRouterModel = OpenRouterModelInfo & {
  score: number;
  reasons: string[];
};

type ModelsResponse = { data?: OpenRouterModelInfo[] };

/** A route DECLARES it trains on prompts. Conservative: only excludes on an explicit positive flag,
 *  so absence of the field (the common case today) does not silently drop every model. */
export function permitsTraining(model: OpenRouterModelInfo): boolean {
  const dp = model.data_policy;
  return dp?.training === true || dp?.canTrain === true;
}

let cachedModels: { fetchedAt: number; models: OpenRouterModelInfo[] } | null = null;

const FALLBACK_FREE_MODELS: OpenRouterModelInfo[] = [
  {
    id: "cohere/north-mini-code:free",
    name: "Cohere North Mini Code (free)",
    created: 1_781_723_748,
    context_length: 256_000,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["include_reasoning", "max_tokens", "reasoning", "tool_choice", "tools"],
  },
  {
    id: "nvidia/nemotron-3-ultra-550b-a55b:free",
    name: "NVIDIA Nemotron 3 Ultra (free)",
    created: 1_780_551_208,
    context_length: 1_000_000,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["include_reasoning", "max_tokens", "reasoning", "tool_choice", "tools"],
  },
  {
    id: "openrouter/owl-alpha",
    name: "OpenRouter Owl Alpha",
    context_length: 1_000_000,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["max_tokens", "reasoning", "response_format", "structured_outputs", "tool_choice", "tools"],
  },
  {
    id: "qwen/qwen3-coder:free",
    name: "Qwen3 Coder (free)",
    context_length: 1_048_576,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["max_tokens", "temperature", "tool_choice", "tools", "top_p"],
  },
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    name: "NVIDIA Nemotron 3 Super 120B (free)",
    context_length: 1_000_000,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["max_tokens", "reasoning", "response_format", "structured_outputs", "tool_choice", "tools"],
  },
  {
    id: "qwen/qwen3-next-80b-a3b-instruct:free",
    name: "Qwen3 Next 80B A3B Instruct (free)",
    context_length: 262_144,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["max_tokens", "response_format", "structured_outputs", "tool_choice", "tools"],
  },
  {
    id: "openai/gpt-oss-120b:free",
    name: "GPT OSS 120B (free)",
    context_length: 131_072,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["max_tokens", "reasoning", "tool_choice", "tools"],
  },
  {
    id: "google/gemma-4-31b-it:free",
    name: "Gemma 4 31B IT (free)",
    context_length: 262_144,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["max_tokens", "reasoning", "response_format", "tool_choice", "tools"],
  },
  {
    id: "moonshotai/kimi-k2.6:free",
    name: "Kimi K2.6 (free)",
    context_length: 262_144,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["reasoning", "tool_choice", "tools"],
  },
  {
    id: OPENROUTER_FREE_META_MODEL,
    name: "OpenRouter Free Router",
    context_length: 200_000,
    pricing: { prompt: "0", completion: "0" },
    supported_parameters: ["max_tokens", "response_format", "structured_outputs", "tool_choice", "tools"],
  },
];

export function isOpenRouterFreeAutoModel(modelId: string): boolean {
  return normalizeModelId(modelId) === OPENROUTER_FREE_AUTO_MODEL;
}

export function freeOpenRouterPricing(contextWindow = 200_000): ModelPricing {
  return { inputPer1M: 0, outputPer1M: 0, contextWindow };
}

export async function discoverOpenRouterFreeModels(options: {
  fetchImpl?: typeof fetch;
  now?: number;
  ttlMs?: number;
  forceRefresh?: boolean;
  signal?: AbortSignal;
} = {}): Promise<OpenRouterModelInfo[]> {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? Number(envValue("OPENROUTER_FREE_MODEL_CACHE_MS") || 10 * 60 * 1000);
  if (!options.forceRefresh && cachedModels && now - cachedModels.fetchedAt < ttlMs) return cachedModels.models;

  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const res = await fetchImpl(`${envValue("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1"}/models?output_modalities=text`, {
      headers: openRouterHeaders(),
      signal: options.signal,
    });
    if (!res.ok) throw new Error(`OpenRouter models request failed: ${res.status}`);
    const json = await res.json() as ModelsResponse;
    let models = (json.data ?? []).filter(isFreeTextModel);
    // Free-route data-policy filter (privacy gate). Backs the README's /free privacy disclosure with
    // enforcement when OPENROUTER_REQUIRE_NO_TRAINING=1: exclude any route that DECLARES it trains on
    // prompts. Default off because the per-model flag's availability is unconfirmed — turning it on
    // without the field present would filter everything. Treated as NEEDS-LIVE-AUDIT in
    // docs/PRODUCTION_READINESS.md (confirm OpenRouter exposes + honors the flag before claiming proven).
    if (process.env.OPENROUTER_REQUIRE_NO_TRAINING === "1") models = models.filter((m) => !permitsTraining(m));
    if (models.length === 0) throw new Error("OpenRouter returned no free text models");
    cachedModels = { fetchedAt: now, models };
    return models;
  } catch (error) {
    if (options.signal?.aborted) throw error;
    if (!cachedModels) cachedModels = { fetchedAt: now, models: FALLBACK_FREE_MODELS };
    return cachedModels.models;
  }
}

export async function selectOpenRouterFreeModels(options: {
  mode?: OpenRouterFreeModelMode;
  limit?: number;
  fetchImpl?: typeof fetch;
  forceRefresh?: boolean;
  signal?: AbortSignal;
  env?: Record<string, string | undefined>;
} = {}): Promise<RankedOpenRouterModel[]> {
  const models = await discoverOpenRouterFreeModels({
    fetchImpl: options.fetchImpl,
    forceRefresh: options.forceRefresh,
    signal: options.signal,
  });
  const ranked = rankOpenRouterFreeModels(models, options.mode ?? "agent");
  const skipped: string[] = [];
  const allowed = ranked.filter((model) => {
    const health = providerHealthDecision({
      requestedModel: model.id,
      resolvedModel: model.id,
      provider: "openrouter",
      env: options.env,
    });
    if (health.ok) return true;
    skipped.push(`${model.id}:${health.quarantineReason}`);
    return false;
  });
  if (ranked.length > 0 && allowed.length === 0) {
    throw new Error(`openrouter/free-auto candidates quarantined: ${skipped.join(", ")}`);
  }
  return allowed.slice(0, options.limit ?? 8);
}

export function rankOpenRouterFreeModels(
  models: OpenRouterModelInfo[],
  mode: OpenRouterFreeModelMode = "agent",
): RankedOpenRouterModel[] {
  return models
    .filter((model) => isUsableForMode(model, mode))
    .map((model) => {
      const { score, reasons } = scoreOpenRouterFreeModel(model, mode);
      return { ...model, score, reasons };
    })
    .sort((a, b) => b.score - a.score || (b.context_length ?? 0) - (a.context_length ?? 0) || a.id.localeCompare(b.id));
}

export function scoreOpenRouterFreeModel(model: OpenRouterModelInfo, mode: OpenRouterFreeModelMode = "agent"): {
  score: number;
  reasons: string[];
} {
  const id = model.id.toLowerCase();
  const haystack = `${id} ${model.name ?? ""} ${model.description ?? ""}`.toLowerCase();
  const params = new Set(model.supported_parameters ?? []);
  const context = model.context_length ?? model.top_provider?.context_length ?? 0;
  const reasons: string[] = [];
  let score = Math.min(context, 1_000_000) / 2_000;
  if (context >= 1_000_000) reasons.push("1M context");
  else if (context >= 250_000) reasons.push("large context");

  const add = (amount: number, reason: string) => {
    score += amount;
    reasons.push(reason);
  };

  const created = model.created ?? 0;
  if (created >= 1_781_500_000) add(300, "newly listed on OpenRouter");
  else if (created >= 1_780_500_000) add(140, "recent OpenRouter listing");

  if (params.has("tools")) add(450, "tools");
  if (params.has("tool_choice")) add(120, "tool choice");
  if (params.has("structured_outputs")) add(140, "structured outputs");
  if (params.has("response_format")) add(90, "json response format");
  if (params.has("reasoning") || params.has("include_reasoning")) add(130, "reasoning controls");

  if (/cohere\/north-mini-code/.test(id)) add(mode === "coding" ? 1_850 : 1_700, "latest coding/agent specialist");
  else if (/qwen\/qwen3-coder/.test(id)) add(mode === "coding" ? 1_350 : 1_200, "coding/agent specialist");
  else if (/nemotron-3-ultra|nemotron-3-super/.test(id)) add(1_120, "large reasoning model");
  else if (/openrouter\/owl-alpha/.test(id)) add(1_080, "frontier free router model");
  else if (/qwen\/qwen3-next/.test(id)) add(1_020, "strong instruct model");
  else if (/gpt-oss-120b/.test(id)) add(980, "120B open model");
  else if (/gemma-4-31b|gemma-4-26b/.test(id)) add(900, "strong Google open model");
  else if (/moonshotai\/kimi-k2\.6/.test(id)) add(900, "Kimi agent model");
  else if (/glm-4\.5/.test(id)) add(820, "GLM reasoning model");
  else if (/llama-3\.3-70b/.test(id)) add(760, "70B instruct model");
  else if (/mistral-small|deepseek/.test(id)) add(650, "capable fallback");
  else if (/openrouter\/free/.test(id)) add(250, "free meta-router fallback");

  if (/nano|mini|xs|9b|12b/.test(haystack)) score -= 140;
  if (/audio|music|lyria|clip|embed/.test(haystack)) score -= 1_000;
  if (mode === "structured" && !(params.has("structured_outputs") || params.has("response_format"))) score -= 250;
  if (mode === "vision" && !hasInputModality(model, "image")) score -= 500;

  return { score, reasons };
}

export function isFreeTextModel(model: OpenRouterModelInfo): boolean {
  const pricing = model.pricing ?? {};
  const prompt = Number(pricing.prompt ?? "1");
  const completion = Number(pricing.completion ?? "1");
  const request = Number(pricing.request ?? "0");
  const outputs = model.architecture?.output_modalities ?? [];
  return prompt === 0 && completion === 0 && request === 0 && (outputs.length === 0 || outputs.includes("text"));
}

function isUsableForMode(model: OpenRouterModelInfo, mode: OpenRouterFreeModelMode): boolean {
  if (!isFreeTextModel(model)) return false;
  const haystack = `${model.id} ${model.name ?? ""}`.toLowerCase();
  if (/audio|music|lyria|clip|embed/.test(haystack)) return false;
  const params = new Set(model.supported_parameters ?? []);
  if ((mode === "agent" || mode === "coding") && !params.has("tools")) return false;
  if (mode === "structured" && !params.has("tools") && !params.has("response_format") && !params.has("structured_outputs")) return false;
  if (mode === "vision" && !hasInputModality(model, "image")) return false;
  return true;
}

function hasInputModality(model: OpenRouterModelInfo, modality: string): boolean {
  return (model.architecture?.input_modalities ?? []).includes(modality);
}

function normalizeModelId(modelId: string): string {
  return modelId.toLowerCase().trim();
}

function openRouterHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "HTTP-Referer": "https://noderoom.local",
    "X-Title": "NodeRoom free model discovery",
  };
  const apiKey = envValue("OPENROUTER_API_KEY");
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

function envValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}
