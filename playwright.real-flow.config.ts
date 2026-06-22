/**
 * Playwright config for the real-user room-flow e2e (tests/real-room-cheap-e2e.spec.ts).
 *
 * Runs against an EXTERNALLY started, Convex-connected server (the agent's model proxy holds the
 * OpenRouter key) — no webServer here, because a memory-mode dev boot has no live agent. Long
 * timeouts: the cheap model fires a real multi-step agent run.
 *
 *   BENCH_BASE_URL=http://localhost:5273 npx playwright test --config playwright.real-flow.config.ts
 */
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  testMatch: ["real-room-cheap-e2e.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 320_000,
  expect: { timeout: 200_000 },
  reporter: "list",
  use: { ...devices["Desktop Chrome"], headless: true },
});
