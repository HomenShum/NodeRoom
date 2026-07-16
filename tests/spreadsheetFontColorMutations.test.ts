import { describe, expect, it } from "vitest";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { RoomEngine } from "../src/engine/roomEngine";
import type { CellPayload } from "../src/engine/types";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";

function setup() {
  const engine = new RoomEngine();
  const room = buildDemoRoom(engine);
  const rt = new InMemoryRoomTools(engine, room.roomId, room.sheetId, room.agents.room, room.sessions.room);
  return { engine, room, rt };
}

function tool(name: string) {
  const found = PRODUCTION_ROOM_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
}

describe("managed spreadsheet font-color mutations", () => {
  it("materializes a style-only write without losing formula, value, status, or evidence", async () => {
    const { engine, room, rt } = setup();
    const art = engine.getArtifact(room.sheetId)!;
    const target = art.elements.r_rev__variance;
    const seeded: CellPayload = {
      value: 42,
      formula: "=B2*2",
      numFmt: "0.00",
      fontColor: "FF102030",
      status: "complete",
      confidence: 0.94,
      evidence: [{ id: "computed:B2", kind: "computed", label: "B2 doubled" }],
    };
    expect(engine.applyEdit({
      roomId: room.roomId,
      op: { opId: "seed-colored-formula", artifactId: room.sheetId, elementId: target.id, kind: "set", value: seeded, baseVersion: target.version },
      actor: room.members.homen,
    }).ok).toBe(true);
    const [current] = await rt.readRange([target.id]);

    const parsed = tool("write_locked_cell").schema.parse({
      elementId: target.id,
      baseVersion: current.version,
      fontColor: "#aabbcc",
      reason: "change font color only",
    });
    const result = await tool("write_locked_cell").execute(parsed, rt) as { ok?: boolean };
    const payload = engine.getArtifact(room.sheetId)!.elements[target.id].value as CellPayload;

    expect(result.ok).toBe(true);
    expect(payload).toEqual({ ...seeded, fontColor: "FFAABBCC" });

    const batch = await tool("write_locked_cells").execute({
      elementIds: [target.id],
      fontColors: ["010203"],
      reason: "parallel style-only write",
    }, rt) as { ok?: boolean };
    expect(batch.ok).toBe(true);
    expect(engine.getArtifact(room.sheetId)!.elements[target.id].value).toEqual({ ...seeded, fontColor: "FF010203" });
  });

  it("preserves an existing override when fontColor is absent and canonicalizes batch/result inputs", async () => {
    const { engine, room, rt } = setup();
    const target = engine.getArtifact(room.sheetId)!.elements.r_rev__variance;
    expect(engine.applyEdit({
      roomId: room.roomId,
      op: {
        opId: "seed-font-override",
        artifactId: room.sheetId,
        elementId: target.id,
        kind: "set",
        value: { value: 10, fontColor: "FF445566" } satisfies CellPayload,
        baseVersion: target.version,
      },
      actor: room.members.homen,
    }).ok).toBe(true);

    const scalar = await tool("write_locked_cells").execute({
      ops: [{ elementId: target.id, value: 11 }],
    }, rt) as { ok?: boolean };
    expect(scalar.ok).toBe(true);
    expect(engine.getArtifact(room.sheetId)!.elements[target.id].value).toEqual({ value: 11, fontColor: "FF445566" });

    const result = await tool("write_locked_cell_results").execute({
      elementIds: [target.id],
      values: [12],
      fontColors: ["#80112233"],
      evidence: [{ kind: "manual", label: "Reviewed value" }],
    }, rt) as { ok?: boolean };
    expect(result.ok).toBe(true);
    expect(engine.getArtifact(room.sheetId)!.elements[target.id].value).toMatchObject({
      value: 12,
      fontColor: "80112233",
      evidence: [{ kind: "manual", label: "Reviewed value" }],
    });
  });

  it.each(["red", "rgb(1,2,3)", "#12345", "#GG1122", null])(
    "rejects an explicit unsupported managed color %s",
    (fontColor) => {
      expect(tool("write_locked_cell").schema.safeParse({ elementId: "B2", fontColor }).success).toBe(false);
      expect(tool("write_locked_cells").schema.safeParse({ ops: [{ elementId: "B2", fontColor }] }).success).toBe(false);
      expect(tool("verify_workbook").schema.safeParse({ instruction: "style B2", operations: [{ elementId: "B2", fontColor }] }).success).toBe(false);
    },
  );
});
