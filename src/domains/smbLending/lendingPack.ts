import type {
  LendingApplicationSnapshot,
  LendingBlocker,
  LendingCreditPacket,
  LendingDocumentRequestProposal,
  LendingEvidenceSupplyProposal,
  LendingMetrics,
  LendingPacketBundle,
  LendingProofReceipt,
  LendingProposal,
  LendingReviewDecision,
  LendingSourceRef,
  SmbLendingRoomTemplate,
} from "./types";
import { sha256Hex } from "./sha256";

const START_NODE_ID = "intake";
const REVIEW_NODE_ID = "underwriter-review";

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function stableDigest(value: unknown): string {
  return sha256Hex(JSON.stringify(stableValue(value)));
}

export function assertSyntheticSnapshot(snapshot: LendingApplicationSnapshot): void {
  if (snapshot.schemaVersion !== "noderoom.smb-lending-application/v1") {
    throw new Error("unsupported SMB lending application schema");
  }
  if (!snapshot.syntheticNotice.toUpperCase().includes("SYNTHETIC")) {
    throw new Error("SMB lending fixtures must be explicitly synthetic");
  }
  if (!Number.isInteger(snapshot.version) || snapshot.version < 1) {
    throw new Error("application version must be a positive integer");
  }
}

export function findMissingDocumentBlockers(snapshot: LendingApplicationSnapshot): LendingBlocker[] {
  assertSyntheticSnapshot(snapshot);
  return snapshot.documents
    .filter((document) => document.required && document.status === "missing")
    .map((document) => ({
      documentId: document.id,
      label: document.label,
      reason: `${document.label} is required and has not been received.`,
      sourceRefs: document.sourceRefs,
    }));
}

export function findCriticalPath(snapshot: LendingApplicationSnapshot): string[] {
  assertSyntheticSnapshot(snapshot);
  const adjacency = new Map<string, string[]>();
  for (const edge of snapshot.graph.edges) {
    const next = adjacency.get(edge.from) ?? [];
    next.push(edge.to);
    adjacency.set(edge.from, next);
  }

  const queue: string[][] = [[START_NODE_ID]];
  const visited = new Set([START_NODE_ID]);
  while (queue.length > 0) {
    const path = queue.shift();
    if (!path) break;
    const current = path[path.length - 1];
    if (current === REVIEW_NODE_ID) return path;
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push([...path, next]);
    }
  }
  throw new Error("lending process graph has no bounded path to human review");
}

export function calculateLendingMetrics(snapshot: LendingApplicationSnapshot): LendingMetrics {
  assertSyntheticSnapshot(snapshot);
  const periods = [...snapshot.financials].sort((left, right) => left.period.localeCompare(right.period));
  const latest = periods[periods.length - 1];
  if (!latest) throw new Error("at least one financial period is required");
  if (latest.revenueUsd <= 0 || latest.debtServiceUsd <= 0) {
    throw new Error("revenue and debt service must be positive for bounded ratios");
  }
  return {
    latestPeriod: latest.period,
    revenueUsd: latest.revenueUsd,
    ebitdaUsd: latest.ebitdaUsd,
    ebitdaMargin: latest.ebitdaUsd / latest.revenueUsd,
    debtServiceCoverage: latest.ebitdaUsd / latest.debtServiceUsd,
    sourceRefs: [latest.sourceRef],
  };
}

export function proposeMissingDocumentRequest(
  snapshot: LendingApplicationSnapshot,
  documentId: string,
  traceId: string,
): LendingDocumentRequestProposal {
  assertSyntheticSnapshot(snapshot);
  const document = snapshot.documents.find((item) => item.id === documentId);
  if (!document) throw new Error(`unknown document requirement: ${documentId}`);
  if (!document.required || document.status !== "missing") {
    throw new Error("document request proposals are limited to required missing evidence");
  }
  return {
    schemaVersion: "noderoom.smb-lending-proposal/v1",
    id: `proposal-${stableDigest({ caseId: snapshot.caseId, documentId, traceId }).slice(0, 16)}`,
    caseId: snapshot.caseId,
    baseVersion: snapshot.version,
    action: "request_document",
    documentId,
    rationale: `${document.label} blocks the document-collection stage. Requesting it requires human review and does not make a credit decision.`,
    traceId,
    status: "pending",
    requiredAuthority: "human_reviewer",
    sourceRefs: document.sourceRefs,
  };
}

