import { expect, test, type Page } from "@playwright/test";

const viewports = [
  { width: 320, height: 568 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const longRoomTitle = "Governed diligence room with an_unbroken_identifier_that_must_not_move_review_or_overflow";

async function visibleButtonMetrics(page: Page, rootSelector: string) {
  return page.locator(rootSelector).evaluate((root) => {
    const visible = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const controls = Array.from(root.querySelectorAll<HTMLElement>("button, [role='button'], [role='menuitem']"))
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label: (element.getAttribute("aria-label") || element.textContent || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 100),
          className: element.className,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        };
      });
    return {
      controls,
      smallControls: controls.filter((control) => control.width < 44 || control.height < 44),
      overflowX: root.scrollWidth - root.clientWidth,
    };
  });
}

for (const theme of ["light", "dark"] as const) {
  for (const viewport of viewports) {
    test(`${theme} production shell ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(({ dark }) => {
        localStorage.setItem("noderoom:mobile:tweaks:v2", JSON.stringify({ dark }));
      }, { dark: theme === "dark" });
      await page.goto("/#mobile?mode=memory", { waitUntil: "domcontentloaded" });

      const app = page.locator(".na-app");
      const header = page.getByTestId("mobile-header");
      const room = page.getByTestId("mobile-room-context");
      const roomTitle = page.getByTestId("mobile-room-title");
      const review = page.getByTestId("mobile-review-action");
      const overflow = page.getByTestId("mobile-overflow-action");
      const navigation = page.getByTestId("mobile-bottom-nav");
      await expect(app).toBeVisible({ timeout: 30_000 });
      await expect(app).toHaveAttribute("data-theme", theme);
      await expect(page.locator('.na-ios-bleed[data-device-preview="false"]')).toHaveCount(1);
      await expect(page.locator(".na-preview-status, .na-preview-island, .na-preview-home-indicator")).toHaveCount(0);
      await expect(header).toBeVisible();
      await expect(page.getByTestId("mobile-review-badge")).toHaveText("4");
      await expect(page.locator(".na-fab-badge")).toHaveCount(0);
      await expect(navigation).toBeVisible();
      await expect(navigation.locator(".na-nav-item")).toHaveCount(6);

      await roomTitle.evaluate((element, title) => {
        element.textContent = title;
      }, longRoomTitle);

      const metrics = await page.evaluate(() => {
        const box = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
        };
        const mobile = document.querySelector<HTMLElement>(".na-app");
        const rootStyle = mobile ? getComputedStyle(mobile) : null;
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - window.innerWidth,
          appOverflowX: mobile ? mobile.scrollWidth - mobile.clientWidth : null,
          header: box('[data-testid="mobile-header"]'),
          room: box('[data-testid="mobile-room-context"]'),
          review: box('[data-testid="mobile-review-action"]'),
          overflow: box('[data-testid="mobile-overflow-action"]'),
          tokens: rootStyle ? {
            bg: rootStyle.getPropertyValue("--mobile-bg-app").trim(),
            accent: rootStyle.getPropertyValue("--mobile-accent").trim(),
            attention: rootStyle.getPropertyValue("--mobile-attention").trim(),
          } : null,
        };
      });

      expect(metrics.overflowX).toBeLessThanOrEqual(1);
      expect(metrics.appOverflowX).toBeLessThanOrEqual(1);
      expect(metrics.header?.height).toBe(52);
      for (const target of [metrics.room, metrics.review, metrics.overflow]) {
        expect(target?.height).toBeGreaterThanOrEqual(44);
        expect(target?.left).toBeGreaterThanOrEqual(0);
        expect(target?.right).toBeLessThanOrEqual(viewport.width);
      }
      expect(metrics.room!.right).toBeLessThanOrEqual(metrics.review!.left);
      // Light terracotta uses the contrast-safe production ink; dark keeps the
      // brighter prototype accent against the dark surface.
      expect(metrics.tokens?.accent).toBe(theme === "dark" ? "#d97757" : "#9f4f2a");
      expect(metrics.tokens?.attention).not.toBe(metrics.tokens?.accent);
      const navigationMetrics = await visibleButtonMetrics(page, '[data-testid="mobile-bottom-nav"]');
      expect(navigationMetrics.overflowX).toBeLessThanOrEqual(1);
      expect(navigationMetrics.smallControls).toEqual([]);

      await overflow.click();
      const menu = page.getByTestId("mobile-overflow-menu");
      await expect(menu).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Agent jobs" })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "People" })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Trace" })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Share" })).toBeVisible();
      await expect(menu.getByRole("menuitem", { name: "Settings" })).toBeVisible();
      const menuMetrics = await menu.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          itemHeights: Array.from(element.querySelectorAll<HTMLElement>('[role="menuitem"]')).map((item) => item.getBoundingClientRect().height),
        };
      });
      expect(menuMetrics.left).toBeGreaterThanOrEqual(0);
      expect(menuMetrics.right).toBeLessThanOrEqual(viewport.width);
      expect(menuMetrics.itemHeights.every((height) => height >= 44)).toBe(true);

      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await app.evaluate((element) => element.style.setProperty("--mobile-safe-top", "24px"));
      const safeTop = await header.evaluate((element) => element.getBoundingClientRect().top);
      expect(safeTop).toBe(24);
      await overflow.evaluate((element) => (element as HTMLElement).blur());

      const longTitleScreenshotPath = testInfo.outputPath(`mobile-long-title-${theme}-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: longTitleScreenshotPath, fullPage: false });
      await testInfo.attach("mobile-long-title-screenshot", { path: longTitleScreenshotPath, contentType: "image/png" });
      await roomTitle.evaluate((element) => { element.textContent = "Q3 Diligence"; });
      await expect(roomTitle).toHaveText("Q3 Diligence");

      const screenshotPath = testInfo.outputPath(`mobile-${theme}-${viewport.width}x${viewport.height}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: false });
      await testInfo.attach("mobile-contract-metrics", {
        body: JSON.stringify({ ...metrics, navigation: navigationMetrics }, null, 2),
        contentType: "application/json",
      });
      await testInfo.attach("mobile-contract-screenshot", { path: screenshotPath, contentType: "image/png" });
    });
  }
}

test("synthetic device chrome is explicit preview-only", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/#mobile?mode=memory&preview=device", { waitUntil: "domcontentloaded" });

  const frame = page.getByTestId("mobile-device-preview");
  await expect(frame).toBeVisible({ timeout: 30_000 });
  await expect(frame).toHaveAttribute("data-device-preview", "true");
  await expect(page.locator(".na-preview-status")).toHaveCount(1);
  await expect(page.locator(".na-preview-island")).toHaveCount(1);
  await expect(page.locator(".na-preview-home-indicator")).toHaveCount(1);
  await expect(page.locator('.na-ios-bleed[data-device-preview="false"]')).toHaveCount(0);
  const box = await frame.boundingBox();
  expect(box?.width).toBe(402);
  expect(box?.height).toBe(874);
});

test("governed deck keeps thumbnails, preview, and review controls as mobile siblings", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#mobile?mode=memory", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".na-app")).toBeVisible({ timeout: 30_000 });

  const deckCard = page.locator('.na-rcard[data-kind="deck"]');
  await expect(deckCard).toHaveCount(1);
  await deckCard.click();

  const sheet = page.locator('.na-sheet[data-open="true"]');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".na-sheet-body > .na-thumbs")).toBeVisible();
  await expect(sheet.locator(".na-sheet-body > .na-slide-toolbar")).toBeVisible();
  await expect(sheet.locator(".na-sheet-body > .na-slidewrap iframe.na-slide")).toBeVisible();
  await expect(sheet.locator(".na-thumbs > .na-slide-toolbar, .na-thumbs > .na-slidewrap")).toHaveCount(0);

  const metrics = await visibleButtonMetrics(page, '.na-sheet[data-open="true"]');
  expect(metrics.overflowX).toBeLessThanOrEqual(1);
  expect(metrics.smallControls).toEqual([]);
  await expect.poll(() => sheet.evaluate((element) => getComputedStyle(element).transform)).toBe("matrix(1, 0, 0, 1, 0, 0)");

  const screenshotPath = testInfo.outputPath("mobile-governed-deck-390x844.png");
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await testInfo.attach("mobile-governed-deck-metrics", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  });
  await testInfo.attach("mobile-governed-deck", { path: screenshotPath, contentType: "image/png" });
});

test("review and secondary mobile surfaces keep tappable controls", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#mobile?mode=memory", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".na-app")).toBeVisible({ timeout: 30_000 });

  await page.getByTestId("mobile-review-action").click();
  await expect(page.locator(".na-viewtoggle")).toBeVisible();
  const reviewMetrics = await visibleButtonMetrics(page, ".na-app");
  expect(reviewMetrics.overflowX).toBeLessThanOrEqual(1);
  expect(reviewMetrics.smallControls).toEqual([]);

  const surfaces: Array<{ label: string; sheet: string }> = [
    { label: "Agent jobs", sheet: "Agent jobs" },
    { label: "People", sheet: "Manage people" },
    { label: "Room activity", sheet: "Agents" },
    { label: "Usage", sheet: "Usage and limits" },
    { label: "Trace", sheet: "Room trace" },
    { label: "Share", sheet: "Share room" },
    { label: "Settings", sheet: "Settings" },
  ];
  const receipts: Record<string, Awaited<ReturnType<typeof visibleButtonMetrics>>> = {};

  for (const surface of surfaces) {
    await page.getByTestId("mobile-overflow-action").click();
    const menu = page.getByTestId("mobile-overflow-menu");
    await expect(menu).toBeVisible();
    await menu.getByRole("menuitem", { name: surface.label }).click();

    const sheet = page.locator('.na-sheet[data-open="true"]');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(surface.sheet);
    const metrics = await visibleButtonMetrics(page, '.na-sheet[data-open="true"]');
    receipts[surface.label] = metrics;
    expect(metrics.overflowX, surface.label).toBeLessThanOrEqual(1);
    expect(metrics.smallControls, surface.label).toEqual([]);

    const close = sheet.getByRole("button", { name: "Close", exact: true });
    await expect(close).toHaveCount(1);
    await close.click();
    await expect(sheet).toBeHidden();
  }

  await testInfo.attach("mobile-secondary-surface-metrics", {
    body: JSON.stringify({ review: reviewMetrics, surfaces: receipts }, null, 2),
    contentType: "application/json",
  });
});
