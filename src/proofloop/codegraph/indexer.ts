import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createSqliteBackend, DEFAULT_CODEGRAPH_DB_RELPATH } from "./adapters/sqliteBackend";
import { indexSourceTree } from "./core/indexer";
import type { CodeGraphEdge, CodeGraphNode } from "./core/types";
import type {
  ProofloopCodeGraph,
  ProofloopCodeGraphEdge,
  ProofloopCodeGraphIndexOptions,
  ProofloopCodeGraphNode,
  ProofloopCodeGraphNodeKind,
  ProofloopCodeGraphPaths,
  ProofloopCodeGraphQueryHit,
} from "./types";

const META_LAST_INDEX_COMMIT = "last_index_commit";
const META_LAST_INDEX_RUN_ID = "last_index_run_id";
const META_LAST_INDEXED_AT = "last_indexed_at";

export function proofloopCodeGraphPaths(root: string): ProofloopCodeGraphPaths {
  const dir = join(root, ".proofloop", "codegraph");
  return {
    dir,
    manifestPath: join(dir, "graph-manifest.json"),
    nodesPath: join(dir, "nodes.json"),
    edgesPath: join(dir, "edges.json"),
    eventsPath: join(dir, "index-events.jsonl"),
    dbPath: join(root, DEFAULT_CODEGRAPH_DB_RELPATH),
  };
}

export function writeProofloopCodeGraph(options: ProofloopCodeGraphIndexOptions): ProofloopCodeGraph {
  const root = resolve(options.root);
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  const indexRunId = `plcg-${generatedAt.replace(/[:.]/g, "-")}`;
  const commit = gitCurrentCommit(root);
  const paths = proofloopCodeGraphPaths(root);
  mkdirSync(paths.dir, { recursive: true });

  const result = indexSourceTree({
    root,
    ...(options.include?.length ? { include: options.include } : {}),
    indexRunId,
    commit,
    indexedAt: generatedAt,
  });
  const backend = createSqliteBackend({ dbPath: paths.dbPath });
  let invalidated = 0;
  let validEdgeCount = result.edges.length;
  try {
    backend.init();
    backend.upsertNodes(result.nodes);
    backend.upsertEdges(result.edges);
    if (!options.include?.length) invalidated = backend.invalidateEdgesMissingFrom(indexRunId, commit);
    backend.setMeta(META_LAST_INDEX_COMMIT, commit);
    backend.setMeta(META_LAST_INDEX_RUN_ID, indexRunId);
    backend.setMeta(META_LAST_INDEXED_AT, generatedAt);
    validEdgeCount = backend.stats().validEdgeCount;
  } finally {
    backend.close();
  }

  const nodes = result.nodes.map(toCompatNode);
  const edges = result.edges.map(toCompatEdge);
  const graph: ProofloopCodeGraph = {
    schema: "proofloop-codegraph-v1",
    root,
    generatedAt,
    dbPath: relativePath(root, paths.dbPath),
    nodes,
    edges,
    summary: {
      fileCount: nodes.filter((node) => node.kind === "file").length,
      scriptCount: nodes.filter((node) => node.kind === "script").length,
      symbolCount: nodes.filter((node) => node.kind === "symbol").length,
      selectorCount: nodes.filter((node) => node.kind === "selector").length,
      proofArtifactCount: nodes.filter((node) => node.kind === "proof_artifact").length,
      componentCount: nodes.filter((node) => node.kind === "component").length,
      routeCount: nodes.filter((node) => node.kind === "route").length,
      edgeCount: edges.length,
      validEdgeCount,
      invalidatedEdgeCount: invalidated,
    },
  };

  writeJson(paths.manifestPath, {
    schema: graph.schema,
    root: graph.root,
    generatedAt: graph.generatedAt,
    dbPath: graph.dbPath,
    summary: graph.summary,
    indexRunId,
    commit,
    files: {
      db: relativePath(root, paths.dbPath),
      nodes: relativePath(root, paths.nodesPath),
      edges: relativePath(root, paths.edgesPath),
      events: relativePath(root, paths.eventsPath),
    },
  });
  writeJson(paths.nodesPath, nodes);
  writeJson(paths.edgesPath, edges);
  writeFileSync(
    paths.eventsPath,
    `${JSON.stringify({
      ts: generatedAt,
      type: "codegraph_indexed",
      indexRunId,
      commit,
      fileCount: graph.summary.fileCount,
      symbolCount: graph.summary.symbolCount,
      selectorCount: graph.summary.selectorCount,
      edgeCount: graph.summary.edgeCount,
      validEdgeCount,
      invalidatedEdgeCount: invalidated,
      dbPath: graph.dbPath,
    })}\n`,
    "utf8",
  );

  return graph;
}

