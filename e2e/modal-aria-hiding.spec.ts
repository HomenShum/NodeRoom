import { expect, test } from "./fixtures";

/**
 * Guard for issue #211: while a shared-primitive modal is open, the background app
 * must be screen-reader-hidden.
 *
 * Mechanism under guard: Radix's hideOthers (aria-hidden package) exempts every
 * `[aria-live]` element AND its whole ancestor chain from modal hiding. An explicit
 * aria-live on an interactive control (the invite chip, the chat feed, the status
 * strip) therefore kept large background subtrees reachable behind open dialogs.
 * The fix routes announcements through a dedicated hidden LiveRegion leaf and uses
 * implicit liveness (role="log"/"status") elsewhere; this spec pins that contract.
 */
test("background is aria-hidden while the command palette is open", async ({ page }) => {
  await page.goto("/?mode=memory&surface=desktop", { waitUntil: "domcontentloaded" });
  const start = page.getByTestId("start-demo-room");
  await expect(start).toBeVisible({ timeout: 30_000 });
  await start.click();
  const skip = page.getByTestId("tour-skip");
  if (await skip.count()) await skip.click().catch(() => {});
  await expect(page.getByTestId("people-trigger")).toBeVisible();

  await page.keyboard.press("Control+K");
  await expect(page.getByTestId("command-palette-input")).toBeVisible();

  // Background controls carry the hide marker while the modal is open.
  await expect(page.getByTestId("people-trigger")).toHaveAttribute("data-aria-hidden", "true");

  // The only aria-live exemption left inside #root is the empty announcement leaf —
  // an [aria-live] on any real UI element would re-pin its subtree open.
  const liveExemptions = await page.evaluate(() =>
    [...document.querySelectorAll("#root [aria-live]")].map((el) => ({
      text: el.textContent?.trim() ?? "",
      elements: el.querySelectorAll("*").length,
    })),
  );
  expect(liveExemptions.length).toBeLessThanOrEqual(2); // announcement leaf (+ transient boot status)
  for (const region of liveExemptions) expect(region.elements).toBe(0);

  // Dismissal restores the background to the accessibility tree.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("command-palette-input")).toHaveCount(0);
  await expect(page.getByTestId("people-trigger")).not.toHaveAttribute("data-aria-hidden", "true");
});
