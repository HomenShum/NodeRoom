/**
 * KnowledgeGraph — a freely-traversable, NotebookLM/Obsidian-style node-link view of a room.
 *
 * DERIVED, not stored (reads via useStore(), zero new Convex tables, works in memory mode):
 *   • Artifact nodes  — the room's sheets/notes/walls.
 *   • Entity nodes    — companies, people, events, projects, publications, achievements,
 *                       investments, sources, categories — all derived from sheet rows.
 *                       The Category column drives entity typing; other columns are scanned
 *                       by keyword regex for types not in Category. Deduped across sheets.
 *   • Edges           — artifact↔artifact "mentions", sheet→entity, entity→category,
 *                       entity→source, company→person, company→event, etc.
 *
 * Interaction: pan / zoom / scroll freely; CLICK a node to light up its connected neighbourhood
 * (multi-hop, the rest dims); click the canvas to reset; double-click an artifact node to open it.
 * Filter chips toggle visibility by kind; search dims non-matching nodes; backlinks panel shows
 * all references to the focused node; stats overlay shows counts + density.
 *
 * Design practices applied per Cambridge Intelligence's React graph visualization guide:
 *   - Structured node data (id, label, kind, degree, artifactId)
 *   - Color coding by group (kind-based palette)
 *   - Node sizing proportional to connection count
 *   - Filter chips for group visibility toggle
 *   - Search filter for text-based node matching
 *   - Backlinks panel for selected node context
 *   - Stats overlay (node/edge/density)
 *   - Legend for color mapping
 *
 * Layout: a clean LAYERED / multipartite layout — nodes are placed in columns by kind
 * (artifacts → categories → companies → people → attributes → sources), left-to-right, mirroring
 * the readable Trace · Flow view. This replaces the old force-directed layout, which produced an
 * unreadable "hairball" (per graph-viz best practice: hierarchical/layered layouts beat
 * force-directed for entity exploration and avoid clutter).
 *
 * Reuses @xyflow/react (already a dep via TraceFlow) — no new graph/force/layout dependency.
 */
import { useMemo, useState, type ReactElement } from "react";
import { ReactFlow, Background, Controls, MiniMap, Position, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Share2, Search, X } from "lucide-react";
import { useStore } from "../../app/store";
import type { Artifact as Art, DataframeColumn } from "../../engine/types";

const MAX_NODES = 200; // BOUND: keep the canvas legible + the O(n^2) layout cheap.
const MAX_SOURCES = 30; // BOUND: cap source nodes (URLs can proliferate).
const MAX_CATEGORIES = 15; // BOUND: cap category hub nodes.
const HOPS = 2; // how many layers out a node selection lights up

type GKind = "sheet" | "note" | "wall" | "company" | "person" | "event" | "project" | "publication" | "achievement" | "investment" | "source" | "category";
const KIND_COLOR: Record<string, string> = {
  sheet: "#6aa9ff", note: "#c0a0ff", wall: "#ffd16a",
  company: "#5fd0a0", person: "#ff9e6a", event: "#f0a040",
  project: "#60d0e0", publication: "#c060d0", achievement: "#ffd040",
  investment: "#e07060", source: "#888888", category: "#a0a0a0",
};
const KIND_LABEL: Record<string, string> = {
  sheet: "Sheet", note: "Note", wall: "Wall",
  company: "Company", person: "Person", event: "Event",
  project: "Project", publication: "Publication", achievement: "Achievement",
  investment: "Investment", source: "Source", category: "Category",
};
const ENTITY_KINDS: GKind[] = ["company", "person", "event", "project", "publication", "achievement", "investment", "source", "category"];
const colorOf = (k: string): string => KIND_COLOR[k] ?? "var(--accent-primary)";

// Layered layout: each kind sits in a column (left→right), like the Trace · Flow view. Empty
// layers are compacted out so the columns are always adjacent and the canvas stays tight.
const KIND_LAYER: Record<GKind, number> = {
  sheet: 0, note: 0, wall: 0, // artifacts (the room's own documents) anchor the left edge
  category: 1, // grouping hubs
  company: 2, // primary organizations
  person: 3, // people tied to organizations
  event: 4, project: 4, publication: 4, achievement: 4, investment: 4, // attributes / facts
  source: 5, // citations on the right edge
};

