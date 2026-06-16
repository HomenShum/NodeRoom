import { test, expect, enterDemoRoom } from "./fixtures";

/**
 * Composer @-mention typeahead — one @ menu unifies the room agent (@nodeagent, the fleet's leading
 * directive) with artifact references (the Cursor/Notion @-context convention). Selecting the agent
 * inserts the "@nodeagent " directive; selecting an artifact attaches it as a reference chip.
 */
test.describe("composer @-mention", () => {
  test("@ + an artifact name attaches it as a reference and strips the token", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    const composer = page.getByTestId("copilot-panel").getByTestId("chat-composer");
    await composer.click();
    // A query that matches an artifact title (not the agent) so the first row is an artifact.
    await composer.pressSequentially("@diligence");

    const menu = page.getByTestId("mention-menu");
    await expect(menu).toBeVisible();
    const item = page.getByTestId("mention-item").first();
    await expect(item).toBeVisible();
    await item.click();

    await expect(page.locator(".r-ref-chip")).toHaveCount(1);
    await expect(composer).toHaveValue("");
    await expect(menu).toHaveCount(0);
  });

  test("a leading @ surfaces the room agent and inserts the @nodeagent directive", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    const composer = page.getByTestId("copilot-panel").getByTestId("chat-composer");
    await composer.click();
    await composer.pressSequentially("@");

    const agent = page.getByTestId("mention-agent");
    await expect(agent).toBeVisible();
    await agent.click();
    await expect(composer).toHaveValue("@nodeagent ");
  });

  test("@ + a non-matching query shows no menu (no noise)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemoRoom(page);

    const composer = page.getByTestId("copilot-panel").getByTestId("chat-composer");
    await composer.click();
    await composer.pressSequentially("hi @zzzznomatch");
    await expect(page.getByTestId("mention-menu")).toHaveCount(0);
  });
});
