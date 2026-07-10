import { describe, expect, it } from "vitest";
import type { Actor, Artifact, Element } from "../src/engine/types";
import { executeNotebookKernel } from "../src/notebook/notebookKernel";
import { buildNotebookArtifactStructure, buildNotebookKernelTables, notebookKernelOutputElementId, readNotebookKernelOutputs } from "../src/ui/workArtifacts";

const actor: Actor = { kind: "user", id: "u1", name: "Priya" };
const element = (id: string, value: unknown): Element => ({ id, value, version: 1, updatedAt: 1, updatedBy: actor });

const sheet: Artifact = {
  id: "sheet-1",
  roomId: "room-1",
  kind: "sheet",
  title: "Diligence",
  version: 1,
  updatedAt: 1,
  order: ["r1__company", "r1__revenue", "r2__company", "r2__revenue"],
  elements: {
    "r1__company": element("r1__company", "CardioNova"),
    "r1__revenue": element("r1__revenue", 12),
    "r2__company": element("r2__company", "Mercury"),
    "r2__revenue": element("r2__revenue", 21),
  },
  meta: { dataframe: { columns: [{ id: "company", label: "Company", order: 0 }, { id: "revenue", label: "Revenue", order: 1 }], rowCount: 2 } },
};

describe("notebook safe kernel", () => {
  it("executes arithmetic without eval and emits a deterministic receipt", () => {
    const first = executeNotebookKernel({ kind: "calculation", input: "Runway = 12 + 8 * 2" }, { backend: "convex", now: 10 });
    const second = executeNotebookKernel({ kind: "calculation", input: "Runway = 12 + 8 * 2" }, { backend: "convex", now: 20 });

    expect(first).toMatchObject({ status: "completed", outputText: "28" });
    expect(first.receipt.inputHash).toBe(second.receipt.inputHash);
    expect(first.receipt.outputHash).toBe(second.receipt.outputHash);
    expect(first.receipt.backend).toBe("convex");
  });

  it("runs bounded read-only SQL over room sheet snapshots", () => {
    const tables = buildNotebookKernelTables([sheet]);
    const result = executeNotebookKernel({
      kind: "sql",
      input: "SELECT Company, Revenue FROM diligence WHERE Revenue >= 15 ORDER BY Revenue DESC LIMIT 5",
      tables,
    }, { now: 1 });

    expect(result.status).toBe("completed");
    expect(result.rows).toEqual([{ Company: "Mercury", Revenue: 21 }]);
    expect(result.receipt.rowCount).toBe(1);
  });

  it("blocks mutating SQL and creates chart specs from the same capped tables", () => {
    const tables = buildNotebookKernelTables([sheet]);
    expect(executeNotebookKernel({ kind: "sql", input: "DELETE FROM diligence", tables }, { now: 1 })).toMatchObject({ status: "blocked", errorCode: "sql_write_blocked" });

    const chart = executeNotebookKernel({ kind: "chart", input: "bar chart Revenue by Company from diligence", tables }, { now: 1 });
    expect(chart.status).toBe("completed");
    expect(chart.chart).toMatchObject({ type: "bar", x: "Company", y: "Revenue" });
    expect(chart.chart?.points).toHaveLength(2);
  });

  it("persists kernel outputs as hidden notebook receipt elements", () => {
    const result = executeNotebookKernel({ kind: "calculation", input: "2 + 3" }, { now: 1 });
    const outputId = notebookKernelOutputElementId("block-calc");
    const notebook: Artifact = {
      id: "note-1",
      roomId: "room-1",
      kind: "note",
      title: "Analysis",
      version: 2,
      updatedAt: 2,
      order: ["doc", outputId],
      elements: {
        doc: element("doc", '<p data-blockid="block-calc">Calculation: 2 + 3</p>'),
        [outputId]: element(outputId, { blockId: "block-calc", input: "2 + 3", result }),
      },
    };

    expect(readNotebookKernelOutputs(notebook)["block-calc"].result.outputText).toBe("5");
    expect(buildNotebookArtifactStructure(notebook).blockCount).toBe(1);
  });
});
