import { test, expect, type Page } from "@playwright/test";

/**
 * Live Convex CRS proof. This creates a fresh room, joins a second client, runs the host-only
 * semantic conflict drill, and verifies the review proposal fans out before host approval applies.
 */
const HAS_BACKEND = !!process.env.E2E_CONVEX_URL && !!process.env.VITE_CONVEX_URL;
test.skip(!HAS_BACKEND, "set E2E_CONVEX_URL and VITE_CONVEX_URL to run live Convex CRS specs");
const LIVE_VIDEO_DIR = "test-results/live-videos";

function liveContextOptions(viewport: { width: number; height: number }) {
  return process.env.PLAYWRIGHT_RECORD_VIDEO === "1"
    ? { viewport, recordVideo: { dir: LIVE_VIDEO_DIR, size: viewport } }
    : { viewport };
}

async function dismissTour(page: Page) {
  await page.getByTestId("tour-skip").click({ timeout: 5_000 }).catch(() => {});
}

async function ensureBinderOpen(page: Page) {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click();
  }
  await expect(leftRail).toBeVisible({ timeout: 10_000 });
}

async function waitForRoom(page: Page) {
  await expect(page.getByTestId("public-chat-panel").getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
  await ensureBinderOpen(page);
  await page.getByTestId("left-rail").getByRole("button", { name: /Q3 variance/ }).click();
  await expect(page.locator('[data-cell-key="r_rev__variance"]')).toBeVisible({ timeout: 30_000 });
  await dismissTour(page);
}

function cell(page: Page, key: string) {
  return page.locator(`[data-cell-key="${key}"]`);
}

async function cellText(page: Page, key: string) {
  return (await cell(page, key).innerText()).trim();
}

async function setReviewMode(page: Page) {
  // Agent-commits relocated into the settings panel (design-target parity); open it first.
  await page.getByTestId("room-settings-btn").click();
  const sw = page.getByTestId("auto-allow-switch");
  await expect(sw).toBeVisible({ timeout: 10_000 });
  if ((await sw.getAttribute("data-on")) !== "false") await sw.click();
  await expect(sw).toHaveAttribute("data-on", "false", { timeout: 10_000 });
  await page.getByTestId("room-settings-btn").click(); // close settings, restore the resting bar
}

async function editCell(page: Page, key: string, value: string) {
  const target = cell(page, key);
  await target.locator(".r-cell-edit").click({ timeout: 10_000 });
  const input = target.locator("input.r-cell-input");
  await input.fill(value);
  await input.press("Enter");
}

test("live Convex semantic rebase drill fans out and applies only after host approval", async ({ browser }) => {
  test.setTimeout(120_000);
  const code = "CRS" + Date.now().toString(36).toUpperCase();
  const hostContext = await browser.newContext(liveContextOptions({ width: 1280, height: 900 }));
  const memberContext = await browser.newContext(liveContextOptions({ width: 1280, height: 900 }));
  const host = await hostContext.newPage();
  const member = await memberContext.newPage();

  try {
    await host.goto(`/?demo=${code}&name=Maya`, { waitUntil: "domcontentloaded" });
    await waitForRoom(host);
    await member.goto(`/?room=${code}&name=Dev`, { waitUntil: "domcontentloaded" });
    await waitForRoom(member);

    await setReviewMode(host);
    await host.evaluate(() => (window as any).__runConflictDrill());

    const target = "r_rev__variance";
    const hostCell = cell(host, target);
    const memberCell = cell(member, target);
    await expect(hostCell.locator('[data-testid="presence-flag"]')).toContainText("NodeAgent planning", { timeout: 15_000 });

    await editCell(host, target, "+24%");
    await expect.poll(() => cellText(member, target), { timeout: 25_000 }).toContain("+24%");

    const hostChip = hostCell.locator('[data-testid="proposal-inline"][data-semantic="true"]');
    const memberChip = memberCell.locator('[data-testid="proposal-inline"][data-semantic="true"]');

    await expect(hostChip).toContainText("+19%", { timeout: 45_000 });
    await expect(memberChip).toContainText("+19%", { timeout: 45_000 });
    await expect(hostCell).toContainText("+24%");
    await expect(memberCell).toContainText("+24%");
    await expect(memberChip.getByTestId("proposal-inline-approve")).toHaveCount(0);
    await expect(memberChip).toContainText("host");
    await expect(host.getByTestId("room-trace")).toContainText("Semantic rebase", { timeout: 15_000 });

    await hostChip.getByTestId("proposal-inline-approve").click();

    await expect(hostCell.locator('[data-testid="proposal-inline"]')).toHaveCount(0, { timeout: 25_000 });
    await expect(memberCell.locator('[data-testid="proposal-inline"]')).toHaveCount(0, { timeout: 25_000 });
    await expect.poll(() => cellText(host, target), { timeout: 25_000 }).toContain("+19%");
    await expect.poll(() => cellText(member, target), { timeout: 25_000 }).toContain("+19%");
  } finally {
    await hostContext.close();
    await memberContext.close();
  }
});
