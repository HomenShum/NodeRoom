import { expect, test } from "@playwright/test";

test.describe("semantic entity graph", () => {
  test.use({ viewport: { width: 1456, height: 940 } });

  test("opens the semantic graph, filters, selects, closes detail, and drags a node", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("noderoom:tour:v1", "done");
      localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: true, paused: false }));
    });
    await page.goto("/?mode=memory&surface=desktop&demo=1&name=Homen", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("graph-tab").dispatchEvent("click");

    const graph = page.getByTestId("knowledge-graph");
    await expect(graph).toBeVisible({ timeout: 15_000 });
    await expect(graph.getByTestId("entity-graph-semantic-controls")).toBeVisible();
    await expect(graph.locator(".react-flow__minimap")).toBeVisible();

    const search = graph.locator(".r-graphvu-semsearch input");
    await search.fill("CardioNova");
    const cardioNode = graph.locator(".react-flow__node", { hasText: "CardioNova" }).first();
    await expect(cardioNode).toBeVisible({ timeout: 10_000 });

    await cardioNode.click();
    const detail = graph.getByTestId("entity-graph-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("CardioNova");
    await expect(detail).toContainText(/Evidence|Rows|People|Context/);

    await page.keyboard.press("Escape");
    await expect(graph.getByTestId("entity-graph-detail")).toHaveCount(0);

    const evidenceToggle = graph.locator(".r-graphvu-semtoggles button", { hasText: "Evidence" });
    await expect(evidenceToggle).toHaveAttribute("data-on", "false");
    await evidenceToggle.click();
    await expect(evidenceToggle).toHaveAttribute("data-on", "true");
    await expect(graph.locator(".react-flow__node").first()).toBeVisible();
    await evidenceToggle.click();

    await search.fill("Priya");
    const priyaNode = graph.locator(".react-flow__node", { hasText: "Priya" }).first();
    await expect(priyaNode).toBeVisible({ timeout: 10_000 });
    const before = await priyaNode.boundingBox();
    expect(before).toBeTruthy();
    await page.mouse.move(before!.x + before!.width / 2, before!.y + before!.height / 2);
    await page.mouse.down();
    await page.mouse.move(before!.x + before!.width / 2 + 45, before!.y + before!.height / 2 + 28, { steps: 8 });
    await page.mouse.up();
    const after = await priyaNode.boundingBox();
    expect(after).toBeTruthy();
    expect(Math.abs(after!.x - before!.x) + Math.abs(after!.y - before!.y)).toBeGreaterThan(10);
  });
});
