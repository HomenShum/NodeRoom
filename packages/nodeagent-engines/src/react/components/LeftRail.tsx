import { Plus } from "lucide-react";
import type { HealthResponse, ProjectRecord, RunRecord } from "../../api.js";
import type { TemplateSummary } from "../client.js";

export function LeftRail(props: {
  health: HealthResponse;
  templates: TemplateSummary[];
  templateId: string;
  onTemplate(id: string): void;
  onNewProject(): void;
  creating: boolean;
  projects?: ProjectRecord[];
  projectsError?: string;
  projectId?: string;
  onProject(id: string): void;
  runs?: RunRecord[];
  runsError?: string;
  runId?: string;
  onRun(id: string): void;
}) {
  const { health, templates, projects, runs } = props;
  return (
    <nav className="naw-rail-inner" aria-label="Projects and runs">
      <section className="naw-rail-section">
        <label className="naw-label" htmlFor="naw-template">New project from template</label>
        <div className="naw-row">
          <select
            id="naw-template"
            className="naw-input"
            data-testid="naw-template-select"
            value={props.templateId}
            onChange={(e) => props.onTemplate(e.target.value)}
            disabled={templates.length === 0}
          >
            {templates.length === 0 ? <option value="">No templates installed</option> : null}
            {templates.map((t) => (
              <option key={t.id} value={t.id} title={t.description}>
                {t.title}
              </option>
            ))}
          </select>
          <button type="button" className="naw-btn" data-testid="naw-new-project" onClick={props.onNewProject} disabled={!props.templateId || props.creating}>
            <Plus size={14} aria-hidden /> {props.creating ? "Creating…" : "New project"}
          </button>
        </div>
      </section>

      <section className="naw-rail-section">
        <div className="naw-section-title">Projects</div>
        {props.projectsError ? <p className="naw-error naw-small">{props.projectsError}</p> : null}
        {projects === undefined ? <p className="naw-muted naw-small">Loading…</p> : projects.length === 0 ? <p className="naw-muted naw-small">No projects yet.</p> : null}
        <ul className="naw-list">
          {projects?.map((p) => (
            <li key={p.id}>
              <button type="button" className="naw-list-btn" aria-current={p.id === props.projectId || undefined} onClick={() => props.onProject(p.id)} data-project-id={p.id}>
                <span className="naw-ellipsis">{p.title}</span>
                <span className="naw-muted naw-small">{p.template}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {props.projectId ? (
        <section className="naw-rail-section">
          <div className="naw-section-title">Runs</div>
          {props.runsError ? <p className="naw-error naw-small">{props.runsError}</p> : null}
          {runs?.length === 0 ? <p className="naw-muted naw-small">No runs in this project yet.</p> : null}
          <ul className="naw-list" data-testid="naw-run-list">
            {runs?.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="naw-list-btn"
                  data-testid="naw-run-item"
                  data-run-id={r.id}
                  data-status={r.status}
                  aria-current={r.id === props.runId || undefined}
                  onClick={() => props.onRun(r.id)}
                >
                  <span className="naw-ellipsis">{r.prompt.split("\n")[0] || "(empty prompt)"}</span>
                  <span className="naw-row naw-small">
                    <StatusDot status={r.status} />
                    <span>{r.status}</span>
                    <span className="naw-muted">{engineShort(health, r.engine)}</span>
                    {r.relation ? <span className="naw-muted">{r.relation}</span> : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="naw-rail-section">
        <div className="naw-section-title">Engines</div>
        <ul className="naw-list">
          {health.engines.map(({ descriptor, availability }) => (
            <li key={descriptor.id} className="naw-engine-badge" data-testid="naw-engine-badge" data-engine={descriptor.id} data-ok={String(availability.ok)}>
              <span className={availability.ok ? "naw-dot naw-dot-ok" : "naw-dot naw-dot-warn"} aria-hidden />
              <span className="naw-ellipsis">{descriptor.label}</span>
              <span className="naw-muted naw-small" title={availability.missing.join("\n")}>
                {availability.ok ? `${descriptor.sdk.name}@${descriptor.sdk.version}` : "setup required"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </nav>
  );
}

export function StatusDot({ status }: { status: string }) {
  const tone = status === "completed" ? "ok" : status === "failed" ? "bad" : status === "interrupted" ? "warn" : status === "running" || status === "queued" ? "live" : "idle";
  return <span className={`naw-dot naw-dot-${tone}`} aria-hidden />;
}

function engineShort(health: HealthResponse, id: string): string {
  return health.engines.find((e) => e.descriptor.id === id)?.descriptor.label ?? id;
}
