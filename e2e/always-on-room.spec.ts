/**
 * Always-On Rooms — public read-only room page (#rooms/<slug>).
 * The route renders fully in memory mode from the demo bundle (honest
 * specimen data), so no backend/keys are needed — same pattern as
 * mobile-story-surfaces.spec.ts.
 *
 * Run stably against any built server:
 *   PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:5299 \
 *     npx playwright test always-on-room
 * (point BASE_URL at a `vite preview` of a fresh build).
 */
import { test, expect } from "@playwright/test";

const TAB_IDS = ["ao-tab-home", "ao-tab-papers", "ao-tab-topics", "ao-tab-weekly-digest", "ao-tab-trace"] as const;

test.describe("#rooms/expositio-pulse — public read-only room", () => {
  test.beforeEach(async ({ page }) => {
    // ?mode=memory pins HAS_CONVEX=false (src/app/store.tsx): content
    // assertions stay deterministic on the demo bundle, and the subscribe
    // flow can never write to a live deployment from CI.
    await page.goto("/?mode=memory#rooms/expositio-pulse");
    await expect(page.getByTestId("ao-room")).toBeVisible({ timeout: 30_000 });
  });

  test("frame, five tabs, proof footer, read-only hint — and no Ops tab without ops=1", async ({ page }) => {
    // HONEST STAMP: memory mode is the demo bundle and says so on the DOM —
    // the page must never claim data-ao-source="live" without a real payload.
    await expect(page.locator(".ao-public")).toHaveAttribute("data-ao-source", "demo");
    // The specimen viewers chip is demo-only chrome (no viewer tracking
    // exists); it renders here and is hidden on a live bundle.
    await expect(page.locator(".ao-rtop")).toContainText("312 viewers this week");

    for (const id of TAB_IDS) await expect(page.getByTestId(id)).toBeVisible();
    // Ops is owner/demo chrome — ABSENT unless ops=1 is in the URL.
    await expect(page.getByTestId("ao-tab-ops")).toHaveCount(0);

    // Proof footer receipts the last run — rows visible with honest values.
    const proof = page.getByTestId("ao-proof-footer");
    await expect(proof).toBeVisible();
    await expect(proof).toContainText("Status");
    await expect(proof).toContainText("Sources checked");
    await expect(proof).toContainText("1 / 1 allowed");
    await expect(proof).toContainText("Cost");

    // Read-only strip replaces the composer.
    await expect(page.locator(".ao-ro .hint")).toContainText(/viewing a public room/i);

    // NO editable surface inside the room frame: viewers read, never write.
    await expect(page.locator('[data-testid="ao-room"] textarea')).toHaveCount(0);
    await expect(page.locator('[data-testid="ao-room"] input')).toHaveCount(0);
    await expect(page.locator('[data-testid="ao-room"] [contenteditable="true"]')).toHaveCount(0);
  });

  test("each tab swaps the main surface content", async ({ page }) => {
    // Home (default): the agent-authored daily brief on the paper surface.
    await expect(page.locator(".ao-brief h2")).toContainText("Expositio daily brief");
    await expect(page.locator(".ao-brief .agent-line")).toContainText(/Room NodeAgent/i);

    // Papers: sheet with the specimen rows.
    await page.getByTestId("ao-tab-papers").click();
    await expect(page.locator(".ao-sheet")).toBeVisible();
    await expect(page.locator(".ao-sheet")).toContainText("Spectral sequences without tears");
    await expect(page.locator(".ao-brief")).toHaveCount(0);

    // Topics: the hand-laid SVG graph (role=img; the head's link icon svg is aria-hidden).
    await page.getByTestId("ao-tab-topics").click();
    await expect(page.locator('.ao-graph svg[role="img"]')).toBeVisible();
    await expect(page.locator('.ao-graph svg[role="img"] .ao-gnode')).not.toHaveCount(0);
    await expect(page.locator(".ao-sheet")).toHaveCount(0);

    // Weekly digest: honest empty state — no fabricated digest.
    await page.getByTestId("ao-tab-weekly-digest").click();
    await expect(page.locator(".ao-empty .h")).toContainText("No weekly digest yet");

    // Trace: run log including the hash-skip row (the cost story in one line).
    await page.getByTestId("ao-tab-trace").click();
    await expect(page.locator(".ao-runlog")).toBeVisible();
    await expect(page.locator(".ao-runlog")).toContainText("hash unchanged");
    await expect(page.locator(".ao-run.skipped")).toContainText("0.0 cr");

    // Back Home: brief returns.
    await page.getByTestId("ao-tab-home").click();
    await expect(page.locator(".ao-brief h2")).toContainText("Expositio daily brief");
  });

  test("subscribe button opens the modal; Escape closes it (no undismissable chrome)", async ({ page }) => {
    await page.getByTestId("ao-subscribe-btn").click();
    const modal = page.getByTestId("ao-subscribe-modal");
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("Subscribe to Expositio Pulse");
    // Cadence radios carry the specimen sublabels.
    await expect(modal).toContainText("Daily brief");
    await expect(modal).toContainText("weekday 9:15, after the scan");
    await expect(modal).toContainText("Weekly digest");
    await expect(modal).toContainText("Act-now only");
    // Double-opt-in note.
    await expect(modal).toContainText(/Check your email to confirm/i);

    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
  });

  test("scrim click also closes the modal", async ({ page }) => {
    await page.getByTestId("ao-subscribe-btn").click();
    const modal = page.getByTestId("ao-subscribe-modal");
    await expect(modal).toBeVisible();
    await modal.click({ position: { x: 8, y: 8 } });
    await expect(modal).toHaveCount(0);
  });

  test("memory-mode subscribe is honest: success state carries the demo hint", async ({ page }) => {
    await page.getByTestId("ao-subscribe-btn").click();
    await page.getByTestId("ao-subscribe-email").fill("reader@university.edu");
    await page.getByTestId("ao-subscribe-modal").getByRole("button", { name: /^Subscribe$/ }).click();
    await expect(page.getByTestId("ao-subscribe-success")).toBeVisible();
    // HONEST_STATUS: memory mode never claims a stored subscription.
    await expect(page.getByTestId("ao-subscribe-demo-hint")).toContainText(/nothing was stored/i);
  });

  test("invalid email is rejected inline, not silently accepted", async ({ page }) => {
    await page.getByTestId("ao-subscribe-btn").click();
    await page.getByTestId("ao-subscribe-email").fill("not-an-email");
    await page.getByTestId("ao-subscribe-modal").getByRole("button", { name: /^Subscribe$/ }).click();
    await expect(page.getByTestId("ao-subscribe-error")).toContainText(/valid email/i);
    await expect(page.getByTestId("ao-subscribe-success")).toHaveCount(0);
  });
});

