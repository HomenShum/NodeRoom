/**
 * Dedicated Playwright config for the Claim-2 UI smoke.
 *
 * The repo's main playwright.config.ts uses `testDir: "./e2e"` and a `webServer` that boots
 * `npm run dev` (Vite dev). This smoke instead exercises the BUILD → PREVIEW path — it
 * spawns `vite preview` itself inside the spec (see tests/ui-smoke-claim2.spec.ts), so it
 * needs a config whose testDir points at `tests/` AND whose webServer is disabled.
 *
 * Run via:
 *   npx playwright test --config tests/ui-smoke-claim2.config.ts
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /ui-smoke-claim2\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  use: {
    trace: "off",
    video: "off",
    screenshot: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
