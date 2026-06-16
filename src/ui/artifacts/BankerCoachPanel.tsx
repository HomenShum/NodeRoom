import { useMemo, useState, type ReactNode } from "react";
import { FileCheck2, MessageSquareWarning, Send, TrendingUp, Sparkles, ArrowUpRight } from "lucide-react";
import { useStore } from "../../app/store";
import { buildBankerCoachPacket } from "../bankerCoachPacket";
import { focusStage } from "../stageFocus";
import { BankerCoachCueArtifact } from "./BankerCoachCueArtifact";
import { EvidenceCarouselArtifact } from "./EvidenceCarouselArtifact";
import { ReviewRoundUpdateArtifact } from "./ReviewRoundUpdateArtifact";
import { RunwayMilestoneChartArtifact } from "./RunwayMilestoneChartArtifact";

type CoachTab = "evidence" | "coach" | "review" | "handoff";

/**
 * CoachCards — the banker coach surfaced as quiet, clickable TRACE CARDS inside the chat stream
 * (instead of the dense stacked panel). Each cue clicks through to the exact cell it is about,
 * reusing the evidence card's targetArtifactId/targetElementId. Renders nothing when there is
 * nothing to coach, so it never adds chrome to a clean room.
 */
export function CoachCards({ roomId, onOpenArtifact }: {
  roomId: string;
  onOpenArtifact: (id: string, options?: { split?: boolean; elementId?: string }) => boolean | void;
}) {
  const store = useStore();
  const room = store.getRoom(roomId);
  const artifacts = store.listArtifacts(roomId);
  const traces = store.listTraces(roomId);
  const packet = useMemo(
    () => buildBankerCoachPacket({ roomTitle: room?.title ?? "NodeRoom", artifacts, traces }),
    [room?.title, artifacts, traces],
  );
  const [expanded, setExpanded] = useState(false);
  const cues = packet.cues;
  if (cues.length === 0) return null;
  const cardById = new Map(packet.evidenceCards.map((c) => [c.id, c]));
  const targetFor = (cue: typeof cues[number]) =>
    cue.evidenceIds.map((id) => cardById.get(id)).find((c) => c?.targetArtifactId);
  const needsReview = packet.readiness.needsReview + packet.readiness.manual + packet.readiness.estimated;
  const shown = expanded ? cues : cues.slice(0, 2);
  return (
    <div className="r-coachcards" data-testid="coach-cards">
      <div className="r-coachcards-head">
        <Sparkles size={12} />
        <span className="r-coachcards-title">Coach</span>
        <span className="grow" />
        <span className="r-coachcards-meta" data-ready={String(packet.readiness.readyForClientUse)}>
          {packet.readiness.readyForClientUse ? "verified" : `${needsReview} to review`}
        </span>
      </div>
      {shown.map((cue) => {
        const card = targetFor(cue);
        const clickable = !!card?.targetArtifactId;
        return (
          <button
            key={cue.id}
            type="button"
            className="r-coachcard"
            data-sev={cue.severity}
            disabled={!clickable}
            onClick={() => { if (card?.targetArtifactId) onOpenArtifact(card.targetArtifactId, { split: true, elementId: card.targetElementId }); }}
          >
            <span className="r-coachcard-dot" />
            <span className="r-coachcard-text">
              <span className="r-coachcard-title">{cue.title}</span>
              <span className="r-coachcard-body">{cue.body}</span>
            </span>
            {clickable && <span className="r-coachcard-act">{cue.actionLabel} <ArrowUpRight size={11} /></span>}
          </button>
        );
      })}
      {cues.length > 2 && (
        <button type="button" className="r-coachcards-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show less" : `Show ${cues.length - 2} more`}
        </button>
      )}
    </div>
  );
}

export function BankerCoachPanel({
  roomId,
  onOpenArtifact,
}: {
  roomId: string;
  onOpenArtifact: (artifactId: string, options?: { split?: boolean; elementId?: string }) => boolean | void;
}) {
  const store = useStore();
  const room = store.getRoom(roomId);
  const artifacts = store.listArtifacts(roomId);
  const traces = store.listTraces(roomId);
  const packet = useMemo(
    () => buildBankerCoachPacket({ roomTitle: room?.title ?? "NodeRoom", artifacts, traces }),
    [room?.title, artifacts, traces],
  );
  const [tab, setTab] = useState<CoachTab>("evidence");
  const needsReview = packet.readiness.needsReview + packet.readiness.manual + packet.readiness.estimated;

  const openEvidenceArtifact = (artifactId: string, elementId?: string) => {
    const opened = onOpenArtifact(artifactId, { split: true, elementId });
    if (opened !== false) focusStage({ artifactId, elementId });
  };

  return (
    <section className="r-coach-panel" data-testid="banker-coach-panel" aria-label="Banker coach artifacts">
      <div className="r-coach-head">
        <div>
          <span className="kicker">Banker coach</span>
          <strong>{packet.company}</strong>
        </div>
        <span data-ready={String(packet.readiness.readyForClientUse)}>
          {packet.readiness.readyForClientUse ? "verified" : `${needsReview} review`}
        </span>
      </div>
      <div className="r-coach-tabs" role="tablist" aria-label="Banker coach artifact tabs">
        <CoachTabButton tab="evidence" active={tab} onClick={setTab} icon={<FileCheck2 size={12} />} label="Evidence" />
        <CoachTabButton tab="coach" active={tab} onClick={setTab} icon={<MessageSquareWarning size={12} />} label="Coach" />
        <CoachTabButton tab="review" active={tab} onClick={setTab} icon={<TrendingUp size={12} />} label="Review" />
        <CoachTabButton tab="handoff" active={tab} onClick={setTab} icon={<Send size={12} />} label="Handoff" />
      </div>
      <div className="r-coach-body">
        {tab === "evidence" && <EvidenceCarouselArtifact cards={packet.evidenceCards} onOpenArtifact={openEvidenceArtifact} />}
        {tab === "coach" && <BankerCoachCueArtifact cues={packet.cues} />}
        {tab === "review" && (
          <>
            <RunwayMilestoneChartArtifact rows={packet.runwayMilestones} />
            <ReviewRoundUpdateArtifact update={packet.reviewUpdate} />
          </>
        )}
        {tab === "handoff" && (
          <div className="r-coach-handoff" data-testid="coach-handoff-artifact">
            {packet.downstreamDrafts.map((draft) => (
              <article key={draft.target}>
                <strong>{draft.label}</strong>
                <span>{draft.status.replace(/_/g, " ")}</span>
                <small>{draft.approvalGate} - {draft.sourceArtifactCount} artifacts</small>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function CoachTabButton({
  tab,
  active,
  onClick,
  icon,
  label,
}: {
  tab: CoachTab;
  active: CoachTab;
  onClick: (tab: CoachTab) => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button type="button" role="tab" aria-selected={active === tab} data-on={String(active === tab)} onClick={() => onClick(tab)}>
      {icon}
      {label}
    </button>
  );
}
