import { Bot, ShieldCheck } from "lucide-react";
import type { GoalItem } from "../../contract.js";
import type { RunRecord, VerificationReport } from "../../api.js";
import { buildHelperTree, formatTokens, independentChecks, type HelperNode, type RunView } from "../eventReducer.js";
import { CheckRow } from "./Timeline.js";
import { formatDuration } from "./TaskBrief.js";

export function Outline(props: {
  view: RunView;
  run?: RunRecord;
  verification?: VerificationReport;
  canVerify: boolean;
  verifying: boolean;
  onVerify(): void;
  filterAgentId?: string;
  onFilter(agentId: string | undefined): void;
}) {
  const { view, run } = props;
  const goals: GoalItem[] = view.goals.length ? view.goals : run?.goals ?? [];
  const report = props.verification ?? run?.verification;
  const checks = independentChecks(view);
  const tree = buildHelperTree(view.helpers);
  const ended = Boolean(view.terminal) || (run && run.status !== "running" && run.status !== "queued");

  return (
    <div className="naw-outline">
      <section className="naw-panel" data-testid="naw-goals" aria-label="Work outline">
        <div className="naw-section-title">Work outline</div>
        {goals.length === 0 ? (
          <p className="naw-muted naw-small">No goals reported for this run.</p>
        ) : (
          <>
            <ol className="naw-goals">
              {goals.map((g) => (
                <li key={g.id} data-testid="naw-goal-item" data-status={g.status} data-claimed-by={g.claimedBy}>
                  <span className={`naw-goal-dot naw-goal-${g.status}`} aria-hidden />
                  <span className="naw-grow">{g.title}</span>
                  <span className="naw-small naw-muted">
                    {g.status}
                    {g.claimedBy === "engine" ? " · engine claim" : " · set by Node"}
                  </span>
                </li>
              ))}
            </ol>
            {view.goalsSource ? <p className="naw-muted naw-small">Source: {view.goalsSource}. Engine claims are not verification.</p> : null}
          </>
        )}
      </section>

      <section className="naw-panel" data-testid="naw-verification" aria-label="Verified by Node">
        <div className="naw-section-title">
          <ShieldCheck size={14} aria-hidden /> Verified by Node
        </div>
        {report ? (
          <>
            <p className="naw-small">
              <span className={report.failed === 0 ? "naw-ok" : "naw-bad"}>
                {report.passed} passed, {report.failed} failed
              </span>{" "}
              <span className="naw-muted">· {report.verifier} · {new Date(report.ranAt).toLocaleString()}</span>
            </p>
            {report.checks.map((c) => (
              <CheckRow key={c.id} check={{ checkId: c.id, command: report.verifier, ok: c.ok, outputTail: c.detail, independent: true }} />
            ))}
          </>
        ) : null}
        {checks.map((c) => (
          <CheckRow key={c.seq} check={c} />
        ))}
        {!report && checks.length === 0 ? <p className="naw-muted naw-small">Not independently verified yet.</p> : null}
        {props.canVerify && ended ? (
          <button type="button" className="naw-btn naw-btn-sm" onClick={props.onVerify} disabled={props.verifying}>
            {props.verifying ? "Verifying…" : report ? "Re-run verification" : "Run verification"}
          </button>
        ) : null}
      </section>

      <section className="naw-panel" data-testid="naw-helpers" aria-label="Helpers">
        <div className="naw-section-title">
          <Bot size={14} aria-hidden /> Helpers
          {props.filterAgentId ? (
            <button type="button" className="naw-link naw-small" onClick={() => props.onFilter(undefined)}>
              show all
            </button>
          ) : null}
        </div>
        {tree.length === 0 ? <p className="naw-muted naw-small">No helpers started in this run.</p> : <HelperList nodes={tree} filterAgentId={props.filterAgentId} onFilter={props.onFilter} ended={Boolean(ended)} />}
      </section>
    </div>
  );
}

function HelperList({ nodes, filterAgentId, onFilter, ended }: { nodes: HelperNode[]; filterAgentId?: string; onFilter(id: string | undefined): void; ended: boolean }) {
  return (
    <ul className="naw-helpers">
      {nodes.map(({ helper: h, children }) => {
        const uses = h.toolUses ?? h.observedToolCalls;
        return (
          <li key={h.helperId} data-testid="naw-helper-item" data-helper-id={h.helperId} data-status={h.status}>
            <button type="button" className="naw-helper-btn" aria-pressed={filterAgentId === h.helperId} onClick={() => onFilter(filterAgentId === h.helperId ? undefined : h.helperId)} title="Filter the timeline to this helper">
              <span className={`naw-dot naw-dot-${h.status === "running" ? "live" : h.status === "completed" ? "ok" : h.status === "failed" ? "bad" : "warn"}`} aria-hidden />
              <span className="naw-grow naw-ellipsis">{h.description}</span>
              <span className="naw-small naw-muted">{h.status === "running" && ended ? "no completion reported" : h.status}</span>
            </button>
            <div className="naw-helper-meta naw-small naw-muted">
              {h.subagentType ? <span>{h.subagentType}</span> : null}
              {h.model ? <span className="naw-mono">{h.model}</span> : null}
              <span title={h.toolUses !== undefined ? "Reported by the engine" : "Tool calls Node observed"}>
                {uses} tool {uses === 1 ? "use" : "uses"}
              </span>
              {h.totalTokens !== undefined ? <span>{formatTokens(h.totalTokens)} tokens</span> : null}
              {h.durationMs !== undefined ? <span>{formatDuration(h.durationMs)}</span> : null}
            </div>
            {h.summary ? <p className="naw-small naw-helper-summary" title={h.summary.slice(0, 2000)}>{h.summary}</p> : h.lastTool ? <p className="naw-small naw-muted">last tool: {h.lastTool}</p> : null}
            {children.length ? <HelperList nodes={children} filterAgentId={filterAgentId} onFilter={onFilter} ended={ended} /> : null}
          </li>
        );
      })}
    </ul>
  );
}
