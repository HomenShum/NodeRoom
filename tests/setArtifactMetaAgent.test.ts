import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";

describe("set_artifact_meta (agent-managed topic + metadata)", () => {
  it("is a production tool", () => {
    expect(PRODUCTION_ROOM_TOOLS.map((t) => t.name)).toContain("set_artifact_meta");
  });

  it("lets the agent author topic + summary + tags on a file it does not own (feeds OKF)", async () => {
    const engine = new RoomEngine();
    const d = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, d.roomId, d.sheetId, d.agents.room, d.sessions.room);
    const tool = PRODUCTION_ROOM_TOOLS.find((t) => t.name === "set_artifact_meta")!;

    const res = (await tool.execute(
      { artifactId: d.sheetId, title: "CardioNova Series-C diligence model", summary: "Q3 variance vs plan for CardioNova", tags: ["cardionova", "variance", "series-c"] },
      rt,
    )) as { ok: boolean };

    expect(res.ok).toBe(true);
    const art = engine.getArtifact(d.sheetId)!;
    expect(art.title).toBe("CardioNova Series-C diligence model");
    expect(art.meta?.summary).toBe("Q3 variance vs plan for CardioNova");
    expect(art.meta?.tags).toEqual(["cardionova", "variance", "series-c"]);
  });
});
