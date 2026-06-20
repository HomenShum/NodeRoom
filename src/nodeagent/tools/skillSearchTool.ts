/**
 * skill_search(query) — discover Agent Skills on demand (skill RAG, P2).
 *
 * Progressive disclosure at catalog scale: returns only the top-k matching skill
 * RECORDS (slug/name/description/trust/source) — NOT their bodies. The model reads
 * these, picks one, then calls load_skill on the chosen slug/url.
 *
 * Sources, in order of preference:
 *   1. OKF (`rt.okf.semanticSearch({ type: "Agent Skill" })`) — per-room, embedded,
 *      ACL-filtered. Used when OKF is wired into the room.
 *   2. The bundled local `skill-index.json` — self-contained fallback (cheap lexical
 *      scorer), so the loop works before OKF ingestion exists.
 * Results from both are merged by slug (OKF wins on overlap), then top-k.
 *
 * See docs/architecture/DYNAMIC_SKILL_RETRIEVAL.md + .agent/skills.skill.md.
 */
import { z } from "zod";
import type { AgentTool, RoomTools } from "../core/types";
import type { OkfConcept } from "../okf/types";
import type { RetrievalHit } from "../retrieval/types";
import { loadSkillCatalog, type SkillCatalogRecord, type SkillTrust } from "./skillCatalog";

const DEFAULT_K = 5;
const MAX_K = 25;

export interface SkillSearchResult {
  slug: string;
  name: string;
  description: string;
  trust: SkillTrust;
  source: string; // human-readable origin: install path or url
}

export interface SkillSearchResponse {
  skills: SkillSearchResult[];
  /** Honest signal of where results came from (no fake "okf" when it was unavailable). */
  retrievedFrom: Array<"okf" | "local_catalog">;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1);
}

/** Cheap lexical relevance: query-token overlap over name+description+categories.
 *  Deterministic and dependency-free. Clear hook to swap for OKF semantic search. */
function lexicalScore(query: string, rec: SkillCatalogRecord): number {
  const q = tokenize(query);
  if (q.length === 0) return 0;
  const hay = new Set(tokenize(`${rec.name} ${rec.description} ${rec.categories.join(" ")}`));
  let hits = 0;
  for (const term of new Set(q)) if (hay.has(term)) hits += 1;
  return hits / new Set(q).size;
}

function recordToResult(rec: SkillCatalogRecord): SkillSearchResult {
  return {
    slug: rec.slug,
    name: rec.name,
    description: rec.description,
    trust: rec.trust,
    source: rec.source.url ?? rec.install ?? rec.source.path ?? rec.slug,
  };
}

function isOkfHitArray(value: unknown): value is RetrievalHit[] {
  return Array.isArray(value) && value.every((h) => h && typeof h === "object" && "concept" in h);
}

function okfHitToResult(hit: RetrievalHit): SkillSearchResult | null {
  const concept: OkfConcept = hit.concept;
  const fm = concept.frontmatter;
  const nd = fm.noderoom;
  // Slug = last path segment without extension (skills are at .../skills/<slug>.md).
  const slug = concept.path.split("/").pop()?.replace(/\.md$/, "") ?? concept.id;
  const name = fm.title ?? slug;
  const description = fm.description ?? "";
  return {
    slug,
    name,
    description,
    trust: (nd?.skill_trust as SkillTrust | undefined) ?? "untrusted",
    source: nd?.skill_install ?? fm.resource ?? slug,
  };
}

async function searchOkfSkills(
  rt: RoomTools,
  query: string,
  args: { skill_categories?: string[]; skill_trust_min?: "untrusted" | "community" | "verified"; limit: number },
): Promise<SkillSearchResult[] | null> {
  const port = rt.okf;
  if (!port) return null;
  try {
    const raw = await port.semanticSearch({
      query,
      type: "Agent Skill",
      skill_categories: args.skill_categories,
      skill_trust_min: args.skill_trust_min,
      limit: args.limit,
    });
    if (!isOkfHitArray(raw)) return null;
    const out: SkillSearchResult[] = [];
    for (const hit of raw) {
      const r = okfHitToResult(hit);
      if (r) out.push(r);
    }
    return out;
  } catch {
    // ERROR_BOUNDARY: OKF failure must NOT fail discovery — fall back to local catalog.
    return null;
  }
}

const TRUST_RANK: Record<"untrusted" | "community" | "verified", number> = {
  untrusted: 0,
  community: 1,
  verified: 2,
};

export const SKILL_SEARCH_TOOL: AgentTool = {
  name: "skill_search",
  description:
    "Discover an Agent Skill that already encodes a multi-step procedure (deck, spreadsheet, scrape, doc, format conversion) BEFORE hand-rolling it. Returns the top-k matching skills (slug, name, description, trust, source) — read these, then load_skill the best trusted fit. Progressive disclosure: bodies stay out of context until you choose one. Prefer trust:local / trust:verified.",
  schema: z.object({
    query: z.string(),
    k: z.number().int().min(1).max(MAX_K).optional(),
    skill_categories: z.array(z.string()).optional(),
    skill_trust_min: z.enum(["untrusted", "community", "verified"]).optional(),
  }),
  async execute(
    args: { query: string; k?: number; skill_categories?: string[]; skill_trust_min?: "untrusted" | "community" | "verified" },
    rt: RoomTools,
  ): Promise<SkillSearchResponse> {
    const k = Math.min(Math.max(args.k ?? DEFAULT_K, 1), MAX_K); // BOUND
    const retrievedFrom: Array<"okf" | "local_catalog"> = [];

    // 1. OKF (preferred when wired).
    const okfResults = await searchOkfSkills(rt, args.query, {
      skill_categories: args.skill_categories,
      skill_trust_min: args.skill_trust_min,
      limit: k,
    });
    const merged = new Map<string, SkillSearchResult>();
    if (okfResults && okfResults.length > 0) {
      retrievedFrom.push("okf");
      for (const r of okfResults) merged.set(r.slug, r);
    }

    // 2. Local catalog (always available; cheap lexical scorer).
    const minRank = args.skill_trust_min ? TRUST_RANK[args.skill_trust_min] : -1;
    const catalog = loadSkillCatalog();
    const scoredLocal = catalog
      .filter((rec) => {
        if (minRank >= 0 && (TRUST_RANK[rec.trust as "untrusted" | "community" | "verified"] ?? 0) < minRank) return false;
        if (args.skill_categories?.length) {
          const cats = new Set(rec.categories);
          if (!args.skill_categories.some((c) => cats.has(c))) return false;
        }
        return true;
      })
      .map((rec) => ({ rec, score: lexicalScore(args.query, rec) }))
      .sort((a, b) => b.score - a.score);
    if (scoredLocal.length > 0) {
      retrievedFrom.push("local_catalog");
      for (const { rec } of scoredLocal) {
        if (merged.has(rec.slug)) continue; // OKF result wins on overlap
        merged.set(rec.slug, recordToResult(rec));
        if (merged.size >= k) break;
      }
    }

    return { skills: Array.from(merged.values()).slice(0, k), retrievedFrom };
  },
};

export const SKILL_SEARCH_TOOLS: AgentTool[] = [SKILL_SEARCH_TOOL];
