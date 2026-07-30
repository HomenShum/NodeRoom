import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();

if (!baseURL) {
  throw new Error("PLAYWRIGHT_BASE_URL is required for the NodeKit reference demo.");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "nodekit-note-reference-demo.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  outputDir: "evidence/nodekit-note-reference-demo/playwright",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    viewport: { width: 1280, height: 720 },
    video: {
      mode: "on",
      size: { width: 1280, height: 720 },
    },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
