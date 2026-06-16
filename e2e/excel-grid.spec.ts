/**
 * Excel-paper rendering of uploaded workbooks — the "it looks like the actual file" contract.
 *
 * Persona: a finance analyst uploads a styled model and must see Excel, not a themed table:
 * light paper, A1 headers, the FILE's number formats (33.7%, not 0.3374), bold/filled section
 * rows, a formula bar — while every edit still travels the lock/CAS path (the version bump in
 * the formula bar after an inline edit is the CAS receipt made visible).
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
  ws.getCell("B7").value = "Tier A ARR";
  ws.getCell("D7").value = { formula: 'SUMIF(B10:B12,"A",C10:C12)', result: 300 };
  ws.getCell("B8").value = "Cive ARR";
  ws.getCell("D8").value = { formula: 'VLOOKUP("Cive",A10:C12,3,FALSE)', result: 200 };
  ws.getCell("A10").value = "Acme";
  ws.getCell("B10").value = "A";
  ws.getCell("C10").value = 100;
  ws.getCell("A11").value = "Bolt";
  ws.getCell("B11").value = "B";
  ws.getCell("C11").value = 50;
  ws.getCell("A12").value = "Cive";
  ws.getCell("B12").value = "A";
  ws.getCell("C12").value = 200;
  const buffer = await workbook.xlsx.writeBuffer();
  const dir = mkdtempSync(join(tmpdir(), "noderoom-xl-"));
  const path = join(dir, "model.xlsx");
  writeFileSync(path, Buffer.from(buffer as ArrayBuffer));
  return path;
}

async function uploadAndOpenWorkbook(page: import("@playwright/test").Page): Promise<void> {
  const path = await styledWorkbookFile();
  await page.locator(".r-file-input").setInputFiles(path);
  await page.getByTestId("binder-artifact").filter({ hasText: "model.xlsx" }).first().click();
}

test("uploaded workbook renders as Excel paper with file formats, formula bar, and CAS edits", async ({ page }) => {
  await enterDemoRoom(page);

  await uploadAndOpenWorkbook(page);

  // 1. The paper surface + Excel chrome render.
  const paper = page.getByTestId("excel-paper");
  await expect(paper).toBeVisible();
  await expect(paper.locator("th.xl-col").first()).toHaveText("A");
  await expect(page.getByTestId("workbook-style-excel")).toHaveAttribute("aria-checked", "true");
  await page.getByTestId("workbook-style-sheets").click();
  await expect(paper).toHaveAttribute("data-workbook-style", "sheets");
  await page.getByTestId("workbook-style-evidence").click();
  await expect(paper).toHaveAttribute("data-workbook-style", "evidence");
  await expect(page.getByTestId("workbook-evidence-strip")).toContainText("no source");
  await page.getByTestId("workbook-style-excel").click();
  await expect(paper).toHaveAttribute("data-workbook-style", "excel");

  // 2. The FILE's number formats render — the strongest "it's the real file" signal.
  await expect(paper.locator('[data-cell-key="D4"]')).toHaveText("33.7%");
  await expect(paper.locator('[data-cell-key="D5"]')).toHaveText("65.8");

  // 3. The file's styles render: bold, the FILE's white font color, and the B2:D2 merge as a
  //    real spanned cell (C2/D2 are absorbed, not rendered as empty cells).
  const header = paper.locator('[data-cell-key="B2"]');
  await expect(header).toHaveText("INCOME STATEMENT");
  await expect(header).toHaveCSS("font-weight", "700");
  await expect(header).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(header).toHaveAttribute("colspan", "3");
  await expect(paper.locator('[data-cell-key="C2"]')).toHaveCount(0);
  await expect(paper.locator('[data-cell-key="D2"]')).toHaveCount(0);

  // 4. Selection drives the formula bar (Name box + value) and highlights headers.
  await paper.locator('[data-cell-key="D4"]').click();
  await expect(page.getByTestId("excel-namebox")).toHaveText("D4");
  await expect(page.getByTestId("excel-formulabar")).toContainText("0.3374");
  await expect(paper.locator("th.xl-col.hl")).toHaveText("D");

  // 5. An inline edit commits through CAS — the version visible in the bar is the receipt.
  const target = paper.locator('[data-cell-key="C5"]'); // empty in-bounds cell of the uploaded grid
  await target.dblclick();
  await target.locator("input.xl-input").fill("123");
  await target.locator("input.xl-input").press("Enter");
  await expect(paper.locator('[data-cell-key="C5"]')).toHaveText("123");
  await target.click();
  await expect(page.locator(".xl-meta")).toContainText("v2"); // seeded v1 -> CAS write -> v2

  await page.screenshot({ path: "test-results/excel-paper.png", fullPage: false });
});

test("spreadsheet keyboard model — arrows, type-to-replace, Enter/Tab moves, Escape, Delete", async ({ page }) => {
  await enterDemoRoom(page);
  await uploadAndOpenWorkbook(page);
  const paper = page.getByTestId("excel-paper");
  const namebox = page.getByTestId("excel-namebox");

  // Arrows move the selection (and the Name box follows).
  await paper.locator('[data-cell-key="B2"]').click();
  await expect(namebox).toHaveText("B2");
  await page.keyboard.press("ArrowDown");
  await expect(namebox).toHaveText("B3");
  await page.keyboard.press("ArrowRight");
  await expect(namebox).toHaveText("C3");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowLeft");
  await expect(namebox).toHaveText("B2");
  // Edge clamp: A1 stays A1.
  await paper.locator('[data-cell-key="A1"]').click();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowLeft");
  await expect(namebox).toHaveText("A1");

  // Type-to-replace: typing on a selected cell REPLACES content; Enter commits + moves DOWN.
  await paper.locator('[data-cell-key="C4"]').click();
  await page.keyboard.type("42");
  await expect(paper.locator('[data-cell-key="C4"] input.xl-input')).toHaveValue("42");
  await page.keyboard.press("Enter");
  await expect(paper.locator('[data-cell-key="C4"]')).toHaveText("42");
  await expect(namebox).toHaveText("C5"); // Enter moved the selection down

  // Tab while editing commits + moves RIGHT.
  await page.keyboard.type("7");
  await page.keyboard.press("Tab");
  await expect(paper.locator('[data-cell-key="C5"]')).toHaveText("7");
  await expect(namebox).toHaveText("D5");

  // Escape cancels: the draft never lands.
  await page.keyboard.type("999");
  await page.keyboard.press("Escape");
  await expect(paper.locator('[data-cell-key="D5"]')).not.toContainText("999");
  await expect(namebox).toHaveText("D5"); // selection retained

  // Delete clears a committed value without entering edit mode.
  await paper.locator('[data-cell-key="C4"]').click();
  await page.keyboard.press("Delete");
  await expect(paper.locator('[data-cell-key="C4"]')).not.toContainText("42");
  await expect(paper.locator('[data-cell-key="C4"] input.xl-input')).toHaveCount(0);

  // Enter on a selected cell opens the editor (Sheets model) with existing content.
  await paper.locator('[data-cell-key="B4"]').click();
  await page.keyboard.press("Enter");
  await expect(paper.locator('[data-cell-key="B4"] input.xl-input')).toHaveValue("Gross margin %");
  await page.keyboard.press("Escape");
});

test("spreadsheet range selection and fill-down rewrite values and formulas", async ({ page }) => {
  await enterDemoRoom(page);
  await uploadAndOpenWorkbook(page);
  const paper = page.getByTestId("excel-paper");
  const namebox = page.getByTestId("excel-namebox");

  await paper.locator('[data-cell-key="C6"]').click();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowDown");
  await expect(namebox).toHaveText("C6:C8");
  await expect(paper.locator('[data-cell-key="C7"]')).toHaveAttribute("data-in-range", "true");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+D" : "Control+D");
  await expect(paper.locator('[data-cell-key="C7"]')).toHaveText("10");
  await expect(paper.locator('[data-cell-key="C8"]')).toHaveText("10");

  await paper.locator('[data-cell-key="D6"]').click();
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press(process.platform === "darwin" ? "Meta+D" : "Control+D");
  await expect(paper.locator('[data-cell-key="D7"]')).toHaveText("20");
  await paper.locator('[data-cell-key="D7"]').click();
  await expect(page.getByTestId("excel-formulabar")).toHaveText("=C7*2");
});

test("uploaded workbook formulas display computed values, preserve formulas in edit mode, and recalc after driver edits", async ({ page }) => {
  await enterDemoRoom(page);
  await uploadAndOpenWorkbook(page);

  const paper = page.getByTestId("excel-paper");
  const driver = paper.locator('[data-cell-key="C6"]');
  const formula = paper.locator('[data-cell-key="D6"]');

  await expect(formula).toHaveText("20");
  await expect(paper.locator('[data-cell-key="D7"]')).toHaveText("300");
  await expect(paper.locator('[data-cell-key="D8"]')).toHaveText("200");
  await expect(formula).toHaveAttribute("data-has-formula", "true");
  await expect(paper.locator('[data-cell-key="D7"]')).toHaveAttribute("data-has-formula", "true");
  await expect(paper.locator('[data-cell-key="D8"]')).toHaveAttribute("data-has-formula", "true");
  await formula.click();
  await expect(page.getByTestId("excel-formulabar")).toHaveText("=C6*2");
  await paper.locator('[data-cell-key="D7"]').click();
  await expect(page.getByTestId("excel-formulabar")).toHaveText('=SUMIF(B10:B12,"A",C10:C12)');
  await paper.locator('[data-cell-key="D8"]').click();
  await expect(page.getByTestId("excel-formulabar")).toHaveText('=VLOOKUP("Cive",A10:C12,3,FALSE)');

  await formula.dblclick();
  await expect(formula.locator("input.xl-input")).toHaveValue("=C6*2");
  await page.keyboard.press("Escape");

  await driver.dblclick();
  await driver.locator("input.xl-input").fill("11");
  await driver.locator("input.xl-input").press("Enter");
  await expect(formula).toHaveText("22");

  const blank = paper.locator('[data-cell-key="C5"]');
  await blank.dblclick();
  await blank.locator("input.xl-input").fill("=D5*2");
  await blank.locator("input.xl-input").press("Enter");
  await expect(blank).toHaveText("131.6");
  await blank.click();
  await expect(page.getByTestId("excel-formulabar")).toHaveText("=D5*2");
});
