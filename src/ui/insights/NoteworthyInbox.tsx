import { X, FileText, Table2, MessageSquare, Upload, GitBranch, Sparkles, AlertTriangle, CircleDot } from "lucide-react";
import type { PassiveActivityItem } from "../../app/store";

/** Calm return-state inbox for passive room intelligence. Lists what the room noticed,
 *  indexed, queued, or failed — never auto-edits the user's note. Click-through opens the
 *  originating cell/note on the stage when a target can be derived; otherwise the card is
 *  informational (honest about what we can't yet navigate to). */

export function sourceLabel(kind: string): string {
  switch (kind) {
    case "node": return "Note";
    case "element":
    case "artifact_element": return "Cell";
    case "upload": return "File";
    case "message": return "Message";
    case "wiki_revision": return "Wiki";
    case "artifact": return "Artifact";
    default: return "Source";
  }
}

export function sourceIcon(kind: string) {
  switch (kind) {
    case "node": return FileText;
    case "element":
    case "artifact_element": return Table2;
    case "message": return MessageSquare;
    case "upload": return Upload;
    case "wiki_revision": return GitBranch;
    default: return CircleDot;
  }
}

type Tone = "active" | "suggested" | "researching" | "failed" | "settled";

export function statusPill(status: string, action: string): { label: string; tone: Tone } {
  if (status === "failed") return { label: "Failed", tone: "failed" };
  if (status === "job_created") return { label: "Researching", tone: "researching" };
  if (status === "noteworthy") {
    if (action === "create_coach_cue") return { label: "Coach cue", tone: "suggested" };
    if (action === "index_only") return { label: "Indexed", tone: "settled" };
    return { label: "Suggested", tone: "suggested" };
  }
  if (status === "queued" || status === "scanning" || status === "running") return { label: "Indexing…", tone: "active" };
  return { label: "Settled", tone: "settled" };
}

/** Derive a stage-open target from the activity source. Only element/artifact_element rows
 *  carry an artifactId:elementId pair we can resolve today; nodes/messages/files surface as
 *  informational cards until their open paths are wired. */
export function openTarget(item: PassiveActivityItem): { artifactId: string; elementId?: string } | null {
  if (item.sourceKind === "element" || item.sourceKind === "artifact_element") {
    const [artifactId, elementId] = item.sourceId.split(":");
    if (artifactId) return { artifactId, elementId };
  }
  return null;
}

export function NoteworthyInbox({
  items,
  onOpenArtifact,
  onClose,
}: {
  items: PassiveActivityItem[];
  onOpenArtifact: (id: string, options?: { split?: boolean; elementId?: string }) => boolean | void;
  onClose: () => void;
}) {
  return (
    <div className="r-inbox" role="dialog" aria-label="Passive room intelligence" data-testid="noteworthy-inbox">
      <div className="r-inbox-head">
        <span className="r-inbox-title"><Sparkles size={13} /> Room intelligence</span>
        <button className="r-iconbtn" aria-label="Close inbox" onClick={onClose}><X size={14} /></button>
      </div>
      {items.length === 0 ? (
        <div className="r-inbox-empty">Nothing needs attention right now.</div>
      ) : (
        <ul className="r-inbox-list">
          {items.map((item) => {
            const Icon = sourceIcon(item.sourceKind);
            const pill = statusPill(item.status, item.action);
            const target = openTarget(item);
            const title = item.entityNames[0] ?? sourceLabel(item.sourceKind);
            return (
              <li key={item.id} className="r-inbox-item" data-testid="noteworthy-item" data-tone={pill.tone}>
                <div className="r-inbox-item-head">
                  <Icon size={13} />
                  <span className="r-inbox-item-title" title={title}>{title}</span>
                  <span className="r-inbox-pill" data-tone={pill.tone}>{pill.label}</span>
                </div>
                {item.textPreview && <p className="r-inbox-preview">{item.textPreview}</p>}
                <div className="r-inbox-meta">
                  <span className="r-inbox-kind">{sourceLabel(item.sourceKind)}</span>
                  {item.reasons.length > 0 && (
                    <span className="r-inbox-reasons">{item.reasons.slice(0, 3).join(" · ")}</span>
                  )}
                  {item.error && <span className="r-inbox-error" title={item.error}><AlertTriangle size={11} /> failed</span>}
                </div>
                {target && (
                  <button
                    className="r-inbox-open"
                    data-testid="noteworthy-open"
                    onClick={() => onOpenArtifact(target.artifactId, { elementId: target.elementId })}
                  >
                    Open {sourceLabel(item.sourceKind).toLowerCase()}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
