import { resolveModelAlias } from "../models/modelCatalog";

export type InteropRouteRuntime = "native" | "langchain" | "litellm" | "openrouter";

export type InteropModelRoute = {
  requested: string;
  modelId: string;
  provider: string;
  runtime: InteropRouteRuntime;
  routePolicy: "specific" | "proxy" | "deterministic";
  basis: string[];
};

export function normalizeInteropModelRoute(route: string): InteropModelRoute {
  const requested = route.trim();
  const lower = requested.toLowerCase();
  if (!requested) {
    return {
      requested,
      modelId: "",
      provider: "",
      runtime: "native",
      routePolicy: "specific",
      basis: ["empty_route"],
    };
  }

  if (lower === "local" || lower === "local/deterministic" || lower.startsWith("local/")) {
    return {
      requested,
      modelId: requested,
      provider: "local",
      runtime: "native",
      routePolicy: "deterministic",
      basis: ["local_route"],
    };
  }

  const langchain = requested.match(/^langchain:([^:]+):(.+)$/i);
  if (langchain) {
    const provider = normalizeProvider(langchain[1]);
    const modelId = normalizeProviderScopedModel(provider, langchain[2]);
    return {
      requested,
      modelId,
      provider,
      runtime: "langchain",
      routePolicy: "proxy",
      basis: [`runtime:langchain`, `provider:${provider}`, `model:${modelId}`],
    };
  }

  const litellm = requested.match(/^litellm:(.+)$/i);
  if (litellm) {
    const scoped = normalizeScopedGatewayModel(litellm[1]);
    return {
      requested,
      modelId: scoped.modelId,
      provider: scoped.provider,
      runtime: "litellm",
      routePolicy: "proxy",
      basis: [`runtime:litellm`, `provider:${scoped.provider}`, `model:${scoped.modelId}`],
    };
  }

  const openrouter = requested.match(/^openrouter:(.+)$/i);
  if (openrouter) {
    const model = openrouter[1].trim();
    const modelId = model === "free" || model === "free-auto" ? `openrouter/${model}` : resolveModelAlias(model);
    return {
      requested,
      modelId,
      provider: "openrouter",
      runtime: "openrouter",
      routePolicy: "proxy",
      basis: [`runtime:openrouter`, `provider:openrouter`, `model:${modelId}`],
    };
  }

  const modelId = resolveModelAlias(requested);
  return {
    requested,
    modelId,
    provider: inferProvider(modelId),
    runtime: "native",
    routePolicy: "specific",
    basis: [`runtime:native`, `model:${modelId}`],
  };
}

function normalizeProvider(provider: string): string {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "google" || normalized === "gemini" || normalized === "google-genai") return "google";
  if (normalized === "anthropic" || normalized === "claude") return "anthropic";
  if (normalized === "openai") return "openai";
  if (normalized === "openrouter") return "openrouter";
  if (normalized === "local") return "local";
  return normalized || "unknown";
}

function normalizeProviderScopedModel(provider: string, model: string): string {
  const trimmed = model.trim();
  if (provider === "openrouter" && (trimmed === "free" || trimmed === "free-auto")) return `openrouter/${trimmed}`;
  return resolveModelAlias(trimmed);
}

function normalizeScopedGatewayModel(model: string): { provider: string; modelId: string } {
  const trimmed = model.trim();
  const [scope, ...rest] = trimmed.split("/");
  const payload = rest.join("/");
  const provider = normalizeProvider(scope ?? "");
  if (!payload || !["openai", "anthropic", "google", "openrouter"].includes(provider)) {
    const modelId = resolveModelAlias(trimmed);
    return { provider: inferProvider(modelId, "litellm"), modelId };
  }
  return {
    provider,
    modelId: normalizeProviderScopedModel(provider, payload),
  };
}

function inferProvider(modelId: string, fallback = "unknown"): string {
  const lower = modelId.toLowerCase();
  if (!modelId) return "";
  if (lower === "local" || lower.startsWith("local/")) return "local";
  if (lower.startsWith("nebius/")) return "nebius";
  if (lower.startsWith("openrouter/") || lower.includes("/")) return "openrouter";
  if (/^(?:gpt-|o\d|chatgpt-)/i.test(modelId)) return "openai";
  if (/^claude/i.test(modelId)) return "anthropic";
  if (/^(?:gemini|deep-research)-/i.test(modelId)) return "google";
  return fallback;
}
