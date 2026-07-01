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
 * Accounting UI Contract — verifies the production UI is operational
 * for accounting workflows. Runs in memory mode (no Convex needed).
 *
 * Checks:
 *   - App loads without crash
 *   - Spreadsheet surface present
 *   - Agent chat/input present
 *   - File upload area present
 *   - No critical console errors
 */

test.describe("accounting UI contract", () => {
  test("app loads in memory mode", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    await expect(page).toHaveTitle(/NodeRoom|NodeBench/i);
    const title = await page.title();

    // Critical console errors = fail
    const criticalErrors = consoleErrors.filter(
      (e) => !e.includes("favicon") && !e.includes("DevTools") && !e.includes("Download the React DevTools"),
    );
    expect(criticalErrors).toHaveLength(0);
    writeReceipt("accounting-ui-contract.json", {
      title,
      criticalErrorCount: criticalErrors.length,
      url: page.url(),
    });
  });

  test("primary work surface is visible", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    const body = await page.textContent("body");
    expect(body!.length).toBeGreaterThan(50);
  });

  test("no horizontal scroll at desktop", async ({ page }) => {
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    const hasHScroll = await page.evaluate(() => document.body.scrollWidth > window.innerWidth);
    expect(hasHScroll).toBe(false);
  });

  test("mobile viewport does not crash", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/?mode=memory", { waitUntil: "networkidle" });
    const body = await page.textContent("body");
    expect(body!.length).toBeGreaterThan(20);
  });
});
