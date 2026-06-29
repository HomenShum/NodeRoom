/**
 * KnowledgeGraph — a freely-traversable, NotebookLM/Obsidian-style node-link view of a room.
 *
 * DERIVED, not stored (reads via useStore(), zero new Convex tables, works in memory mode):
 *   • Artifact nodes  — the room's sheets/notes/walls.
 *   • Entity nodes    — companies (each research-sheet row) + people (owner/founder/CEO cells),
 *                       DEDUPED across sheets so a shared company/person links artifacts (multi-hop).
 *   • Edges           — artifact↔artifact "mentions", sheet→company, company→person.
 *
 * Interaction: pan / zoom / scroll freely; CLICK a node to light up its connected neighbourhood
 * (multi-hop, the rest dims); click the canvas to reset; double-click an artifact node to open it.
 * Reuses @xyflow/react (already a dep via TraceFlow) with a small built-in force layout — no new
 * graph/force dependency.
 */
import { useMemo, useState, type ReactElement } from "react";
import { ReactFlow, Background, Controls, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Share2 } from "lucide-react";
import { useStore } from "../../app/store";
import type { Artifact as Art, DataframeColumn } from "../../engine/types";

const MAX_NODES = 140; // BOUND: keep the canvas legible + the O(n^2) layout cheap.
const HOPS = 2; // how many layers out a node selection lights up

type GKind = "sheet" | "note" | "wall" | "company" | "person";
const KIND_COLOR: Record<string, string> = {
  sheet: "#6aa9ff", note: "#c0a0ff", wall: "#ffd16a", company: "#5fd0a0", person: "#ff9e6a",
};
const colorOf = (k: string): string => KIND_COLOR[k] ?? "var(--accent-primary)";

interface GNode { id: string; label: string; kind: GKind; artifactId?: string; }

const cellText = (v: unknown): string => {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text.trim();
    if (typeof o.value === "string") return o.value.trim();
  }
  return "";
};

const artText = (art: Art): string => {
  const parts: string[] = [art.title];
  if (art.meta?.summary) parts.push(art.meta.summary);
  for (const el of Object.values(art.elements ?? {})) parts.push(cellText((el as { value?: unknown })?.value));
  return parts.join("\n").toLowerCase();
};

const rowsOf = (art: Art): string[] => [...new Set((art.order ?? []).map((e) => e.split("__")[0]).filter(Boolean))];
const columnsOf = (art: Art): DataframeColumn[] => (art.meta?.dataframe?.columns ?? []);
const NAME_RE = /\b(company|account|name|organization|startup)\b/i;
const PERSON_RE = /\b(owner|founder|ceo|contact|lead|partner|investor)\b/i;
const distinctiveTokens = (title: string): string[] => Array.from(new Set(
  title.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 5 && !["sheet", "notes", "table", "about"].includes(t)),
));

