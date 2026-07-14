import type { WorkArtifactKind, WorkArtifactStatus, WorkArtifactViewModel } from "./workArtifactTypes";

export interface ProofBundleReceiptItem {
  id: string;
  kind: WorkArtifactKind;
  status: WorkArtifactStatus;
  title: string;
  version?: string | number;
  traceIds: string[];
  proposalIds: string[];
  sourceIds: string[];
  evidenceCount: number;
  unresolvedCount: number;
}

export interface ProofBundleKnownGap {
  itemId: string;
  title: string;
  status: WorkArtifactStatus;
  unresolvedCount: number;
  reason: string;
}

export interface ProofBundleReceipt {
  receiptVersion: 1;
  roomId: string;
  receiptId: string;
  generatedAt: number;
  artifactCount: number;
  kindCounts: Record<WorkArtifactKind, number>;
  statusCounts: Record<WorkArtifactStatus, number>;
  evidenceCount: number;
  unresolvedCount: number;
  traceIds: string[];
  proposalIds: string[];
  sourceIds: string[];
  items: ProofBundleReceiptItem[];
  knownGaps: ProofBundleKnownGap[];
  integrityHash: string;
}

const KIND_ORDER: WorkArtifactKind[] = ["spreadsheet", "notebook", "wall", "deck", "graph", "trace", "proposal", "export"];
const STATUS_ORDER: WorkArtifactStatus[] = ["empty", "ready", "running", "needs_review", "failed", "pending", "approved", "rejected"];

function zeroKinds(): Record<WorkArtifactKind, number> {
  return Object.fromEntries(KIND_ORDER.map((kind) => [kind, 0])) as Record<WorkArtifactKind, number>;
}

function zeroStatuses(): Record<WorkArtifactStatus, number> {
  return Object.fromEntries(STATUS_ORDER.map((status) => [status, 0])) as Record<WorkArtifactStatus, number>;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort();
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function itemGapReason(item: WorkArtifactViewModel): string | null {
  if (item.status === "failed" || item.status === "rejected") return "failed_or_rejected";
  if (item.status === "needs_review" || item.status === "pending") return "human_review_required";
  if (item.receipt.unresolvedCount > 0) return "unresolved_receipt_items";
  return null;
}

export function buildProofBundleReceipt(args: {
  roomId: string;
  artifacts: WorkArtifactViewModel[];
  generatedAt?: number;
}): ProofBundleReceipt {
  const sorted = [...args.artifacts].sort((a, b) => a.id.localeCompare(b.id));
  const kindCounts = zeroKinds();
  const statusCounts = zeroStatuses();
  const items: ProofBundleReceiptItem[] = sorted.map((artifact) => {
    kindCounts[artifact.kind] += 1;
    statusCounts[artifact.status] += 1;
    return {
      id: artifact.id,
      kind: artifact.kind,
      status: artifact.status,
      title: artifact.title,
      version: artifact.version,
      traceIds: unique(artifact.receipt.traceIds),
      proposalIds: unique(artifact.receipt.proposalIds),
      sourceIds: unique(artifact.receipt.sourceIds),
      evidenceCount: artifact.receipt.evidenceCount,
      unresolvedCount: artifact.receipt.unresolvedCount,
    };
  });
  const knownGaps: ProofBundleKnownGap[] = sorted.flatMap((artifact) => {
    const reason = itemGapReason(artifact);
    return reason ? [{
      itemId: artifact.id,
      title: artifact.title,
      status: artifact.status,
      unresolvedCount: artifact.receipt.unresolvedCount,
      reason,
    }] : [];
  });
  const generatedAt = args.generatedAt ?? Date.now();
  const traceIds = unique(items.flatMap((item) => item.traceIds));
  const proposalIds = unique(items.flatMap((item) => item.proposalIds));
  const sourceIds = unique(items.flatMap((item) => item.sourceIds));
  const payloadForHash = {
    roomId: args.roomId,
    items,
    knownGaps,
    traceIds,
    proposalIds,
    sourceIds,
  };
  const integrityHash = stableHash(payloadForHash);

  return {
    receiptVersion: 1,
    roomId: args.roomId,
    receiptId: `${args.roomId}:proof-bundle:${integrityHash}`,
    generatedAt,
    artifactCount: items.length,
    kindCounts,
    statusCounts,
    evidenceCount: items.reduce((sum, item) => sum + item.evidenceCount, 0),
    unresolvedCount: items.reduce((sum, item) => sum + item.unresolvedCount, 0),
    traceIds,
    proposalIds,
    sourceIds,
    items,
    knownGaps,
    integrityHash,
  };
}
