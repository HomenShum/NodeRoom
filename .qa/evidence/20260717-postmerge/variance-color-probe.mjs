import { chromium } from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 812 } });
await page.goto("https://noderoom.live/", { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(800);

const result = await page.evaluate(() => {
  const rows = [];
  // Find the hero receipt-card table rows by their account labels.
  for (const label of ["Revenue", "COGS", "Gross profit"]) {
    const cell = [...document.querySelectorAll("td,div,span")].find(
      (el) => el.children.length === 0 && el.textContent.trim() === label,
    );
    if (!cell) { rows.push({ label, found: false }); continue; }
    const row = cell.closest("tr") ?? cell.parentElement;
    const variance = [...row.querySelectorAll("*")].find(
      (el) => el.children.length === 0 && /^[+-]\d/.test(el.textContent.trim()),
    );
    rows.push({
      label,
      found: true,
      varianceText: variance?.textContent.trim() ?? null,
      varianceColor: variance ? getComputedStyle(variance).color : null,
    });
  }
  return rows;
});
console.log(JSON.stringify(result, null, 1));
await browser.close();
