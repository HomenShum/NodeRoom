/**
 * Regression net for the two surfaces built this cycle — the #mobile (terra)
 * route and the #story live-interactable seven-layer StoryLab. Both run on the
 * in-browser engine (memory mode), so no backend/keys are needed.
 *
 * Run stably against any built server (the dev server reload-loops under
 * concurrent file churn):
 *   PLAYWRIGHT_REUSE_SERVER=1 PLAYWRIGHT_BASE_URL=https://noderoom.vercel.app \
 *     npx playwright test mobile-story-surfaces
 * (or point BASE_URL at a local `vite preview`).
 */
import { test, expect } from "@playwright/test";

test.describe("#story — seven layers are live-interactable (memory engine)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#story");
    await page.getByTestId("story-lab").scrollIntoViewIfNeeded({ timeout: 30_000 });
  });

  test("L4+L7 lease drill: lock blocks the agent, then smart-merges on release", async ({ page }) => {
    await page.getByTestId("story-lab-lease-run").click();
    await expect(page.getByTestId("story-lab-lease-ttl")).toBeVisible({ timeout: 15_000 });
    const steps = page.locator('[data-testid="story-lab-lease-steps"] .sl-step');
    await expect(steps).toHaveCount(4);
    await expect(page.locator('[data-testid="story-lab-lease-steps"] .sl-step.pass')).toHaveCount(4);
    // The lease really rejected NodeAgent's write (no clobber).
    await expect(page.getByTestId("story-lab-lease")).toContainText("reason:'locked'");
  });

  test("L6 semantic rebase: stale agent write → review proposal → approve re-applies at current version", async ({ page }) => {
    await page.getByTestId("story-lab-rebase-run").click();
    await expect(page.getByTestId("story-lab-rebase-proposal")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("story-lab-rebase")).toContainText("semantic_rebase");
    await page.getByTestId("story-lab-rebase-approve").click();
    const approved = page.getByTestId("story-lab-rebase-approved");
    await expect(approved).toBeVisible({ timeout: 15_000 });
    await expect(approved).toContainText("v3");
    await expect(page.getByTestId("story-lab-rebase-proposal")).toHaveCount(0);
  });

  test("L5 no-clobber: a stale-baseline write is rejected as conflict-as-data", async ({ page }) => {
    await page.locator('[data-testid="story-lab"] .sl-gridcard button.sl-btn.primary').first().click();
    const conflict = page.locator('[data-testid="story-lab"] .sl-conflict');
    await expect(conflict).toBeVisible({ timeout: 15_000 });
    await expect(conflict).toContainText(/rejected/i);
    // Editable variance cells exist (Layer 1 surface).
    await expect(page.locator('[data-testid="story-lab"] input.sl-edit').first()).toBeVisible();
  });

  test("honest non-memory layers + mobile evidence are labeled, not faked", async ({ page }) => {
    await expect(page.getByTestId("story-lab-l2l3")).toContainText(/live in the room/i);
    await expect(page.getByTestId("story-lab-l2l3")).toContainText("convex/presence.ts");
    await expect(page.getByTestId("story-lab-mobile-evidence")).toContainText("#mobile?demo=review");
  });
});

test.describe("#room-tour — scripted desktop walkthrough (Room.html port)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/#room-tour");
    await page.locator(".rt-app").waitFor({ timeout: 30_000 });
  });

  test("mounts dark, 8 step dots, landing H1, 3 feature cards", async ({ page }) => {
    await expect(page.locator(".rt-app")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".rt-stepdot")).toHaveCount(8);
    await expect(page.locator(".rt-h1")).toContainText(/bring people and/i);
    await expect(page.locator(".rt-feature")).toHaveCount(3);
  });

  test("Create modal mints an XXX-XXX share code", async ({ page }) => {
    await page.locator(".rt-stepdot").nth(1).click();
    await expect(page.locator(".rt-modal h2")).toHaveText("Create a room");
    await expect(page.locator(".rt-codecard .code")).toHaveText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
  });

  test("panel layouts grow 1 → 4 across the chat/artifact/private/navigator steps", async ({ page }) => {
    await page.locator(".rt-stepdot").nth(3).click(); // chat
    await expect(page.locator(".rt-workspace > .rt-panel")).toHaveCount(1);
    await page.locator(".rt-stepdot").nth(4).click(); // + artifact
    await expect(page.locator(".rt-workspace > .rt-panel")).toHaveCount(2);
    await expect(page.locator(".rt-panel.artifact .rt-sheet tbody tr")).toHaveCount(5);
    await page.locator(".rt-stepdot").nth(6).click(); // + navigator + private
    await expect(page.locator(".rt-workspace > .rt-panel")).toHaveCount(4);
    await expect(page.locator(".rt-panel.left .rt-file")).toHaveCount(4);
  });

  test("Step 08 collab drill: lock → draft → commit → merge advances v41 → v43", async ({ page }) => {
    await page.locator(".rt-stepdot").nth(7).click();
    await expect(page.locator(".rt-vpill.next")).toHaveText("v41");
    await page.locator(".rt-collab-bar button", { hasText: /Run collaboration/i }).click();
    // 6 beats * ~1.15s = ~7s; pad for CI slowness.
    await expect(page.locator(".rt-vpill.next")).toHaveText("v43", { timeout: 20_000 });
    await expect(page.locator(".rt-trace-item")).toHaveCount(6);
    const trace = page.locator(".rt-trace-list");
    await expect(trace).toContainText(/lock/i);
    await expect(trace).toContainText(/draft/i);
    await expect(trace).toContainText(/commit/i);
    await expect(trace).toContainText(/merge/i);
    await expect(page.locator(".rt-collab-bar button", { hasText: /Replay/i })).toBeVisible();
  });
});

