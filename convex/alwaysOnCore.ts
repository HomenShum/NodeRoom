/**
 * Always-On Rooms — PURE core (no convex imports, no I/O).
 *
 * Shared contract module for the deterministic v1 pipeline:
 *   validate source URL (SSRF allowlist) → fetch (caller) → contentHash →
 *   extractPapersFromHtml → renderDailyBriefMarkdown / renderDigestEmail →
 *   outbox state machine + idempotency keys.
 *
 * v1 is DETERMINISTIC end to end: zero model calls. Every function here is a
 * pure function of its inputs (contentHash is async only because WebCrypto's
 * digest is async — same SHA-256 → lowercase hex algorithm as convex/lib.ts
 * sha256Hex, so there is one canonical hash shape across the repo).
 *
 * Export surface is EXACTLY the shared lane contract:
 *   ALLOWED_SOURCE_HOSTS, validateSourceUrl, contentHash,
 *   extractPapersFromHtml, renderDailyBriefMarkdown, renderDigestEmail,
 *   OUTBOX_STATES, canTransition, buildIdempotencyKey
 * (plus `export type` declarations, which erase at runtime).
 * Bound/shape helpers used by mutations live in convex/alwaysOnShape.ts.
 */

// ─── Source allowlist + URL validation (SSRF gate) ─────────────────────────

/** v1 hardcoded allowlist. A source whose host is not here is rejected BEFORE any fetch. */
export const ALLOWED_SOURCE_HOSTS: readonly string[] = ["expositio.org"];

export type SourceUrlCheck =
  | { ok: true; href: string; host: string }
  | { ok: false; reason: string };

/**
 * Reject: non-https, userinfo@ tricks, IP-literal hosts, non-default ports,
 * hosts not EXACTLY matching allowedHost, and allowedHosts that are not in
 * ALLOWED_SOURCE_HOSTS (so a smuggled source row cannot widen the allowlist).
 */
export function validateSourceUrl(url: string, allowedHost: string): SourceUrlCheck {
  if (typeof url !== "string" || url.length === 0 || url.length > 2048) {
    return { ok: false, reason: "invalid_url" };
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (parsed.protocol !== "https:") return { ok: false, reason: "https_required" };
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, reason: "userinfo_not_allowed" };
  }
  const host = normalizeHost(parsed.hostname);
  if (isIpLiteralHost(host)) return { ok: false, reason: "ip_literal_not_allowed" };
  const allowed = normalizeHost(allowedHost ?? "");
  if (!ALLOWED_SOURCE_HOSTS.includes(allowed)) return { ok: false, reason: "host_not_allowlisted" };
  if (host !== allowed) return { ok: false, reason: "host_not_allowed" };
  if (parsed.port !== "" && parsed.port !== "443") return { ok: false, reason: "port_not_allowed" };
  return { ok: true, href: parsed.href, host };
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

function isIpLiteralHost(host: string): boolean {
  if (host.startsWith("[") || host.includes(":")) return true; // IPv6 literal
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host); // IPv4 literal
}

// ─── Content hashing (change detection) ────────────────────────────────────

/**
 * sha256 lowercase hex of whitespace-normalized text — same algorithm as
 * convex/lib.ts sha256Hex (SHA-256 → lowercase hex), with normalization on
 * top so CRLF/indentation churn does not read as a content change.
 * DETERMINISTIC: identical logical text always hashes identically.
 */
