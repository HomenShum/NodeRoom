import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, publicChat } from "./fixtures";
import type { Page } from "@playwright/test";

const OUTPUT_ROOT = join(".proofloop", "proofs", "visual-parity");
const VIEWPORTS = [
  { id: "desktop-1456x940", width: 1456, height: 940 },
  { id: "compact-1180x800", width: 1180, height: 800 },
  { id: "tablet-820x1180", width: 820, height: 1180 },
  { id: "phone-390x844", width: 390, height: 844 },
] as const;

test.describe.configure({ mode: "serial" });

async function capture(page: Page, viewportId: string, surface: string): Promise<string> {
  const directory = join(OUTPUT_ROOT, viewportId);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${surface}.png`);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  await page.waitForTimeout(650);
  await page.screenshot({ path, fullPage: false });
  const rootMetrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollHeight: document.documentElement.scrollHeight,
    scrollX: window.scrollX,
    scrollY: window.scrollY,
  }));
  expect(rootMetrics.scrollWidth, `${surface} must not overflow the viewport`).toBeLessThanOrEqual(rootMetrics.clientWidth + 1);
  expect(rootMetrics.scrollX, `${surface} must remain at the horizontal page origin`).toBe(0);
  expect(rootMetrics.scrollY, `${surface} must remain at the vertical page origin`).toBe(0);
  return path.replaceAll("\\", "/");
}

async function captureElement(page: Page, viewportId: string, surface: string, testId: string): Promise<string> {
  const directory = join(OUTPUT_ROOT, viewportId);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${surface}.png`);
  const element = page.getByTestId(testId);
  await expect(element).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  await page.waitForTimeout(650);
  await element.screenshot({ path });
  return path.replaceAll("\\", "/");
}

async function frameWorkbench(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).evaluate((element) => {
    const panel = element.closest<HTMLElement>('[data-testid="work-artifacts-panel"]');
    if (panel) {
      const elementTop = element.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
      panel.scrollTop = Math.max(0, elementTop - 8);
    }
    window.scrollTo(0, 0);
  });
}

async function resetSurfaceFrame(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll<HTMLElement>('[data-testid="work-artifacts-panel"]').forEach((panel) => {
      panel.scrollTop = 0;
    });
  });
}

async function showWorkSurface(page: Page): Promise<void> {
  const artifact = page.getByTestId("artifact-panel");
  if (await artifact.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Toggle Work Surface panel" }).click();
  await expect(artifact).toBeVisible();
}

async function showChat(page: Page): Promise<void> {
  const chat = publicChat(page);
  if (await chat.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: "Toggle Copilot panel" }).click();
  await expect(chat).toBeVisible();
}

