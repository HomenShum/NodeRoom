import type { Actor, ArtifactKind, ProposalStatus } from "../../engine/types";

export type WorkArtifactKind =
  | "spreadsheet"
  | "notebook"
  | "wall"
  | "deck"
  | "graph"
  | "trace"
  | "proposal"
  | "export";

export type WorkArtifactStatus =
  | "empty"
  | "ready"
  | "running"
  | "needs_review"
  | "failed"
  | "pending"
  | "approved"
  | "rejected";

export type WorkArtifactActionId =
  | "open"
  | "pin"
  | "comment"
  | "ask_nodeagent"
  | "propose_patch"
  | "accept"
  | "reject"
  | "export"
  | "view_trace";

export interface WorkArtifactAction {
  id: WorkArtifactActionId;
  label: string;
  tone?: "default" | "review" | "danger" | "success";
  disabled?: boolean;
  reason?: string;
}

export interface WorkArtifactRef {
  artifactId?: string;
  elementId?: string;
  traceId?: string;
  proposalId?: string;
  sourceId?: string;
  exportId?: string;
  label?: string;
}

export interface WorkArtifactReceipt {
  traceIds: string[];
  sourceIds: string[];
  proposalIds: string[];
  evidenceCount: number;
  unresolvedCount: number;
}

export interface WorkArtifactViewModel {
  id: string;
  roomId: string;
  kind: WorkArtifactKind;
  sourceKind?: ArtifactKind | "semantic_graph" | "deck_storyboard" | "export_bundle" | "trace_event" | "proposal";
  title: string;
  summary?: string;
  status: WorkArtifactStatus;
  version?: number | string;
  owner?: Pick<Actor, "id" | "name" | "kind" | "scope">;
  updatedAt?: number;
  createdAt?: number;
  receipt: WorkArtifactReceipt;
  refs: WorkArtifactRef[];
  actions: WorkArtifactAction[];
  meta?: Record<string, string | number | boolean | undefined>;
}

export interface DeckStoryboardSection {
  id: string;
  title: string;
  claimCount?: number;
  evidenceCount?: number;
  unresolvedCount?: number;
}

export interface DeckArtifactInput {
  id: string;
  roomId: string;
  title: string;
  status?: WorkArtifactStatus;
  version?: number | string;
  updatedAt?: number;
  createdAt?: number;
  owner?: WorkArtifactViewModel["owner"];
  storyboardStatus?: "draft" | "approved" | "needs_review";
  sections: DeckStoryboardSection[];
  traceIds?: string[];
  sourceIds?: string[];
  proposalIds?: string[];
}

export interface ExportArtifactInput {
  id: string;
  roomId: string;
  title: string;
  format: "pptx" | "pdf" | "xlsx" | "docx" | "zip" | "json" | "html";
  status?: WorkArtifactStatus;
  createdAt?: number;
  updatedAt?: number;
  traceIds?: string[];
  sourceIds?: string[];
  proposalIds?: string[];
  artifactCount?: number;
  evidenceCount?: number;
  unresolvedCount?: number;
}

export function workArtifactKindFromEngine(kind: ArtifactKind): WorkArtifactKind {
  if (kind === "sheet") return "spreadsheet";
  if (kind === "note") return "notebook";
  return "wall";
}

export function workArtifactStatusFromProposal(status: ProposalStatus): WorkArtifactStatus {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  return "pending";
}

