/**
 * Always-On Rooms — public read-only room page (#rooms/<slug>) in the browser.
 *
 * There is no demo bundle any more: without a backend the route is an honest
 * setup-required page (checked here in memory mode). The room view itself is
 * exercised against a Convex-backed server with expositio-pulse seeded
 * (PLAYWRIGHT_EXPECT_ALWAYS_ON_LIVE=1). Exact seed-content assertions (paper
 * counts, filters, subscribe outcomes, loading/missing/error states) live in
 * tests/alwaysOnPublicRoomPage.test.tsx with an injected bundle.
 *
 * Run against a live server:
 *   PLAYWRIGHT_EXPECT_ALWAYS_ON_LIVE=1 PLAYWRIGHT_REUSE_SERVER=1 \
 *     PLAYWRIGHT_BASE_URL=http://127.0.0.1:5299 npx playwright test always-on-room
 */
import { test, expect } from "@playwright/test";

const TAB_IDS = ["ao-tab-home", "ao-tab-papers", "ao-tab-topics", "ao-tab-weekly-digest", "ao-tab-trace"] as const;

const LIVE = process.env.PLAYWRIGHT_EXPECT_ALWAYS_ON_LIVE === "1";

test.describe("#rooms/expositio-pulse — public read-only room (live)", () => {
  test.skip(!LIVE, "Requires a Convex-backed server with expositio-pulse seeded.");
  test.beforeEach(async ({ page }) => {
    await page.goto("/#rooms/expositio-pulse");
    await expect(page.getByTestId("ao-room")).toBeVisible({ timeout: 30_000 });
  });

  test("frame, five tabs, proof footer, read-only hint — and no Ops tab without ops=1", async ({ page }) => {
    await expect(page.locator(".ao-public")).toHaveAttribute("data-ao-source", "live", { timeout: 30_000 });
    await expect(page.locator(".ao-rtop")).not.toContainText("viewers this week");

    for (const id of TAB_IDS) await expect(page.getByTestId(id)).toBeVisible();
    // Ops is owner/demo chrome — ABSENT unless ops=1 is in the URL.
    await expect(page.getByTestId("ao-tab-ops")).toHaveCount(0);

    // Proof footer receipts the last run — rows visible with honest values.
    const proof = page.getByTestId("ao-proof-footer");
    await expect(proof).toBeVisible();
    await expect(proof).toContainText("Status");
    await expect(proof).toContainText("Sources checked");
    await expect(proof).toContainText("Cost");
    await expect(page.getByTestId("ao-change-postit")).toContainText(/What changed/i);

    // Read-only strip replaces the composer.
    await expect(page.locator(".ao-ro .hint")).toContainText(/viewing a public room/i);

    // NO editable surface inside the room frame: viewers read, never write.
    await expect(page.locator('[data-testid="ao-room"] textarea')).toHaveCount(0);
    await expect(page.locator('[data-testid="ao-room"] input')).toHaveCount(0);
    await expect(page.locator('[data-testid="ao-room"] [contenteditable="true"]')).toHaveCount(0);
  });

  test("each tab swaps the main surface content", async ({ page }) => {
    await expect(page.getByTestId("ao-brief-live")).toBeVisible();

    await page.getByTestId("ao-tab-papers").click();
    await expect(page.getByTestId("ao-paper-tools")).toBeVisible();
    await expect(page.getByTestId("ao-paper-count")).toContainText("papers");
    await expect(page.locator(".ao-sheet")).toBeVisible();
    await expect(page.locator(".ao-brief")).toHaveCount(0);

    await page.getByTestId("ao-tab-topics").click();
    await expect(page.getByTestId("ao-topics-live")).toBeVisible();
    await expect(page.locator(".ao-sheet")).toHaveCount(0);

    // Weekly digest: honest empty state — no fabricated digest.
    await page.getByTestId("ao-tab-weekly-digest").click();
    await expect(page.locator(".ao-empty .h")).toContainText("No weekly digest yet");

    await page.getByTestId("ao-tab-trace").click();
    await expect(page.locator(".ao-runlog")).toBeVisible();

    await page.getByTestId("ao-tab-home").click();
    await expect(page.getByTestId("ao-brief-live")).toBeVisible();
  });

  test("tabs and the proof link are keyboard-accessible", async ({ page }) => {
    const homeTab = page.getByTestId("ao-tab-home");
    const papersTab = page.getByTestId("ao-tab-papers");
    await expect(homeTab).toHaveAttribute("role", "tab");
    await expect(homeTab).toHaveAttribute("aria-selected", "true");

    await homeTab.focus();
    await homeTab.press("ArrowRight");
    await expect(papersTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("ao-paper-tools")).toBeVisible();

    await page.getByTestId("ao-proof-trace").click();
    await expect(page.getByTestId("ao-tab-trace")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".ao-runlog")).toBeVisible();
  });

  test("mobile room chrome stays clickable without clipped controls or trace overlap", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    const initial = await page.evaluate(() => {
      const doc = document.documentElement;
      const controls = Array.from(document.querySelectorAll(".ao-rtop button")).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: (el.textContent || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
          left: r.left,
          right: r.right,
          width: r.width,
          height: r.height,
        };
      });
      const tabs = document.querySelector(".ao-tabs");
      return {
        pageOverflow: doc.scrollWidth > doc.clientWidth + 1,
        clipped: controls.filter((c) => c.width > 0 && c.height > 0 && (c.left < -1 || c.right > window.innerWidth + 1)),
        tabRailScrollable: Boolean(tabs && tabs.scrollWidth >= tabs.clientWidth),
      };
    });
    expect(initial.pageOverflow).toBe(false);
    expect(initial.clipped).toEqual([]);
    expect(initial.tabRailScrollable).toBe(true);

    await page.getByTestId("ao-tab-trace").click();
    const trace = await page.evaluate(() => {
      return Array.from(document.querySelectorAll(".ao-run")).slice(0, 8).flatMap((row) => {
        const rr = row.getBoundingClientRect();
        return Array.from(row.children).flatMap((child) => {
          const cr = child.getBoundingClientRect();
          return cr.width > 0 && (cr.left < rr.left - 1 || cr.right > rr.right + 1)
            ? [{ text: (child.textContent || "").replace(/\s+/g, " ").trim(), left: cr.left, right: cr.right, rowLeft: rr.left, rowRight: rr.right }]
            : [];
        });
      });
    });
    expect(trace).toEqual([]);

    await page.getByTestId("ao-tab-papers").click();
    await expect(page.getByTestId("ao-paper-tools")).toBeVisible();
    await expect(page.getByTestId("ao-paper-cards")).toBeVisible();
    await expect(page.locator(".ao-sheet")).toBeHidden();
    await expect(page.getByTestId("ao-tab-trace")).toBeVisible();

    await page.getByTestId("ao-subscribe-btn").click();
    const modalMetrics = await page.evaluate(() => {
      const modal = document.querySelector('[data-testid="ao-subscribe-modal"]');
      const card = modal?.querySelector(".ao-modal-card");
      const input = modal?.querySelector('input[type="email"]');
      const r = card?.getBoundingClientRect();
      return {
        hasModal: Boolean(modal),
        hasEmailInput: Boolean(input),
        cardWithinViewport: Boolean(r && r.left >= -1 && r.right <= window.innerWidth + 1 && r.width > 0),
      };
    });
    expect(modalMetrics).toEqual({ hasModal: true, hasEmailInput: true, cardWithinViewport: true });
    await page.getByTestId("ao-subscribe-email").fill("reader@university.edu");
    await expect(page.getByTestId("ao-subscribe-email")).toHaveValue("reader@university.edu");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ao-subscribe-modal")).toHaveCount(0);
  });

  test("subscribe button opens the modal; Escape closes it (no undismissable chrome)", async ({ page }) => {
    await page.getByTestId("ao-subscribe-btn").click();
    const modal = page.getByTestId("ao-subscribe-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("Subscribe to");
    // Cadence radios carry the specimen sublabels.
    await expect(modal).toContainText("Daily brief");
    await expect(modal).toContainText("weekday 9:15, after the scan");
    await expect(modal).toContainText("Weekly digest");
    await expect(modal).toContainText("Act-now only");
    // Confirmation is required, but this UI must not claim an email was sent
    // until the hosted confirmation sender is wired and tested.
    await expect(modal).toContainText(/Confirmation is required/i);
    await expect(modal).not.toContainText(/Check your email/i);

    const daily = modal.getByRole("radio", { name: /Daily brief/ });
    const weekly = modal.getByRole("radio", { name: /Weekly digest/ });
    await expect(daily).toHaveAttribute("aria-checked", "true");
    await daily.press("ArrowDown");
    await expect(weekly).toHaveAttribute("aria-checked", "true");

    await page.getByRole("button", { name: "Close" }).focus();
    await page.keyboard.press("Shift+Tab");
    const trapped = await page.evaluate(() => Boolean(document.activeElement?.closest('[data-testid="ao-subscribe-modal"]')));
    expect(trapped).toBe(true);

    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
    await expect(page.getByTestId("ao-subscribe-btn")).toBeFocused();
  });

  test("scrim click also closes the modal", async ({ page }) => {
    await page.getByTestId("ao-subscribe-btn").click();
    const modal = page.getByTestId("ao-subscribe-modal");
    await expect(modal).toBeVisible();
    await modal.click({ position: { x: 8, y: 8 } });
    await expect(modal).toHaveCount(0);
  });

  test("live subscribe success is honest about pending storage vs email delivery", async ({ page }) => {
    test.skip(!process.env.PLAYWRIGHT_LIVE_SUBSCRIBE_EMAIL, "Requires an explicit disposable/live test email.");

    await page.getByTestId("ao-subscribe-btn").click();
    await page.getByTestId("ao-subscribe-email").fill(process.env.PLAYWRIGHT_LIVE_SUBSCRIBE_EMAIL!);
    await page.getByTestId("ao-subscribe-modal").getByRole("button", { name: /^Subscribe$/ }).click();

    const success = page.getByTestId("ao-subscribe-success");
    await expect(success).toContainText(/pending confirmation/i);
    await expect(success).toContainText(/no email has been sent/i);
    await expect(page.getByTestId("ao-subscribe-modal")).not.toContainText(/Check your email/i);
  });

  test("invalid email is rejected inline, not silently accepted", async ({ page }) => {
    await page.getByTestId("ao-subscribe-btn").click();
    await page.getByTestId("ao-subscribe-email").fill("not-an-email");
    await page.getByTestId("ao-subscribe-modal").getByRole("button", { name: /^Subscribe$/ }).click();
    await expect(page.getByTestId("ao-subscribe-error")).toContainText(/valid email/i);
    await expect(page.getByTestId("ao-subscribe-success")).toHaveCount(0);
  });
});

