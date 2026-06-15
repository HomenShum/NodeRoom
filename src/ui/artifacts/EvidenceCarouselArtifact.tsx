import { ArrowUpRight, FileCheck2 } from "lucide-react";
import type { EvidenceCardArtifact } from "../bankerCoachPacket";

export function EvidenceCarouselArtifact({
  cards,
  onOpenArtifact,
}: {
  cards: EvidenceCardArtifact[];
  onOpenArtifact?: (artifactId: string, elementId?: string) => void;
}) {
  return (
    <div className="r-coach-evidence" data-testid="coach-evidence-artifact">
      {cards.map((card, index) => {
        const canOpen = !!card.targetArtifactId && !!onOpenArtifact;
        const body = (
          <>
            <div className="r-coach-card-head">
              <FileCheck2 size={13} />
              <strong>{card.label}</strong>
              <span data-status={card.status}>{card.status.replace(/_/g, " ")}</span>
            </div>
            <p>{card.quote}</p>
            <small>{card.sourceRef} - {Math.round(card.confidence * 100)}%</small>
          </>
        );
        return canOpen ? (
          <button
            key={card.id}
            type="button"
            className="r-coach-card r-coach-card-button"
            data-testid="coach-evidence-card"
            aria-label={`Open evidence source ${index + 1}`}
            onClick={() => onOpenArtifact?.(card.targetArtifactId!, card.targetElementId)}
          >
            {body}
            <ArrowUpRight className="r-coach-open" size={12} />
          </button>
        ) : (
          <article key={card.id} className="r-coach-card" data-testid="coach-evidence-card">
            {body}
          </article>
        );
      })}
    </div>
  );
}
