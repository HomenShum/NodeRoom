import { expect, test } from "./fixtures";

const accountGateEnabled = process.env.PLAYWRIGHT_ACCOUNT_GATE === "1";

async function expectHealthyAccountGate(page: import("@playwright/test").Page): Promise<void> {
  const gate = page.getByTestId("account-auth-gate");
  await expect(gate).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: /Sign in to create/i })).toBeVisible();
  await expect(page.getByTestId("sign-in-github")).toBeVisible();
  await expect(page.getByRole("button", { name: "Create account", exact: true })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByText(/Authentication does not make a room public/i)).toBeVisible();

  const overflow = await gate.evaluate((node) => ({
    horizontal: node.scrollWidth - node.clientWidth,
    documentHorizontal: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.horizontal).toBeLessThanOrEqual(1);
  expect(overflow.documentHorizontal).toBeLessThanOrEqual(1);

  const undersizedControls = await gate.locator("button, input").evaluateAll((nodes) => nodes
    .map((node) => ({
      label: node.getAttribute("aria-label") ?? node.textContent?.trim() ?? node.tagName,
      height: node.getBoundingClientRect().height,
    }))
    .filter((control) => control.height < 44));
  expect(undersizedControls).toEqual([]);
}

test.describe("launch account gate responsive contract", () => {
  test.skip(!accountGateEnabled, "Set PLAYWRIGHT_ACCOUNT_GATE=1 with the launch auth Vite flags.");

  test("fresh phone reaches a complete, overflow-safe account gate", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/#mobile?intent=create", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Create this workspace?" })).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("mobile-create-confirm").click();
    await expectHealthyAccountGate(page);
    await page.screenshot({ path: testInfo.outputPath("account-gate-mobile-390x844.png"), fullPage: false });
  });

  test("fresh desktop reaches the same account and privacy choices", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?surface=desktop", { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("create-room")).toBeVisible({ timeout: 30_000 });
    await page.getByTestId("create-room").click();
    await expect(page.getByRole("heading", { name: "Start with an empty workspace" })).toBeVisible();
    await page.getByTestId("create-room-submit").click();
    await expectHealthyAccountGate(page);
    await page.screenshot({ path: testInfo.outputPath("account-gate-desktop-1440x900.png"), fullPage: false });
  });
});
