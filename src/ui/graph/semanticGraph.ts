import type { Actor, Artifact, CellEvidence, CellPayload, DataframeColumn, Element } from "../../engine/types";
import {
  CELL_STATUS_TO_SEMANTIC_STATUS,
  type SemanticGraphCluster,
  type SemanticGraphClusterKind,
  type SemanticGraphEdge,
  type SemanticGraphEdgeKind,
  type SemanticGraphInput,
  type SemanticGraphNode,
  type SemanticGraphNodeKind,
  type SemanticGraphRef,
  type SemanticGraphStatus,
  type SemanticGraphViewModel,
} from "./semanticGraphTypes";

const DEFAULT_MAX_ROWS_PER_SHEET = 80;
const DEFAULT_MAX_EVIDENCE_FACTS = 180;
const LABEL_LIMIT = 64;

const COMPANY_RE = /\b(company|account|name|organization|startup|entity|vendor|customer)\b/i;
const PERSON_RE = /\b(owner|founder|ceo|cfo|contact|lead|partner|investor|analyst|researcher|person)\b/i;
const SOURCE_RE = /\b(source|url|link|citation|reference|ref|website)\b/i;
const PROJECT_RE = /\b(product|project|platform|app|tool|repo|repository|workflow|workstream)\b/i;
const ACHIEVEMENT_RE = /\b(award|achievement|recognition|grant|patent|security|hipaa|approval|milestone)\b/i;
const FUNDING_RE = /\b(funding|series|round|valuation|revenue|arr|amount|capital|investor)\b/i;
const EVENT_RE = /\b(event|trial|conference|hackathon|demo|pitch|webinar|meetup|summit|deployment)\b/i;
const QUESTION_RE = /\b(question|risk|gap|todo|follow[- ]?up|review|unknown|needs)\b/i;
const URL_RE = /https?:\/\/[^\s"'<>\])]+/gi;

interface MutableGraph {
  nodes: Map<string, SemanticGraphNode>;
  edges: Map<string, SemanticGraphEdge>;
  clusters: Map<string, SemanticGraphCluster>;
  factsAdded: number;
  maxEvidenceFacts: number;
}

interface SheetContext {
  artifact: Artifact;
  columns: DataframeColumn[];
  nameCol: DataframeColumn;
  personCols: DataframeColumn[];
  sourceCols: DataframeColumn[];
  factCols: DataframeColumn[];
  questionCols: DataframeColumn[];
}

const truncate = (value: string, limit = LABEL_LIMIT): string => {
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "-")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1)).trim()}...`;
};

const slug = (value: string): string => truncate(value.toLowerCase(), 96)
  .replace(/https?:\/\//g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "") || "item";

const nodeId = (kind: SemanticGraphNodeKind, key: string): string => `${kind}:${slug(key)}`;
const scopedNodeId = (kind: SemanticGraphNodeKind, scope: string, key: string): string => `${kind}:${slug(scope)}:${slug(key)}`;
const edgeId = (kind: SemanticGraphEdgeKind, source: string, target: string, refKey = ""): string => `${kind}:${source}->${target}${refKey ? `:${slug(refKey)}` : ""}`;

const statusPriority: Record<SemanticGraphStatus, number> = {
  failed: 7,
  rejected: 6,
  needs_review: 5,
  running: 4,
  source_backed: 3,
  graph_inferred: 2,
  manual: 1,
};

const strongestStatus = (a: SemanticGraphStatus, b: SemanticGraphStatus): SemanticGraphStatus => (
  statusPriority[b] > statusPriority[a] ? b : a
);

const isPayload = (value: unknown): value is CellPayload => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return "value" in candidate && ("status" in candidate || "evidence" in candidate || "confidence" in candidate || "review" in candidate || "normalizedValue" in candidate);
};

export const semanticCellText = (value: unknown): string => {
  if (isPayload(value)) return semanticCellText(value.value);
  if (typeof value === "string") return truncate(value, 240);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text.trim();
    if (typeof obj.label === "string") return obj.label.trim();
    if (typeof obj.title === "string") return obj.title.trim();
  }
  return "";
};

const payloadEvidence = (value: unknown): CellEvidence[] => (isPayload(value) && Array.isArray(value.evidence) ? value.evidence : []);

const payloadStatus = (value: unknown): SemanticGraphStatus => {
  if (!isPayload(value)) return "manual";
  if (value.status && value.status !== "complete") return CELL_STATUS_TO_SEMANTIC_STATUS[value.status];
  const evidence = value.evidence ?? [];
  if (evidence.some((item) => item.kind === "source" || item.kind === "upload")) return "source_backed";
  if (evidence.some((item) => item.kind === "computed")) return "graph_inferred";
  if (evidence.some((item) => item.kind === "manual")) return "manual";
  if (value.status === "complete") return "source_backed";
  return "manual";
};

const columnMatches = (column: DataframeColumn, pattern: RegExp): boolean => pattern.test(column.label) || pattern.test(column.id);

const artifactKindLabel = (artifact: Artifact): string => {
  if (artifact.kind === "sheet") return artifact.meta?.dataframe?.sourceFile ? "source-backed sheet" : "sheet";
  if (artifact.kind === "note") return "notebook";
  return "wall";
};

const elementIdsOf = (artifact: Artifact): string[] => {
  const ids = artifact.order.length > 0 ? artifact.order : Object.keys(artifact.elements);
  return [...new Set(ids)].filter((id) => artifact.elements[id]);
};

const rowIdsOf = (artifact: Artifact): string[] => {
  const rowIds = elementIdsOf(artifact).map((id) => id.split("__")[0]).filter(Boolean);
  return [...new Set(rowIds)];
};

const sourceLabel = (urlOrSource: string): string => {
  try {
    const url = new URL(urlOrSource);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return truncate(urlOrSource, 44);
  }
};

const extractUrls = (text: string): string[] => {
  const matches = text.match(URL_RE) ?? [];
  return [...new Set(matches.map((url) => url.replace(/[.,;:)]+$/, "")))];
};

const actorNodeKind = (actor: Actor): SemanticGraphNodeKind => actor.kind === "agent" ? "agent_job" : "person";

const actorLabel = (actor: Actor): string => actor.kind === "agent" ? actor.name.replace(/\s*\(.*?\)\s*$/g, "") : actor.name;

const ensureNode = (graph: MutableGraph, next: Omit<SemanticGraphNode, "refs" | "clusterIds" | "weight"> & {
  refs?: SemanticGraphRef[];
  clusterIds?: string[];
  weight?: number;
}): SemanticGraphNode => {
  const existing = graph.nodes.get(next.id);
  if (existing) {
    existing.status = strongestStatus(existing.status, next.status);
    existing.weight = Math.max(existing.weight, next.weight ?? 1);
    existing.refs.push(...(next.refs ?? []));
    for (const clusterId of next.clusterIds ?? []) if (!existing.clusterIds.includes(clusterId)) existing.clusterIds.push(clusterId);
    existing.subtitle = existing.subtitle ?? next.subtitle;
    existing.actor = existing.actor ?? next.actor;
    existing.meta = { ...existing.meta, ...next.meta };
    return existing;
  }
  const node: SemanticGraphNode = {
    ...next,
    refs: next.refs ?? [],
    clusterIds: next.clusterIds ?? [],
    weight: next.weight ?? 1,
  };
  graph.nodes.set(node.id, node);
  return node;
};

const ensureEdge = (graph: MutableGraph, next: Omit<SemanticGraphEdge, "refs" | "weight"> & {
  refs?: SemanticGraphRef[];
  weight?: number;
}): SemanticGraphEdge => {
  if (next.source === next.target) {
    return {
      ...next,
      id: `${next.id}:self`,
      refs: next.refs ?? [],
      weight: next.weight ?? 0,
    };
  }
  const existing = graph.edges.get(next.id);
  if (existing) {
    existing.status = strongestStatus(existing.status, next.status);
    existing.weight += next.weight ?? 1;
    existing.refs.push(...(next.refs ?? []));
    return existing;
  }
  const edge: SemanticGraphEdge = {
    ...next,
    refs: next.refs ?? [],
    weight: next.weight ?? 1,
  };
  graph.edges.set(edge.id, edge);
  return edge;
};

const ensureActorNode = (graph: MutableGraph, actor: Actor, ref?: SemanticGraphRef): SemanticGraphNode => ensureNode(graph, {
  id: nodeId(actorNodeKind(actor), `${actor.kind}:${actor.id || actor.name}`),
  kind: actorNodeKind(actor),
  label: actorLabel(actor),
  subtitle: actor.kind === "agent" ? `${actor.scope ?? "public"} agent` : "person",
  status: actor.kind === "agent" ? "graph_inferred" : "manual",
  actor,
  refs: ref ? [{ ...ref, actorId: actor.id }] : [{ actorId: actor.id }],
});

const ensureArtifactNode = (graph: MutableGraph, artifact: Artifact): SemanticGraphNode => ensureNode(graph, {
  id: nodeId("artifact", artifact.id),
  kind: "artifact",
  label: artifact.title,
  subtitle: artifactKindLabel(artifact),
  status: artifact.meta?.providerParse || artifact.meta?.upload ? "source_backed" : "manual",
  refs: [{ artifactId: artifact.id, artifactTitle: artifact.title }],
  weight: artifact.kind === "sheet" ? 3 : 2,
  meta: { artifactKind: artifact.kind, version: artifact.version },
});

const inferFactKind = (column: DataframeColumn, text: string): SemanticGraphNodeKind => {
  if (columnMatches(column, PROJECT_RE)) return "project";
  if (columnMatches(column, ACHIEVEMENT_RE)) return "achievement";
  if (columnMatches(column, FUNDING_RE) || /\$[\d,.]+\s*[kmb]?/i.test(text)) return "funding";
  if (columnMatches(column, EVENT_RE)) return "event";
  if (columnMatches(column, QUESTION_RE)) return "open_question";
  return "evidence_fact";
};

const factEdgeKind = (kind: SemanticGraphNodeKind): SemanticGraphEdgeKind => {
  if (kind === "open_question") return "reviewed";
  if (kind === "source") return "cited";
  return "derived_from";
};

const createSourceNode = (graph: MutableGraph, value: string, ref: SemanticGraphRef, status: SemanticGraphStatus): SemanticGraphNode => ensureNode(graph, {
  id: nodeId("source", value),
  kind: "source",
  label: sourceLabel(value),
  subtitle: value.startsWith("http") ? "web source" : "source",
  status,
  refs: [{ ...ref, sourceUrl: value }],
  weight: 2,
});

const createEvidenceFact = (
  graph: MutableGraph,
  label: string,
  status: SemanticGraphStatus,
  ref: SemanticGraphRef,
): SemanticGraphNode | null => {
  if (graph.factsAdded >= graph.maxEvidenceFacts) return null;
  graph.factsAdded += 1;
  return ensureNode(graph, {
    id: scopedNodeId("evidence_fact", ref.artifactId ?? "room", `${ref.rowId ?? ref.elementId ?? ref.columnId ?? "fact"}:${label}`),
    kind: "evidence_fact",
    label: truncate(label, LABEL_LIMIT),
    subtitle: ref.columnId ? `evidence from ${ref.columnId}` : "evidence fact",
    status,
    refs: [ref],
  });
};

const sheetContext = (artifact: Artifact): SheetContext | null => {
  const columns = [...(artifact.meta?.dataframe?.columns ?? [])].sort((a, b) => a.order - b.order);
  if (columns.length === 0) return null;
  const nameCol = columns.find((column) => columnMatches(column, COMPANY_RE)) ?? columns[0];
  if (!nameCol) return null;
  return {
    artifact,
    columns,
    nameCol,
    personCols: columns.filter((column) => columnMatches(column, PERSON_RE)),
    sourceCols: columns.filter((column) => columnMatches(column, SOURCE_RE)),
    factCols: columns.filter((column) => (
      column !== nameCol &&
      !columnMatches(column, PERSON_RE) &&
      !columnMatches(column, SOURCE_RE) &&
      (columnMatches(column, PROJECT_RE) || columnMatches(column, ACHIEVEMENT_RE) || columnMatches(column, FUNDING_RE) || columnMatches(column, EVENT_RE))
    )),
    questionCols: columns.filter((column) => columnMatches(column, QUESTION_RE)),
  };
};

const cellRef = (artifact: Artifact, rowId: string, column: DataframeColumn): SemanticGraphRef => ({
  artifactId: artifact.id,
  artifactTitle: artifact.title,
  elementId: `${rowId}__${column.id}`,
  rowId,
  columnId: column.id,
  label: column.label,
});

const connectCellActor = (
  graph: MutableGraph,
  element: Element | undefined,
  targetId: string,
  ref: SemanticGraphRef,
  kind: SemanticGraphEdgeKind,
): void => {
  if (!element?.updatedBy) return;
  const actorNode = ensureActorNode(graph, element.updatedBy, ref);
  ensureEdge(graph, {
    id: edgeId(kind, actorNode.id, targetId, ref.elementId),
    source: actorNode.id,
    target: targetId,
    kind,
    label: kind === "researched" ? "researched" : "updated",
    status: element.updatedBy.kind === "agent" ? "graph_inferred" : "manual",
    refs: [ref],
  });
};

const deriveSheet = (graph: MutableGraph, context: SheetContext, maxRows: number): void => {
  const { artifact, columns, nameCol, personCols, sourceCols, factCols, questionCols } = context;
  const artifactNode = ensureArtifactNode(graph, artifact);
  const rows = rowIdsOf(artifact).slice(0, maxRows);
  for (const rowId of rows) {
    const nameElement = artifact.elements[`${rowId}__${nameCol.id}`];
    const name = semanticCellText(nameElement?.value);
    if (!name) continue;

    const rowNode = ensureNode(graph, {
      id: scopedNodeId("spreadsheet_row", artifact.id, rowId),
      kind: "spreadsheet_row",
      label: truncate(`${artifact.title} row ${rowId}`, 52),
      subtitle: name,
      status: payloadStatus(nameElement?.value),
      refs: [{ artifactId: artifact.id, artifactTitle: artifact.title, rowId }],
    });
    const companyNode = ensureNode(graph, {
      id: nodeId("company", name),
      kind: "company",
      label: truncate(name, LABEL_LIMIT),
      subtitle: "company",
      status: payloadStatus(nameElement?.value),
      refs: [cellRef(artifact, rowId, nameCol)],
      weight: 4,
    });

    ensureEdge(graph, {
      id: edgeId("belongs_to", artifactNode.id, rowNode.id, rowId),
      source: artifactNode.id,
      target: rowNode.id,
      kind: "belongs_to",
      label: "contains row",
      status: "manual",
      refs: [{ artifactId: artifact.id, artifactTitle: artifact.title, rowId }],
    });
    ensureEdge(graph, {
      id: edgeId("mentioned_in", rowNode.id, companyNode.id, rowId),
      source: rowNode.id,
      target: companyNode.id,
      kind: "mentioned_in",
      label: "row mentions company",
      status: companyNode.status,
      refs: [cellRef(artifact, rowId, nameCol)],
    });
    connectCellActor(graph, nameElement, companyNode.id, cellRef(artifact, rowId, nameCol), "updated");

    for (const column of personCols) {
      const element = artifact.elements[`${rowId}__${column.id}`];
      const person = semanticCellText(element?.value);
      if (!person) continue;
      const ref = cellRef(artifact, rowId, column);
      const personNode = ensureNode(graph, {
        id: nodeId("person", person),
        kind: "person",
        label: truncate(person, LABEL_LIMIT),
        subtitle: column.label,
        status: payloadStatus(element?.value),
        refs: [ref],
        weight: 3,
      });
      ensureEdge(graph, {
        id: edgeId("researched", personNode.id, companyNode.id, ref.elementId),
        source: personNode.id,
        target: companyNode.id,
        kind: "researched",
        label: "researched",
        status: payloadStatus(element?.value),
        refs: [ref],
      });
      ensureEdge(graph, {
        id: edgeId("mentioned_in", rowNode.id, personNode.id, ref.elementId),
        source: rowNode.id,
        target: personNode.id,
        kind: "mentioned_in",
        label: "row names person",
        status: payloadStatus(element?.value),
        refs: [ref],
      });
    }

    for (const column of [...sourceCols, ...factCols, ...questionCols]) {
      const element = artifact.elements[`${rowId}__${column.id}`];
      const text = semanticCellText(element?.value);
      const evidence = payloadEvidence(element?.value);
      if (!text && evidence.length === 0) continue;

      const ref = cellRef(artifact, rowId, column);
      const status = payloadStatus(element?.value);
      for (const url of extractUrls(text)) {
        const sourceNode = createSourceNode(graph, url, ref, status === "manual" ? "source_backed" : status);
        ensureEdge(graph, {
          id: edgeId("cited", companyNode.id, sourceNode.id, ref.elementId),
          source: companyNode.id,
          target: sourceNode.id,
          kind: "cited",
          label: "cited source",
          status: "source_backed",
          refs: [{ ...ref, sourceUrl: url }],
        });
      }

      if (factCols.includes(column) || questionCols.includes(column)) {
        const kind = inferFactKind(column, text);
        const node = ensureNode(graph, {
          id: scopedNodeId(kind, artifact.id, `${rowId}:${column.id}:${text || column.label}`),
          kind,
          label: truncate(text || column.label, LABEL_LIMIT),
          subtitle: column.label,
          status: kind === "open_question" ? "needs_review" : status,
          refs: [ref],
          weight: kind === "open_question" ? 2 : 3,
        });
        ensureEdge(graph, {
          id: edgeId(factEdgeKind(kind), companyNode.id, node.id, ref.elementId),
          source: companyNode.id,
          target: node.id,
          kind: factEdgeKind(kind),
          label: kind === "open_question" ? "needs review" : "has related fact",
          status: node.status,
          refs: [ref],
        });
        ensureEdge(graph, {
          id: edgeId("derived_from", node.id, rowNode.id, ref.elementId),
          source: node.id,
          target: rowNode.id,
          kind: "derived_from",
          label: "derived from row",
          status: node.status,
          refs: [ref],
        });
      }

      for (const evidenceItem of evidence) {
        const factLabel = evidenceItem.label || `${column.label}: ${text || evidenceItem.snippet || evidenceItem.source || "evidence"}`;
        const factNode = createEvidenceFact(graph, factLabel, evidenceItem.kind === "computed" ? "graph_inferred" : "source_backed", {
          ...ref,
          evidenceId: evidenceItem.id,
          sourceUrl: evidenceItem.url,
        });
        if (!factNode) continue;
        ensureEdge(graph, {
          id: edgeId("supported_by", companyNode.id, factNode.id, evidenceItem.id),
          source: companyNode.id,
          target: factNode.id,
          kind: "supported_by",
          label: "supported by",
          status: factNode.status,
          refs: [{ ...ref, evidenceId: evidenceItem.id }],
        });
        ensureEdge(graph, {
          id: edgeId("cited", rowNode.id, factNode.id, evidenceItem.id),
          source: rowNode.id,
          target: factNode.id,
          kind: "cited",
          label: "row cites",
          status: factNode.status,
          refs: [{ ...ref, evidenceId: evidenceItem.id }],
        });
        const evidenceSource = evidenceItem.url ?? evidenceItem.source ?? evidenceItem.sourceArtifactId;
        if (evidenceSource) {
          const sourceNode = createSourceNode(graph, evidenceSource, { ...ref, evidenceId: evidenceItem.id }, factNode.status);
          ensureEdge(graph, {
            id: edgeId("supported_by", factNode.id, sourceNode.id, evidenceItem.id),
            source: factNode.id,
            target: sourceNode.id,
            kind: "supported_by",
            label: "supported by source",
            status: factNode.status,
            refs: [{ ...ref, evidenceId: evidenceItem.id, sourceUrl: evidenceItem.url ?? evidenceItem.source }],
          });
        }
      }
      connectCellActor(graph, element, rowNode.id, ref, "updated");
    }

    for (const column of columns) {
      const element = artifact.elements[`${rowId}__${column.id}`];
      if (payloadStatus(element?.value) === "needs_review" || payloadStatus(element?.value) === "failed") {
        const ref = cellRef(artifact, rowId, column);
        const question = ensureNode(graph, {
          id: scopedNodeId("open_question", artifact.id, `${rowId}:${column.id}:status`),
          kind: "open_question",
          label: truncate(`${column.label}: ${semanticCellText(element?.value) || "needs review"}`, LABEL_LIMIT),
          subtitle: payloadStatus(element?.value),
          status: payloadStatus(element?.value),
          refs: [ref],
        });
        ensureEdge(graph, {
          id: edgeId("reviewed", companyNode.id, question.id, ref.elementId),
          source: companyNode.id,
          target: question.id,
          kind: "reviewed",
          label: "needs review",
          status: question.status,
          refs: [ref],
        });
      }
    }
  }
};

const existingEntityNodes = (graph: MutableGraph): SemanticGraphNode[] => [...graph.nodes.values()].filter((node) => (
  node.kind === "company" || node.kind === "person" || node.kind === "project" || node.kind === "achievement" || node.kind === "funding" || node.kind === "event"
));

const deriveTextArtifacts = (graph: MutableGraph, artifacts: Artifact[]): void => {
  const mentionable = existingEntityNodes(graph).filter((node) => node.label.length >= 3);
  for (const artifact of artifacts.filter((item) => item.kind !== "sheet")) {
    const artifactNode = ensureArtifactNode(graph, artifact);
    for (const elementId of elementIdsOf(artifact).slice(0, 120)) {
      const element = artifact.elements[elementId];
      if (!element) continue;
      const text = semanticCellText(element.value);
      if (!text) continue;
      const blockNode = ensureNode(graph, {
        id: scopedNodeId("notebook_block", artifact.id, elementId),
        kind: "notebook_block",
        label: truncate(text, LABEL_LIMIT),
        subtitle: artifact.title,
        status: "manual",
        refs: [{ artifactId: artifact.id, artifactTitle: artifact.title, elementId }],
      });
      ensureEdge(graph, {
        id: edgeId("belongs_to", artifactNode.id, blockNode.id, elementId),
        source: artifactNode.id,
        target: blockNode.id,
        kind: "belongs_to",
        label: "contains block",
        status: "manual",
        refs: [{ artifactId: artifact.id, artifactTitle: artifact.title, elementId }],
      });
      connectCellActor(graph, element, blockNode.id, { artifactId: artifact.id, artifactTitle: artifact.title, elementId }, "authored");
      const lower = text.toLowerCase();
      for (const target of mentionable) {
        if (lower.includes(target.label.toLowerCase())) {
          ensureEdge(graph, {
            id: edgeId("mentioned_in", blockNode.id, target.id, elementId),
            source: blockNode.id,
            target: target.id,
            kind: "mentioned_in",
            label: "mentions",
            status: "graph_inferred",
            refs: [{ artifactId: artifact.id, artifactTitle: artifact.title, elementId }],
          });
        }
      }
      for (const url of extractUrls(text)) {
        const sourceNode = createSourceNode(graph, url, { artifactId: artifact.id, artifactTitle: artifact.title, elementId }, "source_backed");
        ensureEdge(graph, {
          id: edgeId("cited", blockNode.id, sourceNode.id, url),
          source: blockNode.id,
          target: sourceNode.id,
          kind: "cited",
          label: "cites source",
          status: "source_backed",
          refs: [{ artifactId: artifact.id, artifactTitle: artifact.title, elementId, sourceUrl: url }],
        });
      }
      if (QUESTION_RE.test(text)) {
        const question = ensureNode(graph, {
          id: scopedNodeId("open_question", artifact.id, `${elementId}:${text}`),
          kind: "open_question",
          label: truncate(text, LABEL_LIMIT),
          subtitle: artifact.title,
          status: "needs_review",
          refs: [{ artifactId: artifact.id, artifactTitle: artifact.title, elementId }],
        });
        ensureEdge(graph, {
          id: edgeId("reviewed", blockNode.id, question.id, elementId),
          source: blockNode.id,
          target: question.id,
          kind: "reviewed",
          label: "raises question",
          status: "needs_review",
          refs: [{ artifactId: artifact.id, artifactTitle: artifact.title, elementId }],
        });
      }
    }
  }
};

const deriveTraces = (graph: MutableGraph, input: SemanticGraphInput): void => {
  const mentionable = existingEntityNodes(graph).filter((node) => node.label.length >= 3);
  for (const trace of input.traces ?? []) {
    const traceNode = ensureNode(graph, {
      id: nodeId("trace_step", trace.id),
      kind: "trace_step",
      label: truncate(trace.summary || trace.type, LABEL_LIMIT),
      subtitle: trace.type,
      status: trace.type.includes("failed") || trace.type.includes("blocked") ? "failed" : trace.actor.kind === "agent" ? "graph_inferred" : "manual",
      refs: [{ traceId: trace.id, artifactId: trace.refs?.artifactId, elementId: trace.refs?.elementId }],
      weight: 2,
    });
    const actor = ensureActorNode(graph, trace.actor, { traceId: trace.id });
    ensureEdge(graph, {
      id: edgeId(trace.actor.kind === "agent" ? "triggered" : "authored", actor.id, traceNode.id, trace.id),
      source: actor.id,
      target: traceNode.id,
      kind: trace.actor.kind === "agent" ? "triggered" : "authored",
      label: trace.actor.kind === "agent" ? "triggered" : "authored",
      status: traceNode.status,
      refs: [{ traceId: trace.id }],
    });
    const artifactId = trace.refs?.artifactId;
    if (artifactId) {
      const artifact = input.artifacts.find((item) => item.id === artifactId);
      const artifactNode = artifact ? ensureArtifactNode(graph, artifact) : ensureNode(graph, {
        id: nodeId("artifact", artifactId),
        kind: "artifact",
        label: artifactId,
        subtitle: "artifact",
        status: "graph_inferred",
        refs: [{ artifactId }],
      });
      ensureEdge(graph, {
        id: edgeId("updated", traceNode.id, artifactNode.id, trace.id),
        source: traceNode.id,
        target: artifactNode.id,
        kind: "updated",
        label: "updated artifact",
        status: traceNode.status,
        refs: [{ traceId: trace.id, artifactId }],
      });
    }
    const text = `${trace.summary} ${trace.detail ?? ""}`.toLowerCase();
    for (const target of mentionable) {
      if (!text.includes(target.label.toLowerCase())) continue;
      ensureEdge(graph, {
        id: edgeId(trace.actor.kind === "agent" ? "researched" : "mentioned_in", traceNode.id, target.id, trace.id),
        source: traceNode.id,
        target: target.id,
        kind: trace.actor.kind === "agent" ? "researched" : "mentioned_in",
        label: trace.actor.kind === "agent" ? "researched" : "mentions",
        status: traceNode.status,
        refs: [{ traceId: trace.id }],
      });
    }
  }
};

const deriveProposals = (graph: MutableGraph, input: SemanticGraphInput): void => {
  for (const proposal of input.proposals ?? []) {
    const artifact = input.artifacts.find((item) => item.id === proposal.artifactId);
    const proposalNode = ensureNode(graph, {
      id: nodeId("proposal", proposal.id),
      kind: "proposal",
      label: truncate(`${proposal.status} ${proposal.op.kind} proposal`, LABEL_LIMIT),
      subtitle: artifact?.title ?? proposal.artifactId,
      status: proposal.status === "pending" ? "needs_review" : proposal.status === "approved" ? "source_backed" : "rejected",
      refs: [{ proposalId: proposal.id, artifactId: proposal.artifactId, elementId: proposal.op.elementId }],
      weight: 2,
    });
    const actor = ensureActorNode(graph, proposal.author, { proposalId: proposal.id });
    const artifactNode = artifact ? ensureArtifactNode(graph, artifact) : ensureNode(graph, {
      id: nodeId("artifact", proposal.artifactId),
      kind: "artifact",
      label: proposal.artifactId,
      subtitle: "artifact",
      status: "graph_inferred",
      refs: [{ artifactId: proposal.artifactId }],
    });
    ensureEdge(graph, {
      id: edgeId("proposed", actor.id, proposalNode.id, proposal.id),
      source: actor.id,
      target: proposalNode.id,
      kind: "proposed",
      label: "proposed",
      status: proposalNode.status,
      refs: [{ proposalId: proposal.id }],
    });
    ensureEdge(graph, {
      id: edgeId("proposed", proposalNode.id, artifactNode.id, proposal.id),
      source: proposalNode.id,
      target: artifactNode.id,
      kind: "proposed",
      label: "changes artifact",
      status: proposalNode.status,
      refs: [{ proposalId: proposal.id, artifactId: proposal.artifactId, elementId: proposal.op.elementId }],
    });
    if (proposal.status !== "pending") {
      ensureEdge(graph, {
        id: edgeId(proposal.status, proposalNode.id, artifactNode.id, `${proposal.id}:resolution`),
        source: proposalNode.id,
        target: artifactNode.id,
        kind: proposal.status,
        label: proposal.status,
        status: proposalNode.status,
        refs: [{ proposalId: proposal.id, artifactId: proposal.artifactId }],
      });
    }
  }
};

const deriveSessions = (graph: MutableGraph, input: SemanticGraphInput): void => {
  for (const session of input.sessions ?? []) {
    const status: SemanticGraphStatus = session.status === "blocked" ? "failed" : session.status === "working" || session.status === "drafting" ? "running" : "graph_inferred";
    ensureNode(graph, {
      id: nodeId("agent_job", `${session.agentId}:${session.id}`),
      kind: "agent_job",
      label: truncate(session.agentName, LABEL_LIMIT),
      subtitle: `${session.scope} ${session.status}`,
      status,
      refs: [{ actorId: session.agentId, label: session.lastAction }],
      weight: session.status === "working" ? 3 : 1,
      meta: { sessionId: session.id, status: session.status },
    });
  }
};

const addCluster = (graph: MutableGraph, id: string, kind: SemanticGraphClusterKind, label: string, nodeIds: string[], edgeIds: string[], status: SemanticGraphStatus): void => {
  const uniqueNodeIds = [...new Set(nodeIds)].filter((nodeIdValue) => graph.nodes.has(nodeIdValue));
  if (uniqueNodeIds.length < 2) return;
  const uniqueEdgeIds = [...new Set(edgeIds)].filter((edgeIdValue) => graph.edges.has(edgeIdValue));
  graph.clusters.set(id, { id, kind, label, nodeIds: uniqueNodeIds, edgeIds: uniqueEdgeIds, status });
  for (const nodeIdValue of uniqueNodeIds) {
    const node = graph.nodes.get(nodeIdValue);
    if (node && !node.clusterIds.includes(id)) node.clusterIds.push(id);
  }
};

const deriveClusters = (graph: MutableGraph): void => {
  const adjacency = new Map<string, { nodeIds: string[]; edgeIds: string[] }>();
  for (const node of graph.nodes.values()) adjacency.set(node.id, { nodeIds: [], edgeIds: [] });
  for (const edge of graph.edges.values()) {
    adjacency.get(edge.source)?.nodeIds.push(edge.target);
    adjacency.get(edge.target)?.nodeIds.push(edge.source);
    adjacency.get(edge.source)?.edgeIds.push(edge.id);
    adjacency.get(edge.target)?.edgeIds.push(edge.id);
  }
  for (const node of graph.nodes.values()) {
    const connected = adjacency.get(node.id);
    if (!connected) continue;
    if (node.kind === "company") {
      addCluster(graph, `cluster:company:${slug(node.label)}`, "company", `${node.label} relationship cluster`, [node.id, ...connected.nodeIds], connected.edgeIds, node.status);
    }
    if (node.kind === "person" || node.kind === "agent_job") {
      addCluster(graph, `cluster:person:${slug(node.label)}`, node.kind === "agent_job" ? "runtime" : "person", `${node.label} work cluster`, [node.id, ...connected.nodeIds], connected.edgeIds, node.status);
    }
  }
  const evidenceNodes = [...graph.nodes.values()].filter((node) => node.kind === "source" || node.kind === "evidence_fact").map((node) => node.id);
  const evidenceEdges = [...graph.edges.values()].filter((edge) => edge.kind === "supported_by" || edge.kind === "cited").map((edge) => edge.id);
  addCluster(graph, "cluster:evidence", "evidence", "Evidence and sources", evidenceNodes, evidenceEdges, "source_backed");
};

const fallbackGraph = (input: SemanticGraphInput): SemanticGraphViewModel => {
  const graph: MutableGraph = { nodes: new Map(), edges: new Map(), clusters: new Map(), factsAdded: 0, maxEvidenceFacts: 3 };
  const room = ensureNode(graph, {
    id: nodeId("artifact", input.roomId),
    kind: "artifact",
    label: "Room graph seed",
    subtitle: "empty room fallback",
    status: "graph_inferred",
    refs: [{ label: "fallback demo" }],
  });
  const question = ensureNode(graph, {
    id: nodeId("open_question", `${input.roomId}:next-source`),
    kind: "open_question",
    label: "Add a sheet, note, source, or trace to build the entity graph",
    status: "needs_review",
    refs: [{ label: "fallback demo" }],
  });
  ensureEdge(graph, {
    id: edgeId("reviewed", room.id, question.id),
    source: room.id,
    target: question.id,
    kind: "reviewed",
    label: "needs data",
    status: "needs_review",
  });
  return finalizeGraph(graph, input, true);
};

const finalizeGraph = (graph: MutableGraph, input: SemanticGraphInput, fallbackDemo: boolean): SemanticGraphViewModel => {
  deriveClusters(graph);
  const nodes = [...graph.nodes.values()].sort((a, b) => a.kind.localeCompare(b.kind) || b.weight - a.weight || a.label.localeCompare(b.label));
  const edges = [...graph.edges.values()].sort((a, b) => a.kind.localeCompare(b.kind) || b.weight - a.weight || a.label.localeCompare(b.label));
  const clusters = [...graph.clusters.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label));
  const stats = {
    nodes: nodes.length,
    edges: edges.length,
    backedFacts: nodes.filter((node) => node.kind === "evidence_fact" && node.status === "source_backed").length,
    openQuestions: nodes.filter((node) => node.kind === "open_question").length,
    people: nodes.filter((node) => node.kind === "person").length,
    companies: nodes.filter((node) => node.kind === "company").length,
    traces: nodes.filter((node) => node.kind === "trace_step").length,
    proposals: nodes.filter((node) => node.kind === "proposal").length,
    sources: nodes.filter((node) => node.kind === "source").length,
  };
  return {
    nodes,
    edges,
    clusters,
    stats,
    generatedFrom: {
      artifacts: input.artifacts.length,
      traces: input.traces?.length ?? 0,
      proposals: input.proposals?.length ?? 0,
      sessions: input.sessions?.length ?? 0,
      members: input.members?.length ?? 0,
      fallbackDemo,
    },
  };
};

export function buildSemanticGraph(input: SemanticGraphInput): SemanticGraphViewModel {
  if (input.artifacts.length === 0 && input.fallbackDemo) return fallbackGraph(input);
  const graph: MutableGraph = {
    nodes: new Map(),
    edges: new Map(),
    clusters: new Map(),
    factsAdded: 0,
    maxEvidenceFacts: input.maxEvidenceFacts ?? DEFAULT_MAX_EVIDENCE_FACTS,
  };

  for (const member of input.members ?? []) {
    ensureNode(graph, {
      id: nodeId("person", `member:${member.id}`),
      kind: "person",
      label: member.name,
      subtitle: member.role,
      status: "manual",
      refs: [{ actorId: member.id }],
      meta: { color: member.color, anon: member.anon },
    });
  }

  for (const artifact of input.artifacts) {
    const artifactNode = ensureArtifactNode(graph, artifact);
    if (artifact.createdBy) {
      const actor = ensureActorNode(graph, artifact.createdBy, { artifactId: artifact.id, artifactTitle: artifact.title });
      ensureEdge(graph, {
        id: edgeId("authored", actor.id, artifactNode.id, artifact.id),
        source: actor.id,
        target: artifactNode.id,
        kind: "authored",
        label: "authored",
        status: artifact.createdBy.kind === "agent" ? "graph_inferred" : "manual",
        refs: [{ artifactId: artifact.id, artifactTitle: artifact.title }],
      });
    }
  }

  for (const artifact of input.artifacts) {
    if (artifact.kind !== "sheet") continue;
    const context = sheetContext(artifact);
    if (context) deriveSheet(graph, context, input.maxRowsPerSheet ?? DEFAULT_MAX_ROWS_PER_SHEET);
  }

  deriveTextArtifacts(graph, input.artifacts);
  deriveTraces(graph, input);
  deriveProposals(graph, input);
  deriveSessions(graph, input);

  return finalizeGraph(graph, input, false);
}

export type { SemanticGraphInput, SemanticGraphViewModel };
