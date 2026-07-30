import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim();

if (!baseURL) {
  throw new Error("PLAYWRIGHT_BASE_URL is required for the sequential NodeKit reference proof.");
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: "nodekit-note-reference-proof.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  outputDir: "test-results/nodekit-note-reference-proof",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
