// @vitest-environment edge-runtime
//
// Regression for fresh-room BTB runs: uploaded .xlsx workbooks store cells in Excel A1
// address space, but models often ask read_range for row__column aliases such as 7__I.
// The production Convex tool should resolve that to I7 instead of returning a silent null.
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST = { kind: "user" as const, id: "host_1", name: "Homen" };

describe("uploaded workbook read_range", () => {
  it("resolves row__column aliases against Excel-grid artifacts", async () => {
    const t = convexTest(schema, modules);
    const { roomId, artifactId } = await t.run(async (ctx) => {
      const now = Date.now();
      const roomId = await ctx.db.insert("rooms", {
        code: "BTBGRID",
        title: "BTB workbook",
        hostId: "host_1",
        autoAllow: true,
        status: "live" as const,
        createdAt: now,
      });
      const artifactId = await ctx.db.insert("artifacts", {
        roomId,
        kind: "sheet" as const,
        title: "Private Technology Company Financials (Dec 2024).xlsx",
        version: 1,
        order: ["I7"],
        updatedAt: now,
        createdBy: HOST,
        meta: {
          dataframe: {
            parser: "exceljs:xlsx-grid",
            rowCount: 315,
            columns: [{ id: "I", label: "I", order: 8, type: "text", agentWritable: true }],
          },
          excelGrid: { parser: "exceljs:xlsx-grid", rows: 315, columns: 26, sheetName: "Company Provided Financials" },
        },
      });
      await ctx.db.insert("elements", {
        artifactId,
        elementId: "I7",
        version: 1,
        value: { value: 621.1, status: "complete" },
        updatedAt: now,
        updatedBy: HOST,
      });
      return { roomId, artifactId };
    });

    const [cell] = await t.query(internal.artifacts.readRange, { roomId, artifactId, elementIds: ["7__I"] });

    expect(cell.id).toBe("I7");
    expect(cell.version).toBe(1);
    expect((cell.value as { value?: unknown }).value).toBe(621.1);
  });

  it("returns a bounded sample when a weak model omits elementIds", async () => {
    const t = convexTest(schema, modules);
    const { roomId, artifactId } = await t.run(async (ctx) => {
      const now = Date.now();
      const roomId = await ctx.db.insert("rooms", {
        code: "BTBSAMPLE",
        title: "BTB workbook sample",
        hostId: "host_1",
        autoAllow: true,
        status: "live" as const,
        createdAt: now,
      });
      const artifactId = await ctx.db.insert("artifacts", {
        roomId,
        kind: "sheet" as const,
        title: "Uploaded SOFR Curve.xlsx",
        version: 1,
        order: ["A1", "B1", "A2"],
        updatedAt: now,
        createdBy: HOST,
        meta: {
          dataframe: {
            parser: "exceljs:xlsx-grid",
            rowCount: 3,
            columns: [
              { id: "A", label: "A", order: 0, type: "text", agentWritable: true },
              { id: "B", label: "B", order: 1, type: "text", agentWritable: true },
            ],
          },
          excelGrid: { parser: "exceljs:xlsx-grid", rows: 3, columns: 2, sheetName: "SOFR" },
        },
      });
      await ctx.db.insert("elements", {
        artifactId,
        elementId: "A1",
        version: 1,
        value: "Term",
        updatedAt: now,
        updatedBy: HOST,
      });
      await ctx.db.insert("elements", {
        artifactId,
        elementId: "B1",
        version: 1,
        value: "Rate",
        updatedAt: now,
        updatedBy: HOST,
      });
      return { roomId, artifactId };
    });

    const sample = await t.query(internal.artifacts.readRange, { roomId, artifactId, elementIds: [] });

    expect(sample).toHaveLength(3);
    expect(sample[0]).toMatchObject({
      id: "A1",
      hint: expect.stringContaining("requires explicit elementIds"),
      sampleElementIds: ["A1", "B1", "A2"],
      artifactTitle: "Uploaded SOFR Curve.xlsx",
    });
  });

  it("steers empty explicit workbook reads toward non-empty sample cells", async () => {
    const t = convexTest(schema, modules);
    const { roomId, artifactId } = await t.run(async (ctx) => {
      const now = Date.now();
      const roomId = await ctx.db.insert("rooms", {
        code: "BTBEMPTY",
        title: "BTB workbook blanks",
        hostId: "host_1",
        autoAllow: true,
        status: "live" as const,
        createdAt: now,
      });
      const artifactId = await ctx.db.insert("artifacts", {
        roomId,
        kind: "sheet" as const,
        title: "Uploaded Financials.xlsx",
        version: 1,
        order: ["A1", "B1", "A2", "B2"],
        updatedAt: now,
        createdBy: HOST,
        meta: {
          dataframe: {
            parser: "exceljs:xlsx-grid",
            rowCount: 2,
            columns: [
              { id: "A", label: "A", order: 0, type: "text", agentWritable: true },
              { id: "B", label: "B", order: 1, type: "text", agentWritable: true },
            ],
          },
          excelGrid: { parser: "exceljs:xlsx-grid", rows: 2, columns: 2, sheetName: "Financials" },
        },
      });
      for (const [elementId, value] of [
        ["A1", ""],
        ["B1", "Revenue"],
        ["A2", ""],
        ["B2", 1250],
      ] as const) {
        await ctx.db.insert("elements", {
          artifactId,
          elementId,
          version: 1,
          value,
          updatedAt: now,
          updatedBy: HOST,
        });
      }
      return { roomId, artifactId };
    });

    const sample = await t.query(internal.artifacts.readRange, { roomId, artifactId, elementIds: [] });
    expect(sample[0]).toMatchObject({ id: "B1", value: "Revenue" });

    const [emptyRead] = await t.query(internal.artifacts.readRange, { roomId, artifactId, elementIds: ["A1"] });
    expect(emptyRead).toMatchObject({
      id: "A1",
      hint: expect.stringContaining("Requested cells were blank or missing"),
      sampleElementIds: expect.arrayContaining(["B1", "B2"]),
    });
  });
});
