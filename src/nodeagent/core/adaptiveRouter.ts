import type { ModelPricing } from "../models/modelCatalog";
import { getModelPricing, getProviderForModel, resolveModelAlias } from "../models/modelCatalog";
import { OPENROUTER_FREE_AUTO_MODEL, selectOpenRouterFreeModels } from "../models/openRouterFreeModels";

export type NodeAgentRouteRisk = "low" | "medium" | "high";
export type NodeAgentLatencyClass = "interactive" | "batch" | "overnight";
export type NodeAgentTaskType =
  | "collaboration"
  | "research"
  | "private_consult"
  | "analysis"
  | "router"
  | "spreadsheet"
  | "finance"
  | "benchmark";

export interface NodeAgentRouteRequest {
  task: NodeAgentTaskType;
  risk: NodeAgentRouteRisk;
  latency: NodeAgentLatencyClass;
  freeAllowed?: boolean;
  requiresManagedWrites?: boolean;
  requiresVisionOrFiles?: boolean;
}

export interface NodeAgentRouteDecision {
  model: string;
  lane: "fast" | "deep" | "free_auto" | "benchmark";
  provider: string;
  pricing: ModelPricing | null;
  reason: string;
  requireN5Promotion: boolean;
}

export interface AdaptiveRouteRequest {
  taskType: Exclude<NodeAgentTaskType, "benchmark">;
  preferredModel?: string;
  allowFree?: boolean;
  latencySensitive?: boolean;
  highTrust?: boolean;
}

export interface AdaptiveRouteDecision {
  lane: AdaptiveRouteRequest["taskType"];
  model: string;
  provider: string;
  pricing: ModelPricing | null;
  reason: string;
}

export type ReviewRouteTaskType =
  | "interactive"
  | "company_research"
  | "bulk_company_research"
  | "runway_forecast"
  | "semantic_rebase"
  | "managed_write"
  | "downstream_publish"
  | "research"
  | "collaboration"
  | "private_consult";

export interface ReviewAdaptiveRouteInput {
  taskType: ReviewRouteTaskType;
  risk?: NodeAgentRouteRisk;
  latency?: "realtime" | "balanced" | "deep";
  maxCostUsd?: number;
  requiresTools?: boolean;
  preferredModel?: string;
  freeAllowed?: boolean;
}

export interface ReviewAdaptiveRoute {
  modelId: string;
  lane: "fast" | "research" | "reasoning" | "governed" | "free_auto";
  provider: string;
  reason: string;
  pricing: ModelPricing | null;
}

export function defaultRouteForTask(taskType: AdaptiveRouteRequest["taskType"]): string {
  if (taskType === "research" || taskType === "finance") return process.env.AGENT_RESEARCH_MODEL ?? "minimax/minimax-m3";
  if (taskType === "router") return process.env.AGENT_ROUTER_MODEL ?? OPENROUTER_FREE_AUTO_MODEL;
  return process.env.AGENT_MODEL ?? "gemini-3.5-flash";
}

export function chooseModelRoute(request: AdaptiveRouteRequest): AdaptiveRouteDecision {
  const model = resolveModelAlias(request.preferredModel?.trim() || (request.allowFree ? OPENROUTER_FREE_AUTO_MODEL : defaultRouteForTask(request.taskType)));
  const provider = getProviderForModel(model) ?? "openrouter";
  const pricing = getModelPricing(model);
  const reasons = [
    `lane=${request.taskType}`,
    request.allowFree ? "free-auto enabled" : "lane default",
    request.latencySensitive ? "latency sensitive" : "latency balanced",
    request.highTrust ? "high-trust path" : "standard path",
  ];
  return { lane: request.taskType, model, provider, pricing, reason: reasons.join("; ") };
}

export async function chooseFreeFallbacks(limit = 5) {
  return selectOpenRouterFreeModels({ mode: "agent", limit });
}

export function chooseNodeAgentRoute(req: NodeAgentRouteRequest): NodeAgentRouteDecision {
  if (req.task === "benchmark") {
    return {
      model: "openrouter/auto",
      lane: "benchmark",
      provider: "openrouter",
      pricing: null,
      reason: "benchmark route is selected by the model-eval matrix, not by product defaults",
      requireN5Promotion: true,
    };
  }
  if (req.freeAllowed && req.latency !== "interactive" && req.risk === "low" && !req.requiresManagedWrites) {
    return {
      model: "openrouter/free-auto",
      lane: "free_auto",
      provider: "openrouter",
      pricing: getModelPricing("openrouter/free-auto"),
      reason: "low-risk background enrichment can tolerate free-route fallback latency",
      requireN5Promotion: true,
    };
  }
  if (req.risk === "high" || req.requiresManagedWrites || req.requiresVisionOrFiles || req.task === "finance") {
    const modelId = process.env.AGENT_RESEARCH_MODEL ?? "minimax/minimax-m3";
    return {
      model: modelId,
      lane: "deep",
      provider: getProviderForModel(modelId) ?? "openrouter",
      pricing: getModelPricing(modelId),
      reason: "managed writes, files, or finance workflows require a ladder-proven route",
      requireN5Promotion: true,
    };
  }
  const modelId = "gemini-3.5-flash";
  return {
    model: modelId,
    lane: "fast",
    provider: getProviderForModel(modelId) ?? "gemini",
    pricing: getModelPricing(modelId),
    reason: "fast interactive lane for bounded low-risk chat and summarization",
    requireN5Promotion: true,
  };
}

export function chooseAdaptiveRoute(input: ReviewAdaptiveRouteInput): ReviewAdaptiveRoute {
  const freeAllowed = input.freeAllowed === true && input.risk === "low";
  const route = chooseNodeAgentRoute({
    task: reviewTaskToNodeAgentTask(input.taskType),
    risk: input.risk ?? (input.taskType === "semantic_rebase" || input.taskType === "managed_write" ? "high" : "medium"),
    latency: input.latency === "realtime" ? "interactive" : input.latency === "deep" ? "overnight" : "batch",
    freeAllowed,
    requiresManagedWrites: input.requiresTools ?? (input.taskType === "semantic_rebase" || input.taskType === "managed_write"),
  });
  const modelId = resolveModelAlias(input.preferredModel?.trim() || route.model);
  return {
    modelId,
    lane: reviewLane(input, route),
    provider: getProviderForModel(modelId) ?? route.provider,
    pricing: getModelPricing(modelId),
    reason: `${input.taskType}: ${route.reason}${input.maxCostUsd === undefined ? "" : `; cost cap $${input.maxCostUsd.toFixed(4)}`}`,
  };
}

function reviewTaskToNodeAgentTask(taskType: ReviewRouteTaskType): NodeAgentTaskType {
  if (taskType === "company_research" || taskType === "bulk_company_research" || taskType === "research") return "research";
  if (taskType === "runway_forecast" || taskType === "semantic_rebase") return "finance";
  if (taskType === "private_consult") return "private_consult";
  if (taskType === "downstream_publish" || taskType === "managed_write") return "collaboration";
  return "collaboration";
}

function reviewLane(input: ReviewAdaptiveRouteInput, route: NodeAgentRouteDecision): ReviewAdaptiveRoute["lane"] {
  if (input.risk === "high" || input.taskType === "semantic_rebase" || input.taskType === "managed_write") return "governed";
  if (input.taskType === "company_research" || input.taskType === "bulk_company_research" || input.taskType === "research") return "research";
  if (route.lane === "free_auto") return "free_auto";
  if (route.lane === "fast") return "fast";
  return "reasoning";
}
