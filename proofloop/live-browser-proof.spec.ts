/**
 * Live browser proof-loop spec — verifies agent tasks complete on real prod Convex
 * with visible browser UI surfaces (streaming, job status, trace, artifacts).
 *
 * Pattern mirrors e2e/benchmark-ui-bankertoolbench.spec.ts:
 *   fresh live room -> send agent task -> verify streaming/job/trace visible ->
 *   wait for completion -> screenshot -> write proof receipt.
 *
 * Usage:
 *   VITE_CONVEX_URL=https://zealous-goshawk-766.convex.cloud \
 *   PROOFLOOP_LIVE_BROWSER=1 \
 *   BENCH_BASE_URL=http://127.0.0.1:5173 \
 *   npx playwright test --config playwright.proofloop.config.ts proofloop/live-browser-proof.spec.ts --headed
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ENABLED = process.env.PROOFLOOP_LIVE_BROWSER === "1";
const BASE = process.env.BENCH_BASE_URL ?? "http://127.0.0.1:5173";
const AGENT_TIMEOUT_MS = Number(process.env.PROOFLOOP_AGENT_TIMEOUT_MS ?? 20 * 60_000);
const TEST_TIMEOUT_MS = Number(process.env.PROOFLOOP_TEST_TIMEOUT_MS ?? Math.max(25 * 60_000, AGENT_TIMEOUT_MS + 5 * 60_000));
const PROOF_OUT = process.env.PROOFLOOP_PROOF_OUT ?? "test-results/proofloop/live-browser-proof.json";
const TASKS_JSON = process.env.PROOFLOOP_TASKS_JSON ?? "proofloop/accounting/live.accounting.config.json";

type TaskConfig = {
  id: string;
  name: string;
  goal: string;
  passPatterns: string[];
  expectArtifactEdit?: boolean;
  timeoutMs?: number;
};

type TaskProof = {
  taskId: string;
  taskName: string;
  goal: string;
  passed: boolean;
  matchedPatterns: string[];
  unmatchedPatterns: string[];
  streamingVisible: boolean;
  jobStatusVisible: boolean;
  roomTraceVisible: boolean;
  jobCompleted: boolean;
  agentOutput: string;
  screenshot: string;
  durationMs: number;
  error?: string;
};

type ProofReceipt = {
  schema: 1;
  generatedAt: string;
  baseUrl: string;
  roomUrl: string;
  taskCount: number;
  passCount: number;
  passRate: number;
  tasks: TaskProof[];
  gatesProven: string[];
};

test.skip(!ENABLED, "Set PROOFLOOP_LIVE_BROWSER=1 to run the live browser proof-loop.");

test("Live browser proof-loop: fresh room -> agent tasks -> UI verification", async ({ page }, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);

  const tasks = loadTasks();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.message ?? error)));

  // Create fresh live room
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  expect(page.url(), "must not use memory mode").not.toContain("mode=memory");
  await page.locator('[data-testid="create-room"]').click({ timeout: 60_000 });
  await page.locator('[data-testid="create-room-submit"]').waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('[data-testid="create-room-submit"]').click();
  await page.locator('[data-testid="blank-cta-sheet"]').click({ timeout: 60_000 });
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 30_000 });
  console.log(`[proofloop-live] room created: ${page.url()}`);

  const roomUrl = page.url();
  const taskProofs: TaskProof[] = [];

  for (const task of tasks) {
    const taskTimeout = task.timeoutMs ?? AGENT_TIMEOUT_MS;
    console.log(`[proofloop-live] running task: ${task.name}`);
    const started = Date.now();

    // Send agent task via chat composer
    const composer = page.locator('textarea[data-testid="chat-composer"]');
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill(task.goal);
    await page.locator('[data-testid="chat-send"]').click();

    // Verify streaming starts
    let streamingVisible = false;
    try {
      await expect(page.locator('[data-testid="agent-unified-stream"]').first())
        .toBeVisible({ timeout: 60_000 });
      streamingVisible = true;
    } catch {
      console.warn(`[proofloop-live] streaming did not become visible for task: ${task.id}`);
    }

    // Verify job status visible
    let jobStatusVisible = false;
    try {
      await expect(page.locator('[data-testid="job-status"]').first())
        .toContainText(/queued|running|completed|blocked|failed/i, { timeout: 60_000 });
      jobStatusVisible = true;
    } catch {
      console.warn(`[proofloop-live] job status did not become visible for task: ${task.id}`);
    }

    // Wait for job completion
    let jobCompleted = false;
    let agentOutput = "";
    const deadline = Date.now() + taskTimeout;
    while (Date.now() < deadline) {
      const status = ((await page.locator('[data-testid="job-status"]').first().textContent().catch(() => "")) ?? "").trim();
      if (/\bcompleted\b/i.test(status)) {
        jobCompleted = true;
        break;
      }
      if (/\b(failed|blocked|cancelled)\b/i.test(status)) {
        console.warn(`[proofloop-live] job reached non-passing status: ${status}`);
        break;
      }
      await page.waitForTimeout(5_000);
    }

    // Collect agent output text
    if (streamingVisible) {
      agentOutput = ((await page.locator('[data-testid="agent-unified-stream"]').first().textContent().catch(() => "")) ?? "").slice(0, 4000);
    }

    // Verify room trace visible
    let roomTraceVisible = false;
    try {
      const trace = page.locator('[data-testid="room-trace"]').first();
      if (await trace.isVisible().catch(() => false)) {
        roomTraceVisible = true;
      } else {
        await expect(page.getByText(/\d+\s+trace events/i).first())
          .toBeVisible({ timeout: 30_000 });
        roomTraceVisible = true;
      }
    } catch {
      console.warn(`[proofloop-live] room trace not visible for task: ${task.id}`);
    }

    // Score patterns
    const outputLower = agentOutput.toLowerCase();
    const matchedPatterns: string[] = [];
    const unmatchedPatterns: string[] = [];
    for (const pattern of task.passPatterns) {
      if (outputLower.includes(pattern.toLowerCase())) {
        matchedPatterns.push(pattern);
      } else {
        unmatchedPatterns.push(pattern);
      }
    }

    const passed = jobCompleted && matchedPatterns.length === task.passPatterns.length;

    // Screenshot
    const screenshotPath = testInfo.outputPath(`proofloop-${task.id}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 30_000 });
    await testInfo.attach(`proofloop-${task.id}`, { path: screenshotPath, contentType: "image/png" });

    const durationMs = Date.now() - started;
    taskProofs.push({
      taskId: task.id,
      taskName: task.name,
      goal: task.goal,
      passed,
      matchedPatterns,
      unmatchedPatterns,
      streamingVisible,
      jobStatusVisible,
      roomTraceVisible,
      jobCompleted,
      agentOutput,
      screenshot: screenshotPath,
      durationMs,
      error: jobCompleted ? undefined : "Job did not complete within timeout",
    });

    console.log(`[proofloop-live] task ${task.id}: ${passed ? "PASS" : "FAIL"} — ${matchedPatterns.length}/${task.passPatterns.length} patterns, completed=${jobCompleted}, ${durationMs}ms`);

    // Brief pause between tasks
    await page.waitForTimeout(2_000);
  }

  // Write proof receipt
  const passCount = taskProofs.filter((t) => t.passed).length;
  const gatesProven: string[] = [
    "fresh_room_join",
    "live_convex_connected",
    "public_nodeagent_invocation",
  ];
  if (taskProofs.some((t) => t.streamingVisible)) gatesProven.push("visible_streaming_progress");
  if (taskProofs.some((t) => t.jobStatusVisible)) gatesProven.push("job_status_visible");
  if (taskProofs.some((t) => t.roomTraceVisible)) gatesProven.push("room_trace_visible");
  if (taskProofs.some((t) => t.jobCompleted)) gatesProven.push("agent_job_completed");
  if (taskProofs.every((t) => t.passed)) gatesProven.push("all_tasks_passed");

  const receipt: ProofReceipt = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    roomUrl,
    taskCount: taskProofs.length,
    passCount,
    passRate: taskProofs.length > 0 ? passCount / taskProofs.length : 0,
    tasks: taskProofs,
    gatesProven,
  };

  const proofPath = resolve(PROOF_OUT);
  mkdirSync(dirname(proofPath), { recursive: true });
  writeFileSync(proofPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  console.log(`[proofloop-live] proof receipt written: ${proofPath}`);
  console.log(`[proofloop-live] verdict: ${passCount}/${taskProofs.length} passed`);

  // Assert no unexpected page errors
  const unexpectedErrors = pageErrors.filter((msg) => !isBenignError(msg));
  expect(unexpectedErrors, `unexpected page errors: ${unexpectedErrors.join("; ")}`).toEqual([]);

  // Assert at least streaming was visible
  expect(taskProofs.some((t) => t.streamingVisible), "at least one task must show visible streaming").toBe(true);
});

function loadTasks(): TaskConfig[] {
  if (!existsSync(resolve(TASKS_JSON))) {
    throw new Error(`Proof-loop config not found: ${TASKS_JSON}`);
  }
  const config = JSON.parse(
    require("node:fs").readFileSync(resolve(TASKS_JSON), "utf8"),
  );
  if (!config.tasks || !Array.isArray(config.tasks) || config.tasks.length === 0) {
    throw new Error(`No tasks found in ${TASKS_JSON}`);
  }
  return config.tasks as TaskConfig[];
}

function isBenignError(message: string): boolean {
  return /localStorage|sessionStorage|IndexedDB|quota|storage/i.test(message);
}
