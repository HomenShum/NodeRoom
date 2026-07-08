import { expect, type Page } from "@playwright/test";

export async function expectLiveStarterRoomReady(page: Page): Promise<void> {
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("public-chat-panel")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("left-rail")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Company research", { exact: false }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("CardioNova", { exact: false }).first()).toBeVisible({ timeout: 60_000 });
}

export async function createScratchSheetFromStarterHome(page: Page): Promise<void> {
  await expectLiveStarterRoomReady(page);
  const homeTab = page.getByTestId("home-tab");
  if (await homeTab.isVisible().catch(() => false)) await homeTab.click({ timeout: 30_000 });
  const blankSheetCta = page.getByTestId("blank-cta-sheet");
  const populatedRoomAddSheet = page.getByTestId("room-home-add-sheet");
  const addSheetCta = (await blankSheetCta.isVisible().catch(() => false))
    ? blankSheetCta
    : populatedRoomAddSheet;
  await expect(addSheetCta).toBeVisible({ timeout: 30_000 });
  await addSheetCta.click({ timeout: 30_000 });
  const sheetRow = page.getByTestId("binder-artifact").filter({ hasText: "Sheet 1" }).first();
  await expect(sheetRow).toBeVisible({ timeout: 30_000 });
  await sheetRow.click({ timeout: 30_000 });
  const sheetTab = page.getByTestId("artifact-filetab").filter({ hasText: "Sheet 1" }).first();
  if (await sheetTab.isVisible().catch(() => false)) await sheetTab.click({ timeout: 30_000 });
  await expect(page.locator('[data-testid="sheet-grid"], table[data-noderoom-surface="workSurface.sheet"]').first())
    .toBeVisible({ timeout: 30_000 });
}
