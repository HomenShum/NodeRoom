import { expect, test } from "./fixtures";

async function liveSessionKeys(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("noderoom:live:")));
}

async function pendingRoomKeys(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => [
    ...Object.keys(localStorage),
    ...Object.keys(sessionStorage),
  ].filter((key) => key.startsWith("noderoom:livePending:") || key.startsWith("noderoom:mobilePending:")));
}

test.describe("fresh-user launch contract", () => {
  test("a fresh phone stays on the explanatory landing until Create is chosen", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /Work with AI/i })).toBeVisible({ timeout: 30_000 });
    expect(page.url()).not.toContain("#mobile");
    expect(await liveSessionKeys(page)).toEqual([]);

    await page.getByRole("link", { name: "Create a room", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Create this workspace?" })).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toContain("#mobile?intent=create");
    await expect(page.getByRole("radio", { name: /Review every edit/i })).toBeChecked();
    expect(page.url()).not.toContain("confirmed=1");
    expect(await liveSessionKeys(page)).toEqual([]);

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "NodeRoom" })).toBeVisible();
    expect(await liveSessionKeys(page)).toEqual([]);
  });

  test("a fresh unauthenticated phone opens and reloads the public sample without a live session", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/", { waitUntil: "domcontentloaded" });

    expect(await liveSessionKeys(page)).toEqual([]);
    expect(await pendingRoomKeys(page)).toEqual([]);
    await page.getByRole("link", { name: "Try a sample room", exact: true }).click();

    const sample = page.getByTestId("public-memory-sample");
    await expect(sample).toBeVisible({ timeout: 30_000 });
    await expect(sample).toHaveAttribute("data-sample-provenance", "synthetic-memory");
    await expect(sample).toHaveAttribute("data-read-only", "false");
    await expect(page.getByTestId("public-sample-provenance")).toContainText("Synthetic local sample");
    await expect(page.getByTestId("public-sample-provenance")).toContainText("No account, live room, provider calls, or credits");
    expect(page.url()).toContain("#mobile?mode=memory&sample=public");
    await expect(page.getByTestId("account-auth-gate")).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: /Create this sample room/i })).toHaveCount(0);
    expect(await liveSessionKeys(page)).toEqual([]);
    expect(await pendingRoomKeys(page)).toEqual([]);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("public-memory-sample")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("public-sample-provenance")).toContainText("Synthetic local sample");
    expect(await liveSessionKeys(page)).toEqual([]);
    expect(await pendingRoomKeys(page)).toEqual([]);
  });

  test("public Sample controls converge on the same memory-only route", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#mobile", { waitUntil: "domcontentloaded" });
    await page.getByTestId("mobile-sample-room").click();
    await expect(page.getByTestId("public-memory-sample")).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toContain("#mobile?mode=memory&sample=public");
    expect(await liveSessionKeys(page)).toEqual([]);

    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/?surface=desktop", { waitUntil: "domcontentloaded" });
    await page.getByTestId("try-sample-room").click();
    await expect(page.getByTestId("public-memory-sample")).toBeVisible({ timeout: 30_000 });
    expect(page.url()).toContain("#mobile?mode=memory&sample=public");
    expect(await liveSessionKeys(page)).toEqual([]);
  });

  test("opening a phone invite stages identity and access instead of autojoining", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?room=NRNOPE1", { waitUntil: "domcontentloaded" });

    await expect(page.getByLabel("Room code")).toHaveValue("NRNOPE1", { timeout: 30_000 });
    expect(page.url()).toContain("#mobile?room=NRNOPE1");
    await expect(page.getByText(/join and edit shared room content/i)).toBeVisible();
    expect(page.url()).not.toContain("confirmed=1");
    expect(await liveSessionKeys(page)).toEqual([]);
  });

  test("desktop Create and invite links also require explicit confirmation", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/?room=NRNOPE2&surface=desktop", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Join this room" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Invite holders join as editors/i)).toBeVisible();
    expect(page.url()).not.toContain("confirmed=1");
    expect(await liveSessionKeys(page)).toEqual([]);

    await page.getByRole("button", { name: "Close" }).click();
    await page.getByTestId("create-room").click();
    await expect(page.getByRole("heading", { name: "Start with an empty workspace" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Review every artifact edit/i })).toBeChecked();
    expect(await liveSessionKeys(page)).toEqual([]);
  });

  test("compact Create preflight remains scrollable and the confirm action is reachable", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/#mobile?intent=create", { waitUntil: "domcontentloaded" });

    const confirm = page.getByTestId("mobile-create-confirm");
    await expect(confirm).toBeAttached({ timeout: 30_000 });
    await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeVisible();
    const overflow = await page.locator(".na-join").evaluate((node) => ({
      horizontal: node.scrollWidth - node.clientWidth,
      vertical: node.scrollHeight - node.clientHeight,
    }));
    expect(overflow.horizontal).toBeLessThanOrEqual(1);
    expect(overflow.vertical).toBeGreaterThanOrEqual(0);
  });

  test("Create consent takes focus, traps Tab, cancels on Escape, and keeps 44px targets", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#mobile?intent=create", { waitUntil: "domcontentloaded" });

    const dialog = page.getByRole("dialog", { name: "Create this workspace?" });
    const title = page.getByRole("heading", { name: "Create this workspace?" });
    const review = page.getByRole("radio", { name: /Review every edit/i });
    const back = page.getByRole("button", { name: "Back" });
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await expect(title).toBeFocused();

    const targetSizes = await dialog.locator(".na-consent-card, .na-consent > .na-btn").evaluateAll((nodes) => (
      nodes.map((node) => {
        const rect = node.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      })
    ));
    expect(targetSizes.length).toBeGreaterThanOrEqual(4);
    for (const size of targetSizes) {
      expect(size.width).toBeGreaterThanOrEqual(44);
      expect(size.height).toBeGreaterThanOrEqual(44);
    }

    await page.keyboard.press("Shift+Tab");
    await expect(back).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(review).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "NodeRoom" })).toBeVisible();
    expect(page.url()).toContain("#mobile");
    expect(page.url()).not.toContain("confirmed=1");
    expect(await liveSessionKeys(page)).toEqual([]);
  });

  test("mobile sheets trap focus, close on Escape, and restore the trigger", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#mobile?mode=memory", { waitUntil: "domcontentloaded" });

    const deckCard = page.locator('.na-rcard[data-kind="deck"]');
    await expect(deckCard).toHaveCount(1, { timeout: 30_000 });
    await deckCard.click();
    const dialog = page.locator('.na-sheet[data-open="true"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("role", "dialog");
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(await dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(deckCard).toBeFocused();
  });
});
