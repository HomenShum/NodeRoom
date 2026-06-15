import type { OkfConcept } from "../../okf/types";

export function freshnessScoreForConcept(concept: OkfConcept, now = Date.now()): number {
  const timestamp = concept.frontmatter.timestamp;
  if (!timestamp) return 0.35;
  const ageDays = Math.max(0, now - Date.parse(timestamp)) / 86_400_000;
  if (!Number.isFinite(ageDays)) return 0.35;
  if (ageDays <= 30) return 1;
  if (ageDays <= 180) return 0.7;
  return 0.35;
}

