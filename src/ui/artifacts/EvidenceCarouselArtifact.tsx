import { ArrowUpRight, FileCheck2 } from "lucide-react";
import type { EvidenceCardArtifact } from "../bankerCoachPacket";
import { NodeCount } from "../motion/NodeCount";
import { NodeReveal } from "../motion/NodeReveal";

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
    <div className="r-coach-evidence" data-testid="coach-evidence-artifact" data-noderoom-surface="copilot.coachEvidence">
      {cards.map((card) => {
        // Open the LITERAL source: a real web page for url-backed evidence, else the source artifact
        // (opened split-screen at its cell by the caller). Falls back to the claim cell.
        const href = card.sourceUrl && /^https?:\/\//i.test(card.sourceUrl) ? card.sourceUrl : null;
        const openId = card.sourceArtifactId ?? card.targetArtifactId;
        const openElementId = card.sourceArtifactId && card.sourceArtifactId !== card.targetArtifactId ? undefined : card.targetElementId;
        const canOpenInternal = !href && !!openId && !!onOpenArtifact;
        const confidence = Math.round(card.confidence * 100);
        const body = (
          <>
            <div className="r-coach-card-head">
              <FileCheck2 size={13} />
              <strong>{card.label}</strong>
              <span data-status={card.status}>{card.status.replace(/_/g, " ")}</span>
            </div>
            <p>{card.quote}</p>
            {card.reviewNote ? <p className="r-evidence-note" data-status={card.status}>{card.reviewNote}</p> : null}
            <small className="r-evidence-src">
              <span className="r-evidence-loc" title={card.sourceRef}>{sourceLabel(card)}</span>
              {(href || canOpenInternal) && <span className="r-evidence-open">Open source <ArrowUpRight size={11} /></span>}
              {card.status === "verified" && <span className="r-evidence-conf"><NodeCount value={confidence} duration={650} suffix="%" ariaLabel={`${confidence}% confidence`} /></span>}
            </small>
          </>
        );
        if (href) {
          return (
            <NodeReveal key={card.id} delay={60} distance={8} threshold={0}>
              <a className="r-coach-card r-coach-card-button" data-testid="coach-evidence-card" data-element-id={card.targetElementId} data-artifact-id={card.targetArtifactId} data-source-artifact-id={card.sourceArtifactId} href={href} target="_blank" rel="noopener noreferrer" aria-label={`Open source ${sourceLabel(card)} for ${card.label}`}>
                {body}
              </a>
            </NodeReveal>
          );
        }
        if (canOpenInternal) {
          return (
            <NodeReveal key={card.id} delay={60} distance={8} threshold={0}>
              <button type="button" className="r-coach-card r-coach-card-button" data-testid="coach-evidence-card" data-element-id={card.targetElementId} data-artifact-id={card.targetArtifactId} data-source-artifact-id={card.sourceArtifactId} aria-label={`Open source for ${card.label}`} onClick={() => onOpenArtifact?.(openId!, openElementId)}>
                {body}
              </button>
            </NodeReveal>
          );
        }
        return (
          <NodeReveal key={card.id} delay={60} distance={8} threshold={0}>
            <article className="r-coach-card" data-testid="coach-evidence-card" data-element-id={card.targetElementId} data-artifact-id={card.targetArtifactId} data-source-artifact-id={card.sourceArtifactId}>
              {body}
            </article>
          </NodeReveal>
        );
      })}
    </div>
  );
}
