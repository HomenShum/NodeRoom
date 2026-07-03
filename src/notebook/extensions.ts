/**
 * Shared notebook block schema — the ONE extension list used by every consumer
 * of a notebook ProseMirror document, so the schema can never drift between them:
 *
 *   1. SyncedEditorInner (live collaborative editor, src/ui/panels/Artifact.tsx)
 *   2. the legacy HTML-on-blur Note editor (same file)
 *   3. the server agent write path (convex/notebookAgent.ts — getSchema(NOTEBOOK_EXTENSIONS))
 *   4. legacy-HTML seeding + the elements["doc"] checkpoint mirror (@tiptap/html)
 *
 * Block identity: every block-level node carries `attrs.blockId` (uuid, minted by
 * the UniqueID extension for human-typed blocks and server-minted for agent
 * blocks). It renders as `data-blockid` in HTML, which makes blocks addressable
 * by agent tools (CAS anchors), provenance overlays, and Trace Lens.
 *
 * Attribution: agent-authored blocks carry `attrs.authorKind="agent"` +
 * `attrs.runId` + optional `attrs.status` ("needs_review"), set server-side —
 * attribution lives IN THE DATA, never inferred from location or title.
 *
 * This module must stay framework-free (no @tiptap/react imports): it is
 * bundled into Convex mutations.
 */

import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import UniqueID from "@tiptap/extension-unique-id";

/** Block-level node types that carry identity + attribution attrs. */
export const NOTEBOOK_BLOCK_TYPES = [
  "paragraph",
  "heading",
  "listItem",
  "blockquote",
  "codeBlock",
] as const;

declare global {
  interface HTMLElement {
    getAttribute(name: string): string | null;
  }
}

function dataAttr(name: string) {
  return {
    default: null as string | null,
    parseHTML: (element: HTMLElement) => element.getAttribute(`data-${name}`),
    renderHTML: (attributes: Record<string, unknown>) => {
      const value = attributes[toCamel(name)];
      if (!value) return {};
      return { [`data-${name}`]: String(value) };
    },
  };
}

function toCamel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Agent attribution + review-status attrs on every block type, plus the
 *  `agentRoot` marker on headings (the find-or-create "Agent notes" landing
 *  section — matched by ATTRIBUTE, never by fragile title text). */
const NotebookAttribution = Extension.create({
  name: "notebookAttribution",
  addGlobalAttributes() {
    return [
      {
        types: [...NOTEBOOK_BLOCK_TYPES],
        attributes: {
          authorKind: dataAttr("author-kind"),
          runId: dataAttr("run-id"),
          status: dataAttr("status"),
        },
      },
      {
        types: ["heading"],
        attributes: {
          agentRoot: dataAttr("agent-root"),
        },
      },
    ];
  },
});

/** The shared list. Client editors spread this and append their own live-only
 *  extensions (e.g. the prosemirror-sync `sync.extension`); the server uses it
 *  verbatim via `getSchema(NOTEBOOK_EXTENSIONS)`. */
export const NOTEBOOK_EXTENSIONS = [
  StarterKit,
  UniqueID.configure({
    attributeName: "blockId",
    types: [...NOTEBOOK_BLOCK_TYPES],
  }),
  NotebookAttribution,
];
