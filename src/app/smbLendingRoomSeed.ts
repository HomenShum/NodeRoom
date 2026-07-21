import restaurantFixture from "../../packs/smb-lending-deployment/fixtures/restaurant-working-capital.json";
import type { DataframeColumn } from "../engine/types";
import {
  calculateLendingMetrics,
  applyReviewedDocumentRequest,
  applyReviewedEvidenceSupply,
  createLendingProofReceipt,
  createSmbLendingRoomTemplate,
  exportLendingPacketBundle,
  findCriticalPath,
  findMissingDocumentBlockers,
  generateReviewPacket,
  proposeMissingDocumentRequest,
  proposeDocumentEvidenceSupply,
  type LendingApplicationSnapshot,
} from "../domains/smbLending";

export const SMB_LENDING_FIXTURE = restaurantFixture as unknown as LendingApplicationSnapshot;
export const SMB_LENDING_BLOCKERS = findMissingDocumentBlockers(SMB_LENDING_FIXTURE);
export const SMB_LENDING_PATH = findCriticalPath(SMB_LENDING_FIXTURE);
export const SMB_LENDING_METRICS = calculateLendingMetrics(SMB_LENDING_FIXTURE);
export const SMB_LENDING_TEMPLATE = createSmbLendingRoomTemplate(SMB_LENDING_FIXTURE);
export const SMB_LENDING_PROPOSAL = proposeMissingDocumentRequest(
  SMB_LENDING_FIXTURE,
  "operating-bank-statements-q2",
  "trace-smb-lending-document-request",
);
export const SMB_LENDING_REQUESTED_SNAPSHOT = applyReviewedDocumentRequest(
  SMB_LENDING_FIXTURE,
  { ...SMB_LENDING_PROPOSAL, status: "approved" },
  {
    proposalId: SMB_LENDING_PROPOSAL.id,
    reviewerId: "fde-host",
    reviewerAuthority: "human_reviewer",
    decision: "approved",
    decidedAt: "2026-07-21T00:00:00.000Z",
  },
);
export const SMB_LENDING_EVIDENCE_SOURCE = {
  id: "src-bank-statements-q2",
  label: "Synthetic Q2 operating-bank statements",
  locator: "fixture://bay-hearth/bank-statements-q2",
  contentHash: "sha256:synthetic-bank-statements-q2",
};
export const SMB_LENDING_EVIDENCE_PROPOSAL = proposeDocumentEvidenceSupply(
  SMB_LENDING_REQUESTED_SNAPSHOT,
  SMB_LENDING_PROPOSAL.documentId,
  SMB_LENDING_EVIDENCE_SOURCE,
  "trace-smb-lending-evidence-supply",
);
export const SMB_LENDING_VERIFIED_SNAPSHOT = applyReviewedEvidenceSupply(
  SMB_LENDING_REQUESTED_SNAPSHOT,
  { ...SMB_LENDING_EVIDENCE_PROPOSAL, status: "approved" },
  {
    proposalId: SMB_LENDING_EVIDENCE_PROPOSAL.id,
    reviewerId: "fde-host",
    reviewerAuthority: "human_reviewer",
    decision: "approved",
    decidedAt: "2026-07-21T00:05:00.000Z",
  },
);
export const SMB_LENDING_PACKET = generateReviewPacket(SMB_LENDING_FIXTURE);
export const SMB_LENDING_RECEIPT = createLendingProofReceipt(
  SMB_LENDING_FIXTURE,
  SMB_LENDING_PACKET,
  [SMB_LENDING_PROPOSAL],
);
export const SMB_LENDING_VERIFIED_PACKET = generateReviewPacket(SMB_LENDING_VERIFIED_SNAPSHOT);
export const SMB_LENDING_VERIFIED_RECEIPT = createLendingProofReceipt(
  SMB_LENDING_VERIFIED_SNAPSHOT,
  SMB_LENDING_VERIFIED_PACKET,
  [
    { ...SMB_LENDING_PROPOSAL, status: "approved" },
    { ...SMB_LENDING_EVIDENCE_PROPOSAL, status: "approved" },
  ],
);
export const SMB_LENDING_VERIFIED_BUNDLE = exportLendingPacketBundle({
  schemaVersion: "noderoom.smb-lending-bundle/v1",
  application: SMB_LENDING_VERIFIED_SNAPSHOT,
  packet: SMB_LENDING_VERIFIED_PACKET,
  receipt: SMB_LENDING_VERIFIED_RECEIPT,
});

