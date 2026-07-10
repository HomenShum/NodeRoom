import type { ReactElement } from "react";
import { Activity, Bot, CheckCircle2, Clock3, RadioTower, ShieldAlert } from "lucide-react";
import type { LivePerformanceSummary } from "./livePerformanceSummary";

function statusLabel(status: LivePerformanceSummary["status"]): string {
  if (status === "running") return "Running";
  if (status === "needs_review" || status === "pending") return "Needs review";
  if (status === "failed" || status === "rejected") return "Failed";
  if (status === "ready" || status === "approved") return "Ready";
  return "Empty";
}

function statusIcon(status: LivePerformanceSummary["status"]): ReactElement {
  if (status === "running") return <RadioTower size={12} />;
  if (status === "ready" || status === "approved") return <CheckCircle2 size={12} />;
  if (status === "failed" || status === "rejected" || status === "needs_review" || status === "pending") return <ShieldAlert size={12} />;
  return <Clock3 size={12} />;
}

function money(value: number | undefined): string {
  if (!value) return "$0.000";
  return `$${value.toFixed(3)}`;
}

function compact(value: number | undefined): string {
  if (!value) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

export function LivePerformanceCenter({
  summary,
  onOpenTraceReplay,
}: {
  summary: LivePerformanceSummary;
  onOpenTraceReplay: () => void;
}): ReactElement {
  const hasTelemetry = Boolean(summary.run || summary.job || summary.attempts.length || summary.detailCounts.streamParts);
  return (
    <section className="wa-live" data-testid="live-performance-center" aria-label="Chat and live performance summary">
      <div className="wa-live-head">
        <div>
          <p className="wa-eyebrow">Live performance</p>
          <h3>NodeAgent and chat activity</h3>
        </div>
        <button type="button" className="wa-live-trace" onClick={onOpenTraceReplay} disabled={summary.traceEventCount === 0} data-testid="live-performance-open-trace">
          <Activity size={13} />
          Trace replay
        </button>
      </div>

      <div className="wa-live-grid">
        <div className="wa-live-status" data-status={summary.status}>
          {statusIcon(summary.status)}
          <span>{statusLabel(summary.status)}</span>
          <p>{summary.agentMessageCount} agent messages - {summary.runCount} grouped runs - {summary.traceEventCount} traces</p>
        </div>
        <div className="wa-live-metrics" aria-label="Live performance metrics">
          <span><b>{summary.messageCount}</b> messages</span>
          <span><b>{summary.humanMessageCount}</b> human</span>
          <span><b>{summary.agentMessageCount}</b> agent</span>
          <span><b>{summary.agentTraceCount}</b> agent traces</span>
          <span><b>{compact(summary.run?.toolCalls ?? summary.job?.toolCallCount)}</b> tools</span>
          <span><b>{money(summary.run?.costUsd)}</b> cost</span>
        </div>
      </div>

      <div className="wa-live-detail">
        <div className="wa-live-card">
          <h4><Bot size={13} /> Agent lane</h4>
          {summary.job ? (
            <>
              <p><b>{summary.job.status}</b> - {summary.job.modelPolicy}</p>
              <p>{summary.job.attempts}/{summary.job.maxAttempts} attempts{summary.job.runtime ? ` - ${summary.job.runtime}` : ""}</p>
              {summary.job.stopReason && <p>{summary.job.stopReason}</p>}
            </>
          ) : summary.run ? (
            <>
              <p><b>{summary.run.model}</b> - {summary.run.steps} steps - {summary.run.toolCalls} tools</p>
              <p>{compact(summary.run.inputTokens + summary.run.outputTokens)} tokens - {money(summary.run.costUsd)} - {summary.run.ms}ms</p>
            </>
          ) : (
            <p>{hasTelemetry ? "Telemetry is present but no active job row is selected." : "No metered NodeAgent job is active in this room."}</p>
          )}
        </div>
        <div className="wa-live-card">
          <h4><RadioTower size={13} /> Stream receipts</h4>
          <p>{summary.detailCounts.streamParts} stream parts - {summary.detailCounts.reasoningFrames} frames</p>
          <p>{summary.detailCounts.operations} operations - {summary.detailCounts.receipts} receipts - {summary.detailCounts.latestSteps} latest steps</p>
          {summary.latestAgentText && <p className="wa-live-latest">{summary.latestAgentText}</p>}
        </div>
      </div>
    </section>
  );
}
