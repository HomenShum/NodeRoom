/**
 * Legacy-HTML ↔ ProseMirror-JSON conversion for notebooks, shared by:
 *   - convex/prosemirror.ts (ensureNotebookDoc seeds the synced doc from the
 *     legacy elements["doc"] HTML — the flag-flip no longer orphans content)
 *   - convex/notebookAgent.ts (agent-lane ensure + the elements["doc"]
 *     checkpoint mirror after agent writes)
 *
 * Uses @tiptap/html (DOM-free) against the shared NOTEBOOK_EXTENSIONS schema,
 * so seeding and mirroring can never drift from what the editors accept.
 */

import { generateHTML, generateJSON } from "@tiptap/html";
import { NOTEBOOK_EXTENSIONS } from "./extensions";
import { ensureStableBlockIds } from "./blockOps";

const EMPTY_DOC: object = { type: "doc", content: [{ type: "paragraph" }] };
const LEGACY_BLOCK_RE = /<(h[1-6]|p|li|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi;

/** True for the uploaded-file doc shape ({ upload: true, ... }) — never a text note. */
function isUploadedFileDoc(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { upload?: unknown }).upload === true;
}

/** Convert a legacy elements["doc"] value to a PM doc JSON seed.
 *  Returns null when there is nothing meaningful to seed (empty/uploaded-file),
 *  in which case the caller should seed the standard empty doc. Conversion
 *  errors also return null — fail open to an empty doc, never block ensure. */
export function legacyDocValueToPmJson(value: unknown): object | null {
  if (typeof value !== "string" || isUploadedFileDoc(value)) return null;
  const html = value.trim();
  if (!html || html === "<p></p>") return null;
  let index = 0;
  const mintId = () => `legacy-${stableHash(html)}-${++index}`;
  try {
    const json = generateJSON(html, NOTEBOOK_EXTENSIONS) as { content?: unknown[] };
    if (Array.isArray(json.content) && json.content.length > 0) {
      return ensureStableBlockIds(json, mintId).docJson;
    }
  } catch {
    // The Convex runtime can reject DOM-oriented parser internals. Fall through
    // to the small server-safe block parser below instead of orphaning content.
  }
  const fallback = legacyHtmlBlocks(html);
  return fallback ? ensureStableBlockIds(fallback, mintId).docJson : null;
}

function legacyHtmlBlocks(html: string): { type: "doc"; content: Array<Record<string, unknown>> } | null {
  const content: Array<Record<string, unknown>> = [];
  let match: RegExpExecArray | null;
  LEGACY_BLOCK_RE.lastIndex = 0;
  while ((match = LEGACY_BLOCK_RE.exec(html))) {
    const tag = match[1].toLowerCase();
    const text = decodeHtml(match[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (!text) continue;
    const textNode = { type: "text", text };
    if (tag.startsWith("h")) {
      content.push({ type: "heading", attrs: { level: Number(tag.slice(1)) }, content: [textNode] });
    } else if (tag === "pre") {
      content.push({ type: "codeBlock", content: [textNode] });
    } else if (tag === "blockquote") {
      content.push({ type: "blockquote", content: [{ type: "paragraph", content: [textNode] }] });
    } else {
      // Standalone listItem nodes are invalid at the doc root. A paragraph keeps
      // the human text intact if the richer HTML parser is unavailable.
      content.push({ type: "paragraph", content: [textNode] });
    }
  }
  return content.length ? { type: "doc", content } : null;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function emptyNotebookDoc(): object {
  return EMPTY_DOC;
}

/** Render a PM doc JSON to HTML for the elements["doc"] checkpoint mirror.
 *  Returns null on failure — the mirror is best-effort and must never block
 *  the synced-doc write (synced doc is the source of truth). */
export function pmJsonToHtml(docJson: unknown): string | null {
  try {
    return generateHTML(docJson as Parameters<typeof generateHTML>[0], NOTEBOOK_EXTENSIONS);
  } catch {
    return null;
  }
}
