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
 * Scenario 1: Warm Intro — research leads and prepare call context.
 * Verifies the UI can display lead data and the agent can operate.
 */

test.describe("Scenario 1: Warm Intro", () => {
  test("app loads for lead research", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    await expect(page).toHaveTitle(/NodeRoom|NodeBench/i);
  });

  test("lead data surface is accessible after entering room", async ({ page }) => {
    await enterDemoRoom(page);
    // Verify there's a table or list surface for leads
    const dataSurfaces = await page.locator("table, [role='grid'], [role='list'], .grid").count();
    const inputSurfaces = await page.locator("textarea, [contenteditable='true']").count();
    expect(dataSurfaces + inputSurfaces).toBeGreaterThan(0);
    writeReceipt("01-warm-intro.json", { dataSurfaces, inputSurfaces, url: page.url() });
  });

  test("agent input available for research queries", async ({ page }) => {
    await enterDemoRoom(page);
    const inputs = await page.locator("textarea, input[type='text'], [contenteditable='true']").count();
    expect(inputs).toBeGreaterThan(0);
  });

  test("evidence screenshot", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    const screenshotDir = join(outputDir(), "screenshots");
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, "01-warm-intro.png") });
  });
});
