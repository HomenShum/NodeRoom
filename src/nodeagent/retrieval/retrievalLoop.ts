import { assessEvidenceSufficiency } from "./evidenceSufficiency";
import { composeEvidencePacket, type EvidencePacket } from "./evidencePacket";
import type { OkfRetrievalPort } from "./types";

export async function retrieveUntilSufficient(args: {
  retrieval: OkfRetrievalPort;
  claim: string;
  query: string;
  clientReadyRequired?: boolean;
}): Promise<EvidencePacket> {
  const hits = await args.retrieval.semanticSearch({ query: args.query, limit: 5 });
  const top = hits[0]?.concept;
  const evidenceId = top?.citations[0] ? `${top.id}#${top.citations[0].id}` : top?.id ?? "";
  const literal = evidenceId ? [await args.retrieval.resolveCitation({ evidenceId })] : [];
  const support = await args.retrieval.compareClaim({
    claim: args.claim,
    evidenceRefs: evidenceId ? [{ evidenceId }] : [],
  });
  const sufficiency = assessEvidenceSufficiency({
    support,
    hasLiteralLocator: literal.some((item) => item.ok),
    hasFormula: /formula|calculation|computed|runway/i.test(top?.body ?? ""),
    reviewed: top?.frontmatter.noderoom?.status === "complete",
    clientReadyRequired: args.clientReadyRequired,
  });
  return composeEvidencePacket({ claim: args.claim, hits, literalSources: literal, sufficiency });
}

