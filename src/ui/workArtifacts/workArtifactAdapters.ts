import type { Artifact, CellEvidence, CellPayload, Element, Proposal, TraceEvent } from "../../engine/types";
import type { SemanticGraphViewModel } from "../graph/semanticGraphTypes";
import { buildNotebookArtifactStructure } from "./notebookStructure";
import {
  type DeckArtifactInput,
  type ExportArtifactInput,
  type WorkArtifactAction,
  type WorkArtifactReceipt,
  type WorkArtifactStatus,
  type WorkArtifactViewModel,
  workArtifactKindFromEngine,
  workArtifactStatusFromProposal,
} from "./workArtifactTypes";

type BuildWorkArtifactsInput = {
  artifacts?: Artifact[];
  proposals?: Proposal[];
  traces?: TraceEvent[];
  graph?: SemanticGraphViewModel;
  decks?: DeckArtifactInput[];
  exports?: ExportArtifactInput[];
};

const OPEN_ACTION: WorkArtifactAction = { id: "open", label: "Open" };
const COMMENT_ACTION: WorkArtifactAction = { id: "comment", label: "Comment" };
const ASK_ACTION: WorkArtifactAction = { id: "ask_nodeagent", label: "Ask NodeAgent" };
const TRACE_ACTION: WorkArtifactAction = { id: "view_trace", label: "View trace" };

function isCellPayload(value: unknown): value is CellPayload {
  return typeof value === "object" && value !== null && ("status" in value || "evidence" in value || "confidence" in value || "error" in value);
}

function evidenceFromValue(value: unknown): CellEvidence[] {
  return isCellPayload(value) && Array.isArray(value.evidence) ? value.evidence : [];
}

function statusFromValue(value: unknown): WorkArtifactStatus | null {
  if (!isCellPayload(value)) return null;
  if (value.status === "running") return "running";
  if (value.status === "failed" || value.error) return "failed";
  if (value.status === "needs_review" || value.status === "gap") return "needs_review";
  if (value.status === "complete") return "ready";
  if (value.status === "empty") return "empty";
  return null;
}

function elementText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isCellPayload(value)) return elementText(value.value);
  if (typeof value === "object" && value !== null && "text" in value && typeof value.text === "string") return value.text;
  return "";
}

function countUnresolvedElements(elements: Element[]): number {
  return elements.filter((element) => {
    const status = statusFromValue(element.value);
    if (status === "needs_review" || status === "failed") return true;
    return /\b(needs[_\s-]?review|todo|tbd|unknown|gap|missing source|unsupported)\b/i.test(elementText(element.value));
  }).length;
}

function rollupStatus(statuses: WorkArtifactStatus[], unresolvedCount: number, elementCount: number): WorkArtifactStatus {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("running")) return "running";
  if (unresolvedCount > 0 || statuses.includes("needs_review")) return "needs_review";
  if (elementCount === 0 || statuses.every((status) => status === "empty")) return "empty";
  return "ready";
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function artifactSummary(artifact: Artifact, evidenceCount: number, unresolvedCount: number): string {
  const elementCount = artifact.order.length || Object.keys(artifact.elements).length;
  const base = artifact.meta?.summary?.trim();
  if (base) return base;
  const noun = artifact.kind === "sheet" ? "cell" : artifact.kind === "note" ? "block" : "item";
  const parts = [`${elementCount} ${noun}${elementCount === 1 ? "" : "s"}`];
  if (evidenceCount > 0) parts.push(`${evidenceCount} evidence`);
  if (unresolvedCount > 0) parts.push(`${unresolvedCount} needs review`);
  return parts.join(" - ");
}

function proposalSummary(proposal: Proposal, artifact?: Artifact): string {
  const target = artifact ? artifact.title : proposal.artifactId;
  const review = proposal.review?.reason || proposal.review?.reviewerNote;
  return review ? `${target}: ${review}` : `${proposal.author.name} proposed ${proposal.op.kind} on ${proposal.op.elementId}`;
}

