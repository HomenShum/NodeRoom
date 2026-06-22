/**
 * Playwright config used ONLY for tests/ui-benchmark-drive.spec.ts.
 *
 * The main playwright.config.ts has testDir = "./e2e" and auto-starts `npm run dev`.
 * The benchmark spec lives in tests/ alongside vitest unit tests (the directory layout
 * the orchestrating task requested), and the developer typically already has a vite
 * preview / dev server running on 5260 or 5173 — so this config:
 *   - points testDir at "./tests"
 *   - filters the testMatch to JUST the benchmark spec (so vitest *.test.ts files are not picked up)
 *   - reuses an existing server when PLAYWRIGHT_REUSE_SERVER=1, else falls back to `npm run dev`.
 */
import { defineConfig, devices } from "@playwright/test";

const playwrightPort = process.env.PLAYWRIGHT_PORT ?? "5260";
const playwrightBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${playwrightPort}`;
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER !== "0";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["ui-benchmark-drive.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: "list",
  use: {
    baseURL: playwrightBaseUrl,
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${playwrightPort} --strictPort`,
    url: playwrightBaseUrl,
    reuseExistingServer,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
