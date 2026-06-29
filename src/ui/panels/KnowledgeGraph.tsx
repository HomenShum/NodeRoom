/**
 * KnowledgeGraph — a derived, client-side node-link view of a room's artifacts and how they
 * reference each other (NotebookLM / Obsidian-style). DERIVED, not stored: nodes are the room's
 * artifacts and edges are "mentions" — artifact A links to B when A's text contains B's title.
 * Reuses the @xyflow/react graph already used by TraceFlow (no new force-graph dependency), and
 * reads everything through `useStore()`, so it works in memory mode with zero new Convex tables.
 */
import { useMemo, type ReactElement } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Share2 } from "lucide-react";
import { useStore } from "../../app/store";
import type { Artifact as Art } from "../../engine/types";

const MAX_EDGES = 120; // BOUND: keep the canvas legible even in a busy room.

const KIND_COLOR: Record<string, string> = {
  sheet: "#6aa9ff",
  note: "#c0a0ff",
  wall: "#ffd16a",
};
const kindColor = (kind: string): string => KIND_COLOR[kind] ?? "var(--accent-primary)";

/** Flatten an artifact's title, summary, and element values into one lowercased haystack. */
function artifactText(art: Art): string {
  const parts: string[] = [art.title];
  if (art.meta?.summary) parts.push(art.meta.summary);
  for (const el of Object.values(art.elements ?? {})) {
    const v = (el as { value?: unknown } | undefined)?.value;
    if (typeof v === "string") parts.push(v);
    else if (typeof v === "number") parts.push(String(v));
    else if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (typeof o.text === "string") parts.push(o.text);
      if (typeof o.value === "string") parts.push(o.value);
    }
  }
  return parts.join("\n").toLowerCase();
}

export function KnowledgeGraph({ roomId, onOpenArtifact }: { roomId: string; onOpenArtifact: (id: string) => void }): ReactElement {
  const store = useStore();
  const arts = store.listArtifacts(roomId);
  // Stable signal so dragging a node doesn't reset on unrelated re-renders.
  const sig = arts.map((a) => `${a.id}:${a.version}:${a.title}`).join("|");

  const { nodes, edges } = useMemo(() => {
    const texts = new Map<string, string>();
    for (const a of arts) texts.set(a.id, artifactText(a));

    // Distinctive title tokens per artifact (>=5 chars) so a real cross-reference is caught even when
    // another artifact paraphrases the title ("the variance sheet" -> "Q3 variance"). Still grounded in
    // actual text overlap — no fabricated edges.
    const STOP = new Set(["sheet", "notes", "table", "panel", "about"]);
    const tokensOf = (title: string) => Array.from(new Set(
      title.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 5 && !STOP.has(t)),
    ));
    const tokenMap = new Map<string, string[]>();
    for (const a of arts) tokenMap.set(a.id, tokensOf(a.title));

    const edgeList: Edge[] = [];
    const degree = new Map<string, number>();
    outer: for (const a of arts) {
      const haystack = texts.get(a.id) ?? "";
      for (const b of arts) {
        if (a.id === b.id) continue;
        const tokens = tokenMap.get(b.id) ?? [];
        if (tokens.length === 0) continue;
        if (!tokens.some((t) => new RegExp(`\\b${t}\\b`).test(haystack))) continue;
        edgeList.push({
          id: `${a.id}->${b.id}`,
          source: a.id,
          target: b.id,
          style: { stroke: "var(--line-strong)", strokeWidth: 1 },
        });
        degree.set(a.id, (degree.get(a.id) ?? 0) + 1);
        degree.set(b.id, (degree.get(b.id) ?? 0) + 1);
        if (edgeList.length >= MAX_EDGES) break outer;
      }
    }

    const n = arts.length || 1;
    const cx = 340, cy = 260, R = Math.max(150, Math.min(280, n * 28));
    const nodeList: Node[] = arts.map((a, i) => {
      const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
      const deg = degree.get(a.id) ?? 0;
      const width = 140 + Math.min(deg, 6) * 12;
      const color = kindColor(a.kind);
      return {
        id: a.id,
        position: { x: cx + Math.cos(angle) * R, y: cy + Math.sin(angle) * R },
        data: { label: `${a.title}` },
        style: {
          width,
          padding: "8px 10px",
          borderRadius: 10,
          border: `1.5px solid ${color}`,
          background: "var(--bg-secondary)",
          color: "var(--text-primary)",
          fontSize: 12,
          fontWeight: 600,
          textAlign: "center" as const,
        },
      };
    });
    return { nodes: nodeList, edges: edgeList };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  if (arts.length === 0) {
    return (
      <div className="r-graphvu-empty" data-testid="knowledge-graph">
        <Share2 size={18} /> No artifacts yet — the graph fills in as the room gains spreadsheets, notes, and captures.
      </div>
    );
  }

  return (
    <div className="r-graphvu" data-testid="knowledge-graph">
      <div className="r-graphvu-head">
        <Share2 size={14} /> Knowledge graph
        <span className="r-graphvu-count">{nodes.length} artifacts · {edges.length} links</span>
      </div>
      <div className="r-graphvu-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, node) => onOpenArtifact(node.id)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
