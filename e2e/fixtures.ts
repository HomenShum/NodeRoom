import { test as base, expect, type Page } from "@playwright/test";
import { enableFocusModeForTest, expectFocusModeOn } from "./focusMode";

/**
 * Shared E2E helpers. The default flow drives the app in MEMORY mode (no backend): the Landing's
 * "enter demo room" button (data-testid="start-demo-room") mounts the EngineStoreProvider over the
 * seeded demo room. We match the stable testid, not the button copy, so product wording can change
 * without breaking the harness.
 */
export async function enterDemoRoom(page: Page): Promise<void> {
  await enableFocusModeForTest(page);
  await page.goto("/?mode=memory&surface=desktop", { waitUntil: "domcontentloaded" });
  // Suppress the first-run guided tour for non-tour specs — its card would overlay the UI under test.
  // (The dedicated tour spec clears this flag to exercise auto-start.)
  await page.evaluate(() => {
    try {
      localStorage.setItem("noderoom:tour:v1", "done");
      localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: true, paused: false }));
    } catch { /* ignore */ }
  });
  const artifactPanel = page.getByTestId("artifact-panel");
  const alreadyInsideRoom = await artifactPanel.waitFor({ state: "visible", timeout: 1_000 }).then(() => true, () => false);
  if (!alreadyInsideRoom) {
    const enterButton = page.getByTestId("start-demo-room");
    await expect(enterButton).toBeVisible({ timeout: 10_000 });
    await enterButton.click();
  }
  // The Work Surface is the always-on anchor; Copilot may be closed on compact screens.
  await expect(artifactPanel).toBeVisible();
  await expectFocusModeOn(page);
  const width = page.viewportSize()?.width ?? 1280;
  if (width > 1199) {
    const leftRail = page.getByTestId("left-rail");
    if (!(await leftRail.isVisible().catch(() => false))) {
      const toggle = page.getByRole("button", { name: "Toggle Room Binder panel" });
      await expect(toggle).toBeVisible();
      await toggle.click();
    }
    await expect(leftRail).toBeVisible();
  }
}

/** The public chat lane in Copilot. Scopes selectors so the private agent lane never matches. */
export function publicChat(page: Page) {
  return page.getByTestId("public-chat-panel");
}

export const test = base;
export { expect };