export function KnowledgeGraph({ roomId, onOpenArtifact }: { roomId: string; onOpenArtifact: (id: string) => void }): ReactElement {
  const store = useStore();
  const arts = store.listArtifacts(roomId);
  const [focus, setFocus] = useState<string | null>(null);
  const sig = arts.map((a) => `${a.id}:${a.version}`).join("|");

  // ── Derive the graph (nodes + edges + force-laid-out positions) ──────────────────────────────
  const base = useMemo(() => {
    const gnodes = new Map<string, GNode>();
    const edgeSet = new Set<string>();
    const edgeList: Array<[string, string]> = [];
    const addEdge = (s: string, t: string) => { const k = `${s}->${t}`; if (s !== t && !edgeSet.has(k)) { edgeSet.add(k); edgeList.push([s, t]); } };
    const entId = (kind: "company" | "person", name: string) => `${kind}:${name.toLowerCase()}`;

    for (const a of arts) gnodes.set(a.id, { id: a.id, label: a.title, kind: (a.kind as GKind) ?? "note", artifactId: a.id });

    // Entity nodes from sheet rows.
    for (const a of arts) {
      if (a.kind !== "sheet") continue;
      const cols = columnsOf(a);
      if (cols.length === 0) continue;
      const nameCol = cols.find((c) => NAME_RE.test(c.label) || NAME_RE.test(c.id)) ?? cols[0];
      const personCols = cols.filter((c) => PERSON_RE.test(c.label) || PERSON_RE.test(c.id));
      for (const r of rowsOf(a)) {
        const name = cellText(a.elements[`${r}__${nameCol.id}`]?.value);
        if (!name || name.length < 2 || gnodes.size >= MAX_NODES) continue;
        const cid = entId("company", name);
        if (!gnodes.has(cid)) gnodes.set(cid, { id: cid, label: name, kind: "company" });
        addEdge(a.id, cid);
        for (const pc of personCols) {
          const person = cellText(a.elements[`${r}__${pc.id}`]?.value);
          if (!person || person.length < 2 || gnodes.size >= MAX_NODES) continue;
          const pid = entId("person", person);
          if (!gnodes.has(pid)) gnodes.set(pid, { id: pid, label: person, kind: "person" });
          addEdge(cid, pid);
        }
      }
    }

    // Artifact↔artifact "mentions" (distinctive title-token overlap) + note→company mentions.
    const tokenMap = new Map<string, string[]>();
    for (const a of arts) tokenMap.set(a.id, distinctiveTokens(a.title));
    for (const a of arts) {
      const hay = artText(a);
      for (const b of arts) {
        if (a.id === b.id) continue;
        if ((tokenMap.get(b.id) ?? []).some((t) => new RegExp(`\\b${t}\\b`).test(hay))) addEdge(a.id, b.id);
      }
      for (const node of gnodes.values()) {
        if (node.kind === "company" && node.label.length >= 4 && hay.includes(node.label.toLowerCase())) addEdge(a.id, node.id);
      }
    }

    const ids = [...gnodes.keys()];
    const degree = new Map<string, number>();
    for (const [s, t] of edgeList) { degree.set(s, (degree.get(s) ?? 0) + 1); degree.set(t, (degree.get(t) ?? 0) + 1); }

    // Small Fruchterman-Reingold-style force layout (deterministic: circle seed, no RNG).
    const pos = new Map<string, { x: number; y: number }>();
    const n = ids.length || 1;
    ids.forEach((id, i) => { const ang = (i / n) * Math.PI * 2; pos.set(id, { x: Math.cos(ang) * 260, y: Math.sin(ang) * 260 }); });
    const ITER = n > 1 ? 320 : 0;
    for (let it = 0; it < ITER; it++) {
      const disp = new Map(ids.map((id) => [id, { x: 0, y: 0 }]));
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const a = pos.get(ids[i])!, b = pos.get(ids[j])!;
        const dx = a.x - b.x, dy = a.y - b.y; const d2 = Math.max(dx * dx + dy * dy, 0.01); const f = 9000 / d2;
        const da = disp.get(ids[i])!, db = disp.get(ids[j])!; da.x += dx * f; da.y += dy * f; db.x -= dx * f; db.y -= dy * f;
      }
      for (const [s, t] of edgeList) {
        const a = pos.get(s), b = pos.get(t); if (!a || !b) continue;
        const dx = a.x - b.x, dy = a.y - b.y; const f = 0.012;
        const da = disp.get(s)!, db = disp.get(t)!; da.x -= dx * f; da.y -= dy * f; db.x += dx * f; db.y += dy * f;
      }
      const cool = 1 - it / ITER;
      for (const id of ids) { const dp = disp.get(id)!; const len = Math.max(Math.hypot(dp.x, dp.y), 0.01); const step = Math.min(len, 34 * cool); const p = pos.get(id)!; p.x += (dp.x / len) * step; p.y += (dp.y / len) * step; }
    }

    const adj = new Map<string, Set<string>>();
    for (const id of ids) adj.set(id, new Set());
    for (const [s, t] of edgeList) { adj.get(s)!.add(t); adj.get(t)!.add(s); }

    return { gnodes, edgeList, pos, degree, adj };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  // ── Focus: light up the selected node's neighbourhood out to HOPS layers ─────────────────────
  const lit = useMemo(() => {
    if (!focus || !base.adj.has(focus)) return null;
    const seen = new Set<string>([focus]); let frontier = [focus];
    for (let h = 0; h < HOPS; h++) {
      const next: string[] = [];
      for (const id of frontier) for (const nb of base.adj.get(id) ?? []) if (!seen.has(nb)) { seen.add(nb); next.push(nb); }
      frontier = next;
    }
    return seen;
  }, [focus, base]);

  const nodes: Node[] = useMemo(() => [...base.gnodes.values()].map((nd) => {
    const p = base.pos.get(nd.id) ?? { x: 0, y: 0 };
    const deg = base.degree.get(nd.id) ?? 0;
    const on = !lit || lit.has(nd.id);
    const isFocus = focus === nd.id;
    return {
      id: nd.id,
      position: p,
      data: { label: nd.label },
      draggable: false,
      style: {
        width: 120 + Math.min(deg, 6) * 14,
        padding: "7px 10px", borderRadius: 10,
        border: `${isFocus ? 2.5 : 1.5}px solid ${colorOf(nd.kind)}`,
        background: "var(--bg-secondary)", color: "var(--text-primary)",
        fontSize: 12, fontWeight: 600, textAlign: "center" as const,
        opacity: on ? 1 : 0.18,
        boxShadow: isFocus ? `0 0 0 4px color-mix(in srgb, ${colorOf(nd.kind)} 35%, transparent)` : "none",
      },
    };
  }), [base, lit, focus]);

  const edges: Edge[] = useMemo(() => base.edgeList.map(([s, t]) => {
    const on = !lit || (lit.has(s) && lit.has(t));
    return { id: `${s}->${t}`, source: s, target: t, style: { stroke: on ? "var(--accent-primary)" : "var(--line)", strokeWidth: on && lit ? 1.6 : 1, opacity: on ? (lit ? 0.9 : 0.5) : 0.08 } };
  }), [base, lit]);

  if (arts.length === 0) {
    return <div className="r-graphvu-empty" data-testid="knowledge-graph"><Share2 size={18} /> No artifacts yet — the graph fills in as the room gains spreadsheets, notes, and captures.</div>;
  }

  return (
    <div className="r-graphvu" data-testid="knowledge-graph">
      <div className="r-graphvu-head">
        <Share2 size={14} /> Knowledge graph
        <span className="r-graphvu-count">{nodes.length} nodes · {edges.length} links{focus ? " · click canvas to reset" : " · click a node to trace connections"}</span>
      </div>
      <div className="r-graphvu-canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          onNodeClick={(_, node) => setFocus((cur) => (cur === node.id ? null : node.id))}
          onNodeDoubleClick={(_, node) => { const nd = base.gnodes.get(node.id); if (nd?.artifactId) onOpenArtifact(nd.artifactId); }}
          onPaneClick={() => setFocus(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}
