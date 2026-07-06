import { getProviderForModel, resolveModelAlias, type LlmProvider } from "../models/modelCatalog";
import { providerHealthDecision } from "./providerHealth";

type Env = Record<string, string | undefined>;

export type ProviderEgressArtifact = {
  title?: string;
  kind?: string;
  meta?: unknown;
  visibility?: "private" | "room" | "public" | string;
  source?: "upload" | "provider_parse" | "manual" | "generated" | string;
};

export type ProviderEgressEntrypoint = "public_ask" | "private_agent" | "free" | "system" | "automation" | "provider_parser" | "room_work" | "okf_embedding";

export type ProviderEgressDecision =
  | { ok: true; policy: "provider_egress_v1" }
  | { ok: false; policy: "provider_egress_v1"; reason: string; artifactTitle?: string };

export type ProviderRouteEntrypoint = ProviderEgressEntrypoint;
export type ProviderRouteProvider = LlmProvider | "local";
export type ProviderRouteReceipt = {
  policy: "provider_route_v1";
  requestedModel: string;
  resolvedModel: string;
  provider: ProviderRouteProvider;
  entrypoint: ProviderRouteEntrypoint;
  allowedProviders: ProviderRouteProvider[];
  noTrainingRequired: boolean;
  basis: string[];
};
export type ProviderRouteDecision =
  | ({ ok: true } & ProviderRouteReceipt)
  | ({ ok: false; reason: string; provider?: ProviderRouteProvider | null } & Omit<ProviderRouteReceipt, "provider">);

const DEFAULT_ALLOWED_PROVIDERS: ProviderRouteProvider[] = ["openai", "anthropic", "gemini", "openrouter", "nebius", "local"];
export const FREE_FILE_EGRESS_BLOCK_REASON = "free_file_egress_requires_OPENROUTER_FREE_ALLOW_FILE_EGRESS";
export const FREE_FILE_EGRESS_PROMOTION_FLAG = "FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION";

export function isOpenRouterFreeRoute(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return normalized === "openrouter/free-auto" || normalized === "openrouter/free" || normalized.endsWith(":free");
}

export function isExternalProviderRoute(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return !!normalized && !normalized.startsWith("local/") && normalized !== "local" && normalized !== "none";
}

export function providerEgressDecision(args: {
  model: string;
  entrypoint: ProviderEgressEntrypoint;
  artifacts: ProviderEgressArtifact[];
  env?: Env;
}): ProviderEgressDecision {
  const env = args.env ?? process.env;
  const external = isExternalProviderRoute(args.model);
  const freeRoute = isOpenRouterFreeRoute(args.model) || args.entrypoint === "free";
  if (!external) return { ok: true, policy: "provider_egress_v1" };

  for (const artifact of args.artifacts) {
    const risk = classifyArtifactEgress(artifact);
    if (risk.explicitBlock) {
      return blocked("explicit_local_only", artifact);
    }
    if (risk.sensitive) {
      return blocked("sensitive_artifact", artifact);
    }
    if (freeRoute && risk.fileDerived && env.OPENROUTER_FREE_ALLOW_FILE_EGRESS !== "1") {
      return blocked(FREE_FILE_EGRESS_BLOCK_REASON, artifact);
    }
    if (freeRoute && risk.providerDerived && env.OPENROUTER_REQUIRE_NO_TRAINING !== "1") {
      return blocked("free_provider_parse_requires_OPENROUTER_REQUIRE_NO_TRAINING", artifact);
    }
    if (args.entrypoint === "provider_parser" && risk.fileDerived && env.PROVIDER_PARSER_ALLOW_FILE_EGRESS !== "1") {
      return blocked("provider_parser_file_egress_requires_PROVIDER_PARSER_ALLOW_FILE_EGRESS", artifact);
    }
  }

  return { ok: true, policy: "provider_egress_v1" };
}

