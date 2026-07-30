import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

const outputRoot = join("evidence", "nodekit-note-reference-demo");
const captureText = "Founder note: verify the authority boundary before approving this reference edge.";

async function pause(page: Page, milliseconds = 900): Promise<void> {
  await page.waitForTimeout(milliseconds);
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
}

async function openCaptureNotebook(page: Page): Promise<void> {
  const workArtifactsTab = page.getByTestId("work-artifacts-tab");
  await workArtifactsTab.click();
  const panel = page.getByTestId("work-artifacts-panel");
  await expect(panel).toBeVisible();
  const row = panel
    .locator('[data-testid="work-artifact-row"][data-kind="notebook"]')
    .filter({ hasText: "Capture Notebook" })
    .first();
  await expect(row).toBeVisible();
  await row.locator("button").first().click();
  await expect(page.getByTestId("notebook-digest-workbench")).toBeVisible();
}

test("records the bounded NodeKit note-reference workflow", async ({ page }) => {
  mkdirSync(outputRoot, { recursive: true });
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText ?? "unknown";
    if (!/ERR_ABORTED/i.test(failure)) failedRequests.push(`${request.method()} ${request.url()} ${failure}`);
  });

  await enterDemoRoom(page);
  await openCaptureNotebook(page);
  const capture = page.getByTestId("notebook-note-capture");
  await expect(capture).toHaveAttribute("data-capture-state", "armed");
  await expect(capture).toHaveAttribute("data-capture-reason", "ready");
  await pause(page);

  await page.getByRole("button", { name: /Reference chain/i }).click();
  await expect(page.getByTestId("notebook-reference-chain-detail")).toBeVisible();
  await expect(capture).toHaveAttribute("data-capture-state", "disarmed");
  await expect(capture).toHaveAttribute("data-capture-reason", "reference-review");
  await expect(capture).toContainText("Finish this review before adding another note.");
  await pause(page, 1_200);

  await page.getByRole("button", { name: /Reference chain/i }).click();
  await expect(page.getByTestId("notebook-reference-chain-detail")).toHaveCount(0);
  await expect(capture).toHaveAttribute("data-capture-state", "armed");
  await page.getByRole("textbox", { name: "Capture note" }).fill(captureText);
  await pause(page, 700);
  await page.getByTestId("notebook-note-capture-submit").click();
  await expect(capture.getByRole("status")).toHaveText("Captured in this notebook.");
  await expect(page.getByTestId("notebook-digest-block").filter({ hasText: captureText })).toHaveCount(1);
  await pause(page, 1_100);

  await page.getByRole("button", { name: "Close notebook digest" }).click();
  await pause(page, 500);
  await openCaptureNotebook(page);
  const persistedBlock = page.getByTestId("notebook-digest-block").filter({ hasText: captureText });
  await expect(persistedBlock).toHaveCount(1);
  await persistedBlock.scrollIntoViewIfNeeded();
  await pause(page, 1_200);

  const receipt = {
    schema: "nodekit.note-reference-demo/v1",
    mode: "memory",
    captureText,
    checks: {
      initialCaptureArmed: true,
      referenceReviewDisarmedCapture: true,
      exactCaptureConfirmed: true,
      exactCapturePresentAfterCloseAndReopen: true,
      consoleErrors: consoleErrors.length,
      failedRequests: failedRequests.length,
    },
  };
  writeFileSync(join(outputRoot, "receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});
