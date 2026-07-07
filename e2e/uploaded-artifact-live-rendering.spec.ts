/**
 * Fresh-room live upload/render proof.
 *
 * The memory-mode sheet-grid spec proves parser + renderer behavior. This spec proves the production
 * path the user actually sees: browser upload -> Convex file storage/register -> createArtifact ->
 * api.artifacts.elements hydration -> shared Sheet 1-style grid rendering.
 */
import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { writeFileSync } from "node:fs";
import { enableFocusModeForTest, expectAttentionOverlayMounted, expectFocusModeOn } from "./focusMode";
import { expectLiveStarterRoomReady } from "./liveStarter";

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

function largePdfPayload(): { name: string; mimeType: string; buffer: Buffer } {
  const pdf = Buffer.from([
    "%PDF-1.4",
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 160] /Contents 4 0 R >> endobj",
    "4 0 obj << /Length 44 >> stream",
    "BT /F1 12 Tf 30 100 Td (Large PDF preview proof) Tj ET",
    "endstream endobj",
    "xref",
    "0 5",
    "0000000000 65535 f ",
    "trailer << /Size 5 /Root 1 0 R >>",
    "startxref",
    "0",
    "%%EOF",
    "",
  ].join("\n"), "utf8");
  return {
    name: "large-source-preview-proof.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.concat([pdf, Buffer.alloc(3_200_000, 0x20)]),
  };
}

async function createFreshLiveRoom(page: Page): Promise<void> {
  await enableFocusModeForTest(page);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  expect(page.url(), "live upload proof must not run in memory mode").not.toContain("mode=memory");
  await page.getByTestId("create-room").click({ timeout: 60_000 });
  await page.getByTestId("create-room-submit").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("create-room-submit").click();
  await expectLiveStarterRoomReady(page);
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 30_000 });
  await expectFocusModeOn(page);
  await expectAttentionOverlayMounted(page);
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

  await expect(page.getByTestId("excel-paper")).toHaveCount(0);
  const grid = page.getByTestId("sheet-grid");
  await expect(grid).toBeVisible({ timeout: 45_000 });
  await expect(grid.locator('table.r-sheet[data-sheet-kind="generic"]')).toBeVisible();
  await expect(grid.locator("table.r-generic-sheet")).toHaveCount(0);
  const b2Value = grid.locator('[data-cell-key="B2"] .r-cell-value');
  await expect(b2Value).toBeVisible();
  await expect(b2Value).toHaveText("INCOME STATEMENT");
  const b2Color = await b2Value.evaluate((el) => getComputedStyle(el).color);
  expect(b2Color).not.toBe("rgba(0, 0, 0, 0)");
  expect(b2Color).not.toBe("transparent");
  await expect(grid.locator('[data-testid="sheet-cell"][data-cell-key="B2"][data-element-id="B2"]')).toHaveClass(/r-cell/);
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
  await expect(grid.locator('[data-cell-key="A10"]')).toContainText("Acme");
  await expect(grid.locator('[data-cell-key="B10"]')).toContainText("A");
  await expect(grid.locator('[data-cell-key="C10"]')).toContainText("100");

  await grid.locator('[data-cell-key="D6"]').click();
  await expect(grid.locator("thead th.hl")).toHaveText("D");
  await page.waitForTimeout(500);

  const screenshotPath = testInfo.outputPath("uploaded-artifact-live-render.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const receipt = {
    baseUrl: BASE,
    roomUrl: page.url(),
    uploadedFile: payload.name,
    assertions: {
      sharedSheetGridVisible: true,
      excelPaperVisible: false,
      cells: {
        B2: "INCOME STATEMENT",
        D4: "0.3374",
        D5: "65.8",
        D6: "20",
        A10: "Acme",
        B10: "A",
        C10: "100",
      },
      formulaCellMarked: true,
    },
    pageErrors,
    screenshotPath,
  };
  const receiptPath = testInfo.outputPath("uploaded-artifact-live-render.json");
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await testInfo.attach("uploaded-artifact-live-render", { path: receiptPath, contentType: "application/json" });

  expect(pageErrors).toEqual([]);
});

test("fresh live room renders large uploaded PDFs from Convex storage URLs", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err.message ?? err)));

  await createFreshLiveRoom(page);
  await ensureBinderOpen(page);

  const payload = largePdfPayload();
  await page.locator(".r-file-input").setInputFiles(payload);
  const displayTitle = payload.name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ");
  const binderRow = page.getByTestId("binder-artifact").filter({ hasText: displayTitle }).first();
  await expect(binderRow).toBeVisible({ timeout: 60_000 });
  await binderRow.click();

  const pdfPreview = page.getByTestId("pdf-file-preview");
  await expect(pdfPreview).toBeVisible({ timeout: 60_000 });
  const pdfFrame = pdfPreview.locator("iframe.r-file-pdf");
  await expect(pdfFrame).toBeVisible();
  await expect(pdfFrame).toHaveAttribute("src", /https?:\/\/|blob:/);
  await expect(page.getByText("PDF source stored")).toHaveCount(0);
  await expect(page.getByText("Inline preview is only generated for PDFs under 3 MB")).toHaveCount(0);

  const screenshotPath = testInfo.outputPath("large-pdf-storage-preview.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const receipt = {
    baseUrl: BASE,
    roomUrl: page.url(),
    uploadedFile: payload.name,
    uploadedBytes: payload.buffer.byteLength,
    assertions: {
      pdfFilePreviewVisible: true,
      storageBackedPreview: true,
      fallbackCopyAbsent: true,
    },
    pageErrors,
    screenshotPath,
  };
  const receiptPath = testInfo.outputPath("large-pdf-storage-preview.json");
  writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  await testInfo.attach("large-pdf-storage-preview", { path: receiptPath, contentType: "application/json" });

  expect(pageErrors).toEqual([]);
});
