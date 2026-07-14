import { useMemo, useState, type ReactElement } from "react";
import { AlertTriangle, Check, FileText, GitPullRequest, X } from "lucide-react";
import type { Actor, Artifact, Proposal, TraceEvent } from "../../engine/types";

export type ProposalReviewFilter = "pending" | "all" | "agent_edit" | "semantic_rebase";
export type ResolveProposalFeedback = { ok: boolean; reason?: string; version?: number };
export type ProposalReviewKind = NonNullable<Proposal["review"]>["kind"];

export interface ProposalReviewItem {
  proposalId: string;
  roomId: string;
  artifactId: string;
  artifactTitle: string;
  jobId?: string;
  elementId: string;
  authorName: string;
  status: Proposal["status"];
  reviewKind?: ProposalReviewKind;
  reviewStatus?: string;
  reason?: string;
  reviewerNote?: string;
  valuePreview: string;
  baseVersion?: number;
  traceIds: string[];
  createdAt: number;
}

export interface ProposalReviewCounts {
  total: number;
  pending: number;
  agentEdit: number;
  semanticRebase: number;
  resolved: number;
}

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object" && "value" in value) return valueText((value as { value?: unknown }).value);
  if (value && typeof value === "object" && "text" in value && typeof (value as { text?: unknown }).text === "string") return (value as { text: string }).text;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function proposalValuePreview(value: unknown, max = 120): string {
  const text = valueText(value).replace(/\s+/g, " ").trim();
  if (!text) return "(empty)";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
}

export function buildProposalReviewItems(input: { proposals: Proposal[]; artifacts: Artifact[]; traces?: TraceEvent[] }): ProposalReviewItem[] {
  const artifactTitle = new Map(input.artifacts.map((artifact) => [artifact.id, artifact.title]));
  const traces = input.traces ?? [];
  return input.proposals
    .map((proposal): ProposalReviewItem => ({
      proposalId: proposal.id,
      roomId: proposal.roomId,
      artifactId: proposal.artifactId,
      artifactTitle: artifactTitle.get(proposal.artifactId) ?? proposal.artifactId,
      jobId: proposal.jobId,
      elementId: proposal.op.elementId,
      authorName: proposal.author.name,
      status: proposal.status,
      reviewKind: proposal.review?.kind,
      reviewStatus: proposal.review?.status,
      reason: proposal.review?.reason,
      reviewerNote: proposal.review?.reviewerNote,
      valuePreview: proposalValuePreview(proposal.op.value),
      baseVersion: proposal.op.baseVersion,
      traceIds: traces
        .filter((trace) => trace.refs?.proposalId === proposal.id || trace.refs?.artifactId === proposal.artifactId)
        .map((trace) => trace.id),
      createdAt: proposal.createdAt,
    }))
    .sort((a, b) => {
      const aPending = a.status === "pending" ? 0 : 1;
      const bPending = b.status === "pending" ? 0 : 1;
      return aPending - bPending || b.createdAt - a.createdAt || a.proposalId.localeCompare(b.proposalId);
    });
}

export function countProposalReviewItems(items: ProposalReviewItem[]): ProposalReviewCounts {
  return {
    total: items.length,
    pending: items.filter((item) => item.status === "pending").length,
    agentEdit: items.filter((item) => item.reviewKind === "agent_edit").length,
    semanticRebase: items.filter((item) => item.reviewKind === "semantic_rebase").length,
    resolved: items.filter((item) => item.status !== "pending").length,
  };
}

export function filterProposalReviewItems(items: ProposalReviewItem[], filter: ProposalReviewFilter): ProposalReviewItem[] {
  if (filter === "all") return items;
  if (filter === "pending") return items.filter((item) => item.status === "pending");
  return items.filter((item) => item.reviewKind === filter);
}

export function proposalReviewFeedbackMessage(feedback: ResolveProposalFeedback, approve: boolean): string | null {
  if (feedback.ok) return approve ? "Proposal approved." : "Proposal rejected.";
  if (feedback.reason === "conflict") return "The source cell changed since this was proposed. Re-run NodeAgent or reject the proposal.";
  if (feedback.reason === "not_pending") return "That proposal was already resolved.";
  if (feedback.reason === "not_found") return "That proposal no longer exists.";
  if (feedback.reason === "host_required") return "Only the host can resolve proposals.";
  if (feedback.reason === "formula_protected") return "Formula cells cannot be overwritten by scalar agent edits.";
  if (feedback.reason === "invalid_deck_object") return "This deck proposal is malformed and was not applied. Reject it or ask NodeAgent to create a new minimal slide patch.";
  return "Could not resolve this proposal. Try again.";
}

function filterLabel(filter: ProposalReviewFilter, counts: ProposalReviewCounts): string {
  if (filter === "pending") return `Pending ${counts.pending}`;
  if (filter === "agent_edit") return `Agent edits ${counts.agentEdit}`;
  if (filter === "semantic_rebase") return `Rebases ${counts.semanticRebase}`;
  return `All ${counts.total}`;
}

function statusLabel(item: ProposalReviewItem): string {
  if (item.reviewStatus) return item.reviewStatus.replace(/_/g, " ");
  if (item.reviewKind === "semantic_rebase") return "semantic rebase";
  return item.status;
}

