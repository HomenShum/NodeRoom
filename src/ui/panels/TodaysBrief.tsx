/**
 * Today's Brief — a DERIVED DOCUMENT tab (like the Wiki), not a bespoke surface. It reads the room's
 * banker-coach packet and renders the ranked next actions, evidence, and handoff drafts as prose using
 * the shared `.r-wiki-doc` notebook styling. Always reflects current room state (no stored snapshot),
 * so it never drifts. Title-routed to a `kind:"note"` "Today's Brief" artifact in Artifact.tsx.
 */
import { useMemo, useState } from "react";
import { useStore } from "../../app/store";
import { buildBankerCoachPacket } from "../bankerCoachPacket";
import { buildDownstreamHandoffDraft, type DownstreamHandoffTarget, type DownstreamHandoffDraftPreview } from "../downstreamHandoff";
import type { Artifact as Art } from "../../engine/types";

const SEV_LABEL: Record<string, string> = { risk: "Risk", watch: "Watch", info: "Note" };
const SEV_RANK: Record<string, number> = { risk: 0, watch: 1, info: 2 };
const HANDOFF: { id: DownstreamHandoffTarget; label: string }[] = [
  { id: "gmail", label: "Gmail" }, { id: "slack", label: "Slack" }, { id: "notion", label: "Notion" },
  { id: "linear", label: "Linear" }, { id: "linkedin", label: "LinkedIn" }, { id: "crm", label: "CRM CSV" },
];

export function TodaysBrief({ roomId, onOpenArtifact }: {
  roomId: string;
  onOpenArtifact: (art: Art) => void;
}) {
  const store = useStore();
  const arts = store.listArtifacts(roomId);
  const room = store.getRoom(roomId);
  const traces = store.listTraces(roomId);
  const packet = useMemo(
    () => buildBankerCoachPacket({ roomTitle: room?.title ?? "NodeRoom", artifacts: arts, traces }),
    [room?.title, arts, traces],
  );
  const ranked = useMemo(
    () => [...packet.cues].sort((a, b) => (SEV_RANK[a.severity] ?? 9) - (SEV_RANK[b.severity] ?? 9)),
    [packet.cues],
  );
  const [draft, setDraft] = useState<DownstreamHandoffDraftPreview | null>(null);
  const r = packet.readiness;

  const openById = (artifactId?: string) => {
    const a = artifactId ? arts.find((x) => x.id === artifactId) : undefined;
    if (a) onOpenArtifact(a);
  };
  const openCueSource = (evidenceIds: string[]) => {
    const card = packet.evidenceCards.find((c) => evidenceIds.includes(c.id) && c.targetArtifactId);
    openById(card?.targetArtifactId);
  };

  return (
    <div className="r-art-body" data-testid="brief-surface" data-noderoom-surface="workSurface.brief">
      <article className="r-wiki-doc r-brief-doc">
        <p className="kicker">Agent-assembled brief</p>
        <h1>Today&apos;s Brief</h1>
        <p>{packet.company} — {packet.claim}</p>
        <div className="r-wiki-metrics" data-testid="brief-readiness">
          <span><b>{r.verified}</b> verified</span>
          <span><b>{r.needsReview}</b> need review</span>
          <span><b>{r.manual}</b> manual</span>
          <span><b>{r.readyForClientUse ? "yes" : "not yet"}</b> client-ready</span>
        </div>

        <h2>Next actions</h2>
        <ol className="r-brief-actions" data-testid="brief-actions">
          {ranked.length === 0 && <li>No actions yet — capture a signal or run the agent to build the brief.</li>}
          {ranked.map((cue) => (
            <li key={cue.id} data-severity={cue.severity} data-testid="brief-action">
              <span className="r-brief-sev" data-sev={cue.severity}>{SEV_LABEL[cue.severity] ?? cue.severity}</span>
              <strong>{cue.title}</strong>
              <p>{cue.body}</p>
              {cue.evidenceIds.length > 0 && (
                <button type="button" className="r-brief-link" data-testid="brief-evidence" onClick={() => openCueSource(cue.evidenceIds)}>
                  {cue.actionLabel || "Open source"} →
                </button>
              )}
            </li>
          ))}
        </ol>

        {packet.evidenceCards.length > 0 && (
          <>
            <h2>Evidence</h2>
            <ul className="r-brief-evidence">
              {packet.evidenceCards.map((c) => (
                <li key={c.id}>
                  <button type="button" className="r-brief-link" onClick={() => openById(c.targetArtifactId)}>{c.label}</button>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2>Hand off</h2>
        <p className="r-brief-handoff" data-testid="brief-handoff">
          {HANDOFF.map((t) => (
            <button
              key={t.id}
              type="button"
              className="r-brief-link"
              data-active={String(draft?.target === t.id)}
              data-testid={`brief-handoff-${t.id}`}
              onClick={() => setDraft(buildDownstreamHandoffDraft(t.id, { roomTitle: room?.title ?? "NodeRoom", artifacts: arts }))}
            >
              {t.label}
            </button>
          ))}
        </p>
        {draft && (
          <div data-testid="brief-draft">
            <p className="r-brief-draft-title">{draft.title}{draft.approvalRequired ? " · approval required" : ""}</p>
            <pre className="r-brief-draft">{draft.body}</pre>
            <p className="faint">Sources: {draft.sourceSummary}</p>
          </div>
        )}
      </article>
    </div>
  );
}