export async function contentHash(text: string): Promise<string> {
  const normalized = String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Deterministic extraction (no model calls) ─────────────────────────────

export type ExtractedPaper = {
  title: string;
  href: string;
  discipline?: string;
  topic?: string;
};

export const PAPER_EXTRACTOR_CACHE_VERSION = "expositio-paper-links-v2";

/** BOUND: never return more than this many items regardless of input size. */
const MAX_EXTRACTED_ITEMS = 500;
/** BOUND_READ backstop: never regex-walk more than this many chars (fetch already caps at 1MB). */
const MAX_HTML_CHARS = 1_500_000;
const RESERVED_PAPER_PATH_SEGMENTS = new Set(["submit", "by-date", "archive", "rss", "feed"]);

/**
 * Parse anchor/list items into paper records. Robust to markup noise:
 * nested tags inside anchors, entity-encoded titles, single/double/bare
 * attribute quoting. Skips fragment/scheme-abuse hrefs. Optional
 * discipline/topic come from data-discipline / data-topic attributes when the
 * source provides them — nothing is ever invented.
 */
export function extractPapersFromHtml(html: string): ExtractedPaper[] {
  if (typeof html !== "string" || html.length === 0) return [];
  const source = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;
  const out: ExtractedPaper[] = [];
  const seen = new Set<string>();
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(source)) !== null && out.length < MAX_EXTRACTED_ITEMS) {
    const attrs = match[1] ?? "";
    const rawHref = readAttr(attrs, "href");
    if (!rawHref) continue;
    const href = rawHref.trim();
    if (href === "" || href.startsWith("#")) continue;
    if (/^(javascript|data|mailto|vbscript|file):/i.test(href)) continue;
    if (!isPaperDetailHref(href)) continue;
    const title = decodeEntities(stripTags(match[2] ?? ""))
      .replace(/\s+/g, " ")
      .trim();
    if (title.length < 3) continue;
    if (isGenericPaperActionTitle(title)) continue;
    const key = `${href}\u0000${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const item: ExtractedPaper = { title: title.slice(0, 300), href: href.slice(0, 1024) };
    const discipline = readAttr(attrs, "data-discipline");
    if (discipline) item.discipline = decodeEntities(discipline).replace(/\s+/g, " ").trim().slice(0, 120);
    const topic = readAttr(attrs, "data-topic");
    if (topic) item.topic = decodeEntities(topic).replace(/\s+/g, " ").trim().slice(0, 120);
    out.push(item);
  }
  return out;
}

export function isPaperDetailHref(href: string): boolean {
  const trimmed = String(href ?? "").trim();
  if (matchesPaperDetailPath(trimmed)) return true;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:") return false;
    if (parsed.username !== "" || parsed.password !== "") return false;
    if (parsed.port !== "" && parsed.port !== "443") return false;
    if (normalizeHost(parsed.hostname) !== "expositio.org") return false;
    if (parsed.search !== "" || parsed.hash !== "") return false;
    return matchesPaperDetailPath(parsed.pathname);
  } catch {
    return false;
  }
}

export function isGenericPaperActionTitle(title: string): boolean {
  return /^(read|view|open)\s+paper$/i.test(String(title ?? "").trim());
}

function matchesPaperDetailPath(path: string): boolean {
  const match = /^\/(?:papers|p)\/([^/?#]+)\/?$/.exec(path);
  if (!match) return false;
  return !RESERVED_PAPER_PATH_SEGMENTS.has(match[1].toLowerCase());
}

/** Attribute names are internal constants ("href", "data-discipline", "data-topic") — never user input. */
function readAttr(attrs: string, name: string): string | undefined {
  const re = new RegExp(`(?:^|[\\s"'])${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = re.exec(attrs);
  if (!m) return undefined;
  const value = (m[2] ?? m[3] ?? m[4] ?? "").trim();
  return value === "" ? undefined : value;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ");
}

// ─── Deterministic brief + digest templates ────────────────────────────────

export type BriefMeta = { title: string; dateLine: string; runNumber: number };

export type BriefItem = {
  title: string;
  discipline?: string;
  topic?: string;
  status?: string;
  href?: string;
};

export type DigestLinks = {
  viewRoomUrl: string;
  manageUrl: string;
  unsubscribeUrl: string;
};

const MAX_BRIEF_LISTED = 10;

/**
 * Template-render the daily brief from EXTRACTED items only. Sections are the
 * shared contract: What changed / Top new papers / Open questions. Never
 * invents items: an empty scan says so, and Open questions is an honest
 * static note (LLM enrichment is a later approval-gated mode).
 */
export function renderDailyBriefMarkdown(meta: BriefMeta, items: BriefItem[]): string {
  const bounded = (Array.isArray(items) ? items : []).slice(0, MAX_EXTRACTED_ITEMS);
  const fresh = bounded.filter((i) => i.status === "new");
  const updated = bounded.filter((i) => i.status === "updated");
  const tracked = bounded.length - fresh.length - updated.length;
  const lines: string[] = [];
  lines.push(`# ${sanitizeInline(meta.title)}`);
  lines.push("");
  lines.push(`${sanitizeInline(meta.dateLine)} · run #${meta.runNumber}`);
  lines.push("");
  lines.push("## What changed");
  lines.push("");
  if (bounded.length === 0) {
    lines.push("No items tracked yet. The first successful scan will populate this brief.");
  } else {
    lines.push(`${fresh.length} new · ${updated.length} updated · ${tracked} tracked (${bounded.length} total).`);
  }
  lines.push("");
  lines.push("## Top new papers");
  lines.push("");
  if (fresh.length === 0) {
    lines.push("No new papers detected in this scan.");
  } else {
    for (const item of fresh.slice(0, MAX_BRIEF_LISTED)) {
      const tags = [item.discipline, item.topic].filter(Boolean).join(" · ");
      const label = tags ? `${sanitizeInline(item.title)} — ${sanitizeInline(tags)}` : sanitizeInline(item.title);
      lines.push(item.href ? `- [${label}](${sanitizeHref(item.href)})` : `- ${label}`);
    }
    if (fresh.length > MAX_BRIEF_LISTED) {
      lines.push(`- …and ${fresh.length - MAX_BRIEF_LISTED} more new papers in the room.`);
    }
  }
  lines.push("");
  lines.push("## Open questions");
  lines.push("");
  lines.push("None recorded — the deterministic scan does not generate analysis. LLM enrichment is a later, approval-gated mode.");
  lines.push("");
  return lines.join("\n");
}

/**
 * Digest email = the daily brief + the three contract links
 * (View room / Manage subscription / Unsubscribe). Deterministic template;
 * subject derives from the brief meta only.
 */
export function renderDigestEmail(
  briefMeta: BriefMeta,
  items: BriefItem[],
  links: DigestLinks,
): { subject: string; markdown: string } {
  const brief = renderDailyBriefMarkdown(briefMeta, items);
  const footer = [
    "---",
    "",
    `[View room](${sanitizeHref(links.viewRoomUrl)}) · [Manage subscription](${sanitizeHref(links.manageUrl)}) · [Unsubscribe](${sanitizeHref(links.unsubscribeUrl)})`,
    "",
    "You receive this because you confirmed a subscription to this always-on room. Digests are drafted first and reviewed before send.",
    "",
  ].join("\n");
  return {
    subject: `${sanitizeInline(briefMeta.title)} — ${sanitizeInline(briefMeta.dateLine)}`,
    markdown: `${brief}\n${footer}`,
  };
}

/** Keep extracted text from breaking markdown structure (links, headings, code fences). */
function sanitizeInline(text: string): string {
  return String(text ?? "").replace(/[[\]`]/g, "").replace(/\s+/g, " ").trim();
}

/** Keep hrefs from escaping a markdown link — strip whitespace and parens. */
function sanitizeHref(href: string): string {
  return String(href ?? "").replace(/[)\s(]/g, "");
}

// ─── Outbox state machine ──────────────────────────────────────────────────

export const OUTBOX_STATES = [
  "pending_draft",
  "draft_created",
  "approved",
  "sent",
  "failed",
  "skipped",
] as const;

export type OutboxState = (typeof OUTBOX_STATES)[number];

/**
 * Exactly the contract transitions; anything else is invalid:
 *   pending_draft → draft_created → approved → sent
 *   failed → pending_draft   (one retry — retry-count bound enforced at the mutation)
 *   pending_draft → skipped
 * Note the machine has NO transition INTO "failed": failed rows are recorded
 * at creation by the send worker, per the shared contract.
 */
const VALID_TRANSITIONS: ReadonlyArray<readonly [OutboxState, OutboxState]> = [
  ["pending_draft", "draft_created"],
  ["draft_created", "approved"],
  ["approved", "sent"],
  ["failed", "pending_draft"],
  ["pending_draft", "skipped"],
];

export function canTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

// ─── Idempotency ───────────────────────────────────────────────────────────

/**
 * DETERMINISTIC dedupe key for one digest send: roomSlug:briefKey:subscriptionId:cadence.
 * Format matches the shared contract literally (see AO_OUTBOX demo keys, e.g.
 * "exp:b0704:s003:daily"). Parts are internal identifiers (slug, date key,
 * Convex id, cadence literal) and never contain ":" themselves.
 */
export function buildIdempotencyKey(parts: {
  roomSlug: string;
  briefKey: string;
  subscriptionId: string;
  cadence: string;
}): string {
  return `${parts.roomSlug}:${parts.briefKey}:${parts.subscriptionId}:${parts.cadence}`;
}
