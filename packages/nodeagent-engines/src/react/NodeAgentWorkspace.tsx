import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanelLeft, PanelRight, RefreshCw, SquareTerminal, Unplug } from "lucide-react";
import type { EngineId } from "../contract.js";
import type { HealthResponse, ProjectRecord, RunRecord, VerificationReport } from "../api.js";
import { createWorkerClient, type TemplateSummary } from "./client.js";
import { useNow, usePolled, useRunEvents, useWorkerHealth } from "./hooks.js";
import { Artifacts } from "./components/Artifacts.js";
import { Composer } from "./components/Composer.js";
import { DevDrawer } from "./components/DevDrawer.js";
import { LeftRail } from "./components/LeftRail.js";
import { Outline } from "./components/Outline.js";
import { TaskBrief, effectiveStatus } from "./components/TaskBrief.js";
import { Timeline } from "./components/Timeline.js";

export interface NodeAgentWorkspaceProps {
  /** Base URL that maps to the worker's /api (e.g. "/agent-api" behind a dev proxy). */
  apiBase: string;
  title?: string;
  brand?: ReactNode;
  defaultEngine?: EngineId;
  defaultTemplate?: string;
  projectId?: string;
  className?: string;
  onRunChange?(run: RunRecord): void;
}

type Tab = "chat" | "outline" | "artifacts";
const WORKER_COMMAND = "npm run agent:worker";

export function NodeAgentWorkspace(props: NodeAgentWorkspaceProps) {
  const health = useWorkerHealth(props.apiBase);
  const lastHealth = useRef<HealthResponse | undefined>(undefined);
  if (health.state === "ok") lastHealth.current = health.health;
  const known = health.state === "ok" ? health.health : lastHealth.current;
  const [tab, setTab] = useState<Tab>("chat");
  const [railOpen, setRailOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [devOpen, setDevOpen] = useState(false);

  return (
    <div
      className={props.className ? `naw-root ${props.className}` : "naw-root"}
      data-testid="naw-root"
      data-tab={tab}
      data-rail={railOpen ? "open" : "closed"}
      data-side={sideOpen ? "open" : "closed"}
    >
      <header className="naw-header">
        {known ? (
          <button type="button" className="naw-icon-btn naw-only-narrow" aria-label="Projects and runs" aria-expanded={railOpen} onClick={() => setRailOpen((o) => !o)}>
            <PanelLeft size={16} aria-hidden />
          </button>
        ) : null}
        {props.brand ? <span className="naw-brand">{props.brand}</span> : null}
        <h1 className="naw-title">{props.title ?? "Agent Workspace"}</h1>
        <span className="naw-grow" />
        <span className="naw-worker-pill" data-state={health.state} role="status" aria-live="polite">
          <span className={`naw-dot naw-dot-${health.state === "ok" ? "ok" : health.state === "checking" ? "idle" : "bad"}`} aria-hidden />
          {health.state === "ok" ? `Worker v${health.health.worker.version}` : health.state === "checking" ? "Checking worker…" : "Worker unreachable"}
        </span>
        {known ? (
          <>
            <button type="button" className="naw-icon-btn naw-only-medium" aria-label="Outline and artifacts" aria-expanded={sideOpen} onClick={() => setSideOpen((o) => !o)}>
              <PanelRight size={16} aria-hidden />
            </button>
            <button type="button" className="naw-btn naw-btn-sm" data-testid="naw-dev-toggle" aria-label="Developer drawer" aria-expanded={devOpen} onClick={() => setDevOpen((o) => !o)}>
              <SquareTerminal size={14} aria-hidden /> <span className="naw-btn-label">Developer</span>
            </button>
          </>
        ) : null}
      </header>
      {known ? (
        <nav className="naw-tabs" role="tablist" aria-label="Workspace sections">
          {(["chat", "outline", "artifacts"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className="naw-tab" onClick={() => setTab(t)}>
              {t === "chat" ? "Chat" : t === "outline" ? "Outline" : "Artifacts"}
            </button>
          ))}
        </nav>
      ) : null}

      {health.state === "unavailable" ? <Unavailable apiBase={props.apiBase} error={health.error} onRetry={health.refresh} compact={Boolean(known)} /> : null}
      {known ? (
        <Workspace {...props} health={known} devOpen={devOpen} onPicked={() => setRailOpen(false)} />
      ) : health.state === "checking" ? (
        <p className="naw-checking" role="status">
          Connecting to the Node agent worker…
        </p>
      ) : null}
    </div>
  );
}

function Unavailable({ apiBase, error, onRetry, compact }: { apiBase: string; error: string; onRetry(): void; compact: boolean }) {
  return (
    <section className={compact ? "naw-unavailable naw-unavailable-banner" : "naw-unavailable"} data-testid="naw-unavailable" role="alert">
      <Unplug size={compact ? 16 : 28} aria-hidden />
      <div>
        <h2>Execution unavailable</h2>
        <p>
          The Node agent worker is not reachable at <code>{apiBase}</code>
          {compact ? ". Showing the last known state; actions will fail until it is back." : ". Nothing can run until it is started."}
        </p>
        {!compact ? (
          <>
            <p>Start it from the project root:</p>
            <pre className="naw-pre naw-command">{WORKER_COMMAND}</pre>
          </>
        ) : null}
        <p className="naw-muted naw-small">Last check: {error}</p>
        <button type="button" className="naw-btn" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden /> Retry now
        </button>
      </div>
    </section>
  );
}

const newestFirst = <T extends { createdAt: string }>(xs: T[] | undefined): T[] | undefined => xs?.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export type Selection = { projectId?: string; runId?: string; engine?: EngineId; model?: string };
const SELECTION_KEYS = ["projectId", "runId", "engine", "model"];

/** Per-viewer convenience only (browser localStorage); storage may be unavailable (private mode, previews). */
export function readSelection(apiBase: string): Selection {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(`naw:selection:${apiBase}`) ?? "{}");
    // Only string fields survive: a value from an older schema must not reach model.trim() or the pickers.
    return v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k, x]) => SELECTION_KEYS.includes(k) && typeof x === "string")) : {};
  } catch {
    return {};
  }
}

