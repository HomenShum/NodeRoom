import type {
  SemanticGraphConnectionPath,
  SemanticGraphEdge,
  SemanticGraphNode,
  SemanticGraphStatus,
  SemanticGraphViewModel,
} from "./semanticGraphTypes";

export interface RankSemanticConnectionPathsOptions {
  maxHops?: number;
  maxPaths?: number;
}

const STATUS_SCORE: Record<SemanticGraphStatus, number> = {
  source_backed: 18,
  graph_inferred: 10,
  manual: 8,
  running: 6,
  needs_review: 5,
  failed: 3,
  rejected: 2,
};

const KIND_SCORE: Record<string, number> = {
  company: 28,
  person: 22,
  agent_job: 20,
  deck: 19,
  deck_slide: 18,
  project: 18,
  achievement: 18,
  funding: 18,
  event: 16,
  evidence_fact: 16,
  deck_claim: 16,
  source: 16,
  notebook_block: 13,
  spreadsheet_row: 12,
  trace_step: 11,
  proposal: 10,
  open_question: 9,
  artifact: 5,
};

const EDGE_SCORE: Record<string, number> = {
  researched: 30,
  supported_by: 26,
  cited: 24,
  derived_from: 18,
  mentioned_in: 16,
  authored: 14,
  updated: 13,
  proposed: 12,
  approved: 12,
  rejected: 10,
  reviewed: 10,
  triggered: 9,
  belongs_to: 6,
  blocked: 5,
};

const STATUS_RANK: Record<SemanticGraphStatus, number> = {
  failed: 7,
  rejected: 6,
  needs_review: 5,
  running: 4,
  source_backed: 3,
  graph_inferred: 2,
  manual: 1,
};

function nodeById(graph: SemanticGraphViewModel): Map<string, SemanticGraphNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

function edgesByNode(graph: SemanticGraphViewModel): Map<string, SemanticGraphEdge[]> {
  const map = new Map<string, SemanticGraphEdge[]>();
  for (const node of graph.nodes) map.set(node.id, []);
  for (const edge of graph.edges) {
    map.get(edge.source)?.push(edge);
    map.get(edge.target)?.push(edge);
  }
  return map;
}

function strongestStatus(statuses: SemanticGraphStatus[]): SemanticGraphStatus {
  return statuses.sort((a, b) => STATUS_RANK[b] - STATUS_RANK[a])[0] ?? "manual";
}

function pathScore(nodes: SemanticGraphNode[], edges: SemanticGraphEdge[]): number {
  const edgeValue = edges.reduce((sum, edge) => sum + (EDGE_SCORE[edge.kind] ?? 4) + edge.weight, 0);
  const nodeValue = nodes.reduce((sum, node) => sum + (KIND_SCORE[node.kind] ?? 4) + STATUS_SCORE[node.status] + node.weight, 0);
  const evidenceBoost = nodes.some((node) => node.kind === "source" || node.kind === "evidence_fact") ? 20 : 0;
  const reviewBoost = nodes.some((node) => node.kind === "open_question" || node.status === "needs_review") ? 8 : 0;
  const lengthPenalty = Math.max(0, edges.length - 1) * 3;
  return nodeValue + edgeValue + evidenceBoost + reviewBoost - lengthPenalty;
}

function pathLabel(nodes: SemanticGraphNode[], edges: SemanticGraphEdge[]): string {
  if (nodes.length === 0) return "Path";
  const parts: string[] = [nodes[0].label];
  for (let index = 0; index < edges.length; index += 1) {
    const edge = edges[index];
    const node = nodes[index + 1];
    if (!node) continue;
    parts.push(edge.label, node.label);
  }
  const label = parts.join(" -> ");
  return label.length > 160 ? `${label.slice(0, 157).trim()}...` : label;
}

export function rankSemanticConnectionPaths(
  graph: SemanticGraphViewModel,
  selectedId: string | null | undefined,
  options: RankSemanticConnectionPathsOptions = {},
): SemanticGraphConnectionPath[] {
  if (!selectedId) return [];
  const nodes = nodeById(graph);
  if (!nodes.has(selectedId)) return [];
  const maxHops = Math.max(1, Math.min(options.maxHops ?? 3, 4));
  const maxPaths = Math.max(1, Math.min(options.maxPaths ?? 8, 16));
  const adjacency = edgesByNode(graph);
  const paths: SemanticGraphConnectionPath[] = [];
  const queue: Array<{ nodeId: string; nodeIds: string[]; edgeIds: string[] }> = [{ nodeId: selectedId, nodeIds: [selectedId], edgeIds: [] }];
  const edgeLookup = new Map(graph.edges.map((edge) => [edge.id, edge]));

  while (queue.length) {
    const current = queue.shift()!;
    if (current.edgeIds.length >= maxHops) continue;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const nextId = edge.source === current.nodeId ? edge.target : edge.source;
      if (current.nodeIds.includes(nextId)) continue;
      const nodeIds = [...current.nodeIds, nextId];
      const edgeIds = [...current.edgeIds, edge.id];
      const pathNodes = nodeIds.map((id) => nodes.get(id)).filter((node): node is SemanticGraphNode => Boolean(node));
      const pathEdges = edgeIds.map((id) => edgeLookup.get(id)).filter((item): item is SemanticGraphEdge => Boolean(item));
      const terminal = pathNodes[pathNodes.length - 1];
      if (terminal && terminal.kind !== "artifact") {
        const status = strongestStatus([...pathNodes.map((node) => node.status), ...pathEdges.map((item) => item.status)]);
        paths.push({
          id: edgeIds.join("|"),
          label: pathLabel(pathNodes, pathEdges),
          nodeIds,
          edgeIds,
          score: pathScore(pathNodes, pathEdges),
          status,
          refs: pathNodes.flatMap((node) => node.refs).concat(pathEdges.flatMap((item) => item.refs)).slice(0, 24),
        });
      }
      queue.push({ nodeId: nextId, nodeIds, edgeIds });
    }
  }

  const seen = new Set<string>();
  return paths
    .sort((a, b) => b.score - a.score || a.edgeIds.length - b.edgeIds.length || a.label.localeCompare(b.label))
    .filter((path) => {
      const signature = path.nodeIds.join(">");
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .slice(0, maxPaths);
}
