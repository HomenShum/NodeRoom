/**
 * AttentionOverlay — the ONE component that paints focus boxes, identically inline (live) and in Trace replay.
 * Mount it as the last child of a position:relative viewport host (e.g. .r-sheet-wrap); it resolves each
 * box's logical target to viewport-px rects via the surface resolver and paints one interactive .r-focus-box.
 *
 * Critic fixes baked in:
 *  - ErrorBoundary: the overlay is decorative — a resolve/paint throw renders null, never blanks the artifact.
 *  - active TTL prune: a single timer fires at the soonest expiresAt and drops ephemeral boxes (not just lazy filter).
 *  - scroll/resize re-resolve: ResizeObserver on the host + scroll/window listeners, rAF-coalesced.
 *  - a11y: icon + text token per kind (never color alone) + aria-label; motion gated by prefers-reduced-motion (CSS).
 *  - per-kind pointer-events (CSS): passive kinds are click-through so they never steal the cell editor's click.
 */
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { FocusKind, FocusTargetResolver, TraceFocusBox } from "./types";

const KIND_GLYPH: Record<FocusKind, string> = {
  user_focus: "◉", agent_read: "◎", agent_write: "✎", citation: "❝", evidence: "✓",
  proposal: "＋", conflict: "▲", needs_review: "▲", coach_prompt: "?",
};
const KIND_WORD: Record<FocusKind, string> = {
  user_focus: "here", agent_read: "reading", agent_write: "writing", citation: "cited", evidence: "evidence",
  proposal: "suggestion", conflict: "locked", needs_review: "review", coach_prompt: "coach",
};
const INTERACTIVE: ReadonlySet<FocusKind> = new Set<FocusKind>(["proposal", "conflict", "needs_review", "coach_prompt"]);

class OverlayBoundary extends Component<{ children: ReactNode }, { dead: boolean }> {
  state = { dead: false };
  static getDerivedStateFromError() { return { dead: true }; }
  render() { return this.state.dead ? null : this.props.children; }
}

function OverlayInner({ boxes, resolver, onActivate }: {
  boxes: TraceFocusBox[];
  resolver: FocusTargetResolver;
  onActivate?: (b: TraceFocusBox) => void;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Re-resolve on host scroll / resize (rAF-coalesced) so px rects track the cells.
  useEffect(() => {
    const host = layerRef.current?.parentElement;
    if (!host) return;
    let raf = 0;
    const bump = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; setTick((t) => t + 1); }); };
    host.addEventListener("scroll", bump, { passive: true });
    window.addEventListener("resize", bump);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(bump) : null;
    ro?.observe(host);
    return () => { host.removeEventListener("scroll", bump); window.removeEventListener("resize", bump); ro?.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, []);

  // Active TTL prune: drop expired ephemeral boxes and re-arm a timer at the soonest future expiry.
  const live = useMemo(() => boxes.filter((b) => (b.expiresAt ?? Infinity) > now), [boxes, now]);
  useEffect(() => {
    const next = boxes.reduce<number>((m, b) => (b.expiresAt && b.expiresAt > now ? Math.min(m, b.expiresAt) : m), Infinity);
    if (!Number.isFinite(next)) return;
    const id = setTimeout(() => setNow(Date.now()), Math.max(50, next - now));
    return () => clearTimeout(id);
  }, [boxes, now]);

  return (
    <div className="r-focus-layer" ref={layerRef} data-testid="attention-overlay" aria-hidden={false}>
      {live.flatMap((b) => {
        const r = resolver.resolve(b.target);
        return r.rects.map((rect, i) => {
          const interactive = !!onActivate && INTERACTIVE.has(b.focusKind);
          const label = `${b.focusKind.replace("_", " ")}: ${b.label}`;
          return (
            <button
              key={`${b.id}:${i}`}
              type="button"
              className="r-focus-box"
              data-focus-kind={b.focusKind}
              data-actor-kind={b.actorKind}
              data-interactive={interactive ? "true" : "false"}
              data-testid="focus-box"
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              title={b.description ?? b.label}
              aria-label={label}
              tabIndex={interactive ? 0 : -1}
              onClick={interactive && onActivate ? () => onActivate(b) : undefined}
            >
              <span className="r-focus-flag" data-focus-kind={b.focusKind} aria-hidden="true">
                <span className="r-focus-glyph">{KIND_GLYPH[b.focusKind]}</span>
                {b.label || KIND_WORD[b.focusKind]}
              </span>
            </button>
          );
        });
      })}
    </div>
  );
}

export function AttentionOverlay(props: {
  boxes: TraceFocusBox[];
  resolver: FocusTargetResolver;
  mode?: "live" | "replay";
  onActivate?: (b: TraceFocusBox) => void;
}) {
  return (
    <OverlayBoundary>
      <OverlayInner boxes={props.boxes} resolver={props.resolver} onActivate={props.onActivate} />
    </OverlayBoundary>
  );
}
