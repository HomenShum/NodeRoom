import { z } from "zod";
import type { AgentTool, RoomTools } from "../../core/types";

async function okfUnavailable() {
  return { ok: false, error: "okf_retrieval_unavailable" };
}

function okf(rt: RoomTools) {
  return rt.okf;
}

const conceptFilterSchema = {
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  pathPrefix: z.string().optional(),
  status: z.string().optional(),
  confidenceMin: z.number().min(0).max(1).optional(),
  timestampAfter: z.string().optional(),
  visibility: z.enum(["public", "private", "redacted"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
};

export const OKF_RETRIEVAL_TOOLS: AgentTool[] = [
  {
    name: "okf_list_concepts",
    description: "List OKF concepts in the current room bundle by type, tags, path prefix, status, confidence, timestamp, or visibility. Use this to discover what portable room knowledge exists before deep search.",
    schema: z.object(conceptFilterSchema),
    execute: (a, rt) => okf(rt)?.listConcepts(a) ?? okfUnavailable(),
  },
  {
    name: "okf_read_concept",
    description: "Open one OKF concept by conceptId/path (without .md). Never cite an OKF concept unless you have read it or resolved its source.",
    schema: z.object({ conceptId: z.string() }),
    execute: (a: { conceptId: string }, rt) => okf(rt)?.readConcept(a) ?? okfUnavailable(),
  },
  {
    name: "okf_full_text_search",
    description: "Exact text/BM25-style OKF search over titles, descriptions, bodies, and citations. Use for company names, metrics, row IDs, deal terms, and exact phrases.",
    schema: z.object({ query: z.string(), fields: z.array(z.enum(["title", "description", "body", "citations"])).optional(), ...conceptFilterSchema }),
    execute: (a, rt) => okf(rt)?.fullTextSearch(a) ?? okfUnavailable(),
  },
  {
    name: "okf_semantic_search",
    description: "Meaning-oriented OKF search. Use for questions like 'which source supports this assumption' or 'which coach cue mentions burn risk'. Follow with okf_read_concept/source_resolve_citation before strong claims.",
    schema: z.object({ query: z.string(), ...conceptFilterSchema }),
    execute: (a, rt) => okf(rt)?.semanticSearch(a) ?? okfUnavailable(),
  },
  {
    name: "okf_search_skills",
    description: "Semantically search the Agent Skill catalog (OKF concepts of type 'Agent Skill') for a skill that already encodes a procedure (deck, spreadsheet, scrape, doc, format conversion). Returns the top-k matching skills by their description. Read trust + source before loading; prefer trust:local / trust:verified. Use skill_search/load_skill for the higher-level discover→load flow.",
    schema: z.object({
      query: z.string(),
      skill_categories: z.array(z.string()).optional(),
      skill_trust_min: z.enum(["untrusted", "community", "verified"]).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    execute: (a: { query: string; skill_categories?: string[]; skill_trust_min?: "untrusted" | "community" | "verified"; limit?: number }, rt) =>
      okf(rt)?.semanticSearch({ ...a, type: "Agent Skill" }) ?? okfUnavailable(),
  },
  {
    name: "okf_filter",
    description: "Structured OKF narrowing by type, tags, status, confidence, timestamp, and visibility. Useful for needs_review claims and high-confidence recent sources.",
    schema: z.object(conceptFilterSchema),
    execute: (a, rt) => okf(rt)?.filter(a) ?? okfUnavailable(),
  },
  {
    name: "okf_glob",
    description: "Path/glob lookup over OKF concept paths, e.g. companies/*.md, sources/**/*.md, cells/*.md.",
    schema: z.object({ pattern: z.string(), limit: z.number().int().min(1).max(50).optional() }),
    execute: (a: { pattern: string; limit?: number }, rt) => okf(rt)?.glob(a) ?? okfUnavailable(),
  },
  {
    name: "okf_regex",
    description: "Regex lookup over OKF paths/frontmatter/body for exact identifiers, formula names, row IDs, tickers, and aliases.",
    schema: z.object({ pattern: z.string(), pathPrefix: z.string().optional(), caseSensitive: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() }),
    execute: (a: { pattern: string; pathPrefix?: string; caseSensitive?: boolean; limit?: number }, rt) => okf(rt)?.regex(a) ?? okfUnavailable(),
  },
  {
    name: "okf_backlinks",
    description: "Find OKF concepts that link to a concept. Use for 'what depends on this source/cell/metric/chart'.",
    schema: z.object({ conceptId: z.string(), depth: z.number().int().min(1).max(4).optional(), limit: z.number().int().min(1).max(50).optional() }),
    execute: (a: { conceptId: string; depth?: number; limit?: number }, rt) => okf(rt)?.backlinks(a) ?? okfUnavailable(),
  },
  {
    name: "okf_expand_neighbors",
    description: "Expand OKF graph neighbors around a concept, optionally including backlinks and citation targets, to build a compact world model.",
    schema: z.object({ conceptId: z.string(), linkDepth: z.number().int().min(1).max(4), includeCitations: z.boolean().optional(), includeBacklinks: z.boolean().optional(), limit: z.number().int().min(1).max(50).optional() }),
    execute: (a: { conceptId: string; linkDepth: number; includeCitations?: boolean; includeBacklinks?: boolean; limit?: number }, rt) => okf(rt)?.expandNeighbors(a) ?? okfUnavailable(),
  },
  {
    name: "source_resolve_citation",
    description: "Resolve a CellPayload/OKF evidence id to literal source evidence. Strong claims require this or source_open_literal.",
    schema: z.object({ evidenceId: z.string() }),
    execute: (a: { evidenceId: string }, rt) => okf(rt)?.resolveCitation(a) ?? okfUnavailable(),
  },
  {
    name: "source_open_literal",
    description: "Open a literal source concept/location by exact sourceArtifactId plus optional page/row/column/bbox. For uploaded workbooks, prefer row-only calls like {sourceArtifactId,row} to return a compact A-Z row before falling back to individual cells. Use the artifact id returned by list_artifacts/source evidence; if artifact_not_found is returned, retry with the exact id rather than guessing or truncating.",
    schema: z.object({
      sourceArtifactId: z.string(),
      page: z.number().int().positive().optional(),
      row: z.number().optional(),
      column: z.string().optional(),
      bbox: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number(), unit: z.enum(["px", "pt", "normalized"]).optional() }).optional(),
    }),
    execute: (a: { sourceArtifactId: string; page?: number; row?: number; column?: string; bbox?: { x: number; y: number; width: number; height: number; unit?: "px" | "pt" | "normalized" } }, rt) => okf(rt)?.openLiteral(a) ?? okfUnavailable(),
  },
  {
    name: "source_compare_claim",
    description: "Compare a claim against resolved OKF/source evidence. Returns supports, partial, contradicts, or unsupported plus missing evidence categories.",
    schema: z.object({
      claim: z.string(),
      evidenceRefs: z.array(z.object({
        evidenceId: z.string(),
        conceptId: z.string().optional(),
        citationId: z.string().optional(),
        sourceArtifactId: z.string().optional(),
      })).min(1),
    }),
    execute: (a: { claim: string; evidenceRefs: Array<{ evidenceId: string; conceptId?: string; citationId?: string; sourceArtifactId?: string }> }, rt) => okf(rt)?.compareClaim(a) ?? okfUnavailable(),
  },
];

export const OKF_TOOL_NAMES = OKF_RETRIEVAL_TOOLS.map((tool) => tool.name);
