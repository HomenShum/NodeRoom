import { useMemo, useState, type ReactNode } from "react";
import { FileCheck2, FileDown, MessageSquareWarning, Send, TrendingUp, Sparkles, ArrowUpRight, ChevronRight } from "lucide-react";
import { useAction } from "convex/react";
import type { FunctionReference } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { useStore, type ActorProof, type OkfTraceLensTelemetry } from "../../app/store";
import { buildBankerCoachPacket } from "../bankerCoachPacket";
import { focusStage } from "../stageFocus";
import { BankerCoachCueArtifact } from "./BankerCoachCueArtifact";
import { EvidenceCarouselArtifact } from "./EvidenceCarouselArtifact";
import { ReviewRoundUpdateArtifact } from "./ReviewRoundUpdateArtifact";
import { RunwayMilestoneChartArtifact } from "./RunwayMilestoneChartArtifact";

type CoachTab = "evidence" | "coach" | "review" | "handoff";

type EvidenceBundleResult =
  | { ok: true; artifactIds: string[]; manifestHash: string }
  | { ok: false; reason: string };

// convex/_generated lags until the next codegen — which must NOT be run
// casually: `npx convex codegen` against a configured cloud deployment
// DEPLOYS schema+functions (documented gotcha). Same cast precedent as
// Landing.tsx's landingMetricsQuery.
const buildEvidenceBundleRef = (api as unknown as {
  auditBundle: {
    buildEvidenceBundle: FunctionReference<
      "action",
      "public",
      { roomId: string; artifactId: string; requester: ActorProof },
      EvidenceBundleResult
    >;
  };
}).auditBundle.buildEvidenceBundle;

/**
 * "Export evidence bundle" — the audit deliverable (CSV + sources + trace +
 * signed manifest) as downloadable room files. Mounted ONLY in live (convex)
 * mode: memory mode has no ConvexProvider, so useAction would throw
 * (Landing.tsx's live-only-mount precedent).
 */
