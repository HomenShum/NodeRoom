import type { Capability } from "../../contract.js";
import type { HealthResponse, RunCounters, RunRecord } from "../../api.js";
import type { RunView } from "../eventReducer.js";
import type { StreamState } from "../hooks.js";
import { formatCost } from "./TaskBrief.js";

const COUNTER_UNITS: Record<keyof RunCounters, string> = {
  toolCalls: "calls",
  toolCallsOk: "calls",
  toolCallsFailed: "calls",
  nativeToolCalls: "calls",
  nodeToolCalls: "calls",
  toolSearches: "searches",
  toolsLoaded: "tools",
  skillsLoaded: "skills",
  skillLifecycleEvents: "events",
  helpersStarted: "helpers",
  helpersCompleted: "helpers",
  compactions: "compactions",
  artifactsWritten: "writes",
  uniqueFilesRead: "files",
  checksRun: "checks",
  permissionDenials: "denials",
};

const CAPABILITIES: Capability[] = ["start", "stream", "interrupt", "resume", "subagents", "childEventIdentity", "compaction", "toolSearch", "skillLoad", "skillRefresh", "goals", "permissions", "usage", "costUsd"];
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function DevDrawer({ run, view, health, stream }: { run?: RunRecord; view: RunView; health: HealthResponse; stream: StreamState }) {
  const usage = view.usage ?? run?.usage;
  const counterAttrs = run ? Object.fromEntries(Object.entries(run.counters).map(([k, v]) => [`data-counter-${kebab(k)}`, String(v)])) : {};
  return (
    <section className="naw-dev" data-testid="naw-dev-drawer" aria-label="Developer drawer">
      <div className="naw-dev-grid">
        <div className="naw-panel">
          <div className="naw-section-title">Identity</div>
          <dl className="naw-dl naw-small">
            <dt>run</dt><dd className="naw-mono">{run?.id ?? "—"}</dd>
            <dt>project</dt><dd className="naw-mono">{run?.projectId ?? "—"}</dd>
            <dt>native session</dt><dd className="naw-mono">{view.nativeSessionId ?? run?.nativeSessionId ?? "—"}</dd>
            <dt>engine</dt><dd className="naw-mono">{view.started ? `${view.started.engine} · sdk ${view.started.sdkVersion}` : run?.engine ?? "—"}</dd>
            <dt>cwd</dt><dd className="naw-mono naw-break">{view.started?.cwd ?? "—"}</dd>
            <dt>stream</dt><dd>{stream} · last seq {view.lastSeq} · {view.duplicates} replayed dropped · {view.gaps} gaps</dd>
            <dt>worker</dt><dd className="naw-mono">v{health.worker.version} · pid {health.worker.pid}</dd>
          </dl>
        </div>

        <div className="naw-panel">
          <div className="naw-section-title">Counters</div>
          {run ? (
            <dl className="naw-dl naw-small" data-testid="naw-counters" {...counterAttrs}>
              {(Object.keys(COUNTER_UNITS) as Array<keyof RunCounters>).map((k) => (
                <div key={k} className="naw-dl-row">
                  <dt>{k}</dt>
                  <dd>{run.counters[k] ?? "—"} {COUNTER_UNITS[k]}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="naw-muted naw-small">No run selected.</p>
          )}
        </div>

        <div className="naw-panel">
          <div className="naw-section-title">Usage</div>
          {usage ? (
            <dl className="naw-dl naw-small">
              <dt>input</dt><dd>{usage.inputTokens.toLocaleString()} tokens</dd>
              <dt>output</dt><dd>{usage.outputTokens.toLocaleString()} tokens</dd>
              <dt>cache read</dt><dd>{usage.cacheReadTokens.toLocaleString()} tokens</dd>
              <dt>cache write</dt><dd>{usage.cacheWriteTokens.toLocaleString()} tokens</dd>
              <dt>model turns</dt><dd>{usage.modelTurns}</dd>
              <dt>cost</dt><dd>{formatCost(usage).text} ({usage.costSource})</dd>
            </dl>
          ) : (
            <p className="naw-muted naw-small">No usage reported.</p>
          )}
        </div>

        <div className="naw-panel">
          <div className="naw-section-title">Permission decisions</div>
          {view.permissions.length === 0 ? <p className="naw-muted naw-small">None recorded.</p> : null}
          <ul className="naw-list naw-small naw-scroll">
            {view.permissions.slice(-100).map((p) => (
              <li key={p.seq} className={p.decision === "deny" ? "naw-warn-text" : undefined}>
                #{p.seq} {p.decision} <code>{p.tool}</code> — {p.reason}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="naw-panel">
        <div className="naw-section-title">Engine capabilities (as installed)</div>
        <div className="naw-table-wrap">
          <table className="naw-table naw-cap-table">
            <thead>
              <tr>
                <th>capability</th>
                {health.engines.map((e) => <th key={e.descriptor.id}>{e.descriptor.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {CAPABILITIES.map((c) => (
                <tr key={c}>
                  <th scope="row">{c}</th>
                  {health.engines.map((e) => {
                    const entry = e.descriptor.capabilities[c];
                    return (
                      <td key={e.descriptor.id} data-cap-status={entry?.status ?? "UNTESTED"} title={entry?.note}>
                        {entry?.status ?? "UNTESTED"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="naw-panel">
        <div className="naw-section-title">Raw events (last {view.raw.length} of {view.eventCount})</div>
        <ol className="naw-raw">
          {view.raw.map((e) => (
            <li key={e.seq}>
              <span className="naw-mono">#{e.seq}</span> <strong>{e.type}</strong>
              {"agentId" in e && e.agentId ? <span className="naw-muted"> · {e.agentId}</span> : null} <span className="naw-muted">{e.ts}</span>
              <code className="naw-raw-body">{rawPreview(e)}</code>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function rawPreview(e: object): string {
  const { schema: _s, runId: _r, seq: _q, ts: _t, type: _y, ...rest } = e as Record<string, unknown>;
  const text = JSON.stringify(rest);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}
