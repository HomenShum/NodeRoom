// @vitest-environment jsdom
import { createElement } from "react";
import { NodeBookArtifactSurface, loadArtifactPlugin } from "@nodebook/react";
import { sha256Text } from "@nodebook/core/mermaid";
import { render, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { engine, enterHackwithBayRoomAsHost } from "../src/app/roomStore";
import { HACKWITHBAY_GRAPH_ROWS, HACKWITHBAY_REQUIRED_TECH, HACKWITHBAY_VISUAL_ARTIFACTS } from "../src/app/hackwithBayRoomSeed";
import { decodeNodeBookVisualEnvelope, NODEBOOK_VISUAL_ELEMENT_ID } from "../src/notebook/visualArtifactEnvelope";

beforeAll(() => {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value() { return { measureText: (value: string) => ({ width: value.length * 7 }) }; },
  });
});

describe("HackwithBay 3.0 seeded room", () => {
  it("gives a hackathon host the original graph-agent room plus six verified visual proofs", async () => {
    const session = enterHackwithBayRoomAsHost();
    const artifacts = engine.listArtifacts(session.roomId);
    const messages = engine.listMessages(session.roomId, "public");
    const traces = engine.listTraces(session.roomId);

    expect(artifacts.map((artifact) => artifact.title)).toEqual(expect.arrayContaining([
      "HackwithBay Demo Brief",
      "HackwithBay Integration Map",
      "Provider Setup Checklist",
    ]));

    const map = artifacts.find((artifact) => artifact.title === "HackwithBay Integration Map");
    expect(map?.meta?.dataframe?.rowCount).toBe(HACKWITHBAY_GRAPH_ROWS.length);

    const roomText = artifacts.map(artifactText).join("\n");
    for (const tech of HACKWITHBAY_REQUIRED_TECH) expect(roomText).toContain(tech);
    expect(roomText).toContain("BankerToolBench task btb-067cb834");
    expect(roomText).toContain("Upload and ingest lane");
    expect(roomText).toContain("Cognee plus Neo4j graph display");
    expect(roomText).toContain("Daytona code execution receipt");

    expect(messages.some((message) => message.text.includes("@nodeagent Run BankerToolBench task btb-067cb834"))).toBe(true);
    expect(messages.some((message) => message.author.kind === "agent" && message.text.includes("provider keys"))).toBe(true);
    expect(traces.some((trace) => trace.summary.includes("HackwithBay 3.0 route seeded"))).toBe(true);

    const observedKindsAndFormats: Array<[string, string]> = [];
    const decodedVisuals = [];
    for (const fixture of HACKWITHBAY_VISUAL_ARTIFACTS) {
      const artifact = artifacts.find((candidate) => candidate.title === fixture.title);
      expect(artifact, `missing ${fixture.title}`).toBeTruthy();
      if (!artifact) throw new Error(`missing ${fixture.title}`);
      const element = artifact.elements[NODEBOOK_VISUAL_ELEMENT_ID];
      const decoded = decodeNodeBookVisualEnvelope(element?.value, {
        artifactId: artifact.id,
        title: artifact.title,
        version: element?.version ?? 0,
      });
      expect(decoded.status).toBe("valid");
      if (decoded.status !== "valid") {
        throw new Error(`${fixture.title}: ${decoded.status === "invalid" ? decoded.message : "missing envelope"}`);
      }

      observedKindsAndFormats.push([decoded.artifact.kind, decoded.artifact.format]);
      decodedVisuals.push(decoded.artifact);
      const canonical = await (await loadArtifactPlugin(decoded.artifact.kind)).validatePayload(decoded.artifact.payload);
      const recomputedHash = await sha256Text(canonical);
      expect(recomputedHash).toBe(fixture.contentHash);
      expect(decoded.artifact.contentHash).toBe(recomputedHash);
    }
    expect(observedKindsAndFormats).toEqual([
      ["mindmap", "structured-json"],
      ["flow", "structured-json"],
      ["chart", "vega-lite-json"],
      ["drawio", "drawio-xml"],
      ["mermaid", "mermaid"],
      ["infographic", "infographic-json"],
    ]);

    const firstVisual = decodedVisuals[0]!;
    const tampered = render(createElement(NodeBookArtifactSurface, {
      ...firstVisual,
      contentHash: "0".repeat(64),
    }));
    await waitFor(() => expect(tampered.getByRole("alert").textContent).toContain("ARTIFACT_DIGEST_MISMATCH"));
    tampered.unmount();
  }, 60_000);
});

function artifactText(artifact: ReturnType<typeof engine.listArtifacts>[number]): string {
  const values = Object.values(artifact.elements ?? {}).map((element) => String(element.value ?? ""));
  return [artifact.title, artifact.meta?.summary, ...values].filter(Boolean).join("\n");
}
