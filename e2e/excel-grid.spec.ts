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

async function createBlankSheet(page: import("@playwright/test").Page): Promise<void> {
  await page.addInitScript(() => {
    try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ }
  });
  await page.goto("/?mode=memory&create=BLANKGRID&name=QA", { waitUntil: "domcontentloaded" });
  await page.getByTestId("artifact-filetab").filter({ hasText: "Blank sheet" }).first().click({ timeout: 30_000 });
  await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
}

test("fresh blank sheet renders as an aligned dark work-surface grid", async ({ page }) => {
  await createBlankSheet(page);

  const grid = page.getByTestId("sheet-grid");
  await expect(page.getByTestId("excel-paper")).toHaveCount(0);
  await expect(grid.locator('table.r-sheet[data-sheet-kind="generic"]')).toBeVisible();
  await expect(grid.locator("table.r-generic-sheet")).toHaveCount(0);
  await expect(grid.locator("colgroup col")).toHaveCount(9);
  await expect(grid.locator('[data-cell-key="r1__A"]')).toHaveClass(/r-cell/);

  const aCellWidths = await grid.locator('[data-cell-key$="__A"]').evaluateAll((cells) =>
    cells.slice(0, 5).map((cell) => Math.round(cell.getBoundingClientRect().width)),
  );
  expect(Math.max(...aCellWidths) - Math.min(...aCellWidths)).toBeLessThanOrEqual(1);
  const headerAWidth = await grid.locator("thead th").nth(1).evaluate((cell) => Math.round(cell.getBoundingClientRect().width));
  expect(Math.abs(headerAWidth - aCellWidths[0])).toBeLessThanOrEqual(1);

  await grid.locator('[data-cell-key="r1__A"]').click();
  await expect(grid.locator("thead th.hl")).toHaveText("A");
  await expect(grid.locator("td.r-rownum.hl")).toHaveText("1");
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
