/**
 * Regression net for the two surfaces built this cycle — the #mobile (terra)
 * route and the #story live-interactable seven-layer StoryLab. Both run on the
 * in-browser engine (memory mode), so no backend/keys are needed.
 *
 * Run stably against any built server (the dev server reload-loops under
 * concurrent file churn):
 *   PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=https://noderoom.vercel.app \
 *     npx playwright test mobile-story-surfaces
 * (or point BASE_URL at a local `vite preview`).
 */
import { test, expect } from "@playwright/test";

test.describe("#story — seven layers are live-interactable (memory engine)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#story");
    await page.getByTestId("story-lab").scrollIntoViewIfNeeded({ timeout: 30_000 });
  });

  test("L4+L7 lease drill: lock blocks the agent, then smart-merges on release", async ({ page }) => {
    await page.getByTestId("story-lab-lease-run").click();
    await expect(page.getByTestId("story-lab-lease-ttl")).toBeVisible({ timeout: 15_000 });
    const steps = page.locator('[data-testid="story-lab-lease-steps"] .sl-step');
    await expect(steps).toHaveCount(4);
    await expect(page.locator('[data-testid="story-lab-lease-steps"] .sl-step.pass')).toHaveCount(4);
    // The lease really rejected NodeAgent's write (no clobber).
    await expect(page.getByTestId("story-lab-lease")).toContainText("reason:'locked'");
  });

  test("L6 semantic rebase: stale agent write → review proposal → approve re-applies at current version", async ({ page }) => {
    await page.getByTestId("story-lab-rebase-run").click();
    await expect(page.getByTestId("story-lab-rebase-proposal")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("story-lab-rebase")).toContainText("semantic_rebase");
    await page.getByTestId("story-lab-rebase-approve").click();
    const approved = page.getByTestId("story-lab-rebase-approved");
    await expect(approved).toBeVisible({ timeout: 15_000 });
    await expect(approved).toContainText("v3");
    await expect(page.getByTestId("story-lab-rebase-proposal")).toHaveCount(0);
  });

  test("L5 no-clobber: a stale-baseline write is rejected as conflict-as-data", async ({ page }) => {
    await page.locator('[data-testid="story-lab"] .sl-gridcard button.sl-btn.primary').first().click();
    const conflict = page.locator('[data-testid="story-lab"] .sl-conflict');
    await expect(conflict).toBeVisible({ timeout: 15_000 });
    await expect(conflict).toContainText(/rejected/i);
    // Editable variance cells exist (Layer 1 surface).
    await expect(page.locator('[data-testid="story-lab"] input.sl-edit').first()).toBeVisible();
  });

  test("honest non-memory layers + mobile evidence are labeled, not faked", async ({ page }) => {
    await expect(page.getByTestId("story-lab-l2l3")).toContainText(/live in the room/i);
    await expect(page.getByTestId("story-lab-l2l3")).toContainText("convex/presence.ts");
    await expect(page.getByTestId("story-lab-mobile-evidence")).toContainText("#mobile?demo=review");
  });
});

test.describe("#mobile — terra surface renders (memory mode)", () => {
  test("cream surface, live room name, Home sections, FAB, no skeleton leak", async ({ page }) => {
    await page.goto("/#mobile?mode=memory");
    const na = page.locator(".na-app");
    await expect(na).toBeVisible({ timeout: 30_000 });
    // terra cream page surface (#FBF4E7).
    await expect(na).toHaveCSS("background-color", "rgb(251, 244, 231)");
    await expect(page.locator(".na-roomsw .nm")).toHaveText("Q3 Diligence");
    await expect(page.locator(".na-kicker").filter({ hasText: "Recents" })).toBeVisible();
    // FAB lives in the dock (may sit below the phone fold) — assert presence, not visibility.
    await expect(page.locator(".na-fab-btn")).toHaveCount(1);
    // Skeletons are LIVE-hydration only — never in the offline sample.
    await expect(page.locator(".na-skel")).toHaveCount(0);
  });
});
