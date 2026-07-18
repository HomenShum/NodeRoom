import { describe, expect, it } from "vitest";
import { PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import type { RoomTools } from "../src/nodeagent/core/types";

/**
 * Regression: first-write deadlock on blank sheets (live room NRNXCFYJK5B, 2026-07-18).
 *
 * verify_workbook preflight required every target cell to already carry an integer
 * version. On a brand-new sheet the target cells do not exist, so preflight returned
 * needs_repair with "re-read before approving" guidance the agent could never satisfy
 * (reading cannot version a nonexistent cell), writes stayed blocked behind the
 * preflight requirement, and the live agent looped 11 turns until cancelled.
 *
 * Contract under test: a missing version is a CREATE (the managed write path defaults
 * creates to baseVersion 0) — preflight passes and approves those ops at baseVersion 0.
 * Stale versions on EXISTING cells must still fail closed.
 */

const verifyTool = PRODUCTION_ROOM_TOOLS.find((t) => t.name === "verify_workbook");

function roomToolsWithVersions(versionById: Record<string, number | undefined>) {
  const rt: Partial<RoomTools> = {
    snapshot: async () => ({ artifactId: "sheet", version: 1, kind: "sheet", rows: [] }),
    readRange: async (elementIds) =>
      elementIds.map((id) => ({ id, value: versionById[id] === undefined ? undefined : "x", version: versionById[id], locked: null })) as never,
    searchSheetContext: async () => [],
  };
  return rt as RoomTools;
}

describe("verify_workbook preflight on blank sheets", () => {
  it("exposes the tool under test", () => {
    expect(verifyTool).toBeTruthy();
  });

  it("passes a first-write plan whose target cells do not exist yet, approving creates at baseVersion 0", async () => {
    const rt = roomToolsWithVersions({ r1__metric: undefined, r1__q3: undefined });
    const result = (await verifyTool!.execute(
      {
        instruction: "Fill the Q3 variance sheet header row",
        artifactId: "sheet",
        afterWrite: false,
        operations: [
          { elementId: "r1__metric", value: "Revenue" },
          { elementId: "r1__q3", value: 12400 },
        ],
      },
      rt,
    )) as { ok: boolean; status: string; approvedOperations?: Array<{ elementId: string; baseVersion: number }>; newCellTargets?: string[]; repairPrompt?: string };

    expect(result.status).toBe("passed");
    expect(result.ok).toBe(true);
    expect(result.approvedOperations).toBeTruthy();
    expect(result.approvedOperations!.map((op) => op.baseVersion)).toEqual([0, 0]);
    expect(result.newCellTargets).toEqual(["r1__metric", "r1__q3"]);
    expect(result.repairPrompt ?? "").not.toMatch(/target_version_unavailable/);
  });

  it("approves mixed plans with existing-cell versions carried through and new cells at 0", async () => {
    const rt = roomToolsWithVersions({ r1__metric: 7, r2__metric: undefined });
    const result = (await verifyTool!.execute(
      {
        instruction: "Extend the metric column",
        artifactId: "sheet",
        afterWrite: false,
        operations: [
          { elementId: "r1__metric", value: "Revenue", baseVersion: 7 },
          { elementId: "r2__metric", value: "COGS" },
        ],
      },
      rt,
    )) as { status: string; approvedOperations?: Array<{ baseVersion: number }> };

    expect(result.status).toBe("passed");
    expect(result.approvedOperations!.map((op) => op.baseVersion)).toEqual([7, 0]);
  });

  it("still fails closed when an existing cell's baseVersion is stale", async () => {
    const rt = roomToolsWithVersions({ r1__metric: 9 });
    const result = (await verifyTool!.execute(
      {
        instruction: "Update the metric header",
        artifactId: "sheet",
        afterWrite: false,
        operations: [{ elementId: "r1__metric", value: "Revenue", baseVersion: 3 }],
      },
      rt,
    )) as { ok: boolean; status: string; repairPrompt?: string };

    expect(result.status).toBe("needs_repair");
    expect(result.ok).toBe(false);
    expect(result.repairPrompt ?? "").toMatch(/stale_target_version/);
  });
});
