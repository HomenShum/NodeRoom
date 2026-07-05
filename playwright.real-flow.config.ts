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

const traceMode = process.env.PLAYWRIGHT_TRACE === "on" ? "on" : "retain-on-failure";
const videoMode = process.env.PLAYWRIGHT_RECORD_VIDEO === "1" ? "on" : "off";
const retries = Number(process.env.PLAYWRIGHT_RETRIES ?? 1);
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results";

export default defineConfig({
  // Two real-user, live-Convex flows live here: the cheap-model room e2e (tests/) and the fullest
  // honest SpreadsheetBench V1 fresh-room contract (e2e/). Both run against an externally started,
  // Convex-connected server — never ?mode=memory — so the agent makes a real cheap-route model call.
  testDir: ".",
  testMatch: [
    "tests/real-room-cheap-e2e.spec.ts",
    "e2e/benchmark-ui-spreadsheetbench.spec.ts",
    "e2e/benchmark-ui-spreadsheetbench-generic.spec.ts",
    "e2e/benchmark-ui-bankertoolbench.spec.ts",
    "e2e/uploaded-artifact-live-rendering.spec.ts",
    "e2e/human-agent-concurrency.spec.ts",
    "e2e/benchmark-ui-spreadsheetbench-v2.spec.ts",
    "e2e/nodemem-benchmark.spec.ts",
    "e2e/nodemem-recall-benchmark.spec.ts",
    "e2e/nodemem-fairtest.spec.ts",
    "e2e/nodemem-firstuser.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  retries: Number.isFinite(retries) ? retries : 1,
  timeout: 320_000,
  expect: { timeout: 200_000 },
  reporter: "list",
  outputDir,
  use: { ...devices["Desktop Chrome"], headless: true, trace: traceMode, video: videoMode },
});
