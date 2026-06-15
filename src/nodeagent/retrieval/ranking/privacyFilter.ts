import type { OkfConcept, OkfVisibility } from "../../okf/types";

export function filterByVisibility(concepts: OkfConcept[], visibility: OkfVisibility): OkfConcept[] {
  return concepts.filter((concept) => (concept.frontmatter.visibility ?? "public") === visibility);
}