function emptyReceipt(overrides: Partial<WorkArtifactReceipt> = {}): WorkArtifactReceipt {
  return {
    traceIds: [],
    sourceIds: [],
    proposalIds: [],
    evidenceCount: 0,
    unresolvedCount: 0,
    ...overrides,
  };
}

export function mapEngineArtifactToWorkArtifact(artifact: Artifact, related?: { traces?: TraceEvent[]; proposals?: Proposal[] }): WorkArtifactViewModel {
  const elements = Object.values(artifact.elements);
  const notebook = artifact.kind === "note" ? buildNotebookArtifactStructure(artifact, related) : null;
  const evidence = elements.flatMap((element) => evidenceFromValue(element.value));
  const statuses = elements.map((element) => statusFromValue(element.value)).filter((status): status is WorkArtifactStatus => status !== null);
  const unresolvedCount = notebook ? notebook.needsReviewCount : countUnresolvedElements(elements);
  const relatedTraces = related?.traces?.filter((trace) => trace.refs?.artifactId === artifact.id) ?? [];
  const relatedProposals = related?.proposals?.filter((proposal) => proposal.artifactId === artifact.id) ?? [];
  const sourceIds = notebook?.sourceIds ?? unique(evidence.map((item) => item.sourceArtifactId ?? item.sourceStorageId ?? item.providerFileId ?? item.url ?? item.source));
  const receiptTraceIds = notebook?.traceIds ?? relatedTraces.map((trace) => trace.id);
  const receiptProposalIds = notebook?.proposalIds ?? relatedProposals.map((proposal) => proposal.id);
  const receiptEvidenceCount = notebook?.evidenceCount ?? evidence.length;

  return {
    id: `artifact:${artifact.id}`,
    roomId: artifact.roomId,
    kind: workArtifactKindFromEngine(artifact.kind),
    sourceKind: artifact.kind,
    title: artifact.title,
    summary: notebook?.summary ?? artifactSummary(artifact, evidence.length, unresolvedCount),
    status: notebook?.status ?? rollupStatus(statuses, unresolvedCount, elements.length),
    version: artifact.version,
    owner: artifact.createdBy,
    updatedAt: artifact.updatedAt,
    receipt: emptyReceipt({
      traceIds: receiptTraceIds,
      sourceIds,
      proposalIds: receiptProposalIds,
      evidenceCount: receiptEvidenceCount,
      unresolvedCount,
    }),
    refs: [
      { artifactId: artifact.id, label: artifact.title },
      ...(notebook?.sections.slice(0, 6).map((section) => ({ artifactId: artifact.id, elementId: section.id, label: section.title })) ?? []),
      ...relatedTraces.map((trace) => ({ artifactId: artifact.id, traceId: trace.id, label: trace.summary })),
      ...relatedProposals.map((proposal) => ({ artifactId: artifact.id, proposalId: proposal.id, label: proposal.op.elementId })),
    ],
    actions: [OPEN_ACTION, COMMENT_ACTION, ASK_ACTION, { id: "propose_patch", label: "Propose patch" }, TRACE_ACTION],
    meta: {
      elementCount: elements.length,
      visibility: artifact.visibility ?? "room",
      tags: artifact.meta?.tags?.join(", "),
      blockCount: notebook?.blockCount,
      sectionCount: notebook?.sectionCount,
      agentBlockCount: notebook?.agentBlockCount,
      humanBlockCount: notebook?.humanBlockCount,
      citationCount: notebook?.citationCount,
    },
  };
}

