import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { normalizeInteropModelRoute } from "../nodeagent/integrations/modelInterop";
import { getModelPricing, resolveModelAlias } from "../nodeagent/models/modelCatalog";

export type ProofloopModelRole = "planner" | "worker" | "judge" | "verifier";
export type ProofloopCostAccountingStatus = "actual" | "estimated" | "free" | "unknown";
export type ProofloopCostAccountingSource =
  | "env"
  | "browser_telemetry"
  | "catalog_estimate"
  | "free_local"
  | "free_provider"
  | "no_provider"
  | "unknown";

export type ProofloopCostAccounting = {
  status: ProofloopCostAccountingStatus;
  source: ProofloopCostAccountingSource;
  note: string;
};

export type ProofloopModelRoute = {
  provider: string;
  id: string;
  routePolicy: "specific" | "default" | "proxy" | "deterministic";
  role: ProofloopModelRole;
  costUsd: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costAccounting: ProofloopCostAccounting;
  selectionReason: string;
  source: "env" | "suite-default" | "deterministic-default";
};

export type ProofloopModelCostFields = Pick<ProofloopModelRoute, "costUsd" | "tokensIn" | "tokensOut" | "costAccounting">;

export type ProofloopHarnessVersion = {
  suite: string;
  harnessVersion: string;
  files: Array<{
    path: string;
    exists: boolean;
    sha256?: string;
  }>;
};

export function proofloopModelRouteForRun(args: {
  suite: string;
  cmd: string;
  env?: NodeJS.ProcessEnv;
  role?: ProofloopModelRole;
}): ProofloopModelRoute {
  const env = args.env ?? process.env;
  const explicit =
    env.NODEROOM_LANGCHAIN_ROUTE ??
    env.PROOFLOOP_MODEL_ID ??
    env.NODEAGENT_MODEL_ID ??
    env.NODEAGENT_MODEL ??
    env.BTB_MODEL_ID ??
    env.OPENROUTER_MODEL;
  const inferred = explicit ?? defaultModelForSuite(args.suite, args.cmd);
  const normalized = normalizeInteropModelRoute(inferred);
  const id = normalized.modelId.trim();
  const source: ProofloopModelRoute["source"] = explicit ? "env" : id === "local/deterministic" ? "deterministic-default" : "suite-default";
  const routePolicy = normalized.routePolicy === "proxy" ? "proxy" : id === "local/deterministic" ? "deterministic" : explicit ? "specific" : "default";
  const role = args.role ?? roleForSuite(args.suite);
  const provider = normalized.provider || providerForModel(id);
  const costFields = proofloopModelCostFieldsForRun({
    modelId: id,
    provider,
    routePolicy,
    costUsd: numberFromEnv(env.PROOFLOOP_MODEL_COST_USD ?? env.PROOFLOOP_PROVIDER_COST_USD),
    tokensIn: numberFromEnv(env.PROOFLOOP_TOKENS_IN ?? env.PROOFLOOP_INPUT_TOKENS),
    tokensOut: numberFromEnv(env.PROOFLOOP_TOKENS_OUT ?? env.PROOFLOOP_OUTPUT_TOKENS),
    source: "env",
  });
  return {
    provider,
    id,
    routePolicy,
    role,
    ...costFields,
    latencyMs: numberFromEnv(env.PROOFLOOP_MODEL_LATENCY_MS ?? env.PROOFLOOP_LATENCY_MS ?? env.PROOFLOOP_DURATION_MS) ?? 0,
    selectionReason: env.PROOFLOOP_MODEL_SELECTION_REASON ?? defaultSelectionReason({
      suite: args.suite,
      cmd: args.cmd,
      id,
      requestedId: normalized.requested,
      runtime: normalized.runtime,
      source,
      role,
      routePolicy,
    }),
    source,
  };
}

