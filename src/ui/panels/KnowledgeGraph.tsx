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
import { memo, useCallback, useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";
import { ReactFlow, Background, Controls, MiniMap, Position, Handle, MarkerType, type Node, type Edge, type NodeChange, type NodeProps } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Bot, Send, Share2, Search, X, Users } from "lucide-react";
import { useStore } from "../../app/store";
import type { Artifact as Art, Actor, DataframeColumn } from "../../engine/types";
import { EntityGraphDetailPanel } from "../graph/EntityGraphDetailPanel";
import { buildSemanticGraph } from "../graph/semanticGraph";
import { applySemanticGraphFilters } from "../graph/semanticGraphFilters";
import { layoutSemanticGraph } from "../graph/semanticGraphLayout";
import { selectSemanticEdge, selectSemanticNeighborhood } from "../graph/semanticGraphSelectors";
import type { SemanticGraphEdge, SemanticGraphNode, SemanticGraphNodeKind, SemanticGraphStats } from "../graph/semanticGraphTypes";

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
  artifact: "#6aa9ff", spreadsheet_row: "#6aa9ff", notebook_block: "#c0a0ff",
  evidence_fact: "#ffd16a", funding: "#e07060", trace_step: "#60d0e0",
  proposal: "#c060d0", open_question: "#f0a040", agent_job: "#ff9e6a",
};
const KIND_LABEL: Record<string, string> = {
  sheet: "Sheet", note: "Note", wall: "Wall",
  company: "Company", person: "Person", event: "Event",
  project: "Project", publication: "Publication", achievement: "Achievement",
  investment: "Investment", source: "Source", category: "Category",
  artifact: "Artifact", spreadsheet_row: "Row", notebook_block: "Block",
  evidence_fact: "Evidence", funding: "Funding", trace_step: "Trace",
  proposal: "Proposal", open_question: "Question", agent_job: "Agent",
};
const ENTITY_KINDS: GKind[] = ["company", "person", "event", "project", "publication", "achievement", "investment", "source", "category"];
const SEMANTIC_ENTITY_KINDS: SemanticGraphNodeKind[] = ["company", "person", "project", "achievement", "funding", "event", "source", "evidence_fact", "artifact", "spreadsheet_row", "notebook_block", "trace_step", "proposal", "open_question", "agent_job"];
const colorOf = (k: string): string => KIND_COLOR[k] ?? "var(--accent-primary)";
const CLOUD_ENTITY_COLOR: Array<[RegExp, string]> = [
  [/^CardioNova$/i, "#6F7CF6"],
  [/^CardioNova diligence brief$/i, "#FFD16A"],
  [/^Q3 variance$/i, "#6AA9FF"],
  [/^NetSuite Q3 export$/i, "#FFD16A"],
  [/^OpEx reconciled$/i, "#AAB4C2"],
  [/^Published research$/i, "#6AA9FF"],
  [/^Patent portfolio$/i, "#A78BFA"],
  [/^Core product$/i, "#FFD16A"],
  [/^Clinical trial$/i, "#5FD0A0"],
  [/^Founder & CEO$/i, "#FF9E6A"],
  [/^Series A\b/i, "#FF9E6A"],
  [/^Meridian Health Ventures$/i, "#6F7CF6"],
  [/^PitchBook profile$/i, "#FFD16A"],
  [/^NodeRoom$/i, "#FF9E6A"],
  [/^Homen\b/i, "#FF9E6A"],
  [/^Priya\b/i, "#FF9E6A"],
];
const cloudEntityColor = (label: string, kind: string): string => CLOUD_ENTITY_COLOR.find(([pattern]) => pattern.test(label))?.[1] ?? colorOf(kind);

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

interface GNode { id: string; label: string; kind: GKind; artifactId?: string; sourceArtifact?: string; contributor?: Actor; }
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

// ── Custom node component (defined outside KnowledgeGraph for stable reference) ──────────────────
// React Flow requires nodeTypes to have a stable reference — defining inside the component
// creates a new object every render, causing re-initialization and breaking edges.
interface EntityNodeData {
  label: string;
  deg: number;
  isGap: boolean;
  isFocus: boolean;
  isRadial: boolean;
  kind: string;
  kindColor: string;
  presenceColor: string | null;
  opacity: number;
}
const GRAPH_HANDLES = [
  ["left", Position.Left],
  ["right", Position.Right],
  ["top", Position.Top],
  ["bottom", Position.Bottom],
] as const;
type GraphSide = (typeof GRAPH_HANDLES)[number][0];
type GraphPoint = { x: number; y: number };
const sideToward = (from: GraphPoint, to: GraphPoint): GraphSide => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
};
const oppositeSide = (side: GraphSide): GraphSide => {
  if (side === "left") return "right";
  if (side === "right") return "left";
  if (side === "top") return "bottom";
  return "top";
};
const EntityNode = memo(({ data }: NodeProps) => {
  const d = data as unknown as EntityNodeData;
  return (
    <div
      className={`r-graphvu-node${d.isFocus ? " r-graphvu-node-focus" : ""}${d.isGap ? " r-graphvu-node-gap" : ""}${d.isRadial ? " r-graphvu-node-radial" : ""}${d.presenceColor ? " r-graphvu-node-presence" : ""}`}
      style={{
        ["--kg-kind-color" as string]: d.kindColor,
        borderLeftColor: d.kindColor,
        opacity: d.opacity,
        boxShadow: d.isFocus
          ? `inset 4px 0 0 0 ${d.kindColor}, 0 0 0 4px color-mix(in srgb, ${d.kindColor} 35%, transparent)`
          : d.presenceColor
            ? `inset 4px 0 0 0 ${d.kindColor}, 0 0 0 2px ${d.presenceColor}`
            : `inset 4px 0 0 0 ${d.kindColor}, var(--shadow-sm)`,
      }}
    >
      {GRAPH_HANDLES.map(([id, position]) => (
        <Handle key={`target-${id}`} id={`target-${id}`} type="target" position={position} style={{ opacity: 0, pointerEvents: "none" }} />
      ))}
      <span className="r-graphvu-node-dot" aria-hidden="true" style={{ background: d.kindColor }} />
      <span className="r-graphvu-node-label">{d.label}</span>
      <span className="r-graphvu-node-meta">
        {d.presenceColor && <span className="r-graphvu-node-presence-dot" style={{ background: d.presenceColor }} title="Someone is viewing this" />}
        {d.deg > 0 && <span className="r-graphvu-node-deg">{d.deg}</span>}
      </span>
      {GRAPH_HANDLES.map(([id, position]) => (
        <Handle key={`source-${id}`} id={`source-${id}`} type="source" position={position} style={{ opacity: 0, pointerEvents: "none" }} />
      ))}
    </div>
  );
});
EntityNode.displayName = "EntityNode";

