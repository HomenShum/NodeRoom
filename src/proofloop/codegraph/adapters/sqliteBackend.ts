/**
 * SQLite code-graph backend — node:sqlite (DatabaseSync) + FTS5 with bm25 ranking.
 *
 * Mirrors the repo's Proof Loop memory engine pattern (scripts/proofloop-memory.mjs):
 * WAL mode, content-backed FTS5 virtual table, insert/delete/update triggers, and a
 * LIKE fallback when the FTS MATCH query cannot parse.
 *
 * node:sqlite is loaded lazily via process.getBuiltinModule so that merely importing
 * this module (e.g. through the repair-prompt seam in proofloopLoopArtifacts) does not
 * emit Node's SQLite ExperimentalWarning when no code-graph db exists.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  CodeGraphEdge,
  CodeGraphEdgeKind,
  CodeGraphNode,
  CodeGraphNodeKind,
  CodeGraphSource,
} from "../core/types";
import type {
  CodeGraphStats,
  GraphBackend,
  NeighborDirection,
  NeighborEntry,
} from "../ports/backend";

/** Default on-disk location, relative to the repo root (gitignored). */
export const DEFAULT_CODEGRAPH_DB_RELPATH = ".proofloop/codegraph/index.db";

export interface SqliteBackendOptions {
  /** Absolute (or cwd-relative) path to the database file. */
  dbPath: string;
}

type NodeRow = {
  id: string;
  kind: string;
  label: string;
  file_path: string;
  detail: string | null;
  index_run_id: string;
  commit_sha: string;
  source: string;
};

type EdgeRow = {
  id: string;
  kind: string;
  from_id: string;
  to_id: string;
  valid_from_commit: string;
  invalidated_at_commit: string | null;
  first_indexed_at: string;
  last_indexed_at: string;
  index_run_id: string;
  commit_sha: string;
  source: string;
};

