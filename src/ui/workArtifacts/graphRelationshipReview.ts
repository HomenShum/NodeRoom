import type { SemanticGraphEdge, SemanticGraphEdgeKind, SemanticGraphRef, SemanticGraphStatus, SemanticGraphViewModel } from "../graph/semanticGraphTypes";

export type GraphRelationshipReviewStatus = "confirmed" | "needs_confirmation";

export interface GraphRelationshipReviewItem {
  relationshipId: string;
  edgeId: string;
  edgeKind: SemanticGraphEdgeKind;
  graphStatus: SemanticGraphStatus;
  reviewStatus: GraphRelationshipReviewStatus;
  sourceNodeId: string;
  targetNodeId: string;
  sourceLabel: string;
  targetLabel: string;
  relationshipLabel: string;
  reason: string;
  confirmationText: string;
  sourceArtifactIds: string[];
  proposalIds: string[];
  traceIds: string[];
  evidenceIds: string[];
  sourceUrls: string[];
  refs: SemanticGraphRef[];
  weight: number;
}

export interface GraphRelationshipReviewPlan {
  reviewVersion: 1;
  graphId: string;
  nodeCount: number;
  edgeCount: number;
  relationshipCount: number;
  confirmedCount: number;
  needsConfirmationCount: number;
  sourceArtifactIds: string[];
  proposalIds: string[];
  traceIds: string[];
  evidenceIds: string[];
  sourceUrls: string[];
  integrityHash: string;
  items: GraphRelationshipReviewItem[];
}

function stableId(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 96) || "item";
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function uniqueRefs(refs: SemanticGraphRef[]): SemanticGraphRef[] {
  const seen = new Set<string>();
  const result: SemanticGraphRef[] = [];
  for (const ref of refs) {
    const key = JSON.stringify(ref);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ref);
  }
  return result;
}

function simpleHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function reviewStatus(edge: SemanticGraphEdge, refs: SemanticGraphRef[]): GraphRelationshipReviewStatus {
  if (edge.status === "needs_review" || edge.status === "failed" || edge.status === "rejected") return "needs_confirmation";
  if (edge.kind === "reviewed" || edge.kind === "proposed" || edge.kind === "blocked") return "needs_confirmation";
  if (edge.status === "source_backed" || edge.kind === "supported_by" || edge.kind === "cited") return "confirmed";
  if (edge.kind === "derived_from" && refs.some((ref) => ref.artifactId || ref.evidenceId || ref.traceId || ref.sourceUrl)) return "confirmed";
  return "needs_confirmation";
}

function reasonFor(status: GraphRelationshipReviewStatus, edge: SemanticGraphEdge): string {
  if (status === "confirmed") {
    if (edge.kind === "supported_by") return "The relationship is backed by a cited evidence node.";
    if (edge.kind === "derived_from") return "The relationship is derived from an existing source, artifact, trace, or receipt ref.";
    return "The graph relationship carries a source-backed status.";
  }
  if (edge.kind === "reviewed" || edge.kind === "proposed") return "A proposal or review edge still needs human confirmation.";
  if (edge.kind === "blocked") return "A blocker edge needs reviewer confirmation before it should be treated as resolved.";
  return "This inferred graph relationship is not source-backed yet.";
}

function confirmationText(status: GraphRelationshipReviewStatus, source: string, label: string, target: string): string {
  if (status === "confirmed") return `${source} ${label} ${target} is confirmed by the current graph refs.`;
  return `Confirm, reject, or source-back this relationship: ${source} ${label} ${target}.`;
}

function refsFromItem(edge: SemanticGraphEdge, graph: SemanticGraphViewModel): SemanticGraphRef[] {
  const source = graph.nodes.find((node) => node.id === edge.source);
  const target = graph.nodes.find((node) => node.id === edge.target);
  return uniqueRefs([...(source?.refs ?? []), ...(target?.refs ?? []), ...edge.refs]);
}