function ExportEvidenceBundleButton({ roomId, artifactId, requester, onOpenArtifact }: {
  roomId: string;
  artifactId: string;
  requester: ActorProof;
  onOpenArtifact: (artifactId: string, options?: { split?: boolean; elementId?: string }) => boolean | void;
}) {
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");
  const build = useAction(buildEvidenceBundleRef);
  return (
    <button
      type="button"
      className="r-mini-btn"
      data-testid="export-evidence-bundle"
      disabled={state === "busy"}
      title="Export a signed evidence bundle — sheet CSV, evidence sources, trace excerpt, and a hashed manifest — as downloadable room files"
      onClick={() => {
        setState("busy");
        void build({ roomId, artifactId, requester })
          .then((res) => {
            if (!res.ok) {
              setState("error");
              return;
            }
            setState("idle");
            // The manifest (last part) is the receipt that names every other part.
            const manifestId = res.artifactIds[res.artifactIds.length - 1];
            if (manifestId) onOpenArtifact(manifestId, { split: true });
          })
          .catch(() => setState("error"));
      }}
    >
      <FileDown size={12} /> {state === "busy" ? "Exporting…" : state === "error" ? "Export failed — retry" : "Export evidence bundle"}
    </button>
  );
}

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
  const [open, setOpen] = useState(true);
  const cues = packet.cues;
  const lens = store.okfTraceLens(roomId);
  if (cues.length === 0 && !lens) return null;
  const cardById = new Map(packet.evidenceCards.map((c) => [c.id, c]));
  const targetFor = (cue: typeof cues[number]) =>
    cue.evidenceIds.map((id) => cardById.get(id)).find((c) => c?.targetArtifactId);
  const needsReview = packet.readiness.needsReview + packet.readiness.manual + packet.readiness.estimated;
  return (
    <div className="r-coachcards" data-testid="coach-cards" data-open={String(open)}>
      <button type="button" className="r-coachcards-head" aria-expanded={open} aria-label={open ? "Collapse coach" : "Expand coach"} onClick={() => setOpen((v) => !v)}>
        <ChevronRight size={13} className="r-coachcards-chev" style={{ transform: open ? "rotate(90deg)" : "none" }} />
        <Sparkles size={12} />
        <span className="r-coachcards-title">Coach</span>
        <span className="grow" />
        <span className="r-coachcards-meta" data-ready={String(packet.readiness.readyForClientUse)}>
          {lens ? `${lens.concepts.length} OKF refs` : packet.readiness.readyForClientUse ? "verified" : `${needsReview} to review`}
        </span>
      </button>
      {open && lens && <TraceLensCard lens={lens} />}
      {open && cues.map((cue) => {
        const card = targetFor(cue);
        const clickable = !!card?.targetArtifactId;
        return (
          <button
            key={cue.id}
            type="button"
            className="r-coachcard"
            data-testid="coach-card"
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
    </div>
  );
}

function TraceLensCard({ lens }: { lens: OkfTraceLensTelemetry }) {
  const latest = lens.events[0];
  const hotConcepts = lens.concepts.slice(0, 4);
  return (
    <section className="r-tracelens" data-testid="trace-lens" aria-label="OKF trace lens">
      <div className="r-tracelens-head">
        <span>Trace Lens</span>
        <strong>{lens.chunkCount} vectors</strong>
      </div>
      <div className="r-tracelens-metrics">
        <span>queued {lens.outbox.queued}</span>
        <span>running {lens.outbox.running}</span>
        <span>done {lens.outbox.completed}</span>
        <span>failed {lens.outbox.failed}</span>
      </div>
      {latest && (
        <div className="r-tracelens-event">
          <small>{latest.tool}</small>
          <span>{latest.query}</span>
          <em>{latest.latencyMs}ms{latest.model ? ` · ${latest.model}` : ""}</em>
        </div>
      )}
      {hotConcepts.length > 0 && (
        <div className="r-tracelens-graph">
          {hotConcepts.map((concept) => (
            <span key={concept.conceptId} title={concept.path}>{concept.title ?? concept.type}</span>
          ))}
        </div>
      )}
    </section>
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
  const lens = store.okfTraceLens(roomId);
  const needsReview = packet.readiness.needsReview + packet.readiness.manual + packet.readiness.estimated;

  const openEvidenceArtifact = (artifactId: string, elementId?: string) => {
    const opened = onOpenArtifact(artifactId, { split: true, elementId });
    if (opened !== false) focusStage({ artifactId, elementId });
  };

  return (
    <section className="r-coach-panel" data-testid="banker-coach-panel" aria-label="Banker coach artifacts" data-noderoom-surface="copilot.coachTab">
      <div className="r-coach-head">
        <div>
          <span className="kicker">Banker coach</span>
          <strong>{packet.company}</strong>
        </div>
        <span data-ready={String(packet.readiness.readyForClientUse)}>
          {packet.readiness.readyForClientUse ? "verified" : `${needsReview} review`}
        </span>
        {(() => {
          // Reveal-on-relevance: only when the room has a notebook to draft into.
          const notebook = artifacts.find((a) => a.kind === "note" && a.title !== "Agent wiki" && a.title !== "Today's Brief");
          if (!notebook) return null;
          return (
            <button
              type="button"
              className="r-mini-btn"
              data-testid="coach-draft-into-notebook"
              title="Ask the agent to draft the coach findings into the notebook as attributed, evidence-tagged notes"
              onClick={() => {
                void store.askAgent({
                  goal: `Draft the current coach findings into the notebook: summarize readiness (${packet.readiness.readyForClientUse ? "ready" : `${needsReview} items need review`}) and the open evidence gaps as a structured outline. Mark factual claims with evidence; leave anything unverified flagged needs_review.`,
                  contextArtifactId: notebook.id,
                });
                const opened = onOpenArtifact(notebook.id);
                if (opened !== false) focusStage({ artifactId: notebook.id });
              }}
            >
              <Sparkles size={12} /> Draft into notebook
            </button>
          );
        })()}
        {(() => {
          // Reveal-on-relevance: audit export only when the room has a sheet to
          // bundle, and only live — memory mode has no auditBundle action. The
          // requester proof rides the store's only proof-bearing surface
          // (privateStreamAccess returns the session ActorProof in convex mode,
          // null in memory mode); RoomShell does not thread proof into the coach.
          if (store.mode !== "convex") return null;
          const sheet = artifacts.find((a) => a.kind === "sheet");
          const requester = store.privateStreamAccess("evidence-bundle-export")?.requester;
          if (!sheet || !requester) return null;
          return (
            <ExportEvidenceBundleButton
              roomId={roomId}
              artifactId={sheet.id}
              requester={requester}
              onOpenArtifact={onOpenArtifact}
            />
          );
        })()}
      </div>
      <div className="r-coach-tabs" role="tablist" aria-label="Banker coach artifact tabs">
        <CoachTabButton tab="evidence" active={tab} onClick={setTab} icon={<FileCheck2 size={12} />} label="Evidence" />
        <CoachTabButton tab="coach" active={tab} onClick={setTab} icon={<MessageSquareWarning size={12} />} label="Coach" />
        <CoachTabButton tab="review" active={tab} onClick={setTab} icon={<TrendingUp size={12} />} label="Review" />
        <CoachTabButton tab="handoff" active={tab} onClick={setTab} icon={<Send size={12} />} label="Handoff" />
      </div>
      <div className="r-coach-body">
        {lens && <TraceLensCard lens={lens} />}
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
