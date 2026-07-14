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
 * Scenario 4: Meeting Prep — prepare executive discovery calls.
 */

test.describe("Scenario 4: Meeting Prep", () => {
  test("app loads for meeting prep", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    await expect(page).toHaveTitle(/NodeRoom|NodeBench/i);
  });

  test("agent input for research queries", async ({ page }) => {
    await enterDemoRoom(page);
    const inputs = await page.locator("textarea, input[type='text'], [contenteditable='true']").count();
    expect(inputs).toBeGreaterThan(0);
    writeReceipt("04-meeting-prep.json", { inputCount: inputs, url: page.url() });
  });

  test("evidence screenshot", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    const screenshotDir = join(outputDir(), "screenshots");
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, "04-meeting-prep.png") });
  });
});
