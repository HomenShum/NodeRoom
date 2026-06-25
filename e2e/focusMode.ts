import { expect, type Page } from "@playwright/test";
import { FOCUS_MODE_PREF_KEY } from "../src/ui/focusMode";

export async function enableFocusModeForTest(page: Page): Promise<void> {
  await page.addInitScript((key) => {
    try {
      localStorage.setItem("noderoom:tour:v1", "done");
      localStorage.setItem(key, JSON.stringify({ enabled: true, paused: false }));
    } catch {
      // Local storage can be unavailable in unusual browser contexts; the app still renders safely.
    }
  }, FOCUS_MODE_PREF_KEY);
}

export async function expectFocusModeOn(page: Page): Promise<void> {
  await expect(page.getByTestId("focus-mode-status"), "fresh-room benchmark runs must enable Focus Mode").toHaveAttribute("data-on", "true", {
    timeout: 30_000,
  });
}

export async function expectAttentionOverlayMounted(page: Page): Promise<void> {
  await expect(page.getByTestId("attention-overlay").first(), "Focus Mode proof needs the work-surface attention overlay mounted").toBeVisible({
    timeout: 30_000,
  });
}
