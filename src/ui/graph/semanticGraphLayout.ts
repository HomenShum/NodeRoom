import type {
  SemanticGraphLayoutOptions,
  SemanticGraphNode,
  SemanticGraphPosition,
  SemanticGraphViewModel,
} from "./semanticGraphTypes";

const KIND_ORDER: Record<string, number> = {
  artifact: 0,
  deck: 0,
  deck_slide: 1,
  deck_claim: 1,
  spreadsheet_row: 1,
  notebook_block: 1,
  company: 2,
  person: 3,
  agent_job: 3,
  project: 4,
  achievement: 4,
  funding: 4,
  event: 4,
  evidence_fact: 5,
  source: 6,
  trace_step: 7,
  proposal: 7,
  open_question: 8,
};

const stableHash = (value: string): number => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
};

export function semanticGraphNodeSize(label: string): { width: number; height: number } {
  return {
    width: Math.min(184, Math.max(92, Math.min(label.length, 42) * 7 + 36)),
    height: 28,
  };
}

const nodeDegree = (graph: SemanticGraphViewModel): Map<string, number> => {
  const degree = new Map<string, number>();
  for (const node of graph.nodes) degree.set(node.id, 0);
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
  }
  return degree;
};

const adjacency = (graph: SemanticGraphViewModel): Map<string, string[]> => {
  const adj = new Map<string, Set<string>>();
  for (const node of graph.nodes) adj.set(node.id, new Set());
  for (const edge of graph.edges) {
    adj.get(edge.source)?.add(edge.target);
    adj.get(edge.target)?.add(edge.source);
  }
  return new Map([...adj.entries()].map(([id, ids]) => [id, [...ids]]));
};

const sortNodes = (nodes: SemanticGraphNode[], degree: Map<string, number>): SemanticGraphNode[] => [...nodes].sort((a, b) => (
  (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
  (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
  a.label.localeCompare(b.label)
));

const separateOverlaps = (
  graph: SemanticGraphViewModel,
  positions: Map<string, SemanticGraphPosition>,
  fixedId?: string,
): Map<string, SemanticGraphPosition> => {
  const degree = nodeDegree(graph);
  const nodes = sortNodes(graph.nodes.filter((node) => positions.has(node.id)), degree);
  const next = new Map([...positions].map(([id, position]) => [id, { ...position }]));
  const gap = 24;

  for (let iteration = 0; iteration < 32; iteration += 1) {
    let moved = false;
    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const left = nodes[leftIndex];
        const right = nodes[rightIndex];
        const leftPosition = next.get(left.id);
        const rightPosition = next.get(right.id);
        if (!leftPosition || !rightPosition) continue;
        const leftSize = semanticGraphNodeSize(left.label);
        const rightSize = semanticGraphNodeSize(right.label);
        const deltaX = rightPosition.x + rightSize.width / 2 - (leftPosition.x + leftSize.width / 2);
        const deltaY = rightPosition.y + rightSize.height / 2 - (leftPosition.y + leftSize.height / 2);
        const requiredX = (leftSize.width + rightSize.width) / 2 + gap;
        const requiredY = (leftSize.height + rightSize.height) / 2 + gap;
        const overlapX = requiredX - Math.abs(deltaX);
        const overlapY = requiredY - Math.abs(deltaY);
        if (overlapX <= 0 || overlapY <= 0) continue;

        const useX = overlapX < overlapY;
        const rawDelta = useX ? deltaX : deltaY;
        const direction = rawDelta === 0 ? (stableHash(`${left.id}:${right.id}`) % 2 === 0 ? 1 : -1) : Math.sign(rawDelta);
        const distance = (useX ? overlapX : overlapY) + 0.5;
        const leftFixed = left.id === fixedId;
        const rightFixed = right.id === fixedId;
        const leftShift = rightFixed ? distance : leftFixed ? 0 : distance / 2;
        const rightShift = leftFixed ? distance : rightFixed ? 0 : distance / 2;
        if (useX) {
          leftPosition.x -= direction * leftShift;
          rightPosition.x += direction * rightShift;
        } else {
          leftPosition.y -= direction * leftShift;
          rightPosition.y += direction * rightShift;
        }
        moved = true;
      }
    }
    if (!moved) break;
  }
  return next;
};

