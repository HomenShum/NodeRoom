import type { OkfConcept } from "../../okf/types";
import type { RetrievalHit } from "../types";

const STOP = new Set(["the", "and", "or", "a", "an", "of", "to", "for", "from", "in", "on", "with", "is", "are", "what", "which", "who", "how"]);

export function tokenizeForRetrieval(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_$%.\- ]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP.has(token));
}

function lexicalScore(queryTokens: string[], text: string): number {
  const haystack = tokenizeForRetrieval(text);
  if (!queryTokens.length || !haystack.length) return 0;
  const hay = new Set(haystack);
  const hits = queryTokens.filter((token) => hay.has(token)).length;
  return hits / queryTokens.length;
}

function metadataScore(queryTokens: string[], concept: OkfConcept): number {
  const tags = concept.frontmatter.tags ?? [];
  const metadata = [concept.frontmatter.type, concept.frontmatter.title, concept.frontmatter.description, ...tags].join(" ");
  return lexicalScore(queryTokens, metadata);
}

function freshnessScore(concept: OkfConcept): number {
  const ts = concept.frontmatter.timestamp;
  if (!ts) return 0.35;
  const ageMs = Math.max(0, Date.now() - Date.parse(ts));
  const days = ageMs / 86_400_000;
  if (!Number.isFinite(days)) return 0.35;
  if (days <= 30) return 1;
  if (days <= 180) return 0.7;
  return 0.35;
}

function authorityScore(concept: OkfConcept): number {
  const kind = concept.frontmatter.noderoom?.sourceKind;
  if (kind === "upload") return 1;
  if (kind === "source") return 0.85;
  if (kind === "computed") return 0.65;
  if (kind === "manual") return 0.35;
  return concept.frontmatter.type === "Source" ? 0.8 : 0.5;
}

function specificityScore(concept: OkfConcept): number {
  switch (concept.frontmatter.type) {
    case "Spreadsheet Cell":
    case "Metric":
    case "Formula":
      return 0.9;
    case "Source":
      return 0.8;
    case "Chart":
    case "Coach Cue":
    case "Review Round":
    case "Agent Trace":
      return 0.7;
    case "Company":
    case "Person":
    case "Room":
      return 0.35;
    default:
      return 0.5;
  }
}

function evidenceBridgeScore(queryTokens: string[], concept: OkfConcept): number {
  const wantsEvidence = queryTokens.some((token) => ["source", "support", "supports", "evidence", "citation", "citations", "proof"].includes(token));
  if (concept.citations.length > 0) return wantsEvidence ? 1 : 0.45;
  if (concept.links.length > 0) return wantsEvidence ? 0.1 : 0.25;
  return 0;
}

export function rankOkfConcepts(concepts: OkfConcept[], query: string): RetrievalHit[] {
  const queryTokens = tokenizeForRetrieval(query);
  return concepts
    .map((concept) => {
      const semantic = lexicalScore(queryTokens, `${concept.frontmatter.title ?? ""} ${concept.frontmatter.description ?? ""} ${concept.body}`);
      const fullText = lexicalScore(queryTokens, concept.body);
      const metadata = metadataScore(queryTokens, concept);
      const freshness = freshnessScore(concept);
      const authority = authorityScore(concept);
      const specificity = specificityScore(concept);
      const evidenceBridge = evidenceBridgeScore(queryTokens, concept);
      const privacyPenalty = concept.frontmatter.visibility === "private" ? 0.2 : 0;
      const stalePenalty = freshness < 0.5 ? 0.05 : 0;
      const score = (0.35 * semantic) + (0.25 * fullText) + (0.15 * metadata) + (0.1 * freshness) + (0.05 * authority) + (0.1 * specificity) + (0.08 * evidenceBridge) - privacyPenalty - stalePenalty;
      const reasons = [
        semantic > 0 ? `semantic=${semantic.toFixed(2)}` : "",
        fullText > 0 ? `text=${fullText.toFixed(2)}` : "",
        metadata > 0 ? `metadata=${metadata.toFixed(2)}` : "",
        `authority=${authority.toFixed(2)}`,
        `specificity=${specificity.toFixed(2)}`,
        evidenceBridge > 0 ? `evidence=${evidenceBridge.toFixed(2)}` : "",
      ].filter(Boolean);
      return { concept, score: Number(score.toFixed(4)), reasons };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || a.concept.path.localeCompare(b.concept.path));
}
