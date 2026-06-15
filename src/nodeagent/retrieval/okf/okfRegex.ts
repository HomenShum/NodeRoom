import type { OkfConcept } from "../../okf/types";
import type { RetrievalHit } from "../types";

export function okfRegexSearch(concepts: OkfConcept[], args: { pattern: string; pathPrefix?: string; caseSensitive?: boolean; limit?: number }): RetrievalHit[] {
  const re = new RegExp(args.pattern, args.caseSensitive ? "g" : "gi");
  return concepts
    .filter((concept) => !args.pathPrefix || concept.path.startsWith(args.pathPrefix))
    .map((concept) => {
      const text = `${concept.path}\n${JSON.stringify(concept.frontmatter)}\n${concept.body}`;
      const matches = [...text.matchAll(re)].length;
      return matches ? { concept, score: Math.min(1, matches / 5), reasons: [`regex_matches=${matches}`] } : null;
    })
    .filter((hit): hit is RetrievalHit => !!hit)
    .sort((a, b) => b.score - a.score)
    .slice(0, args.limit ?? 50);
}
