import { test, expect, type Page } from "@playwright/test";

const HAS_LIVE_BACKEND =
  !!process.env.E2E_CONVEX_URL ||
  !!process.env.VITE_CONVEX_URL ||
  process.env.E2E_LIVE_APP === "1";

test.skip(!HAS_LIVE_BACKEND, "set E2E_CONVEX_URL/VITE_CONVEX_URL or E2E_LIVE_APP=1 against a deployed live app");

async function ensureBinderOpen(page: Page) {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click();
  }
  await expect(leftRail).toBeVisible({ timeout: 10_000 });
}

async function openFreshLiveDemoRoom(page: Page, code: string) {
  await page.addInitScript(() => {
    try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ }
  });
  await page.goto(`/?demo=${code}&name=E2E`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("public-chat-panel").getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
  await ensureBinderOpen(page);
}

async function openQ3Variance(page: Page) {
  await ensureBinderOpen(page);
  await page.getByTestId("left-rail").getByRole("button", { name: /Q3 variance/ }).click();
  await expect(page.locator('[data-cell-key="r_rev__variance"]')).toBeVisible({ timeout: 30_000 });
}

function publicChat(page: Page) {
  return page.getByTestId("public-chat-panel");
}

test("fresh room public @nodeagent first send starts one visible durable job", async ({ page }) => {
  test.setTimeout(120_000);
  const code = `NA${Date.now().toString(36).toUpperCase()}`;

  await openFreshLiveDemoRoom(page, code);
  await openQ3Variance(page);

  const chat = publicChat(page);
  const prompt = "@nodeagent recompute the remaining Q3 variance cells and write the visible sheet cells only";
  await chat.getByTestId("chat-composer").fill(prompt);
  await chat.getByTestId("chat-send").click();

  await expect(chat.getByTestId("chat-message").filter({ hasText: prompt })).toBeVisible({ timeout: 15_000 });
  await expect(chat.getByTestId("agent-error")).toHaveCount(0);
  await expect(chat.getByTestId("job-status")).toContainText(/queued|running|completed|blocked|failed/i, { timeout: 30_000 });
  await expect(chat.getByTestId("job-status")).not.toContainText(/cancelled/i);

  await chat.getByTestId("job-detail-toggle").click();
  const detail = chat.getByTestId("job-detail");
  await expect(detail).toContainText(/Runtime|Policy|Model calls|Tool calls/i, { timeout: 15_000 });
  await expect(detail).toContainText(/agentJobs\.start|workflow|public_ask|auto_commit_safe|host_review/i, { timeout: 30_000 });

  const visibleStarts = await detail.getByText(/agentJobs\.start/).count();
  expect(visibleStarts).toBeLessThanOrEqual(1);
});
