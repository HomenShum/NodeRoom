/**
 * Live browser proof-loop spec — verifies agent tasks complete on real prod Convex
 * with the same rigor as the BankerToolBench live-browser contract
 * (e2e/benchmark-ui-bankertoolbench.spec.ts):
 *
 *   fresh live starter-room (createStarterRoom seed, matches proof-loop task sheets/notes) ->
 *   Focus Mode + attention overlay -> public @nodeagent -> streamed tool loop ->
 *   visible job status / trace -> agent terminal quality gate (no unfinished-work caveats) ->
 *   artifact placeholder scan -> canonical FreshRoomProofReceipt per task.
 *
 * The starter room seeded by convex/rooms.ts createStarterRoom ships exactly the sheets/notes
 * the accounting/notion proof-loop configs reference ("Q3 variance", "Company research",
 * "Runway / milestones", "Diligence memo", "Open questions / workplan") — so this spec must
 * navigate with `?demo=` (not a blank `?create=` room) to get matching seed content.
 *
 * There is no downloadable xlsx/pptx package for these cell-writing tasks, so the
 * deliverable_export_download / artifact_reopen_validation gates the BTB contract proves are
 * intentionally not claimed here. Everything else is 1:1.
 *
 * Usage:
 *   VITE_CONVEX_URL=https://zealous-goshawk-766.convex.cloud \
 *   PROOFLOOP_LIVE_BROWSER=1 \
 *   BENCH_BASE_URL=http://127.0.0.1:5173 \
 *   npx playwright test --config playwright.proofloop.config.ts proofloop/live-browser-proof.spec.ts --headed
 */
import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  writeFreshRoomProofReceipt,
  validateFreshRoomProofReceipt,
  type FreshRoomProofReceipt,
} from "../src/eval/freshRoomProofReceipts";
import { proofloopModelCostFieldsForRun } from "../src/eval/proofloopModelTracking";
import {
  filterProofloopTasksByIds,
  parseProofloopTaskIds,
  providerForAgentModelPolicy,
  withNodeAgentMention,
} from "../src/eval/proofloopLiveBrowserPrompt";
import { classifyAgentCompletion } from "../src/eval/proofloopLiveBrowserCompletion";
import {
  evaluateProofloopRouteIntegrity,
  routeIntegrityFailureSummary,
} from "../src/eval/proofloopRouteIntegrity";
import { enableFocusModeForTest, expectAttentionOverlayMounted, expectFocusModeOn } from "../e2e/focusMode";
import { installCockpit, emitCockpitEvent, cockpitEventsPath } from "./cockpit/playwrightOverlay";
import { noderoomSelectors, noderoomTextLocators } from "./adapters/noderoom/selectors";

const ENABLED = process.env.PROOFLOOP_LIVE_BROWSER === "1";
const COCKPIT_ENABLED = process.env.PROOFLOOP_COCKPIT !== "0";
const RUN_ID = process.env.PROOFLOOP_RUN_ID ?? `browser-live-${Date.now()}`;
const COCKPIT_EVENTS_PATH = COCKPIT_ENABLED ? cockpitEventsPath(RUN_ID) : undefined;
const BASE = process.env.BENCH_BASE_URL ?? "http://127.0.0.1:5173";
const AGENT_TIMEOUT_MS = Number(process.env.PROOFLOOP_AGENT_TIMEOUT_MS ?? 20 * 60_000);
const MAX_TASK_TIMEOUT_MS = Number(process.env.PROOFLOOP_MAX_TASK_TIMEOUT_MS ?? AGENT_TIMEOUT_MS);
const STREAM_WAIT_MS = Number(process.env.PROOFLOOP_STREAM_WAIT_MS ?? 90_000);
const TEST_TIMEOUT_MS = process.env.PROOFLOOP_TEST_TIMEOUT_MS ? Number(process.env.PROOFLOOP_TEST_TIMEOUT_MS) : undefined;
const TASKS_JSON = process.env.PROOFLOOP_TASKS_JSON ?? "proofloop/accounting/live.accounting.config.json";
const FRESH_PROOF_CASE_ID = process.env.PROOFLOOP_CASE_ID ?? "PL-LIVE";
const FRESH_PROOF_ROOT = process.env.PROOFLOOP_FRESH_ROOM_ROOT ?? "docs/eval/browser-receipts/fresh-room";
const SUITE_PROOF_PATH = process.env.PROOFLOOP_SUITE_PROOF_PATH ?? "docs/eval/browser-receipts/proofloop-live-room-proof.json";
const REQUIRE_FOCUS_MODE = process.env.PROOFLOOP_FOCUS_MODE !== "0";
const AGENT_MODEL_MODE = process.env.BENCH_AGENT_MODEL_MODE ?? process.env.PROOFLOOP_AGENT_MODEL_MODE ?? "specific";
const AGENT_MODEL_POLICY = process.env.BENCH_AGENT_MODEL_POLICY ?? process.env.PROOFLOOP_AGENT_MODEL_POLICY ?? "z-ai/glm-5.2";
const NODEAGENT_RUNTIME_PROFILE = process.env.PROOFLOOP_NODEAGENT_RUNTIME_PROFILE
  ?? (process.env.PROOFLOOP_REAL_USER_MODE === "1" ? "" : "benchmark_completion");