export function proofloopModelCostFieldsForRun(args: {
  modelId: string;
  provider?: string;
  routePolicy?: string;
  costUsd?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  source?: "env" | "browser_telemetry";
}): ProofloopModelCostFields {
  const provider = (args.provider ?? providerForModel(args.modelId)).trim();
  const routePolicy = args.routePolicy ?? "specific";
  const reportedCostUsd = finiteNonNegative(args.costUsd) ? args.costUsd : undefined;
  const reportedTokensIn = finiteNonNegative(args.tokensIn) ? args.tokensIn : undefined;
  const reportedTokensOut = finiteNonNegative(args.tokensOut) ? args.tokensOut : undefined;
  const hasPositiveTokens = (reportedTokensIn ?? 0) > 0 && (reportedTokensOut ?? 0) > 0;
  const telemetrySource = args.source ?? "env";
  const freeOrLocal = isProofloopFreeLocalOrNoProviderModel({
    id: args.modelId,
    provider,
    routePolicy,
  });

  if (freeOrLocal) {
    return {
      costUsd: reportedCostUsd ?? 0,
      tokensIn: reportedTokensIn ?? 0,
      tokensOut: reportedTokensOut ?? 0,
      costAccounting: {
        status: "free",
        source: freeAccountingSource(args.modelId, provider),
        note: "Zero cost is explicit because this route is local, no-provider, deterministic, or catalog-priced as free.",
      },
    };
  }

  if (reportedCostUsd !== undefined && reportedCostUsd > 0 && hasPositiveTokens) {
    return {
      costUsd: reportedCostUsd,
      tokensIn: reportedTokensIn!,
      tokensOut: reportedTokensOut!,
      costAccounting: {
        status: "actual",
        source: telemetrySource,
        note: "Cost and token counts came from run telemetry.",
      },
    };
  }

  if (hasPositiveTokens) {
    const estimated = estimateModelCostUsd(args.modelId, reportedTokensIn!, reportedTokensOut!);
    if (estimated !== undefined && estimated > 0) {
      return {
        costUsd: estimated,
        tokensIn: reportedTokensIn!,
        tokensOut: reportedTokensOut!,
        costAccounting: {
          status: "estimated",
          source: "catalog_estimate",
          note: `Estimated from catalog pricing because ${telemetrySource} did not report a positive provider cost.`,
        },
      };
    }
  }

  return {
    costUsd: Number.NaN,
    tokensIn: reportedTokensIn ?? Number.NaN,
    tokensOut: reportedTokensOut ?? Number.NaN,
    costAccounting: {
      status: "unknown",
      source: "unknown",
      note: "Paid/provider route did not expose positive cost and token telemetry; the receipt must not serialize silent zero usage.",
    },
  };
}

export function isProofloopFreeLocalOrNoProviderModel(args: {
  id?: string;
  provider?: string;
  routePolicy?: string;
}): boolean {
  const id = (args.id ?? "").trim();
  const resolved = resolveModelAlias(id).toLowerCase();
  const provider = (args.provider ?? "").trim().toLowerCase();
  const routePolicy = (args.routePolicy ?? "").trim().toLowerCase();
  if (!id) return false;
  if (routePolicy === "deterministic") return true;
  if (provider === "local" || provider === "none" || provider === "no-provider" || provider === "no_provider") return true;
  if (resolved.startsWith("local/") || resolved === "local") return true;
  if (resolved.endsWith(":free") || resolved.startsWith("openrouter/free")) return true;
  const pricing = getModelPricing(resolveModelAlias(id));
  return pricing != null && pricing.inputPer1M === 0 && pricing.outputPer1M === 0;
}

export function proofloopHarnessVersionForSuite(root: string, suite: string, extraFiles: string[] = []): ProofloopHarnessVersion {
  const files = [
    "scripts/proofloop-cli.ts",
    "scripts/proofloop.mjs",
    "src/eval/proofloopGoalSupervisor.ts",
    "src/eval/proofloopLoopArtifacts.ts",
    "src/eval/proofloopModelTracking.ts",
    "src/eval/proofloopBlockerSolver.ts",
    `proofloop/benchmarks/${suite}/adapter.json`,
    ...extraFiles,
  ];
  const hashed = files.map((path) => hashFile(root, path));
  const digest = createHash("sha256")
    .update(JSON.stringify(hashed))
    .digest("hex")
    .slice(0, 12);
  return {
    suite,
    harnessVersion: `${safeId(suite)}-harness-${digest}`,
    files: hashed,
  };
}

