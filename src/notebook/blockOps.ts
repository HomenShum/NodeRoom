/**
 * Pure notebook block engine — no Convex, no React, no editor instance.
 *
 * Operates on ProseMirror doc JSON (the shape stored by prosemirror-sync
 * snapshots and produced by the shared NOTEBOOK_EXTENSIONS schema). One
 * implementation serves every lane:
 *
 *   - convex/notebookAgent.ts builds its transform fn and read model from it
 *   - InMemoryRoomTools (memory mode) uses the HTML rendering lane
 *   - unit tests exercise the logic with zero backend
 *
 * The contract mirrors the spreadsheet cell spine at block granularity:
 *   block : cell :: blockId : elementId :: textHash : baseVersion
 *
 * Idempotency rule (load-bearing): prosemirror-sync's `transform()` re-runs its
 * fn until the write syncs, so outline application must be exactly-once. Block
 * ids are minted BEFORE the transform and the fn checks for their presence in
 * the fresh doc on every iteration — a retry that already landed becomes a
 * no-op instead of a duplicate.
 */

/** Leaf text-block node types (one NotebookBlockView row per leaf). */
const LEAF_TYPES = new Set(["paragraph", "heading", "codeBlock"]);
/** Container types that carry identity an orphaned leaf can inherit. */
const CONTAINER_TYPES = new Set(["listItem", "blockquote", "bulletList", "orderedList"]);

export type PmNodeJson = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: PmNodeJson[];
};

export type NotebookBlockView = {
  /** Stable identity from attrs.blockId, or null for legacy/unmigrated blocks. */
  blockId: string | null;
  /** Position-derived fallback id (`b{index}-{hash12}`) — matches the shipped read model. */
  derivedId: string;
  blockIndex: number;
  blockType: string;
  depth: number;
  text: string;
  textHash: string;
  authorKind: string | null;
  status: string | null;
};

export type OutlineBullet =
  | string
  | { text: string; claim?: boolean; evidence?: Array<Record<string, unknown>> };

export type OutlineSection = { title: string; bullets: OutlineBullet[] };

export type OutlineInput = {
  title?: string;
  sections: OutlineSection[];
  runId?: string;
};

/** Hard caps (BOUND): keep one tool call from splatting an unbounded subtree. */
export const OUTLINE_CAPS = {
  maxSections: 12,
  maxBulletsPerSection: 120,
  maxTextChars: 400,
  maxTitleChars: 120,
  maxBlocksPerRead: 200,
  /** Agent writes are refused (as data) once a doc grows past this many leaf
   *  blocks — every write pays O(doc) in the transform + mirror, so an agent
   *  loop must hit a ceiling instead of degrading the room. */
  maxDocBlocksForAgentWrite: 2_000,
} as const;

export const AGENT_SECTION_TITLE = "Agent notes";

