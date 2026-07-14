import { describe, expect, it } from "vitest";
import {
  InMemoryNodeGraphAdapter,
  buildNeo4jSyncPlan,
  exportNodeGraphDocument,
  nodeGraphDocumentJson,
  parseNodeGraphDocument,
  type SemanticGraphViewModel,
} from "nodegraph";

const graph: SemanticGraphViewModel = {
  nodes: [
    { id: "person:priya", kind: "person", label: "Priya", status: "manual", refs: [{ actorId: "priya" }], clusterIds: ["person:priya"], weight: 5 },
    { id: "company:cardionova", kind: "company", label: "CardioNova", status: "source_backed", refs: [{ artifactId: "research", elementId: "r1__company" }], clusterIds: ["company:cardionova"], weight: 8 },
  ],
  edges: [{ id: "researched:priya:cardionova", source: "person:priya", target: "company:cardionova", kind: "researched", label: "researched", status: "source_backed", refs: [{ traceId: "trace-1" }], weight: 7 }],
  clusters: [{ id: "company:cardionova", kind: "company", label: "CardioNova", nodeIds: ["company:cardionova", "person:priya"], edgeIds: ["researched:priya:cardionova"], status: "source_backed" }],
  stats: { nodes: 2, edges: 1, backedFacts: 1, openQuestions: 0, people: 1, companies: 1, traces: 1, proposals: 0, sources: 0 },
  generatedFrom: { artifacts: 1, traces: 1, proposals: 0, sessions: 0, members: 1, fallbackDemo: false },
};

describe("NodeGraph public package integration", () => {
  it("round-trips the NodeRoom graph contract and builds an incremental Neo4j plan", () => {
    const document = exportNodeGraphDocument(graph, {
      graphId: "room-1",
      generatedAt: 100,
      provenance: { source: "noderoom", sourceId: "room-1" },
      layout: { positions: { "company:cardionova": { x: 40, y: 20 } }, pinnedNodeIds: ["company:cardionova"] },
    });
    const parsed = parseNodeGraphDocument(nodeGraphDocumentJson(document));
    expect(parsed).toMatchObject({ schema: "nodegraph.document", version: 1, graphId: "room-1" });
    expect(parsed.layout?.pinnedNodeIds).toEqual(["company:cardionova"]);

    const memory = new InMemoryNodeGraphAdapter();
    const receipt = memory.importDocument(parsed);
    expect(receipt.delta.upsertNodes).toHaveLength(2);
    expect(receipt.delta.upsertEdges).toHaveLength(1);

    const neo4j = buildNeo4jSyncPlan(parsed);
    expect(neo4j.adapterVersion).toBe(2);
    expect(neo4j.batches.some((batch) => batch.purpose === "metadata")).toBe(true);
    expect(neo4j.batches.every((batch) => !batch.statement.includes("apoc."))).toBe(true);
  });
});
