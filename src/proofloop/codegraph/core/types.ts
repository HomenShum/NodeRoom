/**
 * Code-graph substrate — core object model.
 *
 * Graphiti-style temporal code graph for the Proof Loop repair seam
 * (see docs/architecture/CODE_GRAPH_SUBSTRATE.md):
 *   - every node/edge carries provenance (index run + commit + source),
 *   - edges are bi-temporal (validFromCommit / invalidatedAtCommit for event time,
 *     firstIndexedAt / lastIndexedAt for ingestion time),
 *   - re-indexing invalidates missing edges, it never deletes them.
 *
 * Pure and portable: no Convex imports, no node builtins beyond types.
 */

// ─── Provenance ─────────────────────────────────────────────────────────────

// Where a graph fact actually originated. Kept as a local union (not imported from
// src/nodemem/core/types.ts's NodeMemSource or src/eval/scaffoldProposal.ts's
// ProofLoopSource, which follow the same provenance-typing discipline) so this
// portable module doesn't take on a cross-package import; the doctrine reference is
// noderl/spec/anti-reward-hacking-doctrine.md. Semantics:
//   static_parse          — deterministic TS Compiler API parse of the source tree
//                           (trusted: derived from the user's own code, not a model)
//   heuristic_scan        — grep-level pattern match (route detection); best-effort
//   unresolved_reference  — a name was used but could not be linked to a source file
export type CodeGraphSource =
  | "static_parse"
  | "heuristic_scan"
  | "unresolved_reference";

export interface CodeGraphProvenance {
  /** The index run (episode) that last asserted this node/edge. */
  indexRunId: string;
  /** Git commit the source tree was at during that index run. */
  commit: string;
  source: CodeGraphSource;
}

// ─── Nodes ──────────────────────────────────────────────────────────────────

export type CodeGraphNodeKind = "file" | "symbol" | "component" | "route" | "selector";

export interface CodeGraphNode {
  /** Deterministic, path-based id (forward-slash, repo-relative). See nodeId helpers. */
  id: string;
  kind: CodeGraphNodeKind;
  /** Display name: basename for files, symbol/component name, selector value, route path. */
  label: string;
  /**
   * Repo-relative forward-slash path of the defining file. Empty string for nodes
   * that are not anchored to a single file (selectors, routes, unresolved symbols).
   */
  filePath: string;
  /** Optional extra context, e.g. which route-detection pattern matched. */
  detail?: string;
  provenance: CodeGraphProvenance;
}

// ─── Edges ──────────────────────────────────────────────────────────────────

export type CodeGraphEdgeKind =
  | "imports" // file -> file (resolved module dependency, includes `export ... from`)
  | "exports" // file -> symbol (declared export)
  | "renders" // file -> component|symbol (capitalized JSX usage)
  | "route_renders" // route -> file (the file that declares this route)
  | "has_selector"; // file -> selector (data-testid literal)

export interface CodeGraphEdge {
  /** Deterministic id: `${kind}:${from}=>${to}`. */
  id: string;
  kind: CodeGraphEdgeKind;
  from: string;
  to: string;
  /** Event time: commit at which this fact (last) became valid. */
  validFromCommit: string;
  /** Event time: commit at which a re-index stopped observing this fact. null = still valid. */
  invalidatedAtCommit: string | null;
  /** Ingestion time: ISO timestamp of the first index run that observed this edge. */
  firstIndexedAt: string;
  /** Ingestion time: ISO timestamp of the latest index run that observed this edge. */
  lastIndexedAt: string;
  provenance: CodeGraphProvenance;
}

// ─── Deterministic id helpers ───────────────────────────────────────────────

/** Normalize a path to repo-relative forward-slash form for use inside ids. */
export function normalizeGraphPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function fileNodeId(filePath: string): string {
  return `file:${normalizeGraphPath(filePath)}`;
}

export function symbolNodeId(filePath: string, name: string): string {
  return `symbol:${normalizeGraphPath(filePath)}#${name}`;
}

export function unresolvedSymbolNodeId(name: string): string {
  return `symbol:unresolved#${name}`;
}

export function componentNodeId(filePath: string, name: string): string {
  return `component:${normalizeGraphPath(filePath)}#${name}`;
}

export function selectorNodeId(testId: string): string {
  return `selector:${testId}`;
}

export function routeNodeId(routePath: string): string {
  return `route:${routePath}`;
}

export function edgeId(kind: CodeGraphEdgeKind, from: string, to: string): string {
  return `${kind}:${from}=>${to}`;
}
