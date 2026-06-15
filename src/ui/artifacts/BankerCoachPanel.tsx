import { useMemo, useState, type ReactNode } from "react";
import { FileCheck2, MessageSquareWarning, Send, TrendingUp } from "lucide-react";
import { useStore } from "../../app/store";
import { buildBankerCoachPacket } from "../bankerCoachPacket";
import { focusStage } from "../stageFocus";
import { BankerCoachCueArtifact } from "./BankerCoachCueArtifact";
import { EvidenceCarouselArtifact } from "./EvidenceCarouselArtifact";
import { ReviewRoundUpdateArtifact } from "./ReviewRoundUpdateArtifact";
import { RunwayMilestoneChartArtifact } from "./RunwayMilestoneChartArtifact";

type CoachTab = "evidence" | "coach" | "review" | "handoff";

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
