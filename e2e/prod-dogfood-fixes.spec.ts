import { readFileSync } from "node:fs";
import { test, expect } from "./fixtures";

test("SSR fallback Create a room CTA routes to live create, not memory demo", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await page.goto(baseURL ?? "/", { waitUntil: "domcontentloaded" });
    const create = page.locator(".nr-ssr-button", { hasText: "Create a room" });
    await expect(create).toBeVisible();
    const href = await create.getAttribute("href");
    expect(href).toContain("create=1");
    expect(href).toContain("surface=desktop");
    expect(href).not.toContain("mode=memory");
  } finally {
    await context.close();
  }
});

test("artifact Export XLSX produces a real workbook download", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("noderoom:tour:v1", "done");
      localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: true, paused: false }));
    } catch {
      /* ignore */
    }
  });
  const roomCode = `NRQA${Date.now().toString(36).toUpperCase().slice(-8)}`.slice(0, 12);
  await page.goto(`/?demo=${roomCode}&surface=desktop&name=QA`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 45_000 });
  const q3 = page.getByTestId("left-rail").getByRole("button", { name: /Q3 variance/i }).first();
  if (await q3.isVisible().catch(() => false)) {
    await q3.click();
  }
  const exportButton = page.getByTestId("artifact-export-xlsx").first();
  await expect(exportButton).toBeVisible({ timeout: 30_000 });

  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await exportButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/i);

  const xlsxPath = testInfo.outputPath("noderoom-export.xlsx");
  await download.saveAs(xlsxPath);
  const bytes = readFileSync(xlsxPath);
  expect(bytes.length).toBeGreaterThan(0);
  expect(bytes[0]).toBe(0x50);
  expect(bytes[1]).toBe(0x4b);
});
