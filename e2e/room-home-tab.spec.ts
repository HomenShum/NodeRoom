import { test, expect, enterDemoRoom } from "./fixtures";

/**
 * Persistent Home tab — the Room Home command center is a pinned, non-closeable pseudo-tab on the
 * primary Work Surface (mirrors the Trace tab). In a POPULATED room it is reachable at any time and
 * lists the room's FULL artifact inventory (a superset of the open file tabs), so a user can jump
 * back to any artifact — not just the ones already open as tabs.
 *
 * Scenario: a banker has several artifacts open as tabs, returns to Home to find an artifact that is
 * NOT currently in a tab (e.g. "Runway / milestones"), and dives into it from the inventory.
 */
test.describe("persistent Home tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);
  });

  test("Home tab is pinned, opens the command center with the full inventory, and dives into a non-open artifact", async ({ page }) => {
    const homeTab = page.getByTestId("home-tab");
    const homeSurface = page.getByTestId("room-home-surface");
    const fileTabs = page.getByTestId("artifact-filetab");

    // Home is always present on the primary surface, and starts inactive (an artifact is shown first).
    await expect(homeTab).toBeVisible();
    await expect(homeTab).toHaveAttribute("data-active", "false");
    await expect(homeSurface).toHaveCount(0);

    // The names already open as file tabs (a subset of the room).
    const openTabNames = (await fileTabs.allInnerTexts()).map((t) => t.trim());
    expect(openTabNames.length).toBeGreaterThan(0);

    // Open Home → the embedded command center renders with command bar + inventory.
    await homeTab.click();
    await expect(homeTab).toHaveAttribute("data-active", "true");
    await expect(homeSurface).toBeVisible();
    await expect(page.getByTestId("room-command-bar")).toBeVisible();

    const invItems = page.getByTestId("room-home-artifact");
    const invCount = await invItems.count();
    // The inventory is the full room — at least as many as the open tabs, and here strictly more.
    expect(invCount).toBeGreaterThanOrEqual(openTabNames.length);

    // Find an inventory artifact that is NOT already an open tab and dive into it.
    const invNames: string[] = [];
    for (let i = 0; i < invCount; i++) {
      invNames.push((await invItems.nth(i).locator(".r-room-inv-title").innerText()).trim());
    }
    const closedArtifact = invNames.find((n) => !openTabNames.includes(n));
    expect(closedArtifact, "demo room should have an artifact not yet open as a tab").toBeTruthy();

    await invItems.filter({ hasText: closedArtifact! }).first().click();

    // Home closes; the chosen artifact opens as a new ACTIVE file tab.
    await expect(homeSurface).toHaveCount(0);
    await expect(homeTab).toHaveAttribute("data-active", "false");
    const newTab = fileTabs.filter({ hasText: closedArtifact! }).first();
    await expect(newTab).toBeVisible();
    await expect(newTab).toHaveAttribute("data-active", "true");
  });

  test("Home and Trace are mutually exclusive pinned tabs", async ({ page }) => {
    const homeTab = page.getByTestId("home-tab");
    const traceTab = page.getByTestId("trace-tab");

    await homeTab.click();
    await expect(homeTab).toHaveAttribute("data-active", "true");
    await expect(traceTab).toHaveAttribute("data-active", "false");

    await traceTab.click();
    await expect(traceTab).toHaveAttribute("data-active", "true");
    await expect(homeTab).toHaveAttribute("data-active", "false");
    await expect(page.getByTestId("room-home-surface")).toHaveCount(0);
  });
});
