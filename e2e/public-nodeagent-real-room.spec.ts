import { test, expect, type Page } from "@playwright/test";
import { enableFocusModeForTest, expectAttentionOverlayMounted, expectFocusModeOn } from "./focusMode";
import { expectLiveStarterRoomReady } from "./liveStarter";

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
  await enableFocusModeForTest(page);
  await page.goto(`/?demo=${code}&name=E2E`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("public-chat-panel").getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
  await expectFocusModeOn(page);
  await ensureBinderOpen(page);
}

async function openFreshLiveStarterRoom(page: Page) {
  await enableFocusModeForTest(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("create-room").click({ timeout: 60_000 });
  await page.getByTestId("create-room-submit").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("create-room-submit").click();
  await expect(page.getByTestId("public-chat-panel").getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
  await expectLiveStarterRoomReady(page);
  await expectFocusModeOn(page);
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
  await expectAttentionOverlayMounted(page);

  const chat = publicChat(page);
  const prompt = "@nodeagent recompute the remaining Q3 variance cells and write the visible sheet cells only";
  await chat.getByTestId("chat-composer").fill(prompt);
  await chat.getByTestId("chat-send").click();

  await expect(chat.getByTestId("chat-message").filter({ hasText: prompt })).toBeVisible({ timeout: 15_000 });
  await expect(chat.getByTestId("agent-error")).toHaveCount(0);
  await expect(chat.getByTestId("job-status")).toContainText(/queued|running|completed|blocked|failed/i, { timeout: 30_000 });
  await expect(chat.getByTestId("job-status")).not.toContainText(/cancelled/i);

  const stream = chat.getByTestId("agent-unified-stream").first();
  await expect(stream).toBeVisible({ timeout: 60_000 });
  await expect(stream.locator('[data-part="step"], [data-part="tool"], [data-testid="agent-stream-text"]').first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(chat.getByTestId("agent-operation-stream")).toHaveCount(0);

  await chat.getByTestId("job-detail-toggle").click();
  const detail = chat.getByTestId("job-detail");
  await expect(detail).toContainText(/Runtime|Policy|Model calls|Tool calls/i, { timeout: 15_000 });
  await expect(detail).toContainText(/agentJobs\.start|workflow|public_ask|auto_commit_safe|host_review/i, { timeout: 30_000 });

  const visibleStarts = await detail.getByText(/agentJobs\.start/).count();
  expect(visibleStarts).toBeLessThanOrEqual(1);
});

test("starter room public @nodeagent ask materializes a visible sheet and stream", async ({ page }) => {
  test.setTimeout(180_000);
  await openFreshLiveStarterRoom(page);

  const chat = publicChat(page);
  const prompt = "@nodeagent create me a sheet and research liveflow";
  await chat.getByTestId("chat-composer").fill(prompt);
  await chat.getByTestId("chat-send").click();

  await expect(chat.getByTestId("chat-message").filter({ hasText: prompt })).toBeVisible({ timeout: 15_000 });
  await expect(chat.getByTestId("agent-error")).toHaveCount(0);
  await expect(chat.getByTestId("job-status")).toContainText(/queued|running|completed|blocked|failed/i, { timeout: 30_000 });

  const stream = chat.getByTestId("agent-unified-stream").first();
  await expect(stream).toBeVisible({ timeout: 60_000 });
  await expect(stream.locator('[data-part="step"], [data-part="tool"], [data-testid="agent-stream-text"]').first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(chat.getByTestId("agent-operation-stream")).toHaveCount(0);
  await expect(chat.getByTestId("agent-error")).toHaveCount(0);

  await ensureBinderOpen(page);
  await expect(page.getByTestId("left-rail").getByTestId("binder-artifact").filter({ hasText: "Sheet 1" }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId("sheet-grid")).toBeVisible({ timeout: 60_000 });
  await expectAttentionOverlayMounted(page);
  await expect(page.locator('[data-element-id="r1__A"]').first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-element-id="r1__A"]').first()).toHaveClass(/r-cell/);
});
