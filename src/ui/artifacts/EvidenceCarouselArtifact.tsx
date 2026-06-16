import { ArrowUpRight, FileCheck2 } from "lucide-react";
import type { EvidenceCardArtifact } from "../bankerCoachPacket";

/** Human locator for a card's literal source: web domain, or sheet/page/cell coordinates. */
function sourceLabel(card: EvidenceCardArtifact): string {
  if (card.sourceUrl) {
    try { return new URL(card.sourceUrl).hostname.replace(/^www\./, ""); } catch { /* fall through */ }
  }
  const loc = card.sourceLocator;
  if (loc) {
    const parts: string[] = [];
    if (loc.sheetName) parts.push(loc.sheetName);
    if (loc.page != null) parts.push(`p.${loc.page}`);
    if (loc.column && loc.row != null) parts.push(`${loc.column}${loc.row}`);
    else if (loc.row != null) parts.push(`row ${loc.row}`);
    if (parts.length) return parts.join(" · ");
  }
  return card.sourceRef;
}

export function EvidenceCarouselArtifact({
  cards,
  onOpenArtifact,
}: {
  cards: EvidenceCardArtifact[];
  onOpenArtifact?: (artifactId: string, elementId?: string) => void;
}) {
  return (
    <div className="r-coach-evidence" data-testid="coach-evidence-artifact">
      {cards.map((card) => {
        // Open the LITERAL source: a real web page for url-backed evidence, else the source artifact
        // (opened split-screen at its cell by the caller). Falls back to the claim cell.
        const href = card.sourceUrl && /^https?:\/\//i.test(card.sourceUrl) ? card.sourceUrl : null;
        const openId = card.sourceArtifactId ?? card.targetArtifactId;
        const canOpenInternal = !href && !!openId && !!onOpenArtifact;
        const body = (
          <>
            <div className="r-coach-card-head">
              <FileCheck2 size={13} />
              <strong>{card.label}</strong>
              <span data-status={card.status}>{card.status.replace(/_/g, " ")}</span>
            </div>
            <p>{card.quote}</p>
            <small className="r-evidence-src">
              <span className="r-evidence-loc" title={card.sourceRef}>{sourceLabel(card)}</span>
              {(href || canOpenInternal) && <span className="r-evidence-open">Open source <ArrowUpRight size={11} /></span>}
              <span className="r-evidence-conf">{Math.round(card.confidence * 100)}%</span>
            </small>
          </>
        );
        if (href) {
          return (
            <a key={card.id} className="r-coach-card r-coach-card-button" data-testid="coach-evidence-card" href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open source ${sourceLabel(card)} for ${card.label}`}>
              {body}
            </a>
          );
        }
        if (canOpenInternal) {
          return (
            <button key={card.id} type="button" className="r-coach-card r-coach-card-button" data-testid="coach-evidence-card" aria-label={`Open source for ${card.label}`} onClick={() => onOpenArtifact?.(openId!, card.targetElementId)}>
              {body}
            </button>
          );
        }
        return (
          <article key={card.id} className="r-coach-card" data-testid="coach-evidence-card">
            {body}
          </article>
        );
      })}
    </div>
  );
}