export function assertProofloopModelTracked(model: ProofloopModelRoute): string[] {
  const failures: string[] = [];
  const freeOrLocal = isProofloopFreeLocalOrNoProviderModel(model);
  if (!model.id.trim()) failures.push("missing_model_id");
  if (!model.provider.trim()) failures.push("missing_model_provider");
  if (!model.role.trim()) failures.push("missing_model_role");
  if (!model.routePolicy.trim()) failures.push("missing_model_route_policy");
  if (!Number.isFinite(model.costUsd)) failures.push("missing_model_cost_usd");
  if (!Number.isFinite(model.tokensIn)) failures.push("missing_model_tokens_in");
  if (!Number.isFinite(model.tokensOut)) failures.push("missing_model_tokens_out");
  if (!Number.isFinite(model.latencyMs)) failures.push("missing_model_latency_ms");
  if (!model.costAccounting?.status) failures.push("missing_model_cost_accounting");
  if (model.costAccounting?.status === "unknown" && !freeOrLocal) failures.push("unknown_paid_provider_cost_accounting");
  if (model.costAccounting?.status === "free" && !freeOrLocal) failures.push("free_cost_accounting_requires_free_local_or_no_provider");
  if (!freeOrLocal) {
    if (model.costUsd === 0) failures.push("zero_paid_provider_cost_usd");
    if (model.tokensIn === 0) failures.push("zero_paid_provider_tokens_in");
    if (model.tokensOut === 0) failures.push("zero_paid_provider_tokens_out");
  }
  if (!model.selectionReason.trim()) failures.push("missing_model_selection_reason");
  return failures;
}

function defaultModelForSuite(suite: string, cmd: string): string {
  const haystack = `${suite} ${cmd}`;
  if (/banker|btb|nodeagent|live/i.test(haystack)) return "z-ai/glm-5.2";
  if (/finch|finauditing|workstream|spreadsheet/i.test(haystack)) return "deepseek/deepseek-v4-pro";
  return "local/deterministic";
}

function providerForModel(modelId: string): string {
  if (modelId === "local/deterministic" || modelId.startsWith("local/")) return "local";
  if (modelId.toLowerCase().startsWith("nebius/")) return "nebius";
  if (modelId.includes("/")) return "openrouter";
  if (/^(?:gpt-|o\d|chatgpt-)/i.test(modelId)) return "openai";
  if (/^claude/i.test(modelId)) return "anthropic";
  if (/^gemini/i.test(modelId)) return "google";
  return "unknown";
}

function roleForSuite(suite: string): ProofloopModelRole {
  if (/judge|scorer|verifier/i.test(suite)) return "judge";
  if (/browser|live|banker|spreadsheet|finch|finauditing|workstream/i.test(suite)) return "planner";
  return "worker";
}

function numberFromEnv(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function finiteNonNegative(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function estimateModelCostUsd(modelId: string, tokensIn: number, tokensOut: number): number | undefined {
  const pricing = getModelPricing(resolveModelAlias(modelId));
  if (!pricing) return undefined;
  return Number(((tokensIn * pricing.inputPer1M + tokensOut * pricing.outputPer1M) / 1_000_000).toFixed(8));
}

function freeAccountingSource(modelId: string, provider: string): ProofloopCostAccountingSource {
  const normalizedProvider = provider.trim().toLowerCase();
  const normalizedModel = resolveModelAlias(modelId).toLowerCase();
  if (normalizedProvider === "none" || normalizedProvider === "no-provider" || normalizedProvider === "no_provider") return "no_provider";
  if (normalizedProvider === "local" || normalizedModel.startsWith("local/") || normalizedModel === "local") return "free_local";
  return "free_provider";
}

function defaultSelectionReason(args: {
  suite: string;
  cmd: string;
  id: string;
  requestedId?: string;
  runtime?: string;
  source: ProofloopModelRoute["source"];
  role: ProofloopModelRole;
  routePolicy: ProofloopModelRoute["routePolicy"];
}): string {
  if (args.source === "env") {
    return `Explicit ${args.role} model selected by proofloop environment for ${args.suite}.`;
  }
  if (args.routePolicy === "deterministic") {
    return `Deterministic local route selected because ${args.suite} does not require a live model.`;
  }
  if (args.routePolicy === "proxy") {
    return `Proxy ${args.role} route selected through ${args.runtime ?? "external runtime"} for ${args.suite}: ${args.requestedId ?? args.id} -> ${args.id}.`;
  }
  if (/finch|finauditing|workstream|spreadsheet/i.test(`${args.suite} ${args.cmd}`)) {
    return `Default finance benchmark ${args.role} route selected for ${args.suite} blocker solving and proxy comparison.`;
  }
  if (/banker|btb|nodeagent|live/i.test(`${args.suite} ${args.cmd}`)) {
    return `Default live proof ${args.role} route selected for ${args.suite}.`;
  }
  return `Default ${args.role} route selected for ${args.suite}.`;
}

function hashFile(root: string, path: string): ProofloopHarnessVersion["files"][number] {
  const absolute = join(root, path);
  if (!existsSync(absolute)) return { path, exists: false };
  return {
    path,
    exists: true,
    sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex"),
  };
}

function safeId(value: string): string {
  return basename(value).replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
}
