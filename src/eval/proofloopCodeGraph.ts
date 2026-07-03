/**
 * Proofloop code-graph CLI feature module (`proofloop graph ...`).
 *
 * Owns the impure edges the core keeps out (docs/architecture/CODE_GRAPH_SUBSTRATE.md):
 * git calls (current commit, recently-changed files), the on-disk SQLite location
 * under .proofloop/codegraph/, and console output. The graph is Exploration Loop
 * retrieval only — it informs repair prompts and never touches verifiers or gates.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { exportToCypher } from "../proofloop/codegraph/adapters/cypherExport";
import { createSqliteBackend, DEFAULT_CODEGRAPH_DB_RELPATH } from "../proofloop/codegraph/adapters/sqliteBackend";
import { indexSourceTree } from "../proofloop/codegraph/core/indexer";
import { blastRadius, searchSymbols, type BlastRadiusSeed } from "../proofloop/codegraph/core/query";
import type { GraphBackend } from "../proofloop/codegraph/ports/backend";

const META_LAST_INDEX_COMMIT = "last_index_commit";
const META_LAST_INDEX_RUN_ID = "last_index_run_id";
const META_LAST_INDEXED_AT = "last_indexed_at";

export function runGraphIndex(root: string, args: string[] = []): void {
  const commit = gitCurrentCommit(root);
  const indexRunId = `cg-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const include = optionValues(args, "--include");
  const result = indexSourceTree({
    root,
    ...(include.length ? { include } : {}),
    indexRunId,
    commit,
  });
  const backend = openBackend(root, args);
  try {
    backend.init();
    backend.upsertNodes(result.nodes);
    backend.upsertEdges(result.edges);
    // Bi-temporal invalidation is only sound for full-tree runs: a partial --include index
    // did not visit the rest of the tree, so "missing from this run" does not mean "gone".
    // Invalidating on a partial run would falsely expire every edge outside the include set.
    let invalidated = 0;
    if (include.length) {
      console.log("proofloop graph: partial index (--include) — skipping edge invalidation; run a full `graph index` to expire stale edges");
    } else {
      invalidated = backend.invalidateEdgesMissingFrom(indexRunId, commit);
    }
    backend.setMeta(META_LAST_INDEX_COMMIT, commit);
    backend.setMeta(META_LAST_INDEX_RUN_ID, indexRunId);
    backend.setMeta(META_LAST_INDEXED_AT, new Date().toISOString());
    const stats = backend.stats();
    console.log(`proofloop graph: indexed ${result.fileCount} file(s) at ${commit.slice(0, 12)} (${indexRunId})`);
    console.log(`proofloop graph: nodes ${stats.nodeCount} (${formatByKind(stats.nodesByKind)})`);
    console.log(`proofloop graph: edges ${stats.validEdgeCount} valid / ${stats.edgeCount} total (${formatByKind(stats.edgesByKind)})`);
    console.log(`proofloop graph: invalidated ${invalidated} edge(s) missing from this run (kept, not deleted)`);
    console.log(`proofloop graph: db ${rel(root, dbPathFor(root, args))}`);
  } finally {
    backend.close();
  }
}

export function runGraphBlastRadius(root: string, args: string[]): void {
  const seed: BlastRadiusSeed = {
    ...(optionValue(args, "--file") ? { file: optionValue(args, "--file") } : {}),
    ...(optionValue(args, "--selector") ? { selector: optionValue(args, "--selector") } : {}),
    ...(optionValue(args, "--route") ? { route: optionValue(args, "--route") } : {}),
    ...(optionValue(args, "--symbol") ? { symbol: optionValue(args, "--symbol") } : {}),
  };
  if (!seed.file && !seed.selector && !seed.route && !seed.symbol) {
    throw new Error("blast-radius requires one of --file, --selector, --route, --symbol");
  }
  const backend = requireBackend(root, args);
  try {
    const limit = numberOption(args, "--limit") ?? 25;
    const maxDepth = numberOption(args, "--max-depth") ?? 3;
    const lastIndexCommit = backend.getMeta(META_LAST_INDEX_COMMIT);
    const recentFiles = lastIndexCommit ? gitChangedFilesSince(root, lastIndexCommit) : [];
    const results = blastRadius(backend, seed, { limit, maxDepth, recentFiles });
    const seedLabel = Object.entries(seed)
      .map(([key, value]) => `${key}=${value}`)
      .join(" ");
    console.log(`proofloop graph: blast radius for ${seedLabel} (maxDepth=${maxDepth}, ${recentFiles.length} recently-changed file(s) in overlay)`);
    if (!results.length) {
      console.log("proofloop graph: no seed node found — check the value, or re-run `proofloop graph index`");
      return;
    }
    results.forEach((entry, index) => {
      const recent = entry.recentlyChanged ? " [recent]" : "";
      const symbols = entry.symbols.length ? ` symbols: ${entry.symbols.join(", ")}` : "";
      console.log(`  ${String(index + 1).padStart(2)}. ${entry.score.toFixed(3)}  d${entry.depth}  ${entry.file}${recent}`);
      console.log(`      why: ${entry.why.join("; ")}${symbols}`);
    });
  } finally {
    backend.close();
  }
}

export function runGraphSearch(root: string, args: string[]): void {
  const query = args.filter((arg) => !arg.startsWith("--")).join(" ").trim();
  if (!query) throw new Error("graph search requires a query");
  const backend = requireBackend(root, args);
  try {
    const results = searchSymbols(backend, query, numberOption(args, "--limit") ?? 20);
    if (!results.length) {
      console.log("proofloop graph: no matching nodes");
      return;
    }
    for (const node of results) {
      console.log(`${node.kind.padEnd(9)} ${node.label.padEnd(32)} ${node.filePath || node.id}`);
    }
  } finally {
    backend.close();
  }
}

export function runGraphExportCypher(root: string, args: string[] = []): void {
  const outPath =
    optionValue(args, "--out") ??
    args.find((arg) => !arg.startsWith("--")) ??
    join(root, ".proofloop", "codegraph", "export.cypher");
  const backend = requireBackend(root, args);
  try {
    const cypher = exportToCypher(backend);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, cypher, "utf-8");
    console.log(`proofloop graph: wrote ${rel(root, outPath)} (load into your own Neo4j server — never bundled)`);
  } finally {
    backend.close();
  }
}

// ─── Impure helpers (git + fs live here, not in src/proofloop/codegraph/core)

function gitCurrentCommit(root: string): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf-8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function gitChangedFilesSince(root: string, commit: string): string[] {
  const result = spawnSync("git", ["diff", "--name-only", commit], { cwd: root, encoding: "utf-8" });
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

function dbPathFor(root: string, args: string[]): string {
  return optionValue(args, "--db") ?? join(root, DEFAULT_CODEGRAPH_DB_RELPATH);
}

function openBackend(root: string, args: string[]): GraphBackend {
  return createSqliteBackend({ dbPath: dbPathFor(root, args) });
}

function requireBackend(root: string, args: string[]): GraphBackend {
  const dbPath = dbPathFor(root, args);
  if (!existsSync(dbPath)) {
    throw new Error(`no code-graph index at ${rel(root, dbPath)} — run \`proofloop graph index\` first`);
  }
  const backend = createSqliteBackend({ dbPath });
  backend.init();
  return backend;
}

function optionValue(args: string[], name: string): string | undefined {
  const inlinePrefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(inlinePrefix));
  if (inline) return inline.slice(inlinePrefix.length);
  const index = args.indexOf(name);
  const next = args[index + 1];
  return index >= 0 && next && !next.startsWith("--") ? next : undefined;
}

function optionValues(args: string[], name: string): string[] {
  const values: string[] = [];
  const inlinePrefix = `${name}=`;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith(inlinePrefix)) values.push(arg.slice(inlinePrefix.length));
    else if (arg === name) {
      const next = args[index + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        index++;
      }
    }
  }
  return values;
}

function numberOption(args: string[], name: string): number | undefined {
  const value = optionValue(args, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatByKind(byKind: Record<string, number>): string {
  return Object.entries(byKind)
    .map(([kind, count]) => `${kind} ${count}`)
    .join(", ");
}

function rel(root: string, path: string): string {
  return relative(root, path).replace(/\\/g, "/");
}
