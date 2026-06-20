/**
 * Skill catalog reader — the local, self-contained side of skill RAG.
 *
 * `skill_search` and `load_skill` both resolve skills from the bundled
 * `skill-index.json` (the portable P0 substrate). This keeps the discover→load
 * loop working even before OKF ingestion is wired into a room. When OKF IS wired,
 * the agent prefers `okf_search_skills` (per-room, embedded, ACL-filtered); this
 * local index is the fallback / seed.
 *
 * See docs/architecture/DYNAMIC_SKILL_RETRIEVAL.md + okf/skillCatalog/format.md.
 */

// resolveJsonModule is on (tsconfig); a static import keeps this bundler-safe and
// browser-safe (no node:fs needed just to read the catalog).
import rawIndex from "../okf/skillCatalog/skill-index.json";

export type SkillTrust = "local" | "verified" | "community" | "untrusted";
export type SkillSourceKind = "local" | "catalog" | "url";

export interface SkillCatalogSource {
  kind: SkillSourceKind;
  path: string | null;
  url: string | null;
}

export interface SkillCatalogRecord {
  slug: string;
  name: string;
  description: string;
  categories: string[];
  trust: SkillTrust;
  source: SkillCatalogSource;
  /** Where load_skill fetches the body from (local dir/file path or remote URL). */
  install: string | null;
  contentHash: string | null;
  license: string | null;
  indexedAt: string | null;
}

/** Bound: never let a malformed/huge index blow up downstream ranking. */
export const MAX_CATALOG_RECORDS = 2000;

function asTrust(value: unknown): SkillTrust {
  return value === "local" || value === "verified" || value === "community" ? value : "untrusted";
}

function coerceRecord(input: unknown): SkillCatalogRecord | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const slug = typeof r.slug === "string" ? r.slug : typeof r.name === "string" ? r.name : null;
  const name = typeof r.name === "string" ? r.name : slug;
  const description = typeof r.description === "string" ? r.description : "";
  if (!slug || !name) return null;
  const src = (r.source && typeof r.source === "object" ? r.source : {}) as Record<string, unknown>;
  return {
    slug,
    name,
    description,
    categories: Array.isArray(r.categories) ? r.categories.filter((c): c is string => typeof c === "string") : [],
    trust: asTrust(r.trust),
    source: {
      kind: src.kind === "catalog" || src.kind === "url" ? src.kind : "local",
      path: typeof src.path === "string" ? src.path : null,
      url: typeof src.url === "string" ? src.url : null,
    },
    install: typeof r.install === "string" ? r.install : null,
    contentHash: typeof r.contentHash === "string" ? r.contentHash : null,
    license: typeof r.license === "string" ? r.license : null,
    indexedAt: typeof r.indexedAt === "string" ? r.indexedAt : null,
  };
}

/** Load + validate the bundled catalog. Bounded; tolerant of a malformed file. */
export function loadSkillCatalog(): SkillCatalogRecord[] {
  const arr = Array.isArray(rawIndex) ? (rawIndex as unknown[]) : [];
  const out: SkillCatalogRecord[] = [];
  for (const entry of arr) {
    if (out.length >= MAX_CATALOG_RECORDS) break; // BOUND
    const rec = coerceRecord(entry);
    if (rec) out.push(rec);
  }
  return out;
}

export function findSkillByIdOrUrl(idOrUrl: string): SkillCatalogRecord | undefined {
  const needle = idOrUrl.trim();
  if (!needle) return undefined;
  const catalog = loadSkillCatalog();
  return catalog.find(
    (s) => s.slug === needle || s.name === needle || s.source.url === needle || s.install === needle,
  );
}
