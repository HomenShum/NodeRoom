export type LendingDocumentStatus = "received" | "missing" | "requested" | "verified";

export type LendingAuthorityClass = "agent" | "human_reviewer" | "credit_authority";

export interface LendingSourceRef {
  id: string;
  label: string;
  locator: string;
  contentHash?: string;
}

export interface LendingDocumentRequirement {
  id: string;
  label: string;
  status: LendingDocumentStatus;
  required: boolean;
  sourceRefs: LendingSourceRef[];
}

export interface LendingFinancialPeriod {
  period: string;
  revenueUsd: number;
  ebitdaUsd: number;
  debtServiceUsd: number;
  sourceRef: LendingSourceRef;
}

export interface LendingGraphNode {
  id: string;
  label: string;
  owner: LendingAuthorityClass;
}

export interface LendingGraphEdge {
  from: string;
  to: string;
  relationship: "unlocks" | "requires";
}

export interface LendingApplicationSnapshot {
  schemaVersion: "noderoom.smb-lending-application/v1";
  caseId: string;
  version: number;
  applicant: string;
  request: string;
  syntheticNotice: string;
  documents: LendingDocumentRequirement[];
  financials: LendingFinancialPeriod[];
  graph: {
    nodes: LendingGraphNode[];
    edges: LendingGraphEdge[];
  };
}

export interface LendingBlocker {
  documentId: string;
  label: string;
  reason: string;
  sourceRefs: LendingSourceRef[];
}

export interface LendingMetrics {
  latestPeriod: string;
  revenueUsd: number;
  ebitdaUsd: number;
  ebitdaMargin: number;
  debtServiceCoverage: number;
  sourceRefs: LendingSourceRef[];
}

export interface LendingDocumentRequestProposal {
  schemaVersion: "noderoom.smb-lending-proposal/v1";
  id: string;
  caseId: string;
  baseVersion: number;
  action: "request_document";
  documentId: string;
  rationale: string;
  traceId: string;
  status: "pending" | "approved" | "rejected";
  requiredAuthority: "human_reviewer";
  sourceRefs: LendingSourceRef[];
}

export interface LendingEvidenceSupplyProposal {
  schemaVersion: "noderoom.smb-lending-evidence-proposal/v1";
  id: string;
  caseId: string;
  baseVersion: number;
  action: "supply_document_evidence";
  documentId: string;
  evidenceSource: LendingSourceRef;
  rationale: string;
  traceId: string;
  status: "pending" | "approved" | "rejected";
  requiredAuthority: "human_reviewer";
}

export type LendingProposal = LendingDocumentRequestProposal | LendingEvidenceSupplyProposal;

export interface LendingReviewDecision {
  proposalId: string;
  reviewerId: string;
  reviewerAuthority: "human_reviewer" | "credit_authority";
  decision: "approved" | "rejected";
  decidedAt: string;
  comment?: string;
}

export interface LendingCreditPacket {
  schemaVersion: "noderoom.smb-lending-credit-packet/v1";
  caseId: string;
  applicationVersion: number;
  applicant: string;
  request: string;
  metrics: LendingMetrics;
  blockers: LendingBlocker[];
  receivedDocumentIds: string[];
  requestedDocumentIds: string[];
  sourceRefs: LendingSourceRef[];
  decision: "not_made";
  decisionAuthority: "credit_authority";
  limitations: string[];
}

export interface LendingProofReceipt {
  schemaVersion: "noderoom.smb-lending-proof/v1";
  caseId: string;
  applicationVersion: number;
  applicationHash: string;
  packetHash: string;
  traceIds: string[];
  sourceRefs: LendingSourceRef[];
  assertions: {
    syntheticOnly: true;
    noCreditDecision: true;
    proposalReviewed: boolean;
    baseVersionMatched: boolean;
    sourceLineagePresent: boolean;
  };
}

export interface LendingPacketBundle {
  schemaVersion: "noderoom.smb-lending-bundle/v1";
  application: LendingApplicationSnapshot;
  packet: LendingCreditPacket;
  receipt: LendingProofReceipt;
}

export interface SmbLendingRoomTemplate {
  id: "smb-lending-deployment";
  title: "SMB Lending Deployment Room";
  caseId: string;
  lanes: Array<{
    id: "discovery" | "configuration" | "integration" | "validation" | "launch";
    title: string;
    status: "complete" | "active" | "blocked" | "pending";
  }>;
  questions: string[];
  artifactIds: string[];
  authorityBoundary: string;
}
