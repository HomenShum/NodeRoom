import { enterDemoRoom, expect, publicChat, test } from "./fixtures";

test.describe("unified public agent stream", () => {
  test.beforeEach(async ({ page }) => {
    await enterDemoRoom(page);
  });

  test("renders text and tool parts in the public chat lane while the job runs", async ({ page }) => {
    const chat = publicChat(page);

    await chat.getByTestId("chat-composer").fill("/free fill the remaining Q3 variance cells through the long job path");
    await chat.getByTestId("chat-send").click();

    const stream = chat.getByTestId("agent-unified-stream").first();
    await expect(stream).toBeVisible({ timeout: 10_000 });
    await expect(stream.getByTestId("agent-stream-text")).toContainText("Working through the visible sheet cells");
    await expect(stream).toContainText("derive_affected_set");
    await expect(stream).toContainText("patch_bundle_cas");
    await expect(chat.getByTestId("agent-operation-stream")).toHaveCount(0);
  });
});

