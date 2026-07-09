import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { enterDemoRoom, publicChat } from "../../e2e/fixtures";

test.describe("SEO journey: first NodeRoom agent action", () => {
  test("demo room loads, chat accepts a NodeAgent task, and progress or output appears", async ({ page }, testInfo) => {
    const problems = collectPageProblems(page);
    await page.setViewportSize({ width: 1440, height: 920 });
    await enterDemoRoom(page);

    const chat = publicChat(page);
    await expect(chat).toBeVisible();
    await expect(page.getByTestId("artifact-panel")).toBeVisible();
    await attachScreenshot(page, testInfo, "agent-room-ready");

    const composer = chat.getByTestId("chat-composer");
    await composer.fill("@nodeagent identify one evidence gap for CardioNova and keep the answer short");
    await chat.getByTestId("chat-send").click();
    await expect(chat.getByTestId("chat-message").filter({ hasText: /CardioNova/i }).last()).toBeVisible();

    const progressOrOutput = chat.locator([
      '[data-testid="agent-unified-stream"]',
      '[data-testid="agent-job-result"]',
      '[data-testid="agent-research-receipt"]',
      '[data-testid="chat-message"].agent',
    ].join(", "));
    await expect(progressOrOutput.first()).toBeVisible({ timeout: 15_000 });
    await attachScreenshot(page, testInfo, "agent-room-progress");

    expect(problems.errors, problemsSummary(problems)).toEqual([]);
    expect(problems.failedRequests, problemsSummary(problems)).toEqual([]);
  });
});

function collectPageProblems(page: Page): { errors: string[]; failedRequests: string[] } {
  const errors: string[] = [];
  const failedRequests: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !isIgnoredProblem(message.text())) errors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!isIgnoredProblem(url)) failedRequests.push(`${request.method()} ${url}: ${request.failure()?.errorText ?? "unknown"}`);
  });
  return { errors, failedRequests };
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

function problemsSummary(problems: { errors: string[]; failedRequests: string[] }): string {
  return [...problems.errors, ...problems.failedRequests].join("\n");
}

function isIgnoredProblem(value: string): boolean {
  return /fonts\.googleapis\.com|fonts\.gstatic\.com|favicon|ResizeObserver loop|Failed to load resource: net::ERR_ABORTED/i.test(value);
}
