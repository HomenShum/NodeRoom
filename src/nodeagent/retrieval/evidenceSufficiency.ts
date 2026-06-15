import type { ClaimSupportResult } from "./types";

export type MissingEvidenceCategory = "source_file" | "exact_row_or_page" | "period" | "definition" | "formula" | "human_review" | "confidence";

export interface EvidenceSufficiency {
  enoughToAnswer: boolean;
  enoughToCommit: boolean;
  enoughForClientReady: boolean;
  missing: MissingEvidenceCategory[];
}

export function assessEvidenceSufficiency(args: {
  support: ClaimSupportResult;
  hasLiteralLocator?: boolean;
  hasFormula?: boolean;
  reviewed?: boolean;
  clientReadyRequired?: boolean;
}): EvidenceSufficiency {
  const missing = new Set<MissingEvidenceCategory>(args.support.missing as MissingEvidenceCategory[]);
  if (!args.hasLiteralLocator) missing.add("exact_row_or_page");
  if (!args.hasFormula) missing.add("formula");
  if (!args.reviewed) missing.add("human_review");
  if (args.support.score < 0.65) missing.add("confidence");
  return {
    enoughToAnswer: args.support.support === "supports" || args.support.support === "partial",
    enoughToCommit: args.support.support !== "unsupported",
    enoughForClientReady: !args.clientReadyRequired ? false : missing.size === 0 && args.support.support === "supports",
    missing: [...missing],
  };
}

