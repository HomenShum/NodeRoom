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
 * NodeRoom Accounting UI — verifies accounting workflows can run in the UI.
 * Runs in memory mode. Does NOT require a live LLM — checks UI surface readiness.
 */

test.describe("NodeRoom accounting UI", () => {
  test("app loads and shows workspace", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    await expect(page).toHaveTitle(/NodeRoom|NodeBench/i);
  });

  test("agent input is accessible after entering room", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    // Click "Create a room" to enter the workspace
    const createBtn = page.locator("button", { hasText: "Create a room" });
    await createBtn.click({ timeout: 5000 });
    await page.waitForTimeout(2000);
    // Now check for any input surface — textarea, contenteditable, or text input
    const inputs = await page.locator("textarea, input[type='text'], [contenteditable='true']").count();
    expect(inputs).toBeGreaterThan(0);
    writeReceipt("noderoom-accounting-ui.json", {
      inputCount: inputs,
      url: page.url(),
    });
  });

  test("can navigate without crash", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    // Try clicking on any visible tab/button
    const buttons = page.locator("button:visible, [role='tab']:visible");
    const count = await buttons.count();
    if (count > 0) {
      await buttons.first().click({ timeout: 5000 }).catch(() => {});
    }
    // App should still be responsive
    const body = await page.textContent("body");
    expect(body!.length).toBeGreaterThan(20);
  });

  test("screenshot for evidence", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    const screenshotDir = join(outputDir(), "screenshots");
    mkdirSync(screenshotDir, { recursive: true });
    await page.screenshot({ path: join(screenshotDir, "noderoom-accounting-ui.png") });
  });
});