test.describe("#rooms — no backend: honest setup-required page, never demo data", () => {
  for (const route of ["/?mode=memory#rooms/expositio-pulse", "/?mode=memory#/rooms/expositio-pulse", "/?mode=memory#rooms/definitely-not-a-room"]) {
    test(`${route} renders setup-required, no room`, async ({ page }) => {
      await page.goto(route);
      await expect(page.getByTestId("setup-required")).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId("setup-required")).toContainText("VITE_CONVEX_URL");
      await expect(page.getByTestId("ao-room")).toHaveCount(0);
    });
  }
});

test.describe("#rooms — live routing, ops gate, unknown slugs", () => {
  test.skip(!LIVE, "Requires a Convex-backed server with expositio-pulse seeded.");

  test("live Convex bundle stamps source=live and hides untracked viewer counts", async ({ page }) => {
    await page.goto("/#rooms/expositio-pulse");
    await expect(page.getByTestId("ao-room")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".ao-public")).toHaveAttribute("data-ao-source", "live", { timeout: 30_000 });
    await expect(page.getByTestId("ao-brief-live")).toBeVisible();
    await expect(page.locator(".ao-rtop")).not.toContainText("viewers this week");
    await expect(page.getByTestId("ao-change-postit")).toContainText(/tracked/i);

    await page.getByTestId("ao-tab-papers").click();
    await expect(page.getByTestId("ao-paper-count")).toContainText("papers");
  });

  test("ops=1 in the hash query reveals the Ops tab and the ops panel", async ({ page }) => {
    await page.goto("/#rooms/expositio-pulse?ops=1");
    await expect(page.getByTestId("ao-room")).toBeVisible({ timeout: 30_000 });
    const opsTab = page.getByTestId("ao-tab-ops");
    await expect(opsTab).toBeVisible();
    await opsTab.click();
    await expect(page.getByTestId("ao-ops-panel")).toBeVisible({ timeout: 15_000 });
  });

  test("#/rooms/<slug> variant resolves to the same page", async ({ page }) => {
    await page.goto("/#/rooms/expositio-pulse");
    await expect(page.getByTestId("ao-room")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".ao-rtop .crumb")).toContainText("Expositio Pulse");
  });

  test("unknown slug renders an honest missing state, never relabeled data", async ({ page }) => {
    await page.goto("/#rooms/definitely-not-a-room");
    await expect(page.getByTestId("ao-room-missing")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("ao-room")).toHaveCount(0);
  });
});
