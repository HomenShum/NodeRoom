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
    // A free-auto request MUST resolve to an ACTUAL free model (":free" suffix or
    // the free-auto/free policy itself). A $0 reading does NOT prove free
    // compliance: an errored run bills $0, and a paid model wrongly promoted onto
    // a /free request (the file-egress promotion path -> z-ai/glm-4.7-flash)
    // reads $0 until the account has credits, then 402s. So resolving to a
    // non-free model is a mismatch REGARDLESS of this-run cost — that is exactly
    // the signal that catches the promotion bug. (A prior version gave $0 a pass
    // and silenced this alarm; that was wrong — do not reintroduce it.)
    const routeMatches = telemetryModels.every((model) => {
      if (isFreeAutoPolicy(requestedModel)) return isFreeModelPolicy(model);
      return normalizeModel(model) === normalizeModel(requestedModel);
    });
    if (!routeMatches) failures.push("model_route_mismatch");
    // A free-requested route that resolved to a non-free-identity model used a
    // paid model — flag by IDENTITY, independent of this-run cost (the promotion
    // bills once the account has credits). Actual spend is ALSO caught by
    // free_route_billed_nonzero_cost below; the two are complementary.
    if (requestedIsFree && telemetryModels.some((model) => !isFreeModelPolicy(model))) {
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