export function queryProofloopCodeGraph(
  graph: ProofloopCodeGraph,
  query: string,
  limit = 12,
): ProofloopCodeGraphQueryHit[] {
  const tokens = tokenize(query);
  if (!tokens.length) return [];

  const dbPath = graph.dbPath ? resolve(graph.root, graph.dbPath) : undefined;
  if (dbPath) {
    const backend = createSqliteBackend({ dbPath });
    try {
      backend.init();
      return backend
        .allNodes()
        .map((node) => scoreCodeGraphNode(node, tokens))
        .filter((hit): hit is ProofloopCodeGraphQueryHit => Boolean(hit))
        .sort(rankHits)
        .slice(0, limit);
    } catch {
      // Fall back to the JSON compatibility payload below.
    } finally {
      backend.close();
    }
  }

  return graph.nodes
    .map((node) => scoreCompatNode(node, tokens))
    .filter((hit): hit is ProofloopCodeGraphQueryHit => Boolean(hit))
    .sort(rankHits)
    .slice(0, limit);
}

function toCompatNode(node: CodeGraphNode): ProofloopCodeGraphNode {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    path: node.filePath || undefined,
    metadata: {
      file: node.filePath,
      detail: node.detail,
      source: node.provenance.source,
      commit: node.provenance.commit,
      indexRunId: node.provenance.indexRunId,
      searchText: [node.label, node.filePath, node.detail].filter(Boolean).join(" "),
    },
  };
}

function toCompatEdge(edge: CodeGraphEdge): ProofloopCodeGraphEdge {
  return {
    from: edge.from,
    to: edge.to,
    kind: edge.kind,
    metadata: {
      id: edge.id,
      validFromCommit: edge.validFromCommit,
      invalidatedAtCommit: edge.invalidatedAtCommit,
      firstIndexedAt: edge.firstIndexedAt,
      lastIndexedAt: edge.lastIndexedAt,
      source: edge.provenance.source,
    },
  };
}

function scoreCodeGraphNode(node: CodeGraphNode, tokens: string[]): ProofloopCodeGraphQueryHit | undefined {
  const metadataText = [node.detail, node.provenance.source, node.provenance.commit].filter(Boolean).join(" ");
  return scoreFields({
    nodeId: node.id,
    kind: node.kind,
    label: node.label,
    path: node.filePath || undefined,
    metadataText,
    tokens,
  });
}

function scoreCompatNode(node: ProofloopCodeGraphNode, tokens: string[]): ProofloopCodeGraphQueryHit | undefined {
  return scoreFields({
    nodeId: node.id,
    kind: node.kind,
    label: node.label,
    path: node.path,
    metadataText: Object.values(node.metadata ?? {}).join(" "),
    tokens,
  });
}

function scoreFields(args: {
  nodeId: string;
  kind: ProofloopCodeGraphNodeKind;
  label: string;
  path?: string;
  metadataText: string;
  tokens: string[];
}): ProofloopCodeGraphQueryHit | undefined {
  const path = args.path ?? "";
  const label = args.label.toLowerCase();
  const metadata = args.metadataText.toLowerCase();
  const pathLower = path.toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  for (const token of args.tokens) {
    if (pathLower.includes(token)) {
      score += 4;
      reasons.push(`path:${token}`);
    }
    if (label.includes(token)) {
      score += 3;
      reasons.push(`label:${token}`);
    }
    if (metadata.includes(token)) {
      score += 1;
      reasons.push(`metadata:${token}`);
    }
  }
  if (args.kind === "file" && /proofloop|benchmark|harness|score|scorer/.test(pathLower)) {
    score += 1;
    reasons.push("proofloop-file");
  }
  if (score <= 0) return undefined;
  return {
    nodeId: args.nodeId,
    kind: args.kind,
    label: args.label,
    path: args.path,
    score,
    reasons: [...new Set(reasons)],
  };
}

function rankHits(a: ProofloopCodeGraphQueryHit, b: ProofloopCodeGraphQueryHit): number {
  return b.score - a.score || (a.path ?? a.label).localeCompare(b.path ?? b.label);
}

function gitCurrentCommit(root: string): string {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function tokenize(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  ];
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function relativePath(root: string, path: string): string {
  const normalizedRoot = normalizeSlash(resolve(root));
  const normalizedPath = normalizeSlash(resolve(path));
  return normalizedPath.startsWith(normalizedRoot)
    ? normalizedPath.slice(normalizedRoot.length + 1)
    : relative(root, path).replace(/\\/g, "/");
}

function normalizeSlash(value: string): string {
  return value.replace(/\\/g, "/");
}
