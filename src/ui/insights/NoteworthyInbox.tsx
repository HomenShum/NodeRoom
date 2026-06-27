import { useState } from "react";
import { X, FileText, Table2, MessageSquare, Upload, GitBranch, Sparkles, AlertTriangle, CircleDot, Search, TableProperties, MinusCircle, GraduationCap, Send, CheckSquare, Square, HelpCircle } from "lucide-react";
import type { PassiveActivityItem } from "../../app/store";
import { NodeReveal } from "../motion/NodeReveal";

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
  costPreview,
  assistivePolicy,
  onSetPolicy,
  onOpenArtifact,
  onClose,
  onDismiss,
  onResearch,
  onBatchResearch,
  onAddToSheet,
  onPractice,
}: {
  items: PassiveActivityItem[];
  /** P3: Cost preview with p50/p90/hard cap bands and confidence. Null in memory mode. */
  costPreview?: { p50Usd: number; p90Usd: number; hardCapUsd: number; avgTokens: number; sampleSize: number; confidence: "high" | "medium" | "low"; basis: string } | null;
  /** P3: Room assistive policy for settings display. */
  assistivePolicy?: { mode: string; source: string } | null;
  /** P3: Set room assistive policy mode. */
  onSetPolicy?: (mode: string) => void;
  onOpenArtifact: (id: string, options?: { split?: boolean; elementId?: string }) => boolean | void;
  onClose: () => void;
  onDismiss?: (item: PassiveActivityItem) => void;
  onResearch?: (item: PassiveActivityItem) => void;
  /** P1: Batch approve multiple items for research at once. Deduplicates entities server-side. */
  onBatchResearch?: (items: PassiveActivityItem[]) => void;
  onAddToSheet?: (item: PassiveActivityItem) => void;
  /** Coach Mode: turn a `create_coach_cue` item into an explain-and-defend prompt.
   *  Evaluation runs as an agentJob; outcome (score, mastery tags, missed evidence
   *  refs, readiness delta) lands on the activity row's finding. */
  onPractice?: (item: PassiveActivityItem, userAnswer: string) => Promise<void> | void;
}) {
  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const [whyId, setWhyId] = useState<string | null>(null);
  const [digestMode, setDigestMode] = useState(true);

  // P2: Digest mode — when 5+ items exist, group by entity name and show a compact summary.
  // This prevents the inbox from becoming a wall of cards when the user pastes a lot of content.
  const entityGroups = new Map<string, PassiveActivityItem[]>();
  for (const item of items) {
    const key = item.entityNames[0] ?? sourceLabel(item.sourceKind);
    const group = entityGroups.get(key);
    if (group) group.push(item);
    else entityGroups.set(key, [item]);
  }
  const showDigest = digestMode && items.length >= 5;
  const displayItems = showDigest
    ? Array.from(entityGroups.entries()).flatMap(([, groupItems]) =>
        groupItems.length === 1 ? groupItems : [
          { ...groupItems[0], textPreview: `${groupItems.length} mentions across ${new Set(groupItems.map((g) => g.sourceKind)).size} source type${new Set(groupItems.map((g) => g.sourceKind)).size === 1 ? "" : "s"}` },
        ],
      )
    : items;

  const researchableItems = items.filter((i) => i.status === "noteworthy");
  const allSelected = researchableItems.length > 0 && selected.size === researchableItems.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(researchableItems.map((i) => i.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBatchResearch = () => {
    if (!onBatchResearch || selected.size === 0) return;
    setBatchSubmitting(true);
    const selectedItems = items.filter((i) => selected.has(i.id));
    Promise.resolve(onBatchResearch(selectedItems)).finally(() => {
      setBatchSubmitting(false);
      setSelected(new Set());
    });
  };

  return (
    <div className="r-inbox" role="dialog" aria-label="Passive room intelligence" data-testid="noteworthy-inbox">
      <div className="r-inbox-head">
        <span className="r-inbox-title"><Sparkles size={13} /> Room intelligence</span>
        {onSetPolicy && assistivePolicy && (
          <select
            className="r-inbox-policy"
            data-testid="noteworthy-policy-select"
            value={assistivePolicy.mode}
            onChange={(e) => onSetPolicy?.(e.target.value)}
            title={`Assistive policy (${assistivePolicy.source === "system_default" ? "system default" : "room override"})`}
          >
            <option value="off">Off</option>
            <option value="suggestions_only">Suggestions only</option>
            <option value="ask_before_research">Ask before research</option>
            <option value="approved_watchlist_only">Watchlist only</option>
          </select>
        )}
        {items.length >= 5 && (
          <button
            className="r-inbox-action"
            data-testid="noteworthy-digest-toggle"
            title={showDigest ? "Show all items individually" : "Group by entity"}
            onClick={() => setDigestMode((v) => !v)}
          >
            {showDigest ? "Expand all" : "Digest"}
          </button>
        )}
        <button className="r-iconbtn" aria-label="Close inbox" onClick={onClose}><X size={14} /></button>
      </div>
      {items.length === 0 ? (
        <div className="r-inbox-empty">Nothing needs attention right now.</div>
      ) : (
        <>
          {onBatchResearch && researchableItems.length > 1 && (
            <div className="r-inbox-batch" data-testid="noteworthy-batch-bar">
              <button className="r-inbox-action" data-testid="noteworthy-select-all" onClick={toggleAll} title="Select all researchable items">
                {allSelected ? <CheckSquare size={11} /> : <Square size={11} />} {allSelected ? "Unselect all" : "Select all"}
              </button>
              {selected.size > 0 && (
                <button
                  className="r-inbox-action r-inbox-action--primary"
                  data-testid="noteworthy-batch-research"
                  disabled={batchSubmitting}
                  onClick={handleBatchResearch}
                  title={`Research ${selected.size} selected item${selected.size === 1 ? "" : "s"}`}
                >
                  <Search size={11} /> {batchSubmitting ? "Starting…" : `Research ${selected.size} selected`}
                </button>
              )}
              {costPreview && (
                <span className="r-inbox-cost" data-testid="noteworthy-cost-preview" title={`p50: $${costPreview.p50Usd.toFixed(3)} · p90: $${costPreview.p90Usd.toFixed(3)} · cap: $${costPreview.hardCapUsd.toFixed(2)} · ${costPreview.confidence} confidence · ${costPreview.sampleSize} job${costPreview.sampleSize === 1 ? "" : "s"}`}>
                  ${costPreview.p50Usd.toFixed(3)}–${costPreview.p90Usd.toFixed(3)}/job
                </span>
              )}
            </div>
          )}
        <ul className="r-inbox-list">
          {displayItems.map((item, idx) => {
            const Icon = sourceIcon(item.sourceKind);
            const pill = statusPill(item.status, item.action);
            const target = openTarget(item);
            const title = item.entityNames[0] ?? sourceLabel(item.sourceKind);
            const isCoachCue = pill.tone === "suggested" && item.action === "create_coach_cue";
            const practicing = practiceId === item.id;
            const isResearchable = pill.tone === "suggested";
            const isSelected = selected.has(item.id);
            return (
              <NodeReveal key={item.id} as="li" className="r-inbox-item" data-testid="noteworthy-item" data-tone={pill.tone} delay={idx * 60} distance={8} threshold={0}>
                  <div className="r-inbox-item-head">
                    {onBatchResearch && isResearchable && (
                      <button
                        className="r-inbox-check"
                        data-testid="noteworthy-check"
                        aria-label={isSelected ? "Deselect item" : "Select item for batch research"}
                        onClick={() => toggleOne(item.id)}
                      >
                        {isSelected ? <CheckSquare size={13} /> : <Square size={13} />}
                      </button>
                    )}
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
                  <div className="r-inbox-actions">
                    {onResearch && pill.tone !== "researching" && (
                      <button
                        className="r-inbox-action"
                        data-testid="noteworthy-research"
                        title="Start research on this entity"
                        onClick={() => onResearch(item)}
                      >
                        <Search size={11} /> Research
                      </button>
                    )}
                    {onAddToSheet && (
                      <button
                        className="r-inbox-action"
                        data-testid="noteworthy-add"
                        title="Add or open this entity on the research sheet without overwriting existing fields"
                        onClick={() => onAddToSheet(item)}
                      >
                        <TableProperties size={11} /> Add to sheet
                      </button>
                    )}
                    {onPractice && isCoachCue && !practicing && (
                      <button
                        className="r-inbox-action"
                        data-testid="noteworthy-practice"
                        title="Coach Mode: practice explaining and defending this work"
                        onClick={() => { setPracticeId(item.id); setAnswer(""); }}
                      >
                        <GraduationCap size={11} /> Practice
                      </button>
                    )}
                    {onDismiss && (
                      <button
                        className="r-inbox-action r-inbox-action--dismiss"
                        data-testid="noteworthy-dismiss"
                        title="Dismiss — remove from active feed"
                        onClick={() => onDismiss(item)}
                      >
                        <MinusCircle size={11} /> Dismiss
                      </button>
                    )}
                    {target && (
                      <button
                        className="r-inbox-open"
                        data-testid="noteworthy-open"
                        onClick={() => onOpenArtifact(target.artifactId, { elementId: target.elementId })}
                      >
                        Open {sourceLabel(item.sourceKind).toLowerCase()}
                      </button>
                    )}
                    <button
                      className="r-inbox-action"
                      data-testid="noteworthy-why"
                      title="Why am I seeing this?"
                      onClick={() => setWhyId(whyId === item.id ? null : item.id)}
                    >
                      <HelpCircle size={11} /> Why?
                    </button>
                  </div>
                  {whyId === item.id && (
                    <div className="r-inbox-why" data-testid="noteworthy-why-panel">
                      <p className="r-inbox-why-text">
                        NodeRoom noticed {item.entityNames.length > 0 ? <b>{item.entityNames[0]}</b> : "this content"} in your {sourceLabel(item.sourceKind).toLowerCase()}.
                        {item.reasons.length > 0 && <> Signals: {item.reasons.join(" · ")}.</>}
                        {item.score > 0 && <> Relevance score: {(item.score * 100).toFixed(0)}%.</>}
                        {" "}The room flagged this because the content looks like it could benefit from background research. Click <b>Research</b> to start a agent job, or <b>Dismiss</b> to suppress similar suggestions.
                      </p>
                      {onDismiss && (
                        <div className="r-inbox-dismiss-reasons" data-testid="noteworthy-dismiss-reasons">
                          <span className="r-inbox-dismiss-label">Dismiss because:</span>
                          {[
                            { reason: "wrong_entity", label: "Wrong entity", scope: "entity" },
                            { reason: "not_relevant", label: "Not relevant", scope: "item" },
                            { reason: "too_noisy", label: "Too noisy", scope: "signal" },
                            { reason: "already_handled", label: "Already handled", scope: "item" },
                            { reason: "sensitive", label: "Sensitive", scope: "signal" },
                          ].map(({ reason, label, scope }) => (
                            <button
                              key={reason}
                              className="r-inbox-dismiss-chip"
                              data-testid={`noteworthy-dismiss-${reason}`}
                              onClick={() => onDismiss(item)}
                              title={`Dismiss and suppress ${scope === "signal" ? "similar signal types" : scope === "entity" ? "this entity" : "this item"} in future`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {practicing && (
                    <div className="r-inbox-practice" data-testid="noteworthy-practice-form">
                      <div className="r-inbox-practice-prompt">
                        <strong>Explain and defend this work.</strong>
                        <span className="muted tiny">Your answer is scored against the room's evidence, OKF concepts, and source captures. Ungrounded claims are dropped.</span>
                      </div>
                      <textarea
                        className="r-inbox-practice-input"
                        data-testid="noteworthy-practice-answer"
                        rows={3}
                        placeholder="Explain why this is right (or what's missing)…"
                        value={answer}
                        onChange={(e) => setAnswer(e.target.value)}
                        disabled={submitting}
                      />
                      <div className="r-inbox-practice-actions">
                        <button
                          className="r-inbox-action"
                          data-testid="noteworthy-practice-submit"
                          disabled={submitting || answer.trim().length === 0}
                          onClick={() => {
                            setSubmitting(true);
                            Promise.resolve(onPractice?.(item, answer.trim())).finally(() => {
                              setSubmitting(false);
                              setPracticeId(null);
                              setAnswer("");
                            });
                          }}
                        >
                          <Send size={11} /> {submitting ? "Submitting…" : "Submit"}
                        </button>
                        <button
                          className="r-inbox-action r-inbox-action--dismiss"
                          onClick={() => { setPracticeId(null); setAnswer(""); }}
                        >
                          <X size={11} /> Cancel
                        </button>
                      </div>
                    </div>
                  )}
              </NodeReveal>
            );
          })}
        </ul>
        </>
      )}
    </div>
  );
}
