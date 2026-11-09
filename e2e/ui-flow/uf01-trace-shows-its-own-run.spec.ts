import { test, expect, type Page } from "@playwright/test";

// A host verifies an agent's proposed edit using the run record, including when
// the desktop work surface is squeezed into a narrow window (not #mobile).
async function openRoomTrace(page: Page, blank: boolean) {
  await page.addInitScript(() => localStorage.setItem("noderoom:tour:v1", "done"));
  await page.route("**/*", (route) => {
    const host = new URL(route.request().url()).hostname;
    return ["localhost", "127.0.0.1", "[::1]"].includes(host) ? route.continue() : route.abort();
  });
  await page.goto(`/?mode=memory&surface=desktop&${blank ? "create=1" : "demo=1"}&name=Homen`);
  await page.getByText("Opening room", { exact: true }).first().waitFor({ state: "hidden", timeout: 120_000 });
  await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(2500);
  if (!blank) {
    await page.waitForFunction(() => typeof (window as Window & { __runConflictDrill?: unknown }).__runConflictDrill === "function");
    await page.evaluate(() => (window as Window & { __runConflictDrill: () => Promise<void> }).__runConflictDrill());
    await page.getByTestId("proposal-inline-approve").first().click();
  }
  // The tab strip is occluded in the current UI; use its supported palette action
  // with a real pointer click, never dispatchEvent on the hidden tab.
  await page.keyboard.press("Control+k");
  await page.getByTestId("command-palette-input").fill("Open Trace");
  await page.getByTestId("command-palette-item").filter({ hasText: "Open Trace" }).click();
  await expect(page.getByTestId("trace-surface")).toBeVisible();
  await page.waitForTimeout(2500);
}

for (const width of [1440, 390]) {
  test.describe(`host auditing a run at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 1440 ? 900 : 844 }, deviceScaleFactor: 1 });
    test.setTimeout(150_000);

    test("the newest run owns its title, count and conflict evidence; older runs remain selectable", async ({ page }) => {
      await openRoomTrace(page, false);
      const trace = page.getByTestId("trace-surface");
      const items = trace.getByTestId("trace-run-item");
      const newestTitle = (await items.first().locator(".r-tracevu-rec-title").innerText()).trim();
      const label = trace.locator(".trc-toolbar .trc-run b");
      expect(newestTitle.length).toBeGreaterThan(0);
      await expect(label).toHaveText(newestTitle);
      await expect(items.first()).toHaveAttribute("aria-pressed", "true");
      expect((await items.first().boundingBox())?.width ?? 0).toBeGreaterThan(0);
      const footerCount = (await trace.locator(".trc-foot").innerText()).match(/\b(\d+) spans\b/)?.[1];
      expect(footerCount).toBeDefined();
      await expect(trace.locator(".trc-cloud-head")).toContainText(`${footerCount} spans`);
      await expect(items.first().locator(".r-tracevu-rec-meta")).toContainText(`${footerCount} spans`);
      await expect(trace.getByTestId("trace-run-tree")).toContainText("semantic_conflict");
      await expect(trace.getByTestId("trace-run-tree")).toContainText("proposal_resolved");
      await expect(trace).not.toContainText(/Enrich rows 81-120|v246 → v247|42 events/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      // Sustained review: repeated selection must keep header and tree attached to
      // the same run, not leave stale labels or collapsed state from another run.
      for (let turn = 0; turn < 6; turn++) {
        const item = items.nth(turn % 2);
        await item.click();
        await expect(item).toHaveAttribute("aria-pressed", "true");
        await expect(label).toHaveText((await item.locator(".r-tracevu-rec-title").innerText()).trim());
        const count = (await trace.locator(".trc-foot").innerText()).match(/\b(\d+) spans\b/)?.[1];
        expect(count).toBeDefined();
        await expect(trace.locator(".trc-cloud-head")).toContainText(`${count} spans`);
        await expect(item.locator(".r-tracevu-rec-meta")).toContainText(`${count} spans`);
      }
      // Keyboard reviewers can reach and activate another run without a pointer.
      await items.first().focus();
      await page.keyboard.press("Space");
      await expect(items.first()).toHaveAttribute("aria-pressed", "true");
      await page.keyboard.press("Tab");
      await expect(items.nth(1)).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(items.nth(1)).toHaveAttribute("aria-pressed", "true");
    });

    test("a host with no agent run sees room activity without an invented version", async ({ page }) => {
      await openRoomTrace(page, true);
      const trace = page.getByTestId("trace-surface");
      await expect(trace.locator(".trc-toolbar .trc-run b")).toHaveText("Room activity");
      await expect(trace.locator(".trc-version-pill")).toHaveCount(0);
      await expect(trace).not.toContainText(/Enrich rows|42 events/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
    });
  });
}
