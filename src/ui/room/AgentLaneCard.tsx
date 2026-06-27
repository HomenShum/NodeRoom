import { Loader2, CheckCircle2, AlertCircle, Clock, RefreshCw, X } from "lucide-react";
import type { AgentJobTelemetry } from "../../app/store";

export type LaneStatus = "queued" | "running" | "needs_review" | "done" | "failed";

export interface RoomWorkLane {
  id: string;
  title: string;
  subtitle: string;
  status: LaneStatus;
  progressLabel: string;
  nextAction?: { label: string; action: "retry" | "dismiss" };
}

export function statusFromJob(job: AgentJobTelemetry | null): LaneStatus {
  if (!job) return "done";
  if (["completed"].includes(job.status)) return "done";
  if (["failed", "blocked", "cancelled"].includes(job.status)) return "failed";
  if (["paused"].includes(job.status)) return "needs_review";
  if (["queued"].includes(job.status)) return "queued";
  return "running";
}

function laneIcon(status: LaneStatus) {
  switch (status) {
    case "running": return <Loader2 size={14} className="r-lane-spin" />;
    case "queued": return <Clock size={14} />;
    case "done": return <CheckCircle2 size={14} />;
    case "failed": return <AlertCircle size={14} />;
    case "needs_review": return <AlertCircle size={14} />;
  }
}

export function AgentLaneCard({
  lane,
  onRetry,
  onDismiss,
}: {
  lane: RoomWorkLane;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="r-lane-card" data-status={lane.status} data-testid="agent-lane-card">
      <div className="r-lane-icon">{laneIcon(lane.status)}</div>
      <div className="r-lane-body">
        <div className="r-lane-title">{lane.title}</div>
        <div className="r-lane-sub">{lane.subtitle}</div>
        <div className="r-lane-progress">{lane.progressLabel}</div>
      </div>
      {lane.nextAction && (
        <div className="r-lane-actions">
          {lane.nextAction.action === "retry" && (
            <button className="r-lane-btn" onClick={onRetry} title={lane.nextAction.label}>
              <RefreshCw size={12} /> {lane.nextAction.label}
            </button>
          )}
          {lane.nextAction.action === "dismiss" && (
            <button className="r-lane-btn" onClick={onDismiss} title={lane.nextAction.label}>
              <X size={12} /> {lane.nextAction.label}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
