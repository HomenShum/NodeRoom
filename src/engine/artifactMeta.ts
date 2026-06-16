/**
 * deriveArtifactMeta — generate a file's TOPIC (title), one-line summary, and tags from its CONTENT.
 *
 * This is the deterministic, dependency-free version of "the topic can be agent-generated/managed
 * given the content of the file." It runs at create/upload time so an artifact never sits as a raw
 * filename ("sample.csv"), and its output (title/summary/tags) is exactly the metadata that feeds the
 * Convex OKF/RAG embedding (concept frontmatter title/description/tags). The live NodeAgent can refine
 * it with LLM-quality wording via the set_artifact_meta tool, but this guarantees a sane baseline.
 */

export interface DerivableArtifact {
  kind: string;
  title: string;
  elements?: Record<string, { value?: unknown } | undefined>;
  order?: string[];
}

export interface DerivedArtifactMeta {
  title?: string;
  summary?: string;
  tags?: string[];
}

const GENERIC_TITLE = /(^untitled|^sheet\d*$|^sample\b|\.(csv|tsv|xlsx?|json|txt|md|pdf)$)/i;
const STOP = new Set(["the", "and", "for", "with", "from", "this", "that", "value", "values", "null", "true", "false", "n/a", "na"]);

function isGenericTitle(title: string): boolean {
  return !title.trim() || GENERIC_TITLE.test(title.trim());
}

function titleize(raw: string): string {
  const stem = raw.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
  if (!stem) return "Untitled";
  return stem.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
}

/** Short, human, non-numeric cell values in document order (deduped) — the content signal we name from. */
function contentValues(art: DerivableArtifact, cap = 60): string[] {
  const els = art.elements ?? {};
  const ids = art.order && art.order.length ? art.order : Object.keys(els);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const raw = els[id]?.value;
    if (raw == null) continue;
    let s = typeof raw === "string" ? raw : typeof raw === "number" || typeof raw === "boolean" ? String(raw) : "";
    s = s.trim();
    if (!s || s.length > 48) continue;
    if (/^[-+$%.,\d\s]+$/.test(s)) continue; // pure numbers/currency
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

export function deriveArtifactMeta(art: DerivableArtifact): DerivedArtifactMeta {
  const values = contentValues(art);
  const result: DerivedArtifactMeta = {};

  // Topic: keep a good human title; otherwise name from the most salient content, falling back to a
  // titleized filename. Sheet/research lead with their distinctive entries (e.g. company names).
  if (isGenericTitle(art.title)) {
    const lead = values.slice(0, 3).join(", ");
    result.title = (lead && lead.length >= 3 ? lead : titleize(art.title)).slice(0, 80);
  }

  if (values.length) {
    result.summary = `${values.length} item(s): ${values.slice(0, 6).join(", ")}`.slice(0, 240);
    const tags = Array.from(
      new Set(
        values
          .flatMap((v) => v.toLowerCase().split(/[^a-z0-9]+/))
          .filter((t) => t.length >= 3 && t.length <= 24 && !STOP.has(t) && !/^\d+$/.test(t)),
      ),
    ).slice(0, 10);
    if (tags.length) result.tags = tags;
  }

  return result;
}
