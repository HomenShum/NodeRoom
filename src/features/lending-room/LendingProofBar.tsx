import { useMemo, useState } from "react";
import { Download, FileCheck2, ShieldCheck } from "lucide-react";

import { useStore } from "../../app/store";
import { SMB_LENDING_PROPOSAL, SMB_LENDING_VERIFIED_BUNDLE } from "../../app/smbLendingRoomSeed";
import { reopenLendingPacketBundle } from "../../domains/smbLending";

export function LendingProofBar({ roomId }: { roomId: string }) {
  const store = useStore();
  const [exportResult, setExportResult] = useState<string | null>(null);
  const evidence = store.listArtifacts(roomId).find((artifact) => artifact.title === "Evidence checklist");
  const exportArtifact = store.listArtifacts(roomId).find((artifact) => artifact.title === "Export bundle");
  const status = String(evidence?.elements[`${SMB_LENDING_PROPOSAL.documentId}__status`]?.value ?? "unknown");
  const source = String(evidence?.elements[`${SMB_LENDING_PROPOSAL.documentId}__source`]?.value ?? "not supplied");
  const verified = status === "verified";
  const persistedBundle = String(exportArtifact?.elements.doc?.value ?? "");
  const bundleText = persistedBundle.startsWith("{") ? persistedBundle : store.mode === "memory" && verified ? SMB_LENDING_VERIFIED_BUNDLE : "";
  const reopened = useMemo(() => {
    if (!verified || !bundleText) return null;
    try { return reopenLendingPacketBundle(bundleText); } catch { return null; }
  }, [bundleText, verified]);

  const exportAndReopen = () => {
    const bundle = reopenLendingPacketBundle(bundleText);
    const blob = new Blob([bundleText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${bundle.application.caseId}-human-review-packet.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setExportResult(`Reopened and verified ${bundle.receipt.applicationHash.slice(0, 12)} / ${bundle.receipt.packetHash.slice(0, 12)}`);
  };

  return (
    <aside className="r-lending-proof-bar" data-testid="smb-lending-proof-bar" aria-label="SMB lending workflow proof">
      <span className="r-lending-proof-state" data-state={status} data-testid="smb-lending-evidence-state">
        {verified ? <ShieldCheck size={14} /> : <FileCheck2 size={14} />}
        Evidence <b>{status}</b>
      </span>
      <span className="r-lending-proof-source" title={source}>{verified ? source : "Approve the sequential review proposal"}</span>
      <button
        type="button"
        className="r-btn primary"
        data-testid="smb-lending-export-bundle"
        disabled={!verified || !reopened}
        onClick={exportAndReopen}
      >
        <Download size={14} /> Export + reopen proof
      </button>
      {exportResult && <span role="status" data-testid="smb-lending-export-result">{exportResult}</span>}
    </aside>
  );
}
