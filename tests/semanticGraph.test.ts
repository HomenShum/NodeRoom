import { describe, expect, it } from "vitest";
import type { Actor, Artifact, DataframeColumn, Element, Proposal, TraceEvent } from "../src/engine/types";
import { buildSemanticGraph } from "../src/ui/graph/semanticGraph";
import { applySemanticGraphFilters } from "../src/ui/graph/semanticGraphFilters";
import { selectSemanticGraphCluster, summarizeSemanticGraphClusters } from "../src/ui/graph/semanticGraphClusters";
import { layoutSemanticGraph, semanticGraphNodeSize } from "../src/ui/graph/semanticGraphLayout";
import { rankSemanticConnectionPaths } from "../src/ui/graph/semanticGraphPaths";
import { selectSemanticNeighborhood } from "../src/ui/graph/semanticGraphSelectors";
import { buildDeckStoryboardFromRoom } from "../src/ui/workArtifacts/deckStoryboard";

const human: Actor = { kind: "user", id: "u-priya", name: "Priya" };
const agent: Actor = { kind: "agent", id: "room-agent", name: "Room NodeAgent", scope: "public" };

const columns: DataframeColumn[] = [
  { id: "company", label: "Company", order: 0 },
  { id: "owner", label: "Owner", order: 1 },
  { id: "website", label: "Website", order: 2 },
  { id: "funding", label: "Funding", order: 3 },
  { id: "risk", label: "Review risk", order: 4 },
];

const cell = (id: string, value: unknown, updatedBy: Actor = human): Element => ({
  id,
  value,
  updatedBy,
  version: 1,
  updatedAt: 1,
});

const researchSheet: Artifact = {
  id: "art-research",
  roomId: "room-1",
  kind: "sheet",
  title: "Company research",
  version: 2,
  createdBy: human,
  updatedAt: 2,
  order: [
    "r1__company",
    "r1__owner",
    "r1__website",
    "r1__funding",
    "r1__risk",
  ],
  elements: {
    "r1__company": cell("r1__company", "CardioNova"),
    "r1__owner": cell("r1__owner", "Priya"),
    "r1__website": cell("r1__website", "https://cardionova.example/source"),
    "r1__funding": cell("r1__funding", {
      value: "$14M Series A",
      status: "complete",
      evidence: [{
        id: "ev-funding",
        kind: "source",
        label: "Series A source",
        url: "https://pitchbook.example/cardionova",
        snippet: "CardioNova raised a $14M Series A.",
      }],
    }, agent),
    "r1__risk": cell("r1__risk", { value: "Needs HIPAA evidence review", status: "needs_review" }, agent),
  },
  meta: { dataframe: { columns, rowCount: 1 } },
};

const notebook: Artifact = {
  id: "art-note",
  roomId: "room-1",
  kind: "note",
  title: "Capture Notebook",
  version: 1,
  createdBy: human,
  updatedAt: 3,
  order: ["b1"],
  elements: {
    b1: cell("b1", { text: "Priya researched CardioNova and found the PitchBook source." }),
  },
};

const richNotebook: Artifact = {
  id: "art-rich-note",
  roomId: "room-1",
  kind: "note",
  title: "Diligence notebook",
  version: 2,
  createdBy: human,
  updatedAt: 7,
  order: ["doc"],
  elements: {
    doc: cell("doc", `
      <h1 data-blockid="nb-title">CardioNova diligence notebook</h1>
      <p data-blockid="nb-human">Priya researched CardioNova and summarized the board memo.</p>
      <p data-blockid="nb-agent" data-author-kind="agent" data-status="needs_review">
        Runway claim needs transcript source <a href="https://runway.example/cardionova">runway source</a>.
      </p>
    `),
  },
};

const trace: TraceEvent = {
  id: "trace-1",
  roomId: "room-1",
  ts: 4,
  actor: agent,
  type: "agent_status",
  summary: "Researched CardioNova funding and reconciled source evidence",
  refs: { artifactId: "art-research", elementId: "r1__funding" },
};