export function createSqliteBackend(options: SqliteBackendOptions): GraphBackend {
  const { dbPath } = options;
  let db: DatabaseSync | undefined;

  const open = (): DatabaseSync => {
    if (db) return db;
    mkdirSync(dirname(dbPath), { recursive: true });
    const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite") | undefined;
    if (!sqlite) throw new Error("node:sqlite is unavailable (Node >= 22.5 is required for the code-graph backend)");
    db = new sqlite.DatabaseSync(dbPath);
    return db;
  };

  const init = (): void => {
    open().exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS nodes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        file_path TEXT NOT NULL,
        detail TEXT,
        index_run_id TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        source TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS edges (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        valid_from_commit TEXT NOT NULL,
        invalidated_at_commit TEXT,
        first_indexed_at TEXT NOT NULL,
        last_indexed_at TEXT NOT NULL,
        index_run_id TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        source TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS edges_from_idx ON edges(from_id, kind);
      CREATE INDEX IF NOT EXISTS edges_to_idx ON edges(to_id, kind);
      CREATE INDEX IF NOT EXISTS edges_run_idx ON edges(index_run_id);
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE VIRTUAL TABLE IF NOT EXISTS nodes_fts USING fts5(
        label,
        file_path,
        content='nodes',
        content_rowid='rowid'
      );
      CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
        INSERT INTO nodes_fts(rowid, label, file_path)
        VALUES (new.rowid, new.label, new.file_path);
      END;
      CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, label, file_path)
        VALUES('delete', old.rowid, old.label, old.file_path);
      END;
      CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
        INSERT INTO nodes_fts(nodes_fts, rowid, label, file_path)
        VALUES('delete', old.rowid, old.label, old.file_path);
        INSERT INTO nodes_fts(rowid, label, file_path)
        VALUES (new.rowid, new.label, new.file_path);
      END;
    `);
  };

  const upsertNodes = (nodes: CodeGraphNode[]): void => {
    const database = open();
    const insert = database.prepare(`
      INSERT INTO nodes (id, kind, label, file_path, detail, index_run_id, commit_sha, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        label = excluded.label,
        file_path = excluded.file_path,
        detail = excluded.detail,
        index_run_id = excluded.index_run_id,
        commit_sha = excluded.commit_sha,
        source = excluded.source
    `);
    database.exec("BEGIN");
    try {
      for (const node of nodes) {
        insert.run(
          node.id,
          node.kind,
          node.label,
          node.filePath,
          node.detail ?? null,
          node.provenance.indexRunId,
          node.provenance.commit,
          node.provenance.source,
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };

  const upsertEdges = (edges: CodeGraphEdge[]): void => {
    const database = open();
    const insert = database.prepare(`
      INSERT INTO edges (
        id, kind, from_id, to_id, valid_from_commit, invalidated_at_commit,
        first_indexed_at, last_indexed_at, index_run_id, commit_sha, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_indexed_at = excluded.last_indexed_at,
        index_run_id = excluded.index_run_id,
        commit_sha = excluded.commit_sha,
        source = excluded.source,
        valid_from_commit = CASE
          WHEN edges.invalidated_at_commit IS NOT NULL THEN excluded.valid_from_commit
          ELSE edges.valid_from_commit
        END,
        invalidated_at_commit = NULL
    `);
    database.exec("BEGIN");
    try {
      for (const edge of edges) {
        insert.run(
          edge.id,
          edge.kind,
          edge.from,
          edge.to,
          edge.validFromCommit,
          edge.invalidatedAtCommit,
          edge.firstIndexedAt,
          edge.lastIndexedAt,
          edge.provenance.indexRunId,
          edge.provenance.commit,
          edge.provenance.source,
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };

  const invalidateEdgesMissingFrom = (indexRunId: string, commit: string): number => {
    const result = open()
      .prepare(`
        UPDATE edges SET invalidated_at_commit = ?
        WHERE index_run_id != ? AND invalidated_at_commit IS NULL
      `)
      .run(commit, indexRunId);
    return Number(result.changes);
  };

  const getNode = (nodeId: string): CodeGraphNode | undefined => {
    const row = open().prepare("SELECT * FROM nodes WHERE id = ?").get(nodeId) as NodeRow | undefined;
    return row ? nodeFromRow(row) : undefined;
  };

  const neighbors = (
    nodeId: string,
    direction: NeighborDirection,
    edgeKinds?: CodeGraphEdgeKind[],
    onlyValid = true,
  ): NeighborEntry[] => {
    const database = open();
    const kindFilter = edgeKinds?.length
      ? ` AND e.kind IN (${edgeKinds.map(() => "?").join(", ")})`
      : "";
    const validFilter = onlyValid ? " AND e.invalidated_at_commit IS NULL" : "";
    const out: NeighborEntry[] = [];
    if (direction === "out" || direction === "both") {
      const rows = database
        .prepare(`
          SELECT e.id AS e_id, e.kind AS e_kind, e.from_id, e.to_id, e.valid_from_commit,
                 e.invalidated_at_commit, e.first_indexed_at, e.last_indexed_at,
                 e.index_run_id AS e_run, e.commit_sha AS e_commit, e.source AS e_source,
                 n.id, n.kind, n.label, n.file_path, n.detail, n.index_run_id, n.commit_sha, n.source
          FROM edges e JOIN nodes n ON n.id = e.to_id
          WHERE e.from_id = ?${kindFilter}${validFilter}
          ORDER BY e.id
        `)
        .all(nodeId, ...(edgeKinds ?? [])) as Array<Record<string, unknown>>;
      for (const row of rows) out.push(neighborFromJoinedRow(row, "out"));
    }
    if (direction === "in" || direction === "both") {
      const rows = database
        .prepare(`
          SELECT e.id AS e_id, e.kind AS e_kind, e.from_id, e.to_id, e.valid_from_commit,
                 e.invalidated_at_commit, e.first_indexed_at, e.last_indexed_at,
                 e.index_run_id AS e_run, e.commit_sha AS e_commit, e.source AS e_source,
                 n.id, n.kind, n.label, n.file_path, n.detail, n.index_run_id, n.commit_sha, n.source
          FROM edges e JOIN nodes n ON n.id = e.from_id
          WHERE e.to_id = ?${kindFilter}${validFilter}
          ORDER BY e.id
        `)
        .all(nodeId, ...(edgeKinds ?? [])) as Array<Record<string, unknown>>;
      for (const row of rows) out.push(neighborFromJoinedRow(row, "in"));
    }
    return out;
  };

  const searchNames = (query: string, limit = 20): CodeGraphNode[] => {
    const database = open();
    let rows: NodeRow[] = [];
    try {
      rows = database
        .prepare(`
          SELECT nodes.*, bm25(nodes_fts) AS fts_rank
          FROM nodes_fts
          JOIN nodes ON nodes_fts.rowid = nodes.rowid
          WHERE nodes_fts MATCH ?
          ORDER BY fts_rank, nodes.id
          LIMIT ?
        `)
        .all(toFtsQuery(query), limit) as unknown as NodeRow[];
    } catch {
      const like = `%${query.replace(/[%_]/g, "")}%`;
      rows = database
        .prepare(`
          SELECT * FROM nodes
          WHERE label LIKE ? OR file_path LIKE ?
          ORDER BY id
          LIMIT ?
        `)
        .all(like, like, limit) as unknown as NodeRow[];
    }
    return rows.map(nodeFromRow);
  };

  const allNodes = (): CodeGraphNode[] => {
    const rows = open().prepare("SELECT * FROM nodes ORDER BY id").all() as unknown as NodeRow[];
    return rows.map(nodeFromRow);
  };

  const allEdges = (onlyValid = false): CodeGraphEdge[] => {
    const where = onlyValid ? " WHERE invalidated_at_commit IS NULL" : "";
    const rows = open().prepare(`SELECT * FROM edges${where} ORDER BY id`).all() as unknown as EdgeRow[];
    return rows.map(edgeFromRow);
  };

  const getMeta = (key: string): string | undefined => {
    const row = open().prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row?.value;
  };

  const setMeta = (key: string, value: string): void => {
    open()
      .prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  };

  const stats = (): CodeGraphStats => {
    const database = open();
    const count = (sql: string): number => Number((database.prepare(sql).get() as { count: number }).count);
    const byKind = (sql: string): Record<string, number> => {
      const rows = database.prepare(sql).all() as Array<{ kind: string; count: number }>;
      return Object.fromEntries(rows.map((row) => [row.kind, Number(row.count)]));
    };
    return {
      nodeCount: count("SELECT COUNT(*) AS count FROM nodes"),
      edgeCount: count("SELECT COUNT(*) AS count FROM edges"),
      validEdgeCount: count("SELECT COUNT(*) AS count FROM edges WHERE invalidated_at_commit IS NULL"),
      invalidatedEdgeCount: count("SELECT COUNT(*) AS count FROM edges WHERE invalidated_at_commit IS NOT NULL"),
      nodesByKind: byKind("SELECT kind, COUNT(*) AS count FROM nodes GROUP BY kind ORDER BY kind"),
      edgesByKind: byKind("SELECT kind, COUNT(*) AS count FROM edges GROUP BY kind ORDER BY kind"),
    };
  };

  const close = (): void => {
    db?.close();
    db = undefined;
  };

  return {
    init,
    upsertNodes,
    upsertEdges,
    invalidateEdgesMissingFrom,
    getNode,
    neighbors,
    searchNames,
    allNodes,
    allEdges,
    getMeta,
    setMeta,
    stats,
    close,
  };
}

// ─── Row mapping ────────────────────────────────────────────────────────────

function nodeFromRow(row: NodeRow): CodeGraphNode {
  return {
    id: row.id,
    kind: row.kind as CodeGraphNodeKind,
    label: row.label,
    filePath: row.file_path,
    ...(row.detail === null ? {} : { detail: row.detail }),
    provenance: {
      indexRunId: row.index_run_id,
      commit: row.commit_sha,
      source: row.source as CodeGraphSource,
    },
  };
}

function edgeFromRow(row: EdgeRow): CodeGraphEdge {
  return {
    id: row.id,
    kind: row.kind as CodeGraphEdgeKind,
    from: row.from_id,
    to: row.to_id,
    validFromCommit: row.valid_from_commit,
    invalidatedAtCommit: row.invalidated_at_commit,
    firstIndexedAt: row.first_indexed_at,
    lastIndexedAt: row.last_indexed_at,
    provenance: {
      indexRunId: row.index_run_id,
      commit: row.commit_sha,
      source: row.source as CodeGraphSource,
    },
  };
}

function neighborFromJoinedRow(row: Record<string, unknown>, direction: "out" | "in"): NeighborEntry {
  return {
    direction,
    edge: {
      id: String(row.e_id),
      kind: String(row.e_kind) as CodeGraphEdgeKind,
      from: String(row.from_id),
      to: String(row.to_id),
      validFromCommit: String(row.valid_from_commit),
      invalidatedAtCommit: row.invalidated_at_commit === null ? null : String(row.invalidated_at_commit),
      firstIndexedAt: String(row.first_indexed_at),
      lastIndexedAt: String(row.last_indexed_at),
      provenance: {
        indexRunId: String(row.e_run),
        commit: String(row.e_commit),
        source: String(row.e_source) as CodeGraphSource,
      },
    },
    node: nodeFromRow({
      id: String(row.id),
      kind: String(row.kind),
      label: String(row.label),
      file_path: String(row.file_path),
      detail: row.detail === null ? null : String(row.detail),
      index_run_id: String(row.index_run_id),
      commit_sha: String(row.commit_sha),
      source: String(row.source),
    }),
  };
}

/** Prefix-matching FTS5 query (mirrors proofloop-memory.mjs's toFtsQuery, plus prefix `*`). */
function toFtsQuery(query: string): string {
  const terms = query.toLowerCase().match(/[a-z0-9_-]+/g) ?? [];
  if (!terms.length) return `"${query.replace(/"/g, "")}"`;
  return terms.map((term) => `"${term.replace(/"/g, "")}"*`).join(" OR ");
}
