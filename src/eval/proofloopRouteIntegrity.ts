export type ProofloopTelemetryLike = {
  model?: string | null;
  costUsd?: number | null;
};

export type ProofloopRouteIntegrity = {
  status: "matched" | "unverified" | "model_route_mismatch";
  requestedModel: string | null;
  telemetryModels: string[];
  measuredCostUsd: number | null;
  failures: string[];
};

export function evaluateProofloopRouteIntegrity(args: {
  requestedModel?: string | null;
  telemetry?: Array<ProofloopTelemetryLike | null | undefined>;
}): ProofloopRouteIntegrity {
  const requestedModel = cleanModel(args.requestedModel);
  const telemetry = args.telemetry ?? [];
  const telemetryModels = uniqueStrings(telemetry.map((row) => cleanModel(row?.model)).filter((value): value is string => !!value));
  const measuredCostUsd = sumNullable(telemetry.map((row) => row?.costUsd ?? null));
  const failures: string[] = [];

  if (!requestedModel) failures.push("missing_requested_model");
  if (telemetryModels.length === 0) failures.push("missing_model_telemetry");

  if (requestedModel && telemetryModels.length > 0) {
    const requestedIsFree = isFreeModelPolicy(requestedModel);
    // Ground truth for the free-route contract is MEASURED COST, not the model
    // name. A genuinely free model (e.g. z-ai/glm-4.7-flash) carries no ":free"
    // suffix yet bills $0, so a proven-$0 run satisfies free-auto even when the
    // resolved name isn't in the naming allowlist. Only a proven zero earns the
    // pass — unknown cost (null) falls back to the name heuristic.
    const billedNothing = measuredCostUsd === 0;
    const routeMatches = telemetryModels.every((model) => {
      if (isFreeAutoPolicy(requestedModel)) return isFreeModelPolicy(model) || billedNothing;
      return normalizeModel(model) === normalizeModel(requestedModel);
    });
    if (!routeMatches) failures.push("model_route_mismatch");
    // "used a PAID model" must mean money was actually spent — an unrecognized
    // model name at $0 measured cost is not a paid model. Guard on measured
    // cost so a free resolution can never be mislabeled paid (the >0 case is
    // still caught here AND by free_route_billed_nonzero_cost below).
    if (
      requestedIsFree &&
      typeof measuredCostUsd === "number" &&
      measuredCostUsd > 0 &&
      telemetryModels.some((model) => !isFreeModelPolicy(model))
    ) {
      failures.push("free_route_used_paid_model");
    }
  }

  if (isFreeModelPolicy(requestedModel) && typeof measuredCostUsd === "number" && measuredCostUsd > 0) {
    failures.push("free_route_billed_nonzero_cost");
  }

  return {
    status: failures.length === 0 ? "matched" : failures.includes("model_route_mismatch") || failures.some((failure) => failure.startsWith("free_route_"))
      ? "model_route_mismatch"
      : "unverified",
    requestedModel,
    telemetryModels,
    measuredCostUsd,
    failures: uniqueStrings(failures),
  };
}

export function routeIntegrityFailureSummary(integrity: ProofloopRouteIntegrity): string | null {
  if (integrity.status === "matched") return null;
  const actual = integrity.telemetryModels.length ? integrity.telemetryModels.join(", ") : "none";
  const cost = integrity.measuredCostUsd == null ? "unknown" : `$${integrity.measuredCostUsd.toFixed(integrity.measuredCostUsd < 0.01 ? 6 : 4)}`;
  return [
    `route_integrity=${integrity.status}`,
    `requested=${integrity.requestedModel ?? "unknown"}`,
    `actual=${actual}`,
    `cost=${cost}`,
    `failures=${integrity.failures.join(",") || "none"}`,
  ].join("; ");
}

function cleanModel(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeModel(value: string): string {
  return value.trim().toLowerCase();
}

function isFreeAutoPolicy(value: string | null): boolean {
  const normalized = value ? normalizeModel(value) : "";
  return normalized === "openrouter/free-auto" || normalized === "openrouter/free";
}

function isFreeModelPolicy(value: string | null): boolean {
  const normalized = value ? normalizeModel(value) : "";
  return isFreeAutoPolicy(normalized) || normalized.endsWith(":free");
}

function sumNullable(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? Number(finite.reduce((sum, value) => sum + value, 0).toFixed(6)) : null;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
