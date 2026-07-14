import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { applyExportCell, exportCellValue } from "../src/ui/panels/Artifact";

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
});
