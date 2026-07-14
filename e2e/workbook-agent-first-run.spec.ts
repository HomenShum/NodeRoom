import { test, expect, enterDemoRoom, publicChat } from "./fixtures";

test.describe("fresh-user workbook audit", () => {
  test("runs NodeAgent from Home, repairs the active workbook, and shows the verification receipt", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    const varianceTab = page.getByTestId("artifact-filetab").filter({ hasText: "Q3 variance" }).first();
    await expect(varianceTab).toBeVisible();
    await varianceTab.click();
    await expect(page.locator('[data-element-id="r_rev__variance"]').first()).toBeVisible();

    await page.getByTestId("home-tab").click();
    await expect(page.getByTestId("room-home-surface")).toBeVisible();
    await expect(page.getByTestId("room-audit-workbook")).toBeVisible();
    await page.getByTestId("room-audit-workbook").click();
    await expect(page.getByTestId("room-command-bar")).toHaveValue(/audit this workbook/i);
    await page.getByTestId("room-command-send").click();

    await expect(page.getByTestId("room-command-status")).toContainText(/NodeAgent is working|Sent to NodeAgent/);
    await expect(publicChat(page).getByTestId("chat-message").filter({ hasText: "audit this workbook" }).last()).toBeVisible();
    await expect(publicChat(page).getByTestId("chat-message").filter({ hasText: "passed post-write verification" }).last()).toBeVisible({ timeout: 15_000 });

    await varianceTab.click();
    await expect(page.locator('[data-element-id="r_rev__variance"]').first()).toContainText("+24%");
    await expect(page.locator('[data-element-id="r_cogs__variance"]').first()).toContainText("+27.5%");
    await expect(page.locator('[data-element-id="r_gp__variance"]').first()).toContainText("+21.7%");
    await expect(page.locator('[data-element-id="r_ni__variance"]').first()).toContainText("+22.4%");
  });
});
