import type { OkfConcept } from "../../okf/types";

export function authorityScoreForConcept(concept: OkfConcept): number {
  const sourceKind = concept.frontmatter.noderoom?.sourceKind;
  if (sourceKind === "upload") return 1;
  if (sourceKind === "source") return 0.85;
  if (sourceKind === "computed") return 0.65;
  if (sourceKind === "manual") return 0.35;
  return concept.frontmatter.type === "Source" ? 0.8 : 0.5;
}

