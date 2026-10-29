import { defineConfig, devices } from "@playwright/test";

// Long-run product proof for the Node agent workspace. Drives the real #workspace
// route against a running worker (npm run agent:worker) and Vite dev server.
// Never retried: a retry would re-run a paid, long task and overwrite footage.
const baseURL = process.env.PLAYWRIGHT_BASE_URL?.trim() || "http://localhost:5273";
const outputDir = process.env.AGENT_PROOF_OUT?.trim() || "evidence/agent-workspace-20261029/run";

export default defineConfig({
  testDir: "./e2e/agent-workspace",
  testMatch: /.*\.proof\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 3 * 60 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  outputDir: `${outputDir}/playwright`,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    viewport: { width: 1440, height: 900 },
    video: { mode: "on", size: { width: 1440, height: 900 } },
    // Screenshots per action make the trace scrubbable; DOM snapshots over a
    // multi-hour run would be very large, so they stay off.
    trace: { mode: "on", screenshots: true, snapshots: false, sources: false },
    screenshot: "off",
  },
});
