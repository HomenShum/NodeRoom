import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { enterDemoRoom, publicChat } from "../../e2e/fixtures";

/**
 * First room action in the keyless e2e harness room. The scripted @nodeagent step that used to
 * live here was removed: the harness agent is canned, so its "progress or output" proved nothing
 * about a real agent. Real agent runs are exercised on the #workspace route and the live lanes.
 */
test.describe("SEO journey: first NodeRoom room action", () => {
  test("room loads and the public chat accepts a message", async ({ page }, testInfo) => {
    const problems = collectPageProblems(page);
    await page.setViewportSize({ width: 1440, height: 920 });
    await enterDemoRoom(page);

    const chat = publicChat(page);
    await expect(chat).toBeVisible();
    await expect(page.getByTestId("artifact-panel")).toBeVisible();
    await attachScreenshot(page, testInfo, "agent-room-ready");

    const composer = chat.getByTestId("chat-composer");
    await composer.fill("Flagging one evidence gap for CardioNova before the partner review.");
    await chat.getByTestId("chat-send").click();
    await expect(chat.getByTestId("chat-message").filter({ hasText: /evidence gap for CardioNova/i }).last()).toBeVisible();
    await attachScreenshot(page, testInfo, "room-message-posted");

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