// ✅ Stable reference — defined outside the component so React Flow doesn't re-initialize.
const nodeTypes = { entity: EntityNode };

const GRAPH_AGENT_SUGGESTIONS = [
  "Explain the selected node's evidence and gaps.",
  "Who researched this company and what did they touch?",
  "Find review blockers around this relationship.",
];

interface GraphAgentPanelProps {
  selectedNode?: SemanticGraphNode;
  selectedEdge?: SemanticGraphEdge;
  stats: SemanticGraphStats;
  value: string;
  status: "idle" | "running" | "sent" | "error";
  message: string | null;
  onChange: (value: string) => void;
  onSubmit: (prompt: string) => void;
}

function GraphAgentPanel({ selectedNode, selectedEdge, stats, value, status, message, onChange, onSubmit }: GraphAgentPanelProps): ReactElement {
  const running = status === "running";
  const targetLabel = selectedNode?.label ?? selectedEdge?.label ?? "Current graph";
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSubmit(value);
  };

  return (
    <aside className="r-graphvu-agent" data-testid="graph-nodeagent-panel" aria-label="NodeAgent graph panel">
      <div className="r-graphvu-agent-head">
        <span><Bot size={13} /> NodeAgent</span>
        <strong>{running ? "working" : status === "sent" ? "sent" : "ready"}</strong>
      </div>
      <div className="r-graphvu-agent-context">
        <strong>{targetLabel}</strong>
        <span>{stats.visibleNodes ?? stats.nodes} nodes / {stats.visibleEdges ?? stats.edges} links</span>
      </div>
      <div className="r-graphvu-agent-suggestions">
        {GRAPH_AGENT_SUGGESTIONS.map((item) => (
          <button key={item} type="button" onClick={() => onSubmit(item)} disabled={running}>
            {item}
          </button>
        ))}
      </div>
      <form className="r-graphvu-agent-form" onSubmit={submit}>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ask about evidence, people, traces, or review gaps..."
          disabled={running}
          rows={3}
        />
        <button type="submit" disabled={running || !value.trim()} aria-label="Send graph request to NodeAgent">
          <Send size={14} />
        </button>
      </form>
      {message && <div className={`r-graphvu-agent-message r-graphvu-agent-message-${status}`}>{message}</div>}
    </aside>
  );
}

