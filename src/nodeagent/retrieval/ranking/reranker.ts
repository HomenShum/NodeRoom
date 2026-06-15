import type { RetrievalHit } from "../types";

export function stableRerank(hits: RetrievalHit[]): RetrievalHit[] {
  return [...hits].sort((a, b) => b.score - a.score || a.concept.path.localeCompare(b.concept.path));
}