export const SMB_LENDING_DOCUMENT_COLUMNS: DataframeColumn[] = [
  { id: "document", label: "Document", order: 0, type: "text" },
  { id: "status", label: "Status", order: 1, type: "text" },
  { id: "required", label: "Required", order: 2, type: "text" },
  { id: "source", label: "Source", order: 3, type: "text" },
  { id: "locator", label: "Locator", order: 4, type: "text" },
];

export const SMB_LENDING_DOCUMENT_ROWS = SMB_LENDING_FIXTURE.documents.map((document) => ({
  id: document.id,
  document: document.label,
  status: document.status,
  required: document.required ? "yes" : "no",
  source: document.sourceRefs[0]?.id ?? "not supplied",
  locator: document.sourceRefs[0]?.locator ?? "missing",
}));

export function smbLendingDocumentRows(snapshot: LendingApplicationSnapshot) {
  return snapshot.documents.map((document) => ({
    id: document.id,
    document: document.label,
    status: document.status,
    required: document.required ? "yes" : "no",
    source: document.sourceRefs.map((source) => `${source.id}${source.contentHash ? ` (${source.contentHash})` : ""}`).join(", ") || "not supplied",
    locator: document.sourceRefs.map((source) => source.locator).join(", ") || "missing",
  }));
}

export const SMB_LENDING_GRAPH_COLUMNS: DataframeColumn[] = [
  { id: "from", label: "From", order: 0, type: "text" },
  { id: "relationship", label: "Relationship", order: 1, type: "text" },
  { id: "to", label: "To", order: 2, type: "text" },
  { id: "critical_path", label: "Critical path", order: 3, type: "text" },
];

const criticalEdges = new Set(
  SMB_LENDING_PATH.slice(0, -1).map((nodeId, index) => `${nodeId}->${SMB_LENDING_PATH[index + 1]}`),
);

export const SMB_LENDING_GRAPH_ROWS = SMB_LENDING_FIXTURE.graph.edges.map((edge, index) => ({
  id: `edge-${index + 1}`,
  from: SMB_LENDING_FIXTURE.graph.nodes.find((node) => node.id === edge.from)?.label ?? edge.from,
  relationship: edge.relationship,
  to: SMB_LENDING_FIXTURE.graph.nodes.find((node) => node.id === edge.to)?.label ?? edge.to,
  critical_path: criticalEdges.has(`${edge.from}->${edge.to}`) ? "yes" : "no",
}));

export const SMB_LENDING_METRIC_COLUMNS: DataframeColumn[] = [
  { id: "period", label: "Period", order: 0, type: "text" },
  { id: "revenue", label: "Revenue", order: 1, type: "currency" },
  { id: "ebitda", label: "EBITDA", order: 2, type: "currency" },
  { id: "ebitda_margin", label: "EBITDA margin", order: 3, type: "number" },
  { id: "debt_service", label: "Debt service", order: 4, type: "currency" },
  { id: "dscr", label: "DSCR", order: 5, type: "number" },
  { id: "source", label: "Source", order: 6, type: "text" },
];

export const SMB_LENDING_METRIC_ROWS = SMB_LENDING_FIXTURE.financials.map((period) => ({
  id: period.period.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase(),
  period: period.period,
  revenue: String(period.revenueUsd),
  ebitda: String(period.ebitdaUsd),
  ebitda_margin: String(period.ebitdaUsd / period.revenueUsd),
  debt_service: String(period.debtServiceUsd),
  dscr: String(period.ebitdaUsd / period.debtServiceUsd),
  source: `${period.sourceRef.id} ${period.sourceRef.locator}`,
}));

export const SMB_LENDING_OVERVIEW_NOTE = `
<h1>SMB Lending Deployment Room</h1>
<p><b>Synthetic case:</b> ${SMB_LENDING_FIXTURE.applicant}. Request: <b>${SMB_LENDING_FIXTURE.request}</b>.</p>
<p><b>Current blocker:</b> ${SMB_LENDING_BLOCKERS[0]?.reason ?? "none"}</p>
<p><b>Critical path:</b> ${SMB_LENDING_PATH.join(" → ")}.</p>
<p><b>Authority boundary:</b> NodeAgent may inspect, extract, calculate, explain, and propose. A human underwriter or credit officer retains all lending authority. This room makes <b>no credit decision</b>.</p>
<p><b>State ownership:</b> NodeRoom is authoritative. Neo4j is an optional read projection for traversal and explanation, never the transaction ledger.</p>
`;

