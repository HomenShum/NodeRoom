import { test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const LOCAL_URL = "http://127.0.0.1:4200/#bench/nb-01-company-profile";

const EXPECTED_VALUES: Record<string, number> = {
  revenue_growth_pct: 25,
  gross_margin_2024: 40,
  gross_margin_2025: 44,
  eps_2024: 2.4,
  eps_2025: 3.5,
};

test("local r11 — live model fires and renders 5 rubric cells", async ({ page }) => {
  test.setTimeout(180_000);

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(String(e.message ?? e)));

  await page.goto(LOCAL_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});

  // Wait for dispatcher to mount
  const dispatcher = page.locator('[data-testid="benchmark-dispatcher"]');
  await dispatcher.waitFor({ state: "attached", timeout: 60_000 });

  // Read model attrs from model-route
  const modelRoute = page.locator('[data-testid="model-route"]');
  await modelRoute.waitFor({ state: "attached", timeout: 60_000 });

  // Click the Run button for the task if present
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

  // Wait a bit more for action response / grade rows
  await page.waitForTimeout(3000);

  // Re-read model attrs AFTER the run, since the live model name is set on completion
  const modelName = (await modelRoute.getAttribute("data-model-name")) ?? "";
  const modelLive = (await modelRoute.getAttribute("data-model-live")) ?? "";

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
  const screenshotPath = path.resolve("tests/.artifacts/local-r11-bench.png");
  fs.mkdirSync(path.dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const out = {
    localOk:
      cellsMatched / cellsTotal >= 0.8 &&
      modelLive === "true" &&
      modelName.startsWith("proxy:"),
    modelName,
    modelLive,
    cellsMatched,
    cellsTotal,
    runBtnVisible,
    screenshotPath,
    grades,
    notes: `local live-DOM verify at ${LOCAL_URL}; consoleErrors=${consoleErrors.length}; pageErrors=${pageErrors.length}`,
    consoleErrors,
    pageErrors,
  };
  fs.writeFileSync(
    path.resolve("tests/.artifacts/local-r11-bench.json"),
    JSON.stringify(out, null, 2),
  );
  console.log("LOCAL_R11_RESULT", JSON.stringify(out));
});
