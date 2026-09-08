import { render, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import type { VisualArtifactKind } from "@nodebook/contracts";

import { NodeRoomNodeBookArtifactPanel } from "../src/notebook/NodeBookArtifactPanel";

const infographic = JSON.stringify({
  schemaVersion: "nodekit.infographic/v1",
  canvas: { width: 640, columns: 1 },
  theme: { background: "#f8fafc", surface: "#ffffff", text: "#0f172a", muted: "#64748b", accent: "#2563eb" },
  title: "Room knowledge synthesis",
  sections: [{ id: "metric", type: "metric", title: "Shared facts", value: 12, items: [], sourceBindingIds: ["room-node-1"] }],
});

const visualMatrix: ReadonlyArray<{ kind: VisualArtifactKind; format: string; payload: string }> = [
  { kind: "mermaid", format: "mermaid", payload: "flowchart LR\n  source[Shared nodes] --> review[Review]" },
  { kind: "chart", format: "vega-lite-json", payload: JSON.stringify({ data: { values: [{ label: "Evidence", value: 8 }, { label: "Risk", value: 3 }] }, mark: "bar", encoding: { x: { field: "label", type: "nominal" }, y: { field: "value", type: "quantitative" } } }) },
  { kind: "mindmap", format: "structured-json", payload: JSON.stringify({ schemaVersion: "nodekit.diagram/v1", diagramType: "mindmap", title: "Decision map", nodes: [{ id: "decision", label: "Decision" }, { id: "evidence", label: "Evidence", parentId: "decision" }], edges: [{ id: "decision-evidence", from: "decision", to: "evidence" }], groups: [], layout: { direction: "LR", seed: "noderoom-proof" } }) },
  { kind: "flow", format: "structured-json", payload: JSON.stringify({ schemaVersion: "nodekit.diagram/v1", diagramType: "flow", title: "Review flow", nodes: [{ id: "draft", label: "Draft" }, { id: "review", label: "Review" }], edges: [{ id: "draft-review", from: "draft", to: "review" }], groups: [], layout: { direction: "LR", seed: "noderoom-proof" } }) },
  { kind: "drawio", format: "drawio-xml", payload: '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="input" value="Input" vertex="1" parent="1"><mxGeometry x="20" y="30" width="120" height="50" as="geometry"/></mxCell><mxCell id="output" value="Output" vertex="1" parent="1"><mxGeometry x="220" y="30" width="120" height="50" as="geometry"/></mxCell><mxCell id="edge" edge="1" source="input" target="output" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>' },
  { kind: "infographic", format: "infographic-json", payload: infographic },
];

beforeAll(() => {
  // Browsers provide Canvas text metrics; NodeRoom's JSDOM does not. Vega uses
  // this browser API while producing SVG even though it does not paint pixels.
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ measureText: (value: string) => ({ width: value.length * 7 }) }),
  });
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", {
    configurable: true,
    value() { return (this.textContent?.length ?? 0) * 7; },
  });
  Object.defineProperty(SVGElement.prototype, "getBBox", {
    configurable: true,
    value() { return { x: 0, y: 0, width: (this.textContent?.length ?? 0) * 7, height: 16 }; },
  });
});

describe("NodeRoom consumes the packed NodeBook artifact runtime", () => {
  it.each(visualMatrix)("renders the package-owned $kind artifact inside one shared room boundary", async ({ kind, format, payload }) => {
    const view = render(<NodeRoomNodeBookArtifactPanel roomId="room-six-format-proof" artifactId={`artifact-${kind}`} kind={kind} format={format} payload={payload} title={`${kind} proof`} version={1} />);

    await waitFor(() => expect(view.container.querySelector(`[data-nodebook-artifact-kind="${kind}"] [data-nodebook-artifact-rendered] svg`)).not.toBeNull(), { timeout: 15_000 });
    expect(view.container.querySelector('[data-nodebook-host="noderoom"]')?.getAttribute("data-nodebook-workspace-id")).toBe("room-six-format-proof");
    expect(view.container.querySelector("[role=alert]")).toBeNull();
  }, 60_000);

  it("renders a room-scoped infographic without giving NodeBook ownership of room identity", async () => {
    const view = render(<NodeRoomNodeBookArtifactPanel roomId="room-proof-1" artifactId="artifact-proof-1" kind="infographic" format="infographic-json" payload={infographic} title="Room knowledge synthesis" version={1} />);

    expect(view.container.querySelector('[data-nodebook-host="noderoom"]')?.getAttribute("data-nodebook-workspace-id")).toBe("room-proof-1");
    await waitFor(() => expect(view.container.querySelector("[data-nodebook-artifact-rendered] svg")?.getAttribute("aria-label")).toBe("Room knowledge synthesis"));
  });

  it("shows an honest error for hostile infographic content instead of falling back to text", async () => {
    const hostile = infographic.replace('"Shared facts"', '"https://attacker.example"');
    const view = render(<NodeRoomNodeBookArtifactPanel roomId="room-proof-1" artifactId="artifact-hostile" kind="infographic" format="infographic-json" payload={hostile} title="Hostile" version={1} />);

    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("UNSAFE_ARTIFACT"));
    expect(view.container.querySelector("[data-nodebook-artifact-rendered]")).toBeNull();
  });

  it("keeps two packed Draw.io instances independent for a split-room analyst", async () => {
    const drawio = visualMatrix.find((artifact) => artifact.kind === "drawio")!;
    const view = render(<>
      <NodeRoomNodeBookArtifactPanel roomId="room-split-proof" artifactId="drawio-primary" kind="drawio" format={drawio.format} payload={drawio.payload} title="Primary architecture" version={7} />
      <NodeRoomNodeBookArtifactPanel roomId="room-split-proof" artifactId="drawio-reference" kind="drawio" format={drawio.format} payload={drawio.payload} title="Reference architecture" version={3} />
    </>);

    await waitFor(() => expect(view.container.querySelectorAll("[data-nodebook-artifact-rendered] svg")).toHaveLength(2), { timeout: 15_000 });
    const markerIds = [...view.container.querySelectorAll("marker")].map((marker) => marker.id);
    expect(markerIds).toEqual(["nodebook-drawio-primary-7-drawio-arrow", "nodebook-drawio-reference-3-drawio-arrow"]);
    expect(new Set(markerIds).size).toBe(2);
    const references = [...view.container.querySelectorAll("line")].map((line) => line.getAttribute("marker-end"));
    expect(references).toEqual(markerIds.map((id) => `url(#${id})`));
  }, 30_000);
});
