import type {
  SemanticGraphEdge,
  SemanticGraphFilters,
  SemanticGraphNode,
  SemanticGraphViewModel,
} from "./semanticGraphTypes";

const matchesQuery = (node: SemanticGraphNode, query: string): boolean => {
  const q = query.toLowerCase();
  return (
    node.label.toLowerCase().includes(q) ||
    (node.subtitle ?? "").toLowerCase().includes(q) ||
    node.refs.some((ref) => (
      (ref.artifactTitle ?? "").toLowerCase().includes(q) ||
      (ref.label ?? "").toLowerCase().includes(q) ||
      (ref.sourceUrl ?? "").toLowerCase().includes(q)
    ))
  );
};

const isAgentNode = (node: SemanticGraphNode): boolean => node.kind === "agent_job" || node.kind === "trace_step" || node.kind === "proposal" || node.actor?.kind === "agent";
const isHumanNode = (node: SemanticGraphNode): boolean => node.actor?.kind === "user" || node.kind === "person" || node.status === "manual";
const isEvidenceNode = (node: SemanticGraphNode): boolean => node.status === "source_backed" || node.kind === "source" || node.kind === "evidence_fact";

const nodeAllowed = (node: SemanticGraphNode, filters: SemanticGraphFilters): boolean => {
  if (filters.query?.trim() && !matchesQuery(node, filters.query.trim())) return false;
  if (filters.nodeKinds && !filters.nodeKinds.has(node.kind)) return false;
  if (filters.statuses && !filters.statuses.has(node.status)) return false;
  if (filters.evidenceBackedOnly && !isEvidenceNode(node)) return false;
  if (filters.agentActionsOnly && !isAgentNode(node)) return false;
  if (filters.humanEditsOnly && !isHumanNode(node)) return false;
  return true;
};

const edgeAllowed = (edge: SemanticGraphEdge, filters: SemanticGraphFilters): boolean => {
  if (filters.edgeKinds && !filters.edgeKinds.has(edge.kind)) return false;
  if (filters.statuses && !filters.statuses.has(edge.status)) return false;
  if (filters.evidenceBackedOnly && edge.status !== "source_backed") return false;
  return true;
};

export function applySemanticGraphFilters(graph: SemanticGraphViewModel, filters: SemanticGraphFilters): SemanticGraphViewModel {
  const visibleNodeIds = new Set<string>();
  const query = filters.query?.trim();
  for (const node of graph.nodes) {
    if (nodeAllowed(node, filters)) visibleNodeIds.add(node.id);
  }

  if (query && query.length > 0) {
    for (const edge of graph.edges) {
      if (visibleNodeIds.has(edge.source)) visibleNodeIds.add(edge.target);
      if (visibleNodeIds.has(edge.target)) visibleNodeIds.add(edge.source);
    }
  }

  const nodes = graph.nodes.filter((node) => visibleNodeIds.has(node.id));
  const edges = graph.edges.filter((edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target) && edgeAllowed(edge, filters));
  const visibleEdgeIds = new Set(edges.map((edge) => edge.id));
  const clusters = graph.clusters
    .map((cluster) => ({
      ...cluster,
      nodeIds: cluster.nodeIds.filter((nodeId) => visibleNodeIds.has(nodeId)),
      edgeIds: cluster.edgeIds.filter((edgeId) => visibleEdgeIds.has(edgeId)),
    }))
    .filter((cluster) => cluster.nodeIds.length > 1);

  return {
    ...graph,
    nodes,
    edges,
    clusters,
    stats: {
      ...graph.stats,
      visibleNodes: nodes.length,
      visibleEdges: edges.length,
    },
  };
}