export function assertProviderEgressAllowed(args: {
  model: string;
  entrypoint: ProviderEgressEntrypoint;
  artifacts: ProviderEgressArtifact[];
  env?: Env;
}): ProviderEgressDecision {
  const decision = providerEgressDecision(args);
  if (!decision.ok) {
    throw new Error(`provider_egress_blocked:${decision.reason}`);
  }
  return decision;
}

export function hasFileDerivedProviderEgress(artifacts: ProviderEgressArtifact[]): boolean {
  return artifacts.some((artifact) => classifyArtifactEgress(artifact).fileDerived);
}

export function providerPolicyBlockedReason(error: unknown): string | undefined {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/\bprovider_(?:egress|route)_blocked:([A-Za-z0-9_:-]+)/);
  return match?.[1];
}

export function isProviderPolicyBlockedError(error: unknown): boolean {
  return providerPolicyBlockedReason(error) !== undefined;
}

export function freeFileEgressPromotionAllowed(env: Env = process.env): boolean {
  return env[FREE_FILE_EGRESS_PROMOTION_FLAG] === "1" || env.AGENT_ALLOW_FREE_FILE_EGRESS_PROMOTION === "1";
}

export function providerNonRetryableReason(error: unknown): string | undefined {
  const policyReason = providerPolicyBlockedReason(error);
  if (policyReason) return policyReason;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  if (/\bProvider (?:request|stream) failed 402\b/i.test(message) || /\binsufficient credits?\b/i.test(message)) {
    return "provider_insufficient_credits";
  }
  if (/\bProvider (?:request|stream) failed 401\b/i.test(message) || /\b(?:unauthorized|invalid api key)\b/i.test(message)) {
    return "provider_auth_required";
  }
  if (/\bProvider (?:request|stream) failed 403\b/i.test(message) || /\bforbidden\b/i.test(message)) {
    return "provider_forbidden";
  }
  return undefined;
}

export function isProviderNonRetryableError(error: unknown): boolean {
  return providerNonRetryableReason(error) !== undefined;
}

export function providerRouteDecision(args: {
  model: string;
  entrypoint: ProviderRouteEntrypoint;
  env?: Env;
}): ProviderRouteDecision {
  const env = args.env ?? process.env;
  const requestedModel = args.model.trim();
  const resolvedModel = resolveModelAlias(requestedModel);
  const allowedProviders = providerAllowlist(env);
  const external = isExternalProviderRoute(resolvedModel);
  const provider = external ? getProviderForModel(resolvedModel) : "local";
  const noTrainingRequired = env.OPENROUTER_REQUIRE_NO_TRAINING === "1";
  const health = providerHealthDecision({ requestedModel, resolvedModel, provider, env });
  const basis = [
    `entrypoint:${args.entrypoint}`,
    `requested:${requestedModel}`,
    `resolved:${resolvedModel}`,
    `external:${String(external)}`,
    `allowlist:${allowedProviders.join(",")}`,
    `no_training_required:${String(noTrainingRequired)}`,
    ...health.basis,
  ];

  if (!provider) {
    return {
      ok: false,
      policy: "provider_route_v1",
      reason: "unknown_provider",
      requestedModel,
      resolvedModel,
      provider,
      entrypoint: args.entrypoint,
      allowedProviders,
      noTrainingRequired,
      basis,
    };
  }

  if (!allowedProviders.includes(provider)) {
    return {
      ok: false,
      policy: "provider_route_v1",
      reason: "provider_not_allowed",
      requestedModel,
      resolvedModel,
      provider,
      entrypoint: args.entrypoint,
      allowedProviders,
      noTrainingRequired,
      basis,
    };
  }

  if (!health.ok) {
    return {
      ok: false,
      policy: "provider_route_v1",
      reason: health.reason,
      requestedModel,
      resolvedModel,
      provider,
      entrypoint: args.entrypoint,
      allowedProviders,
      noTrainingRequired,
      basis: [...basis, `quarantine_reason:${health.quarantineReason}`],
    };
  }

  if (
    args.entrypoint === "free" &&
    external &&
    !isOpenRouterFreeRoute(resolvedModel) &&
    env.FREE_AUTO_ALLOW_PAID_MODEL !== "1"
  ) {
    return {
      ok: false,
      policy: "provider_route_v1",
      reason: "free_entrypoint_requires_free_model_or_FREE_AUTO_ALLOW_PAID_MODEL",
      requestedModel,
      resolvedModel,
      provider,
      entrypoint: args.entrypoint,
      allowedProviders,
      noTrainingRequired,
      basis,
    };
  }

  return {
    ok: true,
    policy: "provider_route_v1",
    requestedModel,
    resolvedModel,
    provider,
    entrypoint: args.entrypoint,
    allowedProviders,
    noTrainingRequired,
    basis,
  };
}

