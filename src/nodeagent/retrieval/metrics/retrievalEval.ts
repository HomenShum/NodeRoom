import type { EvidenceSufficiency } from "../evidenceSufficiency";

export interface RetrievalEvalScore {
  answerAccuracy: boolean;
  evidenceAccuracy: boolean;
  retrievalRecall: boolean;
  retrievalPrecision: boolean;
  sufficiency: EvidenceSufficiency;
}

export function retrievalEvalPassed(score: RetrievalEvalScore): boolean {
  return score.answerAccuracy && score.evidenceAccuracy && score.retrievalRecall && score.retrievalPrecision && score.sufficiency.enoughToAnswer;
}

