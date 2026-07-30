import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const variant = process.env.NODEKIT_PROOF_VARIANT === "before" ? "before" : "after";
const expectsReferenceSurface = variant === "after";
const outputRoot = join("evidence", "nodekit-note-reference-surface", variant);
const captureText = "Founder note: test the authority boundary before approving the reference edge.";
const viewports = [
  { id: "desktop-1440x900", width: 1440, height: 900 },
  { id: "phone-390x844", width: 390, height: 844 },
  { id: "phone-320x568", width: 320, height: 568 },
] as const;

type StateReceipt = {
  id: string;
  screenshot: string;
  equivalentSurface: boolean;
  captureState?: string | null;
  captureReason?: string | null;
};

test.describe.configure({ mode: "serial" });

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function enterDemoRoom(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem("noderoom:tour:v1", "done");
    localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: false, paused: false }));
  });
  await page.goto("/?mode=memory&surface=desktop", { waitUntil: "domcontentloaded" });
  const startDemo = page.getByTestId("start-demo-room");
  const trySample = page.getByRole("button", { name: "Try sample room" });
  await expect(startDemo.or(trySample)).toBeVisible({ timeout: 30_000 });
  if (await startDemo.isVisible().catch(() => false)) {
    await startDemo.click();
  } else {
    await trySample.click();
  }
  await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 30_000 });
  await page.addStyleTag({
    content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}",
  });
}

async function showWorkArtifacts(page: Page): Promise<void> {
  const workArtifactsTab = page.getByTestId("work-artifacts-tab");
  if (await workArtifactsTab.count()) {
    await workArtifactsTab.dispatchEvent("click");
    await expect(page.getByTestId("work-artifacts-panel")).toBeVisible();
    return;
  }
  const panel = page.getByTestId("artifact-panel");
  if (!(await panel.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Work Surface panel" }).click();
    await expect(panel).toBeVisible();
  }
  await workArtifactsTab.dispatchEvent("click");
  await expect(page.getByTestId("work-artifacts-panel")).toBeVisible();
}

async function openNotebook(page: Page, title: string): Promise<void> {
  await showWorkArtifacts(page);
  const openWorkbench = page.getByTestId("notebook-digest-workbench");
  if (await openWorkbench.isVisible().catch(() => false)) {
    if (await openWorkbench.getByRole("heading", { name: title }).isVisible().catch(() => false)) return;
    await page.getByRole("button", { name: "Close notebook digest" }).dispatchEvent("click");
  }
  const row = page
    .getByTestId("work-artifacts-panel")
    .locator('[data-testid="work-artifact-row"][data-kind="notebook"]')
    .filter({ hasText: title })
    .first();
  await expect(row).toBeVisible();
  await row.locator("button").first().dispatchEvent("click");
  await expect(openWorkbench).toBeVisible();
}

async function frameTarget(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).evaluate((element) => {
    const panel = element.closest<HTMLElement>('[data-testid="work-artifacts-panel"]');
    if (panel) {
      const top = element.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
      panel.scrollTop = Math.max(0, top - 8);
    }
    window.scrollTo(0, 0);
  });
  await settle(page);
}

