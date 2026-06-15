import { readOkfBundle } from "../../okf/bundleReader";
import type { OkfBundleFile, OkfConcept } from "../../okf/types";
import type { ClaimSupportResult, EvidenceRef, LiteralSourceResult, OkfConceptFilter, OkfRetrievalPort, RetrievalHit } from "../types";
import { tokenizeForRetrieval } from "../ranking/hybridRanker";
import { filterOkfConcepts } from "./okfFilters";
import { okfFullTextSearch } from "./okfFullTextSearch";
import { okfSemanticSearch } from "./okfSemanticSearch";
import { okfBacklinks, okfNeighbors } from "./okfGraph";
import { okfGlob } from "./okfPathGlob";
import { okfRegexSearch } from "./okfRegex";

export class OkfConceptStore implements OkfRetrievalPort {
  private readonly byId: Map<string, OkfConcept>;

  constructor(private readonly concepts: OkfConcept[]) {
    this.byId = new Map(concepts.map((concept) => [concept.id, concept]));
  }

  static fromFiles(files: OkfBundleFile[]): OkfConceptStore {
    return new OkfConceptStore(readOkfBundle(files));
  }

  async listConcepts(args: OkfConceptFilter): Promise<OkfConcept[]> {
    return filterOkfConcepts(this.concepts, args);
  }

  async readConcept(args: { conceptId: string }): Promise<OkfConcept | null> {
    return this.byId.get(args.conceptId) ?? null;
  }

  async fullTextSearch(args: { query: string; fields?: Array<"title" | "description" | "body" | "citations">; limit?: number } & OkfConceptFilter): Promise<RetrievalHit[]> {
    return okfFullTextSearch(this.concepts, args);
  }

  async semanticSearch(args: { query: string; limit?: number } & OkfConceptFilter): Promise<RetrievalHit[]> {
    return okfSemanticSearch(this.concepts, args);
  }

  async filter(args: OkfConceptFilter): Promise<OkfConcept[]> {
    return filterOkfConcepts(this.concepts, args);
  }

  async glob(args: { pattern: string; limit?: number }): Promise<OkfConcept[]> {
    return okfGlob(this.concepts, args.pattern, args.limit);
  }

  async regex(args: { pattern: string; pathPrefix?: string; caseSensitive?: boolean; limit?: number }): Promise<RetrievalHit[]> {
    return okfRegexSearch(this.concepts, args);
  }

  async backlinks(args: { conceptId: string; depth?: number; limit?: number }): Promise<OkfConcept[]> {
    return okfBacklinks(this.concepts, args.conceptId, args.depth, args.limit);
  }

  async expandNeighbors(args: { conceptId: string; linkDepth: number; includeCitations?: boolean; includeBacklinks?: boolean; limit?: number }): Promise<OkfConcept[]> {
    const graphNeighbors = okfNeighbors(this.concepts, args.conceptId, args.linkDepth, args.includeBacklinks ?? true, args.limit);
    if (!args.includeCitations) return graphNeighbors;
    const citationConcepts = graphNeighbors.flatMap((concept) => concept.citations.map((citation) => citation.conceptId).filter((id): id is string => !!id));
    return [...graphNeighbors, ...citationConcepts.map((id) => this.byId.get(id)).filter((concept): concept is OkfConcept => !!concept)].slice(0, args.limit ?? 50);
  }

  async resolveCitation(args: { evidenceId: string }): Promise<LiteralSourceResult> {
    const [conceptId, citationId] = args.evidenceId.includes("#") ? args.evidenceId.split("#", 2) : [args.evidenceId, undefined];
    const concept = this.byId.get(conceptId);
    if (!concept) return { ok: false, error: "evidence_not_found" };
    const citation = citationId ? concept.citations.find((item) => item.id === citationId) : concept.citations[0];
    if (citation?.conceptId && this.byId.has(citation.conceptId)) return this.openLiteral({ sourceArtifactId: citation.conceptId });
    return {
      ok: true,
      conceptId: concept.id,
      title: citation?.label ?? concept.frontmatter.title ?? concept.id,
      resource: citation?.target ?? concept.frontmatter.resource,
      snippet: citation ? `${citation.label}: ${citation.target}` : concept.body.slice(0, 280),
    };
  }

  async openLiteral(args: { sourceArtifactId: string; page?: number; row?: number; column?: string; bbox?: { x: number; y: number; width: number; height: number; unit?: "px" | "pt" | "normalized" } }): Promise<LiteralSourceResult> {
    const concept = this.byId.get(args.sourceArtifactId);
    if (!concept) return { ok: false, error: "source_not_found" };
    return {
      ok: true,
      conceptId: concept.id,
      title: concept.frontmatter.title ?? concept.id,
      resource: concept.frontmatter.resource,
      snippet: concept.body.replace(/\s+/g, " ").slice(0, 360),
      locator: { page: args.page, row: args.row, column: args.column, bbox: args.bbox },
    };
  }

  async compareClaim(args: { claim: string; evidenceRefs: EvidenceRef[] }): Promise<ClaimSupportResult> {
    const checkedEvidence = (await Promise.all(args.evidenceRefs.map((ref) => this.resolveEvidenceRefWithContext(ref)))).flat();
    const claimTokens = new Set(tokenizeForRetrieval(args.claim));
    const allEvidenceTokens = new Set(tokenizeForRetrieval(checkedEvidence.map((item) => `${item.title ?? ""} ${item.snippet ?? ""}`).join(" ")));
    const literalEvidenceTokens = new Set(tokenizeForRetrieval(checkedEvidence.filter((item) => item.resource).map((item) => `${item.title ?? ""} ${item.snippet ?? ""}`).join(" ")));
    const allOverlap = [...claimTokens].filter((token) => allEvidenceTokens.has(token)).length;
    const literalOverlap = [...claimTokens].filter((token) => literalEvidenceTokens.has(token)).length;
    const contextScore = claimTokens.size ? allOverlap / claimTokens.size : 0;
    const literalScore = claimTokens.size ? literalOverlap / claimTokens.size : 0;
    const score = Math.max(contextScore, literalScore);
    const support = literalScore >= 0.65 ? "supports" : score >= 0.3 ? "partial" : "unsupported";
    return {
      support,
      score: Number(score.toFixed(3)),
      checkedEvidence,
      missing: checkedEvidence.some((item) => !item.ok) ? ["source_file"] : score < 0.65 ? ["confidence"] : [],
    };
  }

  private async resolveEvidenceRefWithContext(ref: EvidenceRef): Promise<LiteralSourceResult[]> {
    const resolved = await this.resolveEvidenceRef(ref);
    const conceptId = ref.conceptId ?? (ref.evidenceId.includes("#") ? ref.evidenceId.split("#", 2)[0] : ref.evidenceId);
    const concept = this.byId.get(conceptId);
    if (!concept || concept.id === resolved.conceptId) return [resolved];
    return [
      {
        ok: true,
        conceptId: concept.id,
        title: concept.frontmatter.title ?? concept.id,
        snippet: concept.body.replace(/\s+/g, " ").slice(0, 360),
      },
      resolved,
    ];
  }

  private async resolveEvidenceRef(ref: EvidenceRef): Promise<LiteralSourceResult> {
    if (ref.sourceArtifactId) return this.openLiteral({ sourceArtifactId: ref.sourceArtifactId });
    if (ref.conceptId && ref.citationId) return this.resolveCitation({ evidenceId: `${ref.conceptId}#${ref.citationId}` });
    return this.resolveCitation({ evidenceId: ref.evidenceId });
  }
}
