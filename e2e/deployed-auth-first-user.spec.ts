import { expect, test } from "./fixtures";
import type { Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const deployedAuthEnabled = process.env.PLAYWRIGHT_DEPLOYED_AUTH === "1";
type LaunchPosture = {
  schema: "noderoom-launch-posture-v1";
  identityRequired: boolean;
  launchMode: "development" | "private_pilot" | "public_launch" | "benchmark";
  creditsEnforced: boolean;
  freshRoomGrantCredits: number;
  maintenanceMode: boolean;
  globalPaused: boolean;
  providerPaused: boolean;
};
const launchPostureRef = makeFunctionReference<"query", Record<string, never>, LaunchPosture>("launchPosture:read");

async function configurePreviewProtection(page: import("@playwright/test").Page): Promise<void> {
  const protectionBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!protectionBypass) return;
  await page.setExtraHTTPHeaders({
    "x-vercel-protection-bypass": protectionBypass,
    "x-vercel-set-bypass-cookie": "true",
  });
}

async function expectDeployedReleaseIdentity(page: import("@playwright/test").Page): Promise<void> {
  const expectedAppCommit = process.env.LAUNCH_EXPECTED_APP_COMMIT;
  const expectedBackendRevision = process.env.LAUNCH_EXPECTED_BACKEND_REVISION;
  const expectedConvexUrl = process.env.LAUNCH_EXPECTED_CONVEX_URL;
  expect(expectedAppCommit, "LAUNCH_EXPECTED_APP_COMMIT is required").toBeTruthy();
  expect(expectedBackendRevision, "LAUNCH_EXPECTED_BACKEND_REVISION is required").toBeTruthy();
  expect(expectedConvexUrl, "LAUNCH_EXPECTED_CONVEX_URL is required").toBeTruthy();
  const expectedConvexDeployment = new URL(expectedConvexUrl!).hostname.split(".")[0];
  await expect.poll(() => page.evaluate(() => ({
    appCommit: document.documentElement.dataset.appCommit,
    backendRevision: document.documentElement.dataset.backendRevision,
    convexDeployment: document.documentElement.dataset.convexDeployment,
  })), { timeout: 30_000 }).toEqual({
    appCommit: expectedAppCommit,
    backendRevision: expectedBackendRevision,
    convexDeployment: expectedConvexDeployment,
  });
}

async function expectDeployedBackendPosture(): Promise<void> {
  const expectedConvexUrl = process.env.LAUNCH_EXPECTED_CONVEX_URL;
  expect(expectedConvexUrl, "LAUNCH_EXPECTED_CONVEX_URL is required").toBeTruthy();
  const posture = await new ConvexHttpClient(expectedConvexUrl!).query(launchPostureRef, {});
  expect(posture).toMatchObject({
    schema: "noderoom-launch-posture-v1",
    identityRequired: true,
    creditsEnforced: true,
    maintenanceMode: false,
    globalPaused: false,
    providerPaused: false,
  });
  expect(["private_pilot", "public_launch"]).toContain(posture.launchMode);
  expect(posture.freshRoomGrantCredits).toBeGreaterThan(0);
  expect(posture.freshRoomGrantCredits).toBeLessThanOrEqual(20);
}

async function closeActiveSheet(page: Page): Promise<void> {
  const sheet = page.locator('.na-sheet[data-open="true"]').last();
  if (await sheet.count()) {
    const close = sheet.getByRole("button", { name: "Close" }).first();
    if (await close.count()) await close.click();
  }
}

async function openLiveDeck(page: Page): Promise<ReturnType<Page["locator"]>> {
  await closeActiveSheet(page);
  await page.getByTestId("mobile-nav-home").click();
  const deckCard = page.locator('.na-rcard[data-kind="deck"]');
  await expect(deckCard).toHaveCount(1, { timeout: 60_000 });
  await deckCard.click();
  const sheet = page.locator('.na-sheet[data-open="true"]');
  await expect(sheet).toBeVisible();
  return sheet;
}

