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

type Surface = { name: string; w: number; h: number; ready: string; open: (p: Page) => Promise<void> };
const SURFACES: Surface[] = [
  { name: "demo-room-desktop", w: 1440, h: 900, ready: "[data-testid='shell-bottom']",
    open: async (p) => { await p.goto(`${BASE}/?demo=BASEDESK&name=Founder`, { waitUntil: "domcontentloaded" }); } },
  { name: "demo-room-mobile", w: 375, h: 812, ready: "[data-testid='shell-bottom']",
    open: async (p) => { await p.goto(`${BASE}/?demo=BASEMOB&name=Founder`, { waitUntil: "domcontentloaded" }); } },
  { name: "blank-room", w: 1280, h: 860, ready: "[data-testid='blank-room-state'], [data-testid='shell-bottom']",
    open: async (p) => {
      await p.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      await p.waitForTimeout(700);
      await p.fill("input[placeholder='e.g. Priya']", "QA").catch(() => {});
      await p.click("[data-testid='create-room']").catch(() => {});
    } },
];

for (const s of SURFACES) {
  test(`design baseline: ${s.name}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await s.open(page);
    await page.waitForSelector(s.ready, { timeout: 25000 });
    await page.waitForTimeout(2200);
    // mask volatile regions so the baseline diff is deterministic (not flaky on dynamic data)
    const mask = [".r-roomcode", ".r-trace-item .td", ".r-av", ".r-avatar", "[data-testid='status-strip']"]
      .map((sel) => page.locator(sel));
    await expect(page).toHaveScreenshot(`${s.name}.png`, {
      maxDiffPixelRatio: 0.012,
      animations: "disabled",
      mask,
    });
    await ctx.close();
  });
}
