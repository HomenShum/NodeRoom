import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHEET } from "../src/ui/mobile/mobileData";
import { buildMobileSampleWorkbook } from "../src/ui/mobile/mobileSheetExport";
import { downloadXlsxWorkbook } from "../src/ui/workArtifacts/xlsxDownload";

async function reopen(rows = structuredClone(SHEET.rows)) {
  const workbook = await buildMobileSampleWorkbook(SHEET, rows);
  const opened = new ExcelJS.Workbook();
  await opened.xlsx.load(await workbook.xlsx.writeBuffer());
  return opened;
}

describe("A reviewer exports the current local mobile diligence table", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reopens edited literal values and unverified metadata through ten changing snapshots", async () => {
    const rows = structuredClone(SHEET.rows);
    const original = structuredClone(SHEET.rows);
    const values = ["00123", "=SUM(A1:A3)", "采购\nreview", "<source>&\"quoted\"", "", "long note ".repeat(180)];
    for (let run = 0; run < 10; run += 1) {
      SHEET.columns.forEach((column, index) => {
        rows[0].cells[column.id] = { v: values[index] + (index === 0 ? String(run) : ""), status: "manual note", tone: "mute", claim: "sample-claim" };
      });
      const current = structuredClone(rows);
      const opened = await reopen(rows);
      const table = opened.getWorksheet("Current table")!;
      expect(table.rowCount).toBe(4);
      expect(table.getRow(1).values).toEqual([undefined, "Company", "Product", "Funding", "Runway", "Q3 ARR", "Contact"]);
      SHEET.columns.forEach((column, columnIndex) => current.forEach((row, rowIndex) => {
        const cell = table.getCell(rowIndex + 2, columnIndex + 1);
        expect(cell.value).toBe(row.cells[column.id].v);
        expect(cell.formula).toBeUndefined();
      }));
      const metadata = opened.getWorksheet("Sample metadata")!;
      expect(metadata.getCell("A1").value).toBe("Local synthetic sample");
      expect(metadata.getCell("B1").value).toBe("No live source, provider or approval verification");
      expect(metadata.getCell("D7").value).toBe("manual note");
      expect(metadata.getCell("F7").value).toBe("sample-claim");
      expect(metadata.getCell("G7").value).toBe("Unverified sample metadata");
      expect(rows).toEqual(current);
    }
    expect(SHEET.rows).toEqual(original);
  });

  it("accepts Excel boundaries, rejects lossy or incompatible input without changing rows, then recovers", async () => {
    const rows = structuredClone(SHEET.rows);
    for (const accepted of ["x".repeat(32_767), "row\n".repeat(253), "采购 😀\tapproved sample"]) {
      rows[0].cells.product.v = accepted;
      const opened = await reopen(rows);
      expect(opened.getWorksheet("Current table")!.getCell("B2").value).toBe(accepted);
    }
    for (const rejected of ["x".repeat(32_768), "row\n".repeat(254), "a\u0001b", "a\rb", "\uD800"]) {
      rows[0].cells.product.v = rejected;
      const snapshot = structuredClone(rows);
      await expect(buildMobileSampleWorkbook(SHEET, rows)).rejects.toThrow(/Row 1, Product/);
      expect(rows).toEqual(snapshot);
    }
    rows[0].cells.product.v = "Corrected sample value";
    expect((await reopen(rows)).getWorksheet("Current table")!.getCell("B2").value).toBe("Corrected sample value");
  });

  it("suppresses a completed serializer result when its table was closed or changed before dispatch", async () => {
    const workbook = await buildMobileSampleWorkbook(SHEET, structuredClone(SHEET.rows));
    const actualBytes = await workbook.xlsx.writeBuffer();
    let finish!: (bytes: typeof actualBytes) => void;
    vi.spyOn(workbook.xlsx, "writeBuffer").mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const createUrl = vi.fn();
    vi.stubGlobal("URL", class extends URL { static createObjectURL = createUrl; });
    try {
      const controller = new AbortController();
      const pending = downloadXlsxWorkbook(workbook, "current.xlsx", 3, controller.signal);
      controller.abort(new Error("Table changed before download"));
      finish(actualBytes);
      await expect(pending).rejects.toThrow("Table changed before download");
      expect(createUrl).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
