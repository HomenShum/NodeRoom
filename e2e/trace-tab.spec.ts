import { test, expect, enterDemoRoom } from "./fixtures";

/**
 * Trace work-surface tab — a banker audits provenance after agent work + a QA run.
 * The tab sits alongside the artifacts; it lists the live agent's source-backed claims and a real
 * QA run of our own app. Agent steps open the exact source cell; QA steps carry real screenshots.
 */
test.describe("trace work-surface tab", () => {
  test("lists agent + QA records; QA steps carry real screenshots", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    await page.getByTestId("trace-tab").click();
    await expect(page.getByTestId("trace-surface")).toBeVisible();
    expect(await page.getByTestId("trace-record").count()).toBeGreaterThanOrEqual(2);

    // The QA record's steps show the captured floor screenshots (real PNGs from /qa-trace).
    await page.getByTestId("trace-record").filter({ hasText: "QA" }).first().click();
    await page.getByTestId("trace-tab-steps").click();
    const shot = page.locator(".r-tracevu-shot").first();
    await expect(shot).toBeVisible();
    expect(await shot.evaluate((el) => (el as HTMLImageElement).naturalWidth > 0)).toBe(true);
  });

  test("an agent step opens its source cell on the work surface", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    await page.getByTestId("trace-tab").click();
    await page.getByTestId("trace-record").first().click(); // the live agent record
    await page.getByTestId("trace-tab-steps").click();

    // Source-linked steps render as buttons; clicking one leaves Trace and opens the artifact.
    const linked = page.locator("button[data-testid='trace-step']");
    expect(await linked.count()).toBeGreaterThan(0);
    await linked.first().click();
    await expect(page.getByTestId("trace-surface")).toHaveCount(0);
    await expect(page.getByTestId("artifact-panel")).toBeVisible();
  });

  test("a producer QA bundle renders grouped steps with per-step frame-Δ (flicker) badges", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    await page.getByTestId("trace-tab").click();
    await page.getByTestId("trace-record").filter({ hasText: "walkthrough" }).first().click();
    await page.getByTestId("trace-tab-steps").click();
    // Steps are grouped (collapsible) and carry a frame-Δ flicker signal — the QA-automation pipeline.
    await expect(page.getByTestId("trace-group").first()).toBeVisible();
    await expect(page.locator(".r-tracevu-ssim").first()).toBeVisible();
  });
});
