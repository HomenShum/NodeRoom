import type { OkfConcept } from "./types";

export interface OkfGraphEdge {
  from: string;
  to: string;
  label: string;
}

export interface OkfGraph {
  concepts: Map<string, OkfConcept>;
  outgoing: Map<string, OkfGraphEdge[]>;
  incoming: Map<string, OkfGraphEdge[]>;
}

export function buildOkfGraph(concepts: OkfConcept[]): OkfGraph {
  const conceptMap = new Map(concepts.map((concept) => [concept.id, concept]));
  const outgoing = new Map<string, OkfGraphEdge[]>();
  const incoming = new Map<string, OkfGraphEdge[]>();
  for (const concept of concepts) {
    const edges = concept.links
      .filter((link) => !!link.conceptId)
      .map((link) => ({ from: concept.id, to: link.conceptId as string, label: link.label }));
    outgoing.set(concept.id, edges);
    for (const edge of edges) {
      const list = incoming.get(edge.to) ?? [];
      list.push(edge);
      incoming.set(edge.to, list);
    }
  }
  return { concepts: conceptMap, outgoing, incoming };
}

export function expandOkfNeighbors(graph: OkfGraph, conceptId: string, depth: number): OkfConcept[] {
  const seen = new Set<string>([conceptId]);
  const queue: Array<{ id: string; depth: number }> = [{ id: conceptId, depth: 0 }];
  while (queue.length) {
    const cur = queue.shift();
    if (!cur || cur.depth >= depth) continue;
    const edges = [...(graph.outgoing.get(cur.id) ?? []), ...(graph.incoming.get(cur.id) ?? [])];
    for (const edge of edges) {
      const next = edge.from === cur.id ? edge.to : edge.from;
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ id: next, depth: cur.depth + 1 });
    }
  }
  return [...seen].map((id) => graph.concepts.get(id)).filter((concept): concept is OkfConcept => !!concept);
}

