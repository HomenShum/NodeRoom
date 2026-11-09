import { test, expect, type Page } from "@playwright/test";

// Persona: a host giving NodeAgent its first task in a new workspace.
// Empty directives are the degraded path; repeated attempts must never post or spend.
for (const width of [1440, 390]) {
  test(`host chooses a goal before any work starts (${width}px desktop surface)`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openRoom(page, "create=1", width);
    const chat = page.getByTestId("public-chat-panel");
    const composer = chat.getByTestId("chat-composer");
    const messages = chat.getByTestId("chat-message");
    const count = await messages.count();
    const credits = await creditState(page);

    await chat.getByTestId("chat-empty-agent-cta").click();
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue("@nodeagent ");
    await expect(messages).toHaveCount(count);
    expect(await creditState(page)).toEqual(credits);

    for (const command of ["@nodeagent ", "/ask", "/free", "/FREE   ", "@nodeagent:"]) {
      await composer.fill(command);
      await composer.press("Enter");
      await expect(chat.getByRole("status").filter({ hasText: /give NodeAgent a goal/i })).toBeVisible();
      await expect(messages).toHaveCount(count);
      await expect(chat.locator('.r-msg.agent[aria-label^="Room NodeAgent is "]')).toHaveCount(0);
      expect(await creditState(page)).toEqual(credits);
    }
    // Catch delayed queued work as well as immediate changes.
    await page.waitForTimeout(2500);
    await expect(messages).toHaveCount(count);
    expect(await creditState(page)).toEqual(credits);
    await expect(page.locator("body")).not.toContainText(/CardioNova|seeded model|upscaleX/);

    if (width === 390) await toggleChat(page);
    await page.getByTestId("home-tab").click();
    await expect(page.getByTestId("room-home")).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/CardioNova|seeded model|upscaleX/);
    expect(await overflow(page)).toBe(0);
    if (width === 390) await toggleChat(page);

    // The blank memory fixture has no public session for the default @nodeagent route.
    // Use an explicit /free goal to prove the existing deterministic job path completes.
    await composer.fill("/free summarize the files in this room");
    await composer.press("Enter");
    await expect(messages.filter({ hasText: "/free summarize the files in this room" })).toBeVisible();
    await expect.poll(async () => (await creditState(page)).lifetimeSpentCredits).toBeGreaterThan(credits.lifetimeSpentCredits);
    await expect(chat.getByTestId("agent-job-result")).toHaveAttribute("data-state", "completed", { timeout: 30_000 });
    expect(await overflow(page)).toBe(0);
  });

  test(`sample prompts remain explicit and its CTA never sends (${width}px)`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await openRoom(page, "demo=1", width);
    const chat = page.getByTestId("public-chat-panel");
    await expect(chat.getByRole("button", { name: "@nodeagent diligence CardioNova", exact: true })).toBeVisible();
    const cta = chat.getByTestId("chat-empty-agent-cta");
    if (await cta.isVisible()) {
      const count = await chat.getByTestId("chat-message").count();
      const credits = await creditState(page);
      await cta.click();
      await expect(chat.getByTestId("chat-composer")).toBeFocused();
      await expect(chat.getByTestId("chat-composer")).toHaveValue("@nodeagent ");
      await page.waitForTimeout(2500);
      await expect(chat.getByTestId("chat-message")).toHaveCount(count);
      expect(await creditState(page)).toEqual(credits);
    }
    expect(await overflow(page)).toBe(0);
  });
}

async function toggleChat(page: Page) {
  await page.getByRole("button", { name: "Toggle Copilot panel", exact: true }).click();
}
async function openRoom(page: Page, fixture: string, width: number) {
  await page.addInitScript(() => localStorage.setItem("noderoom:tour:v1", "done"));
  await page.route("**/*", async route => {
    if (!["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)) return route.abort();
    if (route.request().isNavigationRequest()) {
      const response = await route.fetch();
      // Same offline font fixture as capture.cjs; all other requests stay local.
      return route.fulfill({ response, body: (await response.text()).replace(/<link[^>]+href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^>]*>/g, "") });
    }
    return route.continue();
  });
  await page.goto(`/?mode=memory&surface=desktop&${fixture}&name=Homen`, { waitUntil: "domcontentloaded" });
  await page.getByText("Opening room").first().waitFor({ state: "hidden", timeout: 120_000 });
  await page.getByTestId("artifact-panel").waitFor({ timeout: 120_000 });
  if (width === 390) await toggleChat(page);
  await page.waitForTimeout(2500);
}
function creditState(page: Page) {
  return page.evaluate(() => (window as typeof window & { __creditState: () => { availableCredits: number; lifetimeSpentCredits: number } }).__creditState());
}
function overflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
}