export const SMB_LENDING_PROPOSAL_NOTE = `
<h1>Pending document-request proposal</h1>
<p><b>Proposal:</b> ${SMB_LENDING_PROPOSAL.id}</p>
<p><b>Base application version:</b> ${SMB_LENDING_PROPOSAL.baseVersion}</p>
<p><b>Requested evidence:</b> ${SMB_LENDING_BLOCKERS[0]?.label ?? SMB_LENDING_PROPOSAL.documentId}</p>
<p><b>Reason:</b> ${SMB_LENDING_PROPOSAL.rationale}</p>
<p><b>Status:</b> pending human review. The proposal cannot update canonical state until approved against the exact base version.</p>
`;

export const SMB_LENDING_EVIDENCE_PROPOSAL_NOTE = `
<h1>Pending evidence-verification proposal</h1>
<p><b>Proposal:</b> ${SMB_LENDING_EVIDENCE_PROPOSAL.id}</p>
<p><b>Application transition:</b> requested &rarr; verified at domain base version ${SMB_LENDING_EVIDENCE_PROPOSAL.baseVersion}</p>
<p><b>Evidence:</b> ${SMB_LENDING_EVIDENCE_SOURCE.label}</p>
<p><b>Locator:</b> <code>${SMB_LENDING_EVIDENCE_SOURCE.locator}</code></p>
<p><b>Immutable hash:</b> <code>${SMB_LENDING_EVIDENCE_SOURCE.contentHash}</code></p>
<p><b>Status:</b> pending human verification. Approval updates canonical evidence state through final CAS and still makes no credit decision.</p>
`;

export const SMB_LENDING_PROOF_NOTE = `
<h1>NodeProof pre-application receipt</h1>
<p><b>Application hash:</b> <code>${SMB_LENDING_RECEIPT.applicationHash}</code></p>
<p><b>Packet hash:</b> <code>${SMB_LENDING_RECEIPT.packetHash}</code></p>
<p><b>Synthetic-only:</b> ${SMB_LENDING_RECEIPT.assertions.syntheticOnly}</p>
<p><b>No credit decision:</b> ${SMB_LENDING_RECEIPT.assertions.noCreditDecision}</p>
<p><b>Source lineage present:</b> ${SMB_LENDING_RECEIPT.assertions.sourceLineagePresent}</p>
<p><b>Proposal reviewed:</b> ${SMB_LENDING_RECEIPT.assertions.proposalReviewed} (expected false until human review)</p>
`;

export const SMB_LENDING_PENDING_PACKET_NOTE = `
<h1>Human review credit packet</h1>
<p><b>Status:</b> blocked until the requested operating-bank statements are supplied and verified.</p>
<p><b>Decision:</b> not made. Human credit authority is required.</p>
`;

export const SMB_LENDING_VERIFIED_PACKET_NOTE = `
<h1>Human review credit packet</h1>
<p><b>Application version:</b> ${SMB_LENDING_VERIFIED_PACKET.applicationVersion}</p>
<p><b>Applicant:</b> ${SMB_LENDING_VERIFIED_PACKET.applicant}</p>
<p><b>Request:</b> ${SMB_LENDING_VERIFIED_PACKET.request}</p>
<p><b>Required-document blockers:</b> ${SMB_LENDING_VERIFIED_PACKET.blockers.length}</p>
<p><b>Latest DSCR:</b> ${SMB_LENDING_VERIFIED_PACKET.metrics.debtServiceCoverage.toFixed(2)}x</p>
<p><b>Latest EBITDA margin:</b> ${(SMB_LENDING_VERIFIED_PACKET.metrics.ebitdaMargin * 100).toFixed(1)}%</p>
<p><b>Decision:</b> ${SMB_LENDING_VERIFIED_PACKET.decision}. Human credit authority is required.</p>
`;

export const SMB_LENDING_VERIFIED_PROOF_NOTE = `
<h1>NodeProof verified workflow receipt</h1>
<p><b>Application version:</b> ${SMB_LENDING_VERIFIED_RECEIPT.applicationVersion}</p>
<p><b>Application hash:</b> <code>${SMB_LENDING_VERIFIED_RECEIPT.applicationHash}</code></p>
<p><b>Packet hash:</b> <code>${SMB_LENDING_VERIFIED_RECEIPT.packetHash}</code></p>
<p><b>Proposal reviewed:</b> ${SMB_LENDING_VERIFIED_RECEIPT.assertions.proposalReviewed}</p>
<p><b>Base versions matched:</b> ${SMB_LENDING_VERIFIED_RECEIPT.assertions.baseVersionMatched}</p>
<p><b>Source lineage present:</b> ${SMB_LENDING_VERIFIED_RECEIPT.assertions.sourceLineagePresent}</p>
<p><b>No credit decision:</b> ${SMB_LENDING_VERIFIED_RECEIPT.assertions.noCreditDecision}</p>
`;
