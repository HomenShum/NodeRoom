import { expect, test, type Page, type TestInfo } from "@playwright/test";

test.describe("SEO journey: direct landing", () => {
  test("landing page is understandable and the live primary CTA is ready", async ({ page }, testInfo) => {
    test.skip(process.env.E2E_LIVE !== "1", "SEO journeys model a production visitor: run against a Convex-configured server (E2E_LIVE=1).");
    const problems = collectPageProblems(page);
    await page.goto("/?surface=desktop", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1 })).toContainText(/Diligence that/i);
    await expect(page.getByTestId("create-room")).toBeEnabled();
    await expect(page.getByTestId("landing-demo-loop")).toBeVisible();
    await expect(page.getByTestId("landing-proof-pill")).toBeVisible();
    await expect(page.getByText(/Share a code/i)).toBeVisible();
    await expect(page.getByText(/Locks, then smart-merge/i)).toBeVisible();

    await expect(page.getByTestId("start-demo-room")).toHaveCount(0);
    // Entering a room is sign-in gated in production; that leg is the deployed-auth e2e lane.
    await attachScreenshot(page, testInfo, "landing-direct");

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
