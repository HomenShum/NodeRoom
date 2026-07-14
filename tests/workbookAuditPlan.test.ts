import { describe, expect, it } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { runAgent } from "../src/nodeagent/core/runtime";
import { workbookAuditPlan } from "../src/nodeagent/core/plans";
import { scriptedModel } from "../src/nodeagent/models/scripted";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";

describe("scripted workbook audit dogfood plan", () => {
  it("inspects, preflights, writes through lock/CAS, and verifies changed cells", async () => {
    const engine = new RoomEngine();
    const demo = buildDemoRoom(engine);
    const rt = new InMemoryRoomTools(engine, demo.roomId, demo.sheetId, demo.agents.room, demo.sessions.room);
    const operations = [
      { elementId: "r_rev__variance", value: "+24%" },
      { elementId: "r_cogs__variance", value: "+27.5%" },
    ];
    const instruction = "Audit and repair workbook cells r_rev__variance and r_cogs__variance, then verify each changed cell.";

    const result = await runAgent({
      rt,
      goal: instruction,
      model: scriptedModel(workbookAuditPlan({ artifactId: demo.sheetId, instruction, operations })),
      tools: ROOM_TOOLS,
      maxSteps: 20,
    });

    expect(result.stopReason).toBe("done");
    expect(result.finalText).toContain("passed post-write verification");
    expect(engine.getArtifact(demo.sheetId)?.elements.r_rev__variance.value).toBe("+24%");
    expect(engine.getArtifact(demo.sheetId)?.elements.r_cogs__variance.value).toBe("+27.5%");
    expect(result.trace.map((event) => event.tool)).toEqual([
      "inspect_workbook",
      "verify_workbook",
      "propose_lock",
      "read_range",
      "edit_cell",
      "edit_cell",
      "release_lock",
      "verify_workbook",
    ]);
    const verificationReceipts = result.trace.filter((event) => event.tool === "verify_workbook");
    expect(verificationReceipts).toHaveLength(2);
    expect(verificationReceipts[0].result).toMatchObject({ phase: "preflight", status: "passed" });
    expect(verificationReceipts[1].result).toMatchObject({ phase: "post_write", status: "passed" });
  });
});
