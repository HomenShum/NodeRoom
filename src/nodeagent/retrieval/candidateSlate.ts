import type { OkfConcept } from "../okf/types";
import type { EvidenceSufficiency } from "./evidenceSufficiency";
import type {
  CandidateSlate,
  ClaimSupportResult,
  EvidenceMemo,
  EvidenceRef,
  RetrievalCandidate,
  RetrievalHit,
  RetrievalSource,
} from "./types";

const TYPE_DIVERSITY_ORDER = [
  "Source",
  "Spreadsheet Cell",
  "Metric",
  "Formula",
  "Company",
  "Chart",
  "Coach Cue",
  "Agent Trace",
  "Review Round",
];

function cleanSnippet(text: string, max = 320): string {
  return text.replace(/\s+/g, " ").trim().slice(0, max);
}

function candidateId(concept: OkfConcept): string {
  return `candidate:${concept.id}`;
}

function conceptElementId(concept: OkfConcept): string | undefined {
  const node = concept.frontmatter.noderoom;
  const value = node?.elementId;
  return typeof value === "string" ? value : undefined;
}

function conceptArtifactId(concept: OkfConcept): string | undefined {
  const node = concept.frontmatter.noderoom;
  const value = node?.artifactId;
  return typeof value === "string" ? value : undefined;
}

export function candidateFromConcept(args: {
  concept: OkfConcept;
  retrievalSource: RetrievalSource;
  score?: number;
  reasons?: string[];
}): RetrievalCandidate {
  const { concept } = args;
  const firstCitation = concept.citations[0];
  const sourceRef: EvidenceRef | undefined = firstCitation
    ? { evidenceId: `${concept.id}#${firstCitation.id}`, conceptId: concept.id, citationId: firstCitation.id }
    : { evidenceId: concept.id, conceptId: concept.id };
  return {
    id: candidateId(concept),
    retrievalSource: args.retrievalSource,
    conceptId: concept.id,
    path: concept.path,
    artifactId: conceptArtifactId(concept),
    elementId: conceptElementId(concept),
    sourceRef,
    snippet: cleanSnippet(`${concept.frontmatter.title ?? concept.id}. ${concept.frontmatter.description ?? ""} ${concept.body}`),
    matchedBecause: [`source:${args.retrievalSource}`, ...(args.reasons ?? [])],
    score: args.score,
    metadata: {
      type: concept.frontmatter.type,
      tags: concept.frontmatter.tags,
      status: concept.frontmatter.noderoom?.status,
      confidence: concept.frontmatter.noderoom?.confidence,
      timestamp: concept.frontmatter.timestamp,
      visibility: concept.frontmatter.visibility,
      title: concept.frontmatter.title,
    },
  };
}

export function candidateFromHit(retrievalSource: RetrievalSource, hit: RetrievalHit): RetrievalCandidate {
  return candidateFromConcept({ concept: hit.concept, retrievalSource, score: hit.score, reasons: hit.reasons });
}

function mergeDuplicateCandidates(candidates: RetrievalCandidate[]): { candidates: RetrievalCandidate[]; discardedDuplicateCount: number } {
  const byId = new Map<string, RetrievalCandidate>();
  let discardedDuplicateCount = 0;
  for (const candidate of candidates) {
    const existing = byId.get(candidate.id);
    if (!existing) {
      byId.set(candidate.id, { ...candidate, matchedBecause: [...new Set(candidate.matchedBecause)] });
      continue;
    }
    discardedDuplicateCount += 1;
    byId.set(candidate.id, {
      ...existing,
      retrievalSource: existing.retrievalSource,
      score: Math.max(existing.score ?? 0, candidate.score ?? 0),
      matchedBecause: [...new Set([...existing.matchedBecause, ...candidate.matchedBecause])],
    });
  }
  return { candidates: [...byId.values()], discardedDuplicateCount };
}

function candidateSort(a: RetrievalCandidate, b: RetrievalCandidate): number {
  return (b.score ?? 0) - (a.score ?? 0) || (a.path ?? a.id).localeCompare(b.path ?? b.id);
}

export function buildCandidateSlate(args: {
  query: string;
  candidates: RetrievalCandidate[];
  limit?: number;
}): CandidateSlate {
  const { candidates: deduped, discardedDuplicateCount } = mergeDuplicateCandidates(args.candidates);
  const limit = Math.max(1, Math.min(args.limit ?? 6, 12));
  const sorted = [...deduped].sort(candidateSort);
  const selected: RetrievalCandidate[] = [];
  const selectedIds = new Set<string>();

  for (const type of TYPE_DIVERSITY_ORDER) {
    const candidate = sorted.find((item) => item.metadata.type === type && !selectedIds.has(item.id));
    if (!candidate) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
    if (selected.length >= limit) break;
  }

  for (const candidate of sorted) {
    if (selected.length >= limit) break;
    if (selectedIds.has(candidate.id)) continue;
    selected.push(candidate);
    selectedIds.add(candidate.id);
  }

  return {
    query: args.query,
    selectionPolicy: "diverse_candidate_slate_v1",
    candidates: selected,
    discardedDuplicateCount,
  };
}

function supportLabel(support: ClaimSupportResult["support"]): EvidenceMemo["claimsSupported"][number]["support"] {
  if (support === "supports") return "strong";
  if (support === "partial") return "partial";
  if (support === "contradicts") return "contradicts";
  return "not_found";
}

function recommendedAction(args: { support: ClaimSupportResult; sufficiency: EvidenceSufficiency }): EvidenceMemo["recommendedAction"] {
  if (args.support.support === "unsupported") return "search_more";
  if (args.sufficiency.enoughForClientReady) return "answer";
  if (args.sufficiency.enoughToCommit) return "write_needs_review";
  if (args.sufficiency.enoughToAnswer) return "answer";
  return "ask_clarifying_question";
}

export function buildEvidenceMemo(args: {
  question: string;
  claim: string;
  candidateIds: string[];
  sourceRefs: EvidenceRef[];
  support: ClaimSupportResult;
  sufficiency: EvidenceSufficiency;
}): EvidenceMemo {
  return {
    question: args.question,
    candidateIds: args.candidateIds,
    claimsSupported: [{
      claim: args.claim,
      support: supportLabel(args.support.support),
      sourceRefs: args.sourceRefs,
      explanation: `Compared ${args.sourceRefs.length} candidate evidence reference(s); support=${args.support.support}, score=${args.support.score}.`,
    }],
    missingEvidence: [...new Set([...args.support.missing, ...args.sufficiency.missing])],
    recommendedAction: recommendedAction({ support: args.support, sufficiency: args.sufficiency }),
  };
}