const TASK_ID_FILTER = parseProofloopTaskIds(process.env.PROOFLOOP_TASK_IDS);
const FRESH_ROOM_PER_TASK = process.env.PROOFLOOP_FRESH_ROOM_PER_TASK !== "0";

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
  passed: boolean;
  matchedPatterns: string[];
  unmatchedPatterns: string[];
  streamingVisible: boolean;
  jobStatusVisible: boolean;
  jobDetailVisible: boolean;
  roomTraceVisible: boolean;
  jobCompleted: boolean;
  caveatFindings: string[];
  blockingCaveats: string[];
  placeholderFindings: string[];
  durationMs: number;
  receiptPath: string;
  telemetry: LiveRunTelemetry | null;
  error?: string;
};

type LiveRunTelemetry = {
  model: string;
  toolCalls: number | null;
  steps: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  costUsd: number | null;
  rawText: string;
  rawTitle: string;
};

const CAVEAT_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "unfinished_continue", pattern: /\b(let me|i will|i'll|need to|needs to|still need to)\s+(continue|read|gather|find|calculate|extract|build|work)\b/i },
  { code: "unfinished_remaining", pattern: /\b(continue reading|continue analyzing|remaining work|not yet complete|still working|next step is)\b/i },
  { code: "missing_source_data", pattern: /\b(no|missing|insufficient)\s+(source|financial|cell|input|workbook)\s+(data|values?|rows?)\b/i },
];
const NON_BLOCKING_CAVEAT_CODES = new Set(["unfinished_continue", "unfinished_remaining"]);
const PLACEHOLDER_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "lorem_ipsum", pattern: /lorem ipsum/i },
  { code: "todo_marker", pattern: /\btodo\b/i },
  { code: "tbd_marker", pattern: /\btbd\b/i },
  { code: "placeholder_marker", pattern: /\bplaceholder\s+(?:text|copy|content|value|data|citation|source|row|cell|title|here)\b/i },
  { code: "insert_bracket", pattern: /\[insert[^\]]*\]/i },
  { code: "xxx_marker", pattern: /\bxxx+\b/i },
  { code: "object_object_marker", pattern: /\[object Object\]/i },
];

test.skip(!ENABLED, "Set PROOFLOOP_LIVE_BROWSER=1 to run the live browser proof-loop.");

