/**
 * Code-graph substrate — barrel export.
 *
 * Graphiti-style temporal code graph for the Proof Loop repair seam:
 * deterministic TS-syntax extraction, bi-temporal edges (invalidate-not-delete),
 * SQLite/FTS5 default backend, blast-radius retrieval, Cypher export.
 * See docs/architecture/CODE_GRAPH_SUBSTRATE.md.
 */

// Core types + deterministic id helpers
export * from "./core/types";

// Indexer (TS Compiler API, syntax-level)
export { indexSourceTree } from "./core/indexer";
export type { IndexSourceTreeOptions, IndexSourceTreeResult } from "./core/indexer";

// Queries (backend-agnostic)
export { blastRadius, searchSymbols } from "./core/query";
export type { BlastRadiusSeed, BlastRadiusOptions, BlastRadiusEntry } from "./core/query";

// Ports
export type { GraphBackend, NeighborDirection, NeighborEntry, CodeGraphStats } from "./ports/backend";

// Adapters
export { createSqliteBackend, DEFAULT_CODEGRAPH_DB_RELPATH } from "./adapters/sqliteBackend";
export type { SqliteBackendOptions } from "./adapters/sqliteBackend";
export { exportToCypher } from "./adapters/cypherExport";

// ProofLoop orchestrator compatibility surface
export { proofloopCodeGraphPaths, queryProofloopCodeGraph, writeProofloopCodeGraph } from "./indexer";
export type {
  ProofloopCodeGraph,
  ProofloopCodeGraphIndexOptions,
  ProofloopCodeGraphPaths,
  ProofloopCodeGraphQueryHit,
} from "./types";
