/**
 * Real-user end-to-end — the honest replacement for the deleted #bench harness.
 *
 * A real user joins a FRESH room, adds a sheet, and asks @nodeagent (the CHEAP default model, the
 * live OpenRouter proxy via the adaptive route — not a frontier flagship) to compute a set of
 * metrics. The test then reads the VISIBLE sheet cells (the rendered grid, by their stable
 * r<row>__<col> ids — exactly what the user sees, not a Convex query and not a screenshot) and
 * grades each value against the nb-01 golden rubric's expected value, within its tolerance.
 *
 * The prompt supplies the nb-01 source figures inline (a fresh blank room has no uploaded files);
 * those figures compute to the golden values (25 / 40 / 44 / 2.40 / 3.50). A ✓ therefore means the
 * cheap model genuinely computed and wrote each cell to the displayed column — end to end, live.
 *
 * Requires a Convex-connected server (the proxy holds the OpenRouter key). NOT ?mode=memory:
 *   1) npm run dev    (dev server at :5273, VITE_CONVEX_URL set)
 *   2) BENCH_BASE_URL=http://localhost:5273 \
 *        npx playwright test --config playwright.real-flow.config.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { enableFocusModeForTest, expectAttentionOverlayMounted, expectFocusModeOn } from "../e2e/focusMode";

const BASE = process.env.BENCH_BASE_URL ?? "http://localhost:5273";

// The golden expected values, mirrored from src/benchmarks/nonbtb/nb-01-company-profile/rubric.json
// (kept honest by tests/goldenDataset.test.ts). Inlined here because Playwright's ESM loader rejects
// a bare JSON import.
const EXPECTED: Record<string, { value: number; tol?: number }> = {
  revenue_growth_pct: { value: 25.0, tol: 0.1 },
  gross_margin_2024: { value: 40.0, tol: 0.1 },
  gross_margin_2025: { value: 44.0, tol: 0.1 },
  eps_2024: { value: 2.4, tol: 0.01 },
  eps_2025: { value: 3.5, tol: 0.01 },
};
const KEYS = Object.keys(EXPECTED);

// nb-01 source figures, inline (no file upload in a fresh room) — these compute to the golden values.
const PROMPT =
  "@nodeagent compute and fill the sheet: column A = metric name (exactly as listed), column B = the " +
  "numeric value only. Use percentage metrics on a 0-100 scale, so write 40 for 40%, not 0.4. " +
  "revenue_growth_pct from 2024 revenue 100 to 2025 revenue 125; gross_margin_2024 " +
  "(revenue 100, COGS 60); gross_margin_2025 (revenue 125, COGS 70); eps_2024 (net income 48, shares 20); " +
  "eps_2025 (net income 70, shares 20).";

/** Read the rendered sheet as {metric -> value text}, keyed off the visible r<row>__A / __B cells. */
async function readSheet(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    const cellText = (cell: HTMLElement | null | undefined): string => {
      if (!cell) return "";
      const direct = Array.from(cell.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      if (direct) return direct;
      const clone = cell.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".r-srcchip,.lockbadge,.presencebadge").forEach((node) => node.remove());
      return (clone.textContent || "").trim();
    };
    // Sheet cells render as <td data-element-id="r<row>__<col>" data-testid="sheet-cell">; read the
    // metric name from column A and its value from the adjacent B cell — exactly what the user sees.
    document.querySelectorAll<HTMLElement>('[data-element-id$="__A"]').forEach((a) => {
      const rowId = (a.getAttribute("data-element-id") || "").replace(/__A$/, "");
      const b = document.querySelector<HTMLElement>(`[data-element-id="${rowId}__B"]`);
      const metric = cellText(a).toLowerCase();
      const val = cellText(b);
      if (metric) out[metric] = val;
    });
    return out;
  });
}

const parseNum = (s: string | undefined): number | null => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const isFilled = (s: string | undefined) => s != null && s !== "" && s !== "—";