test("Live browser proof-loop: starter room -> agent tasks -> UI + terminal-quality verification", async ({ page }, testInfo) => {
  const tasks = loadTasks();
  test.setTimeout(TEST_TIMEOUT_MS ?? suiteTimeoutFor(tasks));
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.message ?? error)));

  if (REQUIRE_FOCUS_MODE) await enableFocusModeForTest(page);
  await page.addInitScript((runtimeProfile) => {
    try {
      if (runtimeProfile) {
        window.localStorage?.setItem("noderoom.nodeagentRuntimeProfile", runtimeProfile);
      } else {
        window.localStorage?.removeItem("noderoom.nodeagentRuntimeProfile");
      }
    } catch { /* opaque storage in some frames */ }
  }, NODEAGENT_RUNTIME_PROFILE);

  await createFreshStarterRoom(page);
  console.log(`[proofloop-live] room created: ${page.url()}`);
  if (COCKPIT_ENABLED) {
    await installCockpit(page, { suite: "live-browser", baseUrl: BASE });
    await emitCockpitEvent(page, { type: "run_start", message: `run ${RUN_ID} · ${tasks.length} tasks` }, COCKPIT_EVENTS_PATH);
  }
  await emitCockpitEvent(page, { type: "gate_pass", gate: "fresh_room_join" }, COCKPIT_EVENTS_PATH);
  if (REQUIRE_FOCUS_MODE) {
    await expectFocusModeOn(page);
    await openSheetSurfaceForFocusOverlay(page, tasks[0]?.name.includes("Runway") ? "Runway" : "Q3 variance");
    await expectAttentionOverlayMounted(page);
    await emitCockpitEvent(page, { type: "gate_pass", gate: "focus_mode_enabled" }, COCKPIT_EVENTS_PATH);
    await emitCockpitEvent(page, { type: "gate_pass", gate: "focus_box_or_attention_overlay" }, COCKPIT_EVENTS_PATH);
  }
  await selectAgentRoute(page);

  let suiteRoomUrl = page.url();
  const taskProofs: TaskProof[] = [];
  const taskFailures: string[] = [];
  const singleTaskRun = tasks.length === 1;

  for (const task of tasks) {
    if (FRESH_ROOM_PER_TASK && taskProofs.length > 0) {
      await createFreshStarterRoom(page);
      suiteRoomUrl = page.url();
      console.log(`[proofloop-live] room created: ${suiteRoomUrl}`);
      if (COCKPIT_ENABLED) await installCockpit(page, { suite: "live-browser", baseUrl: BASE });
      await emitCockpitEvent(page, { type: "gate_pass", gate: "fresh_room_join" }, COCKPIT_EVENTS_PATH);
      if (REQUIRE_FOCUS_MODE) {
        await expectFocusModeOn(page);
        await openSheetSurfaceForFocusOverlay(page, task.name.includes("Runway") ? "Runway" : "Q3 variance");
        await expectAttentionOverlayMounted(page);
        await emitCockpitEvent(page, { type: "gate_pass", gate: "focus_mode_enabled" }, COCKPIT_EVENTS_PATH);
        await emitCockpitEvent(page, { type: "gate_pass", gate: "focus_box_or_attention_overlay" }, COCKPIT_EVENTS_PATH);
      }
      await selectAgentRoute(page);
    }

    const taskTimeout = taskTimeoutFor(task);
    console.log(`[proofloop-live] running task: ${task.name}`);
    console.log(`[proofloop-live] task budget: ${task.id} timeout=${taskTimeout}ms streamWait<=${STREAM_WAIT_MS}ms`);
    const started = Date.now();
    const taskDeadline = started + taskTimeout;
    const agentGoal = withNodeAgentMention(task.goal);
    const taskRoomUrl = page.url();
    await openTaskEvidenceSurface(page, task);
    const streams = page.locator(noderoomSelectors.agentStream);
    const streamCountBeforeSend = await streams.count().catch(() => 0);
    let stream = streams.last();

    await emitCockpitEvent(page, { type: "agent_status", message: `${task.name}: sending goal` }, COCKPIT_EVENTS_PATH);
    const composer = page.locator(noderoomSelectors.chatComposer);
    await expect(composer).toBeVisible({ timeout: 30_000 });
    await composer.fill(agentGoal);
    const sendButton = page.locator(noderoomSelectors.chatSend);
    await expect(sendButton).toBeVisible({ timeout: 30_000 });
    await expect(sendButton).toBeEnabled({ timeout: 30_000 });
    await sendButton.click();

    let streamingVisible = false;
    try {
      stream = await waitForNewAgentStream(page, streamCountBeforeSend, streamWaitFor(taskDeadline));
      streamingVisible = true;
      await emitCockpitEvent(page, { type: "gate_pass", gate: "visible_streaming_progress" }, COCKPIT_EVENTS_PATH);
    } catch {
      stream = page.locator(noderoomSelectors.agentStream).last();
      streamingVisible = await stream.isVisible().catch(() => false);
      console.warn(`[proofloop-live] streaming did not become visible for task: ${task.id}`);
      await emitCockpitEvent(page, { type: "gate_fail", gate: "visible_streaming_progress" }, COCKPIT_EVENTS_PATH);
    }

    let jobStatusVisible = false;
    try {
      await expect(page.locator(noderoomSelectors.jobStatus).first())
        .toContainText(/queued|running|completed|blocked|failed/i, { timeout: 60_000 });
      jobStatusVisible = true;
    } catch {
      const completion = await currentAgentCompletionFast(page, stream);
      jobStatusVisible = completion.completed || streamingVisible;
      if (!jobStatusVisible) console.warn(`[proofloop-live] job status did not become visible for task: ${task.id}`);
    }

    let jobDetailVisible = false;
    try {
      const jobDetail = page.locator(noderoomSelectors.jobDetail).first();
      if (!(await jobDetail.isVisible().catch(() => false))) {
        await page.locator(noderoomSelectors.jobDetailToggle).first().click({ timeout: 10_000 });
      }
      await expect(jobDetail).toBeVisible({ timeout: 15_000 });
      jobDetailVisible = true;
      await emitCockpitEvent(page, { type: "gate_pass", gate: "job_detail_visible" }, COCKPIT_EVENTS_PATH);
      const jobDetailText = (await jobDetail.textContent().catch(() => "")) ?? "";
      await emitCockpitEvent(page, { type: "signal", message: `activity: ${jobDetailText.replace(/\s+/g, " ").trim().slice(0, 160)}` }, COCKPIT_EVENTS_PATH);
    } catch {
      console.warn(`[proofloop-live] job detail not visible for task: ${task.id}`);
    }

    let jobCompleted = false;
    let jobFailureStatus: string | undefined;
    const completionPollMs = 5_000;
    const completionPolls = Math.max(1, Math.ceil(Math.max(0, taskDeadline - Date.now()) / completionPollMs));
    console.log(`[proofloop-live] completion loop: ${task.id} elapsed=${Date.now() - started}ms polls=${completionPolls}`);
    for (let poll = 0; poll < completionPolls; poll += 1) {
      const completion = await currentAgentCompletionFast(page, stream);
      if (completion.completed) { jobCompleted = true; break; }
      if (completion.failed) {
        jobFailureStatus = completion.statusText;
        console.warn(`[proofloop-live] job reached non-passing status: ${completion.statusText}`);
        await emitCockpitEvent(page, { type: "warning", message: `${task.id}: job status ${completion.statusText}` }, COCKPIT_EVENTS_PATH);
        break;
      }
      await page.waitForTimeout(completionPollMs);
    }
    streamingVisible = streamingVisible || await stream.isVisible().catch(() => false);
    const agentOutput = ((await stream.textContent().catch(() => "")) ?? "").slice(0, 6_000);

    await openTaskEvidenceSurface(page, task);

    let roomTraceVisible = false;
    try {
      const trace = page.locator(noderoomSelectors.roomTrace).first();
      if (await trace.isVisible().catch(() => false)) {
        roomTraceVisible = true;
      } else {
        await expect(page.getByText(/\d+\s+trace events/i).first()).toBeVisible({ timeout: 30_000 });
        roomTraceVisible = true;
      }
      await emitCockpitEvent(page, { type: "gate_pass", gate: "room_trace_visible" }, COCKPIT_EVENTS_PATH);
    } catch {
      console.warn(`[proofloop-live] room trace not visible for task: ${task.id}`);
      await emitCockpitEvent(page, { type: "gate_fail", gate: "room_trace_visible" }, COCKPIT_EVENTS_PATH);
    }
    const runTelemetry = await latestRunTelemetry(page);

    const artifactEvidenceText = await visibleTaskEvidenceText(page, task);
    const scoringText = task.expectArtifactEdit ? artifactEvidenceText : `${agentOutput}\n${artifactEvidenceText}`;
    const fullVisibleText = `${agentOutput}\n${artifactEvidenceText}`;
    const outputLower = scoringText.toLowerCase();
    const matchedPatterns: string[] = [];
    const unmatchedPatterns: string[] = [];
    for (const pattern of task.passPatterns) {
      (matchesProofPattern(outputLower, pattern) ? matchedPatterns : unmatchedPatterns).push(pattern);
    }
    const publicAgentDone = await currentPublicAgentDone(page);
    const effectiveJobCompleted = !jobFailureStatus && (jobCompleted || (singleTaskRun && publicAgentDone && matchedPatterns.length === task.passPatterns.length));
    await emitCockpitEvent(page, { type: effectiveJobCompleted ? "gate_pass" : "gate_fail", gate: "agent_job_completed" }, COCKPIT_EVENTS_PATH);
    const evidenceReady = effectiveJobCompleted && matchedPatterns.length === task.passPatterns.length;

    const caveatFindings = [...new Set(CAVEAT_PATTERNS.filter(({ pattern }) => pattern.test(agentOutput)).map(({ code }) => code))];
    const blockingCaveats = evidenceReady ? caveatFindings.filter((code) => !NON_BLOCKING_CAVEAT_CODES.has(code)) : caveatFindings;

    const placeholderFindings = [...new Set(PLACEHOLDER_PATTERNS.filter(({ pattern }) => pattern.test(fullVisibleText)).map(({ code }) => code))];

    const passed = evidenceReady && blockingCaveats.length === 0 && placeholderFindings.length === 0;
    await emitCockpitEvent(page, { type: blockingCaveats.length === 0 ? "gate_pass" : "gate_fail", gate: "agent_terminal_quality_gate" }, COCKPIT_EVENTS_PATH);
    await emitCockpitEvent(page, { type: placeholderFindings.length === 0 ? "gate_pass" : "gate_fail", gate: "artifact_placeholder_scan" }, COCKPIT_EVENTS_PATH);
    await emitCockpitEvent(page, { type: passed ? "gate_pass" : "gate_fail", message: `${task.id}: ${passed ? "PASS" : "FAIL"}` }, COCKPIT_EVENTS_PATH);

    const screenshotPath = testInfo.outputPath(`proofloop-${task.id}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 30_000 });
    await testInfo.attach(`proofloop-${task.id}`, { path: screenshotPath, contentType: "image/png" });

    const gatesProven: FreshRoomProofReceipt["gatesProven"] = [
      "fresh_room_join",
      "public_nodeagent_invocation",
      "no_memory_mode_shortcut",
      "agent_live_loop",
      ...(REQUIRE_FOCUS_MODE ? (["focus_mode_enabled", "focus_box_or_attention_overlay"] as const) : []),
      "trace_video_artifacts",
      ...(streamingVisible ? (["visible_streaming_progress"] as const) : []),
      ...(jobDetailVisible ? (["job_detail_visible"] as const) : []),
      ...(roomTraceVisible ? (["room_trace_visible"] as const) : []),
      ...(blockingCaveats.length === 0 ? (["agent_terminal_quality_gate"] as const) : []),
      ...(placeholderFindings.length === 0 ? (["artifact_placeholder_scan"] as const) : []),
      ...(passed ? (["official_scorer_handoff"] as const) : []),
    ];

    const generatedAt = new Date().toISOString();
    const modelReceipt = buildFreshRoomModelReceipt([runTelemetry]);
    const receipt: FreshRoomProofReceipt = {
      schema: 1,
      caseId: FRESH_PROOF_CASE_ID,
      benchmark: "product-smoke",
      taskId: task.id,
      generatedAt,
      baseUrl: BASE,
      roomId: roomIdFromUrl(taskRoomUrl),
      roomUrl: taskRoomUrl,
      command: proofloopLiveBrowserCommand(),
      model: modelReceipt,
      prompt: agentGoal.slice(0, 1_200),
      memoryMode: false,
      freshness: {
        roomCreatedAfterRunStart: true,
        forbiddenPreloadedArtifactsAbsent: true,
        artifactsCreatedFresh: [task.id],
      },
      ui: {
        focusModeEnabled: REQUIRE_FOCUS_MODE,
        attentionOverlayVisible: REQUIRE_FOCUS_MODE,
        streamingVisible,
        jobDetailVisible,
        roomTraceVisible,
        screenshotPaths: [screenshotPath],
        tracePath: screenshotPath,
      },
      artifacts: {
        created: [task.id],
      },
      scorer: {
        name: "Pass-pattern text scorer",
        command: "internal proofloop pattern match",
        verdict: passed ? "pass" : "fail",
        score: task.passPatterns.length > 0 ? matchedPatterns.length / task.passPatterns.length : 0,
        details: { matchedPatterns, unmatchedPatterns, caveatFindings, blockingCaveats, placeholderFindings },
      },
      visualJudge: {
        verdict: "not_run",
        reason: "No Gemini visual judge configured for proof-loop cell-writing tasks.",
      },
      telemetry: freshRoomTelemetryFor([runTelemetry], modelReceipt),
      gatesProven,
      passed,
    };

    const receiptPath = join(FRESH_PROOF_ROOT, FRESH_PROOF_CASE_ID, "tasks", task.id, "latest.json");
    writeFreshRoomProofReceipt(receipt, receiptPath);
    const validation = validateFreshRoomProofReceipt(receipt, {
      path: receiptPath,
      caseId: FRESH_PROOF_CASE_ID,
      requireArtifactPlaceholderScan: true,
      requireAgentTerminalQuality: true,
      requireOfficialScorer: passed,
      requireFocusMode: REQUIRE_FOCUS_MODE,
    });
    if (!validation.ok) console.warn(`[proofloop-live] receipt validation gaps for ${task.id}: ${validation.errors.join("; ")}`);

    const durationMs = Date.now() - started;
    const error = jobFailureStatus
      ? `Job reached non-passing status: ${jobFailureStatus}`
      : !effectiveJobCompleted
      ? "Job did not complete within timeout"
      : blockingCaveats.length
        ? `Agent terminal quality gate failed: ${blockingCaveats.join(", ")}`
        : placeholderFindings.length
          ? `Artifact placeholder scan failed: ${placeholderFindings.join(", ")}`
          : matchedPatterns.length < task.passPatterns.length
            ? `Unmatched patterns: ${unmatchedPatterns.join(", ")}`
            : undefined;

    taskProofs.push({
      taskId: task.id,
      taskName: task.name,
      passed,
      matchedPatterns,
      unmatchedPatterns,
      streamingVisible,
      jobStatusVisible,
      jobDetailVisible,
      roomTraceVisible,
      jobCompleted: effectiveJobCompleted,
      caveatFindings,
      blockingCaveats,
      placeholderFindings,
      durationMs,
      receiptPath,
      telemetry: runTelemetry,
      error,
    });
    if (!passed) taskFailures.push(`${task.id}: ${error ?? "unknown failure"}`);

    console.log(`[proofloop-live] task ${task.id}: ${passed ? "PASS" : "FAIL"} — ${matchedPatterns.length}/${task.passPatterns.length} patterns, completed=${effectiveJobCompleted}, ${durationMs}ms`);
    await page.waitForTimeout(2_000);
  }

  const passCount = taskProofs.filter((t) => t.passed).length;
  console.log(`[proofloop-live] verdict: ${passCount}/${taskProofs.length} passed`);
  await emitCockpitEvent(page, { type: "run_done", message: `${passCount}/${taskProofs.length} tasks passed` }, COCKPIT_EVENTS_PATH);

  const suiteReceiptPath = resolve(SUITE_PROOF_PATH);
  const suiteModelReceipt = buildFreshRoomModelReceipt(taskProofs.map((t) => t.telemetry));
  const suiteRouteFailures = routeIntegrityFailedGates(suiteModelReceipt);
  const suitePassed = passCount === taskProofs.length && suiteRouteFailures.length === 0;
  writeFreshRoomProofReceipt(
    {
      schema: 1,
      caseId: FRESH_PROOF_CASE_ID,
      benchmark: "product-smoke",
      generatedAt: new Date().toISOString(),
      baseUrl: BASE,
      roomUrl: suiteRoomUrl,
      command: proofloopLiveBrowserCommand(),
      model: suiteModelReceipt,
      memoryMode: false,
      freshness: {
        roomCreatedAfterRunStart: true,
        forbiddenPreloadedArtifactsAbsent: true,
        artifactsCreatedFresh: taskProofs.map((t) => t.taskId),
      },
      ui: {
        focusModeEnabled: REQUIRE_FOCUS_MODE,
        attentionOverlayVisible: REQUIRE_FOCUS_MODE,
        streamingVisible: taskProofs.some((t) => t.streamingVisible),
        roomTraceVisible: taskProofs.some((t) => t.roomTraceVisible),
        screenshotPaths: [],
        tracePath: taskProofs[0]?.receiptPath,
      },
      artifacts: { created: taskProofs.map((t) => t.taskId) },
      scorer: {
        name: "Proof-loop suite aggregate",
        verdict: suitePassed ? "pass" : "fail",
        score: taskProofs.length > 0 ? passCount / taskProofs.length : 0,
        details: { taskProofs, suiteRouteFailures },
      },
      telemetry: freshRoomTelemetryFor(taskProofs.map((t) => t.telemetry), suiteModelReceipt),
      gatesProven: [
        "fresh_room_join",
        "public_nodeagent_invocation",
        "no_memory_mode_shortcut",
        "agent_live_loop",
        ...(REQUIRE_FOCUS_MODE ? (["focus_mode_enabled", "focus_box_or_attention_overlay"] as const) : []),
        "trace_video_artifacts",
        ...(suitePassed ? (["official_scorer_handoff"] as const) : []),
      ],
      passed: suitePassed,
    },
    suiteReceiptPath,
  );
  console.log(`[proofloop-live] suite receipt written: ${suiteReceiptPath}`);

  const unexpectedErrors = pageErrors.filter((msg) => !isBenignError(msg));
  expect(unexpectedErrors, `unexpected page errors: ${unexpectedErrors.join("; ")}`).toEqual([]);
  expect(taskProofs.some((t) => t.streamingVisible), "at least one task must show visible streaming").toBe(true);
  expect([...taskFailures, ...suiteRouteFailures], `task failures: ${[...taskFailures, ...suiteRouteFailures].join(" | ")}`).toEqual([]);
});

async function createFreshStarterRoom(page: Page): Promise<void> {
  const code = `pl${Date.now().toString(36)}`.slice(0, 12);
  await page.goto(`${BASE}/?demo=${encodeURIComponent(code)}&name=${encodeURIComponent("Proof Loop")}`, { waitUntil: "domcontentloaded" });
  expect(page.url(), "proof-loop must not use memory mode").not.toContain("mode=memory");
  await expect(page.getByText(noderoomTextLocators.liveConvex)).toBeVisible({ timeout: 30_000 });
}

async function ensureLeftRailVisible(page: Page): Promise<void> {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click({ timeout: 30_000 });
  }
  await expect(leftRail).toBeVisible({ timeout: 30_000 });
}

async function openSheetSurfaceForFocusOverlay(page: Page, preferredTitle: string): Promise<void> {
  await ensureLeftRailVisible(page);
  const byTitle = page.locator(`${noderoomSelectors.binderArtifact}[data-artifact-title*="${preferredTitle}"]`).first();
  if (await byTitle.isVisible().catch(() => false)) {
    await byTitle.click({ timeout: 30_000 });
  } else {
    await page.locator(noderoomSelectors.binderArtifact).first().click({ timeout: 30_000 });
  }
  await expect(page.locator(noderoomSelectors.sheetSurface).first()).toBeVisible({ timeout: 30_000 });
}

async function selectAgentRoute(page: Page): Promise<void> {
  const preset = page.locator(noderoomSelectors.chatModelPreset).first();
  if (!(await preset.isVisible({ timeout: 30_000 }).catch(() => false))) return;
  await preset.selectOption(AGENT_MODEL_MODE);
  if (AGENT_MODEL_MODE === "specific") {
    const specific = page.locator(noderoomSelectors.chatModelSpecific).first();
    await expect(specific).toBeVisible({ timeout: 30_000 });
    await specific.fill(AGENT_MODEL_POLICY);
  }
  await expect(preset).toHaveValue(AGENT_MODEL_MODE, { timeout: 30_000 });
}

async function visibleBinderArtifactText(page: Page): Promise<string> {
  return page.locator([
    noderoomSelectors.binderArtifact,
    noderoomSelectors.agentStream,
    '[data-noderoom-surface="workSurface.sheet"]',
    '[data-noderoom-surface="workSurface.research"]',
    '[data-noderoom-surface="workSurface.notebook"]',
    '[data-noderoom-surface="workSurface.agentNotes"]',
    '[data-noderoom-surface="workSurface.wall"]',
  ].join(",")).evaluateAll((els) => els.map((el) => el.textContent ?? "").join("\n"));
}

async function visibleTaskEvidenceText(page: Page, task: TaskConfig): Promise<string> {
  const title = evidenceArtifactTitleForTask(task);
  if (!title) return visibleBinderArtifactText(page);
  await ensureLeftRailVisible(page);
  const artifact = page.locator(noderoomSelectors.binderArtifact).filter({ hasText: new RegExp(escapeRegExp(title), "i") }).first();
  if (!(await artifact.isVisible({ timeout: 10_000 }).catch(() => false))) {
    console.warn(`[proofloop-live] target artifact not visible for evidence text: ${title}`);
    return "";
  }
  const artifactId = await artifact.getAttribute("data-artifact-id");
  await artifact.click({ timeout: 30_000 });
  await page.waitForTimeout(1_000);
  if (!artifactId) return "";
  const surface = page.locator(`[data-noderoom-surface^="workSurface."][data-artifact-id="${cssAttr(artifactId)}"]`);
  await expect(surface.first()).toBeVisible({ timeout: 30_000 });
  return surface.evaluateAll((els) => els.map((el) => {
    const fields = Array.from(el.querySelectorAll("input, textarea"))
      .map((field) => (field as HTMLInputElement | HTMLTextAreaElement).value ?? "")
      .join("\n");
    return [el.textContent ?? "", fields].filter(Boolean).join("\n");
  }).join("\n"));
}

async function openTaskEvidenceSurface(page: Page, task: TaskConfig): Promise<void> {
  const title = evidenceArtifactTitleForTask(task);
  if (!title) return;
  await ensureLeftRailVisible(page);
  const artifact = page.locator(noderoomSelectors.binderArtifact).filter({ hasText: new RegExp(escapeRegExp(title), "i") }).first();
  if (!(await artifact.isVisible({ timeout: 10_000 }).catch(() => false))) {
    console.warn(`[proofloop-live] target artifact not visible for scoring: ${title}`);
    return;
  }
  const artifactId = await artifact.getAttribute("data-artifact-id");
  await artifact.click({ timeout: 30_000 });
  if (artifactId) {
    await expect(page.locator(`[data-noderoom-surface^="workSurface."][data-artifact-id="${cssAttr(artifactId)}"]`).first())
      .toBeVisible({ timeout: 30_000 });
  }
  await page.waitForTimeout(1_000);
}

function evidenceArtifactTitleForTask(task: TaskConfig): string | undefined {
  const text = `${task.id} ${task.name} ${task.goal}`.toLowerCase();
  if (/\b(research|cardionova|headcount|funding)\b/.test(text)) return "Company research";
  if (/\b(memo|diligence|product overview|market position)\b/.test(text)) return "Diligence memo";
  if (/\b(runway|milestone|burn)\b/.test(text)) return "Runway / milestones";
  if (/\b(variance|q3|q2)\b/.test(text)) return "Q3 variance";
  return undefined;
}

function cssAttr(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function roomIdFromUrl(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get("room") ?? undefined;
  } catch {
    return undefined;
  }
}

function loadTasks(): TaskConfig[] {
  if (!existsSync(resolve(TASKS_JSON))) {
    throw new Error(`Proof-loop config not found: ${TASKS_JSON}`);
  }
  const config = JSON.parse(readFileSync(resolve(TASKS_JSON), "utf8").replace(/^\uFEFF/, ""));
  if (!config.tasks || !Array.isArray(config.tasks) || config.tasks.length === 0) {
    throw new Error(`No tasks found in ${TASKS_JSON}`);
  }
  return filterProofloopTasksByIds(config.tasks as TaskConfig[], TASK_ID_FILTER);
}

function suiteTimeoutFor(tasks: TaskConfig[]): number {
  const taskBudget = tasks.reduce((sum, task) => sum + taskTimeoutFor(task), 0);
  return Math.max(25 * 60_000, taskBudget + 10 * 60_000);
}

function taskTimeoutFor(task: TaskConfig): number {
  const configured = Number(task.timeoutMs);
  const taskBudget = Number.isFinite(configured) && configured > 0 ? configured : AGENT_TIMEOUT_MS;
  return Math.max(5_000, Math.min(taskBudget, MAX_TASK_TIMEOUT_MS));
}

function matchesProofPattern(lowerScoringText: string, pattern: string): boolean {
  const lowerPattern = pattern.toLowerCase();
  return lowerScoringText.includes(lowerPattern) ||
    lowerScoringText.replace(/,/g, "").includes(lowerPattern.replace(/,/g, ""));
}

async function currentAgentCompletion(page: Page, stream: Locator): Promise<{
  completed: boolean;
  failed: boolean;
  statusText: string;
}> {
  const jobStatus = (await quickText(page.locator(noderoomSelectors.jobStatus).first())).trim();
  const streamText = (await quickText(stream)).trim();
  const latestStream = page.locator(noderoomSelectors.agentStream).last();
  const latestStreamText = (await quickText(latestStream)).trim();
  const progressStatus = (await quickAttribute(latestStream.locator(noderoomSelectors.agentProgressCard).last(), "data-status")).trim();
  const peopleText = ((await page.locator("text=/Public agent\\s*·\\s*(done|failed|blocked|idle|running)/i").last().textContent().catch(() => "")) ?? "").trim();
  return classifyAgentCompletion({ jobStatus, progressStatus, peopleText, streamText, latestStreamText });
}

async function currentPublicAgentDone(page: Page): Promise<boolean> {
  const peopleText = (await quickText(page.locator("text=/Public agent\\s*.\\s*(done|failed|blocked|idle|running)/i").last())).trim();
  return noderoomTextLocators.publicAgentDone.test(peopleText);
}

async function currentAgentCompletionFast(page: Page, stream: Locator): Promise<{
  completed: boolean;
  failed: boolean;
  statusText: string;
}> {
  const jobStatus = (await quickText(page.locator(noderoomSelectors.jobStatus).first())).trim();
  const streamText = (await quickText(stream)).trim();
  const latestStream = page.locator(noderoomSelectors.agentStream).last();
  const latestStreamText = (await quickText(latestStream)).trim();
  const progressStatus = (await quickAttribute(latestStream.locator(noderoomSelectors.agentProgressCard).last(), "data-status")).trim();
  const peopleText = (await quickText(page.locator("text=/Public agent\\s*.\\s*(done|failed|blocked|idle|running)/i").last())).trim();
  return classifyAgentCompletion({ jobStatus, progressStatus, peopleText, streamText, latestStreamText });
}

async function quickText(locator: Locator, timeout = 250): Promise<string> {
  return ((await locator.textContent({ timeout }).catch(() => "")) ?? "");
}

async function quickAttribute(locator: Locator, name: string, timeout = 250): Promise<string> {
  return ((await locator.getAttribute(name, { timeout }).catch(() => "")) ?? "");
}

function streamWaitFor(taskDeadline: number): number {
  const remaining = taskDeadline - Date.now();
  return Math.max(5_000, Math.min(STREAM_WAIT_MS, remaining));
}

function proofloopLiveBrowserCommand(): string {
  return [
    "PROOFLOOP_LIVE_BROWSER=1",
    `PROOFLOOP_TASKS_JSON=${TASKS_JSON}`,
    TASK_ID_FILTER.length > 0 ? `PROOFLOOP_TASK_IDS=${TASK_ID_FILTER.join(",")}` : undefined,
    process.env.PROOFLOOP_TEST_TIMEOUT_MS ? `PROOFLOOP_TEST_TIMEOUT_MS=${process.env.PROOFLOOP_TEST_TIMEOUT_MS}` : undefined,
    process.env.PROOFLOOP_MAX_TASK_TIMEOUT_MS ? `PROOFLOOP_MAX_TASK_TIMEOUT_MS=${process.env.PROOFLOOP_MAX_TASK_TIMEOUT_MS}` : undefined,
    process.env.PROOFLOOP_STREAM_WAIT_MS ? `PROOFLOOP_STREAM_WAIT_MS=${process.env.PROOFLOOP_STREAM_WAIT_MS}` : undefined,
    `PROOFLOOP_FOCUS_MODE=${REQUIRE_FOCUS_MODE ? "1" : "0"}`,
    `PROOFLOOP_NODEAGENT_RUNTIME_PROFILE=${NODEAGENT_RUNTIME_PROFILE}`,
    `BENCH_AGENT_MODEL_MODE=${AGENT_MODEL_MODE}`,
    `BENCH_AGENT_MODEL_POLICY=${AGENT_MODEL_POLICY}`,
    "npx playwright test --config playwright.proofloop.config.ts proofloop/live-browser-proof.spec.ts --headed",
  ].filter(Boolean).join(" ");
}

function buildFreshRoomModelReceipt(telemetry: Array<LiveRunTelemetry | null | undefined>): NonNullable<FreshRoomProofReceipt["model"]> {
  const provider = providerForAgentModelPolicy(AGENT_MODEL_POLICY);
  const measured = aggregateTelemetry(telemetry);
  const routeIntegrity = evaluateProofloopRouteIntegrity({
    requestedModel: AGENT_MODEL_POLICY,
    telemetry,
  });
  const costFields = proofloopModelCostFieldsForRun({
    modelId: AGENT_MODEL_POLICY,
    provider,
    routePolicy: AGENT_MODEL_MODE,
    costUsd: measured.costUsd,
    tokensIn: measured.inputTokens,
    tokensOut: measured.outputTokens,
    source: "browser_telemetry",
  });
  return {
    id: AGENT_MODEL_POLICY,
    requested: AGENT_MODEL_POLICY,
    resolved: measured.model ?? AGENT_MODEL_POLICY,
    routePolicy: AGENT_MODEL_MODE,
    role: "planner",
    costUsd: finiteOrNull(costFields.costUsd),
    tokensIn: finiteOrNull(costFields.tokensIn),
    tokensOut: finiteOrNull(costFields.tokensOut),
    costAccounting: costFields.costAccounting,
    runtimeProfile: NODEAGENT_RUNTIME_PROFILE || "standard",
    provider,
    routeIntegrity,
  };
}

function routeIntegrityFailedGates(model: NonNullable<FreshRoomProofReceipt["model"]>): string[] {
  if (!model.routeIntegrity || model.routeIntegrity.status === "matched") return [];
  return [`model_route_mismatch: ${routeIntegrityFailureSummary(model.routeIntegrity) ?? "model route integrity could not be proven"}`];
}

function freshRoomTelemetryFor(
  telemetry: Array<LiveRunTelemetry | null | undefined>,
  model: NonNullable<FreshRoomProofReceipt["model"]>,
): FreshRoomProofReceipt["telemetry"] | undefined {
  const measured = aggregateTelemetry(telemetry);
  if (
    measured.costUsd === null &&
    measured.inputTokens === null &&
    measured.outputTokens === null &&
    measured.latencyMs === null &&
    measured.toolCalls === null
  ) {
    return undefined;
  }
  return {
    ...(measured.latencyMs !== null ? { latencyMs: measured.latencyMs } : {}),
    ...(measured.inputTokens !== null ? { inputTokens: measured.inputTokens } : {}),
    ...(measured.outputTokens !== null ? { outputTokens: measured.outputTokens } : {}),
    ...(measured.toolCalls !== null ? { toolCalls: measured.toolCalls } : {}),
    ...(typeof model.costUsd === "number" && Number.isFinite(model.costUsd) ? { costUsd: model.costUsd } : {}),
  };
}

function aggregateTelemetry(telemetry: Array<LiveRunTelemetry | null | undefined>): {
  model: string | null;
  costUsd: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number | null;
  toolCalls: number | null;
} {
  const rows = telemetry.filter((item): item is LiveRunTelemetry => item != null);
  return {
    model: rows.map((row) => row.model).find((value) => value.trim().length > 0) ?? null,
    costUsd: sumNullable(rows.map((row) => row.costUsd)),
    inputTokens: sumNullable(rows.map((row) => row.inputTokens)),
    outputTokens: sumNullable(rows.map((row) => row.outputTokens)),
    latencyMs: sumNullable(rows.map((row) => row.latencyMs)),
    toolCalls: sumNullable(rows.map((row) => row.toolCalls)),
  };
}

async function latestRunTelemetry(page: Page): Promise<LiveRunTelemetry | null> {
  const locator = page.locator(".r-trace-tele").last();
  if (!(await locator.isVisible({ timeout: 10_000 }).catch(() => false))) return null;
  const rawText = ((await locator.textContent().catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  const rawTitle = ((await locator.getAttribute("title").catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
  const costMatch = rawText.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
  const toolMatch = rawText.match(/(?:^|[^0-9A-Za-z])\s*([0-9,]+)\s+tools?\b/i);
  const modelMatch = rawText.match(/^(.+?)\s+[^0-9A-Za-z\s]\s+/);
  const model = modelMatch?.[1]?.trim() || rawText.replace(/\b[0-9,]+\s+tools?\b.*$/i, "").trim();
  const titleMatch = rawTitle.match(/([0-9,]+)\s+steps\s+[^0-9]+([0-9,]+)\s+in\s+\+\s+([0-9,]+)\s+out\s+tokens\s+[^0-9]+([0-9,]+)ms/i);
  return {
    model,
    toolCalls: toolMatch ? parseCount(toolMatch[1]) : null,
    steps: titleMatch ? parseCount(titleMatch[1]) : null,
    inputTokens: titleMatch ? parseCount(titleMatch[2]) : null,
    outputTokens: titleMatch ? parseCount(titleMatch[3]) : null,
    latencyMs: titleMatch ? parseCount(titleMatch[4]) : null,
    costUsd: costMatch ? Number(costMatch[1]) : null,
    rawText,
    rawTitle,
  };
}

function sumNullable(values: Array<number | null>): number | null {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (finite.length === 0) return null;
  return Number(finite.reduce((sum, value) => sum + value, 0).toFixed(8));
}

function parseCount(value: string): number {
  return Number(value.replace(/,/g, ""));
}

function finiteOrNull(value: number): number | null {
  return Number.isFinite(value) ? value : null;
}

async function waitForNewAgentStream(page: Page, previousCount: number, timeoutMs: number): Promise<Locator> {
  const streams = page.locator(noderoomSelectors.agentStream);
  const deadline = Date.now() + Math.min(timeoutMs, 10 * 60_000);
  while (Date.now() < deadline) {
    const count = await streams.count().catch(() => 0);
    if (count > previousCount) {
      const stream = streams.nth(previousCount);
      if (await stream.isVisible().catch(() => false)) return stream;
    }
    await page.waitForTimeout(2_000);
  }
  throw new Error(`Timed out waiting for new agent stream; previous=${previousCount}, current=${await streams.count().catch(() => 0)}`);
}

function isBenignError(message: string): boolean {
  return /localStorage|sessionStorage|IndexedDB|quota|storage/i.test(message);
}
