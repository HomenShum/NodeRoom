import { enterDemoRoom, expect, test } from "./fixtures";

async function openRoomTrace(page: Parameters<typeof enterDemoRoom>[0]) {
  const trace = page.getByTestId("room-trace");
  if ((await trace.getAttribute("data-open")) !== "true") {
    const expandTrace = page.getByRole("button", { name: "Expand room trace" });
    await expect(expandTrace).toHaveCount(1);
    await expandTrace.click();
    await expect(trace).toHaveAttribute("data-open", "true");
  }
  return trace;
}

test("semantic rebase conflict drill is visible, reviewable, and applies only after host approval", async ({ page }) => {
  await enterDemoRoom(page);

  await page.getByTestId("left-rail").getByRole("button", { name: /Q3 variance/ }).click();
  const panel = page.getByTestId("artifact-panel");
  await expect(panel.locator('[data-cell-key="r_rev__variance"]')).toBeVisible();
  await page.evaluate(() => (window as any).__runConflictDrill());

  const revenueVariance = panel.locator('[data-cell-key="r_rev__variance"]');
  const semanticChip = revenueVariance.locator('[data-testid="proposal-inline"][data-semantic="true"]');

  await expect(semanticChip).toBeVisible({ timeout: 15_000 });
  await expect(semanticChip).toContainText("+19%");
  await expect(revenueVariance).toContainText("+24%");

  const semanticCard = panel.locator('[data-testid="proposal-card"][data-semantic="true"]').first();
  await expect(semanticCard).toBeVisible();
  await expect(semanticCard.getByTestId("semantic-proposal-meta")).toContainText("Semantic rebase");
  let trace = await openRoomTrace(page);
  await expect(trace).toContainText("Semantic rebase opened");

  await semanticChip.getByTestId("proposal-inline-approve").click();

  await expect(revenueVariance.locator('[data-testid="proposal-inline"]')).toHaveCount(0);
  await expect(revenueVariance).toContainText("+19%");
  trace = await openRoomTrace(page);
  await expect(trace).toContainText("approved");
});