const selectCenter = (graph: SemanticGraphViewModel, options: SemanticGraphLayoutOptions, degree: Map<string, number>): SemanticGraphNode | undefined => {
  if (options.selectedId) {
    const selected = graph.nodes.find((node) => node.id === options.selectedId);
    if (selected) return selected;
  }
  return [...graph.nodes].sort((a, b) => (
    (b.kind === "company" ? 20 : 0) - (a.kind === "company" ? 20 : 0) ||
    b.weight - a.weight ||
    (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0) ||
    a.label.localeCompare(b.label)
  ))[0];
};

const constellation = (graph: SemanticGraphViewModel, options: SemanticGraphLayoutOptions): Map<string, SemanticGraphPosition> => {
  const degree = nodeDegree(graph);
  const adj = adjacency(graph);
  const center = selectCenter(graph, options, degree);
  const positions = new Map<string, SemanticGraphPosition>();
  if (!center) return positions;

  positions.set(center.id, { x: 0, y: 0 });
  const levels = new Map<string, number>([[center.id, 0]]);
  let frontier = [center.id];
  for (let depth = 1; depth <= 4; depth += 1) {
    const next: string[] = [];
    for (const nodeId of frontier) {
      for (const target of adj.get(nodeId) ?? []) {
        if (!levels.has(target)) {
          levels.set(target, depth);
          next.push(target);
        }
      }
    }
    frontier = next;
  }
  for (const node of graph.nodes) if (!levels.has(node.id)) levels.set(node.id, 5);

  const rings = new Map<number, SemanticGraphNode[]>();
  for (const node of graph.nodes) {
    const level = levels.get(node.id) ?? 5;
    rings.set(level, [...(rings.get(level) ?? []), node]);
  }

  const radii = [0, 170, 285, 400, 515, 620];
  for (const [level, nodes] of [...rings.entries()].sort((a, b) => a[0] - b[0])) {
    if (level === 0) continue;
    const sorted = sortNodes(nodes, degree);
    const radius = radii[Math.min(level, radii.length - 1)] ?? 620;
    sorted.forEach((node, index) => {
      const count = Math.max(1, sorted.length);
      const angle = -Math.PI / 2 + (index / count) * Math.PI * 2 + ((stableHash(node.id) % 9) - 4) * 0.012;
      const stagger = count > 12 ? (index % 3) * 34 : 0;
      positions.set(node.id, {
        x: Math.cos(angle) * (radius + stagger),
        y: Math.sin(angle) * (radius + stagger),
      });
    });
  }
  return separateOverlaps(graph, positions, center.id);
};

const clusterLanes = (graph: SemanticGraphViewModel): Map<string, SemanticGraphPosition> => {
  const degree = nodeDegree(graph);
  const positions = new Map<string, SemanticGraphPosition>();
  const byKind = new Map<string, SemanticGraphNode[]>();
  for (const node of graph.nodes) byKind.set(node.kind, [...(byKind.get(node.kind) ?? []), node]);
  const lanes = [...byKind.entries()].sort((a, b) => (KIND_ORDER[a[0]] ?? 9) - (KIND_ORDER[b[0]] ?? 9));
  lanes.forEach(([, nodes], laneIndex) => {
    const sorted = sortNodes(nodes, degree);
    const total = sorted.length;
    sorted.forEach((node, rowIndex) => {
      positions.set(node.id, {
        x: laneIndex * 285,
        y: (rowIndex - (total - 1) / 2) * 86,
      });
    });
  });
  return positions;
};

const traceStory = (graph: SemanticGraphViewModel): Map<string, SemanticGraphPosition> => {
  const degree = nodeDegree(graph);
  const positions = new Map<string, SemanticGraphPosition>();
  const traces = sortNodes(graph.nodes.filter((node) => node.kind === "trace_step" || node.kind === "proposal" || node.kind === "agent_job"), degree);
  const context = sortNodes(graph.nodes.filter((node) => !traces.includes(node)), degree);
  traces.forEach((node, index) => positions.set(node.id, { x: index * 240, y: 0 }));
  context.forEach((node, index) => {
    const lane = index % 2 === 0 ? -1 : 1;
    const offset = Math.floor(index / 2);
    positions.set(node.id, {
      x: offset * 180,
      y: lane * (150 + (offset % 3) * 54),
    });
  });
  return positions;
};

export function layoutSemanticGraph(graph: SemanticGraphViewModel, options: SemanticGraphLayoutOptions = {}): Map<string, SemanticGraphPosition> {
  if (options.mode === "cluster-lanes") return clusterLanes(graph);
  if (options.mode === "trace-story") return traceStory(graph);
  return constellation(graph, options);
}
