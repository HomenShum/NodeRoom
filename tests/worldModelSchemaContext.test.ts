/**
 * Fix B — buildContext must describe the sheet's REAL columns so the live LLM agent populates
 * VISIBLE cells on any sheet, not the hardcoded `{rowId}__variance` / `{rowId}__note` orphans.
 *
 * Two guards:
 *  1. No regression — the Q3-variance sheet (special CAS shape, no declared schema) yields the
 *     exact same variance/note addressing + Q2/Q3 table the wedge demo relies on.
 *  2. The fix — a generic A/B/C sheet (declares columns) names A/B/C as the addressable cells and
 *     drops the variance/note addressing entirely.
 */
import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { buildContext } from "../src/nodeagent/core/worldModel";
import type { Actor, ArtifactMeta, DataframeColumn } from "../src/engine/types";

const render = (msgs: { content: string }[]) => msgs.map((m) => m.content).join("\n");

describe("worldModel buildContext — schema-aware columns (Fix B)", () => {
  it("variance sheet: context is unchanged — still addresses {rowId}__variance / {rowId}__note", async () => {
    const engine = new RoomEngine();
    const demo = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
    const ctx = render(await buildContext(rt, "recompute Q3 variance"));
    expect(ctx).toContain("`{rowId}__variance`");
    expect(ctx).toContain("`{rowId}__note`");
    expect(ctx).toContain("Q2="); // variance table shape preserved
    expect(ctx).not.toContain("{rowId}__<column>");
  });

  it("generic A/B/C sheet: context names the REAL columns and drops variance/note addressing", async () => {
    const engine = new RoomEngine();
    const { room, host } = engine.createRoom({ title: "Blank", hostName: "Homen", autoAllow: true });
    const me: Actor = { kind: "user", id: host.id, name: host.name };
    const columns: DataframeColumn[] = ["A", "B", "C"].map((label, order) => ({
      id: label, label, order, mode: "manual" as const, type: "text" as const, agentWritable: true,
    }));
    const seed: Array<{ id: string; value: unknown }> = [];
    for (const rid of ["r1", "r2"]) for (const c of ["A", "B", "C"]) seed.push({ id: `${rid}__${c}`, value: "" });
    const meta: ArtifactMeta = { dataframe: { columns, rowCount: 2, sourceFile: "blank", parser: "blank_seed", truncated: false, warnings: [] } };
    const sheetId = engine.createArtifact({ roomId: room.id, kind: "sheet", title: "Sheet 1", by: me, seed, meta }).id;
    const sess = engine.startSession({ roomId: room.id, agentId: "agent_room", agentName: "Room NodeAgent", scope: "public" });
    const actor: Actor = { kind: "agent", id: "agent_room", name: "Room NodeAgent", scope: "public" };
    const rt = new InMemoryRoomTools(engine, room.id, sheetId, actor, sess.id);

    const ctx = render(await buildContext(rt, "fill in the table"));
    expect(ctx).toContain("{rowId}__<column>");
    expect(ctx).toContain("`A`");
    expect(ctx).toContain("`B`");
    expect(ctx).toContain("`C`");
    // the old hardcoded addressing must be gone for a real-schema sheet
    expect(ctx).not.toContain("`{rowId}__variance`");
    expect(ctx).not.toContain("`{rowId}__note`");
  });
});
