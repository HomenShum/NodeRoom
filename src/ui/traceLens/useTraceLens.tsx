import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LensMode, SurfaceHit, TraceLensState } from "./types";

interface TraceLensApi extends TraceLensState {
  openHit: (hit: SurfaceHit) => void;
  close: () => void;
  setMode: (mode: LensMode) => void;
}

const TraceLensContext = createContext<TraceLensApi | null>(null);

/** Resolve a click target to the nearest tagged surface + any in-scope artifact/element refs. */
function resolveHit(target: EventTarget | null): SurfaceHit | null {
  if (!(target instanceof Element)) return null;
  const node = target.closest("[data-noderoom-surface]");
  if (!node) return null;
  const surfaceId = node.getAttribute("data-noderoom-surface");
  if (!surfaceId) return null;
  // Capture the most specific in-scope refs the user actually clicked (a cell/row/
  // notebook block), not the surface root.
  const refNode = target.closest("[data-element-id],[data-artifact-id],[data-target-ref],[data-blockid]");
  const scope = refNode && node.contains(refNode) ? refNode : node;
  const blockId = scope.getAttribute("data-blockid");
  return {
    surfaceId,
    artifactId: scope.getAttribute("data-artifact-id") ?? node.getAttribute("data-artifact-id") ?? undefined,
    elementId: scope.getAttribute("data-element-id") ?? undefined,
    // Notebook blocks resolve by their stable block identity (provenance anchors
    // and mutation receipts key on `blk:{blockId}`).
    targetRef: scope.getAttribute("data-target-ref") ?? (blockId ? `notebook_block:${blockId}` : undefined),
  };
}

export function TraceLensProvider({
  children,
  enabled = true,
  builderCapable = false,
}: {
  children: ReactNode;
  enabled?: boolean;
  builderCapable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [hit, setHit] = useState<SurfaceHit | null>(null);
  // Default review for everyone; a tampered value can never reveal Builder data because the panel
  // also conditions the Code region on builderCapable (server-verified), not just on mode.
  const [mode, setModeRaw] = useState<LensMode>("review");

  const openHit = useCallback((h: SurfaceHit) => { setHit(h); setOpen(true); }, []);
  const close = useCallback(() => setOpen(false), []);
  const setMode = useCallback((m: LensMode) => setModeRaw(m === "builder" && !builderCapable ? "review" : m), [builderCapable]);

  useEffect(() => {
    if (!enabled) return;
    const onClick = (e: MouseEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.button !== 0) return;
      const resolved = resolveHit(e.target);
      if (!resolved) return;
      e.preventDefault();
      e.stopPropagation();
      openHit(resolved);
    };
    // Capture phase so we win before a surface's own click handler (e.g. opening a cell editor).
    window.addEventListener("click", onClick, true);
    return () => window.removeEventListener("click", onClick, true);
  }, [enabled, openHit]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const value = useMemo<TraceLensApi>(
    () => ({ open, hit, mode: builderCapable ? mode : "review", builderCapable, openHit, close, setMode }),
    [open, hit, mode, builderCapable, openHit, close, setMode],
  );
  return <TraceLensContext.Provider value={value}>{children}</TraceLensContext.Provider>;
}

export function useTraceLens(): TraceLensApi {
  const ctx = useContext(TraceLensContext);
  if (!ctx) throw new Error("useTraceLens must be used within TraceLensProvider");
  return ctx;
}
