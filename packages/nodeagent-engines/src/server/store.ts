/**
 * Durable worker store: projects, runs, and a gap-free per-run event log in
 * node:sqlite (WAL). The only writer of run/event rows is the run manager.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ProjectRecord, RunRecord, RunStatus } from "../api.js";
import type { EngineEventDraft, NodeAgentEvent } from "../contract.js";
import { NODE_AGENT_EVENT_SCHEMA } from "../contract.js";

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_RAW_PAYLOAD = 8 * 1024;
export const MAX_PAGE = 1000;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}… [truncated ${text.length - max} chars]` : text;
}

function capStrings(value: unknown, maxLen: number, maxItems: number): unknown {
  if (typeof value === "string") return truncate(value, maxLen);
  if (Array.isArray(value)) {
    const items = value.slice(0, maxItems).map((v) => capStrings(v, maxLen, maxItems));
    if (value.length > maxItems) items.push(`… [truncated ${value.length - maxItems} items]`);
    return items;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = capStrings(v, maxLen, maxItems);
    return out;
  }
  return value;
}

/** Shrinks string fields (then arrays) until the serialized body fits MAX_BODY_BYTES. */
export function capBody(draft: EngineEventDraft): string {
  const base: unknown = draft.type === "engine.raw" ? { ...draft, payload: truncate(String(draft.payload ?? ""), MAX_RAW_PAYLOAD) } : draft;
  let json = JSON.stringify(base);
  for (const [maxLen, maxItems] of [[16_384, 10_000], [4_096, 1_000], [1_024, 200], [256, 50]] as const) {
    if (Buffer.byteLength(json) <= MAX_BODY_BYTES) return json;
    json = JSON.stringify(capStrings(base, maxLen, maxItems));
  }
  if (Buffer.byteLength(json) <= MAX_BODY_BYTES) return json;
  return JSON.stringify({ type: "engine.raw", nativeType: `oversized:${draft.type}`, payload: truncate(json, MAX_RAW_PAYLOAD) });
}

export interface ProjectRow extends ProjectRecord {
  nodeStateDir: string;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(home: string) {
    mkdirSync(home, { recursive: true });
    this.db = new DatabaseSync(join(home, "store.sqlite"));
    this.db.exec(`
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, last_seq INTEGER NOT NULL DEFAULT 0, body TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS runs_project ON runs(project_id, created_at);
      CREATE INDEX IF NOT EXISTS runs_status ON runs(status);
      CREATE TABLE IF NOT EXISTS events (
        run_id TEXT NOT NULL, seq INTEGER NOT NULL, ts TEXT NOT NULL, type TEXT NOT NULL,
        agent_id TEXT, body TEXT NOT NULL, PRIMARY KEY (run_id, seq)) WITHOUT ROWID;
    `);
  }

  insertProject(p: ProjectRow): void {
    this.db.prepare("INSERT INTO projects (id, created_at, body) VALUES (?, ?, ?)").run(p.id, p.createdAt, JSON.stringify(p));
  }

  getProject(id: string): ProjectRow | undefined {
    const row = this.db.prepare("SELECT body FROM projects WHERE id = ?").get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as ProjectRow) : undefined;
  }

  listProjects(limit = 500): ProjectRow[] {
    const rows = this.db.prepare("SELECT body FROM projects ORDER BY created_at DESC LIMIT ?").all(limit) as Array<{ body: string }>;
    return rows.map((r) => JSON.parse(r.body) as ProjectRow);
  }

  insertRun(r: RunRecord): void {
    this.db
      .prepare("INSERT INTO runs (id, project_id, status, created_at, last_seq, body) VALUES (?, ?, ?, ?, ?, ?)")
      .run(r.id, r.projectId, r.status, r.createdAt, r.lastSeq, JSON.stringify(r));
  }

  /** Writes everything except last_seq, which only append() advances. */
  updateRun(r: RunRecord): void {
    this.db.prepare("UPDATE runs SET status = ?, body = ? WHERE id = ?").run(r.status, JSON.stringify(r), r.id);
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.db.prepare("SELECT body, last_seq FROM runs WHERE id = ?").get(id) as { body: string; last_seq: number } | undefined;
    return row ? { ...(JSON.parse(row.body) as RunRecord), lastSeq: row.last_seq } : undefined;
  }

  listRuns(projectId?: string, limit = 500): RunRecord[] {
    const rows = (
      projectId
        ? this.db.prepare("SELECT body, last_seq FROM runs WHERE project_id = ? ORDER BY created_at DESC LIMIT ?").all(projectId, limit)
        : this.db.prepare("SELECT body, last_seq FROM runs ORDER BY created_at DESC LIMIT ?").all(limit)
    ) as Array<{ body: string; last_seq: number }>;
    return rows.map((r) => ({ ...(JSON.parse(r.body) as RunRecord), lastSeq: r.last_seq }));
  }

  runsWithStatus(statuses: RunStatus[]): RunRecord[] {
    const marks = statuses.map(() => "?").join(",");
    const rows = this.db.prepare(`SELECT body, last_seq FROM runs WHERE status IN (${marks})`).all(...statuses) as Array<{
      body: string;
      last_seq: number;
    }>;
    return rows.map((r) => ({ ...(JSON.parse(r.body) as RunRecord), lastSeq: r.last_seq }));
  }

  /**
   * Appends one event with seq = last + 1 inside an IMMEDIATE transaction, so
   * seqs stay gap-free even with several connections on the same file.
   */
  append(runId: string, draft: EngineEventDraft, ts = new Date().toISOString()): NodeAgentEvent {
    const body = capBody(draft);
    const agentId = (draft as { agentId?: unknown }).agentId;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const last = this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM events WHERE run_id = ?").get(runId) as { s: number };
      const seq = last.s + 1;
      this.db
        .prepare("INSERT INTO events (run_id, seq, ts, type, agent_id, body) VALUES (?, ?, ?, ?, ?, ?)")
        .run(runId, seq, ts, draft.type, typeof agentId === "string" ? agentId : null, body);
      this.db.prepare("UPDATE runs SET last_seq = ? WHERE id = ?").run(seq, runId);
      this.db.exec("COMMIT");
      return { schema: NODE_AGENT_EVENT_SCHEMA, runId, seq, ts, ...(JSON.parse(body) as EngineEventDraft) };
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  events(runId: string, after = 0, limit = 500): NodeAgentEvent[] {
    const n = Math.max(1, Math.min(MAX_PAGE, Math.floor(limit)));
    const rows = this.db
      .prepare("SELECT seq, ts, body FROM events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?")
      .all(runId, Math.max(0, Math.floor(after)), n) as Array<{ seq: number; ts: string; body: string }>;
    return rows.map((r) => ({ schema: NODE_AGENT_EVENT_SCHEMA, runId, seq: r.seq, ts: r.ts, ...(JSON.parse(r.body) as EngineEventDraft) }));
  }

  close(): void {
    if (this.db.isOpen) this.db.close();
  }
}
