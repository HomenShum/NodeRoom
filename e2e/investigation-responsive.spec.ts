import { test, expect } from "./fixtures";

const SHELL_SCENARIOS = [
  { name: "large-screen diligence shell", width: 1920, height: 1080 },
  { name: "wide diligence shell", width: 1280, height: 900 },
  { name: "split-panel diligence shell", width: 1024, height: 850 },
  { name: "compact tablet shell", width: 768, height: 900 },
  { name: "phone-width review shell", width: 390, height: 844 },
] as const;

function renderedColumnCount(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

for (const scenario of SHELL_SCENARIOS) {
  test(`Investigation container contract — ${scenario.name} (${scenario.width}px)`, async ({ page }) => {
    test.setTimeout(45_000);
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await page.addInitScript(() => {
      localStorage.setItem("noderoom:tour:v1", "done");
      localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: false, paused: false }));
    });
    await page.goto("/?mode=memory&surface=desktop&demo=INVESTIGATION&name=Analyst&focusMode=0", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("investigation-tab").click();

    const report = page.getByTestId("investigation-report");
    await expect(report).toBeVisible();
    await expect(page.getByTestId("research-plan-status")).toContainText(/Validated|Blocked/);

    const layout = await report.evaluate((root) => {
      const reportGrid = root.querySelector<HTMLElement>(".nr-investigation-report-grid");
      const metrics = root.querySelector<HTMLElement>(".nr-investigation-metrics");
      const firstMetric = metrics?.firstElementChild as HTMLElement | null;
      const lastMetric = metrics?.lastElementChild as HTMLElement | null;
      const hero = root.querySelector<HTMLElement>(".nr-investigation-hero");
      const rect = root.getBoundingClientRect();
      const rootStyle = getComputedStyle(root);
      return {
        viewportWidth: window.innerWidth,
        containerWidth: rect.width,
        containerName: rootStyle.containerName,
        containerType: rootStyle.containerType,
        gridColumns: reportGrid ? getComputedStyle(reportGrid).gridTemplateColumns : "",
        metricColumns: metrics ? getComputedStyle(metrics).gridTemplateColumns : "",
        firstMetricWidth: firstMetric?.getBoundingClientRect().width ?? 0,
        lastMetricWidth: lastMetric?.getBoundingClientRect().width ?? 0,
        lastMetricColumnEnd: lastMetric ? getComputedStyle(lastMetric).gridColumnEnd : "",
        heroDirection: hero ? getComputedStyle(hero).flexDirection : "",
        clientWidth: root.clientWidth,
        scrollWidth: root.scrollWidth,
      };
    });

    expect(layout.viewportWidth).toBe(scenario.width);
    expect(layout.containerName).toContain("investigation-surface");
    expect(layout.containerType).toBe("inline-size");
    expect(layout.scrollWidth, "Investigation content must stay inside its own shell container").toBeLessThanOrEqual(layout.clientWidth + 1);

    const compactReport = layout.containerWidth <= 820;
    expect(renderedColumnCount(layout.gridColumns), `report columns at a ${layout.containerWidth}px Investigation container`)
      .toBe(compactReport ? 1 : 2);
    expect(layout.heroDirection).toBe(compactReport ? "column" : "row");

    const expectedMetricColumns = layout.containerWidth <= 560 ? 2 : layout.containerWidth <= 820 ? 4 : 7;
    expect(renderedColumnCount(layout.metricColumns), `metric columns at a ${layout.containerWidth}px Investigation container`)
      .toBe(expectedMetricColumns);
    if (scenario.width === 1920) {
      expect(layout.containerWidth, "wide shell must exercise the desktop container branch").toBeGreaterThan(820);
      expect(renderedColumnCount(layout.gridColumns)).toBe(2);
      expect(renderedColumnCount(layout.metricColumns)).toBe(7);
    }
    if (scenario.width === 390) {
      expect(layout.containerWidth, "phone shell must exercise the narrow container branch").toBeLessThanOrEqual(560);
      expect(renderedColumnCount(layout.gridColumns)).toBe(1);
      expect(renderedColumnCount(layout.metricColumns)).toBe(2);
    }
    if (compactReport) {
      expect(layout.lastMetricColumnEnd).toBe("span 2");
      expect(layout.lastMetricWidth, "the seventh metric must fill the compact grid's final row")
        .toBeGreaterThan(layout.firstMetricWidth * 1.8);
    } else {
      expect(Math.abs(layout.lastMetricWidth - layout.firstMetricWidth)).toBeLessThanOrEqual(1);
    }

    const trustStatus = page.getByTestId("investigation-workspace-status");
    await expect(trustStatus).not.toHaveText("ready", { useInnerText: true });
    await expect(trustStatus).toContainText(/Plan|Research|Run|Evidence/);
    await expect(page.getByTestId("investigation-metric-collected-refs")).toContainText("Refs collected");
    await expect(page.getByTestId("investigation-metric-verified-refs")).toContainText("Refs verified");
    await expect(page.getByTestId("investigation-metric-supported-claims")).toContainText("Claims supported");

    const selectedTask = page.locator('[data-testid="analysis-task-run"][aria-pressed="true"]');
    await expect(selectedTask).toHaveCount(1);
    await expect(selectedTask).toHaveAttribute("aria-controls", "nr-investigation-run-detail");
    await expect(page.getByTestId("analysis-task-detail")).toHaveAttribute("aria-labelledby", await selectedTask.getAttribute("id") ?? "");

    const reportTab = page.getByRole("tab", { name: "Report" });
    const caseTab = page.getByRole("tab", { name: "Teaching case" });
    await expect(reportTab).toHaveAttribute("aria-controls", "nr-investigation-report-panel");
    await caseTab.click();
    await expect(caseTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("teaching-case")).toContainText("Guided teaching case");
  });
}
