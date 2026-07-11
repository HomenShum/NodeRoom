import type { ProofBundleReceipt } from "./proofBundleReceipt";
import type { TraceReplaySummary } from "./traceReplaySummary";
import type { WorkArtifactAction, WorkArtifactRef, WorkArtifactViewModel } from "./workArtifactTypes";

export interface ProofBundleExportArtifact {
  id: string;
  kind: WorkArtifactViewModel["kind"];
  sourceKind?: WorkArtifactViewModel["sourceKind"];
  title: string;
  summary?: string;
  status: WorkArtifactViewModel["status"];
  version?: string | number;
  ownerName?: string;
  receipt: WorkArtifactViewModel["receipt"];
  refs: WorkArtifactRef[];
  actions: Array<Pick<WorkArtifactAction, "id" | "label" | "tone" | "disabled" | "reason">>;
  meta?: WorkArtifactViewModel["meta"];
}

export interface ProofBundleExportManifest {
  manifestVersion: 1;
  roomId: string;
  manifestId: string;
  generatedAt: number;
  receipt: ProofBundleReceipt;
  traceReplay: TraceReplaySummary;
  artifacts: ProofBundleExportArtifact[];
  exportIntents: Array<{
    kind: "proof_bundle_sidecar";
    format: "json";
    receiptId: string;
    replayHash: string;
    knownGapCount: number;
  }>;
  integrityHash: string;
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

function sortedRefs(refs: WorkArtifactRef[]): WorkArtifactRef[] {
  return [...refs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

function exportArtifact(item: WorkArtifactViewModel): ProofBundleExportArtifact {
  return {
    id: item.id,
    kind: item.kind,
    sourceKind: item.sourceKind,
    title: item.title,
    summary: item.summary,
    status: item.status,
    version: item.version,
    ownerName: item.owner?.name,
    receipt: item.receipt,
    refs: sortedRefs(item.refs),
    actions: item.actions.map((action) => ({
      id: action.id,
      label: action.label,
      tone: action.tone,
      disabled: action.disabled,
      reason: action.reason,
    })),
    meta: item.meta,
  };
}

export function buildProofBundleExportManifest(args: {
  roomId: string;
  artifacts: WorkArtifactViewModel[];
  receipt: ProofBundleReceipt;
  traceReplay: TraceReplaySummary;
  generatedAt?: number;
}): ProofBundleExportManifest {
  const artifacts = [...args.artifacts].sort((a, b) => a.id.localeCompare(b.id)).map(exportArtifact);
  const exportIntents: ProofBundleExportManifest["exportIntents"] = [{
    kind: "proof_bundle_sidecar",
    format: "json",
    receiptId: args.receipt.receiptId,
    replayHash: args.traceReplay.replayHash,
    knownGapCount: args.receipt.knownGaps.length,
  }];
  const payloadForHash = {
    roomId: args.roomId,
    receiptId: args.receipt.receiptId,
    receiptHash: args.receipt.integrityHash,
    replayHash: args.traceReplay.replayHash,
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id,
      kind: artifact.kind,
      status: artifact.status,
      refs: artifact.refs,
      actions: artifact.actions.map((action) => action.id),
    })),
    exportIntents,
  };
  const integrityHash = stableHash(payloadForHash);
  return {
    manifestVersion: 1,
    roomId: args.roomId,
    manifestId: `${args.receipt.receiptId}:manifest:${integrityHash}`,
    generatedAt: args.generatedAt ?? args.receipt.generatedAt,
    receipt: args.receipt,
    traceReplay: args.traceReplay,
    artifacts,
    exportIntents,
    integrityHash,
  };
}

export function proofBundleManifestJson(manifest: ProofBundleExportManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function proofBundleManifestFileName(roomTitle: string | undefined, manifest: ProofBundleExportManifest): string {
  const base = (roomTitle || manifest.roomId || "room")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    || "room";
  return `${base}-proof-bundle-${manifest.integrityHash}.json`;
}
