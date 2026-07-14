import { test, expect } from "./fixtures";

const cspConsolePattern = /content security policy|violates the following.*directive|script-src|style-src|font-src|inline script|inline event handler/i;

function uniqueRoomCode(prefix: string): string {
  return `${prefix}${Date.now().toString(36).toUpperCase().slice(-8)}`.slice(0, 12);
}

test("first-run onboarding keeps a fresh room usable without dismissing a modal", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("noderoom:tour:v1");
      localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: true, paused: false }));
    } catch {
      /* ignore */
    }
  });
  await page.goto("/?mode=memory&surface=desktop", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("start-demo-room")).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("start-demo-room").click();

  await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId("walkthrough-dock")).toBeVisible();
  await expect(page.getByTestId("guided-tour")).toHaveCount(0);

  const composer = page.getByTestId("public-chat-panel").getByTestId("chat-composer");
  await expect(composer).toBeVisible();
  await composer.fill("fresh room remains usable");
  await expect(composer).toHaveValue("fresh room remains usable");

  await page.getByTestId("walkthrough-dock-dismiss").click();
  await expect(page.getByTestId("walkthrough-dock")).toHaveCount(0);
});

test("public pages and live room route emit no CSP console violations", async ({ page }) => {
  const findings: string[] = [];
  page.on("console", (message) => {
    const text = `${message.type()}: ${message.text()}`;
    if (cspConsolePattern.test(text)) findings.push(text);
  });
  page.on("pageerror", (error) => {
    const text = `pageerror: ${error.message}`;
    if (cspConsolePattern.test(text)) findings.push(text);
  });

  const roomCode = uniqueRoomCode("NRCSP");
  const routes = ["/", "/faq/", "/brand/noderoom/", `/?demo=${roomCode}&surface=desktop&name=QA-CSP`];
  for (const route of routes) {
    await page.goto(route, { waitUntil: "load" });
    if (route.includes("?demo=")) {
      await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 45_000 });
    }
    await page.waitForTimeout(500);
  }

  expect(findings).toEqual([]);
});

test("private-route SSR boot shell covers app bootstrap before React mounts", async ({ page }) => {
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "";
  test.skip(!!baseUrl && !/localhost|127\.0\.0\.1/i.test(baseUrl), "This freezes Vite's app chunk to verify local SSR fallback markup.");

  await page.route(/\/src\/app\/main(?:\.tsx)?/i, (route) => route.abort());
  await page.goto(`/?demo=${uniqueRoomCode("NRBOOT")}&surface=desktop&name=QA-Boot`, { waitUntil: "domcontentloaded" });

  await expect(page.locator("html")).toHaveAttribute("data-app-route", "private");
  await expect(page.locator(".nr-ssr-landing")).toHaveCSS("display", "none");

  const shell = page.getByTestId("ssr-private-boot-shell");
  await expect(shell).toBeVisible();
  await expect(page.locator(".nr-boot-panel")).toBeVisible();
  await expect(shell).toHaveCSS("background-color", "rgb(9, 9, 11)");
});

test("mobile first-join notice is non-blocking before Got it", async ({ page }) => {
  test.skip(
    process.env.PLAYWRIGHT_EXPECT_MOBILE_LIVE !== "1",
    "Requires a Convex-backed deployment; run with PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1."
  );
  test.setTimeout(90_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?demo=review&name=QA-Mobile", { waitUntil: "domcontentloaded" });
  await expect.poll(() => page.url(), { message: "phone viewport should normalize into #mobile" }).toContain("#mobile?demo=review&name=QA-Mobile");

  await expect(page.locator(".na-join")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /Continue with review-every-edit/i }).click();

  await expect(page.locator(".na-app")).toBeVisible({ timeout: 45_000 });
  const firstJoin = page.getByTestId("gap-firstjoin");
  await expect(firstJoin).toBeVisible();
  await expect(firstJoin).not.toHaveAttribute("aria-modal", "true");

  const dockInput = page.locator(".na-dock-input");
  await expect(dockInput).toBeVisible();
  await dockInput.fill("mobile onboarding is non-blocking");
  await expect(dockInput).toHaveValue("mobile onboarding is non-blocking");

  await firstJoin.getByRole("button", { name: /Dismiss first-join welcome/i }).click();
  await expect(firstJoin).toHaveCount(0);
});

test("active artifact selection survives live room reload", async ({ page }) => {
  test.skip(
    process.env.PLAYWRIGHT_EXPECT_MOBILE_LIVE !== "1",
    "Requires a Convex-backed deployment; run with PLAYWRIGHT_BASE_URL=https://noderoom.live PLAYWRIGHT_REUSE_SERVER=1."
  );
  test.setTimeout(90_000);

  await page.addInitScript(() => {
    try {
      localStorage.setItem("noderoom:tour:v1", "done");
      localStorage.setItem("noderoom:focusMode:v1", JSON.stringify({ enabled: true, paused: false }));
    } catch {
      /* ignore */
    }
  });
  const roomCode = uniqueRoomCode("NRREL");
  await page.goto(`/?demo=${roomCode}&surface=desktop&name=QA-Reload`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 45_000 });

  await page.getByTestId("left-rail").getByRole("button", { name: /Q3 variance/i }).click();
  const q3Tab = page.getByTestId("artifact-tabs").getByTestId("artifact-filetab").filter({ hasText: /Q3 variance/i }).first();
  await expect(q3Tab).toHaveAttribute("data-active", "true");

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("artifact-panel")).toBeVisible({ timeout: 45_000 });
  await expect(q3Tab).toHaveAttribute("data-active", "true", { timeout: 15_000 });
});

test("landing first contentful paint stays within budget", async ({ page }) => {
  await page.goto("/", { waitUntil: "load" });
  const fcp = await page.evaluate(async () => {
    const readFcp = () => {
      const entry = performance.getEntriesByName("first-contentful-paint")[0];
      return entry ? entry.startTime : 0;
    };
    const existing = readFcp();
    if (existing > 0) return existing;
    return await new Promise<number>((resolve) => {
      let observer: PerformanceObserver | undefined;
      let settled = false;
      const finish = (value: number) => {
        if (settled) return;
        settled = true;
        observer?.disconnect();
        resolve(value);
      };
      try {
        observer = new PerformanceObserver(() => finish(readFcp()));
        observer.observe({ type: "paint", buffered: true });
      } catch {
        finish(0);
      }
      setTimeout(() => finish(readFcp()), 3_000);
    });
  });
  const budgetMs = Number(process.env.LANDING_FCP_BUDGET_MS ?? 3_500);
  expect(fcp).toBeGreaterThan(0);
  expect(fcp).toBeLessThanOrEqual(budgetMs);
});