async function captureState(
  page: Page,
  viewportId: string,
  id: string,
  equivalentSurface: boolean,
  focusTestId = "notebook-digest-workbench",
): Promise<StateReceipt> {
  const directory = join(outputRoot, viewportId);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${id}.png`);
  if (focusTestId === "notebook-digest-workbench") {
    await frameTarget(page, focusTestId);
    await page.screenshot({ path, fullPage: false });
  } else {
    const target = page.getByTestId(focusTestId);
    await expect(target).toBeVisible();
    await settle(page);
    await target.screenshot({ path });
  }
  const capture = page.getByTestId("notebook-note-capture");
  return {
    id,
    screenshot: path.replaceAll("\\", "/"),
    equivalentSurface,
    captureState: (await capture.count()) ? await capture.getAttribute("data-capture-state") : null,
    captureReason: (await capture.count()) ? await capture.getAttribute("data-capture-reason") : null,
  };
}

for (const viewport of viewports) {
  test(`NodeKit note reference proof - ${variant} - ${viewport.id}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const consoleErrors: string[] = [];
    const failedRequests: string[] = [];
    const serverErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "unknown";
      if (!/ERR_ABORTED/i.test(failure)) failedRequests.push(`${request.method()} ${request.url()} ${failure}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`);
    });

    await enterDemoRoom(page);
    await openNotebook(page, "Capture Notebook");

    const states: StateReceipt[] = [];
    if (!expectsReferenceSurface) {
      await expect(page.getByTestId("notebook-note-capture")).toHaveCount(0);
      for (const state of ["populated-armed", "reference-review-disarmed", "empty-armed", "captured-reopened"]) {
        states.push(await captureState(page, viewport.id, state, false));
      }
    } else {
      const capture = page.getByTestId("notebook-note-capture");
      await expect(capture).toHaveAttribute("data-capture-state", "armed");
      await expect(capture).toHaveAttribute("data-capture-reason", "ready");
      states.push(await captureState(page, viewport.id, "populated-armed", true));

      await page.getByRole("button", { name: /Reference chain/i }).dispatchEvent("click");
      await expect(page.getByTestId("notebook-reference-chain-detail")).toBeVisible();
      await expect(capture).toHaveAttribute("data-capture-state", "disarmed");
      await expect(capture).toHaveAttribute("data-capture-reason", "reference-review");
      await expect(capture).toContainText("Finish this review before adding another note.");
      states.push(await captureState(page, viewport.id, "reference-review-disarmed", true, "notebook-reference-chain"));

      await page.getByTestId("notebook-digest-open-editor").dispatchEvent("click");
      const editor = page.getByTestId("note-editor").locator(".ProseMirror");
      await expect(editor).toBeVisible();
      await editor.focus();
      await editor.press("Control+A");
      await editor.press("Backspace");
      await editor.press("Tab");
      await expect(page.getByTestId("note-error")).toHaveCount(0);
      await openNotebook(page, "Capture Notebook");
      const emptyCapture = page.getByTestId("notebook-note-capture");
      await expect(page.getByTestId("notebook-digest-block")).toHaveCount(0);
      await expect(emptyCapture).toHaveAttribute("data-capture-state", "armed");
      await expect(emptyCapture).toHaveAttribute("data-capture-reason", "ready");
      await expect(emptyCapture).toContainText("Start the stream. Classification can happen after the thought is safe.");
      states.push(await captureState(page, viewport.id, "empty-armed", true));

      await page.getByRole("textbox", { name: "Capture note" }).fill(captureText);
      await page.getByTestId("notebook-note-capture-submit").dispatchEvent("click");
      await expect(emptyCapture.getByRole("status")).toHaveText("Captured in this notebook.");
      await expect(page.getByTestId("notebook-digest-block").filter({ hasText: captureText })).toHaveCount(1);
      await page.getByRole("button", { name: "Close notebook digest" }).dispatchEvent("click");
      await openNotebook(page, "Capture Notebook");
      await expect(page.getByTestId("notebook-digest-block").filter({ hasText: captureText })).toHaveCount(1);
      await expect(page.getByTestId("notebook-note-capture")).toHaveAttribute("data-capture-state", "armed");
      states.push(await captureState(page, viewport.id, "captured-reopened", true, "notebook-digest-block"));
    }

    const metrics = await page.evaluate(() => ({
      charset: document.characterSet,
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      text: document.body.innerText,
    }));
    expect(metrics.charset).toBe("UTF-8");
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.text).not.toMatch(/Ã.|Â.|â€¦|â€™|â€œ|â€/);

    const accessibility = await new AxeBuilder({ page })
      .include('[data-testid="notebook-digest-workbench"]')
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const severeViolations = accessibility.violations.filter((violation) =>
      violation.impact === "critical" || violation.impact === "serious");
    if (expectsReferenceSurface) {
      expect(severeViolations, "critical and serious accessibility violations").toEqual([]);
    }

    const unexpectedConsoleErrors = consoleErrors.filter((message) => !/ResizeObserver loop|favicon/i.test(message));
    expect(unexpectedConsoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(serverErrors).toEqual([]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("start-demo-room")).toBeVisible({ timeout: 30_000 });
    const reloadDirectory = join(outputRoot, viewport.id);
    const reloadPath = join(reloadDirectory, "full-reload-memory-reset.png");
    await settle(page);
    await page.screenshot({ path: reloadPath, fullPage: false });

    const receipt = {
      schema: "nodekit.note-reference-surface-proof/v1",
      generatedAt: new Date().toISOString(),
      variant,
      viewport,
      states,
      fullReload: {
        screenshot: reloadPath.replaceAll("\\", "/"),
        result: "memory-session-reset",
        note: "The keyless memory-mode harness intentionally returns to the landing screen on full reload; component close/reopen persistence is verified above.",
      },
      checks: {
        charset: metrics.charset,
        horizontalOverflow: metrics.scrollWidth <= metrics.clientWidth + 1,
        consoleErrors: unexpectedConsoleErrors,
        failedRequests,
        serverErrors,
        seriousOrCriticalA11y: severeViolations.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          description: violation.description,
          nodes: violation.nodes.length,
        })),
      },
    };
    mkdirSync(join(outputRoot, viewport.id), { recursive: true });
    writeFileSync(join(outputRoot, viewport.id, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  });
}
