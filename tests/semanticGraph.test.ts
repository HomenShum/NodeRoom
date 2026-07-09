import { describe, expect, it } from "vitest";
import type { Actor, Artifact, DataframeColumn, Element, Proposal, TraceEvent } from "../src/engine/types";
import { buildSemanticGraph } from "../src/ui/graph/semanticGraph";
import { applySemanticGraphFilters } from "../src/ui/graph/semanticGraphFilters";
import { layoutSemanticGraph } from "../src/ui/graph/semanticGraphLayout";
import { selectSemanticNeighborhood } from "../src/ui/graph/semanticGraphSelectors";

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
