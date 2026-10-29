/**
 * Run lifecycle owner: persists runs before starting them, hosts engine
 * adapters, turns every emitted draft into a durable event (counters, usage,
 * goals, artifacts as side effects), enforces budgets and concurrency, and
 * runs the template's independent verifier after the engine stops.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { CreateProjectRequest, CreateRunRequest, HandoffRequest, ProjectRecord, ResumeRequest, RunCounters, RunRecord, VerificationReport } from "../api.js";
import type { EngineEventDraft, EngineHost, EngineId, EngineRunHandle, EngineRunOutcome, HandoffPacket, NodeAgentEvent, ProviderEnv, RunSpec } from "../contract.js";
import { emptyUsage } from "../contract.js";
import { diff, snapshot, type Snapshot } from "../artifacts.js";
import { cleanChildEnv } from "../env.js";
import { buildHandoffPacket } from "../handoff.js";
import { createPolicy } from "../policy.js";
import type { EngineRegistry } from "../registry.js";
import { createGateway } from "../tools/gateway.js";
import { resolveInside, toRel } from "../tools/workspaceFs.js";
import type { ProjectRow, Store } from "./store.js";
import { materializeProject, type TemplateEntry } from "./templates.js";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const MAX_CONCURRENT_RUNS = 4;
export const MAX_QUEUED_RUNS = 64;
const MAX_PROMPT_CHARS = 200_000;
const MAX_FILES_READ = 10_000;
const MAX_GOALS = 200;
const MAX_LISTENERS_PER_RUN = 64;
const MAX_HANDOFF_EVENTS = 20_000;
const VERIFIER_TIMEOUT_MS = 180_000;
const MAX_VERIFIER_STDOUT = 1024 * 1024;
const MAX_VERIFIER_CHECKS = 200;

export const DEFAULT_RESUME_PROMPT = "Continue the task from where you stopped. Re-check the goals and finish remaining work.";
export const DEFAULT_HANDOFF_PROMPT =
  "Continue the task described in the handoff packet. Re-read the workspace files you rely on, re-check the goals and finish the remaining work.";

/** Engines whose native tools already read/write/run in the workspace; they get the catalog without Node's file duplicates. */
const NATIVE_FILE_ENGINES = new Set<EngineId>(["claude-agent-sdk", "codex-app-server"]);
const TERMINAL = new Set(["run.completed", "run.failed", "run.interrupted"]);