interface GNode { id: string; label: string; kind: GKind; artifactId?: string; sourceArtifact?: string; }
interface GEdgeInfo { source: string; target: string; sourceLabel: string; targetLabel: string; sourceKind: GKind; targetKind: GKind; }

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
const NAME_RE = /\b(company|account|name|organization|startup|entity)\b/i;
const PERSON_RE = /\b(owner|founder|ceo|contact|lead|partner|investor|personnel|person)\b/i;
const CATEGORY_RE = /\b(category|type|class|group|tag)\b/i;
const SOURCE_RE = /\b(source|url|link|citation|reference|ref)\b/i;
const EVENT_RE = /\b(event|conference|hackathon|demo|pitch|webinar|meetup|summit|talk|presentation)\b/i;
const PROJECT_RE = /\b(product|project|platform|app|tool|repo|repository|github)\b/i;
const ACHIEVEMENT_RE = /\b(award|achievement|recognition|grant|prize|honor)\b/i;
const FACTS_RE = /\b(key|facts|detail|description|summary|note|info)\b/i;
const distinctiveTokens = (title: string): string[] => Array.from(new Set(
  title.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 5 && !["sheet", "notes", "table", "about", "research", "graph"].includes(t)),
));

// Map Category column values to entity kinds.
const categoryToKind = (cat: string): GKind | null => {
  const c = cat.toLowerCase().trim();
  if (!c) return null;
  if (/\b(portfolio company|company|startup|fund)\b/.test(c)) return "company";
  if (/\b(key personnel|person|founder|ceo|owner|partner|investor|career|education|community)\b/.test(c)) return "person";
  if (/\b(event|conference|hackathon|demo|pitch|webinar|meetup|summit|talk)\b/.test(c)) return "event";
  if (/\b(product|project|platform|app|tool|repo|github)\b/.test(c)) return "project";
  if (/\b(publication|paper|academic|arxiv|book|blog|writing|press|media)\b/.test(c)) return "publication";
  if (/\b(award|achievement|recognition|grant|prize|honor)\b/.test(c)) return "achievement";
  if (/\b(investment|funding|series|round|valuation)\b/.test(c)) return "investment";
  if (/\b(ecosystem partner|partner|advisor|board)\b/.test(c)) return "company";
  if (/\b(competitor)\b/.test(c)) return "company";
  if (/\b(source|citation|reference)\b/.test(c)) return "source";
  return null;
};

// Extract URLs from a cell value.
const URL_RE = /https?:\/\/[^\s"'<>\])]+/gi;
const extractUrls = (text: string): string[] => {
  const matches = text.match(URL_RE);
  return matches ? matches.map((u) => u.replace(/[.,;:)]+$/, "")) : [];
};

// Extract funding/investment mentions from text.
const FUNDING_RE = /\$[\d.]+\s*[MBK](?:\s*(?:series\s*[a-d]|round|valuation|funding|raised))?/gi;
const extractFunding = (text: string): string[] => {
  const matches = text.match(FUNDING_RE);
  return matches ? [...new Set(matches.map((m) => m.trim()))] : [];
};

