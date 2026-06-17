import { test, expect } from "./fixtures";

/**
 * PDF citation box — the "always accurate" acceptance gate (PDF_CITATION_BOX_PLAN.md recipe step 8).
 *
 * For each varied fixture (normal · /Rotate 90 · CropBox≠MediaBox · multi-page differing sizes), we
 * render the real react-pdf `<Page>` WITH the text layer, read the actual rendered text-item rects
 * from the DOM, and assert the `.r-tracevu-box` highlight overlaps the TARGET text (IoU ≥ 0.4 AND the
 * box center falls inside the target union). This is pixel-precise proof the box sits on the value,
 * not eyeballing. The box is produced by the pdfBox normalization adapter from LiteParse's raw coords.
 *
 * Runs against the dev-only visual-check page (pdf-visual-check.html), which the dev server serves.
 */
const IOU_THRESHOLD = 0.4;

interface Rect { x: number; y: number; w: number; h: number }

function iou(a: Rect, b: Rect): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}
function centerIn(box: Rect, target: Rect): boolean {
  return box.x + box.w / 2 >= target.x && box.x + box.w / 2 <= target.x + target.w
    && box.y + box.h / 2 >= target.y && box.y + box.h / 2 <= target.y + target.h;
}

test.describe("PDF citation box — box lands on the TARGET text (acceptance gate)", () => {
  // Each test pays the cold pdfjs-worker start (first <Document> fetch + worker boot); the global
  // 30s budget is too tight for that, so give this spec headroom. The overlap math itself is instant.
  test.beforeEach(async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/pdf-visual-check.html", { waitUntil: "commit" });
    await page.locator('[data-testid="pvc-case"]').first().waitFor({ state: "attached", timeout: 30_000 });
    // Cold pdfjs-worker start: the first canvas can take a few seconds to paint.
    await page.locator(".r-tracevu-pdfframe canvas").first().waitFor({ state: "visible", timeout: 60_000 });
  });

  for (const name of ["normal", "rotated90", "cropbox-offset", "multipage"]) {
    test(`box covers the TARGET text — ${name}`, async ({ page }) => {
      const card = page.locator('[data-testid="pvc-case"]', { hasText: name }).first();
      await card.scrollIntoViewIfNeeded();
      const frame = card.locator(".r-tracevu-pdfframe");
      await frame.locator("canvas").first().waitFor({ state: "visible", timeout: 30_000 });
      await frame.locator(".r-tracevu-box").first().waitFor({ state: "visible", timeout: 15_000 });
      // Text layer renders after the canvas; give it a beat to lay out.
      await page.waitForTimeout(500);

      const targetPhrase = (await card.locator('[data-testid="pvc-target"]').getAttribute("data-target")) ?? "";
      const targetRect = await frame.evaluate((root: HTMLElement, phrase: string): Rect | null => {
        const items = root.querySelectorAll<HTMLElement>(".react-pdf__Page__textContent span");
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, hits = 0;
        for (const it of items) {
          const t = (it.textContent ?? "").trim();
          if (!t || !phrase.includes(t)) continue;
          const r = it.getBoundingClientRect();
          minX = Math.min(minX, r.left); minY = Math.min(minY, r.top);
          maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom);
          hits++;
        }
        if (!hits) return null;
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      }, targetPhrase);
      expect(targetRect, `no rendered text items matched "${targetPhrase}"`).not.toBeNull();

      const br = await frame.locator(".r-tracevu-box").first().boundingBox();
      expect(br, "citation box not rendered").not.toBeNull();
      const box: Rect = { x: br!.x, y: br!.y, w: br!.width, h: br!.height };

      const overlap = iou(box, targetRect!);
      const centered = centerIn(box, targetRect!);
      expect(overlap, `IoU ${overlap.toFixed(3)} < ${IOU_THRESHOLD} for ${name}`).toBeGreaterThanOrEqual(IOU_THRESHOLD);
      expect(centered, `box center outside target union for ${name}`).toBe(true);
    });
  }
});