test.describe("#mobile — terra surface renders (memory mode)", () => {
  test("cream surface, live room name, Home sections, FAB, no skeleton leak", async ({ page }) => {
    await page.goto("/#mobile?mode=memory");
    const na = page.locator(".na-app");
    await expect(na).toBeVisible({ timeout: 30_000 });
    // terra cream page surface (#FBF4E7).
    await expect(na).toHaveCSS("background-color", "rgb(251, 244, 231)");
    await expect(page.locator(".na-roomsw .nm")).toHaveText("Q3 Diligence");
    // The mobile app is capture-first — #mobile lands on the note capture screen,
    // not the library Home. The "N" mark (aria-label="Home") opens the Home
    // library; assert its Recents section there (the surface this test protects).
    await page.locator('.na-mark[aria-label="Home"]').click();
    await expect(page.locator(".na-kicker").filter({ hasText: "Recents" })).toBeVisible();
    // FAB lives in the dock (may sit below the phone fold) — assert presence, not visibility.
    await expect(page.locator(".na-fab-btn")).toHaveCount(1);
    // Skeletons are LIVE-hydration only — never in the offline sample.
    await expect(page.locator(".na-skel")).toHaveCount(0);
  });
});

test.describe("mobile universal landing router", () => {
  test("phone-sized public URLs land in the terracotta mobile shell", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mode=memory#rooms/expositio-pulse", { waitUntil: "domcontentloaded" });

    await expect.poll(() => page.url()).toContain("#mobile?mode=memory&from=rooms%2Fexpositio-pulse");
    const app = page.locator(".na-app");
    await expect(app).toBeVisible({ timeout: 30_000 });
    await expect(app).toHaveCSS("background-color", "rgb(251, 244, 231)");
    await expect(page.locator('[data-testid="ao-room"]')).toHaveCount(0);
  });

  test("phone-sized standard live intents normalize before the mobile app boots", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?mode=memory&create=NRMOB1&name=Codex&title=Mobile%20Room", { waitUntil: "domcontentloaded" });

    await expect.poll(() => page.url()).toContain("#mobile?mode=memory&create=NRMOB1&name=Codex&title=Mobile+Room");
    await expect(page.locator(".na-app")).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("#mobile - terra surface renders (live Convex room)", () => {
  test("demo consent creates a live room in the terracotta shell without memory mode", async ({ page }, testInfo) => {
    test.skip(
      process.env.PLAYWRIGHT_EXPECT_MOBILE_LIVE !== "1",
      "Requires a Convex-backed deployment; run with PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1."
    );
    test.setTimeout(75_000);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/?demo=review&name=Codex", { waitUntil: "domcontentloaded" });
    expect(page.url(), "live mobile proof must not use memory mode").not.toContain("mode=memory");
    await expect.poll(() => page.url(), { message: "standard live URL should normalize into #mobile on phone viewports" }).toContain("#mobile?demo=review&name=Codex");

    await expect(page.locator(".na-join")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".na-join")).toContainText(/Let agents commit edits/i);
    await page.getByRole("button", { name: /Continue with review-every-edit/i }).click();

    const app = page.locator(".na-app");
    await expect(app).toBeVisible({ timeout: 45_000 });
    expect(page.url(), "live mobile proof should land on the shareable room URL").toContain("#mobile?room=");
    expect(page.url(), "live mobile proof must still avoid memory mode after room creation").not.toContain("mode=memory");
    await expect(app).toHaveCSS("background-color", "rgb(251, 244, 231)");
    await expect(app).toContainText(/Startup Banking Diligence War Room/i);
    await expect(page.locator('[data-testid="ao-room"]')).toHaveCount(0);
    await expect(app).toContainText(/1 person is & 1 agent here/i);
    await page.getByRole("button", { name: /Got it/i }).click();
    await expect(app).not.toContainText(/1 person is & 1 agent here/i);

    const metrics = await page.evaluate(() => {
      const na = document.querySelector<HTMLElement>(".na-app");
      const style = na ? getComputedStyle(na) : null;
      return {
        url: location.href,
        hasNaApp: Boolean(na),
        bgApp: style?.getPropertyValue("--bg-app").trim(),
        accentPrimary: style?.getPropertyValue("--accent-primary").trim(),
        overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
        textSample: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 240),
      };
    });
    expect(metrics).toMatchObject({
      hasNaApp: true,
      bgApp: "#FBF4E7",
      accentPrimary: "#C56A3C",
    });
    expect(metrics.overflowX, "mobile live room should not horizontally overflow").toBeLessThanOrEqual(1);

    await testInfo.attach("mobile-live-terracotta-receipt", {
      body: JSON.stringify(metrics, null, 2),
      contentType: "application/json",
    });
    const screenshotPath = testInfo.outputPath("mobile-live-terracotta.png");
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await testInfo.attach("mobile-live-terracotta", { path: screenshotPath, contentType: "image/png" });
  });
});