export function KnowledgeGraph({ roomId, onOpenArtifact }: { roomId: string; onOpenArtifact: (id: string) => void }): ReactElement {
  const store = useStore();
  const arts = store.listArtifacts(roomId);
  const [focus, setFocus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const sig = arts.map((a) => `${a.id}:${a.version}`).join("|");

  // ── Derive the graph (nodes + edges + force-laid-out positions) ──────────────────────────────
  const base = useMemo(() => {
    const gnodes = new Map<string, GNode>();
    const edgeSet = new Set<string>();
    const edgeList: Array<[string, string]> = [];
    const edgeInfoMap = new Map<string, GEdgeInfo>();
    const addEdge = (s: string, t: string) => {
      if (s === t) return;
      const k = `${s}->${t}`;
      if (edgeSet.has(k)) return;
      edgeSet.add(k); edgeList.push([s, t]);
      const sn = gnodes.get(s), tn = gnodes.get(t);
      if (sn && tn) edgeInfoMap.set(k, { source: s, target: t, sourceLabel: sn.label, targetLabel: tn.label, sourceKind: sn.kind, targetKind: tn.kind });
    };
    const entId = (kind: string, name: string) => `${kind}:${name.toLowerCase().replace(/\s+/g, "_")}`;
    let sourceCount = 0, categoryCount = 0;

    for (const a of arts) gnodes.set(a.id, { id: a.id, label: a.title, kind: (a.kind as GKind) ?? "note", artifactId: a.id });

    // Entity nodes from sheet rows — Category-driven typing + keyword scanning.
    for (const a of arts) {
      if (a.kind !== "sheet") continue;
      const cols = columnsOf(a);
      if (cols.length === 0) continue;
      const nameCol = cols.find((c) => NAME_RE.test(c.label) || NAME_RE.test(c.id)) ?? cols[0];
      const personCols = cols.filter((c) => PERSON_RE.test(c.label) || PERSON_RE.test(c.id));
      const catCol = cols.find((c) => CATEGORY_RE.test(c.label) || CATEGORY_RE.test(c.id));
      const sourceCol = cols.find((c) => SOURCE_RE.test(c.label) || SOURCE_RE.test(c.id));
      const eventCol = cols.find((c) => EVENT_RE.test(c.label) || EVENT_RE.test(c.id));
      const projectCol = cols.find((c) => PROJECT_RE.test(c.label) || PROJECT_RE.test(c.id));
      const achievementCol = cols.find((c) => ACHIEVEMENT_RE.test(c.label) || ACHIEVEMENT_RE.test(c.id));
      const factsCol = cols.find((c) => FACTS_RE.test(c.label) || FACTS_RE.test(c.id));

      for (const r of rowsOf(a)) {
        if (gnodes.size >= MAX_NODES) break;
        const name = cellText(a.elements[`${r}__${nameCol.id}`]?.value);
        if (!name || name.length < 2) continue;

        // Determine entity kind from Category column, fallback to "company".
        const catVal = catCol ? cellText(a.elements[`${r}__${catCol.id}`]?.value) : "";
        const kindFromCat = categoryToKind(catVal);
        const primaryKind: GKind = kindFromCat ?? "company";

        // Create the primary entity node.
        const eid = entId(primaryKind, name);
        if (!gnodes.has(eid)) gnodes.set(eid, { id: eid, label: name, kind: primaryKind, sourceArtifact: a.id });
        addEdge(a.id, eid);

        // Category hub node (if we have a Category column with a value).
        if (catVal && categoryCount < MAX_CATEGORIES) {
          const catNodeId = entId("category", catVal);
          if (!gnodes.has(catNodeId)) { gnodes.set(catNodeId, { id: catNodeId, label: catVal, kind: "category", sourceArtifact: a.id }); categoryCount++; }
          addEdge(eid, catNodeId);
        }

        // Person nodes from person columns.
        for (const pc of personCols) {
          if (gnodes.size >= MAX_NODES) break;
          const person = cellText(a.elements[`${r}__${pc.id}`]?.value);
          if (!person || person.length < 2) continue;
          const pid = entId("person", person);
          if (!gnodes.has(pid)) gnodes.set(pid, { id: pid, label: person, kind: "person", sourceArtifact: a.id });
          addEdge(eid, pid);
        }

        // Event nodes from event column (if the primary kind isn't already "event").
        if (eventCol && primaryKind !== "event") {
          const eventVal = cellText(a.elements[`${r}__${eventCol.id}`]?.value);
          if (eventVal && eventVal.length >= 3 && gnodes.size < MAX_NODES) {
            const evid = entId("event", eventVal);
            if (!gnodes.has(evid)) gnodes.set(evid, { id: evid, label: eventVal, kind: "event", sourceArtifact: a.id });
            addEdge(eid, evid);
          }
        }

        // Project nodes from project column.
        if (projectCol && primaryKind !== "project") {
          const projVal = cellText(a.elements[`${r}__${projectCol.id}`]?.value);
          if (projVal && projVal.length >= 3 && gnodes.size < MAX_NODES) {
            const pid2 = entId("project", projVal);
            if (!gnodes.has(pid2)) gnodes.set(pid2, { id: pid2, label: projVal, kind: "project", sourceArtifact: a.id });
            addEdge(eid, pid2);
          }
        }

        // Achievement nodes from achievement column.
        if (achievementCol && primaryKind !== "achievement") {
          const achVal = cellText(a.elements[`${r}__${achievementCol.id}`]?.value);
          if (achVal && achVal.length >= 3 && gnodes.size < MAX_NODES) {
            const aid = entId("achievement", achVal);
            if (!gnodes.has(aid)) gnodes.set(aid, { id: aid, label: achVal, kind: "achievement", sourceArtifact: a.id });
            addEdge(eid, aid);
          }
        }

        // Source nodes from source column URLs.
        if (sourceCol && sourceCount < MAX_SOURCES) {
          const srcVal = cellText(a.elements[`${r}__${sourceCol.id}`]?.value);
          const urls = extractUrls(srcVal);
          for (const url of urls) {
            if (sourceCount >= MAX_SOURCES) break;
            // Use domain as the label, full URL as the dedup key.
            let domain = url;
            try { domain = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
            const sid = entId("source", url);
            if (!gnodes.has(sid)) { gnodes.set(sid, { id: sid, label: domain, kind: "source", sourceArtifact: a.id }); sourceCount++; }
            addEdge(eid, sid);
          }
        }

        // Investment nodes from Key Facts column (scan for $ amounts).
        if (factsCol) {
          const factsVal = cellText(a.elements[`${r}__${factsCol.id}`]?.value);
          const fundings = extractFunding(factsVal);
          for (const fund of fundings) {
            if (gnodes.size >= MAX_NODES) break;
            const fid = entId("investment", fund);
            if (!gnodes.has(fid)) gnodes.set(fid, { id: fid, label: fund, kind: "investment", sourceArtifact: a.id });
            addEdge(eid, fid);
          }
        }
      }
    }

    // Artifact↔artifact "mentions" (distinctive title-token overlap) + note→entity mentions.
    const tokenMap = new Map<string, string[]>();
    for (const a of arts) tokenMap.set(a.id, distinctiveTokens(a.title));
    for (const a of arts) {
      const hay = artText(a);
      for (const b of arts) {
        if (a.id === b.id) continue;
        if ((tokenMap.get(b.id) ?? []).some((t) => new RegExp(`\\b${t}\\b`).test(hay))) addEdge(a.id, b.id);
      }
      for (const node of gnodes.values()) {
        if ((node.kind === "company" || node.kind === "person") && node.label.length >= 4 && hay.includes(node.label.toLowerCase())) addEdge(a.id, node.id);
      }
    }

    const ids = [...gnodes.keys()];
    const degree = new Map<string, number>();
    for (const [s, t] of edgeList) { degree.set(s, (degree.get(s) ?? 0) + 1); degree.set(t, (degree.get(t) ?? 0) + 1); }

    // ── Layered (multipartite) layout — columns by kind, like the Trace · Flow view ──────────────
    // Group ids by their kind's layer, compacting out empty layers so columns stay adjacent.
    const COL_W = 300, ROW_H = 66;
    const byLayer = new Map<number, string[]>();
    for (const id of ids) {
      const layer = KIND_LAYER[gnodes.get(id)!.kind] ?? 3;
      (byLayer.get(layer) ?? byLayer.set(layer, []).get(layer)!).push(id);
    }
    const presentLayers = [...byLayer.keys()].sort((x, y) => x - y);
    const pos = new Map<string, { x: number; y: number }>();
    presentLayers.forEach((layer, colIdx) => {
      const col = byLayer.get(layer)!;
      // Highest-degree (most connected) nodes first, then alphabetical — hubs sit near the top.
      col.sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || gnodes.get(a)!.label.localeCompare(gnodes.get(b)!.label));
      const count = col.length;
      col.forEach((id, row) => { pos.set(id, { x: colIdx * COL_W, y: (row - (count - 1) / 2) * ROW_H }); });
    });

    const adj = new Map<string, Set<string>>();
    for (const id of ids) adj.set(id, new Set());
    for (const [s, t] of edgeList) { adj.get(s)!.add(t); adj.get(t)!.add(s); }

    return { gnodes, edgeList, edgeInfoMap, pos, degree, adj };
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

  // ── Search match set ────────────────────────────────────────────────────────────────────────
  const searchMatches = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase().trim();
    const matches = new Set<string>();
    for (const nd of base.gnodes.values()) {
      if (nd.label.toLowerCase().includes(q)) matches.add(nd.id);
    }
    return matches;
  }, [search, base]);

  // ── Backlinks for the focused node ──────────────────────────────────────────────────────────
  const backlinks = useMemo(() => {
    if (!focus) return [];
    const result: Array<{ fromId: string; fromLabel: string; fromKind: GKind; edgeKey: string }> = [];
    for (const [key, info] of base.edgeInfoMap) {
      if (info.target === focus) result.push({ fromId: info.source, fromLabel: info.sourceLabel, fromKind: info.sourceKind, edgeKey: key });
      if (info.source === focus) result.push({ fromId: info.target, fromLabel: info.targetLabel, fromKind: info.targetKind, edgeKey: key });
    }
    return result.slice(0, 20);
  }, [focus, base]);

  // ── Kind counts for filter chips ────────────────────────────────────────────────────────────
  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const nd of base.gnodes.values()) counts.set(nd.kind, (counts.get(nd.kind) ?? 0) + 1);
    return counts;
  }, [base]);

  // ── Visible nodes (filter chips + search + focus) ───────────────────────────────────────────
  const nodes: Node[] = useMemo(() => [...base.gnodes.values()].filter((nd) => !hiddenKinds.has(nd.kind)).map((nd) => {
    const p = base.pos.get(nd.id) ?? { x: 0, y: 0 };
    const deg = base.degree.get(nd.id) ?? 0;
    const inFocus = !lit || lit.has(nd.id);
    const inSearch = !searchMatches || searchMatches.has(nd.id);
    const on = inFocus && inSearch;
    const isFocus = focus === nd.id;
    const dimmed = (lit && !inFocus) || (searchMatches && !inSearch);
    return {
      id: nd.id,
      position: p,
      data: { label: nd.label },
      draggable: false,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      style: {
        width: 168 + Math.min(deg, 6) * 12,
        padding: "9px 12px 9px 14px", borderRadius: 10,
        border: `1.5px solid ${isFocus ? colorOf(nd.kind) : "var(--line)"}`,
        background: "var(--bg-secondary)", color: "var(--text-primary)",
        fontSize: 12.5, fontWeight: 600, textAlign: "left" as const,
        lineHeight: 1.3, whiteSpace: "normal" as const, wordBreak: "break-word" as const,
        opacity: on ? 1 : dimmed ? 0.12 : 0.4,
        // Left accent via inset shadow (avoids mixing `border` shorthand with borderLeft* longhand).
        boxShadow: isFocus
          ? `inset 4px 0 0 0 ${colorOf(nd.kind)}, 0 0 0 4px color-mix(in srgb, ${colorOf(nd.kind)} 35%, transparent)`
          : `inset 4px 0 0 0 ${colorOf(nd.kind)}, var(--shadow-sm)`,
      },
    };
  }), [base, lit, focus, hiddenKinds, searchMatches]);

  const edges: Edge[] = useMemo(() => base.edgeList.filter(([s, t]) => {
    const sn = base.gnodes.get(s), tn = base.gnodes.get(t);
    return sn && tn && !hiddenKinds.has(sn.kind) && !hiddenKinds.has(tn.kind);
  }).map(([s, t]) => {
    const on = !lit || (lit.has(s) && lit.has(t));
    const inSearch = !searchMatches || (searchMatches.has(s) && searchMatches.has(t));
    const visible = on && inSearch;
    return { id: `${s}->${t}`, source: s, target: t, type: "smoothstep", style: { stroke: visible ? "var(--accent-primary)" : "var(--line)", strokeWidth: visible && lit ? 1.6 : 1, opacity: visible ? (lit ? 0.9 : 0.45) : 0.06 } };
  }), [base, lit, hiddenKinds, searchMatches]);

  // ── Stats ───────────────────────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const totalNodes = base.gnodes.size;
    const totalEdges = base.edgeList.length;
    const density = totalNodes > 1 ? (2 * totalEdges) / (totalNodes * (totalNodes - 1)) : 0;
    const visibleNodes = nodes.length;
    const visibleEdges = edges.length;
    return { totalNodes, totalEdges, density, visibleNodes, visibleEdges };
  }, [base, nodes, edges]);

  const toggleKind = (kind: string) => setHiddenKinds((prev) => {
    const next = new Set(prev);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    return next;
  });

  if (arts.length === 0) {
    return <div className="r-graphvu-empty" data-testid="knowledge-graph"><Share2 size={18} /> No artifacts yet — the graph fills in as the room gains spreadsheets, notes, and captures.</div>;
  }

  return (
    <div className="r-graphvu" data-testid="knowledge-graph">
      <div className="r-graphvu-head">
        <Share2 size={14} /> Knowledge graph
        <span className="r-graphvu-count">{stats.visibleNodes}{stats.visibleNodes !== stats.totalNodes ? `/${stats.totalNodes}` : ""} nodes · {stats.visibleEdges} links · density {stats.density.toFixed(2)}{focus ? " · click canvas to reset" : " · click a node to trace"}</span>
      </div>

      {/* Filter chips — toggle visibility by entity kind */}
      <div className="r-graphvu-filters">
        {ENTITY_KINDS.filter((k) => kindCounts.has(k)).map((k) => (
          <button key={k} className={`r-graphvu-chip${hiddenKinds.has(k) ? " r-graphvu-chip-off" : ""}`} onClick={() => toggleKind(k)} style={{ borderColor: colorOf(k) }} title={`${KIND_LABEL[k]} (${kindCounts.get(k) ?? 0}) — click to toggle`}>
            <span className="r-graphvu-chip-dot" style={{ background: hiddenKinds.has(k) ? "transparent" : colorOf(k), borderColor: colorOf(k) }} />
            {KIND_LABEL[k]} <span className="r-graphvu-chip-count">{kindCounts.get(k) ?? 0}</span>
          </button>
        ))}
      </div>

      {/* Search filter */}
      <div className="r-graphvu-search">
        <Search size={13} />
        <input type="text" placeholder="Filter nodes by name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {search && <button type="button" className="r-graphvu-search-clear" onClick={() => setSearch("")} aria-label="Clear search"><X size={12} /></button>}
      </div>

      <div className="r-graphvu-body">
        <div className="r-graphvu-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.1}
            maxZoom={1.75}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable
            onlyRenderVisibleElements
            colorMode="dark"
            onNodeClick={(_, node) => setFocus((cur) => (cur === node.id ? null : node.id))}
            onNodeDoubleClick={(_, node) => { const nd = base.gnodes.get(node.id); if (nd?.artifactId) onOpenArtifact(nd.artifactId); }}
            onPaneClick={() => setFocus(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeColor={(n) => colorOf(base.gnodes.get(n.id)?.kind ?? "")} nodeStrokeWidth={2} />
          </ReactFlow>
        </div>

        {/* Backlinks panel — shows all references to the focused node */}
        {focus && backlinks.length > 0 && (
          <div className="r-graphvu-backlinks" data-testid="graph-backlinks">
            <div className="r-graphvu-backlinks-head">
              Connections ({backlinks.length}{backlinks.length >= 20 ? "+" : ""})
            </div>
            <div className="r-graphvu-backlinks-list">
              {backlinks.map((bl) => (
                <button key={bl.edgeKey} className="r-graphvu-backlink" onClick={() => setFocus(bl.fromId)}>
                  <span className="r-graphvu-backlink-dot" style={{ background: colorOf(bl.fromKind) }} />
                  <span className="r-graphvu-backlink-label">{bl.fromLabel}</span>
                  <span className="r-graphvu-backlink-kind">{KIND_LABEL[bl.fromKind] ?? bl.fromKind}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
