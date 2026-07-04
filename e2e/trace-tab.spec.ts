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
    await shot.scrollIntoViewIfNeeded();
    await expect(shot).toBeVisible();
    // Real PNG (not a broken/empty src). Poll: the img is loading="lazy", so it can be laid out
    // (visible) before its bytes decode — under full-suite load that decode lags. The guarantee is
    // "it actually loads", not "loaded synchronously".
    await expect.poll(async () => shot.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 10_000 }).toBeGreaterThan(0);
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
    // A filmstrip previews every frame; screenshots carry a highlight box on the acted-on region.
    await expect(page.getByTestId("trace-filmstrip")).toBeVisible();
    await expect(page.locator(".r-tracevu-box").first()).toBeVisible();
  });

  test("captured bundles: a live web source is screenshotted + boxed, and an agent run shows every tool call", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    await page.getByTestId("trace-tab").click();
    expect(await page.getByTestId("trace-record").count()).toBeGreaterThanOrEqual(5);

    // (a) web-source retrieval: the live page is screenshotted with a highlight box on the retrieved value.
    await page.getByTestId("trace-record").filter({ hasText: "Web retrieval" }).first().click();
    await page.getByTestId("trace-tab-steps").click();
    await expect(page.locator(".r-tracevu-box").first()).toBeVisible();

    // (b) agent run: every tool call is a step (read_range / edit_cell / locks), grouped by phase.
    await page.getByTestId("trace-record").filter({ hasText: "Agent run" }).first().click();
    await page.getByTestId("trace-tab-steps").click();
    await expect(page.getByTestId("trace-step").filter({ hasText: "read_range" }).first()).toBeVisible();
  });

  test("3-entity ledger consolidation fails golden-reference verify (67%) → not shippable, queues fixes", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    await page.getByTestId("trace-tab").click();
    await page.getByTestId("trace-record").filter({ hasText: "ledger consolidation" }).first().click();
    await expect(page.getByText("Shippable without review? NO", { exact: false }).first()).toBeVisible();

    await page.getByTestId("trace-tab-steps").click();
    await expect(page.getByTestId("trace-step").filter({ hasText: "mis-keyed entry" }).first()).toBeVisible();
    await expect(page.getByTestId("trace-step").filter({ hasText: "COGS variance" }).first()).toBeVisible();
  });

  test("Flow tab renders the workflow progression as a graph (nodes + edges), node → step detail", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    await page.getByTestId("trace-tab").click();
    await page.getByTestId("trace-record").filter({ hasText: "ledger consolidation" }).first().click();
    await page.getByTestId("trace-tab-flow").click();

    await expect(page.getByTestId("trace-flow")).toBeVisible();
    expect(await page.locator(".react-flow__node").count()).toBeGreaterThan(3);
    expect(await page.locator(".react-flow__edge").count()).toBeGreaterThan(0);
    // the count badge advertises scale (steps · phases) and the minimap/zoom controls are present
    await expect(page.locator(".r-tracevu-flowcount")).toBeVisible();
    await expect(page.locator(".react-flow__minimap")).toBeVisible();
    // clicking a graph node pops the SAME full step preview the Steps list renders (rich StepRow),
    // not just a label — proves "click → full view of that step's details".
    await page.locator(".react-flow__node").first().click();
    const detail = page.getByTestId("trace-flow-detail");
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId("trace-step")).toBeVisible();
    // and it can be dismissed
    await detail.getByRole("button", { name: "Close step detail" }).click();
    await expect(detail).toHaveCount(0);
  });

  test("Observability tab renders every selected trace as adapter-ready spans", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    await page.getByTestId("trace-tab").click();
    await page.getByTestId("trace-record").filter({ hasText: "QA" }).first().click();
    await page.getByTestId("trace-tab-observability").click();

    await expect(page.getByTestId("trace-observability")).toBeVisible();
    await expect(page.getByText("AgentPrism OTLP")).toBeVisible();
    await expect(page.getByText("react-o11y", { exact: true })).toBeVisible();
    await expect(page.getByText("Langfuse JSON")).toBeVisible();
    await expect(page.getByText("assistant-ui events")).toBeVisible();
    await expect(page.getByTestId("trace-observability-count")).toHaveText(/4 spans/);
    await expect(page.getByTestId("trace-observability-span")).toHaveCount(4);
  });
});
