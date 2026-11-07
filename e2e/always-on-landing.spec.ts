/**
 * Always-On Rooms — landing gallery ("Live public rooms" section on #story).
 *
 * Persona: a first-time visitor scrolls the story page to the public-rooms
 * gallery. There are no specimen cards any more: without a backend the section
 * is not rendered at all; against a Convex-backed server with public rooms
 * seeded (PLAYWRIGHT_EXPECT_ALWAYS_ON_LIVE=1) it lists the real rooms and both
 * card actions work — "Open room" navigates to #rooms/<slug>, "Subscribe" opens
 * the double-opt-in modal without leaving the page.
 */
import { test, expect } from "@playwright/test";

test("no backend: the story page renders without a public-rooms gallery (no specimen cards)", async ({ page }) => {
  await page.goto("/?mode=memory#story");
  await page.getByTestId("story-lab").waitFor({ state: "attached", timeout: 30_000 });
  await expect(page.getByTestId("ao-landing-cards")).toHaveCount(0);
});

test.describe("#story — Live public rooms gallery (live)", () => {
  test.skip(process.env.PLAYWRIGHT_EXPECT_ALWAYS_ON_LIVE !== "1", "Requires a Convex-backed server with public rooms seeded.");

  test("Open room → #rooms/expositio-pulse mounts the public room page; back; Subscribe opens the modal", async ({ page }) => {
    await page.goto("/#story");
    const section = page.getByTestId("ao-landing-cards");
    await section.scrollIntoViewIfNeeded({ timeout: 30_000 });
    await expect(section).toHaveAttribute("data-ao-source", "live");
    const pulseCard = page.getByTestId("ao-card-expositio-pulse");

    await pulseCard.getByTestId("ao-card-open").click();
    await expect(page).toHaveURL(/#rooms\/expositio-pulse$/);
    await expect(page.getByTestId("ao-room")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("ao-landing-cards")).toHaveCount(0);

    await page.goBack();
    await expect(page.getByTestId("ao-landing-cards")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("ao-room")).toHaveCount(0);

    await pulseCard.scrollIntoViewIfNeeded();
    await pulseCard.getByTestId("ao-card-subscribe").click();
    await expect(page.getByTestId("ao-subscribe-modal")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/#\/?story$/);
  });
});
