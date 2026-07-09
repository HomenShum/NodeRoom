import type { Actor, AgentSession, Artifact, CellStatus, Member, Proposal, TraceEvent } from "../../engine/types";

export type SemanticGraphNodeKind =
  | "person"
  | "company"
  | "artifact"
  | "spreadsheet_row"
  | "notebook_block"
  | "source"
  | "evidence_fact"
  | "project"
  | "achievement"
  | "funding"
  | "event"
  | "trace_step"
  | "proposal"
  | "open_question"
  | "agent_job";

export type SemanticGraphEdgeKind =
  | "researched"
  | "authored"
  | "updated"
  | "mentioned_in"
  | "cited"
  | "supported_by"
  | "derived_from"
  | "proposed"
  | "approved"
  | "rejected"
  | "blocked"
  | "reviewed"
  | "triggered"
  | "belongs_to";

export type SemanticGraphStatus =
  | "source_backed"
  | "manual"
  | "graph_inferred"
  | "needs_review"
  | "rejected"
  | "running"
  | "failed";

export type SemanticGraphClusterKind = "person" | "company" | "evidence" | "artifact" | "runtime";

export interface SemanticGraphRef {
  artifactId?: string;
  artifactTitle?: string;
  elementId?: string;
  rowId?: string;
  columnId?: string;
  traceId?: string;
  proposalId?: string;
  sourceUrl?: string;
  evidenceId?: string;
  actorId?: string;
  label?: string;
}

export interface SemanticGraphNode {
  id: string;
  kind: SemanticGraphNodeKind;
  label: string;
  subtitle?: string;
  status: SemanticGraphStatus;
  refs: SemanticGraphRef[];
  clusterIds: string[];
  weight: number;
  actor?: Actor;
  meta?: Record<string, string | number | boolean | undefined>;
}

export interface SemanticGraphEdge {
  id: string;
  source: string;
  target: string;
  kind: SemanticGraphEdgeKind;
  label: string;
  status: SemanticGraphStatus;
  refs: SemanticGraphRef[];
  weight: number;
}

export interface SemanticGraphCluster {
  id: string;
  kind: SemanticGraphClusterKind;
  label: string;
  nodeIds: string[];
  edgeIds: string[];
  status: SemanticGraphStatus;
}

export interface SemanticGraphStats {
  nodes: number;
  edges: number;
  backedFacts: number;
  openQuestions: number;
  people: number;
  companies: number;
  traces: number;
  proposals: number;
  sources: number;
  visibleNodes?: number;
  visibleEdges?: number;
}

export interface SemanticGraphViewModel {
  nodes: SemanticGraphNode[];
  edges: SemanticGraphEdge[];
  clusters: SemanticGraphCluster[];
  stats: SemanticGraphStats;
  generatedFrom: {
    artifacts: number;
    traces: number;
    proposals: number;
    sessions: number;
    members: number;
    fallbackDemo: boolean;
  };
}

export interface SemanticGraphInput {
  roomId: string;
  artifacts: Artifact[];
  members?: Member[];
  traces?: TraceEvent[];
  proposals?: Proposal[];
  sessions?: AgentSession[];
  fallbackDemo?: boolean;
  maxRowsPerSheet?: number;
  maxEvidenceFacts?: number;
  now?: number;
}

export interface SemanticGraphFilters {
  query?: string;
  nodeKinds?: ReadonlySet<SemanticGraphNodeKind>;
  edgeKinds?: ReadonlySet<SemanticGraphEdgeKind>;
  statuses?: ReadonlySet<SemanticGraphStatus>;
  evidenceBackedOnly?: boolean;
  agentActionsOnly?: boolean;
  humanEditsOnly?: boolean;
}

export interface SemanticGraphSelectionSection {
  id: string;
  label: string;
  nodes: SemanticGraphNode[];
  edges: SemanticGraphEdge[];
}

export interface SemanticGraphSelection {
  selected?: SemanticGraphNode;
  selectedEdge?: SemanticGraphEdge;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  sections: SemanticGraphSelectionSection[];
}

export interface SemanticGraphPosition {
  x: number;
  y: number;
}

export interface SemanticGraphLayoutOptions {
  selectedId?: string | null;
  mode?: "constellation" | "entity-focus" | "cluster-lanes" | "trace-story";
}

export const CELL_STATUS_TO_SEMANTIC_STATUS: Record<CellStatus, SemanticGraphStatus> = {
  empty: "manual",
  running: "running",
  complete: "source_backed",
  needs_review: "needs_review",
  failed: "failed",
  gap: "needs_review",
};
