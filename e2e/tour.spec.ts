import { test, expect } from "./fixtures";

/**
 * Guided walkthrough (memory mode, no backend). Runs in real Chromium with a real viewport, so the
 * spotlight geometry is trustworthy here (unlike the headless preview, whose viewport can collapse).
 */
test.describe("guided tour (memory mode)", () => {
  test("auto-starts on first visit, spotlights real targets, skips + replays", async ({ page }) => {
    await page.goto("/?mode=memory");
    await page.evaluate(() => { try { localStorage.removeItem("noderoom:tour:v1"); } catch { /* ignore */ } });
    await page.getByTestId("start-demo-room").click();

    // Auto-starts on the centered welcome step. Scope text queries to the tour
    // card — the walkthrough dock (PR #52) also renders "01 - Welcome to
    // NodeRoom", which made an unscoped getByText a strict-mode collision.
    const tour = page.getByTestId("guided-tour");
    await expect(tour).toBeVisible();
    await expect(tour.getByText("Welcome to NodeRoom")).toBeVisible();
    await expect(tour.getByText("1 / 7")).toBeVisible();

    // Step 2 spotlights the left rail — assert the spotlight box overlaps the rail.
    await page.getByTestId("tour-next").click();
    const spot = page.locator(".r-tour-spot");
    await expect(spot).toBeVisible();
    const rail = await page.getByTestId("left-rail").boundingBox();
    const spotBox = await spot.boundingBox();
    expect(rail).not.toBeNull();
    expect(spotBox).not.toBeNull();
    expect(Math.abs(spotBox!.x - (rail!.x - 6))).toBeLessThan(8);
    expect(Math.abs(spotBox!.width - (rail!.width + 12))).toBeLessThan(8);

    // Step 3 is the Copilot step; copy advances.
    await page.getByTestId("tour-next").click();
    await expect(page.getByText("Ask Copilot")).toBeVisible();

    // Skip closes the tour and persists the seen-flag (no nag).
    await page.getByTestId("tour-skip").click();
    await expect(tour).toHaveCount(0);
    const seen = await page.evaluate(() => localStorage.getItem("noderoom:tour:v1"));
    expect(seen).toBe("done");

    // The "?" button replays it on demand.
    await page.getByTestId("room-settings-btn").click(); // guided tour moved into the settings panel
    await page.getByTestId("tour-button").click();
    await expect(page.getByTestId("guided-tour")).toBeVisible();
    await expect(page.getByTestId("guided-tour").getByText("1 / 7")).toBeVisible();
  });

  test("does NOT auto-start once the seen-flag is set", async ({ page }) => {
    await page.goto("/?mode=memory");
    await page.evaluate(() => { try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ } });
    await page.getByTestId("start-demo-room").click();
    await expect(page.getByTestId("public-chat-panel").getByTestId("chat-composer")).toBeVisible();
    await expect(page.getByTestId("guided-tour")).toHaveCount(0);
  });
});
