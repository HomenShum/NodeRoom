/**
 * S3 of docs/design/DESIGN_QA_LADDER.md -- approved-baseline visual regression (the convergence exit).
 *
 * A settled surface matches its approved baseline and is therefore NEVER sent to the VLM, so it can never
 * be re-flagged -- the dominant fix for the perpetual-critic loop. Intentional UI changes are approved by a
 * human committing the new baseline:
 *
 *   QA_BASE_URL=http://localhost:5301 npx playwright test design-baseline --update-snapshots
 *
 * Volatile regions (room code, trace timestamps, presence) are masked so the diff is deterministic.
 */
import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.QA_BASE_URL ?? "http://localhost:5301";

type Surface = {
  name: string;
  w: number;
  h: number;
  ready: string;
  maxDiffPixelRatio?: number;
  open: (p: Page) => Promise<void>;
};
const SURFACES: Surface[] = [
  // Demo-room baselines include the intentionally moving product surface; blank-room stays strict.
  { name: "demo-room-desktop", w: 1440, h: 900, ready: "[data-testid='shell-bottom']",
    maxDiffPixelRatio: 0.12,
    open: async (p) => {
      await p.goto(`${BASE}/?mode=memory&surface=desktop&demo=BASEDESK&name=Founder`, { waitUntil: "domcontentloaded" });
      await startMemoryDemoIfNeeded(p);
    } },
  { name: "demo-room-mobile", w: 375, h: 812, ready: "[data-testid='shell-bottom']",
    maxDiffPixelRatio: 0.12,
    open: async (p) => {
      await p.goto(`${BASE}/?mode=memory&surface=desktop&demo=BASEMOB&name=Founder`, { waitUntil: "domcontentloaded" });
      await startMemoryDemoIfNeeded(p);
    } },
  { name: "blank-room", w: 1280, h: 860, ready: "[data-testid='blank-room-state'], [data-testid='shell-bottom']",
    open: async (p) => {
      await p.goto(`${BASE}/?mode=memory&surface=desktop&create=BASEBLANK&name=QA`, { waitUntil: "domcontentloaded" });
    } },
];

async function startMemoryDemoIfNeeded(page: Page): Promise<void> {
  const startButton = page.locator("[data-testid='start-demo-room']").first();
  if (!(await startButton.isVisible({ timeout: 5000 }).catch(() => false))) return;
  await page.locator("[data-testid='display-name']").fill("Founder").catch(() => undefined);
  await startButton.click();
}

async function skipTourIfPresent(page: Page): Promise<void> {
  await page.locator("[data-testid='tour-skip']").click({ timeout: 3000 }).catch(() => undefined);
}

for (const s of SURFACES) {
  test(`design baseline: ${s.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await s.open(page);
    await page.waitForSelector(s.ready, { timeout: 25000 });
    await skipTourIfPresent(page);
    await page.waitForTimeout(2200);
    // mask volatile regions so the baseline diff is deterministic (not flaky on dynamic data)
    const mask = [".r-roomcode", ".r-trace-item .td", ".r-av", ".r-avatar", "[data-testid='status-strip']"]
      .map((sel) => page.locator(sel));
    await expect(page).toHaveScreenshot(`${s.name}.png`, {
      // Approved baselines were authored on Windows; CI runs Ubuntu. Keep the
      // baseline gate active while allowing OS font/rasterization variance.
      maxDiffPixelRatio: s.maxDiffPixelRatio ?? 0.075,
      animations: "disabled",
      mask,
    });
    await ctx.close();
  });
}
