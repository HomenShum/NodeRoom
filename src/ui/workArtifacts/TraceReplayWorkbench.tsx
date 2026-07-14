import type { ReactElement } from "react";
import { CheckCircle2, Clock3, FileText, GitPullRequest, RadioTower, ShieldAlert, X } from "lucide-react";
import type { TraceEvent } from "../../engine/types";
import type { TraceReplayPhase, TraceReplaySummary } from "./traceReplaySummary";

export interface TraceReplayStats {
  events: number;
  phases: number;
  criticalPhases: number;
  artifacts: number;
  proposals: number;
  statusLabel: string;
}

function statusLabel(status: TraceReplaySummary["status"]): string {
  if (status === "needs_review" || status === "pending") return "Needs review";
  if (status === "running") return "Running";
  if (status === "failed" || status === "rejected") return "Failed";
  if (status === "ready" || status === "approved") return "Ready";
  return "Empty";
}

function phaseStatusIcon(status: TraceReplayPhase["status"]): ReactElement {
  if (status === "ready" || status === "approved") return <CheckCircle2 size={12} />;
  if (status === "running") return <RadioTower size={12} />;
  if (status === "failed" || status === "rejected") return <ShieldAlert size={12} />;
  return <Clock3 size={12} />;
}

export function traceReplayStats(summary: TraceReplaySummary): TraceReplayStats {
  return {
    events: summary.eventCount,
    phases: summary.phases.length,
    criticalPhases: summary.criticalPath.length,
    artifacts: summary.artifactIds.length,
    proposals: summary.proposalIds.length,
    statusLabel: statusLabel(summary.status),
  };
}

export function traceReplayPhaseForTrace(summary: TraceReplaySummary, traceId: string): TraceReplayPhase | undefined {
  return summary.phases.find((phase) => phase.traceIds.includes(traceId));
}

export function TraceReplayWorkbench({
  replay,
  traces,
  focusTraceId,
  onClose,
  onOpenArtifact,
}: {
  replay: TraceReplaySummary;
  traces: TraceEvent[];
  focusTraceId?: string;
  onClose: () => void;
  onOpenArtifact: (artifactId: string) => void;
}): ReactElement {
  const stats = traceReplayStats(replay);
  const traceById = new Map(traces.map((trace) => [trace.id, trace]));
  const focusPhase = focusTraceId ? traceReplayPhaseForTrace(replay, focusTraceId) : undefined;
  const criticalIds = new Set(replay.criticalPath.map((phase) => phase.id));
  const visibleEvents = replay.traceIds.slice(-18).map((traceId) => traceById.get(traceId)).filter((trace): trace is TraceEvent => Boolean(trace)).reverse();

  return (
    <section className="wa-traceplay" data-testid="trace-replay-workbench" aria-label="Trace replay workbench">
      <header className="wa-traceplay-head">
        <div>
          <p className="wa-eyebrow">Trace replay</p>
          <h3>Room live performance</h3>
          <p>Read-only replay of chat, agent, edit, review, and notebook trace phases from current room state.</p>
        </div>
        <button type="button" className="wa-deck-close" onClick={onClose} aria-label="Close trace replay">
          <X size={14} />
        </button>
      </header>

      <div className="wa-traceplay-meta">
        <span data-status={replay.status}>{phaseStatusIcon(replay.status)}{stats.statusLabel}</span>
        <span>{stats.events} events</span>
        <span>{stats.phases} phases</span>
        <span>{stats.criticalPhases} critical</span>
        <span>{stats.artifacts} artifacts</span>
        <span>{stats.proposals} proposals</span>
        <span>replay {replay.replayHash}</span>
      </div>

      <div className="wa-traceplay-grid">
        <div className="wa-traceplay-phases" role="list" aria-label="Trace replay phases">
          {replay.phases.map((phase) => (
            <article
              key={phase.id}
              className="wa-traceplay-phase"
              role="listitem"
              data-status={phase.status}
              data-critical={String(criticalIds.has(phase.id))}
              data-focus={String(focusPhase?.id === phase.id)}
              data-testid="trace-replay-phase"
            >
              <div className="wa-traceplay-phase-icon">{phaseStatusIcon(phase.status)}</div>
              <div className="wa-traceplay-phase-copy">
                <div className="wa-traceplay-phase-title">
                  <h4>{phase.label}</h4>
                  <span>{statusLabel(phase.status)}</span>
                </div>
                <p>{phase.summary}</p>
                <div className="wa-traceplay-receipts">
                  <span>{phase.traceIds.length} traces</span>
                  <span>{phase.artifactIds.length} artifacts</span>
                  <span>{phase.proposalIds.length} proposals</span>
                  {phase.startAt !== undefined && <span>{new Date(phase.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
                </div>
                {phase.artifactIds.length > 0 && (
                  <div className="wa-traceplay-actions">
                    {phase.artifactIds.slice(0, 3).map((artifactId) => (
                      <button key={artifactId} type="button" onClick={() => onOpenArtifact(artifactId)}>
                        <FileText size={12} /> Artifact
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>

        <aside className="wa-traceplay-side">
          <div className="wa-traceplay-side-card">
            <h4><GitPullRequest size={13} /> Critical Path</h4>
            {replay.criticalPath.map((phase) => (
              <div key={phase.id} className="wa-traceplay-mini" data-status={phase.status} data-testid="trace-replay-critical-phase">
                <span>{phase.label}</span>
                <p>{phase.summary}</p>
              </div>
            ))}
          </div>
          <div className="wa-traceplay-side-card">
            <h4><Clock3 size={13} /> Recent Events</h4>
            <div className="wa-traceplay-events">
              {visibleEvents.map((trace) => (
                <div key={trace.id} className="wa-traceplay-event" data-focus={String(trace.id === focusTraceId)} data-testid="trace-replay-event">
                  <span>{trace.type}</span>
                  <p>{trace.summary}</p>
                  {trace.refs?.artifactId && (
                    <button type="button" onClick={() => onOpenArtifact(trace.refs?.artifactId ?? "")}>
                      Open source
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
