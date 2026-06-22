/**
 * Playwright config for prod live-DOM verification — runs JUST the prod-r10-bench-final.spec.ts
 * against the public https://noderoom.live deployment. No webServer is started.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["prod-r10-bench-final.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 60_000 },
  reporter: "list",
  use: {
    trace: "retain-on-failure",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
