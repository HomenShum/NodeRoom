import type { OkfConcept } from "../../okf/types";
import type { OkfConceptFilter } from "../types";

/** Skill RAG: a trust tier name → the confidence floor it implies.
 *  Mirrors the trust→confidence mapping used when skills are ingested
 *  (see docs/architecture/DYNAMIC_SKILL_RETRIEVAL.md). */
const SKILL_TRUST_CONFIDENCE_FLOOR: Record<NonNullable<OkfConceptFilter["skill_trust_min"]>, number> = {
  untrusted: 0.3,
  community: 0.6,
  verified: 0.95,
};

export function filterOkfConcepts(concepts: OkfConcept[], args: OkfConceptFilter): OkfConcept[] {
  const trustFloor = args.skill_trust_min ? SKILL_TRUST_CONFIDENCE_FLOOR[args.skill_trust_min] : undefined;
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
    // Skill RAG: match if ANY requested category appears in tags or noderoom.skill_categories.
    if (args.skill_categories?.length) {
      const haystack = new Set<string>([
        ...(concept.frontmatter.tags ?? []),
        ...(concept.frontmatter.noderoom?.skill_categories ?? []),
      ]);
      if (!args.skill_categories.some((cat) => haystack.has(cat))) return false;
    }
    // Skill RAG: enforce the trust floor via the concept's confidence.
    if (trustFloor !== undefined && (concept.frontmatter.noderoom?.confidence ?? 0) < trustFloor) return false;
    return true;
  }).slice(0, args.limit ?? 50);
}

