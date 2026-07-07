import { test, expect, type Page } from "@playwright/test";
import ExcelJS from "exceljs";
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { enterDemoRoom } from "../../../e2e/fixtures";

const INPUT_FILES = [
  "bank_statement.csv",
  "general_ledger.csv",
  "prior_month_recon.xlsx",
  "close_policy.pdf",
] as const;

const EXPECTED = {
  bankEndingBalance: 14866,
  depositsInTransit: 2500,
  outstandingGlItems: -125,
  adjustedBankBalance: 17241,
  bookEndingBalance: 17276,
  bankFeeJe: -35,
  adjustedBookBalance: 17241,
  unreconciledDifference: 0,
  exceptionRows: 4,
  journalEntryRows: 2,
};

function outputDir(): string {
  return process.env.PROOFLOOP_OUTPUT_DIR ?? join(process.cwd(), ".proofloop", "runs", "latest");
}

function artifactsDir(): string {
  const dir = join(outputDir(), "artifacts");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function screenshotsDir(): string {
  const dir = join(outputDir(), "screenshots");
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function createFrA1Files(): Promise<string[]> {
  const dir = mkdtempSync(join(tmpdir(), "noderoom-fr-a1-"));

  writeFileSync(
    join(dir, "bank_statement.csv"),
    [
      "date,description,amount,reference",
      "2026-05-31,Opening balance,12000,OPEN",
      "2026-06-01,Client payment,5000,ACH-155",
      "2026-06-05,Office rent,-2000,CHK-104",
      "2026-06-12,Software subscription,-99,CARD-88",
      "2026-06-18,Bank fee,-35,FEE-06",
    ].join("\n"),
    "utf8",
  );

  writeFileSync(
    join(dir, "general_ledger.csv"),
    [
      "date,description,amount,account",
      "2026-05-31,Opening balance,12000,Cash",
      "2026-06-01,Client payment,5000,Cash",
      "2026-06-05,Office rent,-2000,Cash",
      "2026-06-10,Software subscription,-99,Cash",
      "2026-06-20,Customer refund,-125,Cash",
      "2026-06-29,Deposit in transit,2500,Cash",
    ].join("\n"),
    "utf8",
  );

  const prior = new ExcelJS.Workbook();
  const priorSheet = prior.addWorksheet("May close");
  priorSheet.addRows([
    ["prior_month", "bank_ending", "book_ending", "unreconciled_difference"],
    ["2026-05", 12000, 12000, 0],
  ]);
  await prior.xlsx.writeFile(join(dir, "prior_month_recon.xlsx"));

  writeFileSync(
    join(dir, "close_policy.pdf"),
    [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Count 1 /Kids [3 0 R] >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R >> endobj",
      "4 0 obj << /Length 77 >> stream",
      "BT /F1 12 Tf 24 100 Td (Close policy: identify timing differences and post bank fees.) Tj ET",
      "endstream endobj",
      "xref 0 5",
      "0000000000 65535 f ",
      "trailer << /Root 1 0 R >>",
      "%%EOF",
    ].join("\n"),
    "utf8",
  );

  const template = new ExcelJS.Workbook();
  const recon = template.addWorksheet("Reconciliation");
  recon.addRows([
    ["Metric", "Amount", "Evidence"],
    ["Bank ending balance", "", "bank_statement.csv"],
    ["Deposits in transit", "", "general_ledger.csv row 6"],
    ["Outstanding GL items", "", "general_ledger.csv row 5"],
    ["Adjusted bank balance", "", "bank + reconciling items"],
    ["Book ending balance", "", "general_ledger.csv"],
    ["Bank fee JE", "", "bank_statement.csv row 5"],
    ["Adjusted book balance", "", "book after JE"],
    ["Unreconciled difference", "", "adjusted bank vs adjusted book"],
  ]);
  template.addWorksheet("Exceptions").addRows([
    ["Type", "Description", "Amount", "Evidence"],
    ["pending", "pending", "pending", "pending"],
    ["pending", "pending", "pending", "pending"],
    ["pending", "pending", "pending", "pending"],
    ["pending", "pending", "pending", "pending"],
  ]);
  template.addWorksheet("JEs").addRows([
    ["Account", "Debit", "Credit", "Evidence"],
    ["pending", "pending", "pending", "pending"],
    ["pending", "pending", "pending", "pending"],
  ]);
  template.addWorksheet("Memo").addRows([["Close memo"]]);
  await template.xlsx.writeFile(join(dir, "reconciliation.xlsx"));

  return [
    join(dir, "bank_statement.csv"),
    join(dir, "general_ledger.csv"),
    join(dir, "prior_month_recon.xlsx"),
    join(dir, "close_policy.pdf"),
    join(dir, "reconciliation.xlsx"),
  ];
}

async function openWorkbookSheet(page: Page, sheetName: string): Promise<void> {
  const artifactTitle = `reconciliation.xlsx / ${sheetName}`;
  const artifact = page
    .locator(`[data-testid="binder-artifact"][data-artifact-title=${JSON.stringify(artifactTitle)}]`)
    .first();
  await expect(artifact).toBeVisible({ timeout: 30_000 });
  await artifact.click();
  await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 30_000 });
}

