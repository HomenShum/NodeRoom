import { expect, test } from "@playwright/test";

test.describe("semantic entity graph", () => {
  test.use({ viewport: { width: 1456, height: 940 } });

  test("opens the semantic graph, filters, selects, persists a dragged node, and exports the canonical contract", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("noderoom:tour:v1", "done");
      localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: true, paused: false }));
    });
    await page.goto("/?mode=memory&surface=desktop&demo=1&name=Homen", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("graph-tab").dispatchEvent("click");

    const graph = page.getByTestId("knowledge-graph");
    await expect(graph).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => graph.locator(".react-flow__node").count()).toBeGreaterThanOrEqual(8);
    expect(await graph.locator(".react-flow__node").count()).toBeLessThanOrEqual(16);
    await expect(graph.getByTestId("entity-graph-semantic-controls")).toHaveCount(0);
    await expect(graph.getByTestId("graph-nodeagent-panel")).toHaveCount(0);
    await graph.getByRole("button", { name: "Open graph NodeAgent" }).click();
    await expect(graph.getByTestId("graph-nodeagent-panel")).toBeVisible();
    await graph.getByRole("button", { name: "Close graph NodeAgent" }).click();
    await graph.getByRole("button", { name: "Show advanced graph controls" }).click();
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
    await expect(graph.getByText("1 pinned", { exact: true })).toBeVisible();

    const storedLayout = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("noderoom:nodegraph:1:"));
      return key ? JSON.parse(localStorage.getItem(key) ?? "null") : null;
    });
    expect(storedLayout?.pinnedNodeIds).toHaveLength(1);
    expect(Object.keys(storedLayout?.positions ?? {})).toHaveLength(1);

    const [jsonDownload] = await Promise.all([
      page.waitForEvent("download"),
      graph.getByRole("button", { name: "JSON", exact: true }).click(),
    ]);
    expect(jsonDownload.suggestedFilename()).toMatch(/-nodegraph\.json$/);
    const [neo4jDownload] = await Promise.all([
      page.waitForEvent("download"),
      graph.getByRole("button", { name: "Neo4j", exact: true }).click(),
    ]);
    expect(neo4jDownload.suggestedFilename()).toMatch(/-neo4j-sync\.json$/);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("graph-tab").dispatchEvent("click");
    const restoredGraph = page.getByTestId("knowledge-graph");
    await restoredGraph.getByRole("button", { name: "Show advanced graph controls" }).click();
    await expect(restoredGraph.getByText("1 pinned", { exact: true })).toBeVisible({ timeout: 15_000 });
  });
});
