/**
 * Playwright config for local r11 live-DOM verification — runs JUST tests/local-r11-bench.spec.ts
 * against http://127.0.0.1:4200 (vite preview started externally). No webServer is started.
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["local-r11-bench.spec.ts"],
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
