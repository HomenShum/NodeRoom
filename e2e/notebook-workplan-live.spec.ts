import { test, expect } from "@playwright/test";
import { enableFocusModeForTest, expectFocusModeOn } from "./focusMode";
import { expectLiveStarterRoomReady } from "./liveStarter";

const HAS_BACKEND = !!process.env.E2E_CONVEX_URL && !!process.env.VITE_CONVEX_URL;
test.skip(!process.env.E2E_LIVE || !HAS_BACKEND, "set E2E_LIVE=1, E2E_CONVEX_URL, and VITE_CONVEX_URL to run the live notebook work-plan vertical");

async function openNoteSurface(page: import("@playwright/test").Page) {
  const editor = page.getByTestId("note-editor");
  if (!(await editor.waitFor({ state: "visible", timeout: 8_000 }).then(() => true, () => false))) {
    const leftRail = page.getByTestId("left-rail");
    if (!(await leftRail.isVisible().catch(() => false))) {
      await page.getByRole("button", { name: "Toggle Room Binder panel" }).click();
    }
    const noteArtifact = page
      .getByTestId("left-rail")
      .getByTestId("binder-artifact")
      .filter({ hasText: /Capture Notebook|Note|Diligence memo/i })
      .first();
    if ((await noteArtifact.getAttribute("data-active").catch(() => null)) !== "true") {
      await noteArtifact.click({ force: true });
    }
  }
  await expect(page.getByTestId("note-editor")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("note-editor-loading")).toHaveCount(0);
}

test("messy notebook note becomes read model, approved work plan, queued job, and trace proof", async ({ page }) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await enableFocusModeForTest(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByTestId("create-room").click();
  await page.getByTestId("create-display-name").fill("Maya");
  await page.getByTestId("create-room-submit").click();
  await expect(page.getByTestId("public-chat-panel").getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
  await expectLiveStarterRoomReady(page);
  await expectFocusModeOn(page);

  await openNoteSurface(page);
  const editor = page.getByTestId("note-editor").locator(".ProseMirror");
  await editor.fill("Met Maya from CardioNova Health. Need to verify Series B funding, burn, runway, hospital pilot, and product launch before any shared sheet update. Ask Priya Shah for customer pilot references.");
  await expect(editor).toContainText("CardioNova Health");
  await expect(page.getByTestId("note-editor")).toBeVisible();

  // Move focus away so the synced note queues dirty metadata. The editor remains visible/editable;
  // no full-surface loading veil replaces the block during the agent-side processing window.
  await page.getByTestId("room-trace").click();
  await expect(page.getByTestId("note-editor")).toBeVisible();
  await expect(page.getByTestId("notebook-read-model")).toContainText("CardioNova Health", { timeout: 60_000 });

  await page.getByTestId("agent-work-plan-create").click();
  const plan = page.getByTestId("agent-work-plan-card").first();
  await expect(plan).toBeVisible({ timeout: 20_000 });
  await expect(plan).toContainText("CardioNova");
  await expect(plan.getByTestId("agent-work-plan-hash")).toContainText(/planHash [a-f0-9]{12}/);

  await plan.getByTestId("agent-work-plan-approve").click();
  await expect(plan).toHaveAttribute("data-status", "approved", { timeout: 30_000 });
  await expect(plan.getByTestId("agent-work-plan-job")).toContainText(/job/i);

  const chat = page.getByTestId("public-chat-panel");
  await expect(chat.getByTestId("job-status")).toContainText(/queued|running|paused|completed|blocked/i, { timeout: 30_000 });
  await chat.getByTestId("job-detail-toggle").click();
  const detail = chat.getByTestId("job-detail");
  await expect(detail).toContainText(/host_review|draft_first/i);
  await expect(detail).toContainText(/approved|workflow|mutation/i);

  const trace = page.getByTestId("room-trace");
  if ((await trace.getAttribute("data-open")) !== "true") {
    await trace.getByRole("button", { name: /Expand room trace/i }).click();
  }
  await expect(trace).toContainText(/Notebook read model updated/i);
  await expect(trace).toContainText(/Agent Work Plan approved/i);
});