export function mapProposalToWorkArtifact(proposal: Proposal, artifact?: Artifact, relatedTraces: TraceEvent[] = []): WorkArtifactViewModel {
  const traceIds = relatedTraces
    .filter((trace) => trace.refs?.proposalId === proposal.id || trace.refs?.artifactId === proposal.artifactId)
    .map((trace) => trace.id);
  const status = workArtifactStatusFromProposal(proposal.status);
  const actions: WorkArtifactAction[] = status === "pending"
    ? [OPEN_ACTION, { id: "accept", label: "Accept", tone: "success" }, { id: "reject", label: "Reject", tone: "danger" }, TRACE_ACTION]
    : [OPEN_ACTION, TRACE_ACTION];

  return {
    id: `proposal:${proposal.id}`,
    roomId: proposal.roomId,
    kind: "proposal",
    sourceKind: "proposal",
    title: `Proposal: ${proposal.op.elementId}`,
    summary: proposalSummary(proposal, artifact),
    status,
    owner: proposal.author,
    createdAt: proposal.createdAt,
    updatedAt: proposal.resolvedAt ?? proposal.createdAt,
    receipt: emptyReceipt({
      traceIds,
      proposalIds: [proposal.id],
      unresolvedCount: status === "pending" ? 1 : 0,
    }),
    refs: [
      { artifactId: proposal.artifactId, proposalId: proposal.id, jobId: proposal.jobId, label: proposal.op.elementId },
      ...traceIds.map((traceId) => ({ artifactId: proposal.artifactId, proposalId: proposal.id, jobId: proposal.jobId, traceId })),
    ],
    actions,
    meta: {
      operation: proposal.op.kind,
      reviewKind: proposal.review?.kind,
      reviewStatus: proposal.review?.status,
      baseVersion: proposal.op.baseVersion,
      jobId: proposal.jobId,
    },
  };
}

export function mapTraceToWorkArtifact(trace: TraceEvent): WorkArtifactViewModel {
  const failed = /failed|blocked|denied|conflict/i.test(trace.type) || /failed|blocked|error/i.test(trace.summary);
  const needsReview = /proposal|proposed|review|conflict/i.test(trace.type);
  return {
    id: `trace:${trace.id}`,
    roomId: trace.roomId,
    kind: "trace",
    sourceKind: "trace_event",
    title: trace.summary,
    summary: trace.detail,
    status: failed ? "failed" : needsReview ? "needs_review" : "ready",
    owner: trace.actor,
    createdAt: trace.ts,
    updatedAt: trace.ts,
    receipt: emptyReceipt({
      traceIds: [trace.id],
      unresolvedCount: failed || needsReview ? 1 : 0,
    }),
    refs: [{ artifactId: trace.refs?.artifactId, elementId: trace.refs?.elementId, traceId: trace.id, label: trace.summary }],
    actions: [OPEN_ACTION, TRACE_ACTION],
    meta: {
      traceType: trace.type,
      elementId: trace.refs?.elementId,
    },
  };
}

export function mapSemanticGraphToWorkArtifact(roomId: string, graph: SemanticGraphViewModel): WorkArtifactViewModel {
  const unresolvedCount = graph.stats.openQuestions + graph.nodes.filter((node) => node.status === "needs_review" || node.status === "failed").length;
  const traceIds = unique(graph.nodes.flatMap((node) => node.refs.map((ref) => ref.traceId)));
  const proposalIds = unique(graph.nodes.flatMap((node) => node.refs.map((ref) => ref.proposalId)));
  const sourceIds = unique(graph.nodes.flatMap((node) => node.refs.map((ref) => ref.sourceUrl ?? ref.evidenceId ?? ref.artifactId)));

  return {
    id: `graph:${roomId}`,
    roomId,
    kind: "graph",
    sourceKind: "semantic_graph",
    title: "Proof graph",
    summary: `${graph.stats.nodes} nodes - ${graph.stats.edges} edges - ${graph.stats.backedFacts} backed facts`,
    status: unresolvedCount > 0 ? "needs_review" : "ready",
    receipt: emptyReceipt({
      traceIds,
      proposalIds,
      sourceIds,
      evidenceCount: graph.stats.backedFacts,
      unresolvedCount,
    }),
    refs: [
      ...traceIds.map((traceId) => ({ traceId, label: "Trace-linked graph node" })),
      ...proposalIds.map((proposalId) => ({ proposalId, label: "Proposal-linked graph node" })),
    ],
    actions: [OPEN_ACTION, COMMENT_ACTION, ASK_ACTION, TRACE_ACTION],
    meta: {
      nodes: graph.stats.nodes,
      edges: graph.stats.edges,
      companies: graph.stats.companies,
      people: graph.stats.people,
    },
  };
}

