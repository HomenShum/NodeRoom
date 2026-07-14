import { expect, test } from "./fixtures";

const deployedAuthEnabled = process.env.PLAYWRIGHT_DEPLOYED_AUTH === "1";

async function configurePreviewProtection(page: import("@playwright/test").Page): Promise<void> {
  const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!protectionBypass) return;
  await page.setExtraHTTPHeaders({
    "x-vercel-protection-bypass": protectionBypass,
    "x-vercel-set-bypass-cookie": "true",
  });
}

function freshCredentials(prefix: string): { email: string; password: string; nonce: string } {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    email: `${prefix}-${nonce}@example.test`,
    password: "NodeRoom-Launch-190!",
    nonce,
  };
}

async function createPasswordAccount(page: import("@playwright/test").Page, email: string, password: string): Promise<void> {
  await expect(page.getByTestId("account-auth-gate")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByTestId("sign-in-password").click();
}

async function persistedRoomKeys(page: import("@playwright/test").Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("noderoom:live:")));
}

test.describe("deployed authenticated first-user journey", () => {
  test.skip(!deployedAuthEnabled, "Set PLAYWRIGHT_DEPLOYED_AUTH=1 against an authenticated deployment.");

  test("a fresh phone creates an account, creates a room, persists, and fails closed after sign-out", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await configurePreviewProtection(page);
    const { email, password, nonce } = freshCredentials("mobile-proof");
    const message = `Fresh phone proof ${nonce}`;

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Work with AI/i })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("link", { name: "Create a room", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Create this workspace?" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Review every edit/i })).toBeChecked();
    await page.getByTestId("mobile-create-confirm").click();
    await createPasswordAccount(page, email, password);

    await expect(page.getByTestId("mobile-header")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("mobile-room-title")).toHaveText("My workspace");
    await expect(page.getByTestId("gap-firstjoin")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss first-join welcome" }).click();
    const roomUrl = page.url();
    expect(await persistedRoomKeys(page)).toHaveLength(1);

    await page.getByTestId("mobile-nav-room").click();
    await page.getByLabel("Message everyone in this room").fill(message);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByLabel("Room messages").getByText(message, { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("mobile-header")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("mobile-nav-room").click();
    await expect(page.getByLabel("Room messages").getByText(message, { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.screenshot({ path: testInfo.outputPath("authenticated-mobile-390x844.png"), fullPage: false });
    await page.getByTestId("mobile-room-context").click();
    const signOut = page.getByRole("button", { name: "Sign out of NodeRoom" });
    await signOut.scrollIntoViewIfNeeded();
    await signOut.click();
    await expect(page.getByRole("heading", { name: "NodeRoom" })).toBeVisible({ timeout: 30_000 });
    expect(await persistedRoomKeys(page)).toEqual([]);

    await page.goto(roomUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Room code")).not.toHaveValue("");
    await page.getByTestId("mobile-join-submit").click();
    await expect(page.getByTestId("account-auth-gate")).toBeVisible();
    await expect(page.getByTestId("mobile-header")).toHaveCount(0);
  });

  test("a fresh desktop user creates an account, chats, reloads, and fails closed after sign-out", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await configurePreviewProtection(page);
    const { email, password, nonce } = freshCredentials("desktop-proof");
    const message = `Fresh desktop proof ${nonce}`;

    await page.goto("/?surface=desktop", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Work with AI/i })).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("create-room").click();
    await expect(page.getByRole("heading", { name: "Start with an empty workspace" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Review every artifact edit/i })).toBeChecked();
    await page.getByTestId("create-room-submit").click();
    await createPasswordAccount(page, email, password);

    const chat = page.getByTestId("public-chat-panel");
    await expect(chat.getByTestId("chat-composer")).toBeVisible({ timeout: 60_000 });
    const roomUrl = page.url();
    expect(await persistedRoomKeys(page)).toHaveLength(1);
    await chat.getByTestId("chat-composer").fill(message);
    await chat.getByTestId("chat-send").click();
    await expect(chat.getByText(message, { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("public-chat-panel").getByText(message, { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.screenshot({ path: testInfo.outputPath("authenticated-desktop-1440x900.png"), fullPage: false });
    await page.getByTestId("room-settings-btn").click();
    await page.getByRole("button", { name: "Sign out of NodeRoom" }).click();
    await expect(page.getByRole("heading", { name: /Work with AI/i })).toBeVisible({ timeout: 30_000 });
    expect(await persistedRoomKeys(page)).toEqual([]);

    await page.goto(roomUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Join this room" })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Join this room").getByRole("button", { name: "Join room", exact: true }).click();
    await expect(page.getByTestId("account-auth-gate")).toBeVisible();
    await expect(page.getByTestId("public-chat-panel")).toHaveCount(0);
  });

  test("an authenticated sample room routes a scoped deck request and exports a governed receipt", async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await configurePreviewProtection(page);
    const { email, password } = freshCredentials("mobile-deck-proof");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Try a sample room", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Create this sample room?" })).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("mobile-sample-confirm").click();
    await createPasswordAccount(page, email, password);

    await expect(page.getByTestId("mobile-header")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("gap-firstjoin")).toBeVisible();
    await page.getByRole("button", { name: "Dismiss first-join welcome" }).click();
    await expect(page.getByTestId("mobile-sample-banner")).toContainText("Sample workspace.", { timeout: 90_000 });

    const deckCard = page.locator('.na-rcard[data-kind="deck"]');
    await expect(deckCard).toHaveCount(1, { timeout: 60_000 });
    await deckCard.click();
    const sheet = page.locator('.na-sheet[data-open="true"]');
    await expect(sheet).toBeVisible();
    await page.getByRole("tab", { name: "Plan" }).click();
    await expect(sheet.locator(".na-todos")).toBeVisible();
    await page.getByRole("tab", { name: "Slides" }).click();
    await expect(sheet.locator("iframe.na-slide")).toBeVisible();
    await sheet.getByRole("button", { name: "Scope revision request to the slide title" }).click();
    await sheet.getByPlaceholder(/Describe the change for this element/i).fill("Clarify this title using only attached room evidence.");
    await sheet.getByRole("button", { name: "Send", exact: true }).click();
    await expect(sheet.getByText(/Live request accepted/i)).toBeVisible({ timeout: 60_000 });
    await expect(sheet.getByRole("button", { name: /Accept patch/i })).toHaveCount(0);
    await page.getByRole("tab", { name: "Evidence" }).click();
    await expect(sheet.locator(".na-answer")).toBeVisible();
    await expect(sheet.locator(".na-srcclaim")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("authenticated-mobile-deck-390x844.png"), fullPage: false });

    await page.getByRole("tab", { name: "Export" }).click();
    const downloadPromise = page.waitForEvent("download");
    await sheet.getByRole("button", { name: "Download PPTX" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pptx$/i);
    await expect(page.getByTestId("mobile-deck-export-receipt")).toContainText(/Downloaded .* integrity/i, { timeout: 30_000 });
  });
});
