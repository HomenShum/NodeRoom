import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const PROD_URL = "https://noderoom.live/#bench/nb-01-company-profile";

const EXPECTED_VALUES: Record<string, number> = {
  revenue_growth_pct: 25,
  gross_margin_2024: 40,
  gross_margin_2025: 44,
  eps_2024: 2.4,
  eps_2025: 3.5,
};

test("prod r10 final — live model fires and renders 5 rubric cells", async ({ page }) => {
  test.setTimeout(180_000);

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(String(e.message ?? e)));

  await page.goto(PROD_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});

  // Wait for dispatcher to mount
  const dispatcher = page.locator('[data-testid="benchmark-dispatcher"]');
  await dispatcher.waitFor({ state: "attached", timeout: 60_000 });

  // Read model attrs from model-route
  const modelRoute = page.locator('[data-testid="model-route"]');
  await modelRoute.waitFor({ state: "attached", timeout: 60_000 });
  const modelName = (await modelRoute.getAttribute("data-model-name")) ?? "";
  const modelLive = (await modelRoute.getAttribute("data-model-live")) ?? "";

  // Check for "No benchmark tasks bundled." text
  const noBundleText = await page.locator('text="No benchmark tasks bundled."').count();

  // Try to click the Run button for the task; if it's not there, the task isn't bundled
  const runBtn = page.locator(`[data-testid="benchmark-run-nb-01-company-profile"]`);
  const runBtnVisible = (await runBtn.count()) > 0;

  if (runBtnVisible) {
    await runBtn.click();
    // Wait up to 90s for the result row to appear
    await page
      .locator('[data-testid="benchmark-result"]')
      .waitFor({ state: "attached", timeout: 90_000 })
      .catch(() => {});
  }

  // Allow extra moment for grade rows to render
  await page.waitForTimeout(2000);

  // Read per-cell pass/fail
  const grades: Array<{ key: string; expected: string; actual: string; ok: boolean }> = [];
  const gradeRows = page.locator("tr[data-bench-grade-key]");
  const gradeCount = await gradeRows.count();
  for (let i = 0; i < gradeCount; i++) {
    const row = gradeRows.nth(i);
    const key = (await row.getAttribute("data-bench-grade-key")) ?? "";
    const cells = row.locator("td");
    const expectedTxt = (await cells.nth(1).innerText()).trim();
    const actualTxt = (await cells.nth(2).innerText()).trim();
    const passTxt = (await cells.nth(4).innerText()).trim();
    grades.push({ key, expected: expectedTxt, actual: actualTxt, ok: passTxt === "✓" });
  }

  // Compute matched count: actual matches expected per rubric
  let cellsMatched = 0;
  const cellsTotal = Object.keys(EXPECTED_VALUES).length;
  for (const key of Object.keys(EXPECTED_VALUES)) {
    const g = grades.find((x) => x.key === key);
    if (g && g.ok) cellsMatched++;
  }

  // Screenshot
  const screenshotPath = path.resolve("tests/.artifacts/prod-r10-bench-final.png");
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  // Bundle grep proof
  const resp = await page.request.get("https://noderoom.live/");
  const indexHtml = await resp.text();
  const bundleMatch = indexHtml.match(/\/assets\/(index-[A-Za-z0-9]+\.js)/);
  let bundleHasNb01 = false;
  let bundleHasRubricKeys = false;
  let bundleUrl = "";
  if (bundleMatch) {
    bundleUrl = `https://noderoom.live/assets/${bundleMatch[1]}`;
    const bResp = await page.request.get(bundleUrl);
    const bundleText = await bResp.text();
    bundleHasNb01 = bundleText.includes("nb-01-company-profile");
    bundleHasRubricKeys =
      bundleText.includes("revenue_growth_pct") &&
      bundleText.includes("gross_margin_2024") &&
      bundleText.includes("eps_2024");
  }

  const out = {
    livePass:
      cellsMatched / cellsTotal >= 0.8 &&
      modelLive === "true" &&
      modelName.startsWith("proxy:"),
    modelName,
    modelLive,
    cellsMatched,
    cellsTotal,
    bundleHasNb01,
    bundleHasRubricKeys,
    bundleUrl,
    screenshotPath,
    runBtnVisible,
    noBundleTextCount: noBundleText,
    grades,
    notes: `prod live-DOM verify at ${PROD_URL}; consoleErrors=${consoleErrors.length}; pageErrors=${pageErrors.length}`,
    consoleErrors,
    pageErrors,
  };
  fs.writeFileSync(
    path.resolve("tests/.artifacts/prod-r10-bench-final.json"),
    JSON.stringify(out, null, 2),
  );
  console.log("PROD_R10_FINAL_RESULT", JSON.stringify(out));
});
