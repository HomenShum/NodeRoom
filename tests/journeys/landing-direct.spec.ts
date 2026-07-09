import { expect, test, type Page, type TestInfo } from "@playwright/test";

test.describe("SEO journey: direct landing", () => {
  test("landing page is understandable and primary CTA opens a room", async ({ page }, testInfo) => {
    const problems = collectPageProblems(page);
    await page.goto("/?mode=memory&surface=desktop", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Diligence that/i);
    await expect(page.getByTestId("start-demo-room")).toBeVisible();
    await expect(page.getByTestId("landing-demo-loop")).toBeVisible();
    await expect(page.getByTestId("landing-proof-pill")).toBeVisible();
    await expect(page.getByText(/Share a code/i)).toBeVisible();
    await expect(page.getByText(/Locks, then smart-merge/i)).toBeVisible();

    await attachScreenshot(page, testInfo, "landing-direct");
    await page.getByTestId("start-demo-room").click();
    await expect(page.getByTestId("artifact-panel")).toBeVisible();
    if ((page.viewportSize()?.width ?? 0) >= 1000) {
      await expect(page.getByTestId("public-chat-panel")).toBeVisible();
    }
    await attachScreenshot(page, testInfo, "landing-direct-room");

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
    const failure = request.failure()?.errorText ?? "unknown";
    const url = request.url();
    if (!isIgnoredProblem(url)) failedRequests.push(`${request.method()} ${url}: ${failure}`);
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
  return /fonts\.googleapis\.com|fonts\.gstatic\.com|favicon|ResizeObserver loop/i.test(value);
}
