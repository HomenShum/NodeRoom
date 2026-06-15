import type { OkfConcept } from "../../okf/types";
import type { OkfConceptFilter } from "../types";

export function filterOkfConcepts(concepts: OkfConcept[], args: OkfConceptFilter): OkfConcept[] {
  return concepts.filter((concept) => {
    if (args.type && concept.frontmatter.type !== args.type) return false;
    if (args.pathPrefix && !concept.path.startsWith(args.pathPrefix)) return false;
    if (args.visibility && concept.frontmatter.visibility !== args.visibility) return false;
    if (args.status && concept.frontmatter.noderoom?.status !== args.status) return false;
    if (args.confidenceMin !== undefined && (concept.frontmatter.noderoom?.confidence ?? 0) < args.confidenceMin) return false;
    if (args.timestampAfter && concept.frontmatter.timestamp && Date.parse(concept.frontmatter.timestamp) < Date.parse(args.timestampAfter)) return false;
    if (args.tags?.length) {
      const tags = new Set(concept.frontmatter.tags ?? []);
      if (!args.tags.every((tag) => tags.has(tag))) return false;
    }
    return true;
  }).slice(0, args.limit ?? 50);
}

