import { describe, expect, it } from "vitest";
import { runAgent } from "../src/nodeagent/core/runtime";
import type { AgentModel } from "../src/nodeagent/core/types";
import { PRODUCTION_ROOM_TOOLS } from "../src/nodeagent/skills/spreadsheet/cellMutator";
import type { RoomTools } from "../src/nodeagent/core/types";

function fakeRoomTools() {
  const writes: Array<{ elementId: string; value: unknown; baseVersion: number }> = [];
  const rt: Partial<RoomTools> = {
    snapshot: async () => ({ artifactId: "sheet", version: 1, kind: "sheet", rows: [] }),
    awareness: async () => ({ activeLocks: [], agents: [], recentTrace: [], autoAllow: true }),
    listArtifacts: async () => [{ id: "sheet", title: "Q3 variance", kind: "sheet" }],
    readRange: async (elementIds) => elementIds.map((id) => ({ id, value: "", version: 7, locked: null })),
    searchSheetContext: async () => [],
    proposeLock: async (elementIds) => ({ ok: true as const, lockId: `lock:${elementIds.join(",")}` }),
    editCell: async (elementId, value, baseVersion) => {
      writes.push({ elementId, value, baseVersion });
      return { ok: true as const, version: baseVersion + 1 };
    },
    releaseLock: async () => ({ ok: true, merged: [] }),
    createDraft: async () => ({ draftId: "draft:unused" }),
    say: async () => undefined,
    fetchSource: async () => ({ ok: false as const, error: "not_available" }),
  };
  return { rt: rt as RoomTools, writes };
}

describe("managed write argument aliases", () => {
  it("normalizes single-cell aliases emitted by cheap provider tool callers", async () => {
    const tool = PRODUCTION_ROOM_TOOLS.find((candidate) => candidate.name === "write_locked_cell");
    expect(tool).toBeTruthy();
    const parsed = tool!.schema.safeParse({
      cell: "r_cogs__note",
      newValue: "public-room proof",
      currentVersion: "7",
    });
    expect(parsed.success).toBe(true);

    const { rt, writes } = fakeRoomTools();
    const result = await tool!.execute(parsed.success ? parsed.data : {}, rt);

    expect(result).toMatchObject({ ok: true, version: 8 });
    expect(writes).toEqual([{ elementId: "r_cogs__note", value: "public-room proof", baseVersion: 7 }]);
  });

  it("normalizes batch aliases before managed lock execution", async () => {
    const tool = PRODUCTION_ROOM_TOOLS.find((candidate) => candidate.name === "write_locked_cells");
    expect(tool).toBeTruthy();
    const parsed = tool!.schema.safeParse({
      targetCells: ["r_cogs__note"],
      newValues: ["public-room proof"],
      currentVersion: 7,
    });
    expect(parsed.success).toBe(true);

    const { rt, writes } = fakeRoomTools();
    const result = await tool!.execute(parsed.success ? parsed.data : {}, rt);

    expect(result).toMatchObject({ ok: true });
    expect(writes).toEqual([{ elementId: "r_cogs__note", value: "public-room proof", baseVersion: 7 }]);
  });

  it("preserves formulas, cached results, and number formats through managed writes", async () => {
    const tool = PRODUCTION_ROOM_TOOLS.find((candidate) => candidate.name === "write_locked_cells");
    expect(tool).toBeTruthy();
    const parsed = tool!.schema.safeParse({
      artifactId: "sheet",
      ops: [{
        elementId: "C7",
        formula: "=A7+B7",
        result: 42,
        numFmt: "$#,##0",
        baseVersion: 7,
      }],
    });
    expect(parsed.success).toBe(true);

    const { rt, writes } = fakeRoomTools();
    const result = await tool!.execute(parsed.success ? parsed.data : {}, rt);

    expect(result).toMatchObject({ ok: true });
    expect(writes).toEqual([{
      elementId: "C7",
      value: { value: 42, formula: "=A7+B7", numFmt: "$#,##0" },
      baseVersion: 7,
    }]);
  });

  it("unwraps or drops provider metadata objects used as formula results", async () => {
    const tool = PRODUCTION_ROOM_TOOLS.find((candidate) => candidate.name === "write_locked_cells");
    expect(tool).toBeTruthy();
    const parsed = tool!.schema.safeParse({
      artifactId: "sheet",
      ops: [
        { elementId: "C7", formula: "=A7+B7", result: { formula: "=A7+B7", result: 42 }, baseVersion: 7 },
        { elementId: "D7", formula: "=B7+C7", result: { formula: "=B7+C7" }, baseVersion: 7 },
      ],
    });
    expect(parsed.success).toBe(true);

    const { rt, writes } = fakeRoomTools();
    const result = await tool!.execute(parsed.success ? parsed.data : {}, rt);

    expect(result).toMatchObject({ ok: true });
    expect(writes.map((write) => write.value)).toEqual([
      { value: 42, formula: "=A7+B7" },
      { value: "", formula: "=B7+C7" },
    ]);
  });

  it("normalizes parallel formula arrays emitted by low-cost tool callers", async () => {
    const tool = PRODUCTION_ROOM_TOOLS.find((candidate) => candidate.name === "write_locked_cells");
    expect(tool).toBeTruthy();
    const parsed = tool!.schema.safeParse({
      elementIds: ["C7", "D7"],
      results: [42, 55],
      formulas: ["=A7+B7", "=B7+C7"],
      numFmts: ["$#,##0", "$#,##0"],
      baseVersions: [7, 7],
    });
    expect(parsed.success).toBe(true);

    const { rt, writes } = fakeRoomTools();
    await tool!.execute(parsed.success ? parsed.data : {}, rt);

    expect(writes.map((write) => write.value)).toEqual([
      { value: 42, formula: "=A7+B7", numFmt: "$#,##0" },
      { value: 55, formula: "=B7+C7", numFmt: "$#,##0" },
    ]);
  });

  it("repairs missing managed-write arguments from a single exact user request", async () => {
    const { rt, writes } = fakeRoomTools();
    const model: AgentModel = {
      name: "missing-args-model",
      async next({ messages }) {
        const wrote = messages.some((message) => message.role === "tool" && message.toolName === "write_locked_cell");
        if (wrote) return { text: "done", toolCalls: [], done: true };
        return { toolCalls: [{ id: "bad-write", tool: "write_locked_cell", args: {} }], done: false };
      },
    };

    const result = await runAgent({
      rt,
      model,
      tools: PRODUCTION_ROOM_TOOLS,
      goal: 'In the Q3 variance spreadsheet, set r_cogs__note exactly to "public-room proof".',
      contextBuilder: async () => [],
      maxSteps: 3,
    });

    expect(result.stopReason).toBe("done");
    expect(writes).toEqual([{ elementId: "r_cogs__note", value: "public-room proof", baseVersion: 7 }]);
    expect(result.trace[0]).toMatchObject({
      tool: "write_locked_cell",
      args: { elementId: "r_cogs__note", value: "public-room proof" },
    });
  });
});
