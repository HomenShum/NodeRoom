export * from "./core/types";

export type ProofloopCodeGraphNodeKind =
  | "file"
  | "script"
  | "symbol"
  | "selector"
  | "proof_artifact"
  | "component"
  | "route";

export type ProofloopCodeGraphEdgeKind =
  | "imports"
  | "declares"
  | "exposes_selector"
  | "writes_artifact"
  | "runs_script"
  | "exports"
  | "renders"
  | "route_renders"
  | "has_selector";

export type ProofloopCodeGraphNode = {
  id: string;
  kind: ProofloopCodeGraphNodeKind;
  label: string;
  path?: string;
  metadata: Record<string, unknown>;
};

export type ProofloopCodeGraphEdge = {
  from: string;
  to: string;
  kind: ProofloopCodeGraphEdgeKind;
  metadata?: Record<string, unknown>;
};

export type ProofloopCodeGraph = {
  schema: "proofloop-codegraph-v1";
  root: string;
  generatedAt: string;
  dbPath?: string;
  nodes: ProofloopCodeGraphNode[];
  edges: ProofloopCodeGraphEdge[];
  summary: {
    fileCount: number;
    scriptCount: number;
    symbolCount: number;
    selectorCount: number;
    proofArtifactCount: number;
    componentCount?: number;
    routeCount?: number;
    edgeCount?: number;
    validEdgeCount?: number;
    invalidatedEdgeCount?: number;
  };
};

export type ProofloopCodeGraphPaths = {
  dir: string;
  manifestPath: string;
  nodesPath: string;
  edgesPath: string;
  eventsPath: string;
  dbPath: string;
};

export type ProofloopCodeGraphIndexOptions = {
  root: string;
  generatedAt?: string;
  include?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
};

export type ProofloopCodeGraphQueryHit = {
  nodeId: string;
  kind: ProofloopCodeGraphNodeKind;
  label: string;
  path?: string;
  score: number;
  reasons: string[];
};
