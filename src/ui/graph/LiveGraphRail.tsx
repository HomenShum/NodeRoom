/**
 * LiveGraphRail — a collapsible right-rail panel that renders the room's REAL
 * event stream (trace log: edits, locks, drafts, proposals, agent status) as a
 * live typed-edge graph, using the vendored @homenshum/nodegraph-live renderer.
 *
 * Honest contract (matches the renderer's edge grammar):
 *   - Every observation comes from a real TraceEvent; its trace id is the
 *     dedup eventId, so replaying the same event never strengthens an edge.
 *   - Room events carry NO measured registry counts — measuredCount is always
 *     undefined, so entities read "unknown — not measured" and every edge is
 *     interaction history (traversal), never measured evidence.
 *   - assertEdge is NEVER called: the keyless demo path has no versioned
 *     curated source to receipt, so no curated assertion edges exist here.
 */
import { lazy, memo, Suspense, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Share2, X } from "lucide-react";
import { GraphSession, type EntityRef } from "@homenshum/nodegraph-live";
import { useStore } from "../../app/store";
import type { TraceEvent } from "../../engine/types";

// Sigma/graphology load only when the rail is opened; the session feed itself is cheap.
const NodeGraphCanvas = lazy(() =>
  import("@homenshum/nodegraph-live/react").then((m) => ({ default: m.NodeGraph })),
);

/** Real participants of a room event: the actor, the touched artifact, and (when present) the touched element. */
function traceParticipants(t: TraceEvent, artifactTitle: (id: string) => string | undefined): EntityRef[] {
  const entities: EntityRef[] = [{ kind: t.actor.kind, label: t.actor.name }];
  const artifactId = t.refs?.artifactId;
  const title = artifactId ? artifactTitle(artifactId) : undefined;
  if (title) {
    entities.push({ kind: "artifact", label: title });
    const elementId = t.refs?.elementId ?? t.refs?.cell;
    // Cell refs (C2) read fine; machine row ids (r_rev_variance) don't — humanize for display only.
    // Labels are never a tool contract (graphAgentContext.ts warns against deriving ids from them).
    const elementLabel = elementId && (/^[A-Z]{1,2}\d+$/.test(elementId) ? elementId : elementId.replace(/^r_/, "").replace(/_/g, " "));
    if (elementLabel) entities.push({ kind: "element", label: `${title} · ${elementLabel}` });
  }
  return entities;
}

function useDarkTheme(): boolean {
  const [dark, setDark] = useState(() => (document.documentElement.dataset.theme ?? "dark") === "dark");
  useEffect(() => {
    const observer = new MutationObserver(() =>
      setDark((document.documentElement.dataset.theme ?? "dark") === "dark"),
    );
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return dark;
}

export const LiveGraphRail = memo(function LiveGraphRail({ roomId }: { roomId: string }) {
  const store = useStore();
  const dark = useDarkTheme();
  const [open, setOpen] = useState(false);
  // One bounded session per room; fed ids are tracked so a re-render never
  // re-fingerprints an event whose artifact title has since changed.
  const session = useMemo(() => new GraphSession(), [roomId]); // eslint-disable-line react-hooks/exhaustive-deps -- reset per room
  const fedIds = useMemo(() => new Set<string>(), [session]);

  const traces = store.listTraces(roomId);
  useEffect(() => {
    for (const t of traces) {
      if (fedIds.has(t.id)) continue;
      fedIds.add(t.id);
      const entities = traceParticipants(t, (id) => store.getArtifact(id)?.title);
      // measuredCount stays undefined: room events measure nothing.
      if (entities.length > 0) session.observe(entities, undefined, { eventId: t.id });
    }
  }, [traces, session, fedIds, store]);

  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);

  if (!open) {
    return (
      <button
        type="button"
        data-testid="live-graph-rail-toggle"
        data-entities={snap.nodes.length}
        onClick={() => setOpen(true)}
        title="Open the live session graph (real room events)"
        aria-label={`Open live session graph (${snap.nodes.length} entities)`}
        style={{
          position: "fixed", right: 0, top: "50%", transform: "translateY(-50%)", zIndex: 60,
          display: "flex", alignItems: "center", gap: 6, padding: "8px 6px",
          border: "1px solid var(--line-strong)", borderRight: "none", borderRadius: "10px 0 0 10px",
          background: "var(--bg-primary)", color: "var(--text-secondary)", cursor: "pointer",
          font: "700 10.5px var(--font-ui)", writingMode: "vertical-rl", boxShadow: "var(--shadow-sm)",
        }}
      >
        <Share2 size={12} /> Live graph · {snap.nodes.length}
      </button>
    );
  }

  return (
    <aside
      role="complementary"
      aria-label="Live session graph"
      data-testid="live-graph-rail"
      data-entities={snap.nodes.length}
      data-edges={snap.edges.length}
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: "min(420px, 92vw)", zIndex: 60,
        display: "flex", flexDirection: "column", background: "var(--bg-primary)",
        borderLeft: "1px solid var(--line-strong)", boxShadow: "var(--shadow-lg)",
      }}
    >
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "var(--space-3)", borderBottom: "1px solid var(--line)" }}>
        <Share2 size={13} style={{ color: "var(--text-muted)" }} />
        <span style={{ font: "700 13px var(--font-ui)", color: "var(--text-primary)" }}>Live session graph</span>
        <span style={{ font: "600 11px var(--font-ui)", color: "var(--text-tertiary)" }}>
          {snap.nodes.length} entities · {snap.edges.length} edges · {snap.turns} events
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          aria-label="Close live session graph"
          onClick={() => setOpen(false)}
          style={{ width: 26, height: 26, display: "grid", placeItems: "center", border: "none", borderRadius: 7, background: "transparent", color: "var(--text-muted)", cursor: "pointer" }}
        >
          <X size={14} />
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Suspense fallback={<div role="status" style={{ padding: "var(--space-4)", font: "500 12px var(--font-ui)", color: "var(--text-muted)" }}>Loading graph…</div>}>
          <NodeGraphCanvas nodes={snap.nodes} edges={snap.edges} visits={session.visitsById()} dark={dark} height={Math.max(320, window.innerHeight - 140)} />
        </Suspense>
      </div>
      <p style={{ flex: "none", margin: 0, padding: "var(--space-2) var(--space-3)", borderTop: "1px solid var(--line)", font: "500 11.5px/1.5 var(--font-ui)", color: "var(--text-muted)" }}>
        Built from real room events (trace log). Edges are interaction history; room events carry no
        measured counts, so entities read “unknown — not measured”. No curated assertion edges: the
        keyless demo path has no versioned source to receipt.
      </p>
    </aside>
  );
});
