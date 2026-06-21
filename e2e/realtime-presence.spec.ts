import { test, expect, type Page } from "@playwright/test";

test.skip(!process.env.E2E_LIVE, "set E2E_LIVE=1 to run against the live Convex backend");
const LIVE_VIDEO_DIR = "test-results/live-videos";

function liveContextOptions(viewport: { width: number; height: number }) {
  return process.env.PLAYWRIGHT_RECORD_VIDEO === "1"
    ? { viewport, recordVideo: { dir: LIVE_VIDEO_DIR, size: viewport } }
    : { viewport };
}

function chat(page: Page) {
  return page.getByTestId("public-chat-panel");
}

async function openVarianceSheet(page: Page) {
  const target = page.locator('[data-cell-key="r_rev__note"]');
  if (await target.isVisible().catch(() => false)) return;

  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click({ timeout: 20_000 });
  }
  await expect(leftRail).toBeVisible({ timeout: 20_000 });
  const q3 = leftRail.getByRole("button", { name: /Q3 variance/ });
  await q3.scrollIntoViewIfNeeded({ timeout: 20_000 });
  await q3.click({ timeout: 20_000, force: true });
  await expect(target).toBeVisible({ timeout: 30_000 });
}

async function cellText(page: Page, key: string) {
  return (await page.locator(`[data-cell-key="${key}"]`).innerText()).trim();
}

test("cell presence is visible but advisory: another user can still edit the same cell", async ({ browser }) => {
  test.setTimeout(180_000);
  const code = `PRES${Date.now().toString(36).toUpperCase()}`;
  const key = "r_rev__note";
  const value = "Q3 growth came from renewals.";

  const contextFor = async () => {
    const context = await browser.newContext(liveContextOptions({ width: 1280, height: 900 }));
    await context.addInitScript(() => {
      try {
        localStorage.setItem("noderoom:tour:v1", "done");
      } catch { /* ignore */ }
    });
    return context;
  };

  const mayaContext = await contextFor();
  const samContext = await contextFor();
  const maya = await mayaContext.newPage();
  const sam = await samContext.newPage();

  await maya.goto(`/?demo=${code}&name=Maya`, { waitUntil: "domcontentloaded" });
  await expect(chat(maya).getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
  await expect(maya.getByTestId("artifact-panel")).toBeVisible({ timeout: 60_000 });
  await openVarianceSheet(maya);

  await sam.goto(`/?room=${code}&name=Sam`, { waitUntil: "domcontentloaded" });
  await expect(chat(sam).getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
  await expect(sam.getByTestId("artifact-panel")).toBeVisible({ timeout: 60_000 });
  await openVarianceSheet(sam);

  await maya.screenshot({ path: "test-results/realtime-presence-00-ready.png", fullPage: false });

  const samCell = sam.locator(`[data-cell-key="${key}"]`);
  await samCell.click({ position: { x: 4, y: 4 } });
  await expect(maya.locator(`[data-cell-key="${key}"] [data-testid="presence-flag"]`)).toContainText("Sam", { timeout: 15_000 });
  await expect(maya.locator(`[data-cell-key="${key}"] .r-cell-edit`)).toBeEnabled();
  await maya.screenshot({ path: "test-results/realtime-presence-01-sam-presence.png", fullPage: false });

  const mayaCell = maya.locator(`[data-cell-key="${key}"]`);
  await mayaCell.locator(".r-cell-edit").click({ timeout: 10_000 });
  const input = mayaCell.locator("input.r-cell-input");
  await input.fill(value);
  await maya.screenshot({ path: "test-results/realtime-presence-02-maya-typing.png", fullPage: false });
  await input.press("Enter");
  await expect.poll(() => cellText(maya, key), { timeout: 20_000 }).toContain(value);
  await expect(maya.locator(`[data-cell-key="${key}"] [data-testid="presence-flag"]`)).toContainText("Sam");
  await expect(maya.locator(`[data-cell-key="${key}"]`)).toHaveAttribute("data-presence-mode", /focus|edit/);

  await maya.screenshot({ path: "test-results/realtime-presence-maya.png", fullPage: false });
  await sam.screenshot({ path: "test-results/realtime-presence-sam.png", fullPage: false });

  await mayaContext.close();
  await samContext.close();
});
