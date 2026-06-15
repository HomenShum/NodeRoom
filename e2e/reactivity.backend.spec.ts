import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * Real-backend specs. Only a live Convex backend can prove cross-client reactivity and the
 * optimistic-to-confirmed swap, so these skip unless E2E_CONVEX_URL is set and the dev server was
 * started with the matching VITE_CONVEX_URL.
 */
const HAS_BACKEND = !!process.env.E2E_CONVEX_URL;
test.skip(!HAS_BACKEND, "set E2E_CONVEX_URL (+ start dev with that VITE_CONVEX_URL) to run real-backend reactivity specs");

async function dismissTour(page: Page) {
  await page.getByRole("button", { name: "Got it" }).click({ timeout: 2_000 }).catch(() => undefined);
}

async function ensureBinderOpen(page: Page) {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click();
  }
  await expect(leftRail).toBeVisible({ timeout: 10_000 });
}

async function openLiveRoom(ctx: BrowserContext, code: string, name: string, create = false) {
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* ignore */ }
  });
  await page.goto(`/?${create ? "demo" : "room"}=${code}&name=${encodeURIComponent(name)}`);
  await dismissTour(page);
  await expect(page.getByTestId("public-chat-panel").getByTestId("chat-composer")).toBeVisible({ timeout: 20_000 });
  await ensureBinderOpen(page);
  await page.getByTestId("left-rail").getByRole("button", { name: /Q3 variance/ }).click();
  await expect(page.locator('[data-cell-key="r_rev__variance"]')).toBeVisible({ timeout: 20_000 });
  return page;
}

async function cellText(page: Page, key: string) {
  return (await page.locator(`[data-cell-key="${key}"]`).innerText()).trim();
}

test("Spec A - optimistic confirm-swap reconciles to one bubble", async ({ browser }) => {
  const ctx = await browser.newContext();
  const code = `RT${Date.now().toString(36).toUpperCase()}`;
  const page = await openLiveRoom(ctx, code, "Maya", true);
  const chat = page.getByTestId("public-chat-panel");
  const body = `e2e-${Date.now().toString(36)}`;
  await chat.getByTestId("chat-composer").fill(body);
  await chat.getByTestId("chat-send").click();

  const bubble = chat.getByTestId("chat-message").filter({ hasText: body });
  await expect(bubble).toBeVisible({ timeout: 1_000 });
  await expect(bubble).toHaveAttribute("data-state", /pending|confirmed/);
  await expect(bubble).toHaveAttribute("data-state", "confirmed", { timeout: 20_000 });
  await expect(bubble).toHaveCount(1);
  await ctx.close();
});

test("Spec B - concurrent CAS loser reverts without dropping the winner's intent", async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const code = `RT${Date.now().toString(36).toUpperCase()}`;
  const a = await openLiveRoom(ctxA, code, "Maya", true);
  const b = await openLiveRoom(ctxB, code, "Dev");

  // Both target the same cell with different values from the same baseVersion. The server CAS lets
  // exactly one win; both browsers must converge on the same canonical value.
  const cell = "r_gp__variance";
  const valueA = "+21.7%";
  const valueB = "+99.9%";
  const cellA = a.locator(`[data-cell-key="${cell}"]`);
  const cellB = b.locator(`[data-cell-key="${cell}"]`);
  await expect(cellA).toBeVisible();
  await expect(cellB).toBeVisible();

  await cellA.dblclick();
  await a.locator(".r-cell-input").fill(valueA);
  await cellB.dblclick();
  await b.locator(".r-cell-input").fill(valueB);
  await a.keyboard.press("Enter");
  await b.keyboard.press("Enter");

  await expect.poll(async () => {
    const [aText, bText] = await Promise.all([cellText(a, cell), cellText(b, cell)]);
    return aText && aText === bText ? aText : "";
  }, { timeout: 30_000 }).not.toBe("");
  expect([valueA, valueB]).toContain(await cellText(a, cell));
  await ctxA.close();
  await ctxB.close();
});
