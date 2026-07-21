import type { WorkArtifactViewModel } from "../../ui/workArtifacts/workArtifactTypes";
import { calculateLendingMetrics, findMissingDocumentBlockers } from "./lendingPack";
import type {
  LendingApplicationSnapshot,
  LendingCreditPacket,
  LendingProposal,
} from "./types";

export function buildSmbLendingWorkArtifacts(
  snapshot: LendingApplicationSnapshot,
  packet: LendingCreditPacket,
  proposals: LendingProposal[],
): WorkArtifactViewModel[] {
  const blockers = findMissingDocumentBlockers(snapshot);
  const metrics = calculateLendingMetrics(snapshot);
  const traceIds = [...new Set(proposals.map((proposal) => proposal.traceId))];
  const sourceIds = [...new Set(packet.sourceRefs.map((source) => source.id))];
  const proposalIds = proposals.map((proposal) => proposal.id);
  const receipt = {
    traceIds,
    sourceIds,
    proposalIds,
    evidenceCount: sourceIds.length,
    unresolvedCount: blockers.length,
  };
  const roomId = `smb-lending:${snapshot.caseId}`;

  return [
    {
      id: `lending-application:${snapshot.caseId}`,
      roomId,
      kind: "notebook",
      sourceKind: "note",
      title: `${snapshot.applicant} application`,
      summary: snapshot.request,
      status: blockers.length > 0 ? "needs_review" : "ready",
      version: snapshot.version,
      receipt,
      refs: sourceIds.map((sourceId) => ({ sourceId })),
      actions: [{ id: "ask_nodeagent", label: "Ask about application" }],
    },
    {
      id: `lending-graph:${snapshot.caseId}`,
      roomId,
      kind: "graph",
      sourceKind: "semantic_graph",
      title: "Lending process graph",
      summary: blockers.length > 0 ? `${blockers.length} required-document blocker(s)` : "No missing-document blocker",
      status: blockers.length > 0 ? "needs_review" : "ready",
      version: snapshot.version,
      receipt,
      refs: traceIds.map((traceId) => ({ traceId })),
      actions: [{ id: "open", label: "Inspect critical path" }, { id: "ask_nodeagent", label: "Explain blocker" }],
    },
    {
      id: `lending-workbook:${snapshot.caseId}`,
      roomId,
      kind: "spreadsheet",
      sourceKind: "sheet",
      title: "Financial spreading workbook",
      summary: `${metrics.latestPeriod} DSCR ${metrics.debtServiceCoverage.toFixed(2)}x; EBITDA margin ${(metrics.ebitdaMargin * 100).toFixed(1)}%`,
      status: "ready",
      version: snapshot.version,
      receipt,
      refs: metrics.sourceRefs.map((source) => ({ sourceId: source.id })),
      actions: [{ id: "open", label: "Open workbook" }, { id: "propose_patch", label: "Propose adjustment" }],
    },
    {
      id: `lending-evidence:${snapshot.caseId}`,
      roomId,
      kind: "notebook",
      sourceKind: "note",
      title: "Document and evidence room",
      summary: `${packet.receivedDocumentIds.length} received; ${packet.requestedDocumentIds.length} requested; ${blockers.length} missing`,
      status: blockers.length > 0 ? "needs_review" : "ready",
      version: snapshot.version,
      receipt,
      refs: sourceIds.map((sourceId) => ({ sourceId })),
      actions: [{ id: "open", label: "Inspect evidence" }, { id: "comment", label: "Add review note" }],
    },
    {
      id: `lending-credit-packet:${snapshot.caseId}`,
      roomId,
      kind: "export",
      sourceKind: "export_bundle",
      title: "Human review credit packet",
      summary: "Decision not made; human credit authority required",
      status: blockers.length > 0 ? "needs_review" : "ready",
      version: snapshot.version,
      receipt,
      refs: proposalIds.map((proposalId) => ({ proposalId })),
      actions: [{ id: "export", label: "Export review packet" }, { id: "view_trace", label: "Inspect proof" }],
    },
    {
      id: `lending-deployment-board:${snapshot.caseId}`,
      roomId,
      kind: "wall",
      sourceKind: "wall",
      title: "Deployment feedback board",
      summary: "Separate bank-specific configuration from reusable platform capability",
      status: "pending",
      version: snapshot.version,
      receipt,
      refs: traceIds.map((traceId) => ({ traceId })),
      actions: [{ id: "comment", label: "Classify platform feedback" }],
    },
  ];
}
