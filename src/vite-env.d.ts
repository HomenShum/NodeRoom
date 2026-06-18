/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Live Convex deployment URL. When unset, the app runs on the in-memory engine. */
  readonly VITE_CONVEX_URL?: string;
  /** Convex site (HTTP actions) URL. */
  readonly VITE_CONVEX_SITE_URL?: string;
  /** Native notebook editor mode. `prosemirror` enables Convex ProseMirror Sync;
   *  unset keeps the legacy Tiptap HTML-on-blur editor (Option A fallback). */
  readonly VITE_NOTEBOOK_SYNC?: "prosemirror";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