export function buildGraphRelationshipReviewPlan(graph: SemanticGraphViewModel, graphId = "semantic-graph"): GraphRelationshipReviewPlan {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const items = graph.edges
    .map((edge, index) => {
      const source = nodesById.get(edge.source);
      const target = nodesById.get(edge.target);
      if (!source || !target) return null;
      const refs = refsFromItem(edge, graph);
      const status = reviewStatus(edge, refs);
      const sourceLabel = source.label;
      const targetLabel = target.label;
      const item: GraphRelationshipReviewItem = {
        relationshipId: `rel-${index + 1}-${stableId(edge.id)}`,
        edgeId: edge.id,
        edgeKind: edge.kind,
        graphStatus: edge.status,
        reviewStatus: status,
        sourceNodeId: source.id,
        targetNodeId: target.id,
        sourceLabel,
        targetLabel,
        relationshipLabel: edge.label,
        reason: reasonFor(status, edge),
        confirmationText: confirmationText(status, sourceLabel, edge.label, targetLabel),
        sourceArtifactIds: unique(refs.map((ref) => ref.artifactId)),
        proposalIds: unique(refs.map((ref) => ref.proposalId)),
        traceIds: unique(refs.map((ref) => ref.traceId)),
        evidenceIds: unique(refs.map((ref) => ref.evidenceId)),
        sourceUrls: unique(refs.map((ref) => ref.sourceUrl)),
        refs,
        weight: edge.weight,
      };
      return item;
    })
    .filter((item): item is GraphRelationshipReviewItem => Boolean(item))
    .sort((a, b) => {
      const statusScore = (a.reviewStatus === "needs_confirmation" ? 0 : 1) - (b.reviewStatus === "needs_confirmation" ? 0 : 1);
      if (statusScore !== 0) return statusScore;
      if (b.weight !== a.weight) return b.weight - a.weight;
      return `${a.sourceLabel} ${a.relationshipLabel} ${a.targetLabel}`.localeCompare(`${b.sourceLabel} ${b.relationshipLabel} ${b.targetLabel}`);
    });

  const digest = items.map((item) => ({
    edgeId: item.edgeId,
    edgeKind: item.edgeKind,
    reviewStatus: item.reviewStatus,
    sourceNodeId: item.sourceNodeId,
    targetNodeId: item.targetNodeId,
    sourceArtifactIds: item.sourceArtifactIds,
    proposalIds: item.proposalIds,
    traceIds: item.traceIds,
    evidenceIds: item.evidenceIds,
    sourceUrls: item.sourceUrls,
  }));
  const integrityHash = simpleHash({
    graphId,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    digest,
  });

  return {
    reviewVersion: 1,
    graphId,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    relationshipCount: items.length,
    confirmedCount: items.filter((item) => item.reviewStatus === "confirmed").length,
    needsConfirmationCount: items.filter((item) => item.reviewStatus === "needs_confirmation").length,
    sourceArtifactIds: unique(items.flatMap((item) => item.sourceArtifactIds)),
    proposalIds: unique(items.flatMap((item) => item.proposalIds)),
    traceIds: unique(items.flatMap((item) => item.traceIds)),
    evidenceIds: unique(items.flatMap((item) => item.evidenceIds)),
    sourceUrls: unique(items.flatMap((item) => item.sourceUrls)),
    integrityHash,
    items,
  };
}

export function graphRelationshipReviewJson(plan: GraphRelationshipReviewPlan): string {
  return `${JSON.stringify(plan, null, 2)}\n`;
}

export function graphRelationshipReviewFileName(graphId: string, integrityHash: string): string {
  const slug = stableId(graphId).slice(0, 72) || "semantic-graph";
  return `${slug}-relationship-review-${integrityHash}.json`;
}

export function graphRelationshipReviewMimeType(): string {
  return "application/json;charset=utf-8";
}
