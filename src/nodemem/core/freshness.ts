/**
 * Freshness — staleness checking + validity windows.
 */

import type { NodeMemFact } from "./types";

export interface FreshnessConfig {
  maxAgeMs?: number;
  now?: number;
}

const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function isFactValid(fact: NodeMemFact, now = Date.now()): boolean {
  if (fact.status === "superseded" || fact.status === "rejected") return false;
  if (fact.validTo && fact.validTo < now) return false;
  if (fact.validFrom && fact.validFrom > now) return false;
  return true;
}

export function isFactStale(fact: NodeMemFact, config?: FreshnessConfig): boolean {
  const maxAge = config?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const now = config?.now ?? Date.now();
  if (fact.status === "superseded" || fact.status === "rejected") return true;
  const age = now - fact.updatedAt;
  return age > maxAge;
}

export function freshnessLevel(
  fact: NodeMemFact,
  config?: FreshnessConfig,
): "fresh" | "stale" | "expired" | "superseded" {
  if (fact.status === "superseded" || fact.status === "rejected") return "superseded";
  const now = config?.now ?? Date.now();
  if (fact.validTo && fact.validTo < now) return "expired";
  if (isFactStale(fact, config)) return "stale";
  return "fresh";
}

export function filterValidFacts(facts: NodeMemFact[], now = Date.now()): NodeMemFact[] {
  return facts.filter((f) => isFactValid(f, now));
}

export function partitionByFreshness(
  facts: NodeMemFact[],
  config?: FreshnessConfig,
): { fresh: NodeMemFact[]; stale: NodeMemFact[]; superseded: NodeMemFact[] } {
  const fresh: NodeMemFact[] = [];
  const stale: NodeMemFact[] = [];
  const superseded: NodeMemFact[] = [];
  for (const f of facts) {
    const level = freshnessLevel(f, config);
    if (level === "fresh") fresh.push(f);
    else if (level === "stale" || level === "expired") stale.push(f);
    else superseded.push(f);
  }
  return { fresh, stale, superseded };
}

export function computeFreshnessSummary(
  facts: NodeMemFact[],
  config?: FreshnessConfig,
): { maxAgeMs: number; staleItems: string[]; needsRefresh: boolean } {
  const maxAgeMs = config?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const { stale } = partitionByFreshness(facts, config);
  const staleItems = stale.map((f) => f.id);
  return { maxAgeMs, staleItems, needsRefresh: staleItems.length > 0 };
}