export function ProposalReviewCenter({
  proposals,
  artifacts,
  traces,
  me,
  canResolve,
  onOpenArtifact,
  onResolveProposal,
}: {
  proposals: Proposal[];
  artifacts: Artifact[];
  traces: TraceEvent[];
  me: Actor;
  canResolve: boolean;
  onOpenArtifact: (artifactId: string) => void;
  onResolveProposal: (proposalId: string, approve: boolean) => Promise<ResolveProposalFeedback>;
}): ReactElement {
  const [filter, setFilter] = useState<ProposalReviewFilter>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const items = useMemo(() => buildProposalReviewItems({ proposals, artifacts, traces }), [artifacts, proposals, traces]);
  const counts = useMemo(() => countProposalReviewItems(items), [items]);
  const shown = useMemo(() => filterProposalReviewItems(items, filter), [filter, items]);
  const filters: ProposalReviewFilter[] = ["pending", "agent_edit", "semantic_rebase", "all"];

  const decide = async (item: ProposalReviewItem, approve: boolean) => {
    setBusyId(`${item.proposalId}:${approve ? "approve" : "reject"}`);
    try {
      const feedback = await onResolveProposal(item.proposalId, approve);
      setMessage(proposalReviewFeedbackMessage(feedback, approve));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="wa-review" data-testid="proposal-review-center" aria-label="Proposal review center">
      <header className="wa-review-head">
        <div>
          <p className="wa-eyebrow">Review center</p>
          <h3>Agent workpapers</h3>
        </div>
        <div className="wa-review-counts" aria-label="Proposal counts">
          <span><b>{counts.pending}</b> pending</span>
          <span><b>{counts.agentEdit}</b> edits</span>
          <span><b>{counts.semanticRebase}</b> rebases</span>
        </div>
      </header>

      <div className="wa-review-filters" role="tablist" aria-label="Proposal filters">
        {filters.map((candidate) => (
          <button
            key={candidate}
            type="button"
            data-testid="proposal-review-filter"
            data-filter={candidate}
            data-active={String(filter === candidate)}
            onClick={() => setFilter(candidate)}
          >
            {filterLabel(candidate, counts)}
          </button>
        ))}
      </div>

      {message && (
        <div className="wa-review-message" role="status" data-testid="proposal-review-message">
          <AlertTriangle size={13} />
          <span>{message}</span>
          <button type="button" onClick={() => setMessage(null)}>Dismiss</button>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="wa-review-empty" data-testid="proposal-review-empty">
          <GitPullRequest size={15} />
          <span>{items.length === 0 ? "No pending proposal workpapers." : "No proposals match this filter."}</span>
        </div>
      ) : (
        <div className="wa-review-list" role="list" aria-label="Proposal workpapers">
          {shown.map((item) => {
            const approveBusy = busyId === `${item.proposalId}:approve`;
            const rejectBusy = busyId === `${item.proposalId}:reject`;
            const resolving = approveBusy || rejectBusy;
            const disabledReason = canResolve ? undefined : "Only the host can resolve proposals.";
            return (
              <article key={item.proposalId} className="wa-review-card" role="listitem" data-status={item.status} data-kind={item.reviewKind ?? "agent_edit"} data-testid="proposal-review-card">
                <span className="wa-review-icon" aria-hidden="true"><GitPullRequest size={14} /></span>
                <div className="wa-review-copy">
                  <div className="wa-review-title">
                    <span>{item.authorName} proposed {item.elementId}</span>
                    <span data-status={item.status}>{statusLabel(item)}</span>
                  </div>
                  <p>{item.valuePreview}</p>
                  <div className="wa-review-meta">
                    <span>{item.artifactTitle}</span>
                    {item.baseVersion !== undefined && <span>base v{item.baseVersion}</span>}
                    {item.jobId && <span data-testid="proposal-review-job" title={`Producing job ${item.jobId}`}>job {item.jobId}</span>}
                    {item.traceIds.length > 0 && <span>{item.traceIds.length} traces</span>}
                    {item.reason && <span>{item.reason}</span>}
                    {item.reviewerNote && <span>{item.reviewerNote}</span>}
                  </div>
                </div>
                <div className="wa-review-actions">
                  <button type="button" data-testid="proposal-review-open-source" onClick={() => onOpenArtifact(item.artifactId)}>
                    <FileText size={12} />
                    Source
                  </button>
                  {item.status === "pending" && (
                    <>
                      <button
                        type="button"
                        data-testid="proposal-review-approve"
                        disabled={!canResolve || resolving}
                        title={disabledReason}
                        onClick={() => void decide(item, true)}
                      >
                        <Check size={12} />
                        {approveBusy ? "Approving" : "Approve"}
                      </button>
                      <button
                        type="button"
                        data-testid="proposal-review-reject"
                        disabled={!canResolve || resolving}
                        title={disabledReason}
                        onClick={() => void decide(item, false)}
                      >
                        <X size={12} />
                        {rejectBusy ? "Rejecting" : "Reject"}
                      </button>
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!canResolve && counts.pending > 0 && (
        <p className="wa-review-host-note">{me.name} can inspect these workpapers, but only the room host can approve or reject them.</p>
      )}
    </section>
  );
}