/** Web-crypto sha256 — works in the browser, Convex default runtime, and vitest edge. */
export async function sha256HexWeb(input: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function inlineText(node: PmNodeJson): string {
  if (typeof node.text === "string") return node.text;
  if (!Array.isArray(node.content)) return "";
  return node.content.map(inlineText).join("");
}

function attrString(node: PmNodeJson | undefined, key: string): string | null {
  const value = node?.attrs?.[key];
  return typeof value === "string" && value ? value : null;
}

/** Walk the doc into ordered leaf block views with inherited identity/attribution.
 *  A leaf (paragraph/heading/codeBlock) prefers its own attrs; a leaf without a
 *  blockId inherits the nearest container's (a listItem's paragraph belongs to
 *  the listItem). */
export async function readNotebookBlocks(docJson: unknown): Promise<NotebookBlockView[]> {
  const root = (docJson ?? {}) as PmNodeJson;
  const raw: Array<Omit<NotebookBlockView, "derivedId" | "textHash" | "blockIndex">> = [];
  // BOUND: stop walking (and hashing) one past the read cap — callers detect
  // truncation via length > maxBlocksPerRead without paying O(doc) hashes.
  const hardStop = OUTLINE_CAPS.maxBlocksPerRead + 1;
  const walk = (node: PmNodeJson, depth: number, inherited: { blockId: string | null; authorKind: string | null; status: string | null }) => {
    if (raw.length >= hardStop) return;
    const type = node.type ?? "";
    const own = {
      blockId: attrString(node, "blockId") ?? inherited.blockId,
      authorKind: attrString(node, "authorKind") ?? inherited.authorKind,
      status: attrString(node, "status") ?? inherited.status,
    };
    if (LEAF_TYPES.has(type)) {
      const text = inlineText(node).replace(/\s+/g, " ").trim();
      if (text) raw.push({ blockId: own.blockId, blockType: type, depth, text, authorKind: own.authorKind, status: own.status });
      return;
    }
    if (!Array.isArray(node.content)) return;
    const nextDepth = CONTAINER_TYPES.has(type) ? depth + 1 : depth;
    const nextInherited = CONTAINER_TYPES.has(type) ? own : inherited;
    for (const child of node.content) walk(child, nextDepth, nextInherited);
  };
  for (const child of root.content ?? []) walk(child, 0, { blockId: null, authorKind: null, status: null });
  const views: NotebookBlockView[] = [];
  for (const [blockIndex, r] of raw.entries()) {
    const textHash = await sha256HexWeb(r.text);
    views.push({ ...r, blockIndex, textHash, derivedId: `b${blockIndex}-${textHash.slice(0, 12)}` });
  }
  return views;
}

export function normalizeTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Cheap bounded leaf count (no hashing) — the write-path size ceiling. Stops
 *  counting at `limit`, so a huge doc costs O(limit), not O(doc). */
export function countLeafBlocks(docJson: unknown, limit: number): number {
  let count = 0;
  const walk = (node: PmNodeJson) => {
    if (count >= limit) return;
    if (LEAF_TYPES.has(node.type ?? "")) {
      count += 1;
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const child of ((docJson ?? {}) as PmNodeJson).content ?? []) walk(child);
  return count;
}

/** Find the agent landing section: a top-level heading with attrs.agentRoot —
 *  matched by ATTRIBUTE, never by fragile title text. */
export function findAgentRootHeading(docJson: unknown): { topLevelIndex: number; blockId: string | null } | null {
  const root = (docJson ?? {}) as PmNodeJson;
  for (const [index, node] of (root.content ?? []).entries()) {
    if (node.type === "heading" && attrString(node, "agentRoot")) {
      return { topLevelIndex: index, blockId: attrString(node, "blockId") };
    }
  }
  return null;
}

/** Normalized heading titles at/after the given top-level index — the merge-mode
 *  dedupe set: a re-run merges into the agent section instead of duplicating. */
export function headingTitlesFrom(docJson: unknown, fromTopLevelIndex: number): Set<string> {
  const root = (docJson ?? {}) as PmNodeJson;
  const titles = new Set<string>();
  for (const node of (root.content ?? []).slice(fromTopLevelIndex)) {
    if (node.type === "heading") {
      const text = inlineText(node).trim();
      if (text) titles.add(normalizeTitle(text));
    }
  }
  return titles;
}

/** True if any node in the doc already carries one of the given blockIds —
 *  the exactly-once check for transform retries. */
export function docContainsBlockId(docJson: unknown, blockIds: Set<string>): boolean {
  if (blockIds.size === 0) return false;
  const check = (node: PmNodeJson): boolean => {
    const id = attrString(node, "blockId");
    if (id && blockIds.has(id)) return true;
    return (node.content ?? []).some(check);
  };
  return ((docJson ?? {}) as PmNodeJson).content?.some(check) ?? false;
}

function bulletFields(bullet: OutlineBullet): { text: string; claim: boolean; evidence: Array<Record<string, unknown>> } {
  if (typeof bullet === "string") return { text: bullet, claim: false, evidence: [] };
  return { text: bullet.text, claim: !!bullet.claim, evidence: bullet.evidence ?? [] };
}

function clampText(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export type BuiltOutline = {
  /** PM node JSON to append (title heading + per-section heading/bulletList pairs). */
  nodes: PmNodeJson[];
  /** Every server-minted blockId, in insertion order (first one is the retry sentinel). */
  mintedBlockIds: string[];
  /** Normalized titles of the sections actually included (post-dedupe). */
  sectionTitles: string[];
  /** Sections dropped by merge-mode title dedupe. */
  dedupedSections: number;
  /** Bullets downgraded to needs_review (claim without evidence — the honesty gate). */
  needsReviewCount: number;
};

/** Build the PM JSON for an outline append. Pure; the caller supplies minted ids
 *  via `mintId` so tests stay deterministic and the mutation controls identity.
 *  `existingTitles` (normalized) triggers merge-mode dedupe: an already-present
 *  section title is skipped instead of duplicated — a re-run merges. */
export function buildOutlineNodes(args: {
  outline: OutlineInput;
  mintId: () => string;
  mode: "append" | "merge";
  existingTitles?: Set<string>;
}): BuiltOutline {
  const minted: string[] = [];
  const mint = () => {
    const id = args.mintId();
    minted.push(id);
    return id;
  };
  const attribution = (extra?: Record<string, unknown>): Record<string, unknown> => ({
    blockId: mint(),
    authorKind: "agent",
    ...(args.outline.runId ? { runId: args.outline.runId } : {}),
    ...extra,
  });
  const nodes: PmNodeJson[] = [];
  const sectionTitles: string[] = [];
  let dedupedSections = 0;
  let needsReviewCount = 0;

  if (args.outline.title) {
    nodes.push({
      type: "heading",
      attrs: { level: 3, ...attribution() },
      content: [{ type: "text", text: clampText(args.outline.title, OUTLINE_CAPS.maxTitleChars) }],
    });
  }
  for (const section of args.outline.sections.slice(0, OUTLINE_CAPS.maxSections)) {
    const title = clampText(section.title, OUTLINE_CAPS.maxTitleChars);
    if (!title) continue;
    const normalized = normalizeTitle(title);
    if (args.mode === "merge" && args.existingTitles?.has(normalized)) {
      dedupedSections += 1;
      continue;
    }
    sectionTitles.push(normalized);
    nodes.push({
      type: "heading",
      attrs: { level: 4, ...attribution() },
      content: [{ type: "text", text: title }],
    });
    const items: PmNodeJson[] = [];
    for (const bullet of section.bullets.slice(0, OUTLINE_CAPS.maxBulletsPerSection)) {
      const { text, claim, evidence } = bulletFields(bullet);
      const clean = clampText(text, OUTLINE_CAPS.maxTextChars);
      if (!clean) continue;
      // Honesty gate: a factual claim without evidence is DOWNGRADED to
      // needs_review — never silently "complete", never invented, never rejected.
      const needsReview = claim && evidence.length === 0;
      if (needsReview) needsReviewCount += 1;
      items.push({
        type: "listItem",
        attrs: attribution(),
        content: [{
          type: "paragraph",
          attrs: attribution(needsReview ? { status: "needs_review" } : {}),
          content: [{ type: "text", text: clean }],
        }],
      });
    }
    if (items.length) nodes.push({ type: "bulletList", content: items });
  }
  return { nodes, mintedBlockIds: minted, sectionTitles, dedupedSections, needsReviewCount };
}

/** The agent landing section root, built once (idempotent via attr match). */
export function buildAgentRootNode(mintId: () => string): PmNodeJson {
  return {
    type: "heading",
    attrs: { level: 2, blockId: mintId(), authorKind: "agent", agentRoot: "true" },
    content: [{ type: "text", text: AGENT_SECTION_TITLE }],
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** HTML rendering of an outline — the memory-mode lane and the review-mode
 *  `doc:agent` proposal payload share it. Attribution attrs are preserved as
 *  data-* so provenance survives the HTML round-trip. */
export function outlineToHtml(args: { title?: string; built: BuiltOutline; outline: OutlineInput; includeAgentRoot: boolean }): string {
  const parts: string[] = [];
  if (args.includeAgentRoot) parts.push(`<h2 data-agent-root="true" data-author-kind="agent">${escapeHtml(AGENT_SECTION_TITLE)}</h2>`);
  if (args.outline.title) parts.push(`<h3 data-author-kind="agent">${escapeHtml(clampText(args.outline.title, OUTLINE_CAPS.maxTitleChars))}</h3>`);
  const included = new Set(args.built.sectionTitles);
  for (const section of args.outline.sections.slice(0, OUTLINE_CAPS.maxSections)) {
    const title = clampText(section.title, OUTLINE_CAPS.maxTitleChars);
    if (!title || !included.has(normalizeTitle(title))) continue;
    parts.push(`<h4 data-author-kind="agent">${escapeHtml(title)}</h4>`);
    const items: string[] = [];
    for (const bullet of section.bullets.slice(0, OUTLINE_CAPS.maxBulletsPerSection)) {
      const { text, claim, evidence } = bulletFields(bullet);
      const clean = clampText(text, OUTLINE_CAPS.maxTextChars);
      if (!clean) continue;
      const status = claim && evidence.length === 0 ? ` data-status="needs_review"` : "";
      items.push(`<li data-author-kind="agent"${status}>${escapeHtml(clean)}</li>`);
    }
    if (items.length) parts.push(`<ul>${items.join("")}</ul>`);
  }
  return parts.join("\n");
}
