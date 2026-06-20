import { test, expect, enterDemoRoom } from "./fixtures";

/**
 * Center-stage split mode across the four canonical responsive bands
 * (docs/synthesis/specs/A_UI_SHELL.md — TARGET_2026_06 L91-96, L197).
 *
 * Split lets a primary Work Surface (e.g. the Q3 model) open a second reference surface
 * (proof / source / wiki) BESIDE it without leaving the center stage. It is a DESKTOP
 * affordance: at >=1200px the control is present and opens a side-by-side pane; below that
 * the stage is too narrow for two usable panes, so the control hides and the stage stays a
 * single surface — matching the canonical "<900 = single primary surface" intent.
 *
 * Self-contained in the Artifact panel: the left Binder and right Copilot are untouched.
 */
const BANDS = [
  { name: "desktop-1440", width: 1440, height: 900, splitAvailable: true },
  { name: "laptop-1280", width: 1280, height: 800, splitAvailable: true },
  { name: "workspace-1024", width: 1024, height: 768, splitAvailable: false },
  { name: "tablet-768", width: 768, height: 1024, splitAvailable: false },
] as const;

test.describe("center-stage split mode", () => {
  for (const band of BANDS) {
    test(`${band.name} — ${band.splitAvailable ? "split opens a second surface beside the primary" : "single surface, no split control"}`, async ({ page }) => {
      await page.setViewportSize({ width: band.width, height: band.height });
      await enterDemoRoom(page);

      const stage = page.getByTestId("work-surface");
      const primary = page.getByTestId("artifact-panel");
      const secondary = page.getByTestId("artifact-panel-secondary");
      const toggle = page.getByTestId("artifact-split-toggle");

      // The Work Surface is always present and starts as a single surface.
      await expect(primary).toBeVisible();
      await expect(stage).toHaveAttribute("data-split", "false");
      await expect(secondary).toHaveCount(0);

      if (!band.splitAvailable) {
        // Below 1200px the split control is not rendered and the stage stays single.
        await expect(toggle).toHaveCount(0);
        return;
      }

      // Desktop tier: control present and enabled (the seeded room has multiple artifacts).
      await expect(toggle).toBeVisible();
      await expect(toggle).toBeEnabled();
      await expect(toggle).toHaveAttribute("aria-pressed", "false");

      // Open: a second surface mounts beside the primary; both stay on the center stage.
      await toggle.click();
      await expect(stage).toHaveAttribute("data-split", "true");
      await expect(secondary).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("artifact-tabs-secondary")).toBeVisible();

      // Truly side by side: the secondary's left edge sits right of the primary's.
      const a = await primary.boundingBox();
      const b = await secondary.boundingBox();
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(b!.x).toBeGreaterThan(a!.x);

      // Close from the secondary pane: it unmounts, primary remains, stage collapses to single.
      await page.getByTestId("artifact-split-close").click();
      await expect(secondary).toHaveCount(0);
      await expect(primary).toBeVisible();
      await expect(stage).toHaveAttribute("data-split", "false");
    });
  }

  test("banker coach evidence opens its source beside the primary work surface", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    const stage = page.getByTestId("work-surface");
    const primary = page.getByTestId("artifact-panel");
    const secondary = page.getByTestId("artifact-panel-secondary");
    await page.getByTestId("copilot-tab-private").click();
    await page.getByTestId("private-mode-coach").click();
    const coach = page.getByTestId("banker-coach-panel");
    const sourceCard = coach.getByTestId("coach-evidence-card").filter({ hasText: "Agent wiki" });

    await expect(coach).toBeVisible();
    await expect(sourceCard).toBeVisible();
    await sourceCard.click();

    await expect(stage).toHaveAttribute("data-split", "true");
    await expect(primary).toBeVisible();
    await expect(secondary).toBeVisible();
    const a = await primary.boundingBox();
    const b = await secondary.boundingBox();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(b!.x).toBeGreaterThan(a!.x);
  });
});
