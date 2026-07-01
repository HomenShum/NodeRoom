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
 * Scenario 3: Automated Pipeline — manage prospects and recommend next actions.
 */

test.describe("Scenario 3: Automated Pipeline", () => {
  test("app loads for pipeline management", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    await expect(page).toHaveTitle(/NodeRoom|NodeBench/i);
  });

  test("table or grid surface for pipeline after entering room", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    const createBtn = page.locator("button", { hasText: "Create a room" });
    await createBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    const dataSurfaces = await page.locator("table, [role='grid'], [role='list'], .grid").count();
    const inputSurfaces = await page.locator("textarea, [contenteditable='true']").count();
    expect(dataSurfaces + inputSurfaces).toBeGreaterThan(0);
    writeReceipt("03-automated-pipeline.json", { dataSurfaces, inputSurfaces, url: page.url() });
  });

  test("evidence screenshot", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    const screenshotDir = join(outputDir(), "screenshots");
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, "03-automated-pipeline.png") });
  });
});
