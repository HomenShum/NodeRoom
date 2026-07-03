/**
 * Code-graph substrate — scenario tests (docs/architecture/CODE_GRAPH_SUBSTRATE.md).
 *
 * Persona: a Proof Loop repair agent whose gate just failed on a selector. It needs the
 * graph to (1) index a small app exactly, (2) keep history when the code changes
 * (invalidate-not-delete), (3) rank the owning file first from a failing data-testid,
 * (4) find symbols by partial name, (5) be deterministic run-to-run, and (6) export to
 * a user-owned Neo4j. Fixtures live in tests/fixtures/codegraph-sample (excluded from
 * the repo tsconfig; the indexer reads them as text) and are COPIED into a temp dir per
 * scenario — the repo's .proofloop and fixtures are never written to.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  blastRadius,
  createSqliteBackend,
  exportToCypher,
  indexSourceTree,
  searchSymbols,
  type GraphBackend,
  type IndexSourceTreeResult,
} from "../src/proofloop/codegraph";
import { writeLoopArtifactsForMeta, type ProofloopMetaForLoop } from "../src/eval/proofloopLoopArtifacts";
import { runGraphIndex } from "../src/eval/proofloopCodeGraph";

const FIXTURE_ROOT = fileURLToPath(new URL("./fixtures/codegraph-sample", import.meta.url));
const INDEXED_AT_RUN_1 = "2026-07-03T00:00:00.000Z";

const tempDirs: string[] = [];
const openBackends: GraphBackend[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function copyFixtureApp(): string {
  const appRoot = makeTempDir("codegraph-app-");
  cpSync(FIXTURE_ROOT, appRoot, { recursive: true });
  return appRoot;
}

function openTempBackend(): GraphBackend {
  const dir = makeTempDir("codegraph-db-");
  const backend = createSqliteBackend({ dbPath: join(dir, "index.db") });
  backend.init();
  openBackends.push(backend);
  return backend;
}

function indexInto(
  backend: GraphBackend,
  appRoot: string,
  run: { indexRunId: string; commit: string; indexedAt?: string },
): { result: IndexSourceTreeResult; invalidated: number } {
  const result = indexSourceTree({ root: appRoot, ...run });
  backend.upsertNodes(result.nodes);
  backend.upsertEdges(result.edges);
  const invalidated = backend.invalidateEdgesMissingFrom(run.indexRunId, run.commit);
  return { result, invalidated };
}

afterEach(() => {
  for (const backend of openBackends.splice(0)) {
    try {
      backend.close();
    } catch {
      // already closed by the scenario
    }
  }
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold WAL handles briefly; temp dirs are OS-cleaned anyway
    }
  }
});

describe("scenario 1: first index of a small app extracts the exact graph", () => {
  it("captures files, imports (relative/barrel/alias), exports, renders, selectors, routes — and skips the external package", () => {
    const appRoot = copyFixtureApp();
    const { nodes, edges, fileCount } = indexSourceTree({
      root: appRoot,
      indexRunId: "run-1",
      commit: "commit-aaa",
      indexedAt: INDEXED_AT_RUN_1,
    });

    expect(fileCount).toBe(5);
    const nodeIds = nodes.map((node) => node.id);
    const edgeIds = edges.map((edge) => edge.id);

    // Files
    for (const file of [
      "file:src/App.tsx",
      "file:src/components/Badge.tsx",
      "file:src/components/Widget.tsx",
      "file:src/components/index.ts",
      "file:src/util.ts",
    ]) {
      expect(nodeIds).toContain(file);
    }
    // Imports: barrel, tsconfig-paths alias, relative, and re-export — external skipped.
    expect(edgeIds).toContain("imports:file:src/App.tsx=>file:src/components/index.ts");
    expect(edgeIds).toContain("imports:file:src/App.tsx=>file:src/util.ts");
    expect(edgeIds).toContain("imports:file:src/components/Widget.tsx=>file:src/components/Badge.tsx");
    expect(edgeIds).toContain("imports:file:src/components/index.ts=>file:src/components/Widget.tsx");
    expect(nodeIds.some((id) => id.includes("react-router-dom"))).toBe(false);
    expect(edgeIds.some((id) => id.includes("react-router-dom"))).toBe(false);

    // Exports
    expect(nodeIds).toContain("symbol:src/App.tsx#default");
    expect(nodeIds).toContain("symbol:src/App.tsx#ROUTE_TABLE");
    expect(nodeIds).toContain("symbol:src/components/Widget.tsx#Widget");
    expect(nodeIds).toContain("symbol:src/components/index.ts#Widget");
    expect(nodeIds).toContain("symbol:src/util.ts#formatLabel");

    // Render edges: <Widget/> resolves one hop to the barrel (documented v0 limitation),
    // <Badge/> resolves to its defining file; external <Route> produced NO render edge.
    expect(edgeIds).toContain("renders:file:src/App.tsx=>component:src/components/index.ts#Widget");
    expect(edgeIds).toContain("renders:file:src/components/Widget.tsx=>component:src/components/Badge.tsx#Badge");
    expect(edges.filter((edge) => edge.kind === "renders")).toHaveLength(2);

    // Selectors
    expect(edgeIds).toContain("has_selector:file:src/App.tsx=>selector:app-root");
    expect(edgeIds).toContain("has_selector:file:src/components/Widget.tsx=>selector:widget-panel");
    expect(edgeIds).toContain("has_selector:file:src/components/Badge.tsx=>selector:widget-badge");

    // Routes: both detection patterns, honestly labeled with what matched.
    const jsxRoute = nodes.find((node) => node.id === "route:/widgets");
    const tableRoute = nodes.find((node) => node.id === "route:/settings");
    expect(jsxRoute?.detail).toBe("jsx-route-path");
    expect(jsxRoute?.provenance.source).toBe("heuristic_scan");
    expect(tableRoute?.detail).toBe("route-table-path-literal");
    expect(edgeIds).toContain("route_renders:route:/widgets=>file:src/App.tsx");
    expect(edgeIds).toContain("route_renders:route:/settings=>file:src/App.tsx");

    // Provenance on every fact.
    for (const node of nodes) {
      expect(node.provenance.indexRunId).toBe("run-1");
      expect(node.provenance.commit).toBe("commit-aaa");
    }
    expect(nodes).toHaveLength(18);
    expect(edges).toHaveLength(17);
  });
});

describe("scenario 2: bi-temporal re-index after a refactor removes an import", () => {
  it("invalidates the stale edges at the new commit without deleting them, and re-validates on reappearance", () => {
    const appRoot = copyFixtureApp();
    const widgetPath = join(appRoot, "src", "components", "Widget.tsx");
    const originalWidget = readFileSync(widgetPath, "utf-8");
    const backend = openTempBackend();

    const first = indexInto(backend, appRoot, { indexRunId: "run-1", commit: "commit-aaa", indexedAt: INDEXED_AT_RUN_1 });
    expect(first.invalidated).toBe(0);

    // The refactor: Widget drops its Badge import + render but keeps its selector.
    writeFileSync(
      widgetPath,
      [
        "export function Widget() {",
        "  return (",
        '    <section data-testid="widget-panel">',
        "      <em>no badge anymore</em>",
        "    </section>",
        "  );",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );
    const second = indexInto(backend, appRoot, { indexRunId: "run-2", commit: "commit-bbb" });
    expect(second.invalidated).toBe(2); // imports + renders edges from Widget to Badge

    const importsEdgeId = "imports:file:src/components/Widget.tsx=>file:src/components/Badge.tsx";
    const staleEdge = backend.allEdges(false).find((edge) => edge.id === importsEdgeId);
    expect(staleEdge).toBeDefined(); // NOT deleted
    expect(staleEdge?.invalidatedAtCommit).toBe("commit-bbb");
    expect(staleEdge?.validFromCommit).toBe("commit-aaa"); // history stays answerable

    // The query layer excludes it with onlyValid, includes it without.
    const widgetFileId = "file:src/components/Widget.tsx";
    const validOut = backend.neighbors(widgetFileId, "out", ["imports"], true);
    expect(validOut).toHaveLength(0);
    const allOut = backend.neighbors(widgetFileId, "out", ["imports"], false);
    expect(allOut.map((entry) => entry.node.id)).toContain("file:src/components/Badge.tsx");

    // Nodes are never invalidated in v0 — the Badge component node survives.
    expect(backend.getNode("component:src/components/Badge.tsx#Badge")).toBeDefined();

    // The import comes back: the edge is re-validated with a fresh validity window,
    // while firstIndexedAt still records the original ingestion.
    writeFileSync(widgetPath, originalWidget, "utf-8");
    const third = indexInto(backend, appRoot, { indexRunId: "run-3", commit: "commit-ccc" });
    expect(third.invalidated).toBe(0);
    const revived = backend.allEdges(true).find((edge) => edge.id === importsEdgeId);
    expect(revived?.invalidatedAtCommit).toBeNull();
    expect(revived?.validFromCommit).toBe("commit-ccc");
    expect(revived?.firstIndexedAt).toBe(INDEXED_AT_RUN_1);
  });
});

describe("scenario 3: blast radius from the failing data-testid", () => {
  it("ranks the component file that owns the selector first and reaches dependents", () => {
    const appRoot = copyFixtureApp();
    const backend = openTempBackend();
    indexInto(backend, appRoot, { indexRunId: "run-1", commit: "commit-aaa" });

    const results = blastRadius(backend, { selector: "widget-panel" });
    expect(results.length).toBeGreaterThan(1);
    expect(results[0].file).toBe("src/components/Widget.tsx");
    expect(results[0].why).toContain('contains selector "widget-panel"');
    const files = results.map((entry) => entry.file);
    expect(files).toContain("src/components/index.ts"); // dependent via reverse imports
    expect(files).toContain("src/components/Badge.tsx"); // forward import
  });

  it("boosts and flags recently-changed files via the overlay hook (git stays in the CLI layer)", () => {
    const appRoot = copyFixtureApp();
    const backend = openTempBackend();
    indexInto(backend, appRoot, { indexRunId: "run-1", commit: "commit-aaa" });

    const plain = blastRadius(backend, { selector: "widget-panel" });
    const boosted = blastRadius(backend, { selector: "widget-panel" }, { recentFiles: ["src/components/Badge.tsx"] });
    const plainBadge = plain.find((entry) => entry.file === "src/components/Badge.tsx");
    const boostedBadge = boosted.find((entry) => entry.file === "src/components/Badge.tsx");
    expect(plainBadge?.recentlyChanged).toBe(false);
    expect(boostedBadge?.recentlyChanged).toBe(true);
    expect(boostedBadge!.score).toBeGreaterThan(plainBadge!.score);
    expect(boostedBadge?.why).toContain("recently changed");
  });

  it("returns an empty ranking for an unknown selector instead of guessing", () => {
    const appRoot = copyFixtureApp();
    const backend = openTempBackend();
    indexInto(backend, appRoot, { indexRunId: "run-1", commit: "commit-aaa" });
    expect(blastRadius(backend, { selector: "does-not-exist" })).toEqual([]);
  });
});

describe("scenario 4: symbol search by partial name (FTS5 bm25 with prefix matching)", () => {
  it("finds Badge from the fragment 'Badg'", () => {
    const appRoot = copyFixtureApp();
    const backend = openTempBackend();
    indexInto(backend, appRoot, { indexRunId: "run-1", commit: "commit-aaa" });

    const results = searchSymbols(backend, "Badg");
    const badgeSymbol = results.find((node) => node.kind === "symbol" && node.label === "Badge");
    expect(badgeSymbol).toBeDefined();
    expect(badgeSymbol?.filePath).toBe("src/components/Badge.tsx");
  });
});

describe("scenario 5: determinism — the same tree always yields the same graph", () => {
  it("two identical index runs produce identical node and edge id sets", () => {
    const appRoot = copyFixtureApp();
    const run = { root: appRoot, indexRunId: "run-1", commit: "commit-aaa", indexedAt: INDEXED_AT_RUN_1 };
    const first = indexSourceTree(run);
    const second = indexSourceTree(run);
    expect(second.nodes.map((node) => node.id)).toEqual(first.nodes.map((node) => node.id));
    expect(second.edges.map((edge) => edge.id)).toEqual(first.edges.map((edge) => edge.id));
    expect(second).toEqual(first); // full payload, timestamps pinned
  });
});

describe("scenario 6: Cypher export for a user-owned Neo4j server", () => {
  it("emits MERGE statements with temporal + provenance properties and the bring-your-own-server header", () => {
    const appRoot = copyFixtureApp();
    const backend = openTempBackend();
    indexInto(backend, appRoot, { indexRunId: "run-1", commit: "commit-aaa" });

    const cypher = exportToCypher(backend);
    expect(cypher).toContain("MERGE (n:CodeNode {id: 'file:src/components/Widget.tsx'})");
    expect(cypher).toContain("MERGE (a)-[r:IMPORTS {id: 'imports:file:src/components/Widget.tsx=>file:src/components/Badge.tsx'}]->(b)");
    expect(cypher).toContain("r.validFromCommit = 'commit-aaa'");
    expect(cypher).toContain("n.indexRunId = 'run-1'");
    expect(cypher).toContain("bring-your-own-server");
  });
});

describe("scenario 7: the repair-prompt seam stays honest and additive", () => {
  function failingMeta(runId: string): ProofloopMetaForLoop {
    return {
      runId,
      suite: "browser-live",
      cmd: "npm run proofloop:live:browser",
      startedAt: "2026-07-03T00:00:00.000Z",
      finishedAt: "2026-07-03T00:01:00.000Z",
      durationMs: 60_000,
      exitCode: 1,
      passed: false,
      failedGates: ['selector [data-testid="widget-panel"] not found'],
      receiptPaths: [],
    };
  }

  it("without a code-graph db the repair prompt has no blast-radius section (behavior unchanged)", () => {
    const repoRoot = makeTempDir("codegraph-repo-nodb-");
    const runDir = join(repoRoot, ".proofloop", "runs", "r1");
    const paths = writeLoopArtifactsForMeta({ meta: failingMeta("r1"), runDir, repoRoot });
    const prompt = readFileSync(paths.repairPromptPath, "utf-8");
    expect(prompt).toContain("## Failing Steps");
    expect(prompt).not.toContain("## Blast radius (code graph)");
  });

  it("with an index present, the failing selector yields a ranked blast-radius section", () => {
    const repoRoot = makeTempDir("codegraph-repo-db-");
    const appRoot = copyFixtureApp();
    const backend = createSqliteBackend({ dbPath: join(repoRoot, ".proofloop", "codegraph", "index.db") });
    backend.init();
    openBackends.push(backend);
    indexInto(backend, appRoot, { indexRunId: "run-1", commit: "commit-aaa" });
    backend.close();

    const runDir = join(repoRoot, ".proofloop", "runs", "r2");
    const paths = writeLoopArtifactsForMeta({ meta: failingMeta("r2"), runDir, repoRoot });
    const prompt = readFileSync(paths.repairPromptPath, "utf-8");
    expect(prompt).toContain("## Blast radius (code graph)");
    expect(prompt).toContain('selector "widget-panel"');
    expect(prompt).toContain("src/components/Widget.tsx");
  });
});

describe("scenario 8: a partial --include index must not falsely expire the rest of the graph", () => {
  it("skips edge invalidation on partial runs so edges from unindexed files stay valid", () => {
    const appRoot = copyFixtureApp();
    const dir = makeTempDir("codegraph-cli-db-");
    const dbPath = join(dir, "index.db");

    // Full index first (via the CLI layer, which owns the guard).
    runGraphIndex(appRoot, ["--db", dbPath]);
    const backend = createSqliteBackend({ dbPath });
    backend.init();
    openBackends.push(backend);
    const validBefore = backend.stats().validEdgeCount;
    expect(validBefore).toBeGreaterThan(0);

    // Guard against a vacuous pass: prove this include pattern really matches a file,
    // so the partial run below genuinely exercises the invalidation-decision path.
    const probe = indexSourceTree({ root: appRoot, include: ["src/components/Badge.tsx"], indexRunId: "probe", commit: "unknown" });
    expect(probe.fileCount).toBe(1);

    // Partial re-index of a subtree that contains only ONE of the fixture files.
    // Before the guard, invalidateEdgesMissingFrom would expire every edge from the
    // files this run never visited — silently corrupting blast-radius answers.
    runGraphIndex(appRoot, ["--db", dbPath, "--include", "src/components/Badge.tsx"]);

    const validAfter = backend.stats().validEdgeCount;
    expect(validAfter).toBe(validBefore);
  });
});
