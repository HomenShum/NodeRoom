import type { SemanticGraphEdge, SemanticGraphNode, SemanticGraphRef } from "./semanticGraphTypes";

export const GRAPH_AGENT_GOAL_MAX_CHARS = 1_900;

function refLabel(ref: SemanticGraphRef): string | null {
  const fields = [
    ref.artifactId ? `artifactId=${ref.artifactId}` : undefined,
    ref.artifactTitle ? `artifactTitle=${ref.artifactTitle.replace(/\s+/g, " ").trim().slice(0, 80)}` : undefined,
    ref.elementId ? `elementId=${ref.elementId}` : undefined,
    ref.rowId ? `rowId=${ref.rowId}` : undefined,
    ref.slideId ? `slideId=${ref.slideId}` : undefined,
    ref.claimId ? `claimId=${ref.claimId}` : undefined,
    ref.traceId ? `traceId=${ref.traceId}` : undefined,
  ].filter(Boolean);
  return fields.length ? fields.join(", ") : null;
}

export function formatGraphAgentNodeContext(node: SemanticGraphNode): string {
  const refs = node.refs.map(refLabel).filter((value): value is string => Boolean(value));
  return `${node.label} (${node.kind}, ${node.status})${refs.length ? `; refs: ${refs.slice(0, 4).join(" | ")}` : ""}`;
}

export function collectGraphAgentArtifactIds(nodes: SemanticGraphNode[], edge?: SemanticGraphEdge): string[] {
  return [...new Set([
    ...nodes.flatMap((node) => node.refs.map((ref) => ref.artifactId)),
    ...(edge?.refs.map((ref) => ref.artifactId) ?? []),
  ].filter((value): value is string => Boolean(value)))];
}

function boundedText(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > maxChars ? `${compact.slice(0, Math.max(0, maxChars - 3))}...` : compact;
}

export function buildBoundedGraphAgentGoal(input: {
  roomId: string;
  userPrompt: string;
  visibleNodes: number;
  visibleEdges: number;
  backedFacts: number;
  openQuestions: number;
  selectedNode?: SemanticGraphNode;
  selectedEdge?: SemanticGraphEdge;
  nearbyNodes: SemanticGraphNode[];
}): string {
  const contextNodes = [...(input.selectedNode ? [input.selectedNode] : []), ...input.nearbyNodes];
  const artifactIds = collectGraphAgentArtifactIds(contextNodes, input.selectedEdge)
    .slice(0, 8)
    .map((id) => boundedText(id, 80));
  const required = [
    "Graph-agent request from the NodeRoom entity graph.",
    `Room id: ${boundedText(input.roomId, 80)}`,
    `User prompt: ${boundedText(input.userPrompt, 360)}`,
    `Visible graph: ${input.visibleNodes} nodes, ${input.visibleEdges} links, ${input.backedFacts} source-backed facts, ${input.openQuestions} open questions.`,
    input.selectedNode ? `Selected node: ${boundedText(input.selectedNode.label, 160)} (${input.selectedNode.kind}, ${input.selectedNode.status}, id ${boundedText(input.selectedNode.id, 120)}).` : "",
    input.selectedEdge ? `Selected edge: ${boundedText(input.selectedEdge.label, 160)} (${input.selectedEdge.kind}, ${input.selectedEdge.status}, id ${boundedText(input.selectedEdge.id, 120)}).` : "",
    artifactIds.length
      ? `Exact artifact IDs available to tools: ${artifactIds.join(", ")}. Use only these IDs, or call list_artifacts first. Never derive an artifactId from a graph node id, label, row id, block id, slide id, or claim id.`
      : "No exact artifact ID is present in this graph slice. Call list_artifacts before any artifact read; never invent an artifactId from a graph label.",
    "Before reading several artifact IDs, call list_artifacts to map each ID to its kind. Use read_notebook only for artifacts reported as note/notebook; use sheet read tools for spreadsheet artifacts.",
    "Use live room artifacts, traces, proposals, and evidence. Preserve provenance. Treat needs_review, failed, and graph_inferred links as unverified.",
  ].filter(Boolean);
  let goal = required.join("\n\n");
  for (const node of input.nearbyNodes.slice(0, 8)) {
    const line = `- ${boundedText(formatGraphAgentNodeContext(node), 220)}`;
    const prefix = goal.includes("Nearby graph context:") ? "\n" : "\n\nNearby graph context:\n";
    if (goal.length + prefix.length + line.length > GRAPH_AGENT_GOAL_MAX_CHARS) break;
    goal += prefix + line;
  }
  return goal.slice(0, GRAPH_AGENT_GOAL_MAX_CHARS);
}
