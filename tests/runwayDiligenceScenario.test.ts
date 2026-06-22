/**
 * Runway diligence scenario — the "@nodeagent runway gaps" chat command (memory-mode askAgent
 * routing in src/app/store.tsx) must source cash + burn and COMPUTE runway on the REAL demo seed,
 * including the Runway / milestones sheet's COMPUTE-mode `runway` column, behind a lock with CAS
 * (no clobber). The variance wedge never exercises a compute-mode column, so this is the guard
 * that the reused recomputeVariancePlan write path actually lands those cells.
 *
 * Scenario: a banker types "@nodeagent runway gaps" in the live room. The Room NodeAgent claims
 * the affected range, writes the sourced cash/burn + computed runway + status, and releases —
 * exactly one lock cycle, zero conflicts.
 */
import { describe, it, expect } from "vitest";
import { RoomEngine } from "../src/engine/roomEngine";
import { buildDemoRoom } from "../src/engine/demoRoom";
import { InMemoryRoomTools } from "../src/nodeagent/skills/integration/noderoomAdapter";
import { runAgent } from "../src/nodeagent/core/runtime";
import { scriptedModel } from "../src/nodeagent/models/scripted";
import { recomputeVariancePlan } from "../src/nodeagent/core/plans";
import { ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";

// Mirrors the targets the store's runway routing builds from RUNWAY_SOURCED.
const RUNWAY_TARGETS: Record<string, string> = {
  rw_cardionova__cash: "$2.1M (Q2'26 board pack)",
  rw_cardionova__burn: "$180K/mo",
  rw_cardionova__runway: "~11.7 months (to ~Jun 2027)",
  rw_cardionova__status: "sourced",
  rw_pulley__cash: "$3.4M (May'26 update)",
  rw_pulley__burn: "$210K/mo",
  rw_pulley__runway: "~16.2 months (to ~Oct 2027)",
  rw_pulley__status: "sourced",
};

describe("runway diligence scenario (@nodeagent runway gaps)", () => {
  it("sources cash + burn and writes the COMPUTE runway column behind one lock, no clobber", async () => {
    const engine = new RoomEngine();
    const demo = buildDemoRoom(engine);
    const runway = engine
      .listArtifacts(demo.roomId)
      .find((a) => a.kind === "sheet" && a.title === "Runway / milestones");
    expect(runway).toBeTruthy();

    // Precondition: the seeded runway gaps are unsourced ("Unknown" cash/burn).
    expect(String(runway!.elements["rw_cardionova__cash"].value)).toMatch(/unknown/i);
    expect(String(runway!.elements["rw_pulley__burn"].value)).toMatch(/unknown/i);

    const rt = new InMemoryRoomTools(engine, demo.roomId, runway!.id, demo.agents.room, demo.sessions.room);
    const res = await runAgent({
      rt,
      goal: "prepare runway and milestone gaps for CardioNova and the batch watchlist",
      model: scriptedModel(recomputeVariancePlan(RUNWAY_TARGETS, { lock: true, reason: "source runway gaps" })),
      tools: ROOM_TOOLS,
      maxSteps: 40,
    });

    // The run terminates cleanly (does not exhaust the step budget in a loop).
    expect(res.exhausted).toBe(false);

    const art = engine.listArtifacts(demo.roomId).find((a) => a.id === runway!.id)!;
    for (const [id, value] of Object.entries(RUNWAY_TARGETS)) {
      expect(String(art.elements[id].value)).toBe(value);
    }
    // The COMPUTE-mode `runway` column actually took the agent write (the unique risk here).
    expect(String(art.elements["rw_cardionova__runway"].value)).toContain("11.7 months");
    expect(String(art.elements["rw_pulley__runway"].value)).toContain("16.2 months");

    // No clobber: zero CAS conflicts, exactly one claim→edit→release lock cycle.
    const conflicts = res.trace.filter(
      (t) => (t.tool === "edit_cell" || t.tool === "write_cell_result") && (t.result as { conflict?: boolean })?.conflict,
    );
    expect(conflicts.length).toBe(0);
    expect(res.trace.filter((t) => t.tool === "release_lock").length).toBe(1);
  });
});