const proposal: Proposal = {
  id: "proposal-1",
  roomId: "room-1",
  artifactId: "art-research",
  op: { opId: "op-1", artifactId: "art-research", elementId: "r1__risk", kind: "set", value: "HIPAA source added", baseVersion: 1 },
  author: agent,
  status: "pending",
  createdAt: 5,
};

function largeResearchSheet(rowCount: number): Artifact {
  const order: string[] = [];
  const elements: Record<string, Element> = {};
  for (let index = 1; index <= rowCount; index += 1) {
    const row = `r${index}`;
    for (const column of columns) order.push(`${row}__${column.id}`);
    elements[`${row}__company`] = cell(`${row}__company`, `Company ${index}`);
    elements[`${row}__owner`] = cell(`${row}__owner`, index % 2 === 0 ? "Priya" : "Homen");
    elements[`${row}__website`] = cell(`${row}__website`, `https://company-${index}.example/source`);
    elements[`${row}__funding`] = cell(`${row}__funding`, {
      value: `$${10 + index}M Series A`,
      status: "complete",
      evidence: [{
        id: `ev-${index}`,
        kind: "source",
        label: `Funding source ${index}`,
        url: `https://source-${index}.example/company`,
      }],
    }, agent);
    elements[`${row}__risk`] = cell(`${row}__risk`, index % 5 === 0 ? { value: "Needs review", status: "needs_review" } : "clear");
  }
  return {
    ...researchSheet,
    id: "art-large-research",
    title: "Large company research",
    order,
    elements,
    meta: { dataframe: { columns, rowCount } },
  };
}