async function enterVisualDemoRoom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("noderoom:tour:v1", "done");
    localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: false, paused: false }));
  });
  await page.goto("/?mode=memory&surface=desktop&demo=1&name=Homen", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 20_000 });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
    `,
  });
}

async function openFileTab(page: Page, title: string): Promise<void> {
  const direct = page.getByTestId("artifact-filetab").filter({ hasText: title }).first();
  if (await direct.count()) {
    await direct.dispatchEvent("click");
    return;
  }
  await page.getByTestId("artifact-tabs").getByLabel("All open tabs").click();
  const overflowItem = page.locator(".r-tab-overflow-menu .r-tab-overflow-item").filter({ hasText: title }).first();
  await expect(overflowItem).toBeVisible();
  await overflowItem.click();
}

for (const viewport of VIEWPORTS) {
  test(`completion visual matrix - ${viewport.id}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    await enterVisualDemoRoom(page);
    const screenshots: string[] = [];

    await showWorkSurface(page);
    await openFileTab(page, "Q3 variance");
    await expect(page.getByTestId("artifact-panel").locator(".r-sheet")).toBeVisible();
    screenshots.push(await capture(page, viewport.id, "spreadsheet"));

    await openFileTab(page, "Capture Notebook");
    await expect(page.getByTestId("notebook-paper-frame")).toBeVisible();
    screenshots.push(await capture(page, viewport.id, "notebook-editor"));

    await page.getByTestId("work-artifacts-tab").dispatchEvent("click");
    const artifactsPanel = page.getByTestId("work-artifacts-panel");
    await expect(artifactsPanel).toBeVisible();
    const exactNotebookRow = artifactsPanel.locator('[data-testid="work-artifact-row"][data-kind="notebook"]').first();
    await expect(exactNotebookRow).toBeVisible();
    await exactNotebookRow.locator("button").first().click();
    const notebookWorkbench = page.getByTestId("notebook-digest-workbench");
    await expect(notebookWorkbench).toBeVisible();
    await expect(page.getByTestId("notebook-execution-preview")).toBeVisible();
    await frameWorkbench(page, "notebook-digest-workbench");
    screenshots.push(await capture(page, viewport.id, "notebook-kernel"));

    await page.getByRole("button", { name: "Close notebook digest" }).click();
    const deckRow = artifactsPanel.locator('[data-testid="work-artifact-row"][data-kind="deck"]').first();
    await expect(deckRow).toBeVisible();
    await deckRow.locator("button").first().click();
    const deckWorkbench = page.getByTestId("deck-storyboard-workbench");
    await expect(deckWorkbench).toBeVisible();
    await frameWorkbench(page, "deck-storyboard-workbench");
    screenshots.push(await capture(page, viewport.id, "deck"));

    await showWorkSurface(page);
    await page.getByTestId("graph-tab").dispatchEvent("click");
    await expect(page.getByTestId("knowledge-graph")).toBeVisible();
    await expect(page.getByTestId("entity-graph-semantic-controls")).toHaveCount(0);
    await expect(page.getByTestId("graph-nodeagent-panel")).toHaveCount(0);
    await page.waitForTimeout(700);
    await resetSurfaceFrame(page);
    screenshots.push(await capture(page, viewport.id, "graph"));
    await page.getByRole("button", { name: "Show advanced graph controls" }).click();
    await expect(page.getByTestId("entity-graph-semantic-controls")).toBeVisible();
    await page.waitForTimeout(1000);
    screenshots.push(await captureElement(page, viewport.id, "graph-controls", "knowledge-graph"));
    await page.getByRole("button", { name: "Hide advanced graph controls" }).click();
    await page.getByRole("button", { name: "Open graph NodeAgent" }).click();
    await expect(page.getByTestId("graph-nodeagent-panel")).toBeVisible();
    screenshots.push(await captureElement(page, viewport.id, "graph-agent", "graph-nodeagent-panel"));
    await page.getByRole("button", { name: "Close graph NodeAgent" }).click();

    await page.getByTestId("trace-tab").dispatchEvent("click");
    await expect(page.getByTestId("trace-surface")).toBeVisible();
    await expect(page.getByTestId("trace-tab")).toBeVisible();
    await expect(page.getByTestId("trace-tab")).toHaveAttribute("data-active", "true");
    await expect(page.getByRole("tree", { name: "Run spans" })).toBeVisible();
    await resetSurfaceFrame(page);
    screenshots.push(await capture(page, viewport.id, "trace"));

    await showChat(page);
    await expect(publicChat(page).getByTestId("chat-composer")).toBeVisible();
    await resetSurfaceFrame(page);
    screenshots.push(await capture(page, viewport.id, "chat"));

    const unexpectedErrors = consoleErrors.filter((message) => !/ResizeObserver loop|favicon/i.test(message));
    expect(unexpectedErrors, `console errors at ${viewport.id}`).toEqual([]);
    const receipt = {
      schema: 1,
      generatedAt: new Date().toISOString(),
      viewport,
      screenshots,
      surfaces: ["spreadsheet", "notebook-editor", "notebook-kernel", "deck", "graph", "graph-controls", "graph-agent", "trace", "chat"],
      rootOverflow: "passed",
      consoleErrors: unexpectedErrors,
    };
    mkdirSync(OUTPUT_ROOT, { recursive: true });
    writeFileSync(join(OUTPUT_ROOT, `${viewport.id}.json`), `${JSON.stringify(receipt, null, 2)}\n`);
  });
}
