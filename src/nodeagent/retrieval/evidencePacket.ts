import type { EvidenceSufficiency } from "./evidenceSufficiency";
import type { LiteralSourceResult, RetrievalHit } from "./types";

export interface EvidencePacket {
  claim: string;
  hits: RetrievalHit[];
  literalSources: LiteralSourceResult[];
  sufficiency: EvidenceSufficiency;
  caveat?: string;
}

export function composeEvidencePacket(args: EvidencePacket): EvidencePacket {
  return {
    ...args,
    caveat: args.sufficiency.enoughForClientReady
      ? undefined
      : `Needs review: missing ${args.sufficiency.missing.join(", ") || "client-ready support"}.`,
  };
}