export interface RunManagerOptions {
  home: string;
  store: Store;
  registry: EngineRegistry;
  templates: Map<string, TemplateEntry>;
  env: ProviderEnv;
  log?: (message: string) => void;
  maxConcurrent?: number;
  /** Minimum spacing of workspace snapshots after tool results. */
  artifactDebounceMs?: number;
  /** How long an aborted engine gets to settle `done` before Node finalizes the run itself. */
  abortGraceMs?: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(v: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

interface LiveRun {
  record: RunRecord;
  project: ProjectRow;
  template: TemplateEntry;
  spec: RunSpec;
  controller: AbortController;
  handle?: EngineRunHandle;
  /** Set once Node has decided the outcome; later engine drafts are dropped. */
  engineClosed: boolean;
  interruptReason?: string;
  baseline?: Snapshot;
  artifactTimer?: NodeJS.Timeout;
  wallTimer?: NodeJS.Timeout;
  filesRead: Set<string>;
  forced: Deferred<EngineRunOutcome>;
  /** Resolves when the terminal event is persisted. */
  terminal: Deferred<void>;
}

export function zeroCounters(): RunCounters {
  return {
    toolCalls: 0, toolCallsOk: 0, toolCallsFailed: 0, nativeToolCalls: 0, nodeToolCalls: 0, toolSearches: 0,
    toolsLoaded: 0, skillsLoaded: 0, skillLifecycleEvents: 0, helpersStarted: 0, helpersCompleted: 0,
    compactions: 0, artifactsWritten: 0, uniqueFilesRead: 0, checksRun: 0, permissionDenials: 0,
  };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function bareToolName(name: string): string {
  const i = name.startsWith("mcp__") ? name.lastIndexOf("__") : -1;
  return (i > 4 ? name.slice(i + 2) : name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

const READ_TOOL = /^(read|view|notebookread)$|readfile|readsource|readnotebook|fileread/;
const PATH_KEYS = /"(?:file_path|filePath|path|notebook_path|notebookPath)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;

/** Paths named in a (possibly truncated) JSON input preview of a read tool. */
function readPaths(inputPreview: string): string[] {
  const out: string[] = [];
  for (const m of inputPreview.matchAll(PATH_KEYS)) {
    try {
      out.push(JSON.parse(`"${m[1]}"`) as string);
    } catch {
      out.push(m[1]);
    }
  }
  return out;
}

function positive(v: unknown, field: string): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new HttpError(400, `${field} must be a positive number`);
  return v;
}

function optString(v: unknown, field: string, max = 200): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || v.length > max) throw new HttpError(400, `${field} must be a string of at most ${max} characters`);
  return v;
}

interface RunExtra {
  parentRunId?: string;
  relation?: "resume" | "handoff";
  resume?: { nativeSessionId: string };
  handoff?: HandoffPacket;
}

export class RunManager {
  private readonly live = new Map<string, LiveRun>();
  private readonly queue: string[] = [];
  private readonly listeners = new Map<string, Set<(e: NodeAgentEvent) => void>>();
  private readonly verifying = new Set<string>();
  private readonly shutdown = new AbortController();
  private running = 0;
  private readonly maxConcurrent: number;
  private readonly debounceMs: number;
  private readonly graceMs: number;
  private readonly log: (m: string) => void;

  constructor(private readonly opts: RunManagerOptions) {
    this.maxConcurrent = opts.maxConcurrent ?? MAX_CONCURRENT_RUNS;
    this.debounceMs = opts.artifactDebounceMs ?? 2000;
    this.graceMs = opts.abortGraceMs ?? 15_000;
    this.log = opts.log ?? (() => {});
  }

  get store(): Store {
    return this.opts.store;
  }

  /** Runs a previous worker left queued/running cannot still be executing. */
  recover(): number {
    const stale = this.store.runsWithStatus(["queued", "running"]);
    for (const r of stale) {
      this.append(r, { type: "run.interrupted", reason: "worker_restart", usage: r.usage, nativeSessionId: r.nativeSessionId });
      r.status = "interrupted";
      r.error = "worker_restart";
      r.endedAt = new Date().toISOString();
      this.store.updateRun(r);
    }
    return stale.length;
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  createProject(req: CreateProjectRequest): ProjectRecord {
    const templateId = optString(req?.template, "template");
    const template = templateId ? this.opts.templates.get(templateId) : undefined;
    if (!template) throw new HttpError(400, `Unknown template "${templateId ?? ""}". Known: ${[...this.opts.templates.keys()].join(", ") || "none"}`);
    const id = `prj-${randomUUID()}`;
    const dirs = materializeProject(this.opts.home, id, template);
    const row: ProjectRow = {
      id,
      title: optString(req.title, "title") ?? template.config.title,
      template: template.config.id,
      workspaceDir: dirs.workspaceDir,
      nodeStateDir: dirs.nodeStateDir,
      createdAt: new Date().toISOString(),
    };
    this.store.insertProject(row);
    return publicProject(row);
  }

  listProjects(): ProjectRecord[] {
    return this.store.listProjects().map(publicProject);
  }

  /** Internal row (with nodeStateDir) or 404. */
  project(id: string): ProjectRow {
    const p = this.store.getProject(id);
    if (!p) throw new HttpError(404, `Unknown project "${id}"`);
    return p;
  }

  template(project: ProjectRow): TemplateEntry {
    const t = this.opts.templates.get(project.template);
    if (!t) throw new HttpError(409, `Project template "${project.template}" is no longer installed`);
    return t;
  }

  // -------------------------------------------------------------------------
  // Runs
  // -------------------------------------------------------------------------

  /** The store is write-through on every event, so it is the single read path. */
  getRun(id: string): RunRecord {
    const r = this.store.getRun(id);
    if (!r) throw new HttpError(404, `Unknown run "${id}"`);
    return r;
  }

  listRuns(projectId?: string): RunRecord[] {
    return this.store.listRuns(projectId);
  }

  events(runId: string, after = 0, limit = 500): NodeAgentEvent[] {
    this.getRun(runId);
    return this.store.events(runId, after, limit);
  }

  subscribe(runId: string, fn: (e: NodeAgentEvent) => void): () => void {
    let set = this.listeners.get(runId);
    if (!set) this.listeners.set(runId, (set = new Set()));
    if (set.size >= MAX_LISTENERS_PER_RUN) throw new HttpError(503, `Too many live listeners on run ${runId}`);
    set.add(fn);
    return () => {
      set.delete(fn);
      if (set.size === 0) this.listeners.delete(runId);
    };
  }

  /** Persists the run (queued) before returning; the engine starts on a later tick. */
  async createRun(req: CreateRunRequest, extra: RunExtra = {}): Promise<RunRecord> {
    if (this.shutdown.signal.aborted) throw new HttpError(503, "Worker is shutting down");
    if (!req || typeof req !== "object") throw new HttpError(400, "Request body must be a JSON object");
    const project = this.project(String(req.projectId ?? ""));
    const template = this.template(project);
    const engine = req.engine;
    if (typeof engine !== "string" || !this.opts.registry.has(engine)) {
      throw new HttpError(400, `Unknown engine "${String(engine)}". Known: ${this.opts.registry.ids().join(", ")}`);
    }
    if (typeof req.prompt !== "string" || !req.prompt.trim()) throw new HttpError(400, "prompt must be a non-empty string");
    if (req.prompt.length > MAX_PROMPT_CHARS) throw new HttpError(400, `prompt exceeds ${MAX_PROMPT_CHARS} characters`);
    // Operator defaults (NODE_AGENT_DEFAULT_*) apply when a request omits a limit; the
    // effective values are stored on the run record, so they are always disclosed.
    const env = process.env;
    const budget = {
      maxUsd: positive(req.budget?.maxUsd ?? numEnv(env.NODE_AGENT_DEFAULT_MAX_USD), "budget.maxUsd"),
      maxTurns: positive(req.budget?.maxTurns ?? numEnv(env.NODE_AGENT_DEFAULT_MAX_TURNS), "budget.maxTurns"),
      maxWallMs: positive(req.budget?.maxWallMs ?? numEnv(env.NODE_AGENT_DEFAULT_MAX_WALL_MS), "budget.maxWallMs"),
    };
    const context = {
      autoCompactTokens: positive(req.context?.autoCompactTokens ?? numEnv(env.NODE_AGENT_DEFAULT_AUTOCOMPACT_TOKENS), "context.autoCompactTokens"),
    };

    let adapter;
    try {
      adapter = await this.opts.registry.load(engine);
    } catch (err) {
      throw new HttpError(503, `Engine ${engine} failed to load: ${errText(err)}`);
    }
    const availability = await adapter.availability(this.opts.env).catch((err) => ({ ok: false, missing: [`availability check failed: ${errText(err)}`] }));
    if (!availability.ok) throw new HttpError(412, `Setup required for ${engine}: ${availability.missing.join("; ")}`);
    if (this.queue.length >= MAX_QUEUED_RUNS) throw new HttpError(429, `${MAX_QUEUED_RUNS} runs are already queued; wait for one to finish`);

    const descriptor = adapter.descriptor();
    const model = optString(req.model, "model") ?? descriptor.defaultModel;
    if (!model) throw new HttpError(400, `Engine ${engine} has no default model; pass model`);
    const record: RunRecord = {
      id: `run-${randomUUID()}`,
      projectId: project.id,
      engine,
      model,
      helperModel: optString(req.helperModel, "helperModel") ?? descriptor.defaultHelperModel,
      prompt: req.prompt,
      status: "queued",
      parentRunId: extra.parentRunId,
      relation: extra.relation,
      createdAt: new Date().toISOString(),
      lastSeq: 0,
      usage: emptyUsage(),
      goals: [],
      counters: zeroCounters(),
      budget,
      context,
      handoff: extra.handoff,
    };
    this.store.insertRun(record);
    const live: LiveRun = {
      record,
      project,
      template,
      spec: {
        runId: record.id,
        projectId: project.id,
        workspaceDir: project.workspaceDir,
        prompt: record.prompt,
        model,
        helperModel: record.helperModel,
        budget,
        context,
        resume: extra.resume,
        handoff: extra.handoff,
      },
      controller: new AbortController(),
      engineClosed: false,
      filesRead: new Set(),
      forced: deferred(),
      terminal: deferred(),
    };
    this.live.set(record.id, live);
    if (extra.handoff) this.append(record, { type: "handoff.packet", packet: extra.handoff });
    this.append(record, { type: "message", role: "user", text: record.prompt });
    this.queue.push(record.id);
    setImmediate(() => this.pump());
    return structuredClone(record);
  }

  async interrupt(runId: string, reason = "user_interrupt"): Promise<RunRecord> {
    const live = this.live.get(runId);
    if (!live || live.engineClosed) {
      const r = this.getRun(runId);
      throw new HttpError(409, `Run ${runId} is already ${r.status}`);
    }
    if (live.record.status === "queued") {
      this.finalizeQueued(live, reason);
      return structuredClone(live.record);
    }
    this.abortRun(live, reason);
    await Promise.race([live.terminal.promise, sleep(this.graceMs + 1000)]);
    return structuredClone(live.record);
  }

  async resume(runId: string, req: ResumeRequest = {}): Promise<RunRecord> {
    const parent = this.getRun(runId);
    if (parent.status === "queued" || parent.status === "running") throw new HttpError(409, `Run ${runId} is still ${parent.status}; interrupt it first`);
    if (!parent.nativeSessionId)
      throw new HttpError(409, `Run ${runId} has no native session id (the engine never reported one), so it cannot be resumed`);
    const prompt = optString(req?.prompt, "prompt", MAX_PROMPT_CHARS)?.trim() || DEFAULT_RESUME_PROMPT;
    return this.createRun(
      { projectId: parent.projectId, engine: parent.engine, prompt, model: parent.model, helperModel: parent.helperModel, budget: parent.budget, context: parent.context },
      { parentRunId: parent.id, relation: "resume", resume: { nativeSessionId: parent.nativeSessionId } },
    );
  }

  async message(runId: string, text: unknown): Promise<{ accepted: boolean; reason?: string }> {
    if (typeof text !== "string" || !text.trim()) throw new HttpError(400, "text must be a non-empty string");
    if (text.length > MAX_PROMPT_CHARS) throw new HttpError(400, `text exceeds ${MAX_PROMPT_CHARS} characters`);
    const live = this.live.get(runId);
    if (!live) return { accepted: false, reason: `Run ${this.getRun(runId).status}; start a resume run instead` };
    if (live.record.status !== "running" || !live.handle || live.engineClosed) return { accepted: false, reason: `Run is ${live.record.status}, not accepting input` };
    if (!live.handle.send) return { accepted: false, reason: `${live.record.engine} does not support mid-run messages` };
    try {
      await live.handle.send(text);
    } catch (err) {
      return { accepted: false, reason: errText(err) };
    }
    this.append(live.record, { type: "message", role: "user", text });
    return { accepted: true };
  }

  async handoff(runId: string, req: HandoffRequest): Promise<RunRecord> {
    const source = this.getRun(runId);
    if (source.status === "queued" || source.status === "running") throw new HttpError(409, `Run ${runId} is still ${source.status}; interrupt it before handing off`);
    if (typeof req?.engine !== "string" || !this.opts.registry.has(req.engine)) throw new HttpError(400, `Unknown engine "${String(req?.engine)}"`);
    const project = this.project(source.projectId);
    const events: NodeAgentEvent[] = [];
    for (let after = 0; events.length < MAX_HANDOFF_EVENTS; ) {
      const page = this.store.events(runId, after, 1000);
      if (page.length === 0) break;
      events.push(...page);
      after = page[page.length - 1].seq;
    }
    const packet = buildHandoffPacket(source, events, snapshot(project.workspaceDir));
    const next = await this.createRun(
      {
        projectId: source.projectId,
        engine: req.engine,
        model: req.model,
        prompt: optString(req.prompt, "prompt", MAX_PROMPT_CHARS)?.trim() || DEFAULT_HANDOFF_PROMPT,
        budget: source.budget,
        context: source.context,
      },
      { parentRunId: source.id, relation: "handoff", handoff: packet },
    );
    this.append(source, { type: "handoff.packet", packet });
    return next;
  }

  /** Runs the template's verifier outside the engine and the workspace context. */
  async verify(runId: string): Promise<VerificationReport> {
    const live = this.live.get(runId);
    const record = live?.record ?? this.getRun(runId);
    const project = this.project(record.projectId);
    const template = this.template(project);
    if (!template.verifierPath) throw new HttpError(409, `Template ${template.config.id} has no independent verifier`);
    if (this.verifying.has(runId)) throw new HttpError(409, `Verification of ${runId} is already running`);
    if (this.verifying.size >= this.maxConcurrent * 2) throw new HttpError(429, "Too many verifications running");
    this.verifying.add(runId);
    try {
      const name = path.basename(template.verifierPath);
      const t0 = Date.now();
      const out = await runVerifier(template.verifierPath, project.workspaceDir, this.shutdown.signal);
      const durationMs = Date.now() - t0;
      let checks = parseVerifierChecks(out.stdout);
      const why = `exit ${out.code ?? "none"}${out.timedOut ? ", timed out" : ""}${out.error ? `, ${out.error}` : ""}`;
      if (!checks) checks = [{ id: "verifier", ok: false, detail: `Verifier printed no JSON report (${why}): ${(out.stderr || out.stdout).slice(-500)}` }];
      else if (out.code !== 0 && checks.every((c) => c.ok)) checks.push({ id: "verifier-exit", ok: false, detail: `Verifier reported all checks passing but ended with ${why}` });
      const report: VerificationReport = {
        ranAt: new Date().toISOString(),
        verifier: name,
        passed: checks.filter((c) => c.ok).length,
        failed: checks.filter((c) => !c.ok).length,
        checks,
      };
      const target = this.live.get(runId)?.record ?? this.getRun(runId);
      target.verification = report;
      for (const c of checks) {
        this.append(target, {
          type: "check.result",
          checkId: `verify:${c.id}`,
          command: `node ${name} <workspace> --json`,
          ok: c.ok,
          passed: c.ok ? 1 : 0,
          failed: c.ok ? 0 : 1,
          durationMs,
          outputTail: c.detail.slice(-4000),
          independent: true,
        });
      }
      this.store.updateRun(target);
      return structuredClone(report);
    } finally {
      this.verifying.delete(runId);
    }
  }

  /** Interrupts everything and waits (bounded) for engines to settle. */
  async close(reason = "worker_shutdown"): Promise<void> {
    this.shutdown.abort(new Error(reason));
    const waits: Promise<void>[] = [];
    for (const live of [...this.live.values()]) {
      if (live.record.status === "queued") this.finalizeQueued(live, reason);
      else if (!live.engineClosed) {
        this.abortRun(live, reason);
        waits.push(live.terminal.promise);
      }
    }
    await Promise.race([Promise.all(waits), sleep(this.graceMs + 2000)]);
    // Aborted verifiers still persist their (failed) report; let them finish before the store closes.
    for (let i = 0; this.verifying.size > 0 && i < 100; i++) await sleep(50);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private pump(): void {
    while (this.running < this.maxConcurrent && this.queue.length && !this.shutdown.signal.aborted) {
      const live = this.live.get(this.queue.shift()!);
      if (!live || live.record.status !== "queued") continue;
      this.running++;
      void this.execute(live)
        .catch((err) => this.log(`run ${live.record.id}: ${errText(err)}`))
        .finally(() => {
          this.running--;
          this.live.delete(live.record.id);
          this.pump();
        });
    }
  }

  private async execute(live: LiveRun): Promise<void> {
    const { record, project, template } = live;
    record.status = "running";
    record.startedAt = new Date().toISOString();
    this.store.updateRun(record);
    let outcome: EngineRunOutcome;
    try {
      const adapter = await this.opts.registry.load(record.engine);
      const stateDir = path.join(this.opts.home, "engine-state", record.engine, project.id);
      mkdirSync(stateDir, { recursive: true });
      live.baseline = snapshot(project.workspaceDir);
      const emit = (d: EngineEventDraft) => this.engineEmit(live, d);
      const tools = createGateway({
        runId: record.id,
        workspaceDir: project.workspaceDir,
        nodeStateDir: project.nodeStateDir,
        template: template.config,
        nativeFileTools: NATIVE_FILE_ENGINES.has(record.engine),
        signal: live.controller.signal,
        emit,
      });
      const host: EngineHost = {
        emit,
        tools,
        policy: createPolicy({ workspaceDir: project.workspaceDir, template: template.config, nodeTools: tools.list().map((t) => t.name) }),
        signal: live.controller.signal,
        env: this.opts.env,
        stateDir,
        log: (m) => this.log(`[${record.id}] ${m}`),
      };
      const wall = record.budget.maxWallMs;
      if (wall) live.wallTimer = setTimeout(() => this.abortRun(live, `budget: maxWallMs ${wall} exceeded`), wall);
      if (live.interruptReason) throw new Error(live.interruptReason);
      live.handle = adapter.start(live.spec, host);
      outcome = await Promise.race([live.handle.done, live.forced.promise]);
    } catch (err) {
      outcome = { status: live.interruptReason ? "interrupted" : "failed", finalText: "", usage: record.usage, error: errText(err) };
    }
    this.finalize(live, outcome);
    if (template.verifierPath && !this.shutdown.signal.aborted && !this.verifying.has(record.id)) {
      await this.verify(record.id).catch((err) => this.log(`verify ${record.id}: ${errText(err)}`));
    }
  }

  private abortRun(live: LiveRun, reason: string): void {
    if (live.interruptReason || live.engineClosed) return;
    live.interruptReason = reason;
    live.controller.abort(new Error(reason));
    live.handle?.interrupt(reason).catch((err) => this.log(`[${live.record.id}] interrupt failed: ${errText(err)}`));
    setTimeout(
      () => live.forced.resolve({ status: "interrupted", finalText: "", usage: live.record.usage, error: `${reason} (engine did not stop within ${this.graceMs}ms)` }),
      this.graceMs,
    ).unref();
  }

  private finalize(live: LiveRun, outcome: EngineRunOutcome): void {
    const { record } = live;
    clearTimeout(live.wallTimer);
    clearTimeout(live.artifactTimer);
    live.artifactTimer = undefined;
    live.engineClosed = true;
    this.flushArtifacts(live);
    record.usage = outcome.usage ?? record.usage;
    record.nativeSessionId = outcome.nativeSessionId ?? record.nativeSessionId;
    record.finalText = outcome.finalText ?? "";
    const base = { usage: record.usage, nativeSessionId: record.nativeSessionId };
    if (live.interruptReason && outcome.status !== "completed") {
      record.status = "interrupted";
      record.error = live.interruptReason;
      this.append(record, { type: "run.interrupted", reason: live.interruptReason, ...base });
    } else if (outcome.status === "completed") {
      record.status = "completed";
      this.append(record, { type: "run.completed", finalText: record.finalText, ...base });
    } else if (outcome.status === "interrupted") {
      record.status = "interrupted";
      record.error = outcome.error ?? "interrupted";
      this.append(record, { type: "run.interrupted", reason: record.error, ...base });
    } else {
      record.status = "failed";
      record.error = outcome.error || "engine reported failure without an error message";
      this.append(record, { type: "run.failed", error: record.error, ...base });
    }
    record.endedAt = new Date().toISOString();
    this.store.updateRun(record);
    live.terminal.resolve();
  }

  private finalizeQueued(live: LiveRun, reason: string): void {
    const i = this.queue.indexOf(live.record.id);
    if (i >= 0) this.queue.splice(i, 1);
    live.engineClosed = true;
    live.record.status = "interrupted";
    live.record.error = reason;
    live.record.endedAt = new Date().toISOString();
    this.append(live.record, { type: "run.interrupted", reason, usage: live.record.usage });
    this.live.delete(live.record.id);
    live.terminal.resolve();
  }

  private engineEmit(live: LiveRun, draft: EngineEventDraft): void {
    if (live.engineClosed) return this.log(`[${live.record.id}] dropped late ${draft?.type} from engine`);
    if (!draft || typeof draft.type !== "string") return this.log(`[${live.record.id}] dropped malformed draft`);
    if (TERMINAL.has(draft.type)) return this.log(`[${live.record.id}] dropped engine-emitted ${draft.type}; Node owns terminal events`);
    try {
      this.append(live.record, draft, live);
    } catch (err) {
      this.log(`[${live.record.id}] could not persist ${draft.type}: ${errText(err)}`);
    }
  }

  // ponytail: write-through (event row + run body per event); batch run-body writes if event rate makes sqlite the bottleneck.
  private append(record: RunRecord, draft: EngineEventDraft, live?: LiveRun): NodeAgentEvent {
    const ev = this.store.append(record.id, draft);
    record.lastSeq = ev.seq;
    this.apply(record, ev, live);
    this.store.updateRun(record);
    const set = this.listeners.get(record.id);
    if (set)
      for (const fn of set) {
        try {
          fn(ev);
        } catch (err) {
          this.log(`listener on ${record.id}: ${errText(err)}`);
        }
      }
    return ev;
  }

  private apply(record: RunRecord, ev: NodeAgentEvent, live?: LiveRun): void {
    const c = record.counters;
    switch (ev.type) {
      case "run.started":
        if (ev.nativeSessionId) record.nativeSessionId = ev.nativeSessionId;
        break;
      case "tool.call":
        c.toolCalls++;
        if (ev.native) c.nativeToolCalls++;
        else c.nodeToolCalls++;
        if (live && READ_TOOL.test(bareToolName(ev.name))) {
          for (const p of readPaths(ev.inputPreview)) {
            if (live.filesRead.size >= MAX_FILES_READ) break;
            const abs = resolveInside(live.project.workspaceDir, p);
            if (abs) live.filesRead.add(toRel(live.project.workspaceDir, abs));
          }
          c.uniqueFilesRead = live.filesRead.size;
        }
        break;
      case "tool.result":
        if (ev.ok) c.toolCallsOk++;
        else c.toolCallsFailed++;
        if (live) this.scheduleArtifacts(live);
        break;
      case "tool.search":
        c.toolSearches++;
        break;
      case "tool.loaded":
        c.toolsLoaded += ev.names.length;
        break;
      case "skill.loaded":
        c.skillsLoaded++;
        break;
      case "skill.lifecycle":
        c.skillLifecycleEvents++;
        break;
      case "helper.started":
        c.helpersStarted++;
        break;
      case "helper.completed":
        c.helpersCompleted++;
        break;
      case "context.compacted":
        c.compactions++;
        break;
      case "artifact.written":
        c.artifactsWritten++;
        break;
      case "check.result":
        c.checksRun++;
        break;
      case "permission.decision":
        if (ev.decision === "deny") c.permissionDenials++;
        break;
      case "usage":
        if (ev.agentId) break;
        record.usage = ev.totals;
        if (live && record.budget.maxUsd !== undefined && ev.totals.costUsd !== null && ev.totals.costUsd >= record.budget.maxUsd) {
          this.abortRun(live, `budget: maxUsd ${record.budget.maxUsd} reached (cost ${ev.totals.costUsd})`);
        }
        break;
      case "goals.updated":
        if (!ev.agentId) record.goals = ev.goals.slice(0, MAX_GOALS);
        break;
    }
  }

  private scheduleArtifacts(live: LiveRun): void {
    if (live.artifactTimer || live.engineClosed) return;
    live.artifactTimer = setTimeout(() => {
      live.artifactTimer = undefined;
      if (!live.engineClosed) this.flushArtifacts(live);
    }, this.debounceMs);
  }

  private flushArtifacts(live: LiveRun): void {
    if (!live.baseline) return;
    try {
      const next = snapshot(live.project.workspaceDir, live.baseline);
      for (const d of diff(live.baseline, next, live.project.workspaceDir)) this.append(live.record, d, live);
      live.baseline = next;
    } catch (err) {
      this.log(`[${live.record.id}] artifact snapshot failed: ${errText(err)}`);
    }
  }
}

function publicProject(p: ProjectRow): ProjectRecord {
  return { id: p.id, title: p.title, template: p.template, workspaceDir: p.workspaceDir, createdAt: p.createdAt };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms).unref());
}

interface VerifierOutput {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

function runVerifier(verifier: string, workspaceDir: string, signal: AbortSignal): Promise<VerifierOutput> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let error: string | undefined;
    const child = spawn(process.execPath, [verifier, workspaceDir, "--json"], {
      cwd: path.dirname(verifier),
      env: cleanChildEnv({}),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const kill = () => child.kill();
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, VERIFIER_TIMEOUT_MS);
    signal.addEventListener("abort", kill, { once: true });
    child.stdout.on("data", (b: Buffer) => {
      if (stdout.length < MAX_VERIFIER_STDOUT) stdout += b.toString("utf8");
    });
    child.stderr.on("data", (b: Buffer) => {
      stderr = (stderr + b.toString("utf8")).slice(-16_384);
    });
    child.on("error", (err) => (error = err.message));
    child.on("close", (code) => {
      clearTimeout(timer);
      signal.removeEventListener("abort", kill);
      resolve({ code, stdout: stdout.slice(0, MAX_VERIFIER_STDOUT), stderr, timedOut, error: error ?? (signal.aborted ? "worker shutting down" : undefined) });
    });
  });
}

/** `{ checks: [{ id, ok, detail }] }` or a bare array, as the whole stdout or its last JSON line. */
export function parseVerifierChecks(stdout: string): VerificationReport["checks"] | null {
  const candidates = [stdout.trim(), ...stdout.trim().split(/\r?\n/).reverse().filter((l) => /^\s*[[{]/.test(l))];
  for (const text of candidates) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      continue;
    }
    const list = Array.isArray(v) ? v : v && typeof v === "object" ? (v as { checks?: unknown }).checks : undefined;
    if (!Array.isArray(list)) continue;
    return list.slice(0, MAX_VERIFIER_CHECKS).map((c, i) => {
      const o = (c && typeof c === "object" ? c : {}) as Record<string, unknown>;
      return {
        id: String(o.id ?? o.name ?? `check-${i + 1}`),
        ok: o.ok === true,
        detail: String(o.detail ?? o.message ?? ""),
      };
    });
  }
  return null;
}

function numEnv(v: string | undefined): number | undefined {
  if (v === undefined || v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
