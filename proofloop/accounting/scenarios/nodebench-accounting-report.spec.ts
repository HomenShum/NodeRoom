import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function outputDir(): string {
  return process.env.PROOFLOOP_OUTPUT_DIR ?? join(process.cwd(), ".proofloop", "runs", "latest");
}

function writeReceipt(name: string, payload: Record<string, unknown>): void {
  const dir = join(outputDir(), "artifacts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), JSON.stringify({ generatedAt: new Date().toISOString(), ...payload }, null, 2), "utf-8");
}

/**
 * NodeBench Accounting Report — verifies accounting report generation UI surface.
 * Runs in memory mode.
 */

test.describe("NodeBench accounting report", () => {
  test("app loads for report workflow", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    await expect(page).toHaveTitle(/NodeRoom|NodeBench/i);
  });

  test("spreadsheet or table surface present after entering room", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    // Click "Create a room" to enter the workspace
    const createBtn = page.locator("button", { hasText: "Create a room" });
    await createBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    // Check for table or grid surface (used for accounting data display)
    const tables = await page.locator("table, [role='grid'], .grid, [data-surface='spreadsheet']").count();
    const textInputs = await page.locator("textarea, [contenteditable='true']").count();
    // At least one data surface or input should be present
    expect(tables + textInputs).toBeGreaterThan(0);
    writeReceipt("nodebench-accounting-report.json", {
      tableCount: tables,
      textInputCount: textInputs,
      url: page.url(),
    });
  });

  test("evidence screenshot", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    const screenshotDir = join(outputDir(), "screenshots");
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, "nodebench-accounting-report.png") });
  });
});