async function editCell(page: Page, key: string, value: string | number): Promise<void> {
  const text = String(value);
  const cell = page.locator(`[data-cell-key="${key}"]`).first();
  await expect(cell, `cell ${key}`).toBeVisible({ timeout: 30_000 });
  await cell.dblclick();
  const editor = page.getByTestId("cell-editor");
  await expect(editor).toBeVisible({ timeout: 10_000 });
  await editor.fill(text);
  await editor.press("Enter");
  await expect(cell.locator(".r-cell-value"), `cell ${key} committed`).toHaveText(text, { timeout: 10_000 });
}

function cellValue(sheet: ExcelJS.Worksheet, address: string): string | number {
  const value = sheet.getCell(address).value;
  if (value && typeof value === "object" && "result" in value) {
    return String((value as { result?: unknown }).result ?? "");
  }
  return typeof value === "number" ? value : String(value ?? "");
}

function numericCell(sheet: ExcelJS.Worksheet, address: string): number {
  const raw = cellValue(sheet, address);
  const value = typeof raw === "number" ? raw : Number(String(raw).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(value)) throw new Error(`Cell ${sheet.name}!${address} is not numeric: ${String(raw)}`);
  return value;
}

test("FR-A1 fresh accounting packet: upload sources -> fill workpaper -> export/reopen workbook", async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  await enterDemoRoom(page);
  const files = await createFrA1Files();
  await page.locator(".r-file-input").setInputFiles(files);
  const uploadLabels = [
    /bank\s*statement\s*CSV/i,
    /general\s*ledger\s*CSV/i,
    /prior\s*month\s*recon\s*XLSX/i,
    /close\s*policy\s*PDF/i,
    /reconciliation\s*XLSX/i,
  ];
  for (const label of uploadLabels) {
    await expect(page.getByTestId("binder-artifact").filter({ hasText: label }).first()).toBeVisible({ timeout: 30_000 });
  }

  await openWorkbookSheet(page, "Reconciliation");
  await editCell(page, "B2", EXPECTED.bankEndingBalance);
  await editCell(page, "B3", EXPECTED.depositsInTransit);
  await editCell(page, "B4", EXPECTED.outstandingGlItems);
  await editCell(page, "B5", EXPECTED.adjustedBankBalance);
  await editCell(page, "B6", EXPECTED.bookEndingBalance);
  await editCell(page, "B7", EXPECTED.bankFeeJe);
  await editCell(page, "B8", EXPECTED.adjustedBookBalance);
  await editCell(page, "B9", EXPECTED.unreconciledDifference);

  await openWorkbookSheet(page, "Exceptions");
  const exceptions = [
    ["Timing", "Software subscription cleared two days after GL date", -99, "GL 2026-06-10 vs bank 2026-06-12"],
    ["Bank only", "Bank fee requires adjusting JE", -35, "bank_statement.csv FEE-06"],
    ["Ledger only", "Customer refund outstanding at month-end", -125, "general_ledger.csv"],
    ["Ledger only", "Deposit in transit", 2500, "general_ledger.csv"],
  ];
  for (let i = 0; i < exceptions.length; i++) {
    const row = i + 2;
    await editCell(page, `A${row}`, exceptions[i][0]);
    await editCell(page, `B${row}`, exceptions[i][1]);
    await editCell(page, `C${row}`, exceptions[i][2]);
    await editCell(page, `D${row}`, exceptions[i][3]);
  }

  await openWorkbookSheet(page, "JEs");
  await editCell(page, "A2", "Bank fees expense");
  await editCell(page, "B2", 35);
  await editCell(page, "C2", 0);
  await editCell(page, "D2", "close_policy.pdf requires posting bank fees");
  await editCell(page, "A3", "Cash");
  await editCell(page, "B3", 0);
  await editCell(page, "C3", 35);
  await editCell(page, "D3", "bank_statement.csv FEE-06");

  await openWorkbookSheet(page, "Memo");
  await editCell(
    page,
    "A1",
    "FR-A1 close memo: bank_statement.csv, general_ledger.csv, prior_month_recon.xlsx, and close_policy.pdf tie to adjusted cash of 17,241 with zero unreconciled difference.",
  );

  await openWorkbookSheet(page, "Reconciliation");
  const screenshotPath = join(screenshotsDir(), "fr-a1-bank-reconciliation.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach("fr-a1-bank-reconciliation", { path: screenshotPath, contentType: "image/png" });

  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByTestId("artifact-export-xlsx").click();
  const download = await downloadPromise;
  const workbookPath = join(artifactsDir(), "fr-a1-reconciliation.export.xlsx");
  await download.saveAs(workbookPath);
  await testInfo.attach("fr-a1-exported-workbook", {
    path: workbookPath,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

  const exportedBytes = readFileSync(workbookPath);
  const magic = `${String.fromCharCode(exportedBytes[0] ?? 0)}${String.fromCharCode(exportedBytes[1] ?? 0)}`;
  expect(magic).toBe("PK");
  expect(statSync(workbookPath).size).toBeGreaterThan(0);

  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.readFile(workbookPath);
  const sheets = reopened.worksheets.map((sheet) => sheet.name);
  expect(sheets).toEqual(["Reconciliation", "Exceptions", "JEs", "Memo"]);

  const recon = reopened.getWorksheet("Reconciliation");
  const exc = reopened.getWorksheet("Exceptions");
  const jes = reopened.getWorksheet("JEs");
  const memo = reopened.getWorksheet("Memo");
  expect(recon).toBeTruthy();
  expect(exc).toBeTruthy();
  expect(jes).toBeTruthy();
  expect(memo).toBeTruthy();

  const checks = {
    adjustedBankBalance: numericCell(recon!, "B5") === EXPECTED.adjustedBankBalance,
    adjustedBookBalance: numericCell(recon!, "B8") === EXPECTED.adjustedBookBalance,
    unreconciledDifference: numericCell(recon!, "B9") === EXPECTED.unreconciledDifference,
    exceptionRows: exc!.actualRowCount - 1 === EXPECTED.exceptionRows,
    journalEntryRows: jes!.actualRowCount - 1 === EXPECTED.journalEntryRows,
    memoEvidence: String(cellValue(memo!, "A1")).includes("close_policy.pdf"),
  };
  const passed = Object.values(checks).every(Boolean);

  const receipt = {
    schema: 1,
    caseId: "FR-A1",
    generatedAt: new Date().toISOString(),
    memoryMode: true,
    uploadedFiles: [...INPUT_FILES, "reconciliation.xlsx"],
    outputWorkbook: {
      filename: download.suggestedFilename(),
      path: workbookPath,
      bytes: statSync(workbookPath).size,
      magic,
    },
    reopenedWorkbook: {
      sheets,
      checks,
      expected: EXPECTED,
    },
    screenshotPath,
    scorer: {
      name: "fr-a1-reopen-workbook-scorer",
      verdict: passed ? "pass" : "fail",
      score: Object.values(checks).filter(Boolean).length / Object.keys(checks).length,
    },
    passed,
  };
  writeFileSync(join(artifactsDir(), "fr-a1-bank-reconciliation.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

  expect(passed, JSON.stringify(checks)).toBe(true);
});
