import { type Page, type TestInfo } from "@playwright/test";
import { expect, publicChat, test } from "./fixtures";

test.use({ trace: "on", screenshot: "only-on-failure", video: "retain-on-failure" });

type BrowserHealth = {
  consoleErrors: string[];
  ignoredConsole: string[];
  pageErrors: string[];
  failedRequests: string[];
  failedResponses: string[];
};

type UxSnapshot = {
  cls: number;
  domContentLoadedMs: number | null;
  horizontalOverflowPx: number;
  loadMs: number | null;
  longTasks: number;
  maxLongTaskMs: number;
};

const CARDIONOVA_PROMPT =
  "@nodeagent diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps";

function installBrowserHealth(page: Page): BrowserHealth {
  const health: BrowserHealth = {
    consoleErrors: [],
    ignoredConsole: [],
    pageErrors: [],
    failedRequests: [],
    failedResponses: [],
  };
  const firstParty = (rawUrl: string): boolean => {
    try {
      const current = new URL(page.url());
      if (current.protocol === "about:") return false;
      const url = new URL(rawUrl);
      return url.origin === current.origin;
    } catch {
      return false;
    }
  };
  const ignoredAsset = (url: string): boolean => /\.(ico|map|png|jpg|jpeg|webp|svg)(\?|$)/i.test(url);

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Blocked script execution in 'about:srcdoc'.*allow-scripts/.test(text)) {
      health.ignoredConsole.push(text);
      return;
    }
    health.consoleErrors.push(text);
  });
  page.on("pageerror", (error) => health.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (firstParty(url) && !ignoredAsset(url)) {
      health.failedRequests.push(`${request.method()} ${url} ${request.failure()?.errorText ?? "failed"}`);
    }
  });
  page.on("response", (response) => {
    const url = response.url();
    if (firstParty(url) && response.status() >= 400 && !ignoredAsset(url)) {
      health.failedResponses.push(`${response.status()} ${url}`);
    }
  });

  return health;
}

async function installUxVitals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const target = window as unknown as {
      __noderoomUxVitals?: { cls: number; longTasks: number; maxLongTaskMs: number };
    };
    target.__noderoomUxVitals = { cls: 0, longTasks: 0, maxLongTaskMs: 0 };

    try {
      new PerformanceObserver((list) => {
        const vitals = target.__noderoomUxVitals;
        if (!vitals) return;
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!shift.hadRecentInput) vitals.cls += shift.value ?? 0;
        }
      }).observe({ type: "layout-shift", buffered: true });
    } catch {
      // Not all browser channels expose layout-shift in headless mode.
    }

    try {
      new PerformanceObserver((list) => {
        const vitals = target.__noderoomUxVitals;
        if (!vitals) return;
        for (const entry of list.getEntries()) {
          vitals.longTasks += 1;
          vitals.maxLongTaskMs = Math.max(vitals.maxLongTaskMs, Math.round(entry.duration));
        }
      }).observe({ type: "longtask", buffered: true });
    } catch {
      // Long-task observation is best-effort in test browsers.
    }
  });
}

async function collectUxSnapshot(page: Page): Promise<UxSnapshot> {
  return await page.evaluate(() => {
    const vitals = (window as unknown as {
      __noderoomUxVitals?: { cls: number; longTasks: number; maxLongTaskMs: number };
    }).__noderoomUxVitals ?? { cls: 0, longTasks: 0, maxLongTaskMs: 0 };
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const root = document.documentElement;
    const body = document.body;
    return {
      cls: Number(vitals.cls.toFixed(4)),
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : null,
      horizontalOverflowPx: Math.max(root.scrollWidth, body?.scrollWidth ?? 0) - root.clientWidth,
      loadMs: nav ? Math.round(nav.loadEventEnd - nav.startTime) : null,
      longTasks: vitals.longTasks,
      maxLongTaskMs: vitals.maxLongTaskMs,
    };
  });
}

async function attachAndAssertHealth(
  page: Page,
  testInfo: TestInfo,
  name: string,
  health: BrowserHealth,
  options: { assertPerf?: boolean } = {},
): Promise<void> {
  const ux = await collectUxSnapshot(page);
  await testInfo.attach(`${name}-browser-health`, {
    body: JSON.stringify({ health, ux }, null, 2),
    contentType: "application/json",
  });

  expect(health.consoleErrors, "browser console errors").toEqual([]);
  expect(health.pageErrors, "uncaught page errors").toEqual([]);
  expect(health.failedRequests, "first-party request failures").toEqual([]);
  expect(health.failedResponses, "first-party HTTP failures").toEqual([]);
  expect(ux.horizontalOverflowPx, "page-level horizontal overflow").toBeLessThanOrEqual(2);

  if (options.assertPerf !== false) {
    expect(ux.cls, "cumulative layout shift smoke budget").toBeLessThanOrEqual(0.15);
    expect(ux.maxLongTaskMs, "largest long task smoke budget").toBeLessThanOrEqual(750);
    if (ux.domContentLoadedMs !== null) {
      expect(ux.domContentLoadedMs, "DOM content loaded smoke budget").toBeLessThan(10_000);
    }
  }
}

