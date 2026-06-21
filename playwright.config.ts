import { defineConfig, devices } from "@playwright/test";

const playwrightPort = process.env.PLAYWRIGHT_PORT ?? "5173";
const playwrightBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${playwrightPort}`;
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1";

/**
 * E2E dogfood harness — the real-DOM layer NodeRoom was missing (see docs/audit/E2E_DOGFOOD_DESIGN.md).
 *
 * Default specs run against the app in MEMORY mode (`/?mode=memory` → the deterministic in-memory
 * RoomEngine), so they need NO Convex backend and NO provider keys — they are green in plain CI and
 * prove the real rendered UI + the optimistic/honest-status paths (Wave 1).
 *
 * Backend-dependent specs (cross-client reactivity, CAS-loser revert) live in *.backend.spec.ts and
 * skip themselves unless E2E_CONVEX_URL is set, because only a real Convex backend can prove reactivity.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1, // one shared app instance; deterministic ordering
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
