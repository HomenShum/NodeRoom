/**
 * Code-graph backend port.
 *
 * The GraphBackend interface is the insurance policy against the embedded graph-DB
 * landscape (docs/architecture/CODE_GRAPH_SUBSTRATE.md): the default adapter is
 * node:sqlite; Neo4j (or a future embedded engine) plugs in behind this seam.
 */
import type {
  CodeGraphEdge,
  CodeGraphEdgeKind,
  CodeGraphNode,
} from "../core/types";

export type NeighborDirection = "out" | "in" | "both";

export interface NeighborEntry {
  edge: CodeGraphEdge;
  /** The node on the far side of the edge from the queried node. */
  node: CodeGraphNode;
  /** "out" = edge leaves the queried node; "in" = edge points at it. */
  direction: "out" | "in";
}

export interface CodeGraphStats {
  nodeCount: number;
  edgeCount: number;
  validEdgeCount: number;
  invalidatedEdgeCount: number;
  nodesByKind: Record<string, number>;
  edgesByKind: Record<string, number>;
}

export interface GraphBackend {
  /** Create tables/indexes; idempotent. */
  init(): void;
  upsertNodes(nodes: CodeGraphNode[]): void;
  /**
   * Insert or refresh edges. A re-observed edge keeps firstIndexedAt and (when it was
   * still valid) validFromCommit; a previously-invalidated edge that reappears is
   * re-validated with validFromCommit = the new commit. Never deletes.
   */
  upsertEdges(edges: CodeGraphEdge[]): void;
  /**
   * Bi-temporal invalidation: mark still-valid edges NOT observed by this index run
   * (provenance.indexRunId !== indexRunId) as invalidatedAtCommit = commit.
   * Never deletes. Returns the number of edges invalidated.
   */
  invalidateEdgesMissingFrom(indexRunId: string, commit: string): number;
  getNode(nodeId: string): CodeGraphNode | undefined;
  neighbors(
    nodeId: string,
    direction: NeighborDirection,
    edgeKinds?: CodeGraphEdgeKind[],
    onlyValid?: boolean,
  ): NeighborEntry[];
  /** FTS (bm25) over node label + filePath, with prefix matching; LIKE fallback. */
  searchNames(query: string, limit?: number): CodeGraphNode[];
  allNodes(): CodeGraphNode[];
  allEdges(onlyValid?: boolean): CodeGraphEdge[];
  /** Small key/value meta store (e.g. last_index_commit for the recency overlay). */
  getMeta(key: string): string | undefined;
  setMeta(key: string, value: string): void;
  stats(): CodeGraphStats;
  close(): void;
}
