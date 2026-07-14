import { useMemo, useState, type ReactElement } from "react";
import { CheckCircle2, FileDown, FileText, Network, ShieldAlert, X } from "lucide-react";
import type { SemanticGraphViewModel } from "../graph/semanticGraphTypes";
import {
  buildGraphRelationshipReviewPlan,
  graphRelationshipReviewFileName,
  graphRelationshipReviewJson,
  graphRelationshipReviewMimeType,
  type GraphRelationshipReviewItem,
} from "./graphRelationshipReview";

function reviewStatusLabel(status: GraphRelationshipReviewItem["reviewStatus"]): string {
  return status === "confirmed" ? "Confirmed" : "Confirm";
}

export function GraphRelationshipReviewWorkbench({
  graph,
  graphId,
  onClose,
  onOpenArtifact,
}: {
  graph: SemanticGraphViewModel;
  graphId: string;
  onClose: () => void;
  onOpenArtifact: (artifactId: string) => void;
}): ReactElement {
  const plan = useMemo(() => buildGraphRelationshipReviewPlan(graph, graphId), [graph, graphId]);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const downloadReview = () => {
    const fileName = graphRelationshipReviewFileName(graphId, plan.integrityHash);
    const blob = new Blob([graphRelationshipReviewJson(plan)], { type: graphRelationshipReviewMimeType() });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setExportMessage(`Downloaded ${fileName}`);
  };

  return (
    <section className="wa-graph-review" data-testid="graph-relationship-review-workbench" aria-label="Graph relationship review workbench">
      <header className="wa-graph-review-head">
        <div>
          <p className="wa-eyebrow">Graph relationship review</p>
          <h3>Proof graph confirmations</h3>
          <p>Confirm which graph relationships are source-backed, proposal-linked, or still inferred.</p>
        </div>
        <div className="wa-graph-review-actions">
          <button type="button" className="wa-deck-export" data-testid="graph-relationship-plan-export-json" onClick={downloadReview}>
            <FileDown size={13} />
            Review JSON
          </button>
          <button type="button" className="wa-deck-close" onClick={onClose} aria-label="Close graph review">
            <X size={14} />
          </button>
        </div>
      </header>

      <div className="wa-graph-review-meta">
        <span><Network size={12} /> {plan.nodeCount} nodes</span>
        <span>{plan.edgeCount} edges</span>
        <span>{plan.relationshipCount} relationships</span>
        <span data-status="confirmed"><CheckCircle2 size={12} /> {plan.confirmedCount} confirmed</span>
        <span data-status="needs_confirmation"><ShieldAlert size={12} /> {plan.needsConfirmationCount} confirm</span>
        <span>review {plan.integrityHash}</span>
      </div>

      {exportMessage && (
        <div className="wa-export-message" role="status" data-testid="graph-relationship-export-status">
          {exportMessage}
          <button type="button" onClick={() => setExportMessage(null)}>Dismiss</button>
        </div>
      )}

      <div className="wa-graph-review-grid" role="list" aria-label="Graph relationship confirmations">
        {plan.items.slice(0, 12).map((item) => (
          <article key={item.relationshipId} className="wa-graph-review-card" role="listitem" data-status={item.reviewStatus} data-testid="graph-relationship-review-card">
            <div className="wa-graph-review-icon" aria-hidden="true">
              {item.reviewStatus === "confirmed" ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
            </div>
            <div className="wa-graph-review-copy">
              <div className="wa-graph-review-title">
                <span>{item.sourceLabel}</span>
                <span>{reviewStatusLabel(item.reviewStatus)}</span>
              </div>
              <p>
                <b>{item.relationshipLabel}</b> {item.targetLabel}
              </p>
              <p>{item.reason}</p>
              <div className="wa-graph-review-refs">
                <span>{item.edgeKind}</span>
                <span>{item.graphStatus}</span>
                <span>{item.sourceArtifactIds.length} artifacts</span>
                <span>{item.evidenceIds.length} evidence</span>
                <span>{item.proposalIds.length} proposals</span>
                <span>{item.traceIds.length} traces</span>
              </div>
            </div>
            <div className="wa-graph-review-card-actions">
              {item.sourceArtifactIds[0] && (
                <button type="button" onClick={() => onOpenArtifact(item.sourceArtifactIds[0])}>
                  <FileText size={12} />
                  Source
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
