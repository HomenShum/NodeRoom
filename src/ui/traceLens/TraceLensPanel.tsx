import { useMemo } from "react";
import { X, FileSearch, Activity, Lock, ArrowUpRight, ShieldCheck } from "lucide-react";
import { useStore } from "../../app/store";
import { buildBankerCoachPacket, type EvidenceCardArtifact } from "../bankerCoachPacket";
import { NodeCount } from "../motion/NodeCount";
import { NodeReveal } from "../motion/NodeReveal";
import { surfaceMeta } from "./surfaces";
import { useTraceLens } from "./useTraceLens";

function sourceLabel(card: EvidenceCardArtifact): string {
  if (card.sourceUrl) { try { return new URL(card.sourceUrl).hostname.replace(/^www\./, ""); } catch { /* noop */ } }
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

/**
 * Trace Lens inspector. Opens on Cmd/Ctrl+click of any [data-noderoom-surface]. Review Mode (default,
 * banker-safe) shows Business Proof + Runtime Trace from already-loaded store state -- no new fetch, no
 * code paths. The Code region is rendered ONLY when builderCapable (server-verified) is true; until the
 * convex/traceLens code-ownership query ships it stays gated, so no source-tree info reaches the client.
 */
export function TraceLensPanel({
  roomId,
  onOpenArtifact,
}: {
  roomId: string;
  onOpenArtifact: (id: string, options?: { split?: boolean; elementId?: string }) => boolean | void;
}) {
  const store = useStore();
  const { open, hit, mode, builderCapable, close, setMode } = useTraceLens();
  const room = store.getRoom(roomId);
  const artifacts = store.listArtifacts(roomId);
  const traces = store.listTraces(roomId);

  const packet = useMemo(
    () => (open ? buildBankerCoachPacket({ roomTitle: room?.title ?? "NodeRoom", artifacts, traces }) : null),
    [open, room?.title, artifacts, traces],
  );

  const meta = surfaceMeta(hit?.surfaceId);
  const proofCards = useMemo(() => {
    if (!packet || !hit) return [] as EvidenceCardArtifact[];
    if (hit.elementId) return packet.evidenceCards.filter((c) => c.targetElementId === hit.elementId);
    if (hit.artifactId) return packet.evidenceCards.filter((c) => c.targetArtifactId === hit.artifactId).slice(0, 4);
    return [];
  }, [packet, hit]);

  const relevantTraces = useMemo(() => {
    if (!hit) return [] as typeof traces;
    const scoped = hit.artifactId ? traces.filter((t) => t.refs && Object.values(t.refs).includes(hit.artifactId!)) : [];
    return (scoped.length ? scoped : traces).slice().reverse();
  }, [traces, hit]);

  if (!open || !hit || !meta) return null;

  return (
    <>
      <div className="tl-backdrop" onClick={close} aria-hidden="true" />
      <aside className="tl-panel" role="dialog" aria-label={`Trace Lens: ${meta.label}`} data-testid="trace-lens-panel">
        <div className="tl-head">
          <FileSearch size={14} />
          <span className="tl-title">{meta.label}</span>
          {builderCapable && (
            <div className="tl-modes" role="tablist" aria-label="Trace Lens mode">
              <button type="button" role="tab" aria-selected={mode === "review"} data-on={String(mode === "review")} onClick={() => setMode("review")}>Review</button>
              <button type="button" role="tab" aria-selected={mode === "builder"} data-on={String(mode === "builder")} onClick={() => setMode("builder")}>Builder</button>
            </div>
          )}
          <span className="grow" />
          <button type="button" className="tl-close" onClick={close} aria-label="Close Trace Lens"><X size={14} /></button>
        </div>

        <div className="tl-body">
          <p className="tl-about">{meta.about}</p>

          <NodeReveal as="section" className="tl-region" delay={40} distance={8} threshold={0}>
            <div className="tl-region-head"><ShieldCheck size={12} /> Business proof</div>
            {proofCards.length ? proofCards.map((card) => (
              <NodeReveal key={card.id} className="tl-proof" data-status={card.status} delay={70} distance={6} threshold={0}>
                <div className="tl-proof-head"><strong>{card.label}</strong><span className="tl-status" data-status={card.status}>{card.status.replace(/_/g, " ")}</span></div>
                {card.quote && <p className="tl-quote">{card.quote}</p>}
                {card.reviewNote && <p className="tl-note">{card.reviewNote}</p>}
                <div className="tl-proof-foot">
                  <span className="tl-loc">{sourceLabel(card)} · <NodeCount value={Math.round(card.confidence * 100)} duration={650} suffix="%" ariaLabel={`${Math.round(card.confidence * 100)}% confidence`} /></span>
                  {(card.sourceUrl || card.sourceArtifactId || card.targetArtifactId) && (
                    card.sourceUrl && /^https?:\/\//i.test(card.sourceUrl)
                      ? <a className="tl-open" href={card.sourceUrl} target="_blank" rel="noopener noreferrer">Open source <ArrowUpRight size={11} /></a>
                      : <button type="button" className="tl-open" onClick={() => { const id = card.sourceArtifactId ?? card.targetArtifactId; if (id) { onOpenArtifact(id, { split: true, elementId: card.targetElementId }); close(); } }}>Open source <ArrowUpRight size={11} /></button>
                  )}
                </div>
              </NodeReveal>
            )) : (
              <p className="tl-empty">{meta.proofAvailable ? "No source-backed claim on the exact spot you clicked. Cmd/Ctrl-click a filled cell or evidence card." : "This surface has no business proof to inspect."}</p>
            )}
          </NodeReveal>

          <NodeReveal as="section" className="tl-region" delay={100} distance={8} threshold={0}>
            <div className="tl-region-head"><Activity size={12} /> Runtime trace</div>
            {relevantTraces.length ? (
              <ul className="tl-trace">
                {relevantTraces.map((t, idx) => (
                  <NodeReveal key={t.id} as="li" className="tl-trace-row" delay={idx * 35} distance={5} threshold={0}>
                    <span className="tl-trace-type">{t.type}</span>
                    <span className="tl-trace-summary" title={t.detail ?? t.summary}>{t.summary}</span>
                    <span className="tl-trace-who">{t.actor?.name ?? "system"}</span>
                  </NodeReveal>
                ))}
              </ul>
            ) : <p className="tl-empty">No recent runtime trace for this surface.</p>}
          </NodeReveal>

          <NodeReveal as="section" className="tl-region tl-region-code" delay={140} distance={8} threshold={0}>
            <div className="tl-region-head"><Lock size={12} /> Code ownership</div>
            {builderCapable && mode === "builder"
              ? <p className="tl-empty">Code provenance loads from the server (convex/traceLens) for verified builders.</p>
              : <p className="tl-empty tl-locked">Builder access only. Component, query, mutation, skill, and test for this surface are visible to NodeRoom builders, never to room guests.</p>}
          </NodeReveal>
        </div>
      </aside>
    </>
  );
}