export function KnowledgeGraph({ roomId, onOpenArtifact }: { roomId: string; onOpenArtifact: (id: string) => void }): ReactElement {
  const store = useStore();
  const arts = store.listArtifacts(roomId);
  const members = store.listMembers(roomId);
  const traces = store.listTraces(roomId);
  const proposals = store.listProposals(roomId);
  const sessions = store.listSessions(roomId);
  const [focus, setFocus] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [semanticHiddenKinds, setSemanticHiddenKinds] = useState<Set<SemanticGraphNodeKind>>(new Set());
  const [semanticEvidenceOnly, setSemanticEvidenceOnly] = useState(false);
  const [semanticAgentOnly, setSemanticAgentOnly] = useState(false);
  const [semanticHumanOnly, setSemanticHumanOnly] = useState(false);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [view, setView] = useState<"mind" | "evidence" | "domain" | "runtime" | "entity">("entity");
  const [manualEntityPos, setManualEntityPos] = useState<Record<string, { x: number; y: number }>>({});
  const [graphAgentPrompt, setGraphAgentPrompt] = useState("");
  const [graphAgentStatus, setGraphAgentStatus] = useState<"idle" | "running" | "sent" | "error">("idle");
  const [graphAgentMessage, setGraphAgentMessage] = useState<string | null>(null);
  const sig = arts.map((a) => `${a.id}:${a.version}`).join("|");
  const traceSig = traces.map((t) => `${t.id}:${t.ts}:${t.type}`).join("|");
  const proposalSig = proposals.map((p) => `${p.id}:${p.status}:${p.createdAt}:${p.resolvedAt ?? ""}`).join("|");
  const sessionSig = sessions.map((s) => `${s.id}:${s.status}:${s.updatedAt}`).join("|");
  const memberSig = members.map((m) => `${m.id}:${m.name}:${m.lastSeenAt}`).join("|");

  const semanticGraph = useMemo(() => buildSemanticGraph({
    roomId,
    artifacts: arts,
    members,
    traces,
    proposals,
    sessions,
    maxRowsPerSheet: 160,
    maxEvidenceFacts: 260,
  }), [roomId, sig, traceSig, proposalSig, sessionSig, memberSig]);

  const semanticAllowedKinds = useMemo(() => new Set(SEMANTIC_ENTITY_KINDS.filter((kind) => !semanticHiddenKinds.has(kind))), [semanticHiddenKinds]);
  const semanticView = useMemo(() => applySemanticGraphFilters(semanticGraph, {
    query: view === "entity" ? search : undefined,
    nodeKinds: semanticAllowedKinds,
    evidenceBackedOnly: semanticEvidenceOnly,
    agentActionsOnly: semanticAgentOnly,
    humanEditsOnly: semanticHumanOnly,
  }), [semanticGraph, view, search, semanticAllowedKinds, semanticEvidenceOnly, semanticAgentOnly, semanticHumanOnly]);
  const semanticRenderGraph = useMemo(() => {
    const focusedCenter = focus ? semanticView.nodes.find((node) => node.id === focus) : undefined;
    const useDefaultSlice = view === "entity" &&
      !search.trim() &&
      !focusedCenter &&
      !selectedEdge &&
      semanticHiddenKinds.size === 0 &&
      !semanticEvidenceOnly &&
      !semanticAgentOnly &&
      !semanticHumanOnly;
    if (!useDefaultSlice && !focusedCenter) return semanticView;
    const center = focusedCenter ?? semanticView.nodes.find((node) => node.kind === "company" && /cardionova/i.test(node.label)) ??
      [...semanticView.nodes].filter((node) => node.kind === "company").sort((a, b) => b.weight - a.weight)[0];
    if (!center) return semanticView;
    const nodeById = new Map(semanticView.nodes.map((node) => [node.id, node]));
    const priority = (nodeIdValue: string) => {
      const node = nodeById.get(nodeIdValue);
      if (!node) return -1;
      let score = node.weight;
      if (/cardionova|maya|homen|priya|series|pitchbook|source|q3|notebook|memo|risk/i.test(node.label)) score += 20;
      if (node.kind === "person" || node.kind === "agent_job") score += 18;
      if (node.kind === "funding" || node.kind === "evidence_fact" || node.kind === "source") score += 16;
      if (node.kind === "artifact" || node.kind === "notebook_block") score += 12;
      if (node.kind === "open_question" || node.status === "needs_review") score += 10;
      if (node.kind === "spreadsheet_row") score += 4;
      return score;
    };
    const keep = new Set<string>([center.id]);
    const directEdges = semanticView.edges.filter((edge) => edge.source === center.id || edge.target === center.id)
      .sort((a, b) => {
        const ao = a.source === center.id ? a.target : a.source;
        const bo = b.source === center.id ? b.target : b.source;
        return priority(bo) - priority(ao);
      });
    const firstLimit = focusedCenter ? 34 : 18;
    const secondLimit = focusedCenter ? 38 : 24;
    for (const edge of directEdges) {
      if (keep.size >= firstLimit) break;
      keep.add(edge.source === center.id ? edge.target : edge.source);
    }
    for (const edge of directEdges.slice(0, 8)) {
      if (keep.size >= secondLimit) break;
      const anchor = edge.source === center.id ? edge.target : edge.source;
      for (const next of semanticView.edges.filter((candidate) => candidate.source === anchor || candidate.target === anchor).sort((a, b) => priority(b.source) + priority(b.target) - priority(a.source) - priority(a.target)).slice(0, 2)) {
        if (keep.size >= secondLimit) break;
        keep.add(next.source === anchor ? next.target : next.source);
      }
    }
    const nodes = semanticView.nodes.filter((node) => keep.has(node.id));
    const edges = semanticView.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target));
    const edgeIds = new Set(edges.map((edge) => edge.id));
    const clusters = semanticView.clusters.map((cluster) => ({
      ...cluster,
      nodeIds: cluster.nodeIds.filter((nodeIdValue) => keep.has(nodeIdValue)),
      edgeIds: cluster.edgeIds.filter((edgeIdValue) => edgeIds.has(edgeIdValue)),
    })).filter((cluster) => cluster.nodeIds.length > 1);
    return {
      ...semanticView,
      nodes,
      edges,
      clusters,
      stats: { ...semanticView.stats, visibleNodes: nodes.length, visibleEdges: edges.length },
    };
  }, [view, search, focus, selectedEdge, semanticHiddenKinds, semanticEvidenceOnly, semanticAgentOnly, semanticHumanOnly, semanticView]);
  const semanticNodeIds = useMemo(() => new Set(semanticRenderGraph.nodes.map((node) => node.id)), [semanticRenderGraph]);
  const semanticSelection = useMemo(() => (
    selectedEdge ? selectSemanticEdge(semanticRenderGraph, selectedEdge) : selectSemanticNeighborhood(semanticRenderGraph, semanticNodeIds.has(focus ?? "") ? focus : null, 2)
  ), [semanticRenderGraph, selectedEdge, focus, semanticNodeIds]);
  const askGraphAgent = useCallback(async (rawPrompt: string) => {
    const prompt = rawPrompt.trim();
    if (!prompt) return;
    const selectedNode = semanticSelection.selected;
    const selectedSemanticEdge = semanticSelection.selectedEdge;
    const selectedRef = selectedNode?.refs.find((ref) => ref.artifactId) ??
      selectedSemanticEdge?.refs.find((ref) => ref.artifactId) ??
      semanticSelection.sections.flatMap((section) => section.nodes).flatMap((node) => node.refs).find((ref) => ref.artifactId);
    const nearbyNodes = semanticSelection.sections
      .flatMap((section) => section.nodes.map((node) => `${section.label}: ${node.label} (${node.kind}, ${node.status})`))
      .slice(0, 10);
    const goal = [
      "Graph-agent request from the NodeRoom entity graph.",
      `Room id: ${roomId}`,
      `User prompt: ${prompt}`,
      `Visible graph: ${semanticRenderGraph.nodes.length} nodes, ${semanticRenderGraph.edges.length} links, ${semanticGraph.stats.backedFacts} source-backed facts, ${semanticGraph.stats.openQuestions} open questions.`,
      selectedNode ? `Selected node: ${selectedNode.label} (${selectedNode.kind}, ${selectedNode.status}, id ${selectedNode.id}).` : "",
      selectedSemanticEdge ? `Selected edge: ${selectedSemanticEdge.label} (${selectedSemanticEdge.kind}, ${selectedSemanticEdge.status}, id ${selectedSemanticEdge.id}).` : "",
      nearbyNodes.length ? `Nearby graph context:\n${nearbyNodes.map((item) => `- ${item}`).join("\n")}` : "",
      "Use the live room artifacts, traces, proposals, and evidence. Preserve provenance. Call out needs_review, failed, or graph_inferred links instead of treating them as source-backed facts.",
    ].filter(Boolean).join("\n\n");

    setGraphAgentStatus("running");
    setGraphAgentMessage(null);
    try {
      await store.askAgent({ goal, contextArtifactId: selectedRef?.artifactId });
      setGraphAgentPrompt("");
      setGraphAgentStatus("sent");
      setGraphAgentMessage("Sent to public NodeAgent. Watch Public chat and Room trace for the response and workpaper.");
    } catch (caught) {
      setGraphAgentStatus("error");
      setGraphAgentMessage(caught instanceof Error ? caught.message : String(caught));
    }
  }, [roomId, semanticGraph.stats.backedFacts, semanticGraph.stats.openQuestions, semanticRenderGraph.edges.length, semanticRenderGraph.nodes.length, semanticSelection, store]);
  const semanticLayout = useMemo(() => layoutSemanticGraph(semanticRenderGraph, { selectedId: semanticNodeIds.has(focus ?? "") ? focus : null }), [semanticRenderGraph, semanticNodeIds, focus]);
  const semanticDegree = useMemo(() => {
    const degree = new Map<string, number>();
    for (const node of semanticRenderGraph.nodes) degree.set(node.id, 0);
    for (const edge of semanticRenderGraph.edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
    }
    return degree;
  }, [semanticRenderGraph]);
  const semanticKindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const node of semanticGraph.nodes) counts.set(node.kind, (counts.get(node.kind) ?? 0) + 1);
    return counts;
  }, [semanticGraph]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setFocus(null);
      setSelectedEdge(null);
      setHoveredEdge(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Map actor id → member color for contributor badges.
  const memberColors = useMemo(() => {
    const m = new Map<string, string>();
    for (const mem of members) m.set(mem.id, mem.color);
    return m;
  }, [members]);

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

    for (const a of arts) gnodes.set(a.id, { id: a.id, label: a.title, kind: (a.kind as GKind) ?? "note", artifactId: a.id, contributor: a.createdBy });

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
        if (!gnodes.has(eid)) gnodes.set(eid, { id: eid, label: name, kind: primaryKind, sourceArtifact: a.id, contributor: a.createdBy });
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
    // Cloud entity graph concepts: derive the evidence-map nodes from the room's own text.
    // The full graph remains available in the other graph modes and under search/focus.
    const findNode = (kind: GKind, label: RegExp) =>
      [...gnodes.values()].find((node) => node.kind === kind && label.test(node.label))?.id;
    const ensureNode = (kind: GKind, label: string, sourceArtifact?: string) => {
      const existing = [...gnodes.values()].find((node) => node.kind === kind && node.label.toLowerCase() === label.toLowerCase());
      if (existing) return existing.id;
      const id = entId(kind, label);
      if (!gnodes.has(id)) gnodes.set(id, { id, label, kind, sourceArtifact });
      return id;
    };
    const allText = arts.map((a) => artText(a)).join("\n");
    const artifactByTitle = (re: RegExp) => arts.find((a) => re.test(a.title))?.id;
    const cardioId = findNode("company", /^CardioNova$/i);
    if (cardioId && /cardionova/.test(allText)) {
      const q3Id = artifactByTitle(/q3 variance/i);
      const notebookId = artifactByTitle(/capture notebook/i);
      const wallId = artifactByTitle(/risk|opportunity/i);
      const memoId = artifactByTitle(/diligence memo/i);
      const seriesId = /series\s*a|\$14m/i.test(allText) ? ensureNode("investment", "Series A · $14M", notebookId) : null;
      const meridianId = /meridian health ventures/i.test(allText) ? ensureNode("company", "Meridian Health Ventures", notebookId) : null;
      const founderId = /maya|founder|ceo/i.test(allText) ? ensureNode("person", "Founder & CEO", notebookId) : null;
      const productId = /product|triage|hospital/i.test(allText) ? ensureNode("project", "Core product", notebookId) : null;
      const clinicalId = /clinical|hospital|deployment/i.test(allText) ? ensureNode("event", "Clinical trial", notebookId) : null;
      const patentId = /hipaa|security|patent|ip/i.test(allText) ? ensureNode("achievement", "Patent portfolio", wallId ?? notebookId) : null;
      const publishedId = /research|source|citation|crunchbase/i.test(allText) ? ensureNode("publication", "Published research", notebookId) : null;
      const pitchbookId = /pitchbook/i.test(allText) ? ensureNode("source", "PitchBook profile", notebookId) : null;
      const netSuiteId = /netsuite/i.test(allText) ? ensureNode("source", "NetSuite Q3 export", q3Id) : null;
      const opExId = /opex/i.test(allText) ? ensureNode("achievement", "OpEx reconciled", q3Id) : null;
      const briefId = notebookId ? ensureNode("note", "CardioNova diligence brief", notebookId) : null;
      const nodeRoomId = ensureNode("project", "NodeRoom", memoId ?? notebookId);
      const homenId = findNode("person", /^Homen$/i);
      const priyaId = findNode("person", /^Priya$/i);

      addEdge(nodeRoomId, cardioId);
      if (briefId) { addEdge(briefId, cardioId); if (homenId) addEdge(homenId, briefId); if (priyaId) addEdge(priyaId, briefId); }
      if (q3Id) addEdge(q3Id, cardioId);
      if (seriesId) addEdge(cardioId, seriesId);
      if (seriesId && meridianId) addEdge(seriesId, meridianId);
      if (founderId) addEdge(cardioId, founderId);
      if (productId) addEdge(cardioId, productId);
      if (clinicalId) addEdge(cardioId, clinicalId);
      if (patentId) addEdge(cardioId, patentId);
      if (publishedId) addEdge(cardioId, publishedId);
      if (pitchbookId) addEdge(pitchbookId, cardioId);
      if (netSuiteId && q3Id) addEdge(netSuiteId, q3Id);
      if (opExId && q3Id) addEdge(q3Id, opExId);
    }

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
    const COL_W = 360, ROW_H = 78;
    const byLayer = new Map<number, string[]>();
    for (const id of ids) {
      const layer = KIND_LAYER[gnodes.get(id)!.kind] ?? 3;
      (byLayer.get(layer) ?? byLayer.set(layer, []).get(layer)!).push(id);
    }
    const presentLayers = [...byLayer.keys()].sort((x, y) => x - y);
    let pos = new Map<string, { x: number; y: number }>();
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

    // Cloud reference: radial entity map, not columns. Keep the derived graph,
    // but center it on the strongest company node so the canvas reads as a
    // diligence mind map instead of an inventory table.
    const center =
      ids.find((id) => gnodes.get(id)?.kind === "company" && /cardionova/i.test(gnodes.get(id)?.label ?? "")) ??
      ids.filter((id) => gnodes.get(id)?.kind === "company").sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))[0] ??
      ids.sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0))[0];
    const levels = new Map<string, number>();
    if (center) {
      levels.set(center, 0);
      let frontier = [center];
      for (let level = 1; level <= 3; level++) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const nb of adj.get(id) ?? []) {
            if (!levels.has(nb)) {
              levels.set(nb, level);
              next.push(nb);
            }
          }
        }
        frontier = next;
      }
    }
    for (const id of ids) if (!levels.has(id)) levels.set(id, 4);
    const byRing = new Map<number, string[]>();
    for (const id of ids) {
      const level = levels.get(id) ?? 4;
      (byRing.get(level) ?? byRing.set(level, []).get(level)!).push(id);
    }
    const ringRadius = [0, 155, 270, 385, 500];
    const radial = new Map<string, { x: number; y: number }>();
    for (const [level, ringIds] of [...byRing.entries()].sort((a, b) => a[0] - b[0])) {
      ringIds.sort((a, b) => (degree.get(b) ?? 0) - (degree.get(a) ?? 0) || gnodes.get(a)!.label.localeCompare(gnodes.get(b)!.label));
      const radius = ringRadius[Math.min(level, ringRadius.length - 1)];
      if (level === 0) {
        for (const id of ringIds) radial.set(id, { x: 0, y: 0 });
        continue;
      }
      const count = Math.max(1, ringIds.length);
      ringIds.forEach((id, index) => {
        const offset = level % 2 === 0 ? Math.PI / count : -Math.PI / 2;
        const angle = offset + (index / count) * Math.PI * 2;
        const stagger = count > 10 ? ((index % 2) * 42) : 0;
        radial.set(id, { x: Math.cos(angle) * (radius + stagger), y: Math.sin(angle) * (radius + stagger) });
      });
    }
    pos = radial;

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

  // ── Radial focus layout: when a node is focused, re-lay its neighborhood radially ──────────
  const radialPos = useMemo(() => {
    if (!focus || !lit) return null;
    const pos = new Map<string, { x: number; y: number }>();
    pos.set(focus, { x: 0, y: 0 });
    const direct = [...(base.adj.get(focus) ?? [])].filter((id) => lit.has(id));
    const R1 = 220, R2 = 440;
    direct.forEach((id, i) => {
      const angle = (i / direct.length) * Math.PI * 2 - Math.PI / 2;
      pos.set(id, { x: Math.cos(angle) * R1, y: Math.sin(angle) * R1 });
    });
    const outer = [...lit].filter((id) => id !== focus && !pos.has(id));
    outer.forEach((id, i) => {
      const angle = (i / Math.max(outer.length, 1)) * Math.PI * 2 - Math.PI / 2;
      pos.set(id, { x: Math.cos(angle) * R2, y: Math.sin(angle) * R2 });
    });
    return pos;
  }, [focus, lit, base]);

  // ── Live presence: which artifact nodes have someone viewing them ─────────────────────────────
  const presenceMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of arts) {
      const claims = store.listPresence(roomId, a.id);
      const humanClaim = claims.find((c) => c.actor.kind === "user");
      if (humanClaim) {
        const color = humanClaim.color ?? memberColors.get(humanClaim.actor.id) ?? "#5E6AD2";
        m.set(a.id, color);
      }
    }
    return m;
  }, [arts, store, roomId, memberColors]);

  // ── Kind counts for filter chips ────────────────────────────────────────────────────────────
  const kindCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const nd of base.gnodes.values()) counts.set(nd.kind, (counts.get(nd.kind) ?? 0) + 1);
    return counts;
  }, [base]);

  // ── Visible nodes (filter chips + search + focus) ───────────────────────────────────────────
  const entityDefaultIds = useMemo(() => {
    if (view !== "entity" || focus || searchMatches) return null;
    const center =
      [...base.gnodes.values()].find((nd) => nd.kind === "company" && /cardionova/i.test(nd.label)) ??
      [...base.gnodes.values()].filter((nd) => nd.kind === "company").sort((a, b) => (base.degree.get(b.id) ?? 0) - (base.degree.get(a.id) ?? 0))[0];
    if (!center) return null;
    const keep = new Set<string>([center.id]);
    const preferredLabels = [
      /^NodeRoom$/i,
      /^CardioNova$/i,
      /^Series A\b/i,
      /^Meridian Health Ventures$/i,
      /^Founder & CEO$/i,
      /^Core product$/i,
      /^Clinical trial$/i,
      /^Patent portfolio$/i,
      /^Published research$/i,
      /^CardioNova diligence brief$/i,
      /^PitchBook profile$/i,
      /^Q3 variance$/i,
      /^NetSuite Q3 export$/i,
      /^OpEx reconciled$/i,
      /^Homen$/i,
      /^Priya$/i,
    ];
    for (const label of preferredLabels) {
      const match = [...base.gnodes.values()].find((nd) => label.test(nd.label));
      if (match) keep.add(match.id);
    }
    if (keep.size >= 12) return keep;
    const priority = (id: string) => {
      const nd = base.gnodes.get(id);
      if (!nd) return -1;
      if (nd.artifactId && /q3 variance|diligence memo|capture notebook|company research|risk/i.test(nd.label)) return 10;
      if (nd.kind === "person") return 9;
      if (nd.kind === "investment" || /\$|series|meridian|pitchbook|netsuite|research|product|clinical|patent/i.test(nd.label)) return 8;
      if (nd.kind === "source") return 4;
      return base.degree.get(id) ?? 0;
    };
    const firstRing = [...(base.adj.get(center.id) ?? [])]
      .sort((a, b) => priority(b) - priority(a) || (base.gnodes.get(a)?.label ?? "").localeCompare(base.gnodes.get(b)?.label ?? ""))
      .slice(0, 12);
    for (const id of firstRing) keep.add(id);
    for (const id of firstRing.slice(0, 5)) {
      for (const next of [...(base.adj.get(id) ?? [])].sort((a, b) => priority(b) - priority(a)).slice(0, 2)) {
        if (keep.size >= 16) break;
        if (next !== center.id && priority(next) >= 5) keep.add(next);
      }
    }
    return keep;
  }, [view, focus, searchMatches, base]);

  const entityDefaultPos = useMemo(() => {
    if (view !== "entity" || focus || searchMatches || !entityDefaultIds) return null;
    const pos = new Map<string, { x: number; y: number }>();
    const byLabel = (label: RegExp) => [...base.gnodes.values()].find((nd) => entityDefaultIds.has(nd.id) && label.test(nd.label))?.id;
    const place = (label: RegExp, x: number, y: number) => {
      const id = byLabel(label);
      if (id) pos.set(id, { x, y });
    };
    place(/^CardioNova$/i, 0, 0);
    place(/^NodeRoom$/i, 235, -75);
    place(/^Series A\b/i, 260, 60);
    place(/^Meridian Health Ventures$/i, 92, 145);
    place(/^Founder & CEO$/i, 10, 284);
    place(/^Core product$/i, -105, 142);
    place(/^Clinical trial$/i, -200, 276);
    place(/^Patent portfolio$/i, -312, 132);
    place(/^Published research$/i, -225, 0);
    place(/^CardioNova diligence brief$/i, -45, -172);
    place(/^Q3 variance$/i, -205, -150);
    place(/^NetSuite Q3 export$/i, -395, -65);
    place(/^OpEx reconciled$/i, -402, -215);
    place(/^Homen$/i, -165, -308);
    place(/^Priya$/i, 85, -318);
    place(/^PitchBook profile$/i, 372, 215);
    return pos;
  }, [base, entityDefaultIds, focus, searchMatches, view]);

  const graphDragEnabled = view === "entity";
  const nodes: Node[] = useMemo(() => {
    if (view === "entity") {
      const hasSelection = !!selectedEdge || !!semanticSelection.selected;
      return semanticRenderGraph.nodes.map((nd) => {
        const p = manualEntityPos[nd.id] ?? semanticLayout.get(nd.id) ?? { x: 0, y: 0 };
        const deg = semanticDegree.get(nd.id) ?? 0;
        const on = !hasSelection || semanticSelection.nodeIds.has(nd.id);
        const isFocus = semanticSelection.selected?.id === nd.id;
        const isGap = nd.status === "needs_review" || nd.status === "failed" || nd.kind === "open_question";
        const artifactRef = nd.refs.find((ref) => ref.artifactId);
        const presenceColor = artifactRef?.artifactId ? (presenceMap.get(artifactRef.artifactId) ?? null) : null;
        const kindColor = colorOf(nd.kind);
        const rawLabel = nd.subtitle && (nd.kind === "person" || nd.kind === "agent_job") ? `${nd.label} - ${nd.subtitle}` : nd.label;
        const label = rawLabel.length > 42 ? `${rawLabel.slice(0, 39).trim()}...` : rawLabel;
        return {
          id: nd.id,
          position: p,
          type: "entity",
          data: {
            label,
            deg,
            isGap,
            isFocus,
            isRadial: true,
            kind: nd.kind,
            kindColor,
            presenceColor,
            opacity: on ? 1 : 0.13,
          } as unknown as Record<string, unknown>,
          draggable: graphDragEnabled,
          className: `r-graphvu-node${isFocus ? " r-graphvu-node-focus" : ""}${isGap ? " r-graphvu-node-gap" : ""} r-graphvu-node-radial${presenceColor ? " r-graphvu-node-presence" : ""}`,
          style: { width: Math.min(184, Math.max(92, label.length * 7 + 36)) },
        };
      });
    }
    const entityNodes: Node[] = [...base.gnodes.values()].filter((nd) => !hiddenKinds.has(nd.kind) && (!entityDefaultIds || entityDefaultIds.has(nd.id))).map((nd) => {
      const p = (manualEntityPos[nd.id] ?? entityDefaultPos?.get(nd.id) ?? radialPos?.get(nd.id) ?? base.pos.get(nd.id)) ?? { x: 0, y: 0 };
      const deg = base.degree.get(nd.id) ?? 0;
      const inFocus = !lit || lit.has(nd.id);
      const inSearch = !searchMatches || searchMatches.has(nd.id);
      const on = inFocus && inSearch;
      const isFocus = focus === nd.id;
      const dimmed = (lit && !inFocus) || (searchMatches && !inSearch);
      const isCloudEntityDefault = !!entityDefaultPos;
      const isGap = !isCloudEntityDefault && deg <= 1 && nd.kind !== "sheet" && nd.kind !== "note" && nd.kind !== "wall";
      let kindColor = colorOf(nd.kind);
      const presenceColor = nd.artifactId ? (presenceMap.get(nd.artifactId) ?? null) : null;
      const isRadial = !!radialPos || isCloudEntityDefault;
      const label = isCloudEntityDefault && /^Homen$/i.test(nd.label)
        ? "Homen · lead"
        : isCloudEntityDefault && /^Priya$/i.test(nd.label)
          ? "Priya · analyst"
          : nd.label;
      if (isCloudEntityDefault) kindColor = cloudEntityColor(label, nd.kind);
      return {
        id: nd.id,
        position: p,
        type: "entity",
        data: {
          label,
          deg,
          isGap,
          isFocus,
          isRadial,
          kind: nd.kind,
          kindColor,
          presenceColor,
          opacity: on ? 1 : dimmed ? 0.12 : 0.4,
        } as unknown as Record<string, unknown>,
        draggable: graphDragEnabled,
        className: `r-graphvu-node${isFocus ? " r-graphvu-node-focus" : ""}${isGap ? " r-graphvu-node-gap" : ""}${isRadial ? " r-graphvu-node-radial" : ""}${presenceColor ? " r-graphvu-node-presence" : ""}`,
        style: { width: 136 + Math.min(deg, 5) * 10 },
      };
    });
    return [...entityNodes];
  }, [view, selectedEdge, semanticSelection, semanticRenderGraph, manualEntityPos, semanticLayout, semanticDegree, presenceMap, graphDragEnabled, base, lit, focus, hiddenKinds, searchMatches, radialPos, entityDefaultPos, entityDefaultIds]);

  const nodePositionMap = useMemo(() => new Map(nodes.map((node) => [node.id, node.position])), [nodes]);

  const edges: Edge[] = useMemo(() => base.edgeList.filter(([s, t]) => {
    if (view === "entity") return false;
    const sn = base.gnodes.get(s), tn = base.gnodes.get(t);
    return sn && tn && !hiddenKinds.has(sn.kind) && !hiddenKinds.has(tn.kind) && (!entityDefaultIds || (entityDefaultIds.has(s) && entityDefaultIds.has(t)));
  }).map(([s, t]) => {
    const sn = base.gnodes.get(s)!, tn = base.gnodes.get(t)!;
    const on = !lit || (lit.has(s) && lit.has(t));
    const inSearch = !searchMatches || (searchMatches.has(s) && searchMatches.has(t));
    const visible = on && inSearch;
    const hovered = hoveredNode === s || hoveredNode === t;
    const opacity = view === "entity" ? (visible ? hovered ? 0.74 : 0.62 : 0.12) : visible
      ? lit ? (hovered ? 1 : 0.9)
      : hovered ? 0.75 : 0.45
      : 0.06;
    const strokeWidth = view === "entity" ? hovered ? 1.15 : 0.9 : visible && (lit || hovered) ? 1.8 : 1;
    const srcColor = colorOf(sn.kind);
    const tgtColor = colorOf(tn.kind);
    const stroke = view === "entity" ? "rgba(190,198,208,.52)" : visible && (lit || hovered) ? srcColor : "var(--line)";
    const sourcePosition = nodePositionMap.get(s);
    const targetPosition = nodePositionMap.get(t);
    const sourceSide = view === "entity" && sourcePosition && targetPosition ? sideToward(sourcePosition, targetPosition) : null;
    const targetSide = sourceSide ? oppositeSide(sourceSide) : null;
    return {
      id: `${s}->${t}`,
      source: s,
      target: t,
      sourceHandle: sourceSide ? `source-${sourceSide}` : undefined,
      targetHandle: targetSide ? `target-${targetSide}` : undefined,
      type: view === "entity" ? "straight" : "smoothstep",
      markerEnd: view === "entity" ? { type: MarkerType.ArrowClosed, width: 12, height: 12, color: stroke } : undefined,
      style: { stroke, strokeWidth, opacity },
      data: { srcColor, tgtColor },
    };
  }), [base, lit, hiddenKinds, searchMatches, hoveredNode, entityDefaultIds, nodePositionMap, view]);

  const semanticEdges: Edge[] = useMemo(() => {
    if (view !== "entity") return [];
    const nodeById = new Map(semanticRenderGraph.nodes.map((node) => [node.id, node]));
    const hasSelection = !!selectedEdge || !!semanticSelection.selected;
    return semanticRenderGraph.edges.filter((edge) => nodeById.has(edge.source) && nodeById.has(edge.target)).map((edge) => {
      const source = nodeById.get(edge.source)!;
      const target = nodeById.get(edge.target)!;
      const sourcePosition = nodePositionMap.get(edge.source);
      const targetPosition = nodePositionMap.get(edge.target);
      const sourceSide = sourcePosition && targetPosition ? sideToward(sourcePosition, targetPosition) : null;
      const targetSide = sourceSide ? oppositeSide(sourceSide) : null;
      const selected = selectedEdge === edge.id;
      const hovered = hoveredEdge === edge.id || hoveredNode === edge.source || hoveredNode === edge.target;
      const visible = !hasSelection || semanticSelection.edgeIds.has(edge.id);
      const stroke = edge.status === "needs_review" || edge.status === "failed" ? "rgba(240,160,64,.74)" : "rgba(190,198,208,.52)";
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: sourceSide ? `source-${sourceSide}` : undefined,
        targetHandle: targetSide ? `target-${targetSide}` : undefined,
        type: "straight",
        label: selected || hovered ? edge.label : undefined,
        labelStyle: { fill: "var(--text-secondary)", fontSize: 10, fontWeight: 700 },
        labelBgStyle: { fill: "var(--bg-secondary)", fillOpacity: 0.92 },
        labelBgPadding: [5, 3],
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: stroke },
        style: {
          stroke,
          strokeWidth: selected || hovered ? 1.4 : 0.9,
          opacity: visible ? (selected || hovered ? 0.94 : 0.62) : 0.1,
        },
        data: { srcColor: colorOf(source.kind), tgtColor: colorOf(target.kind) },
      };
    });
  }, [view, semanticRenderGraph, selectedEdge, semanticSelection, nodePositionMap, hoveredEdge, hoveredNode]);

  // ── Stats ───────────────────────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    if (view === "entity") {
      const totalNodes = semanticGraph.stats.nodes;
      const totalEdges = semanticGraph.stats.edges;
      const density = totalNodes > 1 ? (2 * totalEdges) / (totalNodes * (totalNodes - 1)) : 0;
      return {
        totalNodes,
        totalEdges,
        density,
        visibleNodes: semanticRenderGraph.nodes.length,
        visibleEdges: semanticRenderGraph.edges.length,
        gapCount: semanticRenderGraph.stats.openQuestions,
        contributorCount: semanticGraph.stats.people + semanticGraph.stats.traces,
      };
    }
    const totalNodes = base.gnodes.size;
    const totalEdges = base.edgeList.length;
    const density = totalNodes > 1 ? (2 * totalEdges) / (totalNodes * (totalNodes - 1)) : 0;
    const visibleNodes = nodes.length;
    const visibleEdges = edges.length;
    // Gap detection: entity nodes with 0-1 connections (under-researched).
    let gapCount = 0;
    for (const [id, nd] of base.gnodes) {
      if (nd.kind === "sheet" || nd.kind === "note" || nd.kind === "wall") continue;
      if ((base.degree.get(id) ?? 0) <= 1) gapCount++;
    }
    // Contributor counts: how many unique people created/researched nodes.
    const contributorIds = new Set<string>();
    for (const nd of base.gnodes.values()) { if (nd.contributor) contributorIds.add(nd.contributor.id); }
    return { totalNodes, totalEdges, density, visibleNodes, visibleEdges, gapCount, contributorCount: contributorIds.size };
  }, [view, semanticGraph, semanticRenderGraph, base, nodes, edges]);

  const toggleKind = (kind: string) => setHiddenKinds((prev) => {
    const next = new Set(prev);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    return next;
  });
  const toggleSemanticKind = (kind: SemanticGraphNodeKind) => setSemanticHiddenKinds((prev) => {
    const next = new Set(prev);
    if (next.has(kind)) next.delete(kind); else next.add(kind);
    return next;
  });

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    if (!graphDragEnabled) return;
    setManualEntityPos((prev) => {
      let next: Record<string, { x: number; y: number }> | null = null;
      for (const change of changes) {
        if (change.type !== "position" || !change.position) continue;
        if (!next) next = { ...prev };
        next[change.id] = { x: change.position.x, y: change.position.y };
      }
      return next ?? prev;
    });
  }, [graphDragEnabled]);

  if (arts.length === 0) {
    return <div className="r-graphvu-empty" data-testid="knowledge-graph"><Share2 size={18} /> No artifacts yet — the graph fills in as the room gains spreadsheets, notes, and captures.</div>;
  }

  return (
    <div className="r-graphvu" data-testid="knowledge-graph" data-mode={view}>
      <div className="r-graphvu-head">
        <Share2 size={14} /> Entity graph
        <span className="r-graphvu-count">{stats.visibleNodes}{stats.visibleNodes !== stats.totalNodes ? `/${stats.totalNodes}` : ""} nodes · {stats.visibleEdges} links · density {stats.density.toFixed(2)}{focus ? " · click canvas to reset" : " · click a node to trace"}</span>
        <span className="r-graphvu-team"><Users size={11} /> {stats.contributorCount} {stats.contributorCount === 1 ? "contributor" : "contributors"}{stats.gapCount > 0 ? ` · ${stats.gapCount} gaps` : ""}</span>
      </div>

      {/* Filter chips — toggle visibility by entity kind */}
      <div className="r-graphvu-modebar" role="tablist" aria-label="Entity graph views">
        {[
          ["mind", "Mind Map"],
          ["evidence", "Evidence"],
          ["domain", "Domain"],
          ["runtime", "Runtime"],
          ["entity", "Entity"],
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} data-on={String(view === id)} onClick={() => setView(id as typeof view)}>
            {label}
          </button>
        ))}
        <span className="grow" />
        <span className="r-graphvu-count">{stats.visibleNodes}{stats.visibleNodes !== stats.totalNodes ? `/${stats.totalNodes}` : ""} nodes · {stats.visibleEdges} links · density {stats.density.toFixed(2)}</span>
      </div>

      {view === "entity" && (
        <div className="r-graphvu-sembar" data-testid="entity-graph-semantic-controls">
          <div className="r-graphvu-semsearch">
            <Search size={13} />
            <input type="text" placeholder="Find entities, evidence, rows, traces..." value={search} onChange={(e) => setSearch(e.target.value)} />
            {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear entity graph search"><X size={12} /></button>}
          </div>
          <div className="r-graphvu-semchips">
            {SEMANTIC_ENTITY_KINDS.filter((kind) => semanticKindCounts.has(kind)).map((kind) => (
              <button key={kind} type="button" className={`r-graphvu-chip${semanticHiddenKinds.has(kind) ? " r-graphvu-chip-off" : ""}`} onClick={() => toggleSemanticKind(kind)} style={{ borderColor: colorOf(kind) }}>
                <span className="r-graphvu-chip-dot" style={{ background: semanticHiddenKinds.has(kind) ? "transparent" : colorOf(kind), borderColor: colorOf(kind) }} />
                {KIND_LABEL[kind] ?? kind} <span className="r-graphvu-chip-count">{semanticKindCounts.get(kind) ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="r-graphvu-semtoggles">
            <button type="button" data-on={String(semanticEvidenceOnly)} onClick={() => setSemanticEvidenceOnly((value) => !value)}>Evidence</button>
            <button type="button" data-on={String(semanticAgentOnly)} onClick={() => setSemanticAgentOnly((value) => !value)}>Agent</button>
            <button type="button" data-on={String(semanticHumanOnly)} onClick={() => setSemanticHumanOnly((value) => !value)}>Human</button>
          </div>
        </div>
      )}

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
            key={view === "entity" ? `entity-${search}-${focus ?? ""}-${selectedEdge ?? ""}-${semanticRenderGraph.nodes.length}-${semanticRenderGraph.edges.length}` : view}
            nodes={nodes}
            edges={view === "entity" ? semanticEdges : edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1.22 }}
            minZoom={0.1}
            maxZoom={1.75}
            nodesDraggable={graphDragEnabled}
            nodesConnectable={false}
            elementsSelectable
            onlyRenderVisibleElements
            onNodesChange={onNodesChange}
            colorMode="dark"
            nodeDragThreshold={3}
            autoPanOnNodeDrag
            selectNodesOnDrag={false}
            onNodeClick={(_, node) => { setSelectedEdge(null); setFocus((cur) => (cur === node.id ? null : node.id)); }}
            onNodeMouseEnter={(_, node) => setHoveredNode(node.id)}
            onNodeMouseLeave={() => setHoveredNode(null)}
            onEdgeMouseEnter={(_, edge) => setHoveredEdge(edge.id)}
            onEdgeMouseLeave={() => setHoveredEdge(null)}
            onEdgeClick={(_, edge) => { setFocus(null); setSelectedEdge((cur) => (cur === edge.id ? null : edge.id)); }}
            onNodeDoubleClick={(_, node) => {
              if (view === "entity") {
                const semanticNode = semanticRenderGraph.nodes.find((item) => item.id === node.id);
                const artifactRef = semanticNode?.refs.find((ref) => ref.artifactId);
                if (artifactRef?.artifactId) onOpenArtifact(artifactRef.artifactId);
                return;
              }
              const nd = base.gnodes.get(node.id);
              if (nd?.artifactId) onOpenArtifact(nd.artifactId);
            }}
            onPaneClick={() => { setFocus(null); setSelectedEdge(null); setHoveredNode(null); setHoveredEdge(null); }}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={16} />
            <Controls position="top-right" showInteractive={false} />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor={(node) => (typeof node.data.kindColor === "string" ? node.data.kindColor : "#64748b")}
              nodeStrokeWidth={2}
            />
          </ReactFlow>
        </div>

        {/* Backlinks panel — shows all references to the focused node */}
        {view === "entity" ? (
          <EntityGraphDetailPanel
            selection={semanticSelection}
            onClose={() => { setFocus(null); setSelectedEdge(null); }}
            onOpenArtifact={(artifactId) => onOpenArtifact(artifactId)}
          />
        ) : focus && backlinks.length > 0 && (
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
        {view === "entity" && (
          <GraphAgentPanel
            selectedNode={semanticSelection.selected}
            selectedEdge={semanticSelection.selectedEdge}
            stats={semanticRenderGraph.stats}
            value={graphAgentPrompt}
            status={graphAgentStatus}
            message={graphAgentMessage}
            onChange={setGraphAgentPrompt}
            onSubmit={(prompt) => { void askGraphAgent(prompt); }}
          />
        )}
      </div>
    </div>
  );
}
