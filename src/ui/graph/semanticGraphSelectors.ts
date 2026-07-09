import type {
  SemanticGraphEdge,
  SemanticGraphNode,
  SemanticGraphSelection,
  SemanticGraphSelectionSection,
  SemanticGraphViewModel,
} from "./semanticGraphTypes";

const section = (
  id: string,
  label: string,
  nodes: SemanticGraphNode[],
  edges: SemanticGraphEdge[],
): SemanticGraphSelectionSection => ({
  id,
  label,
  nodes: nodes.slice(0, 24),
  edges: edges.slice(0, 24),
});

export function semanticGraphIndexes(graph: SemanticGraphViewModel): {
  nodeById: Map<string, SemanticGraphNode>;
  edgeById: Map<string, SemanticGraphEdge>;
  edgesByNode: Map<string, SemanticGraphEdge[]>;
} {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const edgesByNode = new Map<string, SemanticGraphEdge[]>();
  for (const node of graph.nodes) edgesByNode.set(node.id, []);
  for (const edge of graph.edges) {
    edgesByNode.get(edge.source)?.push(edge);
    edgesByNode.get(edge.target)?.push(edge);
  }
  return { nodeById, edgeById, edgesByNode };
}

export function selectSemanticNeighborhood(
  graph: SemanticGraphViewModel,
  selectedId: string | null | undefined,
  hops = 2,
): SemanticGraphSelection {
  const { nodeById, edgesByNode } = semanticGraphIndexes(graph);
  if (!selectedId || !nodeById.has(selectedId)) {
    return { nodeIds: new Set(), edgeIds: new Set(), sections: [] };
  }

  const selected = nodeById.get(selectedId);
  const nodeIds = new Set<string>([selectedId]);
  const edgeIds = new Set<string>();
  let frontier = [selectedId];
  for (let hop = 0; hop < hops; hop += 1) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const edge of edgesByNode.get(nodeId) ?? []) {
        edgeIds.add(edge.id);
        const otherId = edge.source === nodeId ? edge.target : edge.source;
        if (!nodeIds.has(otherId)) {
          nodeIds.add(otherId);
          next.push(otherId);
        }
      }
    }
    frontier = next;
  }

  const connectedEdges = [...edgeIds].map((edgeId) => graph.edges.find((edge) => edge.id === edgeId)).filter((edge): edge is SemanticGraphEdge => Boolean(edge));
  const connectedNodes = [...nodeIds].map((nodeId) => nodeById.get(nodeId)).filter((node): node is SemanticGraphNode => Boolean(node));
  const directEdges = edgesByNode.get(selectedId) ?? [];
  const directNodeIds = new Set(directEdges.flatMap((edge) => [edge.source, edge.target]).filter((nodeId) => nodeId !== selectedId));
  const directNodes = [...directNodeIds].map((nodeId) => nodeById.get(nodeId)).filter((node): node is SemanticGraphNode => Boolean(node));

  const sections = [
    section("researched-companies", "Researched Companies", directNodes.filter((node) => node.kind === "company"), directEdges.filter((edge) => edge.kind === "researched")),
    section("people-agents", "People And Agents", connectedNodes.filter((node) => node.kind === "person" || node.kind === "agent_job"), connectedEdges.filter((edge) => edge.kind === "authored" || edge.kind === "updated" || edge.kind === "triggered")),
    section("evidence-sources", "Evidence And Sources", connectedNodes.filter((node) => node.kind === "evidence_fact" || node.kind === "source"), connectedEdges.filter((edge) => edge.kind === "supported_by" || edge.kind === "cited")),
    section("rows-blocks", "Rows And Blocks", connectedNodes.filter((node) => node.kind === "spreadsheet_row" || node.kind === "notebook_block"), connectedEdges.filter((edge) => edge.kind === "belongs_to" || edge.kind === "mentioned_in")),
    section("trace-proposal", "Traces And Proposals", connectedNodes.filter((node) => node.kind === "trace_step" || node.kind === "proposal"), connectedEdges.filter((edge) => edge.kind === "proposed" || edge.kind === "approved" || edge.kind === "rejected" || edge.kind === "triggered")),
    section("open-questions", "Open Questions", connectedNodes.filter((node) => node.kind === "open_question"), connectedEdges.filter((edge) => edge.kind === "reviewed" || edge.kind === "blocked")),
    section("other-context", "Other Context", directNodes.filter((node) => !["company", "person", "agent_job", "evidence_fact", "source", "spreadsheet_row", "notebook_block", "trace_step", "proposal", "open_question"].includes(node.kind)), directEdges),
  ].filter((item) => item.nodes.length > 0);

  return { selected, nodeIds, edgeIds, sections };
}

export function selectSemanticEdge(graph: SemanticGraphViewModel, edgeIdValue: string | null | undefined): SemanticGraphSelection {
  const { nodeById, edgeById } = semanticGraphIndexes(graph);
  if (!edgeIdValue) return { nodeIds: new Set(), edgeIds: new Set(), sections: [] };
  const edge = edgeById.get(edgeIdValue);
  if (!edge) return { nodeIds: new Set(), edgeIds: new Set(), sections: [] };
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  const nodes = [source, target].filter((node): node is SemanticGraphNode => Boolean(node));
  return {
    selectedEdge: edge,
    nodeIds: new Set(nodes.map((node) => node.id)),
    edgeIds: new Set([edge.id]),
    sections: [section("edge-endpoints", edge.label, nodes, [edge])],
  };
}

export function semanticNodePrimaryAction(node: SemanticGraphNode): { label: string; artifactId?: string; elementId?: string; traceId?: string; proposalId?: string; sourceUrl?: string } | null {
  const ref = node.refs.find((item) => item.artifactId || item.traceId || item.proposalId || item.sourceUrl);
  if (!ref) return null;
  if (ref.artifactId) return { label: ref.elementId ? "Open referenced cell or block" : "Open artifact", artifactId: ref.artifactId, elementId: ref.elementId };
  if (ref.traceId) return { label: "Open trace", traceId: ref.traceId };
  if (ref.proposalId) return { label: "Open proposal", proposalId: ref.proposalId };
  if (ref.sourceUrl) return { label: "Open source", sourceUrl: ref.sourceUrl };
  return null;
}
