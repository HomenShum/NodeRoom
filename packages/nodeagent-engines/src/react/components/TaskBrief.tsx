import { useState } from "react";
import { ArrowRightLeft, Play, Square } from "lucide-react";
import type { EngineId, UsageTotals } from "../../contract.js";
import type { HealthResponse, RunRecord, RunStatus } from "../../api.js";
import type { RunView } from "../eventReducer.js";
import { StatusDot } from "./LeftRail.js";

export function formatCost(usage: UsageTotals | undefined): { text: string; title: string } {
  if (!usage || usage.costUsd === null) return { text: "—", title: "Cost unknown" };
  const v = usage.costUsd;
  return { text: `$${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`, title: usage.costSource === "price-table" ? "Estimated from the local price table" : "Reported by the engine" };
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}

const STATUS_LABEL: Record<RunStatus, string> = { queued: "Queued", running: "Running", completed: "Completed", failed: "Failed", interrupted: "Interrupted" };

export function effectiveStatus(run: RunRecord, view: RunView): RunStatus {
  if (run.status === "queued" || run.status === "running") return view.terminal?.status ?? run.status;
  return run.status;
}

export function TaskBrief(props: {
  run: RunRecord;
  view: RunView;
  health: HealthResponse;
  now: number;
  busy?: string;
  onStop(): void;
  onResume(): void;
  onHandoff(engine: EngineId): void;
}) {
  const { run, view, health } = props;
  const status = effectiveStatus(run, view);
  const live = status === "queued" || status === "running";
  const phase = live && view.liveStatus && view.liveStatus !== "running" ? view.liveStatus : undefined;
  const others = health.engines.filter((e) => e.descriptor.id !== run.engine);
  const [target, setTarget] = useState<EngineId | "">("");
  const handoffTarget = target || others.find((e) => e.availability.ok)?.descriptor.id || "";
  const started = Date.parse(run.startedAt ?? run.createdAt);
  const ended = run.endedAt ? Date.parse(run.endedAt) : view.terminal && view.lastTs ? Date.parse(view.lastTs) : live ? props.now : NaN;
  const cost = formatCost(view.usage ?? run.usage);
  const engineLabel = health.engines.find((e) => e.descriptor.id === run.engine)?.descriptor.label ?? run.engine;
  const firstLine = run.prompt.trim().split("\n")[0] ?? "";

  return (
    <section className="naw-brief" data-testid="naw-task-brief" aria-label="Task brief">
      <div className="naw-brief-top">
        <p className="naw-brief-prompt" title={run.prompt}>
          {firstLine.length > 220 ? `${firstLine.slice(0, 220)}…` : firstLine || "(empty prompt)"}
        </p>
        <div className="naw-brief-controls">
          {live ? (
            <button type="button" className="naw-btn" data-testid="naw-stop" onClick={props.onStop} disabled={Boolean(props.busy)}>
              <Square size={14} aria-hidden /> Stop
            </button>
          ) : (
            <button type="button" className="naw-btn" data-testid="naw-resume" onClick={props.onResume} disabled={Boolean(props.busy)} title={run.nativeSessionId ? `Resume native session ${run.nativeSessionId}` : "The worker decides whether this run can resume"}>
              <Play size={14} aria-hidden /> Resume
            </button>
          )}
          <span className="naw-handoff">
            <select className="naw-input naw-input-sm" aria-label="Hand off to engine" value={handoffTarget} onChange={(e) => setTarget(e.target.value as EngineId)} disabled={others.length === 0}>
              {others.map((e) => (
                <option key={e.descriptor.id} value={e.descriptor.id} disabled={!e.availability.ok}>
                  {e.descriptor.label}
                  {e.availability.ok ? "" : " (setup required)"}
                </option>
              ))}
            </select>
            <button type="button" className="naw-btn" data-testid="naw-handoff" onClick={() => handoffTarget && props.onHandoff(handoffTarget)} disabled={!handoffTarget || live || Boolean(props.busy)} title={live ? "Stop the run before handing it off" : "Start a new run on another engine with a portable handoff packet"}>
              <ArrowRightLeft size={14} aria-hidden /> Hand off
            </button>
          </span>
        </div>
      </div>
      <div className="naw-brief-meta">
        <span className="naw-run-status" data-testid="naw-run-status" data-status={status} data-phase={phase ?? ""} aria-live="polite">
          <StatusDot status={status} /> {STATUS_LABEL[status]}
          {phase ? ` · ${phase}` : ""}
        </span>
        <span className="naw-chip" title={health.engines.find((e) => e.descriptor.id === run.engine)?.descriptor.sdk.name}>{engineLabel}</span>
        <span className="naw-chip naw-mono">{run.model}</span>
        {run.relation ? <span className="naw-chip">{run.relation === "resume" ? "resumed" : "handed off"} from {run.parentRunId}</span> : null}
        <span className="naw-meta-item" title="Elapsed wall-clock time">{formatDuration(ended - started)}</span>
        <span className="naw-meta-item" title={cost.title}>{cost.text}</span>
      </div>
      <p className="naw-current-action" data-testid="naw-current-action" aria-live="polite">
        {view.currentAction ?? (live ? "Waiting for the first event" : "No events recorded")}
      </p>
      {run.error && status === "failed" ? <p className="naw-error naw-small">{run.error}</p> : null}
      {props.busy ? <p className="naw-muted naw-small">{props.busy}</p> : null}
    </section>
  );
}
