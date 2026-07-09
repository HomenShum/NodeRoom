import { expect, test, type Page, type TestInfo } from "@playwright/test";

test.describe("SEO journey: Google-origin QA", () => {
  test("records one search-origin scenario or safely falls back to direct landing", async ({ page }, testInfo) => {
    const targetPhrase = process.env.SEO_QA_GOOGLE_TARGET_PHRASE ?? "NodeRoom collaborative AI room";
    const allowGoogle = process.env.SEO_QA_ALLOW_GOOGLE_ORIGIN === "1";
    const problems = collectPageProblems(page);
    let foundNodeRoom = false;

    if (allowGoogle) {
      await page.goto("https://www.google.com/search?q=" + encodeURIComponent(targetPhrase), { waitUntil: "domcontentloaded" });
      await attachScreenshot(page, testInfo, "google-origin-search");
      const result = page.locator('a[href*="noderoom.live"]').first();
      foundNodeRoom = await result.isVisible({ timeout: 5_000 }).catch(() => false);
      if (foundNodeRoom) await result.click();
      else await page.goto("/?mode=memory&surface=desktop", { waitUntil: "domcontentloaded" });
    } else {
      testInfo.annotations.push({ type: "seo-qa", description: "Google-origin step skipped; set SEO_QA_ALLOW_GOOGLE_ORIGIN=1 for a one-query manual QA scenario." });
      await page.goto("/?mode=memory&surface=desktop", { waitUntil: "domcontentloaded" });
    }

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByTestId("start-demo-room")).toBeVisible();
    await attachScreenshot(page, testInfo, foundNodeRoom ? "google-origin-noderoom-result" : "google-origin-direct-fallback");

    expect(problems.errors.filter((error) => !isExternalGoogleNoise(error)), problemsSummary(problems)).toEqual([]);
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
  return /fonts\.googleapis\.com|fonts\.gstatic\.com|favicon|ResizeObserver loop/i.test(value);
}

function isExternalGoogleNoise(value: string): boolean {
  return /google|gstatic|consent|captcha|status of 429/i.test(value);
}
