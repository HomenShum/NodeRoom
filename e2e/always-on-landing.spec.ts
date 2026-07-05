/**
 * Always-On Rooms — landing gallery ("Live public rooms" section on #story).
 *
 * Persona: a cold first-time visitor lands on the story page with NO backend
 * (?mode=memory pins HAS_CONVEX=false, like the other landing specs) and
 * scrolls to the public-rooms gallery. The section must render the three demo
 * rooms from src/alwayson/demoData.ts AO_CARDS exactly — names, pulse dots —
 * and be HONEST about what it is: the section carries data-ao-source="demo"
 * and every badge reads "demo", never "live" (specimen metrics must never be
 * presented as live liveness). The two card actions must really work:
 * "Open room" navigates to the public read-only room page (#rooms/<slug> →
 * data-testid="ao-room"), "Subscribe" opens the double-opt-in email modal
 * (data-testid="ao-subscribe-modal").
 *
 * Data is imported from the same module the component renders from, so a demo
 * dataset edit can never silently diverge from the assertions.
 */
import { test, expect } from "@playwright/test";
import { AO_CARDS } from "../src/alwayson/demoData";

test.describe("#story — Live public rooms gallery (memory mode)", () => {
  test.beforeEach(async ({ page }) => {
    // ?mode=memory pins HAS_CONVEX=false: the gallery must take the demo
    // fallback path deterministically, and stamp it as such.
    await page.goto("/?mode=memory#story");
    await page.getByTestId("ao-landing-cards").scrollIntoViewIfNeeded({ timeout: 30_000 });
  });

  test("memory mode renders exactly the three demo cards, stamped demo — never presented as live", async ({ page }) => {
    const section = page.getByTestId("ao-landing-cards");

    // HONEST STAMP: the whole section declares its data source on the DOM.
    await expect(section).toHaveAttribute("data-ao-source", "demo");

    // Exact card count — no invented rooms, no dropped rooms.
    expect(AO_CARDS.length).toBe(3);
    await expect(section.locator(".ao-card")).toHaveCount(AO_CARDS.length);

    for (const card of AO_CARDS) {
      const el = page.getByTestId(`ao-card-${card.slug}`);
      await expect(el).toBeVisible();
      // Exact name from the demo dataset (not a substring — no drift).
      await expect(el.locator(".nm")).toHaveText(card.name);
      // One-line scope + mono freshness/metric line are populated from data.
      await expect(el.locator(".desc")).toHaveText(card.desc);
      await expect(el.locator(".meta")).toContainText(card.updated);
      await expect(el.locator(".meta")).toContainText(card.metric);
      // HONEST BADGE: pulse dot kept, but the text says "demo" — a specimen
      // card must NEVER wear a "live" badge.
      await expect(el.locator(".live .d")).toBeVisible();
      await expect(el.locator(".live")).toHaveText("demo");
      await expect(el.locator(".live")).toHaveClass(/demo/);
    }

    // Negative: no card in the demo set claims live/failed/capped state, and
    // the section never leaks a card for a slug outside the dataset.
    await expect(section.locator(".ao-card .live", { hasText: /^live$/ })).toHaveCount(0);
    await expect(section.locator(".ao-card .ao-chip", { hasText: "paused" })).toHaveCount(0);
    await expect(section.locator(".ao-card .ao-chip.bad")).toHaveCount(0);
    await expect(section.locator(".ao-card .ao-chip.warn")).toHaveCount(0);
    const testids = await section.locator(".ao-card").evaluateAll((els) =>
      els.map((el) => el.getAttribute("data-testid")),
    );
    expect(testids.sort()).toEqual(AO_CARDS.map((c) => `ao-card-${c.slug}`).sort());
  });

  test("Open room → #rooms/expositio-pulse mounts the public room page; back; Subscribe opens the modal", async ({ page }) => {
    const pulseCard = page.getByTestId("ao-card-expositio-pulse");

    // Open room really navigates (hash route contract, RoomTour lazy-route style).
    await pulseCard.getByTestId("ao-card-open").click();
    await expect(page).toHaveURL(/#rooms\/expositio-pulse$/);
    await expect(page.getByTestId("ao-room")).toBeVisible({ timeout: 15_000 });
    // The landing section is gone — we actually left the story page.
    await expect(page.getByTestId("ao-landing-cards")).toHaveCount(0);

    // Browser back returns to the story landing with the gallery intact.
    await page.goBack();
    await expect(page.getByTestId("ao-landing-cards")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("ao-room")).toHaveCount(0);

    // Subscribe on the card opens the double-opt-in modal (no navigation).
    await pulseCard.scrollIntoViewIfNeeded();
    await pulseCard.getByTestId("ao-card-subscribe").click();
    await expect(page.getByTestId("ao-subscribe-modal")).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/#\/?story$/); // still on the landing — modal, not a route
  });
});
