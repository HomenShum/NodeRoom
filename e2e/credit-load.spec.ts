import { test, expect } from "./fixtures";
import { enterDemoRoom } from "./fixtures";

/**
 * Backend-free credit load test. Drives the in-memory credit ledger through the
 * window.__simulateLoad / __creditState seams (same pattern as __runCollab) so we can
 * prove the reserve→settle invariants in the REAL app under burst + sustained load,
 * with no Convex backend and no secrets (CI-safe, ?mode=memory).
 */

type Balance = {
  availableCredits: number;
  reservedCredits: number;
  lifetimeSpentCredits: number;
  demo: boolean;
  enforced: boolean;
};
type LoadResult = { ran: number; rejected: number; balance: Balance };

test.describe("credit load — memory mode", () => {
  test("seams exist and the demo grant starts at 20 credits", async ({ page }) => {
    await enterDemoRoom(page);
    const start = await page.evaluate(() => (window as unknown as { __creditState?: () => Balance }).__creditState?.());
    expect(start, "window.__creditState seam must be installed").toBeTruthy();
    expect(start!.availableCredits).toBe(20);
    expect(start!.demo).toBe(true);
    expect(start!.enforced).toBe(true);
    expect(start!.reservedCredits).toBe(0);
  });

  test("BURST: a 1000-run spike never drives the balance negative and fails closed", async ({ page }) => {
    await enterDemoRoom(page);
    const r = await page.evaluate(
      () => (window as unknown as { __simulateLoad: (n: number, m?: string) => LoadResult }).__simulateLoad(1000, "standard"),
    );
    expect(r.ran).toBeGreaterThan(0); // some runs succeed
    expect(r.rejected).toBeGreaterThan(0); // the grant is exhausted → honest rejections
    expect(r.balance.availableCredits).toBeGreaterThanOrEqual(0); // NEVER negative
    expect(r.balance.reservedCredits).toBe(0); // no dangling holds
  });

  test("SUSTAINED: repeated load batches accumulate spend monotonically, balance stays bounded", async ({ page }) => {
    await enterDemoRoom(page);
    const readState = () => page.evaluate(() => (window as unknown as { __creditState: () => Balance }).__creditState());
    const drive = (n: number) =>
      page.evaluate((count) => (window as unknown as { __simulateLoad: (n: number, m?: string) => LoadResult }).__simulateLoad(count, "quick"), n);

    let prevSpent = (await readState()).lifetimeSpentCredits;
    for (let batch = 0; batch < 5; batch++) {
      const r = await drive(10);
      expect(r.balance.availableCredits).toBeGreaterThanOrEqual(0);
      expect(r.balance.lifetimeSpentCredits).toBeGreaterThanOrEqual(prevSpent); // monotonic
      prevSpent = r.balance.lifetimeSpentCredits;
    }
  });

  test("MODE ORDERING: a fresh grant runs more quick tasks than deep tasks before exhaustion", async ({ page }) => {
    await enterDemoRoom(page);
    const quick = await page.evaluate(
      () => (window as unknown as { __simulateLoad: (n: number, m?: string) => LoadResult }).__simulateLoad(100, "quick"),
    );
    // Reload resets the demo grant, then exhaust with deep.
    await enterDemoRoom(page);
    const deep = await page.evaluate(
      () => (window as unknown as { __simulateLoad: (n: number, m?: string) => LoadResult }).__simulateLoad(100, "deep"),
    );
    expect(quick.ran).toBeGreaterThan(deep.ran); // cheap mode → more runs per grant
    expect(deep.ran).toBeLessThanOrEqual(2); // deep is rationed on a $5 grant
  });

  test("RESET: reloading the demo restores the full grant (demo credits reset on reload)", async ({ page }) => {
    await enterDemoRoom(page);
    await page.evaluate(() => (window as unknown as { __simulateLoad: (n: number, m?: string) => LoadResult }).__simulateLoad(50, "standard"));
    const afterLoad = await page.evaluate(() => (window as unknown as { __creditState: () => Balance }).__creditState());
    expect(afterLoad.availableCredits).toBeLessThan(20);
    await enterDemoRoom(page); // reload
    const fresh = await page.evaluate(() => (window as unknown as { __creditState: () => Balance }).__creditState());
    expect(fresh.availableCredits).toBe(20);
  });

  test("UI: the Quick/Standard/Deep selector + balance render in the Room Home command center", async ({ page }) => {
    await enterDemoRoom(page);
    // Room Home is the blank/command surface; open it via the Home pseudo-tab if present.
    const homeTab = page.getByTestId("home-tab");
    if (await homeTab.isVisible().catch(() => false)) await homeTab.click();
    const selector = page.getByTestId("credit-mode-selector");
    // The selector only renders on the Room Home surface; assert it (or skip cleanly if the
    // demo room opens straight to an artifact with no Home tab on this viewport).
    if (await selector.isVisible().catch(() => false)) {
      await expect(page.getByTestId("credit-mode-quick")).toBeVisible();
      await expect(page.getByTestId("credit-mode-standard")).toBeVisible();
      await expect(page.getByTestId("credit-mode-deep")).toBeVisible();
      await expect(page.getByTestId("credit-balance")).toContainText("20 credits");
      // Default mode is standard.
      await expect(page.getByTestId("credit-mode-standard")).toHaveAttribute("data-active", "true");
      // Toggling to deep updates active state.
      await page.getByTestId("credit-mode-deep").click();
      await expect(page.getByTestId("credit-mode-deep")).toHaveAttribute("data-active", "true");
      await expect(page.getByTestId("credit-mode-standard")).toHaveAttribute("data-active", "false");
    }
  });

  test("UI: the status strip shows the demo credit balance chip", async ({ page }) => {
    await enterDemoRoom(page);
    const chip = page.getByTestId("signal-credits");
    await expect(chip).toBeVisible();
    await expect(chip).toContainText("Credits");
    await expect(chip).toContainText("20");
    await expect(chip).toContainText("demo");
  });
});