async function waitForLatestDurableJob(page: Page): Promise<void> {
  await closeActiveSheet(page);
  await page.getByTestId("mobile-overflow-action").click();
  await page.getByRole("menuitem", { name: /Agent jobs/i }).click();
  const jobsSheet = page.locator('.na-sheet[data-open="true"]');
  await expect(jobsSheet.locator(".na-jrow").first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(async () => {
    const statuses = await jobsSheet.locator(".na-jrow").evaluateAll((rows) => rows.map((row) => row.getAttribute("data-status") ?? "unknown"));
    const failed = statuses.find((status) => ["failed", "blocked", "cancelled", "paused", "unknown"].includes(status));
    if (failed) return `failed:${failed}`;
    return statuses.includes("completed") && !statuses.some((status) => ["queued", "running", "retrying"].includes(status))
      ? "completed"
      : statuses.join(",");
  }, { timeout: 180_000, intervals: [1_000, 2_000, 5_000] }).toBe("completed");
}

async function resolveLatestProposal(page: Page, action: "Approve" | "Reject"): Promise<void> {
  await closeActiveSheet(page);
  await page.getByTestId("mobile-review-action").click();
  const button = page.getByRole("button", { name: action, exact: true }).first();
  await expect(button).toBeVisible({ timeout: 60_000 });
  await button.click();
  await expect(button).toHaveCount(0, { timeout: 60_000 });
}

test.describe("deployed authenticated first-user journey", () => {
  test.skip(!deployedAuthEnabled, "Set PLAYWRIGHT_DEPLOYED_AUTH=1 against an isolated authenticated deployment.");

  test("a fresh phone creates an account, receives bounded credits, persists, and proves second-user rejoin", async ({ page, browser }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await configurePreviewProtection(page);

    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `mobile-proof-${nonce}@example.test`;
    const password = "NodeRoom-Preview-190!";
    const message = `Fresh phone proof ${nonce}`;

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expectDeployedReleaseIdentity(page);
    await expectDeployedBackendPosture();
    await expect(page.getByRole("heading", { name: /Work with AI/i })).toBeVisible({ timeout: 30_000 });

    await page.getByRole("link", { name: "Create a room", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Create this workspace?" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /Review every edit/i })).toBeChecked();
    await page.getByTestId("mobile-create-confirm").click();

    await expect(page.getByTestId("account-auth-gate")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in to create this workspace" })).toBeVisible();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByTestId("sign-in-password").click();

    await expect(page.getByTestId("mobile-header")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("mobile-room-title")).toHaveText("My workspace");
    await expect(page.getByTestId("gap-firstjoin")).toBeVisible();
    await expect(page.getByTestId("mobile-firstjoin-credits")).toContainText(/\d+(?:\.\d+)? credits \(\$\d+\.\d{2}\) available/i);
    await expect(page.getByTestId("mobile-firstjoin-credits")).toContainText(/credits may be held/i);
    await page.getByRole("button", { name: "Dismiss first-join welcome" }).click();

    const roomUrl = page.url();
    const sessionKeys = await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("noderoom:live:")));
    expect(sessionKeys).toHaveLength(1);

    await page.getByTestId("mobile-nav-room").click();
    await page.getByLabel("Message everyone in this room").fill(message);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByLabel("Room messages").getByText(message, { exact: true })).toBeVisible({ timeout: 30_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("mobile-header")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("mobile-nav-room").click();
    await expect(page.getByLabel("Room messages").getByText(message, { exact: true })).toBeVisible({ timeout: 30_000 });

    const roomCodeMatch = roomUrl.match(/[?&]room=([^&]+)/);
    expect(roomCodeMatch, "created room URL must contain the invite code").toBeTruthy();
    const roomCode = decodeURIComponent(roomCodeMatch![1]);
    const teammateEmail = `mobile-teammate-${nonce}@example.test`;
    const teammate = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const teammatePage = await teammate.newPage();
      await configurePreviewProtection(teammatePage);
      await teammatePage.goto(`/?room=${encodeURIComponent(roomCode)}`, { waitUntil: "domcontentloaded" });
      await expectDeployedReleaseIdentity(teammatePage);
      await expect(teammatePage.getByLabel("Room code")).toHaveValue(roomCode);
      await teammatePage.getByLabel("Your name").fill("Teammate");
      await teammatePage.getByTestId("mobile-join-submit").click();
      await expect(teammatePage.getByTestId("account-auth-gate")).toBeVisible();
      await teammatePage.getByRole("button", { name: "Create account", exact: true }).click();
      await teammatePage.getByLabel("Email").fill(teammateEmail);
      await teammatePage.getByLabel("Password").fill(password);
      await teammatePage.getByTestId("sign-in-password").click();
      await expect(teammatePage.getByTestId("mobile-room-title")).toHaveText("My workspace", { timeout: 60_000 });
      await teammatePage.getByRole("button", { name: "Dismiss first-join welcome" }).click();

      await teammatePage.getByTestId("mobile-room-context").click();
      const teammateSignOut = teammatePage.getByRole("button", { name: "Sign out of NodeRoom" });
      await teammateSignOut.scrollIntoViewIfNeeded();
      await teammateSignOut.click();
      await expect(teammatePage.getByRole("heading", { name: "NodeRoom" })).toBeVisible({ timeout: 30_000 });

      await teammatePage.goto(`/?room=${encodeURIComponent(roomCode)}`, { waitUntil: "domcontentloaded" });
      await teammatePage.getByLabel("Your name").fill("Teammate");
      await teammatePage.getByTestId("mobile-join-submit").click();
      await expect(teammatePage.getByTestId("account-auth-gate")).toBeVisible();
      await teammatePage.getByLabel("Email").fill(teammateEmail);
      await teammatePage.getByLabel("Password").fill(password);
      await teammatePage.getByTestId("sign-in-password").click();
      await expect(teammatePage.getByTestId("mobile-room-title")).toHaveText("My workspace", { timeout: 60_000 });
    } finally {
      await teammate.close();
    }

    await page.getByTestId("mobile-room-context").click();
    const signOut = page.getByRole("button", { name: "Sign out of NodeRoom" });
    await signOut.scrollIntoViewIfNeeded();
    await signOut.click();
    await expect(page.getByRole("heading", { name: "NodeRoom" })).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("noderoom:live:")))).toEqual([]);

    await page.goto(roomUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByLabel("Room code")).not.toHaveValue("");
    await page.getByTestId("mobile-join-submit").click();
    await expect(page.getByTestId("account-auth-gate")).toBeVisible();
    await expect(page.getByTestId("mobile-header")).toHaveCount(0);
  });

  test("an explicit authenticated live demo routes a scoped deck request and exports a governed receipt", async ({ page }, testInfo) => {
    test.setTimeout(540_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await configurePreviewProtection(page);

    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await page.goto("/?demo=review", { waitUntil: "domcontentloaded" });
    await expectDeployedReleaseIdentity(page);
    await expectDeployedBackendPosture();
    await expect(page.getByRole("heading", { name: "Create this sample room?" })).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("mobile-sample-confirm").click();

    await expect(page.getByTestId("account-auth-gate")).toBeVisible();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByLabel("Email").fill(`mobile-deck-proof-${nonce}@example.test`);
    await page.getByLabel("Password").fill("NodeRoom-Preview-190!");
    await page.getByTestId("sign-in-password").click();

    await expect(page.getByTestId("mobile-header")).toBeVisible({ timeout: 60_000 });
    const firstJoin = page.getByTestId("gap-firstjoin");
    await expect(firstJoin).toBeVisible();
    await expect(page.getByTestId("mobile-firstjoin-credits")).toContainText(/credits may be held/i);
    await page.getByRole("button", { name: "Dismiss first-join welcome" }).click();
    await expect(page.getByTestId("mobile-sample-banner")).toContainText("Sample workspace.", { timeout: 90_000 });

    let sheet = await openLiveDeck(page);
    await page.getByRole("tab", { name: "Plan" }).click();
    await expect(sheet.locator(".na-todos")).toBeVisible();
    await page.getByRole("tab", { name: "Slides" }).click();
    await expect(sheet.locator("iframe.na-slide")).toBeVisible();
    await expect(page.getByTestId("mobile-deck-cost-estimate")).toContainText(/estimate \$\d+\.\d{2}-\$\d+\.\d{2}.*credits.*may be held/i);

    await sheet.getByRole("button", { name: "Scope revision request to the slide title" }).click();
    await sheet.getByPlaceholder(/Describe the change for this element/i).fill("Clarify this title using only attached room evidence.");
    await sheet.getByRole("button", { name: "Send", exact: true }).click();
    await expect(sheet.getByText(/Live request accepted/i)).toBeVisible({ timeout: 60_000 });
    await expect(sheet.getByRole("button", { name: /Accept patch/i })).toHaveCount(0);

    await waitForLatestDurableJob(page);
    await resolveLatestProposal(page, "Approve");

    sheet = await openLiveDeck(page);
    await page.getByRole("tab", { name: "Slides" }).click();
    await sheet.getByRole("button", { name: "Scope revision request to the slide title" }).click();
    await sheet.getByPlaceholder(/Describe the change for this element/i).fill("Propose a second sourced title revision so the host can reject it without changing the deck.");
    await sheet.getByRole("button", { name: "Send", exact: true }).click();
    await expect(sheet.getByText(/Live request accepted/i)).toBeVisible({ timeout: 60_000 });
    await waitForLatestDurableJob(page);
    await resolveLatestProposal(page, "Reject");

    sheet = await openLiveDeck(page);

    await page.getByRole("tab", { name: "Evidence" }).click();
    await expect(sheet.locator(".na-answer")).toBeVisible();
    await expect(sheet.locator(".na-srcclaim")).toBeVisible();

    const screenshotPath = testInfo.outputPath("deployed-auth-mobile-deck-390x844.png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await testInfo.attach("deployed-auth-mobile-deck", { path: screenshotPath, contentType: "image/png" });

    await page.getByRole("tab", { name: "Export" }).click();
    const downloadPromise = page.waitForEvent("download");
    await sheet.getByRole("button", { name: "Download PPTX" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.pptx$/i);
    await expect(page.getByTestId("mobile-deck-export-receipt")).toContainText(/Download started .* SHA-256 [a-f0-9]{64} .* receipt synced/i, { timeout: 30_000 });
    const receiptText = await page.getByTestId("mobile-deck-export-receipt").innerText();
    const receiptHash = receiptText.match(/[a-f0-9]{64}/i)?.[0];
    expect(receiptHash).toBeTruthy();

    await page.reload({ waitUntil: "domcontentloaded" });
    await expectDeployedReleaseIdentity(page);
    sheet = await openLiveDeck(page);
    await page.getByRole("tab", { name: "Export" }).click();
    await expect(page.getByTestId("mobile-deck-export-receipt")).toContainText(receiptHash!, { timeout: 60_000 });
  });
});
