import { buildOkfGraph, expandOkfNeighbors } from "../../okf/graph";
import type { OkfConcept } from "../../okf/types";

export function okfBacklinks(concepts: OkfConcept[], conceptId: string, depth = 1, limit = 50): OkfConcept[] {
  const graph = buildOkfGraph(concepts);
  const seen = new Set<string>();
  let frontier = [conceptId];
  for (let i = 0; i < depth; i++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const edge of graph.incoming.get(id) ?? []) {
        if (!seen.has(edge.from)) {
          seen.add(edge.from);
          next.push(edge.from);
        }
      }
    }
    frontier = next;
  }
  return [...seen].map((id) => graph.concepts.get(id)).filter((concept): concept is OkfConcept => !!concept).slice(0, limit);
}

export function okfNeighbors(concepts: OkfConcept[], conceptId: string, depth: number, includeBacklinks: boolean, limit = 50): OkfConcept[] {
  const graph = buildOkfGraph(concepts);
  const expanded = includeBacklinks
    ? expandOkfNeighbors(graph, conceptId, depth)
    : [graph.concepts.get(conceptId), ...(graph.outgoing.get(conceptId) ?? []).map((edge) => graph.concepts.get(edge.to))].filter((concept): concept is OkfConcept => !!concept);
  return expanded.slice(0, limit);
}

