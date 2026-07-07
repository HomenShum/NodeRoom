import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { enableFocusModeForTest, expectAttentionOverlayMounted, expectFocusModeOn } from "./focusMode";

const HAS_BACKEND = !!process.env.E2E_CONVEX_URL && !!process.env.VITE_CONVEX_URL;
test.skip(!HAS_BACKEND, "set E2E_CONVEX_URL and VITE_CONVEX_URL to run broad live Convex specs");
const LIVE_VIDEO_DIR = "test-results/live-videos";

function liveContextOptions(viewport: { width: number; height: number }) {
  return process.env.PLAYWRIGHT_RECORD_VIDEO === "1"
    ? { viewport, recordVideo: { dir: LIVE_VIDEO_DIR, size: viewport } }
    : { viewport };
}

function publicChat(page: Page) {
  return page.getByTestId("public-chat-panel");
}

function privateChat(page: Page) {
  return page.getByTestId("private-chat-panel");
}

async function ensureBinderOpen(page: Page) {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click();
  }
  await expect(leftRail).toBeVisible({ timeout: 10_000 });
}

async function openLiveRoom(ctx: BrowserContext, code: string, name: string, create = false) {
  const page = await ctx.newPage();
  await enableFocusModeForTest(page);
  await page.goto(`/?${create ? "demo" : "room"}=${code}&name=${encodeURIComponent(name)}`, {
    waitUntil: "domcontentloaded",
  });
  await expect(publicChat(page).getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
  await expectFocusModeOn(page);
  await ensureBinderOpen(page);
  return page;
}

async function openArtifact(page: Page, name: RegExp) {
  await ensureBinderOpen(page);
  await page.getByTestId("left-rail").getByTestId("binder-artifact").filter({ hasText: name }).first().click();
  await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 20_000 });
}

async function openWallArtifact(page: Page) {
  await openArtifact(page, /Risk \/ opportunity wall/);
  const panel = page.getByTestId("artifact-panel");
  await expect(panel.getByTestId("wall-canvas")).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByTestId("postit-add")).toBeEnabled({ timeout: 20_000 });
  return panel;
}

async function openVarianceSheet(page: Page) {
  await ensureBinderOpen(page);
  await page.getByTestId("left-rail").getByRole("button", { name: /Q3 variance/ }).click();
  await expect(page.locator('[data-cell-key="r_rev__variance"]')).toBeVisible({ timeout: 30_000 });
}

async function expandRoomTrace(page: Page) {
  const trace = page.getByTestId("room-trace");
  if ((await trace.getAttribute("data-open")) !== "true") {
    await trace.getByRole("button", { name: /Expand room trace/ }).click();
  }
  await expect(trace).toHaveAttribute("data-open", "true", { timeout: 10_000 });
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
  const target = page.locator(`[data-cell-key="${key}"]`);
  await target.locator(".r-cell-edit").click({ timeout: 10_000 });
  const input = target.locator("input.r-cell-input");
  await input.fill(value);
  await input.press("Enter");
}

async function cellText(page: Page, key: string) {
  return (await page.locator(`[data-cell-key="${key}"]`).innerText()).trim();
}