async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const root = document.documentElement;
          return Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0) - root.clientWidth;
        }),
      { message: `${label} should not horizontally overflow` },
    )
    .toBeLessThanOrEqual(2);
}

async function openMobileRecent(page: Page, kind: "deck" | "sheet" | "plan" | "evidence") {
  const card = page.locator(`.na-rcard[data-kind="${kind}"]`).first();
  await expect(card).toBeVisible();
  await card.click();
  const sheet = page.locator('.na-sheet[data-open="true"]').first();
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closeMobileSheet(page: Page): Promise<void> {
  const sheet = page.locator('.na-sheet[data-open="true"]').first();
  await sheet.getByRole("button", { name: "Close" }).click();
  await expect(page.locator('.na-sheet[data-open="true"]')).toHaveCount(0);
}

async function openDesktopArtifact(page: Page, label: string): Promise<void> {
  await page
    .getByTestId("artifact-tabs")
    .getByRole("button", { name: new RegExp(label, "i") })
    .first()
    .click();
}

test.describe("full modern UX release bar", () => {
  test.setTimeout(120_000);

  test("desktop public agent shows immediate progress, mutates artifacts, and keeps browser health clean", async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installUxVitals(page);
    const health = installBrowserHealth(page);
    await page.addInitScript(() => {
      try {
        localStorage.setItem("noderoom:tour:v1", "done");
      } catch {
        // ignore
      }
    });

    await page.goto("/?mode=memory", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "NodeAgent home" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Diligence that shows its work." })).toBeVisible();
    await expect(page.getByTestId("join-room-code")).toHaveAttribute("placeholder", "ENTER CODE");
    await page.getByTestId("start-demo-room").focus();
    await expect(page.getByTestId("start-demo-room")).toBeFocused();
    await page.getByTestId("start-demo-room").click();

    await expect(page.getByTestId("artifact-panel")).toBeVisible();
    await expect(page.getByTestId("artifact-tabs")).toBeVisible();
    await expect(publicChat(page)).toBeVisible();
    await expect(page.getByTestId("shell-bottom")).toBeVisible();
    await expectNoHorizontalOverflow(page, "desktop room shell");

    const chat = publicChat(page);
    await expect(chat.getByRole("button", { name: "@nodeagent diligence CardioNova" })).toBeVisible();
    await chat.getByRole("button", { name: "@nodeagent diligence CardioNova" }).click();
    await expect(chat.getByTestId("chat-composer")).toHaveValue(CARDIONOVA_PROMPT);

    const sendStart = Date.now();
    await chat.getByTestId("chat-send").click();
    await expect(chat.getByTestId("chat-message").filter({ hasText: CARDIONOVA_PROMPT })).toBeVisible();
    await expect(
      chat.locator(".r-msg.agent").filter({ hasText: /thinking|running/i }).last(),
      "public lane should show an active agent turn before the final answer",
    ).toBeVisible({ timeout: 2_500 });
    expect(Date.now() - sendStart, "active agent turn latency").toBeLessThan(2_500);
    await expect(chat.getByTestId("chat-message").filter({ hasText: "Researched 1 company" })).toBeVisible({
      timeout: 20_000,
    });

    await openDesktopArtifact(page, "Company research");
    const panel = page.getByTestId("artifact-panel");
    const cardioRow = panel.locator(".r-research-row", { hasText: "CardioNova" });
    const statusCell = panel.locator('[data-cell-key="rc_cardionova__status"]').or(cardioRow.locator("td").nth(1)).first();
    const summaryCell = panel.locator('[data-cell-key="rc_cardionova__summary"]').or(cardioRow.locator("td").nth(3)).first();
    const fundingCell = panel.locator('[data-cell-key="rc_cardionova__funding"]').or(cardioRow.locator("td").nth(4)).first();
    const sourceCell = panel.locator('[data-cell-key="rc_cardionova__source"]').or(cardioRow.locator(".r-research-src")).first();
    const source2Cell = panel.locator('[data-cell-key="rc_cardionova__source2"]').or(cardioRow.locator(".r-research-src")).first();
    const freshCell = panel.locator('[data-cell-key="rc_cardionova__last_researched"]').or(cardioRow.locator("td").nth(6)).first();
    await expect(statusCell).toContainText(/complete/i);
    await expect(summaryCell).toContainText(/AI triage workflow/i);
    await expect(fundingCell).toContainText(/Series B profile/i);
    await expect(sourceCell).toContainText(/cardionova\.example/);
    await expect(source2Cell).toContainText(/cardionova\.example|wikipedia|fresh/i);
    await expect(freshCell).not.toBeEmpty();

    await openDesktopArtifact(page, "Q3 variance");
    await expect(panel.locator('[data-cell-key="r_gp__variance"]')).toBeVisible();
    await chat.getByTestId("chat-composer").fill("/free fill the remaining Q3 variance cells through the long job path");
    await chat.getByTestId("chat-send").click();
    await expect(chat.getByTestId("job-status")).toContainText(/running 1\/2|running/);
    const unifiedStream = chat.getByTestId("agent-unified-stream").first();
    await expect(unifiedStream).toBeVisible({ timeout: 3_000 });
    await expect(unifiedStream.getByTestId("agent-stream-text")).toContainText("Working through the visible sheet cells");
    await expect(unifiedStream).toContainText(/derive_affected_set|patch_bundle_cas|Derive Affected SET|Patch Bundle CAS/i);
    await expect(chat.getByTestId("agent-operation-stream")).toHaveCount(0);
    await expect(chat.getByTestId("chat-message").filter({ hasText: "Memory free-auto applied" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(panel.locator('[data-cell-key="r_gp__variance"]')).toContainText("+21.7%");
    await expect(panel.locator('[data-cell-key="r_ni__variance"]')).toContainText("+22.4%");

    await attachAndAssertHealth(page, testInfo, "desktop-public-agent", health);
  });

  test("mobile terracotta prototype cards are operable, traceable, and overflow-safe", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 430, height: 932 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installUxVitals(page);
    const health = installBrowserHealth(page);

    await page.goto("/#mobile?mode=memory", { waitUntil: "domcontentloaded" });
    const app = page.locator(".na-app");
    await expect(app).toBeVisible({ timeout: 30_000 });
    await expect(app).toHaveCSS("background-color", "rgb(251, 244, 231)");
    await expect(page.locator(".na-roomsw .nm")).toHaveText("Q3 Diligence");
    await expect(page.locator('[aria-label="Capture note"]')).toBeVisible();
    await expectNoHorizontalOverflow(page, "mobile capture");
    await page.getByRole("button", { name: "Home" }).click();
    await expect(page.locator(".na-kicker").filter({ hasText: "Recents" })).toBeVisible();
    await expect(page.locator(".na-skel")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, "mobile home");
    const initialUx = await collectUxSnapshot(page);
    await testInfo.attach("mobile-initial-ux", {
      body: JSON.stringify(initialUx, null, 2),
      contentType: "application/json",
    });
    expect(initialUx.cls, "mobile initial CLS smoke budget").toBeLessThanOrEqual(0.15);
    expect(initialUx.maxLongTaskMs, "mobile initial long-task smoke budget").toBeLessThanOrEqual(750);

    let sheet = await openMobileRecent(page, "deck");
    await expect(sheet).toContainText("CardioNova investor update");
    await expect(sheet.getByRole("button", { name: "Sharpen this slide" })).toBeVisible();
    await sheet.getByRole("button", { name: "Sharpen this slide" }).click();
    await expect(sheet).toContainText("Drafting a sourced patch", { timeout: 3_000 });
    await expect(sheet.getByRole("button", { name: "Accept patch" })).toBeVisible({ timeout: 5_000 });
    await sheet.getByRole("button", { name: "Accept patch" }).click();
    await expect(sheet).toContainText("patch applied");
    await closeMobileSheet(page);

    sheet = await openMobileRecent(page, "sheet");
    await expect(sheet).toContainText("Q3 diligence tracker");
    await expect(sheet).toContainText("CardioNova");
    await expect(sheet.getByRole("button", { name: "Evidence" })).toBeVisible();
    await sheet.getByRole("button", { name: "Evidence" }).click();
    await expect(sheet).toContainText("Used 2 sources");
    await expect(sheet).toContainText("Possible Series B");
    await closeMobileSheet(page);

    sheet = await openMobileRecent(page, "plan");
    await expect(sheet).toContainText("Agent work plan");
    await expect(sheet).toContainText("read-only first");
    await sheet.getByRole("button", { name: "Approve research" }).click();
    await expect(sheet).toContainText("read-only run complete", { timeout: 5_000 });
    await expect(sheet.getByRole("button", { name: "Review evidence" })).toBeVisible();
    await closeMobileSheet(page);

    sheet = await openMobileRecent(page, "evidence");
    await expect(sheet).toContainText("Evidence");
    await expect(sheet).toContainText("Possible Series B");
    await sheet.getByRole("button", { name: /lead/i }).click();
    await expect(sheet).toContainText("lead investor is unconfirmed");
    await closeMobileSheet(page);

    await page.getByRole("button", { name: "Quick actions" }).click();
    await expect(page.locator(".na-fab-fan")).toBeVisible();
    await page.getByRole("button", { name: "Ask NodeAgent" }).click();
    await expect(page.locator(".na-ask-wrap")).toHaveAttribute("data-open", "true");

    await attachAndAssertHealth(page, testInfo, "mobile-terracotta", health, { assertPerf: false });
  });
});
