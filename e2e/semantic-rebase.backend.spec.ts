import { test, expect, type Page } from "@playwright/test";

/**
 * Live Convex CRS proof. This creates a fresh room, joins a second client, runs the host-only
 * semantic conflict drill, and verifies the review proposal fans out before host approval applies.
 */
const HAS_BACKEND = !!process.env.E2E_CONVEX_URL && !!process.env.VITE_CONVEX_URL;
test.skip(!HAS_BACKEND, "set E2E_CONVEX_URL and VITE_CONVEX_URL to run live Convex CRS specs");

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

test("live Convex semantic rebase drill fans out and applies only after host approval", async ({ browser }) => {
  test.setTimeout(120_000);
  const code = "CRS" + Date.now().toString(36).toUpperCase();
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const memberContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const host = await hostContext.newPage();
  const member = await memberContext.newPage();

  try {
    await host.goto(`/?demo=${code}&name=Maya`);
    await waitForRoom(host);
    await member.goto(`/?room=${code}&name=Dev`);
    await waitForRoom(member);

    await host.getByTestId("artifact-panel").getByTestId("collab-conflict").click();

    const target = "r_rev__variance";
    const hostCell = cell(host, target);
    const memberCell = cell(member, target);
    const hostChip = hostCell.locator('[data-testid="proposal-inline"][data-semantic="true"]');
    const memberChip = memberCell.locator('[data-testid="proposal-inline"][data-semantic="true"]');

    await expect(hostChip).toContainText("+19%", { timeout: 25_000 });
    await expect(memberChip).toContainText("+19%", { timeout: 25_000 });
    await expect(hostCell).toContainText("+24%");
    await expect(memberCell).toContainText("+24%");
    await expect(memberChip.getByTestId("proposal-inline-approve")).toHaveCount(0);
    await expect(memberChip).toContainText("host");
    await expect(host.getByTestId("room-trace")).toContainText("Semantic rebase opened", { timeout: 15_000 });

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