export function mapDeckArtifactToWorkArtifact(deck: DeckArtifactInput): WorkArtifactViewModel {
  const evidenceCount = deck.sections.reduce((sum, section) => sum + (section.evidenceCount ?? 0), 0);
  const unresolvedCount = deck.sections.reduce((sum, section) => sum + (section.unresolvedCount ?? 0), 0);
  const status = deck.status ?? (unresolvedCount > 0 || deck.storyboardStatus === "needs_review" ? "needs_review" : "ready");

  return {
    id: `deck:${deck.id}`,
    roomId: deck.roomId,
    kind: "deck",
    sourceKind: "deck_storyboard",
    title: deck.title,
    summary: `${deck.sections.length} storyboard section${deck.sections.length === 1 ? "" : "s"} - ${evidenceCount} evidence`,
    status,
    version: deck.version,
    owner: deck.owner,
    createdAt: deck.createdAt,
    updatedAt: deck.updatedAt,
    receipt: emptyReceipt({
      traceIds: deck.traceIds ?? [],
      sourceIds: deck.sourceIds ?? [],
      proposalIds: deck.proposalIds ?? [],
      evidenceCount,
      unresolvedCount,
    }),
    refs: deck.sections.map((section) => ({ elementId: section.id, label: section.title })),
    actions: [OPEN_ACTION, COMMENT_ACTION, ASK_ACTION, { id: "propose_patch", label: "Propose patch" }, { id: "export", label: "Export" }, TRACE_ACTION],
    meta: {
      storyboardStatus: deck.storyboardStatus,
      sectionCount: deck.sections.length,
    },
  };
}

export function mapExportToWorkArtifact(exportArtifact: ExportArtifactInput): WorkArtifactViewModel {
  return {
    id: `export:${exportArtifact.id}`,
    roomId: exportArtifact.roomId,
    kind: "export",
    sourceKind: "export_bundle",
    title: exportArtifact.title,
    summary: `${exportArtifact.format.toUpperCase()} export${exportArtifact.artifactCount ? ` - ${exportArtifact.artifactCount} artifacts` : ""}`,
    status: exportArtifact.status ?? "ready",
    createdAt: exportArtifact.createdAt,
    updatedAt: exportArtifact.updatedAt ?? exportArtifact.createdAt,
    receipt: emptyReceipt({
      traceIds: exportArtifact.traceIds ?? [],
      sourceIds: exportArtifact.sourceIds ?? [],
      proposalIds: exportArtifact.proposalIds ?? [],
      evidenceCount: exportArtifact.evidenceCount ?? 0,
      unresolvedCount: exportArtifact.unresolvedCount ?? 0,
    }),
    refs: [{ exportId: exportArtifact.id, label: exportArtifact.title }],
    actions: [OPEN_ACTION, { id: "export", label: "Download" }, TRACE_ACTION],
    meta: {
      format: exportArtifact.format,
      artifactCount: exportArtifact.artifactCount,
    },
  };
}

export function buildWorkArtifacts(input: BuildWorkArtifactsInput): WorkArtifactViewModel[] {
  const artifacts = input.artifacts ?? [];
  const proposals = input.proposals ?? [];
  const traces = input.traces ?? [];
  const byArtifactId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));

  return [
    ...artifacts.map((artifact) => mapEngineArtifactToWorkArtifact(artifact, { traces, proposals })),
    ...(input.graph ? [mapSemanticGraphToWorkArtifact(input.graph.generatedFrom.fallbackDemo ? "room" : artifacts[0]?.roomId ?? "room", input.graph)] : []),
    ...(input.decks ?? []).map(mapDeckArtifactToWorkArtifact),
    ...proposals.map((proposal) => mapProposalToWorkArtifact(proposal, byArtifactId.get(proposal.artifactId), traces)),
    ...traces.map(mapTraceToWorkArtifact),
    ...(input.exports ?? []).map(mapExportToWorkArtifact),
  ];
}
