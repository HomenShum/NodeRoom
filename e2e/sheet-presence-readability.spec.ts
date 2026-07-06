import { test, expect } from "@playwright/test";

/**
 * Regression: a real underwriting run left NodeAgent "present" on every cell it
 * wrote, and on a narrow 8-column sheet the 84px named presence flag + its 64px
 * reserve consumed the whole cell — the value rendered as "applicati…" (user
 * screenshot, room NRX5PDVAX89). The design rule is "default shows data, hover
 * shows apparatus": on sheet cells the presence flag must COLLAPSE to a dot by
 * default (name hidden, value primary) and reveal the full name only on
 * hover/selection. This measures that against the app's real built CSS.
 */
test("sheet presence flag collapses to a dot by default and reveals the name on select", async ({ page }) => {
  await page.goto("/?mode=memory", { waitUntil: "domcontentloaded" });

  // Reproduce the occlusion scenario against the real CSS cascade: a narrow
  // agent-authored cell (--presence-color terracotta) with a single presence flag.
  await page.evaluate(() => {
    const tbl = document.createElement("table");
    tbl.className = "r-sheet";
    tbl.setAttribute("data-sheet-kind", "generic");
    tbl.style.tableLayout = "fixed";
    tbl.style.width = "90px";
    tbl.innerHTML = `<tbody><tr><td class="r-cell" id="probe-cell" style="position:relative">
      <span class="r-cell-value">application_id_0421</span>
      <span class="r-presence-ladder sc-flagone" data-count="1"><span class="sc-flag" style="--presence-color:#D97757">Room NodeAgent</span></span>
    </td></tr></tbody>`;
    document.body.appendChild(tbl);
  });

  const flag = page.locator("#probe-cell .sc-flag");
  const flagWidth = async () => (await flag.boundingBox())!.width;

  // Default: collapsed to a dot, name text not painted (color transparent).
  expect(await flagWidth()).toBeLessThanOrEqual(16);
  await expect(flag).toHaveCSS("color", "rgba(0, 0, 0, 0)");

  // Selected: expands to the full name pill (white ink).
  await page.locator("#probe-cell").evaluate((el) => el.classList.add("sel"));
  await page.waitForTimeout(250); // let the 120ms reveal transition settle
  expect(await flagWidth()).toBeGreaterThanOrEqual(50);
  await expect(flag).toHaveCSS("color", "rgb(255, 255, 255)");
});
