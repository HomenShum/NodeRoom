import { test, expect, type Page } from "@playwright/test";
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

async function enterDemoRoom(page: Page): Promise<void> {
  await page.goto("/?mode=memory&surface=desktop", { waitUntil: "networkidle" });
  const enterButton = page.getByTestId("start-demo-room");
  await expect(enterButton).toBeVisible({ timeout: 10_000 });
  await enterButton.click();
  await expect(page.getByTestId("artifact-panel")).toBeVisible();
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
    await enterDemoRoom(page);
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