export function applyReviewedDocumentRequest(
  snapshot: LendingApplicationSnapshot,
  proposal: LendingDocumentRequestProposal,
  decision: LendingReviewDecision,
): LendingApplicationSnapshot {
  assertSyntheticSnapshot(snapshot);
  if (proposal.caseId !== snapshot.caseId) throw new Error("proposal targets a different lending case");
  if (proposal.baseVersion !== snapshot.version) throw new Error("stale lending proposal: base version mismatch");
  if (decision.proposalId !== proposal.id) throw new Error("review decision targets a different proposal");
  if (decision.reviewerAuthority !== "human_reviewer" && decision.reviewerAuthority !== "credit_authority") {
    throw new Error("document requests require a human reviewer");
  }
  if (decision.decision !== "approved") return snapshot;

  let matched = false;
  const documents = snapshot.documents.map((document) => {
    if (document.id !== proposal.documentId) return document;
    matched = true;
    if (document.status !== "missing") throw new Error("approved request no longer targets missing evidence");
    return { ...document, status: "requested" as const };
  });
  if (!matched) throw new Error("proposal document is absent from the application");
  return { ...snapshot, version: snapshot.version + 1, documents };
}

export function proposeDocumentEvidenceSupply(
  snapshot: LendingApplicationSnapshot,
  documentId: string,
  evidenceSource: LendingSourceRef,
  traceId: string,
): LendingEvidenceSupplyProposal {
  assertSyntheticSnapshot(snapshot);
  const document = snapshot.documents.find((item) => item.id === documentId);
  if (!document) throw new Error(`unknown document requirement: ${documentId}`);
  if (document.status !== "requested") {
    throw new Error("evidence supply proposals require a previously requested document");
  }
  if (!evidenceSource.id || !evidenceSource.label || !evidenceSource.locator || !evidenceSource.contentHash) {
    throw new Error("supplied evidence requires an id, label, locator, and immutable content hash");
  }
  return {
    schemaVersion: "noderoom.smb-lending-evidence-proposal/v1",
    id: `proposal-${stableDigest({ caseId: snapshot.caseId, documentId, evidenceSource, traceId }).slice(0, 16)}`,
    caseId: snapshot.caseId,
    baseVersion: snapshot.version,
    action: "supply_document_evidence",
    documentId,
    evidenceSource,
    rationale: `${document.label} was supplied with an immutable source hash. A human reviewer must verify the evidence before it enters canonical state.`,
    traceId,
    status: "pending",
    requiredAuthority: "human_reviewer",
  };
}

export function applyReviewedEvidenceSupply(
  snapshot: LendingApplicationSnapshot,
  proposal: LendingEvidenceSupplyProposal,
  decision: LendingReviewDecision,
): LendingApplicationSnapshot {
  assertSyntheticSnapshot(snapshot);
  if (proposal.caseId !== snapshot.caseId) throw new Error("proposal targets a different lending case");
  if (proposal.baseVersion !== snapshot.version) throw new Error("stale lending proposal: base version mismatch");
  if (decision.proposalId !== proposal.id) throw new Error("review decision targets a different proposal");
  if (decision.reviewerAuthority !== "human_reviewer" && decision.reviewerAuthority !== "credit_authority") {
    throw new Error("supplied evidence requires a human reviewer");
  }
  if (decision.decision !== "approved") return snapshot;

  let matched = false;
  const documents = snapshot.documents.map((document) => {
    if (document.id !== proposal.documentId) return document;
    matched = true;
    if (document.status !== "requested") throw new Error("approved evidence no longer targets a requested document");
    return {
      ...document,
      status: "verified" as const,
      sourceRefs: uniqueSources([...document.sourceRefs, proposal.evidenceSource]),
    };
  });
  if (!matched) throw new Error("proposal document is absent from the application");
  return { ...snapshot, version: snapshot.version + 1, documents };
}

function uniqueSources(sources: LendingSourceRef[]): LendingSourceRef[] {
  return [...new Map(sources.map((source) => [source.id, source])).values()];
}

