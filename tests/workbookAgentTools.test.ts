import { describe, expect, it } from "vitest";
import type { RoomTools } from "../src/nodeagent/core/types";
import { PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";

const tool = (name: string) => {
  const found = PRODUCTION_ROOM_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`missing tool ${name}`);
  return found;
};

describe("NodeAgent workbook planning tools", () => {
  it("inspects searched and snapshotted cells to identify a quoted formula target", async () => {
    const { rt } = fakeWorkbookRoom();
    const result = await tool("inspect_workbook").execute({
      instruction: 'Correct the wrong formula TEXT(F4,"DD") in F3 so it returns a weekday abbreviation.',
      artifactId: "attendance",
      maxCells: 20,
    }, rt) as {
      ok: boolean;
      inspection: { findings: Array<{ kind: string; address: string }>; targetCandidates: Array<{ address: string }> };
      cells: Array<{ elementId: string; version: number }>;
    };

    expect(result.ok).toBe(true);
    expect(result.inspection.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "formula_text_match", address: "F3" }),
    ]));
    expect(result.inspection.targetCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ address: "F3" }),
    ]));
    expect(result.cells).toEqual(expect.arrayContaining([
      expect.objectContaining({ elementId: "F3", version: 3 }),
      expect.objectContaining({ elementId: "F4", version: 2 }),
    ]));
  });

  it("rejects the wrong input-cell plan, then verifies the repaired formula after write", async () => {
    const { rt, values } = fakeWorkbookRoom();
    const instruction = 'Correct the wrong formula TEXT(F4,"DD") in F3 so it returns a weekday abbreviation.';
    const wrong = await tool("verify_workbook").execute({
      instruction,
      artifactId: "attendance",
      afterWrite: false,
      operations: [{ elementId: "F4", formula: 'TEXT(F4,"ddd")', result: "Tue" }],
    }, rt) as { status: string; plan: { issues: Array<{ kind: string }> }; repairPrompt?: string };

    expect(wrong.status).toBe("needs_repair");
    expect(wrong.plan.issues.map((issue) => issue.kind)).toEqual(expect.arrayContaining([
      "formula_self_reference",
      "missing_target_coverage",
    ]));
    expect(wrong.repairPrompt).toContain("formula_self_reference");

    values.set("F3", { value: "Tue", formula: 'TEXT(F4,"ddd")' });
    const repaired = await tool("verify_workbook").execute({
      instruction,
      artifactId: "attendance",
      operations: [{ elementId: "F3", formula: 'TEXT(F4,"ddd")', result: "Tue" }],
    }, rt) as {
      ok: boolean;
      status: string;
      phase: string;
      candidate: { checkedCount: number; passedCount: number; status: string };
    };

    expect(repaired).toMatchObject({
      ok: true,
      status: "passed",
      phase: "post_write",
      candidate: { checkedCount: 1, passedCount: 1, status: "passed" },
    });
  });
});

function fakeWorkbookRoom(): { rt: RoomTools; values: Map<string, unknown> } {
  const values = new Map<string, unknown>([
    ["E3", { value: "Mon", formula: 'TEXT(E4,"ddd")' }],
    ["E4", "2024-01-01"],
    ["F3", { value: "01", formula: 'TEXT(F4,"DD")' }],
    ["F4", "2024-01-02"],
    ["G3", { value: "Wed", formula: 'TEXT(G4,"ddd")' }],
    ["G4", "2024-01-03"],
  ]);
  const versions = new Map<string, number>([["F3", 3], ["F4", 2]]);
  const rt: RoomTools = {
    async snapshot() {
      return {
        artifactId: "attendance",
        version: 7,
        kind: "sheet",
        rows: [],
        elements: [...values].map(([id, value]) => ({ id, value, version: versions.get(id) ?? 1, locked: false })),
      };
    },
    async awareness() { return { activeLocks: [], agents: [], recentTrace: [] }; },
    async listArtifacts() { return [{ id: "attendance", title: "Attendance", kind: "sheet" }]; },
    async readRange(elementIds) {
      return elementIds.map((id) => ({ id, value: values.get(id), version: versions.get(id) ?? 1, locked: null }));
    },
    async searchSheetContext() {
      return [
        { kind: "cell", elementId: "F3", coordinate: "F3", rowHeader: "weekday", columnHeader: "Tuesday", rawValue: "01", semanticSummary: "wrong weekday formula", score: 1 },
        { kind: "chunk", chunkId: "weekday-band", elementIds: ["E3", "E4", "F3", "F4", "G3", "G4"], text: "weekday formula band", score: 0.9 },
      ];
    },
    async proposeLock() { return { ok: true, lockId: "lock" }; },
    async releaseLock() { return { ok: true, merged: [] }; },
    async editCell() { return { ok: true, version: 1 }; },
    async createDraft() { return { draftId: "draft" }; },
    async say() {},
    async fetchSource() { return { ok: false, error: "offline" }; },
  };
  return { rt, values };
}
