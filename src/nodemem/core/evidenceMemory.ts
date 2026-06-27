/**
 * Evidence memory — source-backed vs graph-only fact policy.
 *
 * Hard guarantee: no graph-only fact can become client-ready evidence.
 * Graph facts are context. EvidenceFacts are truth.
 */

import type { NodeMemFact } from "./types";

export type EvidenceConfidence = "high" | "medium" | "low";

/** Check if a fact is source-backed (has evidence references). */
export function isSourceBacked(fact: NodeMemFact): boolean {
  return fact.status === "source_backed" && fact.evidenceFactIds.length > 0;
}

/** Check if a fact is graph-only (no evidence backing). */
export function isGraphOnly(fact: NodeMemFact): boolean {
  return fact.status === "graph_inferred" || fact.status === "needs_review";
}

/** Check if a fact can be used as final client-ready evidence. */
export function canBeFinalEvidence(fact: NodeMemFact): boolean {
  return isSourceBacked(fact) && fact.confidence >= 0.7;
}

/** Classify the evidence confidence level for a fact. */
export function classifyConfidence(fact: NodeMemFact): EvidenceConfidence {
  if (isSourceBacked(fact) && fact.confidence >= 0.8) return "high";
  if (isSourceBacked(fact) && fact.confidence >= 0.5) return "medium";
  if (isSourceBacked(fact)) return "low";
  return "low";
}

/** Filter facts to only those that can be used as final evidence. */
export function filterFinalEvidence(facts: NodeMemFact[]): NodeMemFact[] {
  return facts.filter(canBeFinalEvidence);
}

/** Partition facts into evidence-backed + graph-only buckets. */
export function partitionByEvidence(
  facts: NodeMemFact[],
): { evidence: NodeMemFact[]; graphOnly: NodeMemFact[]; rejected: NodeMemFact[] } {
  const evidence: NodeMemFact[] = [];
  const graphOnly: NodeMemFact[] = [];
  const rejected: NodeMemFact[] = [];
  for (const f of facts) {
    if (f.status === "rejected" || f.status === "superseded") {
      rejected.push(f);
    } else if (isSourceBacked(f)) {
      evidence.push(f);
    } else {
      graphOnly.push(f);
    }
  }
  return { evidence, graphOnly, rejected };
}

/**
 * Promote a fact from needs_review to source_backed when evidence is added.
 */
export function promoteToSourceBacked(
  fact: NodeMemFact,
  evidenceFactIds: string[],
  now = Date.now(),
): NodeMemFact {
  return {
    ...fact,
    status: "source_backed",
    evidenceFactIds: [...fact.evidenceFactIds, ...evidenceFactIds],
    confidence: Math.min(1, fact.confidence + 0.2),
    updatedAt: now,
  };
}

/**
 * Demote a fact to needs_review when evidence is removed or invalidated.
 */
export function demoteToNeedsReview(
  fact: NodeMemFact,
  now = Date.now(),
): NodeMemFact {
  return {
    ...fact,
    status: "needs_review",
    confidence: Math.max(0, fact.confidence - 0.2),
    updatedAt: now,
  };
}