export function generateReviewPacket(snapshot: LendingApplicationSnapshot): LendingCreditPacket {
  const metrics = calculateLendingMetrics(snapshot);
  const blockers = findMissingDocumentBlockers(snapshot);
  const sourceRefs = uniqueSources([
    ...snapshot.documents.flatMap((document) => document.sourceRefs),
    ...snapshot.financials.map((period) => period.sourceRef),
  ]);
  return {
    schemaVersion: "noderoom.smb-lending-credit-packet/v1",
    caseId: snapshot.caseId,
    applicationVersion: snapshot.version,
    applicant: snapshot.applicant,
    request: snapshot.request,
    metrics,
    blockers,
    receivedDocumentIds: snapshot.documents
      .filter((document) => document.status === "received" || document.status === "verified")
      .map((document) => document.id),
    requestedDocumentIds: snapshot.documents
      .filter((document) => document.status === "requested")
      .map((document) => document.id),
    sourceRefs,
    decision: "not_made",
    decisionAuthority: "credit_authority",
    limitations: [
      "Synthetic evaluation output only.",
      "The packet prepares a human review and does not approve, decline, price, or bind credit.",
      "Missing or requested evidence remains unresolved until a human supplies and verifies it.",
    ],
  };
}

export function createLendingProofReceipt(
  snapshot: LendingApplicationSnapshot,
  packet: LendingCreditPacket,
  proposals: LendingProposal[],
): LendingProofReceipt {
  assertSyntheticSnapshot(snapshot);
  const sourceRefs = uniqueSources(packet.sourceRefs);
  return {
    schemaVersion: "noderoom.smb-lending-proof/v1",
    caseId: snapshot.caseId,
    applicationVersion: snapshot.version,
    applicationHash: stableDigest(snapshot),
    packetHash: stableDigest(packet),
    traceIds: [...new Set(proposals.map((proposal) => proposal.traceId))],
    sourceRefs,
    assertions: {
      syntheticOnly: true,
      noCreditDecision: true,
      proposalReviewed: proposals.every((proposal) => proposal.status !== "pending"),
      baseVersionMatched: proposals.every((proposal) => proposal.baseVersion <= snapshot.version),
      sourceLineagePresent: sourceRefs.length > 0 && packet.metrics.sourceRefs.length > 0,
    },
  };
}

export function exportLendingPacketBundle(bundle: LendingPacketBundle): string {
  if (bundle.schemaVersion !== "noderoom.smb-lending-bundle/v1") {
    throw new Error("unsupported SMB lending bundle schema");
  }
  assertSyntheticSnapshot(bundle.application);
  if (bundle.receipt.applicationHash !== stableDigest(bundle.application)) {
    throw new Error("application hash does not match the proof receipt");
  }
  if (bundle.receipt.packetHash !== stableDigest(bundle.packet)) {
    throw new Error("packet hash does not match the proof receipt");
  }
  return JSON.stringify(stableValue(bundle));
}

export function reopenLendingPacketBundle(serialized: string): LendingPacketBundle {
  const parsed = JSON.parse(serialized) as LendingPacketBundle;
  exportLendingPacketBundle(parsed);
  return parsed;
}

export function createSmbLendingRoomTemplate(snapshot: LendingApplicationSnapshot): SmbLendingRoomTemplate {
  const blockers = findMissingDocumentBlockers(snapshot);
  return {
    id: "smb-lending-deployment",
    title: "SMB Lending Deployment Room",
    caseId: snapshot.caseId,
    lanes: [
      { id: "discovery", title: "Discovery", status: "complete" },
      { id: "configuration", title: "Configuration", status: "complete" },
      { id: "integration", title: "Integration", status: blockers.length > 0 ? "blocked" : "active" },
      { id: "validation", title: "Validation", status: "pending" },
      { id: "launch", title: "Launch", status: "pending" },
    ],
    questions: [
      "Why is this application blocked?",
      "Which required documents are missing?",
      "Which extracted figures need human validation?",
      "What is the critical path to a complete credit file?",
      "Which workflow steps remain manual?",
      "Generate the review packet without making a lending decision.",
    ],
    artifactIds: [
      `lending-application:${snapshot.caseId}`,
      `lending-graph:${snapshot.caseId}`,
      `lending-workbook:${snapshot.caseId}`,
      `lending-evidence:${snapshot.caseId}`,
      `lending-credit-packet:${snapshot.caseId}`,
      `lending-deployment-board:${snapshot.caseId}`,
    ],
    authorityBoundary: "Agents inspect evidence and propose bounded changes. A human credit authority owns every lending decision.",
  };
}
