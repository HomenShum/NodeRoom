import { assessEvidenceSufficiency } from "./evidenceSufficiency";
import { composeEvidencePacket, type EvidencePacket } from "./evidencePacket";
import { buildCandidateSlate, buildEvidenceMemo, candidateFromConcept, candidateFromHit } from "./candidateSlate";
import { planOkfRetrieval } from "./retrievalPlanner";
import type { EvidenceRef, OkfRetrievalPort, RetrievalHit } from "./types";

function planTags(query: string): string[] | undefined {
  const filterStep = planOkfRetrieval(query).find((step) => step.tool === "okf_filter");
  return filterStep?.tool === "okf_filter" ? filterStep.tags : undefined;
}

function hitForCandidate(candidateId: string, hits: RetrievalHit[]): RetrievalHit | undefined {
  return hits.find((hit) => `candidate:${hit.concept.id}` === candidateId);
}

function evidenceRefsForHit(hit: RetrievalHit): EvidenceRef[] {
  if (hit.concept.citations.length) {
    return hit.concept.citations.slice(0, 2).map((citation) => ({
      evidenceId: `${hit.concept.id}#${citation.id}`,
      conceptId: hit.concept.id,
      citationId: citation.id,
    }));
  }
  return [{ evidenceId: hit.concept.id, conceptId: hit.concept.id }];
}

export async function retrieveUntilSufficient(args: {
  retrieval: OkfRetrievalPort;
  claim: string;
  query: string;
  clientReadyRequired?: boolean;
}): Promise<EvidencePacket> {
  const [semanticHits, fullTextHits, filteredConcepts] = await Promise.all([
    args.retrieval.semanticSearch({ query: args.query, limit: 8 }),
    args.retrieval.fullTextSearch({ query: args.query, limit: 8 }),
    args.retrieval.filter({ tags: planTags(args.query), limit: 8 }),
  ]);
  const candidateSlate = buildCandidateSlate({
    query: args.query,
    candidates: [
      ...semanticHits.map((hit) => candidateFromHit("okf_semantic", hit)),
      ...fullTextHits.map((hit) => candidateFromHit("okf_full_text", hit)),
      ...filteredConcepts.map((concept) => candidateFromConcept({ concept, retrievalSource: "okf_filter", reasons: ["planned_filter"] })),
    ],
    limit: 6,
  });
  const allHits = [...semanticHits, ...fullTextHits];
  const hits = candidateSlate.candidates
    .map((candidate) => hitForCandidate(candidate.id, allHits))
    .filter((hit): hit is RetrievalHit => !!hit);
  const inspectedHits = hits.slice(0, 4);
  const sourceRefs = inspectedHits.flatMap(evidenceRefsForHit).slice(0, 8);
  const literal = await Promise.all(sourceRefs.map((ref) => args.retrieval.resolveCitation({ evidenceId: ref.evidenceId })));
  const support = await args.retrieval.compareClaim({
    claim: args.claim,
    evidenceRefs: sourceRefs,
  });
  const inspectedConcepts = inspectedHits.map((hit) => hit.concept);
  const sufficiency = assessEvidenceSufficiency({
    support,
    hasLiteralLocator: literal.some((item) => item.ok),
    hasFormula: inspectedConcepts.some((concept) => /formula|calculation|computed|runway/i.test(concept.body)),
    reviewed: inspectedConcepts.some((concept) => concept.frontmatter.noderoom?.status === "complete"),
    clientReadyRequired: args.clientReadyRequired,
  });
  const evidenceMemos = [buildEvidenceMemo({
    question: args.query,
    claim: args.claim,
    candidateIds: candidateSlate.candidates.map((candidate) => candidate.id),
    sourceRefs,
    support,
    sufficiency,
  })];
  return composeEvidencePacket({ claim: args.claim, hits, candidateSlate, evidenceMemos, literalSources: literal, sufficiency });
}
