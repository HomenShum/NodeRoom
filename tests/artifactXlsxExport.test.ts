import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { Artifact } from "../src/engine/types";
import { applyExportCell, exportCellValue, spreadsheetCellFontColorCss } from "../src/ui/panels/Artifact";

describe("NodeRoom XLSX cell export", () => {
  it("preserves a managed formula, cached result, and number format after reopen", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Model");

    applyExportCell(sheet.getCell("C2"), {
      value: 30,
      formula: "=B3*2",
      numFmt: "$#,##0",
    });

    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    const cell = reopened.getWorksheet("Model")!.getCell("C2");

    expect(cell.formula).toBe("B3*2");
    expect(cell.result).toBe(30);
    expect(cell.numFmt).toBe("$#,##0");
  });

  it("continues coercing scalar numeric strings without inventing formulas", () => {
    expect(exportCellValue("3.5")).toBe(3.5);
    expect(exportCellValue({ value: "Revenue", numFmt: "General" })).toBe("Revenue");
  });

  it("overlays payload font color without losing captured font and style fields", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Model");

    applyExportCell(
      sheet.getCell("C2"),
      { value: 30, fontColor: "80112233", numFmt: "0.0%" },
      { b: 1, i: 1, u: 1, fc: "#445566", bg: "#DDEEFF", a: "c", ind: 2, bt: 1, bb: 1, f: 0 },
      ["$#,##0"],
    );

    const reopened = new ExcelJS.Workbook();
    await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
    const cell = reopened.getWorksheet("Model")!.getCell("C2");

    expect(cell.font).toMatchObject({
      bold: true,
      italic: true,
      underline: true,
      color: { argb: "80112233" },
    });
    expect(cell.fill).toMatchObject({ type: "pattern", pattern: "solid", fgColor: { argb: "FFDDEEFF" } });
    expect(cell.alignment).toMatchObject({ horizontal: "center", indent: 2 });
    expect(cell.border.top?.style).toBe("thin");
    expect(cell.border.bottom?.style).toBe("thin");
    expect(cell.numFmt).toBe("0.0%");
  });

  it("uses payload color over imported color in the grid and preserves alpha in CSS", () => {
    const artifact = {
      id: "model",
      roomId: "room",
      kind: "sheet",
      title: "Model",
      version: 1,
      updatedAt: 1,
      order: ["A1", "A2"],
      elements: {
        A1: { id: "A1", version: 1, value: { value: "Override", fontColor: "80112233" }, updatedAt: 1, updatedBy: { kind: "user", id: "u1", name: "User" } },
        A2: { id: "A2", version: 1, value: { value: "Imported" }, updatedAt: 1, updatedBy: { kind: "user", id: "u1", name: "User" } },
      },
      meta: {
        excelGrid: {
          sourceFile: "model.xlsx",
          sheetName: "Model",
          sheetNames: ["Model"],
          parser: "exceljs:xlsx-grid",
          rows: 2,
          columns: 1,
          styles: { A1: { fc: "#445566" }, A2: { fc: "#AABBCC" } },
        },
      },
    } satisfies Artifact;

    expect(spreadsheetCellFontColorCss(artifact, "A1")).toBe("#11223380");
    expect(spreadsheetCellFontColorCss(artifact, "A2")).toBe("#AABBCC");
  });
});