/** A saved id wins while the loaded list still has it; a stale one falls back to the newest item. */
export const pickId = (choice: string | undefined, items: Array<{ id: string }> | undefined): string | undefined =>
  choice && (!items || items.some((x) => x.id === choice)) ? choice : items?.[0]?.id;

export function writeSelection(apiBase: string, s: Selection): void {
  try {
    window.localStorage.setItem(`naw:selection:${apiBase}`, JSON.stringify(s));
  } catch {
    /* storage unavailable: selection just won't survive a reload */
  }
}

function Workspace(props: NodeAgentWorkspaceProps & { health: HealthResponse; devOpen: boolean; onPicked(): void }) {
  const { health, apiBase } = props;
  const client = useMemo(() => createWorkerClient(apiBase), [apiBase]);
  const templates = health.templates as TemplateSummary[];
  const [templateChoice, setTemplateChoice] = useState(props.defaultTemplate ?? "");
  const templateId = templates.some((t) => t.id === templateChoice) ? templateChoice : templates[0]?.id ?? "";

  const projectsQ = usePolled(() => client.projects(), 30_000, [client]);
  const [createdProject, setCreatedProject] = useState<ProjectRecord>();
  const projects = useMemo(() => {
    const list = projectsQ.data ?? (createdProject ? [] : undefined);
    if (!list) return undefined;
    return newestFirst(createdProject && !list.some((p) => p.id === createdProject.id) ? [createdProject, ...list] : list);
  }, [projectsQ.data, createdProject]);
  // The viewer's selection survives a reload; without it a reload jumped to whichever project
  // was newest (another user's) and reset the engine picker (observed in the proof runs).
  const saved = useMemo(() => readSelection(apiBase), [apiBase]);
  const [projectChoice, setProjectChoice] = useState(props.projectId ?? saved.projectId);
  const projectId = pickId(projectChoice, projects);
  const project = projects?.find((p) => p.id === projectId);

  const [pollFast, setPollFast] = useState(false);
  const runsQ = usePolled(projectId ? () => client.runs(projectId) : null, pollFast ? 3_000 : 15_000, [client, projectId]);
  const [extraRun, setExtraRun] = useState<RunRecord>();
  const runs = useMemo(() => {
    // A run just returned by create/resume/handoff shows before the next poll; the worker's list wins once it has it.
    const extra = extraRun && extraRun.projectId === projectId && !runsQ.data?.some((r) => r.id === extraRun.id) ? [extraRun] : [];
    if (!runsQ.data && extra.length === 0) return undefined;
    return newestFirst([...extra, ...(runsQ.data ?? [])]);
  }, [runsQ.data, extraRun, projectId]);
  const [runChoice, setRunChoice] = useState<{ projectId?: string; runId: string } | undefined>(
    saved.projectId && saved.runId ? { projectId: saved.projectId, runId: saved.runId } : undefined,
  );
  const runId = pickId(runChoice?.projectId === projectId ? runChoice?.runId : undefined, runs);
  const run = runs?.find((r) => r.id === runId);
  useEffect(() => setPollFast(Boolean(runs?.some((r) => r.status === "queued" || r.status === "running"))), [runs]);

  const events = useRunEvents(apiBase, runId);
  const view = events.view;
  const status = run ? effectiveStatus(run, view) : undefined;
  const live = status === "queued" || status === "running";
  const now = useNow(live);

  const [engineChoice, setEngineChoice] = useState<EngineId | "">(saved.engine ?? props.defaultEngine ?? "");
  const engineId: EngineId | "" = health.engines.some((e) => e.descriptor.id === engineChoice)
    ? engineChoice
    : health.engines.find((e) => e.availability.ok)?.descriptor.id ?? health.engines[0]?.descriptor.id ?? "";
  const [model, setModel] = useState(saved.model ?? "");
  useEffect(() => {
    writeSelection(apiBase, { projectId: projectChoice, runId: runChoice?.runId, engine: engineChoice || undefined, model: model || undefined });
  }, [apiBase, projectChoice, runChoice?.runId, engineChoice, model]);
  const [filterAgentId, setFilterAgentId] = useState<string>();
  const [artifactPath, setArtifactPath] = useState<string>();
  const [verification, setVerification] = useState<{ runId: string; report: VerificationReport }>();
  const [busy, setBusy] = useState<string>();
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string }>();

  useEffect(() => {
    setFilterAgentId(undefined);
    setArtifactPath(undefined);
  }, [runId]);

  // The stream saw the run end before the polled record did: refresh now.
  const reloadRuns = runsQ.reload;
  useEffect(() => {
    if (view.terminal) reloadRuns();
  }, [view.terminal, reloadRuns]);

  const onRunChange = useRef(props.onRunChange);
  onRunChange.current = props.onRunChange;
  useEffect(() => {
    if (run) onRunChange.current?.(run);
  }, [run?.id, run?.status, run?.lastSeq, run?.verification]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(`${label}…`);
    setNotice(undefined);
    try {
      return await fn();
    } catch (err) {
      setNotice({ tone: "error", text: `${label} failed: ${(err as Error).message}` });
      return undefined;
    } finally {
      setBusy(undefined);
    }
  }

  const select = (r: RunRecord) => {
    setExtraRun(r);
    setRunChoice({ projectId: r.projectId, runId: r.id });
    runsQ.reload();
  };

  const engineLabel = (id: string) => health.engines.find((e) => e.descriptor.id === id)?.descriptor.label ?? id;

  const send = async (text: string): Promise<boolean> => {
    if (!projectId || !engineId) return false;
    let fallback: string | undefined;
    if (run && live) {
      const r = await act("Sending to the running run", () => client.message(run.id, text));
      if (!r) return false;
      if (r.accepted) return true;
      fallback = `${engineLabel(run.engine)} did not accept mid-run input${r.reason ? ` (${r.reason})` : ""}; started a new run instead.`;
    }
    const created = await act("Starting run", () => client.createRun({ projectId, engine: engineId, prompt: text, model: model.trim() || undefined }));
    if (!created) return false;
    select(created);
    if (fallback) setNotice({ tone: "info", text: fallback });
    return true;
  };

  const tasks = templates.find((t) => t.id === project?.template)?.suggestedTasks ?? templates.find((t) => t.id === templateId)?.suggestedTasks ?? [];
  const target = run && live ? `Sends to the running ${engineLabel(run.engine)} run; a new run starts if it cannot accept input` : project ? `Starts a new ${engineLabel(engineId)} run in ${project.title}` : "";
  const report = verification && verification.runId === runId ? verification.report : undefined;

  return (
    <>
      <div className="naw-body">
        <aside className="naw-rail" aria-label="Projects and runs">
          <LeftRail
            health={health}
            templates={templates}
            templateId={templateId}
            onTemplate={setTemplateChoice}
            creating={busy === "Creating project…"}
            onNewProject={() =>
              void act("Creating project", async () => {
                const p = await client.createProject(templateId);
                setCreatedProject(p);
                setProjectChoice(p.id);
                projectsQ.reload();
                props.onPicked();
              })
            }
            projects={projects}
            projectsError={projectsQ.error}
            projectId={projectId}
            onProject={(id) => {
              setProjectChoice(id);
              props.onPicked();
            }}
            runs={runs}
            runsError={runsQ.error}
            runId={runId}
            onRun={(id) => {
              setRunChoice({ projectId, runId: id });
              props.onPicked();
            }}
          />
        </aside>

        <main className="naw-center">
          {notice ? (
            <p className={notice.tone === "error" ? "naw-notice naw-notice-error" : "naw-notice"} role={notice.tone === "error" ? "alert" : "status"}>
              {notice.text}
            </p>
          ) : null}
          {run ? (
            <TaskBrief
              run={run}
              view={view}
              health={health}
              now={now}
              busy={busy}
              onStop={() => void act("Stopping", async () => select(await client.interrupt(run.id)))}
              onResume={() => void act("Resuming", async () => select(await client.resume(run.id)))}
              onHandoff={(engine) => void act("Handing off", async () => select(await client.handoff(run.id, engine)))}
            />
          ) : (
            <section className="naw-brief naw-brief-empty">
              <p className="naw-muted">
                {!projects ? "Loading projects…" : !projectId ? "Create a project from a template to start." : runs === undefined ? "Loading runs…" : "No runs yet. Describe a task below to start one."}
              </p>
            </section>
          )}
          {events.reconnecting ? (
            <p className="naw-reconnecting" data-testid="naw-reconnecting" role="status">
              Reconnecting to the event stream… {events.error ?? ""}
            </p>
          ) : null}
          {run ? <Timeline view={view} filterAgentId={filterAgentId} onClearFilter={() => setFilterAgentId(undefined)} emptyHint={events.stream === "open" || live ? "Waiting for the first event from the worker." : "No events recorded for this run."} /> : null}
          <Composer
            health={health}
            engineId={engineId}
            onEngine={setEngineChoice}
            model={model}
            onModel={setModel}
            tasks={tasks}
            target={target}
            disabledReason={!projectId ? "Create or pick a project first" : busy}
            onSend={send}
          />
        </main>

        <aside className="naw-side" aria-label="Outline and artifacts">
          <div className="naw-side-outline">
            <Outline
              view={view}
              run={run}
              verification={report}
              canVerify={Boolean(run)}
              verifying={busy === "Verifying…"}
              onVerify={() => run && void act("Verifying", async () => setVerification({ runId: run.id, report: await client.verify(run.id) }))}
              filterAgentId={filterAgentId}
              onFilter={setFilterAgentId}
            />
          </div>
          <div className="naw-side-artifacts">
            <Artifacts artifacts={view.artifacts} client={client} projectId={projectId} selected={artifactPath} onSelect={setArtifactPath} />
          </div>
        </aside>
      </div>
      {props.devOpen ? <DevDrawer run={run} view={view} health={health} stream={events.stream} /> : null}
    </>
  );
}