describe("semantic entity graph", () => {
  it("derives companies, people, rows, evidence, sources, traces, proposals, and open questions from real room data", () => {
    const graph = buildSemanticGraph({
      roomId: "room-1",
      artifacts: [researchSheet, notebook],
      traces: [trace],
      proposals: [proposal],
      members: [{ id: "u-priya", roomId: "room-1", name: "Priya", role: "member", anon: false, color: "#4f7cff", lastSeenAt: 6 }],
    });

    expect(graph.generatedFrom.fallbackDemo).toBe(false);
    expect(graph.nodes.some((node) => node.kind === "company" && node.label === "CardioNova")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "person" && node.label === "Priya")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "spreadsheet_row" && node.subtitle === "CardioNova")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "evidence_fact" && node.label === "Series A source")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "source" && node.label === "pitchbook.example")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "trace_step" && node.label.includes("Researched CardioNova"))).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "proposal" && node.status === "needs_review")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "open_question" && node.status === "needs_review")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "researched" && edge.label === "researched")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "supported_by" && edge.label === "supported by source")).toBe(true);
  });

  it("selects a person neighborhood that includes researched companies and evidence context", () => {
    const graph = buildSemanticGraph({ roomId: "room-1", artifacts: [researchSheet, notebook], traces: [trace], proposals: [proposal] });
    const person = graph.nodes.find((node) => node.kind === "person" && node.label === "Priya");
    expect(person).toBeTruthy();

    const selection = selectSemanticNeighborhood(graph, person!.id, 2);
    const selectedLabels = [...selection.nodeIds].map((id) => graph.nodes.find((node) => node.id === id)?.label);
    expect(selectedLabels).toContain("CardioNova");
    expect(selection.sections.some((section) => section.id === "researched-companies")).toBe(true);
    expect(selection.sections.some((section) => section.id === "rows-blocks")).toBe(true);
    expect(selection.paths?.some((path) => path.label.includes("Priya") && path.label.includes("CardioNova"))).toBe(true);
  });

  it("ranks relevant person-to-company evidence paths for graph highlighting", () => {
    const graph = buildSemanticGraph({ roomId: "room-1", artifacts: [researchSheet, notebook], traces: [trace], proposals: [proposal] });
    const person = graph.nodes.find((node) => node.kind === "person" && node.label === "Priya");
    expect(person).toBeTruthy();

    const paths = rankSemanticConnectionPaths(graph, person!.id, { maxHops: 3, maxPaths: 8 });

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((path) => path.label.includes("Priya") && path.label.includes("researched") && path.label.includes("CardioNova"))).toBe(true);
    expect(paths.some((path) => path.label.includes("Series A source") || path.label.includes("pitchbook.example"))).toBe(true);
    expect(paths[0].score).toBeGreaterThanOrEqual(paths[paths.length - 1].score);
  });

  it("derives graph nodes from structured notebook blocks and citations", () => {
    const graph = buildSemanticGraph({ roomId: "room-1", artifacts: [researchSheet, richNotebook], traces: [trace] });

    expect(graph.nodes.some((node) => node.kind === "notebook_block" && node.label.includes("CardioNova diligence notebook"))).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "notebook_block" && node.label.includes("Runway claim needs transcript source"))).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "source" && node.label === "runway.example")).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "open_question" && node.label.includes("Runway claim"))).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "mentioned_in" && edge.label === "mentions")).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "cited" && edge.label === "cites source")).toBe(true);
  });

  it("links storyboard deck claims back to source artifacts, notebook blocks, proposals, traces, and evidence", () => {
    const storyboard = buildDeckStoryboardFromRoom({
      roomId: "room-1",
      roomTitle: "Startup diligence",
      artifacts: [researchSheet, richNotebook],
      traces: [trace],
      proposals: [proposal],
    });
    const graph = buildSemanticGraph({
      roomId: "room-1",
      artifacts: [researchSheet, richNotebook],
      traces: [trace],
      proposals: [proposal],
      decks: [storyboard],
    });

    const deck = graph.nodes.find((node) => node.kind === "deck" && node.label === "Startup diligence readout");
    const noteSlide = graph.nodes.find((node) => node.kind === "deck_slide" && node.label === "Diligence notebook");
    const verifiedClaim = graph.nodes.find((node) => node.kind === "deck_claim" && node.refs.some((ref) => ref.evidenceId === "ev-funding"));
    const reviewClaim = graph.nodes.find((node) => node.kind === "deck_claim" && node.refs.some((ref) => ref.proposalId === "proposal-1") && node.status === "needs_review");

    expect(deck).toBeTruthy();
    expect(noteSlide).toBeTruthy();
    expect(verifiedClaim).toBeTruthy();
    expect(reviewClaim).toBeTruthy();
    expect(graph.edges.some((edge) => edge.kind === "belongs_to" && edge.label === "contains slide" && edge.source === deck!.id)).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "derived_from" && edge.label === "draws from artifact" && edge.refs.some((ref) => ref.artifactId === "art-rich-note"))).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "supported_by" && edge.label === "supported by evidence" && edge.source === verifiedClaim!.id)).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "reviewed" && edge.label === "needs proposal review" && edge.source === reviewClaim!.id)).toBe(true);
    expect(graph.edges.some((edge) => edge.kind === "derived_from" && edge.label === "derived from trace" && edge.source === reviewClaim!.id)).toBe(true);

    const notePaths = rankSemanticConnectionPaths(graph, noteSlide!.id, { maxHops: 4, maxPaths: 16 });
    const reviewPaths = rankSemanticConnectionPaths(graph, reviewClaim!.id, { maxHops: 4, maxPaths: 16 });

    expect(notePaths.some((path) => path.label.includes("contains block") && path.label.includes("CardioNova diligence notebook"))).toBe(true);
    expect(reviewPaths.some((path) => path.label.includes("needs proposal review") && path.label.includes("pending set proposal"))).toBe(true);
  });

  it("filters to source-backed evidence without static mock nodes", () => {
    const graph = buildSemanticGraph({ roomId: "room-1", artifacts: [researchSheet, notebook], fallbackDemo: true });
    const filtered = applySemanticGraphFilters(graph, { evidenceBackedOnly: true });

    expect(graph.generatedFrom.fallbackDemo).toBe(false);
    expect(filtered.nodes.length).toBeGreaterThan(0);
    expect(filtered.nodes.every((node) => node.status === "source_backed" || node.kind === "source" || node.kind === "evidence_fact")).toBe(true);
    expect(filtered.nodes.some((node) => node.label === "Room graph seed")).toBe(false);
  });

  it("uses fallback only for an empty room when explicitly requested", () => {
    const graph = buildSemanticGraph({ roomId: "room-empty", artifacts: [], fallbackDemo: true });
    expect(graph.generatedFrom.fallbackDemo).toBe(true);
    expect(graph.nodes.some((node) => node.kind === "open_question")).toBe(true);
  });

  it("lays out selected semantic nodes deterministically", () => {
    const graph = buildSemanticGraph({ roomId: "room-1", artifacts: [researchSheet, notebook], traces: [trace], proposals: [proposal] });
    const company = graph.nodes.find((node) => node.kind === "company" && node.label === "CardioNova");
    expect(company).toBeTruthy();

    const first = layoutSemanticGraph(graph, { selectedId: company!.id });
    const second = layoutSemanticGraph(graph, { selectedId: company!.id });
    expect(first.get(company!.id)).toEqual({ x: 0, y: 0 });
    expect([...first.entries()]).toEqual([...second.entries()]);

    const positioned = graph.nodes.filter((node) => first.has(node.id));
    for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < positioned.length; rightIndex += 1) {
        const left = positioned[leftIndex];
        const right = positioned[rightIndex];
        const leftPosition = first.get(left.id)!;
        const rightPosition = first.get(right.id)!;
        const leftSize = semanticGraphNodeSize(left.label);
        const rightSize = semanticGraphNodeSize(right.label);
        const overlaps = Math.abs((leftPosition.x + leftSize.width / 2) - (rightPosition.x + rightSize.width / 2)) < (leftSize.width + rightSize.width) / 2
          && Math.abs((leftPosition.y + leftSize.height / 2) - (rightPosition.y + rightSize.height / 2)) < (leftSize.height + rightSize.height) / 2;
        expect(overlaps, `${left.label} must not overlap ${right.label}`).toBe(false);
      }
    }
  });

  it("ranks clusters and isolates them with bounded neighbor expansion", () => {
    const graph = buildSemanticGraph({ roomId: "room-1", artifacts: [researchSheet, richNotebook], traces: [trace], proposals: [proposal] });
    const summaries = summarizeSemanticGraphClusters(graph);
    const companyCluster = summaries.find((cluster) => cluster.kind === "company" && cluster.label.includes("CardioNova"));
    expect(companyCluster).toBeTruthy();
    expect(companyCluster!.nodeCount).toBeGreaterThan(1);
    expect(companyCluster!.relevanceScore).toBeGreaterThan(0);

    const isolated = selectSemanticGraphCluster(graph, companyCluster!.id, { neighborDepth: 0 });
    const expanded = selectSemanticGraphCluster(graph, companyCluster!.id, { neighborDepth: 1, maxNodes: 40 });
    expect(isolated.nodes.length).toBe(companyCluster!.nodeCount);
    expect(isolated.edges.every((edge) => isolated.nodes.some((node) => node.id === edge.source) && isolated.nodes.some((node) => node.id === edge.target))).toBe(true);
    expect(expanded.nodes.length).toBeGreaterThanOrEqual(isolated.nodes.length);
    expect(expanded.nodes.length).toBeLessThanOrEqual(40);
    expect(expanded.clusters.some((cluster) => cluster.id === companyCluster!.id)).toBe(true);
  });

  it("keeps a 250-plus-node fixture derivable, filterable, and layoutable", () => {
    const graph = buildSemanticGraph({
      roomId: "room-scale",
      artifacts: [largeResearchSheet(90)],
      maxRowsPerSheet: 120,
      maxEvidenceFacts: 360,
    });
    expect(graph.nodes.length).toBeGreaterThanOrEqual(250);
    const layout = layoutSemanticGraph(graph);
    expect(layout.size).toBe(graph.nodes.length);
    const filtered = applySemanticGraphFilters(graph, { query: "Company 42" });
    expect(filtered.nodes.some((node) => node.label === "Company 42")).toBe(true);
  });
});