test.describe("#rooms — cold landing, ops gate, unknown slugs", () => {
  test("cold landing on the plain hash renders the room (demo fallback when no live bundle)", async ({ page }) => {
    // No ?mode=memory here on purpose: whatever the build (memory or convex
    // with the alwaysOn module not yet deployed), the page must still render
    // via the silent demo fallback — the cold-landing contract.
    await page.goto("/#rooms/expositio-pulse");
    await expect(page.getByTestId("ao-room")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".ao-rtop .crumb")).toContainText("Expositio Pulse");
  });

  test("ops=1 in the hash query reveals the Ops tab and the ops panel", async ({ page }) => {
    await page.goto("/?mode=memory#rooms/expositio-pulse?ops=1");
    await expect(page.getByTestId("ao-room")).toBeVisible({ timeout: 30_000 });
    const opsTab = page.getByTestId("ao-tab-ops");
    await expect(opsTab).toBeVisible();
    await opsTab.click();
    await expect(page.getByTestId("ao-ops-panel")).toBeVisible({ timeout: 15_000 });
  });

  test("#/rooms/<slug> variant resolves to the same page", async ({ page }) => {
    await page.goto("/?mode=memory#/rooms/expositio-pulse");
    await expect(page.getByTestId("ao-room")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".ao-rtop .crumb")).toContainText("Expositio Pulse");
  });

  test("unknown slug renders an honest missing state, never relabeled demo data", async ({ page }) => {
    await page.goto("/?mode=memory#rooms/definitely-not-a-room");
    await expect(page.getByTestId("ao-room-missing")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("ao-room")).toHaveCount(0);
  });
});