export function assertProviderRouteAllowed(args: {
  model: string;
  entrypoint: ProviderRouteEntrypoint;
  env?: Env;
}): ProviderRouteReceipt {
  const decision = providerRouteDecision(args);
  if (!decision.ok) {
    throw new Error(`provider_route_blocked:${decision.reason}`);
  }
  return decision;
}

function classifyArtifactEgress(artifact: ProviderEgressArtifact): {
  explicitBlock: boolean;
  sensitive: boolean;
  fileDerived: boolean;
  providerDerived: boolean;
} {
  const meta = objectRecord(artifact.meta);
  const privacy = objectRecord(meta?.privacy);
  const document = objectRecord(meta?.document);
  const upload = objectRecord(meta?.upload);
  const providerParse = objectRecord(meta?.providerParse);
  const egress = stringValue(privacy?.egress ?? meta?.egress ?? meta?.egressPolicy);
  const sensitivity = stringValue(privacy?.sensitivity ?? meta?.sensitivity ?? meta?.classification);
  const visibility = stringValue(artifact.visibility ?? privacy?.visibility ?? meta?.visibility);
  const source = stringValue(artifact.source ?? meta?.source ?? meta?.sourceKind);
  const parser = stringValue(document?.parser);
  const status = stringValue(document?.status);
  const requiredRuntime = Array.isArray(document?.requiredRuntime) ? document.requiredRuntime.map((v) => String(v).toLowerCase()) : [];

  return {
    explicitBlock: egress === "blocked" || egress === "local_only" || egress === "no_external_provider",
    sensitive: visibility === "private" || sensitivity === "private" || sensitivity === "restricted" || sensitivity === "sensitive",
    fileDerived: source === "upload" || !!upload || !!providerParse || parser === "provider" || status === "server_parser_required" || requiredRuntime.includes("ocr"),
    providerDerived: source === "provider_parse" || !!providerParse || parser === "provider",
  };
}

function blocked(reason: string, artifact: ProviderEgressArtifact): ProviderEgressDecision {
  return { ok: false, policy: "provider_egress_v1", reason, artifactTitle: artifact.title };
}

function providerAllowlist(env: Env): ProviderRouteProvider[] {
  const raw = env.NODEAGENT_ALLOWED_PROVIDERS ?? env.PROVIDER_EGRESS_ALLOWED_PROVIDERS;
  if (!raw && (env.PROVIDER_EGRESS_REQUIRE_ALLOWLIST === "1" || env.NODEROOM_PRODUCTION === "1")) return ["local"];
  if (!raw) return DEFAULT_ALLOWED_PROVIDERS;
  const values = raw.split(",").map((part) => part.trim().toLowerCase()).filter(Boolean) as ProviderRouteProvider[];
  if (!values.length && (env.PROVIDER_EGRESS_REQUIRE_ALLOWLIST === "1" || env.NODEROOM_PRODUCTION === "1")) return ["local"];
  return values.length ? values : DEFAULT_ALLOWED_PROVIDERS;
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}
