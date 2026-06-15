import type { OkfConcept, OkfVisibility } from "../okf/types";

export interface RetrievalHit {
  concept: OkfConcept;
  score: number;
  reasons: string[];
}

export interface OkfConceptFilter {
  type?: string;
  tags?: string[];
  pathPrefix?: string;
  status?: string;
  confidenceMin?: number;
  timestampAfter?: string;
  visibility?: OkfVisibility;
  limit?: number;
}

export interface EvidenceRef {
  evidenceId: string;
  conceptId?: string;
  citationId?: string;
  sourceArtifactId?: string;
}

export interface LiteralSourceResult {
  ok: boolean;
  conceptId?: string;
  title?: string;
  resource?: string;
  snippet?: string;
  locator?: {
    page?: number;
    row?: number;
    column?: string;
    bbox?: { x: number; y: number; width: number; height: number; unit?: "px" | "pt" | "normalized" };
  };
  error?: string;
}

export interface ClaimSupportResult {
  support: "supports" | "partial" | "contradicts" | "unsupported";
  score: number;
  checkedEvidence: LiteralSourceResult[];
  missing: string[];
}

export interface OkfRetrievalPort {
  listConcepts(args: OkfConceptFilter): Promise<OkfConcept[]>;
  readConcept(args: { conceptId: string }): Promise<OkfConcept | null>;
  fullTextSearch(args: { query: string; fields?: Array<"title" | "description" | "body" | "citations">; limit?: number } & OkfConceptFilter): Promise<RetrievalHit[]>;
  semanticSearch(args: { query: string; limit?: number } & OkfConceptFilter): Promise<RetrievalHit[]>;
  filter(args: OkfConceptFilter): Promise<OkfConcept[]>;
  glob(args: { pattern: string; limit?: number }): Promise<OkfConcept[]>;
  regex(args: { pattern: string; pathPrefix?: string; caseSensitive?: boolean; limit?: number }): Promise<RetrievalHit[]>;
  backlinks(args: { conceptId: string; depth?: number; limit?: number }): Promise<OkfConcept[]>;
  expandNeighbors(args: { conceptId: string; linkDepth: number; includeCitations?: boolean; includeBacklinks?: boolean; limit?: number }): Promise<OkfConcept[]>;
  resolveCitation(args: { evidenceId: string }): Promise<LiteralSourceResult>;
  openLiteral(args: {
    sourceArtifactId: string;
    page?: number;
    row?: number;
    column?: string;
    bbox?: { x: number; y: number; width: number; height: number; unit?: "px" | "pt" | "normalized" };
  }): Promise<LiteralSourceResult>;
  compareClaim(args: { claim: string; evidenceRefs: EvidenceRef[] }): Promise<ClaimSupportResult>;
}

