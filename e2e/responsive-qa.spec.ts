/**
 * Responsive QA probe for the June 2026 shell.
 *
 * Drives the app in MEMORY mode (no backend) across four viewports and asserts:
 *   1. no horizontal overflow,
 *   2. Work Surface is the primary visible surface,
 *   3. Room Binder tree + Copilot are visible on desktop and reachable overlays on compact screens,
 *   4. artifact tabs stay in viewport,
 *   5. shell-level Signal Tape + Status Strip remain visible.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { test, expect, enterDemoRoom, publicChat } from "./fixtures";

const VIEWPORTS = [
  { name: "phone-375x812", width: 375, height: 812 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "workspace-1024x768", width: 1024, height: 768 },
  { name: "laptop-1280x800", width: 1280, height: 800 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
  { name: "desktop-1860x900", width: 1860, height: 900 },
] as const;

const OUT_DIR = path.join("test-results", "responsive");

async function widestElements(page: import("@playwright/test").Page, limit = 5) {
  return page.evaluate((max) => {
    const vw = document.documentElement.clientWidth;
    const hits: Array<{ sel: string; right: number; width: number }> = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 1 && r.width > 0) {
        const id = el.id ? `#${el.id}` : "";
        const cls = el.className && typeof el.className === "string"
          ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
          : "";
        hits.push({ sel: `${el.tagName.toLowerCase()}${id}${cls}`, right: Math.round(r.right), width: Math.round(r.width) });
      }
    }
    return hits.sort((a, b) => b.right - a.right).slice(0, max);
  }, limit);
}

for (const vp of VIEWPORTS) {
  test(`responsive QA - ${vp.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await enterDemoRoom(page);
    await page.waitForTimeout(250);

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const shot = path.join(OUT_DIR, `${vp.name}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    testInfo.annotations.push({ type: "screenshot", description: shot });

    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    if (scrollWidth > vp.width + 1) {
      const offenders = await widestElements(page);
      testInfo.annotations.push({ type: "overflow-offenders", description: JSON.stringify(offenders) });
    }
    expect(scrollWidth, `horizontal overflow at ${vp.name}`).toBeLessThanOrEqual(vp.width + 1);

    const artifact = page.getByTestId("artifact-panel");
    const leftRail = page.getByTestId("left-rail");
    const copilot = page.getByTestId("copilot-panel");
    const tabs = page.getByTestId("artifact-tabs");
    const bottom = page.getByTestId("shell-bottom");
    const expectBinderTree = async (label: string) => {
      await expect(leftRail.getByTestId("binder-search"), `${label}: binder search is visible`).toBeVisible();
      await expect(leftRail.locator(".r-tree-section-head").first(), `${label}: binder section headers are visible`).toBeVisible();
      await expect(leftRail.locator("[data-level]").first(), `${label}: nested binder rows are visible`).toBeVisible();
    };

    await expect(artifact, "Work Surface is the primary surface").toBeVisible();
    await expect(tabs, "artifact tabs are reachable").toBeVisible();
    await expect(bottom, "Signal Tape + Status Strip remain visible").toBeVisible();

    const tabBox = await tabs.boundingBox();
    expect(tabBox, "artifact-tabs must have a bounding box").not.toBeNull();
    expect(tabBox!.x, "tab bar starts inside viewport").toBeGreaterThanOrEqual(0);
    expect(tabBox!.x + tabBox!.width, "tab bar ends inside viewport").toBeLessThanOrEqual(vp.width + 1);

    // Panel toggles stay available (the responsive contract), but LOCATION is viewport-aware:
    // compact/mid keep them in the top bar; wide (>=1200px, design-target parity) moves them into
    // the settings panel so the resting wide bar stays clean.
    const wide = vp.width >= 1200;
    if (wide) {
      await expect(page.locator(".r-top .r-toggle-group"), "wide top bar carries no panel toggles").toHaveCount(0);
      await page.getByTestId("room-settings-btn").click();
    }
    const toggles = wide
      ? page.locator('[data-testid="room-tweaks"] .r-toggle-group')
      : page.locator(".r-top .r-toggle-group");
    await expect(toggles, "panel toggles stay available").toBeVisible();
    const toggleBox = await toggles.boundingBox();
    expect(toggleBox, "panel toggle group must have a bounding box").not.toBeNull();
    expect(toggleBox!.x, "panel toggle group starts inside viewport").toBeGreaterThanOrEqual(0);
    expect(toggleBox!.x + toggleBox!.width, "panel toggle group ends inside viewport").toBeLessThanOrEqual(vp.width + 1);
    const toggleButtons = toggles.locator("button");
    await expect(toggleButtons, "Room Binder, Work Surface, and Copilot toggles exist").toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      const b = await toggleButtons.nth(i).boundingBox();
      expect(b, `panel toggle ${i} has a bounding box`).not.toBeNull();
      expect(Math.min(b!.width, b!.height), `panel toggle ${i} meets the >=24px floor`).toBeGreaterThanOrEqual(24);
    }
    if (wide) await page.getByTestId("room-settings-btn").click();

    if (vp.width > 1199) {
      // Full desktop: binder + Copilot both in flow (the binder is a narrow rail at 1200-1439).
      await expect(leftRail, "Room Binder visible on full desktop").toBeVisible();
      await expectBinderTree("full desktop");
      await expect(copilot, "Copilot visible on desktop").toBeVisible();
      await expect(publicChat(page).getByTestId("chat-composer")).toBeVisible();
    } else if (vp.width > 980) {
      // 981-1199 "Room button" band: the binder is summoned over the stage; Copilot stays in flow.
      await expect(leftRail, "Room Binder behind the Room button at 981-1199").toBeHidden();
      await expect(copilot, "Copilot stays in flow at 981-1199").toBeVisible();
      await expect(publicChat(page).getByTestId("chat-composer")).toBeVisible();

      await toggleButtons.nth(0).click();
      await expect(leftRail, "Room button opens the binder overlay").toBeVisible();
      await expectBinderTree("Room button overlay");
      await expect(copilot, "Copilot remains usable while the binder overlays").toBeVisible();
      await toggleButtons.nth(0).click();
      await expect(leftRail).toBeHidden();
    } else {
      await expect(leftRail, "Room Binder starts closed on compact screens").toBeHidden();
      await expect(copilot, "Copilot starts closed on compact screens").toBeHidden();

      await toggleButtons.nth(0).click();
      await expect(leftRail, "Room Binder overlay opens").toBeVisible();
      await expectBinderTree("compact Binder overlay");
      await toggleButtons.nth(1).click();
      await expect(leftRail).toBeHidden();
      await expect(artifact, "Work Surface returns after Binder overlay").toBeVisible();

      await toggleButtons.nth(2).click();
      await expect(copilot, "Copilot overlay opens").toBeVisible();
      await expect(publicChat(page).getByTestId("chat-composer")).toBeVisible();
      await toggleButtons.nth(2).click();
      await expect(copilot).toBeHidden();
      await expect(artifact, "Work Surface remains after closing Copilot").toBeVisible();
    }
  });
}
