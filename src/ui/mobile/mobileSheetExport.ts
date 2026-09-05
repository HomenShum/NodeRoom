import type { Sheet, SheetRow } from "./mobileData";

// Excel's documented cell limits. UTF-16 length is a conservative bound for supplementary characters.
// https://support.microsoft.com/en-us/excel/excel-specifications-and-limits
function workbookText(value: string, location: string): string {
  if (value.length > 32_767) {
    throw new Error(`${location} exceeds Excel's 32,767-character limit. Shorten it before exporting; nothing was truncated.`);
  }
  if ((value.match(/\n/g) ?? []).length > 253) {
    throw new Error(`${location} exceeds Excel's 253-line-feed limit. Reduce its line breaks before exporting.`);
  }
  // The installed serializer drops XML controls, normalizes CR and replaces lone surrogates.
  if (/[\u0000-\u0008\u000B-\u001F\uFFFE\uFFFF]|\p{Surrogate}/u.test(value)) {
    throw new Error(`${location} contains text XLSX cannot preserve exactly. Remove unsupported control characters or use line feeds, then retry.`);
  }
  return value;
}

/** Export this displayed local table, without borrowing a desktop artifact or claiming verified sources. */
export async function buildMobileSampleWorkbook(sheet: Sheet, rows: SheetRow[]) {
  const values = [
    sheet.columns.map((column) => workbookText(column.label, "Column label")),
    ...rows.map((row, index) => sheet.columns.map((column) =>
      workbookText(row.cells[column.id].v, `Row ${index + 1}, ${column.label}`))),
  ];
  const metadata = rows.flatMap((row, index) => sheet.columns.map((column) => {
    const cell = row.cells[column.id];
    return [row.id, column.label, cell.v, cell.status ?? "not recorded", cell.tone ?? "not recorded", cell.claim ?? "", "Unverified sample metadata"]
      .map((value) => workbookText(value, `Metadata for row ${index + 1}, ${column.label}`));
  }));
  const title = workbookText(sheet.title, "Table title");
  const id = workbookText(sheet.id, "Table identity");
  const ExcelJSModule = await import("exceljs");
  const ExcelJS = ExcelJSModule.default ?? ExcelJSModule;
  const workbook = new ExcelJS.Workbook();
  const table = workbook.addWorksheet("Current table");
  // Assign strings directly: identifiers, formula-like text and leading zeros stay literal.
  values.forEach((row) => table.addRow(row));
  const context = workbook.addWorksheet("Sample metadata");
  context.addRow(["Local synthetic sample", "No live source, provider or approval verification"]);
  context.addRow(["Table", title, "Local table ID", id]);
  context.addRow(["Lifetime", "Edits reset when the sheet closes or the page reloads."]);
  context.addRow(["Claim references", "Recorded sample labels only; no verified evidence or historical workbook is implied."]);
  context.addRow([]);
  context.addRow(["Row ID", "Column", "Current value", "Recorded status", "Recorded tone", "Sample claim reference", "Verification"]);
  metadata.forEach((row) => context.addRow(row));
  return workbook;
}
