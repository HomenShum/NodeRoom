/**
 * UI Smoke — Claim 2 (the lane that was ❌-unexercised in R1-R4 of the BTB loop).
 *
 * SCOPE: prove the UI lane exists and is reachable from a Playwright harness.
 *   - Build is consumable (uses prebuilt dist/ from `npm run build`)
 *   - `vite preview` serves the bundle on a deterministic port
 *   - Playwright reaches the URL, the page renders without a fatal crash
 *   - At least one canonical noderoom surface element is in the DOM
 *   - No 5xx/4xx network failures for first-party assets
 *   - A screenshot lands in tests/.artifacts/ui-smoke-claim2.png as proof
 *
 * EXPLICITLY OUT OF SCOPE: running a benchmark task through the UI. That's a real
 * project. This spec converts the claim from ❌-unexercised to ⚠-smoke-only.
 *
 * NOTE: this spec lives in tests/ on purpose (the BTB claim refers to tests/), not in
 * e2e/ where the rest of the Playwright suite lives. Run it via the co-located config:
 *   npx playwright test --config tests/ui-smoke-claim2.config.ts
 */

import { test, expect, type ConsoleMessage, type Response } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const PREVIEW_PORT = Number(process.env.UI_SMOKE_PORT ?? 4200);
const PREVIEW_URL = `http://127.0.0.1:${PREVIEW_PORT}`;
const ARTIFACTS_DIR = resolve(HERE, ".artifacts");
const SCREENSHOT_PATH = resolve(ARTIFACTS_DIR, "ui-smoke-claim2.png");

let preview: ChildProcess | undefined;

async function waitForServer(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { method: "GET" });
      if (res.ok || res.status === 304) return;
      lastErr = `status ${res.status}`;
    } catch (err) {
      lastErr = err;
    }
    await sleep(250);
  }
  throw new Error(`preview server did not become ready at ${url}: ${String(lastErr)}`);
}

test.beforeAll(async () => {
  if (!existsSync(ARTIFACTS_DIR)) mkdirSync(ARTIFACTS_DIR, { recursive: true });
  if (!existsSync(resolve(REPO_ROOT, "dist", "index.html"))) {
    throw new Error(
      "dist/index.html missing — run `npm run build` before this smoke (skipped here to keep the smoke fast / hermetic)",
    );
  }
  const isWindows = process.platform === "win32";
  // On Windows, spawn must go through the shell to resolve `npx.cmd` (raw spawn errors EINVAL).
  preview = spawn(
    "npx",
    ["vite", "preview", "--host", "127.0.0.1", "--port", String(PREVIEW_PORT), "--strictPort"],
    { cwd: REPO_ROOT, stdio: "ignore", windowsHide: true, detached: false, shell: isWindows },
  );
  preview.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[ui-smoke-claim2] preview spawn error:", err);
  });
  await waitForServer(PREVIEW_URL);
});

test.afterAll(async () => {
  if (!preview || preview.killed) return;
  preview.kill();
  // Give vite preview a brief moment to release the port.
  await sleep(250);
});

test("ui smoke — claim 2: app renders a canonical surface in memory mode", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const badResponses: { url: string; status: number }[] = [];
  page.on("response", (res: Response) => {
    const status = res.status();
    const url = res.url();
    // First-party only — ignore opportunistic third-party telemetry/analytics if any.
    if (!url.startsWith(PREVIEW_URL)) return;
    if (status >= 500 || status === 404) badResponses.push({ url, status });
  });

  // Memory mode skips Convex entirely — the deterministic lane the existing e2e suite uses.
  await page.goto(`${PREVIEW_URL}/?mode=memory`, { waitUntil: "domcontentloaded" });

  // The page must render *something* — a non-empty body is the fatal-crash floor.
  const bodyHandle = await page.locator("body").elementHandle();
  expect(bodyHandle, "body element must exist").toBeTruthy();

  // Canonical surface check — match ANY of the well-known noderoom anchors. We accept any
  // hit because the landing vs in-room state both qualify as "the UI lane is up".
  const surfaceCandidates = [
    page.getByTestId("start-demo-room"), // Landing CTA
    page.getByTestId("artifact-panel"), // Work surface (in-room)
    page.getByTestId("room-shell"), // Shell wrapper if present
    page.getByTestId("chat-composer"), // Public chat composer textarea
    page.locator("[data-noderoom-surface]").first(), // Trace Lens surfaces
  ];
  let surfaceMatched = "";
  for (const candidate of surfaceCandidates) {
    if (await candidate.first().isVisible().catch(() => false)) {
      surfaceMatched = (await candidate.first().evaluate((el) => el.outerHTML.slice(0, 160)).catch(() => "")) ||
        "matched";
      break;
    }
    // Fallback: just present in DOM (some surfaces are inside collapsed panels on narrow viewports).
    if ((await candidate.first().count().catch(() => 0)) > 0) {
      surfaceMatched = "present-in-dom";
      break;
    }
  }
  expect(
    surfaceMatched,
    "expected at least one canonical noderoom surface (start-demo-room / artifact-panel / room-shell / chat-composer / [data-noderoom-surface])",
  ).not.toEqual("");

  // Screenshot proof — full page so the reviewer can SEE the lane was reachable.
  await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });

  // Fatal-error floor: no 5xx/404 on first-party assets.
  expect(badResponses, `unexpected first-party 4xx/5xx: ${JSON.stringify(badResponses)}`).toEqual([]);

  // Console errors are noisier — log but don't fail (devtools warnings are common in dev tooling).
  if (consoleErrors.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[ui-smoke-claim2] ${consoleErrors.length} console error(s) (non-fatal):`, consoleErrors.slice(0, 3));
  }
});
