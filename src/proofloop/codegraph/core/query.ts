/**
 * Code-graph queries — backend-agnostic blast radius + symbol search.
 *
 * blastRadius answers the repair loop's question: "this selector/route/file/symbol
 * failed — which files could be responsible?" via BFS over valid edges:
 *   - selector/route seeds expand through has_selector/route_renders/renders,
 *     reversed into the files that declare them;
 *   - file seeds expand dependents-first (reverse imports), then forward imports;
 *   - symbol/component nodes fold into their defining file (same depth).
 *
 * Deterministic ranking, no embeddings: score = depthDecay (1/(depth+1)) * log(1+degree),
 * with an optional recently-changed overlay (the git call lives in the CLI layer —
 * src/eval/proofloopCodeGraph.ts — so this core stays pure).
 */
import type { GraphBackend, NeighborEntry } from "../ports/backend";
import {
  fileNodeId,
  normalizeGraphPath,
  routeNodeId,
  selectorNodeId,
  type CodeGraphEdgeKind,
  type CodeGraphNode,
} from "./types";

export interface BlastRadiusSeed {
  file?: string;
  selector?: string;
  route?: string;
  symbol?: string;
}

export interface BlastRadiusOptions {
  maxDepth?: number;
  limit?: number;
  /**
   * Recently-changed overlay hook: repo-relative files (e.g. from `git diff --name-only`
   * against the last index commit). Matching results get a score boost + flag.
   */
  recentFiles?: string[];
}

export interface BlastRadiusEntry {
  file: string;
  symbols: string[];
  score: number;
  depth: number;
  why: string[];
  recentlyChanged: boolean;
}

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_LIMIT = 25;
const RECENT_CHANGE_BOOST = 1.5;

export function blastRadius(
  backend: GraphBackend,
  seed: BlastRadiusSeed,
  options: BlastRadiusOptions = {},
): BlastRadiusEntry[] {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const seedNodes = resolveSeedNodes(backend, seed);
  if (!seedNodes.length) return [];

  type QueueEntry = { node: CodeGraphNode; depth: number; why: string };
  const visited = new Set<string>();
  const fileHits = new Map<string, { depth: number; whys: string[]; symbols: Set<string> }>();
  const queue: QueueEntry[] = seedNodes.map((node) => ({ node, depth: 0, why: "seed" }));

  const enqueue = (node: CodeGraphNode, depth: number, why: string): void => {
    if (visited.has(node.id) || depth > maxDepth) return;
    visited.add(node.id);
    queue.push({ node, depth, why });
  };
  for (const entry of queue) visited.add(entry.node.id);

  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    const { node, depth, why } = current;

    if (node.filePath) {
      const hit = fileHits.get(node.filePath) ?? { depth, whys: [], symbols: new Set<string>() };
      hit.depth = Math.min(hit.depth, depth);
      if (!hit.whys.includes(why)) hit.whys.push(why);
      if (node.kind === "symbol" || node.kind === "component") hit.symbols.add(node.label);
      fileHits.set(node.filePath, hit);
      // Non-file nodes anchored to a file fold into that file at the same depth.
      if (node.kind !== "file") {
        const fileNode = backend.getNode(fileNodeId(node.filePath));
        if (fileNode) enqueue(fileNode, depth, `defines ${node.label}`);
      }
    }
    if (depth >= maxDepth) continue;

    for (const neighbor of expandNode(backend, node)) {
      enqueue(neighbor.node, depth + 1, neighbor.why);
    }
  }

  const recentFiles = new Set((options.recentFiles ?? []).map(normalizeGraphPath));
  const entries: BlastRadiusEntry[] = [...fileHits.entries()].map(([file, hit]) => {
    const degree = backend.neighbors(fileNodeId(file), "both", undefined, true).length;
    const recentlyChanged = recentFiles.has(file);
    const baseScore = (1 / (hit.depth + 1)) * Math.log(1 + degree);
    return {
      file,
      symbols: [...hit.symbols].sort(),
      score: round3(recentlyChanged ? baseScore * RECENT_CHANGE_BOOST : baseScore),
      depth: hit.depth,
      why: recentlyChanged ? [...hit.whys, "recently changed"] : hit.whys,
      recentlyChanged,
    };
  });
  return entries
    .sort((a, b) => b.score - a.score || a.depth - b.depth || a.file.localeCompare(b.file))
    .slice(0, limit);
}

export function searchSymbols(backend: GraphBackend, query: string, limit = 20): CodeGraphNode[] {
  return backend.searchNames(query, limit);
}

// ─── Seed resolution ────────────────────────────────────────────────────────

function resolveSeedNodes(backend: GraphBackend, seed: BlastRadiusSeed): CodeGraphNode[] {
  const nodes: CodeGraphNode[] = [];
  if (seed.file) {
    const node =
      backend.getNode(fileNodeId(seed.file)) ??
      backend.searchNames(seed.file, 5).find((candidate) => candidate.kind === "file");
    if (node) nodes.push(node);
  }
  if (seed.selector) {
    const node = backend.getNode(selectorNodeId(seed.selector));
    if (node) nodes.push(node);
  }
  if (seed.route) {
    const node = backend.getNode(routeNodeId(seed.route));
    if (node) nodes.push(node);
  }
  if (seed.symbol) {
    const matches = backend
      .searchNames(seed.symbol, 10)
      .filter((candidate) => candidate.kind === "symbol" || candidate.kind === "component")
      .slice(0, 3);
    nodes.push(...matches);
  }
  const unique = new Map(nodes.map((node) => [node.id, node]));
  return [...unique.values()];
}

// ─── Expansion rules ────────────────────────────────────────────────────────

function expandNode(backend: GraphBackend, node: CodeGraphNode): Array<{ node: CodeGraphNode; why: string }> {
  const out: Array<{ node: CodeGraphNode; why: string }> = [];
  const push = (entries: NeighborEntry[], why: (entry: NeighborEntry) => string): void => {
    for (const entry of entries) out.push({ node: entry.node, why: why(entry) });
  };
  if (node.kind === "selector") {
    push(backend.neighbors(node.id, "in", ["has_selector"], true), () => `contains selector "${node.label}"`);
    return out;
  }
  if (node.kind === "route") {
    push(backend.neighbors(node.id, "both", ["route_renders", "renders"], true), () => `declares route ${node.label}`);
    return out;
  }
  if (node.kind === "symbol" || node.kind === "component") {
    push(backend.neighbors(node.id, "in", ["renders"], true), () => `renders ${node.label}`);
    push(backend.neighbors(node.id, "in", ["exports"], true), () => `exports ${node.label}`);
    return out;
  }
  // File nodes: dependents first (reverse imports), then forward imports, then the rest.
  push(backend.neighbors(node.id, "in", ["imports"], true), () => `imports ${node.filePath || node.label}`);
  push(backend.neighbors(node.id, "out", ["imports"], true), () => `imported by ${node.filePath || node.label}`);
  const restKinds: CodeGraphEdgeKind[] = ["renders", "exports", "has_selector", "route_renders"];
  push(backend.neighbors(node.id, "both", restKinds, true), (entry) => `${entry.edge.kind} ${node.filePath || node.label}`);
  return out;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