test("live Convex covers private isolation, wall CRUD, job controls, and agent-intent proposals", async ({ browser }) => {
  test.setTimeout(240_000);
  const code = `BROAD${Date.now().toString(36).toUpperCase()}`;
  const hostContext = await browser.newContext(liveContextOptions({ width: 1360, height: 920 }));
  const memberContext = await browser.newContext(liveContextOptions({ width: 1360, height: 920 }));
  const host = await openLiveRoom(hostContext, code, "Maya", true);
  const member = await openLiveRoom(memberContext, code, "Sam");

  try {
    const publicProof = `public-live-proof-${Date.now().toString(36)}`;
    await publicChat(host).getByTestId("chat-composer").fill(publicProof);
    await publicChat(host).getByTestId("chat-send").click();
    await expect(publicChat(member).getByTestId("chat-message").filter({ hasText: publicProof })).toBeVisible({ timeout: 25_000 });

    await host.getByTestId("copilot-tab-private").click();
    const secret = `private-live-proof-${Date.now().toString(36)}`;
    await privateChat(host).getByTestId("chat-composer").fill(secret);
    await privateChat(host).getByTestId("chat-send").click();
    await expect(privateChat(host).getByTestId("chat-message").filter({ hasText: secret })).toBeVisible({ timeout: 15_000 });
    await expect(publicChat(host).getByTestId("chat-message").filter({ hasText: secret })).toHaveCount(0);
    await expect(publicChat(member).getByTestId("chat-message").filter({ hasText: secret })).toHaveCount(0);
    await member.getByTestId("copilot-tab-private").click();
    await expect(privateChat(member).getByTestId("chat-message").filter({ hasText: secret })).toHaveCount(0);
    await member.getByTestId("copilot-tab-public").click();

    const hostPanel = await openWallArtifact(host);
    const memberPanel = await openWallArtifact(member);
    const hostNotes = hostPanel.getByTestId("post-it");
    const initialCount = await hostNotes.count();
    await hostPanel.getByTestId("postit-add").click();
    await expect(hostNotes).toHaveCount(initialCount + 1, { timeout: 25_000 });
    const revised = `Live wall proof ${Date.now().toString(36)}`;
    const note = hostNotes.last();
    const noteId = await note.getAttribute("data-postit-id");
    if (!noteId) throw new Error("new post-it did not expose a stable id");
    await note.getByTestId("post-it-text").fill(revised);
    await note.getByTestId("post-it-text").evaluate((node) => (node as HTMLElement).blur());
    await expect(memberPanel.locator(`[data-postit-id="${noteId}"]`).getByTestId("post-it-text")).toContainText(revised, { timeout: 25_000 });
    await hostPanel.locator(`[data-postit-id="${noteId}"]`).getByTestId("post-it-delete").click();
    await expect(memberPanel.locator(`[data-postit-id="${noteId}"]`)).toHaveCount(0, { timeout: 25_000 });

    await openVarianceSheet(host);
    await expectAttentionOverlayMounted(host);
    await host.getByTestId("copilot-tab-public").click();
    const chat = publicChat(host);
    await chat.getByTestId("chat-composer").fill("/free fill the remaining Q3 variance cells through the long job path");
    await chat.getByTestId("chat-send").click();
    await expect(chat.getByTestId("job-status")).toContainText(/queued|running/i, { timeout: 25_000 });
    await chat.getByTestId("job-detail-toggle").click();
    await expect(chat.getByTestId("job-detail")).toContainText(/draft_first|free|workflow|frame/i, { timeout: 15_000 });
    await chat.getByTestId("job-cancel").click();
    await expect(chat.getByTestId("job-status")).toContainText("cancelled", { timeout: 25_000 });
    await chat.getByTestId("job-retry").click();
    await expect(chat.getByTestId("job-status")).toContainText(/queued|running/i, { timeout: 25_000 });
    await chat.getByTestId("job-cancel").click();
    await expect(chat.getByTestId("job-status")).toContainText("cancelled", { timeout: 25_000 });

    await setReviewMode(host);
    await openVarianceSheet(member);
    await expectAttentionOverlayMounted(member);
    await host.evaluate(() => (window as any).__runConflictDrill());
    const target = "r_rev__variance";
    await expect(host.locator(`[data-cell-key="${target}"] [data-testid="presence-flag"]`)).toContainText("NodeAgent planning", { timeout: 15_000 });
    const humanValue = "+24%";
    await editCell(host, target, humanValue);
    await expect.poll(() => cellText(member, target), { timeout: 25_000 }).toContain(humanValue);

    const hostChip = host.locator(`[data-cell-key="${target}"] [data-testid="proposal-inline"][data-semantic="true"]`);
    const memberChip = member.locator(`[data-cell-key="${target}"] [data-testid="proposal-inline"][data-semantic="true"]`);
    await expect(hostChip).toContainText("+19%", { timeout: 45_000 });
    await expect(memberChip).toContainText("+19%", { timeout: 45_000 });
    await expect(memberChip.getByTestId("proposal-inline-approve")).toHaveCount(0);
    await hostChip.getByTestId("proposal-inline-reject").hover();
    await host.waitForTimeout(1_200);
    await hostChip.getByTestId("proposal-inline-reject").click();
    await expandRoomTrace(host);
    await expect(host.getByTestId("room-trace")).toContainText("rejected", { timeout: 15_000 });
    await expect(host.locator(`[data-cell-key="${target}"] [data-testid="proposal-inline"]`)).toHaveCount(0, { timeout: 25_000 });
    await expect(member.locator(`[data-cell-key="${target}"] [data-testid="proposal-inline"]`)).toHaveCount(0, { timeout: 25_000 });
    await expect.poll(() => cellText(member, target), { timeout: 25_000 }).toContain(humanValue);
  } finally {
    await hostContext.close();
    await memberContext.close();
  }
});