async function verifyRenderedTraceBox(page: Page) {
  await page.getByTestId("trace-tab").click();
  await expect(page.getByTestId("trace-surface")).toBeVisible({ timeout: 30_000 });

  const webSourceRecord = page.getByTestId("trace-record").filter({ hasText: "Web retrieval" }).first();
  await expect(webSourceRecord).toBeVisible({ timeout: 15_000 });
  await webSourceRecord.click();
  await page.getByTestId("trace-tab-steps").click();

  const frame = page.locator(".r-tracevu-shotframe", { has: page.locator(".r-tracevu-box") }).first();
  await expect(frame).toBeVisible({ timeout: 15_000 });
  const image = frame.locator("img.r-tracevu-shot").first();
  const box = frame.locator(".r-tracevu-box").first();
  await expect.poll(() => image.evaluate((img) => (img as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(box).toBeVisible();

  const proof = await frame.evaluate((root) => {
    const img = root.querySelector<HTMLImageElement>("img.r-tracevu-shot");
    const overlay = root.querySelector<HTMLElement>(".r-tracevu-box");
    if (!img || !overlay) return null;
    const imgRect = img.getBoundingClientRect();
    const boxRect = overlay.getBoundingClientRect();
    const style = getComputedStyle(overlay);
    return {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      boxWithinImage:
        boxRect.left >= imgRect.left
        && boxRect.top >= imgRect.top
        && boxRect.right <= imgRect.right + 1
        && boxRect.bottom <= imgRect.bottom + 1,
      normalized: {
        x: (boxRect.left - imgRect.left) / imgRect.width,
        y: (boxRect.top - imgRect.top) / imgRect.height,
        w: boxRect.width / imgRect.width,
        h: boxRect.height / imgRect.height,
      },
      position: style.position,
      borderTopWidth: style.borderTopWidth,
      borderTopStyle: style.borderTopStyle,
    };
  });
  expect(proof, "trace box proof missing").not.toBeNull();
  expect(proof!.naturalWidth).toBeGreaterThan(0);
  expect(proof!.naturalHeight).toBeGreaterThan(0);
  expect(proof!.boxWithinImage).toBe(true);
  expect(proof!.position).toBe("absolute");
  expect(proof!.borderTopStyle).toBe("solid");
  expect(parseFloat(proof!.borderTopWidth)).toBeGreaterThanOrEqual(1);
  expect(proof!.normalized.x).toBeGreaterThan(0);
  expect(proof!.normalized.y).toBeGreaterThan(0);
  expect(proof!.normalized.w).toBeGreaterThan(0.02);
  expect(proof!.normalized.h).toBeGreaterThan(0.01);
  expect(proof!.normalized.x + proof!.normalized.w).toBeLessThanOrEqual(1.02);
  expect(proof!.normalized.y + proof!.normalized.h).toBeLessThanOrEqual(1.02);

  await page.getByTestId("trace-tab-raw").click();
  await expect(page.getByTestId("trace-surface")).toContainText(/"box"/);
  await expect(page.getByTestId("trace-surface")).toContainText(/Revenue|retrieved value|source screenshot/i);
}

test("real user: fresh room -> @nodeagent (cheap default) -> visible sheet matches golden", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message ?? e)));
  await enableFocusModeForTest(page);

  // Live app (Convex-connected, so the agent runs server-side with the cheap proxy model).
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });

  // Real user flow: join a fresh room, add a sheet.
  await page.locator('[data-testid="create-room"]').click({ timeout: 60_000 });
  await page.locator('[data-testid="blank-cta-sheet"]').click({ timeout: 60_000 });
  await expectFocusModeOn(page);
  await expectAttentionOverlayMounted(page);

  // The model must be the CHEAP default route — the test fails loudly if someone pins a flagship.
  const preset = page.locator('[data-testid="chat-model-preset"]');
  await expect(preset).toHaveValue(/adaptive|free/, { timeout: 30_000 });

  // Ask the agent to do the task once. The public ask is admitted server-side, so the first real
  // user send must create the durable job instead of relying on duplicate chat submissions.
  const ta = page.locator("textarea").first();
  const send = page.locator('[data-testid="chat-send"]');
  await ta.fill(PROMPT);
  await send.click();
  await expect(page.locator('[data-testid="chat-message"]').filter({ hasText: PROMPT })).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('[data-testid="agent-error"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="job-status"]')).toContainText(/queued|running|completed|blocked|failed/i, { timeout: 30_000 });

  const stream = page.locator('[data-testid="agent-unified-stream"]').first();
  await expect(stream).toBeVisible({ timeout: 60_000 });
  await expect(stream.locator('[data-part="step"], [data-part="tool"], [data-testid="agent-stream-text"]').first()).toBeVisible({
    timeout: 90_000,
  });
  await expect(page.locator('[data-testid="agent-operation-stream"]')).toHaveCount(0);

  // Poll the VISIBLE sheet until every metric row has a value (the cheap model filling cells live).
  await expect
    .poll(
      async () => {
        const live = await readSheet(page);
        return KEYS.filter((k) => isFilled(live[k])).length;
      },
      {
        timeout: 200_000,
        message: "waiting for the cheap default model to fill all metric cells in the visible sheet",
      },
    )
    .toBe(KEYS.length);

  // Grade each visible cell against the golden expected value, within tolerance.
  const pairs = await readSheet(page);
  for (const key of KEYS) {
    const spec = EXPECTED[key];
    const got = parseNum(pairs[key]);
    expect(got, `${key}: visible cell was "${pairs[key]}"`).not.toBeNull();
    expect(
      Math.abs((got as number) - spec.value),
      `${key}: got ${got}, golden ${spec.value} ± ${spec.tol ?? 0}`,
    ).toBeLessThanOrEqual((spec.tol ?? 0) + 1e-9);
  }

  const jobDetailToggle = page.locator('[data-testid="job-detail-toggle"]').first();
  if (await jobDetailToggle.isVisible().catch(() => false)) {
    await jobDetailToggle.click();
    const detail = page.locator('[data-testid="job-detail"]').first();
    await expect(detail).toContainText(/agentJobs\.start|agentJobRunner|workflow|public_ask/i, { timeout: 15_000 });
  }

  await verifyRenderedTraceBox(page);

  expect(pageErrors, `page errors: ${pageErrors.join("; ")}`).toEqual([]);
});
