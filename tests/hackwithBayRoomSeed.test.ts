import { describe, expect, it } from "vitest";
import { engine, enterHackwithBayRoomAsHost } from "../src/app/roomStore";
import { HACKWITHBAY_GRAPH_ROWS, HACKWITHBAY_REQUIRED_TECH } from "../src/app/hackwithBayRoomSeed";

describe("HackwithBay 3.0 seeded room", () => {
  it("maps the BTB graph-agent demo onto the required provider surfaces", () => {
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
  });
});

function artifactText(artifact: ReturnType<typeof engine.listArtifacts>[number]): string {
  const values = Object.values(artifact.elements ?? {}).map((element) => String(element.value ?? ""));
  return [artifact.title, artifact.meta?.summary, ...values].filter(Boolean).join("\n");
}
