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
 * Scenario 2: Follow Up — draft a thoughtful follow-up from call notes.
 */

test.describe("Scenario 2: Follow Up", () => {
  test("app loads for follow-up drafting", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    await expect(page).toHaveTitle(/NodeRoom|NodeBench/i);
  });

  test("text input available for draft composition", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    const createBtn = page.locator("button", { hasText: "Create a room" });
    await createBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    const inputs = await page.locator("textarea, [contenteditable='true']").count();
    expect(inputs).toBeGreaterThan(0);
    writeReceipt("02-follow-up.json", { inputCount: inputs, url: page.url() });
  });

  test("evidence screenshot", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    const screenshotDir = join(outputDir(), "screenshots");
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, "02-follow-up.png") });
  });
});
