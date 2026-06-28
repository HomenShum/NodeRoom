/**
 * Brief work-surface tab — "Today's Brief": the ranked daily action list the room assembles from the
 * banker-coach packet (cues ranked risk → watch → info), each action linking through to its source,
 * plus a one-click downstream handoff DRAFT (the six targets) you can copy out. This is the headline
 * wedge surface: messy in → ranked, sourced next-action out. The packet is derived purely from room
 * artifacts, so this renders identically in memory mode (?mode=memory) and live Convex.
 */
import { useMemo, useState } from "react";
import { ListChecks, ShieldAlert, Eye, Info, ArrowRight, Copy, Check } from "lucide-react";
import { useStore } from "../../app/store";
import { buildBankerCoachPacket } from "../bankerCoachPacket";
import { buildDownstreamHandoffDraft, type DownstreamHandoffTarget, type DownstreamHandoffDraftPreview } from "../downstreamHandoff";
import { EvidenceCarouselArtifact } from "../artifacts/EvidenceCarouselArtifact";

const SEVERITY_RANK: Record<string, number> = { risk: 0, watch: 1, info: 2 };
const SEVERITY_META = {
  risk: { Icon: ShieldAlert, label: "Risk", cls: "risk" },
  watch: { Icon: Eye, label: "Watch", cls: "watch" },
  info: { Icon: Info, label: "Note", cls: "info" },
} as const;
const HANDOFF_TARGETS: { id: DownstreamHandoffTarget; label: string }[] = [
  { id: "gmail", label: "Gmail" }, { id: "slack", label: "Slack" }, { id: "notion", label: "Notion" },
  { id: "linear", label: "Linear" }, { id: "linkedin", label: "LinkedIn" }, { id: "crm", label: "CRM CSV" },
];

export function BriefSurface({ roomId, onOpenSource }: {
  roomId: string;
  onOpenSource: (artifactId: string, elementId?: string) => void;
}) {
  const store = useStore();
  const room = store.getRoom(roomId);
  const artifacts = store.listArtifacts(roomId);
  const traces = store.listTraces(roomId);
  const packet = useMemo(
    () => buildBankerCoachPacket({ roomTitle: room?.title ?? "NodeRoom", artifacts, traces }),
    [room?.title, artifacts, traces],
  );
  // Ranked: risk → watch → info (stable within a tier — the agent already orders within severity).
  const ranked = useMemo(
    () => [...packet.cues].sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9)),
    [packet.cues],
  );
  const [draft, setDraft] = useState<DownstreamHandoffDraftPreview | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = (target: DownstreamHandoffTarget) => {
    setDraft(buildDownstreamHandoffDraft(target, { roomTitle: room?.title ?? "NodeRoom", artifacts }));
    setCopied(false);
  };
  const copy = () => {
    if (!draft) return;
    void navigator.clipboard?.writeText(draft.body).then(() => setCopied(true)).catch(() => {});
  };

  // The literal source behind a cue: first evidence card with an in-room target → click opens it.
  const evidenceTarget = (evidenceIds: string[]) => {
    const card = packet.evidenceCards.find((c) => evidenceIds.includes(c.id) && c.targetArtifactId);
    return card?.targetArtifactId ? { artifactId: card.targetArtifactId, elementId: card.targetElementId } : null;
  };

  const r = packet.readiness;

  return (
    <div className="r-art-body r-briefvu" data-testid="brief-surface" data-noderoom-surface="workSurface.brief">
      <header className="r-briefvu-head">
        <div className="r-briefvu-title"><ListChecks size={16} /> Today&apos;s Brief</div>
        <div className="r-briefvu-sub">{packet.company || room?.title || "NodeRoom"} — ranked next actions, each backed by a source</div>
        <div className="r-briefvu-readiness" data-testid="brief-readiness">
          <span className="r-briefvu-rpill verified">{r.verified} verified</span>
          <span className="r-briefvu-rpill review">{r.needsReview} needs review</span>
          {r.manual > 0 && <span className="r-briefvu-rpill manual">{r.manual} manual</span>}
          <span className={`r-briefvu-rpill ${r.readyForClientUse ? "ready" : "notready"}`}>
            {r.readyForClientUse ? "ready for client use" : "not client-ready yet"}
          </span>
        </div>
      </header>

      <ol className="r-briefvu-list" data-testid="brief-actions">
        {ranked.length === 0 && (
          <li className="r-briefvu-empty">No actions yet — capture a signal or run the agent to build the brief.</li>
        )}
        {ranked.map((cue, i) => {
          const sev = SEVERITY_META[cue.severity];
          const tgt = evidenceTarget(cue.evidenceIds);
          return (
            <li key={cue.id} className="r-briefvu-item" data-severity={cue.severity} data-testid="brief-action">
              <span className="r-briefvu-rank">{i + 1}</span>
              <div className="r-briefvu-item-main">
                <div className="r-briefvu-item-top">
                  <span className={`r-briefvu-sev ${sev.cls}`}><sev.Icon size={12} /> {sev.label}</span>
                  <span className="r-briefvu-item-title">{cue.title}</span>
                </div>
                <p className="r-briefvu-item-body">{cue.body}</p>
                <div className="r-briefvu-item-actions">
                  {tgt ? (
                    <button type="button" className="r-btn ghost" data-testid="brief-evidence" onClick={() => onOpenSource(tgt.artifactId, tgt.elementId)}>
                      <ArrowRight size={11} /> {cue.actionLabel || "Open source"}
                    </button>
                  ) : cue.actionLabel ? (
                    <span className="r-briefvu-actionlabel">{cue.actionLabel}</span>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      {packet.evidenceCards.length > 0 && (
        <section className="r-briefvu-evidence">
          <h3 className="r-briefvu-h3">Evidence behind the brief</h3>
          <EvidenceCarouselArtifact cards={packet.evidenceCards} onOpenArtifact={onOpenSource} />
        </section>
      )}

      <section className="r-briefvu-handoff" data-testid="brief-handoff">
        <h3 className="r-briefvu-h3">Hand it off</h3>
        <div className="r-briefvu-handoff-targets">
          {HANDOFF_TARGETS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="r-btn ghost r-briefvu-handoff-btn"
              data-active={String(draft?.target === t.id)}
              data-testid={`brief-handoff-${t.id}`}
              onClick={() => generate(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {draft && (
          <article className="r-briefvu-draft" data-testid="brief-draft">
            <div className="r-briefvu-draft-head">
              <strong>{draft.title}</strong>
              {draft.approvalRequired && <span className="r-briefvu-draft-gate">approval required</span>}
              <span className="grow" />
              <button type="button" className="r-btn ghost" onClick={copy} data-testid="brief-draft-copy">
                {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
            </div>
            <pre className="r-briefvu-draft-body">{draft.body}</pre>
            <small className="r-briefvu-draft-src">Sources: {draft.sourceSummary}</small>
          </article>
        )}
      </section>
    </div>
  );
}
