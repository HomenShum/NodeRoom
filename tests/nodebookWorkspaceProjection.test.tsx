// @vitest-environment jsdom
import { createNodeBookSurfaceModel } from "@nodebook/model";
import { loadArtifactPlugin } from "@nodebook/react";
import { sha256Text } from "@nodebook/core/mermaid";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Artifact } from "../src/engine/types";
import { NODEBOOK_VISUAL_ELEMENT_ID, NODEBOOK_VISUAL_SCHEMA_VERSION } from "../src/notebook/visualArtifactEnvelope";
import { NodeRoomNodeBookWorkspaceSurfaceFromArtifacts, projectRoomArtifactsToNodeBook, updateRoomArtifactProjectionCache } from "../src/notebook/NodeBookWorkspaceSurface";

afterEach(cleanup);
beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, "getComputedTextLength", { configurable: true, value() { return (this.textContent?.length ?? 0) * 7; } });
  Object.defineProperty(SVGElement.prototype, "getBBox", { configurable: true, value() { return { x: 0, y: 0, width: (this.textContent?.length ?? 0) * 7, height: 16 }; } });
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value() { return { measureText: (value: string) => ({ width: value.length * 7 }) }; } });
});

type VisualKind = "mindmap" | "flow" | "chart" | "drawio" | "mermaid" | "infographic";

function artifact(id: string, kind?: VisualKind, roomId = "room-a"): Artifact {
  const formats = { mindmap: "structured-json", flow: "structured-json", chart: "vega-lite-json", drawio: "drawio-xml", mermaid: "mermaid", infographic: "infographic-json" } as const;
  return {
    id, roomId, kind: "note", title: id, version: 2, order: [], updatedAt: 1, visibility: "room", elements: kind ? {
      [NODEBOOK_VISUAL_ELEMENT_ID]: { id: NODEBOOK_VISUAL_ELEMENT_ID, version: 2, updatedAt: 1, updatedBy: { id: "human", name: "Human", kind: "user" }, value: { schemaVersion: NODEBOOK_VISUAL_SCHEMA_VERSION, kind, format: formats[kind], payload: kind === "mermaid" ? "flowchart LR\nA-->B" : "{}", contentHash: "a".repeat(64) } },
    } : {},
  };
}

describe("NodeRoom full NodeBook workspace projection", () => {
  it("keeps the room scope and exposes text plus visual nodes through the shared model", () => {
    const visuals = (["mindmap", "flow", "chart", "drawio", "mermaid", "infographic"] as const).map((kind) => artifact(kind, kind));
    const snapshot = projectRoomArtifactsToNodeBook("room-a", [artifact("plain"), ...visuals]);
    const model = createNodeBookSurfaceModel(snapshot);
    expect(model.snapshot.nodes).toHaveLength(8);
    expect(model.snapshot.artifacts.map((entry) => entry.kind).sort()).toEqual(["chart", "drawio", "flow", "infographic", "mermaid", "mindmap"]);
    expect(model.childrenOf("room:room-a")).toHaveLength(7);
    expect(model.snapshot.nodes.every((entry) => entry.accessMode === "read")).toBe(true);
  });

  it("fails closed instead of relabeling an artifact from another room", () => {
    expect(() => projectRoomArtifactsToNodeBook("room-a", [artifact("foreign", "chart", "room-b")])).toThrow("ROOM_SCOPE_MISMATCH:foreign");
  });

  it("reuses a semantic projection when the store returns a fresh but unchanged artifact array", () => {
    const artifacts = [artifact("plain")];
    const first = updateRoomArtifactProjectionCache(undefined, "room-a", artifacts);
    const second = updateRoomArtifactProjectionCache(first, "room-a", [...artifacts]);
    const changed = updateRoomArtifactProjectionCache(second, "room-a", [{ ...artifacts[0]!, title: "Changed", version: 3 }]);
    expect(second).toBe(first);
    expect(changed).not.toBe(second);
  });

  it("contains a malformed host projection as an honest alert instead of crashing the room inspector", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = render(<NodeRoomNodeBookWorkspaceSurfaceFromArtifacts roomId="room-a" artifacts={[artifact("foreign", "chart", "room-b")]} onOpenArtifact={() => undefined} />);
    expect(view.getByRole("alert").textContent).toContain("ROOM_SCOPE_MISMATCH:foreign");
    expect(view.container.querySelector("[data-nodebook-host-error]")).toBeTruthy();
    consoleError.mockRestore();
  });

  it("renders all six shared visual kinds in the real NodeRoom workspace mount", async () => {
    const sources = [
      ["mindmap", "structured-json", JSON.stringify({ schemaVersion: "nodekit.diagram/v1", diagramType: "mindmap", nodes: [{ id: "root", label: "Decision" }, { id: "proof", label: "Proof", parentId: "root" }], edges: [{ id: "edge", from: "root", to: "proof" }], groups: [], layout: { direction: "LR", seed: "proof" } })],
      ["flow", "structured-json", JSON.stringify({ schemaVersion: "nodekit.diagram/v1", diagramType: "flow", nodes: [{ id: "draft", label: "Draft" }, { id: "review", label: "Review" }], edges: [{ id: "edge", from: "draft", to: "review" }], groups: [], layout: { direction: "LR", seed: "proof" } })],
      ["chart", "vega-lite-json", JSON.stringify({ data: { values: [{ label: "Proof", value: 8 }] }, mark: "bar", encoding: { x: { field: "label", type: "nominal" }, y: { field: "value", type: "quantitative" } } })],
      ["drawio", "drawio-xml", '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Evidence" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="50"/></mxCell></root></mxGraphModel>'],
      ["mermaid", "mermaid", "flowchart LR\nEvidence-->Decision"],
      ["infographic", "infographic-json", JSON.stringify({ schemaVersion: "nodekit.infographic/v1", canvas: { width: 960, columns: 2 }, theme: { background: "#f8fafc", surface: "#ffffff", text: "#0f172a", muted: "#64748b", accent: "#2563eb" }, title: "Evidence brief", sections: [{ id: "metric", type: "metric", title: "Reviewed", value: 42 }] })],
    ] as const;
    const artifacts: Artifact[] = [];
    for (const [kind, format, payload] of sources) {
      const canonical = await (await loadArtifactPlugin(kind)).validatePayload(payload);
      const item = artifact(`visual-${kind}`, kind);
      item.elements[NODEBOOK_VISUAL_ELEMENT_ID]!.value = { schemaVersion: NODEBOOK_VISUAL_SCHEMA_VERSION, kind, format, payload, contentHash: await sha256Text(canonical) };
      artifacts.push(item);
    }
    const view = render(<NodeRoomNodeBookWorkspaceSurfaceFromArtifacts roomId="room-a" artifacts={artifacts} onOpenArtifact={() => undefined} />);
    for (const [kind] of sources) {
      view.container.querySelector<HTMLButtonElement>(`[data-nodebook-node-id="visual-${kind}"]`)!.click();
      await vi.waitFor(() => expect(view.container.querySelector(`[data-nodebook-artifact-kind="${kind}"] [data-nodebook-artifact-rendered] svg`)).toBeTruthy(), { timeout: 15_000 });
    }
  }, 60_000);
});
