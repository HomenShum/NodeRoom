type Env = Record<string, string | undefined>;

export type ProviderHealthDecision =
  | { ok: true; policy: "provider_health_v1"; basis: string[] }
  | { ok: false; policy: "provider_health_v1"; reason: "route_quarantined" | "provider_quarantined"; quarantineReason: string; basis: string[] };

export function providerHealthDecision(args: {
  requestedModel: string;
  resolvedModel: string;
  provider: string | null | undefined;
  env?: Env;
}): ProviderHealthDecision {
  const env = args.env ?? process.env;
  const provider = (args.provider ?? "").toLowerCase();
  const requested = args.requestedModel.toLowerCase();
  const resolved = args.resolvedModel.toLowerCase();
  const modelMatch = quarantineMatch(env.NODEAGENT_QUARANTINED_MODELS, [requested, resolved], provider);
  const providerMatch = quarantineMatch(env.NODEAGENT_QUARANTINED_PROVIDERS, [provider], provider);
  const basis = [
    `health_policy:provider_health_v1`,
    `quarantined_models:${normalizeListForBasis(env.NODEAGENT_QUARANTINED_MODELS)}`,
    `quarantined_providers:${normalizeListForBasis(env.NODEAGENT_QUARANTINED_PROVIDERS)}`,
  ];

  if (modelMatch) {
    return { ok: false, policy: "provider_health_v1", reason: "route_quarantined", quarantineReason: modelMatch.reason, basis: [...basis, `quarantine_match:${modelMatch.token}`] };
  }
  if (providerMatch) {
    return { ok: false, policy: "provider_health_v1", reason: "provider_quarantined", quarantineReason: providerMatch.reason, basis: [...basis, `quarantine_match:${providerMatch.token}`] };
  }
  return { ok: true, policy: "provider_health_v1", basis };
}

function quarantineMatch(raw: string | undefined, values: string[], provider: string): { token: string; reason: string } | null {
  for (const entry of parseQuarantineEntries(raw)) {
    const token = entry.token.toLowerCase();
    const providerWildcard = provider && token === `${provider}/*`;
    const prefixWildcard = token.endsWith("*") && values.some((value) => value.startsWith(token.slice(0, -1)));
    const exact = values.includes(token);
    if (exact || providerWildcard || prefixWildcard) return entry;
  }
  return null;
}

function parseQuarantineEntries(raw: string | undefined): Array<{ token: string; reason: string }> {
  return (raw ?? "")
    .split(/[,\n;]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const idx = part.indexOf("=");
      if (idx === -1) return { token: part, reason: "operator_quarantine" };
      const token = part.slice(0, idx).trim();
      const reason = part.slice(idx + 1).trim() || "operator_quarantine";
      return { token, reason };
    })
    .filter((entry) => entry.token.length > 0);
}

function normalizeListForBasis(raw: string | undefined): string {
  return parseQuarantineEntries(raw).map((entry) => entry.token).join(",") || "none";
}
