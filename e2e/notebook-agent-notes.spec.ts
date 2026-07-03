import { test, expect, enterDemoRoom } from "./fixtures";

async function openNoteSurface(page: import("@playwright/test").Page) {
  const editor = page.getByTestId("note-editor");
  if (!(await editor.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false))) {
    const leftRail = page.getByTestId("left-rail");
    if (!(await leftRail.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Toggle Room Binder panel" }).click();
    }
    const noteArtifact = page
      .getByTestId("left-rail")
      .getByTestId("binder-artifact")
      .filter({ hasText: /Capture Notebook|Note|Diligence memo/i })
      .first();
    await noteArtifact.click({ force: true });
  }
  await expect(page.getByTestId("note-editor")).toBeVisible({ timeout: 20_000 });
}

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page, width: number) {
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, "agent notes should not create horizontal overflow").toBeLessThanOrEqual(width + 1);
}

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 375, height: 812 },
  { name: "narrow-mobile", width: 320, height: 812 },
] as const) {
  test(`agent notebook notes render provenance safely - ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await enterDemoRoom(page);
    await openNoteSurface(page);

    const seeded = await page.evaluate(() => (window as any).__seedAgentNotes?.([
      '<h2 data-agent-root="true" data-author-kind="agent">Agent notes</h2>',
      '<h3 data-blockid="e2e-heading" data-author-kind="agent" data-run-id="e2e">Browser proof</h3>',
      '<ul><li data-blockid="e2e-claim" data-author-kind="agent" data-run-id="e2e" data-status="needs_review">Unsupported claim needs review</li></ul>',
      '<img src=x onerror="window.__agentNotesXss=1">',
      '<script>window.__agentNotesXss=1</script>',
    ].join("\n")));
    expect(seeded).toBeTruthy();

    const notes = page.getByTestId("agent-notes-block");
    await expect(notes).toBeVisible({ timeout: 10_000 });
    await expect(notes).toContainText("NodeRoom");
    await expect(notes).toContainText("Browser proof");
    await expect(notes).toContainText("Unsupported claim needs review");
    await expect(notes.locator('[data-blockid="e2e-heading"]')).toBeVisible();
    await expect(notes.locator('[data-blockid="e2e-claim"][data-author-kind="agent"][data-status="needs_review"]')).toBeVisible();

    const xssRan = await page.evaluate(() => (window as any).__agentNotesXss === 1);
    expect(xssRan).toBe(false);
    await expect(notes.locator("script, img")).toHaveCount(0);

    const claimStyles = await notes.locator('[data-blockid="e2e-claim"]').evaluate((el) => {
      const style = getComputedStyle(el as HTMLElement);
      const after = getComputedStyle(el as HTMLElement, "::after");
      return {
        borderLeftWidth: style.borderLeftWidth,
        borderLeftStyle: style.borderLeftStyle,
        afterContent: after.content,
      };
    });
    expect(claimStyles.borderLeftStyle).toBe("solid");
    expect(claimStyles.borderLeftWidth).toBe("2px");
    expect(claimStyles.afterContent).toContain("needs review");

    await expectNoHorizontalOverflow(page, viewport.width);
  });
}
