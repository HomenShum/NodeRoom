import { defineConfig, devices } from "@playwright/test";

const playwrightPort = process.env.PLAYWRIGHT_PORT ?? "5173";
const playwrightBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${playwrightPort}`;
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1";

/**
 * Playwright config for proof-loop specs.
 * Same webServer setup as the main config but testDir points to proofloop/
 * so specs in proofloop/accounting/scenarios/ and proofloop/notion/scenarios/
 * are discovered.
 */
export default defineConfig({
  testDir: "./proofloop",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: playwrightBaseUrl,
    trace: "on-first-retry",
    video: process.env.PLAYWRIGHT_RECORD_VIDEO === "1" ? "on" : "off",
  },
  webServer: {
    command: `npm run dev -- --host 127.0.0.1 --port ${playwrightPort} --strictPort`,
    url: playwrightBaseUrl,
    reuseExistingServer,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
