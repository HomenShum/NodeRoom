/**
 * Fresh-room live upload/render proof.
 *
 * The memory-mode Excel-grid spec proves parser + renderer behavior. This spec proves the production
 * path the user actually sees: browser upload -> Convex file storage/register -> createArtifact ->
 * api.artifacts.elements hydration -> ExcelGridSheet rendering.
 */
import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";

const BASE = process.env.BENCH_BASE_URL ?? "https://noderoom.live";

async function workbookPayload(): Promise<{ name: string; mimeType: string; buffer: Buffer }> {
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
  return {
    name: "live-render-model.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(buffer as ArrayBuffer),
  };
}

async function createFreshLiveRoom(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  expect(page.url(), "live upload proof must not run in memory mode").not.toContain("mode=memory");
  await page.getByTestId("create-room").click({ timeout: 60_000 });
  await page.getByTestId("create-room-submit").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("create-room-submit").click();
  await page.getByTestId("blank-cta-sheet").click({ timeout: 60_000 });
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 30_000 });
}

async function ensureBinderOpen(page: Page): Promise<void> {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click({ timeout: 30_000 });
  }
  await expect(leftRail).toBeVisible({ timeout: 30_000 });
}

test("fresh live room renders uploaded XLSX data through Convex-backed artifact elements", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err.message ?? err)));

  await createFreshLiveRoom(page);
  await ensureBinderOpen(page);

  const payload = await workbookPayload();
  await page.locator(".r-file-input").setInputFiles(payload);
  const binderRow = page.getByTestId("binder-artifact").filter({ hasText: payload.name }).first();
  await expect(binderRow).toBeVisible({ timeout: 45_000 });
  await binderRow.click();

  const paper = page.getByTestId("excel-paper");
  await expect(paper).toBeVisible({ timeout: 45_000 });
  await expect(paper.locator("table.r-sheet.r-generic-sheet")).toBeVisible();
  await expect(paper.locator('[data-testid="sheet-cell"][data-cell-key="B2"][data-element-id="B2"]')).toHaveText("INCOME STATEMENT");
  await expect(paper.locator('[data-testid="sheet-cell"][data-cell-key="B2"][data-element-id="B2"]')).toHaveClass(/r-cell/);
  await expect(paper.locator('[data-testid="sheet-cell"][data-cell-key="B2"][data-element-id="B2"]')).toHaveAttribute("colspan", "3");
  await expect(paper.locator('[data-cell-key="D4"]')).toHaveText("33.7%");
  await expect(paper.locator('[data-cell-key="D5"]')).toHaveText("65.8");
  await expect(paper.locator('[data-cell-key="D6"]')).toHaveText("20");
  await expect(paper.locator('[data-cell-key="A10"]')).toHaveText("Acme");
  await expect(paper.locator('[data-cell-key="B10"]')).toHaveText("A");
  await expect(paper.locator('[data-cell-key="C10"]')).toHaveText("100");

  await paper.locator('[data-cell-key="D6"]').click();
  await expect(page.getByTestId("excel-namebox")).toHaveText("D6");
  await expect(page.getByTestId("excel-formulabar")).toHaveText("=C6*2");

  const screenshotPath = testInfo.outputPath("uploaded-artifact-live-render.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const receipt = {
    baseUrl: BASE,
    roomUrl: page.url(),
    uploadedFile: payload.name,
    assertions: {
      excelPaperVisible: true,
      cells: {
        B2: "INCOME STATEMENT",
        D4: "33.7%",
        D5: "65.8",
        D6: "20",
        A10: "Acme",
        B10: "A",
        C10: "100",
      },
      formulaBar: "=C6*2",
    },
    pageErrors,
    screenshotPath,
  };
  const receiptPath = testInfo.outputPath("uploaded-artifact-live-render.json");
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await testInfo.attach("uploaded-artifact-live-render", { path: receiptPath, contentType: "application/json" });

  expect(pageErrors).toEqual([]);
});
