import { test, expect, enterDemoRoom } from "./fixtures";

test("status click-through opens and pulses the referenced spreadsheet cell", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await enterDemoRoom(page);
  await page.getByTestId("left-rail").getByRole("button", { name: /Q3 variance/ }).click();
  await expect(page.locator('[data-cell-key="r_rev__variance"]')).toBeVisible({ timeout: 10_000 });

  await page.evaluate(() => (window as any).__runCollab());
  const statusOpen = page.getByTestId("status-open");
  await expect(statusOpen).toBeVisible({ timeout: 10_000 });

  await statusOpen.click();
  const changedCell = page.locator('[data-cell-key="r_rev__variance"]');
  await expect(changedCell).toBeVisible();
  await expect.poll(() => changedCell.evaluate((node) => (node as HTMLElement).style.boxShadow)).toContain("var(--accent-primary)");
});
