import { enterDemoRoom, expect, publicChat, test } from "./fixtures";

test.describe("privacy, job, wall, and proposal browser coverage", () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    await enterDemoRoom(page);
  });

  test("private chat messages and memory-mode agent replies do not leak into public chat", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const secret = `private-browser-proof-${Date.now().toString(36)}`;

    await page.getByTestId("copilot-tab-private").click();
    const privateChat = page.getByTestId("private-chat-panel");
    await expect(privateChat).toBeVisible();

    await privateChat.getByTestId("chat-composer").fill(secret);
    await privateChat.getByTestId("chat-send").click();

    await expect(privateChat.getByTestId("chat-message").filter({ hasText: secret })).toBeVisible();
    await expect(privateChat.getByTestId("chat-message").filter({ hasText: "Reading the room context for that" })).toBeVisible();

    await page.getByTestId("copilot-tab-public").click();
    const roomChat = publicChat(page);
    await expect(roomChat).toBeVisible();
    await expect(roomChat.getByTestId("chat-message").filter({ hasText: secret })).toHaveCount(0);
    await expect(roomChat.getByTestId("chat-message").filter({ hasText: "Reading the room context for that" })).toHaveCount(0);
  });

  test("wall post-its can be added, edited through blur commit, and deleted", async ({ page }) => {
    await page.getByTestId("left-rail").getByTestId("binder-artifact").filter({ hasText: "Risk / opportunity wall" }).first().click();
    const panel = page.getByTestId("artifact-panel");
    const wall = panel.getByTestId("wall-canvas");
    await expect(wall).toBeVisible();
    const captures = panel.getByTestId("wall-captures");

    const initialCount = await captures.getByTestId("post-it").count();
    await panel.getByTestId("postit-add").click();
    await expect(captures.getByTestId("post-it")).toHaveCount(initialCount + 1);

    const note = captures.getByTestId("post-it").last();
    await expect(note.getByTestId("post-it-text")).toHaveText("New note");

    const revised = `Browser CRUD proof ${Date.now().toString(36)}`;
    await note.getByTestId("post-it-text").fill(revised);
    await note.getByTestId("post-it-text").evaluate((node) => (node as HTMLElement).blur());
    await expect(note.getByTestId("post-it-text")).toHaveText(revised);

    await page.getByTestId("left-rail").getByTestId("binder-artifact").filter({ hasText: "Q3 variance" }).first().click();
    await page.getByTestId("left-rail").getByTestId("binder-artifact").filter({ hasText: "Risk / opportunity wall" }).first().click();
    const persisted = panel.getByTestId("wall-captures").getByTestId("post-it").filter({ hasText: revised });
    await expect(persisted).toHaveCount(1);

    await persisted.getByTestId("post-it-delete").click();
    await expect(panel.getByTestId("wall-captures").getByTestId("post-it")).toHaveCount(initialCount);
    await page.getByTestId("left-rail").getByTestId("binder-artifact").filter({ hasText: "Q3 variance" }).first().click();
    await page.getByTestId("left-rail").getByTestId("binder-artifact").filter({ hasText: "Risk / opportunity wall" }).first().click();
    await expect(panel.getByTestId("wall-captures").getByTestId("post-it").filter({ hasText: revised })).toHaveCount(0);
  });

  test("free-route job controls expose status, details, cancel, and retry in the browser", async ({ page }) => {
    await page.getByTestId("left-rail").getByTestId("binder-artifact").filter({ hasText: "Q3 variance" }).first().click();
    const panel = page.getByTestId("artifact-panel");
    const gpVariance = panel.locator('[data-cell-key="r_gp__variance"]');
    const niVariance = panel.locator('[data-cell-key="r_ni__variance"]');
    await expect(gpVariance).toBeVisible();
    await expect(niVariance).toBeVisible();
    await expect(gpVariance).not.toContainText("+21.7%");
    await expect(niVariance).not.toContainText("+22.4%");

    const chat = publicChat(page);
    await chat.getByTestId("chat-composer").fill("/free fill the remaining Q3 variance cells through the long job path");
    await chat.getByTestId("chat-send").click();

    await expect(chat.getByTestId("job-status")).toContainText("running");
    await expect(chat.getByTestId("job-cancel")).toBeVisible();

    await chat.getByTestId("job-detail-toggle").click();
    const detail = chat.getByTestId("job-detail");
    await expect(detail).toBeVisible();
    await expect(detail).toContainText("auto_commit_safe");
    await expect(detail.getByTestId("reasoning-frame-tree")).toContainText("patch");

    await chat.getByTestId("job-cancel").click();
    await expect(chat.getByTestId("job-status")).toContainText("cancelled");
    await expect(chat.getByTestId("job-retry")).toBeVisible();
    await expect(gpVariance).not.toContainText("+21.7%");
    await expect(niVariance).not.toContainText("+22.4%");

    await chat.getByTestId("job-retry").click();
    await expect(chat.getByTestId("job-status")).toContainText("running 2/2");
    // Completion: the production UX auto-hides the transient job-status tag once the
    // job succeeds (see Chat.tsx showLongJobChrome + the success-collapse useEffect,
    // mirrored by tests/chatReasoningFrames.test.tsx "collapses open successful job
    // details"). The durable signals of completion are the agent's chat message and
    // the variance cells the job actually wrote — assert those instead of the tag.
    await expect(chat.getByTestId("chat-message").filter({ hasText: "Memory free-auto applied" })).toBeVisible({ timeout: 10_000 });
    await expect(chat.getByTestId("job-cancel")).toHaveCount(0);
    await expect(gpVariance).toContainText("+21.7%");
    await expect(niVariance).toContainText("+22.4%");
    await expect(chat.getByTestId("job-error")).toHaveCount(0);
  });

  test("semantic conflict proposal reject removes the CRS suggestion without overwriting the host value", async ({ page }) => {
    await page.getByTestId("left-rail").getByRole("button", { name: /Q3 variance/ }).click();
    const panel = page.getByTestId("artifact-panel");
    const revenueVariance = panel.locator('[data-cell-key="r_rev__variance"]');
    await expect(revenueVariance).toBeVisible();

    await page.evaluate(() => (window as any).__runConflictDrill());
    const semanticChip = revenueVariance.locator('[data-testid="proposal-inline"][data-semantic="true"]');
    await expect(semanticChip).toBeVisible({ timeout: 15_000 });
    await expect(semanticChip).toContainText("+19%");
    await expect(revenueVariance).toContainText("+24%");
    await expect(panel.locator('[data-testid="proposal-card"][data-semantic="true"]').first()).toBeVisible();

    await semanticChip.getByTestId("proposal-inline-reject").click();
    await expect(revenueVariance.locator('[data-testid="proposal-inline"]')).toHaveCount(0);
    await expect(panel.locator('[data-testid="proposal-card"][data-semantic="true"]')).toHaveCount(0);
    await expect(revenueVariance).toContainText("+24%");
  });
});
