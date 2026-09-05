import { test, expect, type Page, type TestInfo, type Download } from "@playwright/test";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { SHEET } from "../src/ui/mobile/mobileData";

test.setTimeout(180_000);
const widths = [320, 390, 768, 1024, 1440, 1920];
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const sourcePaths = [
  "src/ui/mobile/MobileGrid.tsx", "src/ui/mobile/mobileSheetExport.ts", "src/ui/mobile/mobileData.ts",
  "src/ui/mobile/MobileApp.tsx", "src/ui/mobile/MobileRoot.tsx", "src/ui/mobile/MobileScreens.tsx",
  "src/ui/panels/Artifact.tsx", "src/ui/workArtifacts/xlsxDownload.ts", "src/ui/App.tsx",
  "package.json", "package-lock.json", "e2e/mobile-sample-workbook-export.spec.ts",
];

async function capture(page: Page, info: TestInfo, name: string) {
  // Preserve transient screenshots in the prior run; these captures show the settled outcome after the real edit toast expires.
  await expect(page.locator('.na-toast[data-show="true"]')).toHaveCount(0);
  await page.evaluate(() => Promise.race([
    Promise.allSettled(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const png = await page.screenshot({ path: info.outputPath(`${name}.png`), caret: "initial" });
  const html = await page.content();
  await writeFile(info.outputPath(`${name}.html`), html);
  const dom = await page.evaluate(() => ({
    url: location.href, viewport: { width: innerWidth, height: innerHeight },
    build: document.querySelector('meta[name="noderoom-build-sha"]')?.getAttribute("content"),
    body: document.body.innerText, overflow: document.documentElement.scrollWidth - innerWidth,
    focused: document.activeElement?.outerHTML,
  }));
  await writeFile(info.outputPath(`${name}.json`), JSON.stringify({ ...dom, pngSha256: hash(png), htmlSha256: hash(html) }, null, 2));
}

async function openTable(page: Page, info: TestInfo, width: number) {
  await page.setViewportSize({ width, height: width <= 390 ? 844 : 960 });
  await page.goto("/?mode=memory", { waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="mobile-bottom-nav"], [data-testid="start-demo-room"]').first().waitFor();
  const naturalMobile = await page.getByTestId("mobile-bottom-nav").isVisible();
  expect(naturalMobile).toBe(width <= 760);
  await capture(page, info, `natural-entry-${width}`);
  if (!naturalMobile) {
    // Explicit mobile route for component coverage; natural desktop routing above remains separately recorded.
    await page.goto("/#mobile?mode=memory", { waitUntil: "domcontentloaded" });
    await page.getByTestId("mobile-bottom-nav").waitFor();
  }
  const card = page.locator('.na-rcard[data-kind="sheet"]').first();
  await card.focus();
  await card.press("Enter");
  await page.getByRole("dialog", { name: "Spreadsheet", exact: true }).waitFor();
}

function tableDialog(page: Page) { return page.getByRole("dialog", { name: "Spreadsheet", exact: true }); }
async function editProduct(page: Page, value: string) {
  const dialog = tableDialog(page);
  await dialog.locator(".na-art-tab").filter({ hasText: /^Sheet/ }).click();
  await dialog.locator('button.v[title="Tap to edit"]').first().click();
  await dialog.locator(".na-sfield-edit").fill(value);
  await dialog.locator(".na-sfield-edit").press("Enter");
  await expect(dialog.locator('button.v[title="Tap to edit"]').first()).toHaveText(value);
}
async function openExport(page: Page) {
  await tableDialog(page).locator(".na-art-tab").filter({ hasText: /^Export$/ }).click();
}
async function readDownload(download: Download, info: TestInfo, name: string, product: string) {
  const file = info.outputPath(`${name}.xlsx`);
  await download.saveAs(file);
  expect(await download.failure()).toBeNull();
  const bytes = await readFile(file);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const expected = structuredClone(SHEET.rows);
  expected[0].cells.product.v = product;
  const sheet = workbook.getWorksheet("Current table")!;
  expect(sheet.rowCount).toBe(4);
  expect(sheet.getRow(1).values).toEqual([undefined, ...SHEET.columns.map((column) => column.label)]);
  expected.forEach((row, i) => SHEET.columns.forEach((column, j) => {
    expect(sheet.getCell(i + 2, j + 1).value).toBe(row.cells[column.id].v);
    expect(sheet.getCell(i + 2, j + 1).formula).toBeUndefined();
  }));
  const metadata = workbook.getWorksheet("Sample metadata")!;
  expect(metadata.getCell("A1").value).toBe("Local synthetic sample");
  expect(metadata.getCell("D8").value).toBe("manual note");
  expect(metadata.getCell("G8").value).toBe("Unverified sample metadata");
  await writeFile(info.outputPath(`${name}-reopened.json`), JSON.stringify({
    filename: download.suggestedFilename(), sha256: hash(bytes), byteCount: bytes.byteLength,
    sheets: workbook.worksheets.map((item) => ({ name: item.name, rows: item.getSheetValues() })),
  }, null, 2));
  return bytes.byteLength;
}

test.beforeEach(async ({ page }, info) => {
  const source = Object.fromEntries(await Promise.all(sourcePaths.map(async (path) => [path, hash(await readFile(path))])));
  await writeFile(info.outputPath("source-bindings.json"), JSON.stringify(source, null, 2));
  const requests: string[] = [];
  const errors: string[] = [];
  const consoleMessages: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") consoleMessages.push(message.text()); });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol)) return route.continue();
    requests.push(url.origin + url.pathname);
    return route.abort("blockedbyclient");
  });
  info.annotations.push({ type: "scope", description: "Offline, anonymous, fallback fonts. No provider or shared-room certification." });
  Object.assign(info, { exportObservations: { source, requests, errors, consoleMessages } });
});

test.afterEach(async ({}, info) => {
  const observations = (info as TestInfo & { exportObservations: { source: Record<string, string>; errors: string[] } }).exportObservations;
  await writeFile(info.outputPath("runtime-observations.json"), JSON.stringify(observations, null, 2));
  for (const [path, expected] of Object.entries(observations.source)) expect(hash(await readFile(path))).toBe(expected);
  expect(observations.errors).toEqual([]);
});

for (const width of widths) {
  test(`reviewer downloads the exact edited phone table at ${width}px`, async ({ page }, info) => {
    await openTable(page, info, width);
    const product = `00123 采购 <sample> ${width}`;
    await editProduct(page, product);
    await openExport(page);
    const dialog = tableDialog(page);
    await expect(dialog.getByTestId("mobile-table-export-status")).toContainText("local sample");
    await expect(dialog.getByRole("button", { name: "PowerPoint", exact: true })).toBeDisabled();
    await capture(page, info, `export-idle-${width}`);
    const event = page.waitForEvent("download");
    const button = dialog.getByTestId("mobile-table-export-download");
    await button.focus();
    await button.press("Enter");
    const byteCount = await readDownload(await event, info, `current-table-${width}`, product);
    await expect(dialog.getByTestId("mobile-table-export-status")).toContainText(`${byteCount.toLocaleString()} bytes`);
    await expect(dialog.getByTestId("mobile-table-export-status")).toContainText("Download started");
    const filenameBounds = await dialog.locator(".na-export-main span").evaluate((element) => {
      const range = document.createRange(); range.selectNodeContents(element);
      return { column: element.getBoundingClientRect().toJSON(), text: [...range.getClientRects()].map((rect) => rect.toJSON()) };
    });
    expect(filenameBounds.text.every((rect) => rect.left >= filenameBounds.column.left - 1 && rect.right <= filenameBounds.column.right + 1)).toBe(true);
    await writeFile(info.outputPath(`filename-bounds-${width}.json`), JSON.stringify(filenameBounds, null, 2));
    await capture(page, info, `export-started-${width}`);
    await dialog.locator(".na-export-prov").scrollIntoViewIfNeeded();
    await capture(page, info, `export-provenance-${width}`);
    await dialog.locator(".na-vers").scrollIntoViewIfNeeded();
    await expect(dialog.locator(".na-ver-acts button:enabled")).toHaveCount(0);
    await capture(page, info, `export-history-${width}`);
    if (width === 390 || width === 1440) {
      await page.evaluate(() => {
        const styles = [...document.querySelectorAll<HTMLElement>("body *")].map((element) => ({ element, font: getComputedStyle(element).fontSize, line: getComputedStyle(element).lineHeight }));
        for (const { element, font, line } of styles) {
          element.style.fontSize = `${parseFloat(font) * 2}px`;
          if (line !== "normal") element.style.lineHeight = `${parseFloat(line) * 2}px`;
        }
      });
      await button.focus();
      await capture(page, info, `export-text-enlarged-${width}`);
      const focus = await button.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { focused: document.activeElement === element, rect: rect.toJSON(), hit: element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
      });
      await writeFile(info.outputPath(`enlargement-${width}.json`), JSON.stringify({ method: "Browser-only doubled precomputed font and explicit line height; not native zoom certification", focus }, null, 2));
    }
  });
}

test("a failed download, duplicate retry and ten later edits keep their own outcomes", async ({ page }, info) => {
  await openTable(page, info, 390);
  await editProduct(page, "Initial reviewed value");
  await openExport(page);
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  await page.evaluate(() => {
    const native = URL.createObjectURL;
    URL.createObjectURL = function () { URL.createObjectURL = native; throw new Error("The browser could not allocate the download resource."); };
  });
  await tableDialog(page).getByTestId("mobile-table-export-download").click();
  await expect(tableDialog(page).getByRole("alert")).toContainText("could not allocate");
  expect(downloads).toHaveLength(0);
  await expect(tableDialog(page).getByTestId("mobile-table-export-status")).not.toContainText("Download started");
  await capture(page, info, "resource-failed");
  const retryEvent = page.waitForEvent("download");
  // Two native activations in one browser task, before React can render disabled, exercise the live single-flight claim.
  await tableDialog(page).getByTestId("mobile-table-export-download").evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await readDownload(await retryEvent, info, "retried-once", "Initial reviewed value");
  await expect(tableDialog(page).getByTestId("mobile-table-export-download")).toBeEnabled();
  expect(downloads).toHaveLength(1);
  await capture(page, info, "resource-recovered");
  for (let i = 0; i < 10; i += 1) {
    const value = `Reviewed snapshot ${i + 1}`;
    await editProduct(page, value);
    await openExport(page);
    await expect(tableDialog(page).getByTestId("mobile-table-export-status")).not.toContainText("Download started");
    const event = page.waitForEvent("download");
    await tableDialog(page).getByTestId("mobile-table-export-download").click();
    await readDownload(await event, info, `sustained-${i + 1}`, value);
  }
  expect(downloads).toHaveLength(11);
  await editProduct(page, "x".repeat(32_768));
  await openExport(page);
  await tableDialog(page).getByTestId("mobile-table-export-download").click();
  await expect(tableDialog(page).getByRole("alert")).toContainText("32,767-character limit");
  expect(downloads).toHaveLength(11);
  await capture(page, info, "format-rejected");
  await editProduct(page, "Corrected after format rejection");
  await openExport(page);
  const recovered = page.waitForEvent("download");
  await tableDialog(page).getByTestId("mobile-table-export-download").click();
  await readDownload(await recovered, info, "format-recovered", "Corrected after format rejection");
  expect(downloads).toHaveLength(12);
  await capture(page, info, "format-recovered");
});

test("rapidly closing an export suppresses its later result and permits a fresh export", async ({ page }, info) => {
  await openTable(page, info, 390);
  await editProduct(page, "Temporary current value");
  await openExport(page);
  const downloads: Download[] = [];
  page.on("download", (download) => downloads.push(download));
  // A real rapid navigation burst before asynchronous serialization settles; no held producer or invented pending pixels.
  await tableDialog(page).evaluate((dialog) => {
    dialog.querySelector<HTMLButtonElement>('[data-testid="mobile-table-export-download"]')!.click();
    dialog.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click();
  });
  await expect(tableDialog(page)).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(downloads).toHaveLength(0);
  await capture(page, info, "closed-without-late-download");
  await page.locator('.na-rcard[data-kind="sheet"]').first().click();
  await editProduct(page, "New explicit export after reopen");
  await openExport(page);
  const event = page.waitForEvent("download");
  await tableDialog(page).getByTestId("mobile-table-export-download").click();
  await readDownload(await event, info, "reopened-after-cancel", "New explicit export after reopen");
  expect(downloads).toHaveLength(1);
  await capture(page, info, "reopened-after-cancel");
  await writeFile(info.outputPath("close-observation.json"), JSON.stringify({
    method: "Native Export and Close activations in one browser task, followed by actual reopened export completion",
    downloadsBeforeReopen: 0, downloadsAfterFreshExport: downloads.length,
    limitation: "Rapid navigation guard only; serializer CPU is not cancelled and no held loading-state screenshot is claimed",
  }, null, 2));
});
