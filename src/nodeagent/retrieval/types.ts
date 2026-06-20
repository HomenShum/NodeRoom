import type { OkfConcept, OkfVisibility } from "../okf/types";

export interface RetrievalHit {
  concept: OkfConcept;
  score: number;
  reasons: string[];
}

export type RetrievalSource =
  | "okf_semantic"
  | "okf_full_text"
  | "okf_filter"
  | "okf_backlink"
  | "sheet_search"
  | "trace_search"
  | "literal_source"
  | "linkup";

export interface RetrievalCandidate {
  id: string;
  retrievalSource: RetrievalSource;
  conceptId?: string;
  path?: string;
  artifactId?: string;
  elementId?: string;
  sourceRef?: EvidenceRef;
  snippet: string;
  matchedBecause: string[];
  score?: number;
  metadata: {
    type?: string;
    tags?: string[];
    status?: string;
    confidence?: number;
    timestamp?: string;
    visibility?: OkfVisibility;
    title?: string;
  };
}

export interface CandidateSlate {
  query: string;
  selectionPolicy: "diverse_candidate_slate_v1";
  candidates: RetrievalCandidate[];
  discardedDuplicateCount: number;
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
  /** Skill RAG: narrow "Agent Skill" concepts by category (matched against tags). */
  skill_categories?: string[];
  /** Skill RAG: minimum trust tier. Implemented as a confidence floor (community .6 / verified .95). */
  skill_trust_min?: "untrusted" | "community" | "verified";
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

export interface EvidenceMemo {
  question: string;
  candidateIds: string[];
  claimsSupported: Array<{
    claim: string;
    support: "strong" | "partial" | "weak" | "contradicts" | "not_found";
    sourceRefs: EvidenceRef[];
    explanation: string;
  }>;
  missingEvidence: string[];
  recommendedAction: "answer" | "write_needs_review" | "ask_clarifying_question" | "search_more";
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
