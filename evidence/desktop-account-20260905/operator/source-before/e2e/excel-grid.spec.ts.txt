/**
 * Shared Sheet 1 rendering for uploaded workbooks.
 *
 * Uploaded XLSX artifacts must not open a separate Excel-paper/chrome surface. They should hydrate
 * into the same work-surface grid that a fresh blank Sheet 1 uses, with A1 cell keys preserved so
 * nodeagent cell-write tools, focus boxes, traces, and visual judging all exercise one UI contract.
 */
import { test, expect } from "@playwright/test";
import ExcelJS from "exceljs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterDemoRoom } from "./fixtures";

async function styledWorkbookFile(): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Model");
  ws.getColumn(2).width = 26;
  ws.getCell("B2").value = "INCOME STATEMENT";
  ws.getCell("B2").font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getCell("B2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
  ws.mergeCells("B2:D2");
  ws.getCell("B4").value = "Gross margin %";
  ws.getCell("D4").value = 0.3374;
  ws.getCell("D4").numFmt = "0.0%";
  ws.getCell("B5").value = "EBIT";
  ws.getCell("D5").value = 65.8;
  ws.getCell("D5").numFmt = "#,##0.0";
  ws.getCell("B6").value = "Formula check";
  ws.getCell("C6").value = 10;
  ws.getCell("D6").value = { formula: "C6*2", result: 20 };
  ws.getCell("A10").value = "Acme";
  ws.getCell("B10").value = "A";
  ws.getCell("C10").value = 100;
  const buffer = await workbook.xlsx.writeBuffer();
  const dir = mkdtempSync(join(tmpdir(), "noderoom-xl-"));
  const path = join(dir, "model.xlsx");
  writeFileSync(path, Buffer.from(buffer as ArrayBuffer));
  return path;
}

async function uploadAndOpenWorkbook(page: import("@playwright/test").Page): Promise<void> {
  const path = await styledWorkbookFile();
  await page.locator(".r-file-input").setInputFiles(path);
  await page.getByTestId("binder-artifact").filter({ hasText: /model(?:\.xlsx)?|XLSX/i }).first().click();
}

async function blankWorkbookFile(): Promise<string> {
  // A deliberately plain 3×3 sheet (uniform short values → a column shares one width). Fresh rooms are
  // intentionally empty (App.tsx: they fill from chat / upload / the in-room CTA), so there is no
  // auto-seeded "Blank sheet"; uploading is the real path to get a sheet into a room.
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Blank");
  for (let r = 1; r <= 3; r++) for (const col of ["A", "B", "C"]) ws.getCell(`${col}${r}`).value = `${col}${r}`;
  const buffer = await workbook.xlsx.writeBuffer();
  const dir = mkdtempSync(join(tmpdir(), "noderoom-blank-"));
  const path = join(dir, "blank.xlsx");
  writeFileSync(path, Buffer.from(buffer as ArrayBuffer));
  return path;
}

async function createBlankSheet(page: import("@playwright/test").Page): Promise<void> {
  await enterDemoRoom(page);
  await page.locator(".r-file-input").setInputFiles(await blankWorkbookFile());
  await page.getByTestId("binder-artifact").filter({ hasText: /blank(?:\.xlsx)?|XLSX/i }).first().click();
  await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
}

test("an uploaded plain sheet renders as an aligned dark work-surface grid, not the Excel-paper UI", async ({ page }) => {
  await createBlankSheet(page);

  const grid = page.getByTestId("sheet-grid");
  await expect(page.getByTestId("excel-paper")).toHaveCount(0);
  await expect(grid.locator('table.r-sheet[data-sheet-kind="generic"]')).toBeVisible();
  await expect(grid.locator("table.r-generic-sheet")).toHaveCount(0);
  await expect(grid.locator("thead th").nth(1)).toHaveText("A");
  await expect(grid.locator('[data-cell-key="A1"]')).toHaveClass(/r-cell/);

  // Every cell in column A shares one width — the grid is aligned, not ragged (A1-notation keys).
  const aCellWidths = await grid.locator("td[data-cell-key]").evaluateAll((cells) =>
    cells
      .filter((cell) => /^A\d+$/.test(cell.getAttribute("data-cell-key") ?? ""))
      .map((cell) => Math.round(cell.getBoundingClientRect().width)),
  );
  expect(aCellWidths.length).toBeGreaterThan(1);
  expect(Math.max(...aCellWidths) - Math.min(...aCellWidths)).toBeLessThanOrEqual(1);
  await expect.poll(async () => {
    const headerAWidth = await grid.locator("thead th").nth(1).evaluate((cell) => Math.round(cell.getBoundingClientRect().width));
    const firstBodyAWidth = await grid.locator('[data-cell-key="A1"]').evaluate((cell) => Math.round(cell.getBoundingClientRect().width));
    return Math.abs(headerAWidth - firstBodyAWidth);
  }, { timeout: 5_000 }).toBeLessThanOrEqual(1);
});

test("uploaded workbook renders in the shared Sheet 1 grid, not the false Excel-paper UI", async ({ page }) => {
  await enterDemoRoom(page);
  await uploadAndOpenWorkbook(page);

  await expect(page.getByTestId("excel-paper")).toHaveCount(0);
  await expect(page.getByTestId("workbook-style-excel")).toHaveCount(0);
  await expect(page.getByTestId("excel-namebox")).toHaveCount(0);
  await expect(page.getByTestId("excel-formulabar")).toHaveCount(0);

  const grid = page.getByTestId("sheet-grid");
  await expect(grid).toBeVisible();
  await expect(grid.locator('table.r-sheet[data-sheet-kind="generic"]')).toBeVisible();
  await expect(grid.locator("table.r-generic-sheet")).toHaveCount(0);
  await expect(grid.getByTestId("sheet-cell").first()).toHaveClass(/r-cell/);
  await expect(grid.locator("thead th").nth(1)).toHaveText("A");

  const b2Value = grid.locator('[data-cell-key="B2"] .r-cell-value');
  await expect(b2Value).toBeVisible();
  await expect(b2Value).toHaveText("INCOME STATEMENT");
  const b2Color = await b2Value.evaluate((el) => getComputedStyle(el).color);
  expect(b2Color).not.toBe("rgba(0, 0, 0, 0)");
  expect(b2Color).not.toBe("transparent");
  await expect(grid.locator('[data-cell-key="B2"]')).toHaveAttribute("colspan", "3");
  await expect(grid.locator('[data-cell-key="C2"]')).toHaveCount(0);
  await expect(grid.locator('[data-cell-key="D2"]')).toHaveCount(0);
  await expect(grid.locator(".r-cell-meta")).toHaveCount(0);
  await expect(grid.locator("td.r-cell.evidence")).toHaveCount(0);
  await expect(grid.locator("td.r-cell.formula")).toHaveCount(0);
  await expect(grid.locator('[data-cell-key="D4"]')).toContainText("0.3374");
  await expect(grid.locator('[data-cell-key="D5"]')).toContainText("65.8");
  await expect(grid.locator('[data-cell-key="D6"]')).toContainText("20");
  await expect(grid.locator('[data-cell-key="D6"]')).toHaveAttribute("data-has-formula", "true");

  await grid.locator('[data-cell-key="D4"]').click();
  await expect(grid.locator("thead th.hl")).toHaveText("D");
  await expect(grid.locator("td.r-rownum.hl")).toHaveText("4");

  await page.screenshot({ path: "test-results/uploaded-workbook-shared-grid.png", fullPage: false });
});
