import type { SemanticGraphCluster, SemanticGraphNode, SemanticGraphViewModel } from "./semanticGraphTypes";

export type SemanticGraphClusterSummary = {
  id: string;
  kind: SemanticGraphCluster["kind"];
  label: string;
  status: SemanticGraphCluster["status"];
  nodeCount: number;
  edgeCount: number;
  sourceBackedCount: number;
  needsReviewCount: number;
  relevanceScore: number;
};

export type SemanticGraphClusterSelectionOptions = {
  neighborDepth?: 0 | 1 | 2;
  maxNodes?: number;
};

export function summarizeSemanticGraphClusters(graph: SemanticGraphViewModel): SemanticGraphClusterSummary[] {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return graph.clusters.map((cluster) => {
    const nodes = cluster.nodeIds.map((nodeId) => nodeById.get(nodeId)).filter((node): node is SemanticGraphNode => Boolean(node));
    const sourceBackedCount = nodes.filter((node) => node.status === "source_backed").length;
    const needsReviewCount = nodes.filter((node) => node.status === "needs_review" || node.status === "failed" || node.kind === "open_question").length;
    const relevanceScore = nodes.reduce((sum, node) => sum + node.weight, 0) + sourceBackedCount * 4 + needsReviewCount * 3 + cluster.edgeIds.length;
    return {
      id: cluster.id,
      kind: cluster.kind,
      label: cluster.label,
      status: cluster.status,
      nodeCount: nodes.length,
      edgeCount: cluster.edgeIds.length,
      sourceBackedCount,
      needsReviewCount,
      relevanceScore,
    };
  }).filter((cluster) => cluster.nodeCount > 1)
    .sort((a, b) => b.relevanceScore - a.relevanceScore || b.nodeCount - a.nodeCount || a.label.localeCompare(b.label));
}

export function selectSemanticGraphCluster(graph: SemanticGraphViewModel, clusterId: string | null, options: SemanticGraphClusterSelectionOptions = {}): SemanticGraphViewModel {
  if (!clusterId) return graph;
  const cluster = graph.clusters.find((candidate) => candidate.id === clusterId);
  if (!cluster) return graph;
  const depth = options.neighborDepth ?? 0;
  const maxNodes = Math.max(cluster.nodeIds.length, Math.min(160, options.maxNodes ?? 80));
  const keep = new Set(cluster.nodeIds.filter((nodeId) => graph.nodes.some((node) => node.id === nodeId)));
  let frontier = new Set(keep);
  for (let level = 0; level < depth && keep.size < maxNodes; level += 1) {
    const next = new Set<string>();
    for (const edge of graph.edges) {
      if (frontier.has(edge.source) && !keep.has(edge.target)) next.add(edge.target);
      if (frontier.has(edge.target) && !keep.has(edge.source)) next.add(edge.source);
    }
    const ranked = [...next].map((nodeId) => graph.nodes.find((node) => node.id === nodeId)).filter((node): node is SemanticGraphNode => Boolean(node))
      .sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));
    frontier = new Set();
    for (const node of ranked) {
      if (keep.size >= maxNodes) break;
      keep.add(node.id);
      frontier.add(node.id);
    }
  }
  const nodes = graph.nodes.filter((node) => keep.has(node.id));
  const edges = graph.edges.filter((edge) => keep.has(edge.source) && keep.has(edge.target));
  const edgeIds = new Set(edges.map((edge) => edge.id));
  const clusters = graph.clusters.map((candidate) => ({
    ...candidate,
    nodeIds: candidate.nodeIds.filter((nodeId) => keep.has(nodeId)),
    edgeIds: candidate.edgeIds.filter((edgeId) => edgeIds.has(edgeId)),
  })).filter((candidate) => candidate.id === clusterId || candidate.nodeIds.length > 1);
  return {
    ...graph,
    nodes,
    edges,
    clusters,
    stats: { ...graph.stats, visibleNodes: nodes.length, visibleEdges: edges.length },
  };
}
