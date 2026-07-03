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
  try {
    const json = generateJSON(html, NOTEBOOK_EXTENSIONS) as { content?: unknown[] };
    if (!Array.isArray(json.content) || json.content.length === 0) return null;
    return ensureStableBlockIds(json, () => crypto.randomUUID()).docJson;
  } catch {
    return null;
  }
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
