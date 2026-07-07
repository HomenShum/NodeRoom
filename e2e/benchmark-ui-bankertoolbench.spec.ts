/**
 * BankerToolBench live-browser fresh-room contract.
 *
 * This is intentionally not a seeded #btb evidence-room replay. When enabled it runs the same path
 * a real user must be able to watch in the browser:
 *
 *   fresh live room -> upload BTB task inputs -> public @nodeagent -> streamed tool loop ->
 *   visible trace/focus boxes -> generated XLSX/XLSM/PPTX/DOCX/PDF package -> verifier receipt.
 *
 * It is skipped by default because it requires a local official-shaped BTB bundle and a verifier
 * command. To run:
 *
 *   BTB_LIVE_ROOM_E2E=1 \
 *   BTB_UI_BUNDLE_ROOT=.tmp/official-benchmarks/btb-fixture \
 *   BTB_UI_VERIFIER_COMMAND="npm run benchmark:bankertoolbench:proof" \
 *   BENCH_BASE_URL=http://127.0.0.1:5273 \
 *   npx playwright test --config playwright.real-flow.config.ts e2e/benchmark-ui-bankertoolbench.spec.ts --headed
 */
import { test, expect, type Page } from "@playwright/test";
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import JSZip from "jszip";
import { scanBankerToolBenchBundle, type BankerToolBenchTask } from "../src/eval/bankerToolBenchAdapter";
import { assertBtbTaskCoverage, inferOfficialBtbTickers, type BtbTaskCoverageResult } from "../src/eval/btbTaskCoverage";
import { writeFreshRoomProofReceipt, type FreshRoomExportReceipt } from "../src/eval/freshRoomProofReceipts";
import { enableFocusModeForTest, expectAttentionOverlayMounted, expectFocusModeOn } from "./focusMode";
import { createScratchSheetFromStarterHome } from "./liveStarter";
import { installCockpit, emitCockpitEvent, cockpitEventsPath } from "../proofloop/cockpit/playwrightOverlay";

const BASE = process.env.BENCH_BASE_URL ?? "http://localhost:5273";
const ENABLED = process.env.BTB_LIVE_ROOM_E2E === "1";
const BUNDLE_ROOT = process.env.BTB_UI_BUNDLE_ROOT ?? ".tmp/official-benchmarks/btb-fixture";
const TASK_ID = process.env.BTB_UI_TASK_ID;
const VERIFIER_COMMAND = process.env.BTB_UI_VERIFIER_COMMAND;
const AGENT_COMPLETION_TIMEOUT_MS = Number(process.env.BTB_AGENT_COMPLETION_TIMEOUT_MS ?? 20 * 60_000);
const AGENT_TERMINAL_TIMEOUT_MS = Number(process.env.BTB_AGENT_TERMINAL_TIMEOUT_MS ?? AGENT_COMPLETION_TIMEOUT_MS);
const STREAM_START_TIMEOUT_MS = Number(process.env.BTB_STREAM_START_TIMEOUT_MS ?? AGENT_COMPLETION_TIMEOUT_MS);
const UPLOAD_SURFACE_TIMEOUT_MS = Number(process.env.BTB_UPLOAD_SURFACE_TIMEOUT_MS ?? 12 * 60_000);
const UPLOAD_IDLE_RETRY_MS = Number(process.env.BTB_UPLOAD_IDLE_RETRY_MS ?? 15_000);
const UPLOAD_BUSY_HARD_TIMEOUT_MS = Number(process.env.BTB_UPLOAD_BUSY_HARD_TIMEOUT_MS ?? Math.max(UPLOAD_SURFACE_TIMEOUT_MS, 12 * 60_000));
const MAX_UPLOAD_BATCH_BYTES = Number(process.env.BTB_UPLOAD_BATCH_BYTES ?? 3_000_000);
const MAX_UPLOAD_BATCH_FILES = Number(process.env.BTB_UPLOAD_BATCH_FILES ?? 1);
const SINGLE_UPLOAD_BYTES = Number(process.env.BTB_SINGLE_UPLOAD_BYTES ?? 1_000_000);
const TEST_TIMEOUT_MS = Number(process.env.BTB_TEST_TIMEOUT_MS ?? Math.max(25 * 60_000, AGENT_COMPLETION_TIMEOUT_MS + 5 * 60_000));
const RECORDING_PROOF = process.env.PLAYWRIGHT_RECORD_VIDEO === "1" || process.env.BTB_PROOF_HUMAN_PACING === "1";
const PROOF_TRANSITION_PAUSE_MS = Number(process.env.BTB_PROOF_TRANSITION_PAUSE_MS ?? (RECORDING_PROOF ? 1_250 : 0));
const PROOF_REVIEW_PAUSE_MS = Number(process.env.BTB_PROOF_REVIEW_PAUSE_MS ?? (RECORDING_PROOF ? 7_000 : 0));
const PROOF_PATH = process.env.BTB_LIVE_ROOM_PROOF_PATH ?? "docs/eval/browser-receipts/bankertoolbench-live-room-proof.json";
const FRESH_PROOF_PATH = process.env.BTB_FRESH_ROOM_PROOF_PATH;
const FRESH_PROOF_CASE_ID = "FR-020";
const PACKAGE_MANIFEST_PATH = process.env.BTB_PACKAGE_MANIFEST_PATH ?? "test-results/bankertoolbench/package-manifest.json";
const COCKPIT_ENABLED = process.env.PROOFLOOP_COCKPIT !== "0";
const RUN_ID = process.env.PROOFLOOP_RUN_ID ?? `btb-live-${Date.now()}`;
const COCKPIT_EVENTS_PATH = COCKPIT_ENABLED ? cockpitEventsPath(RUN_ID) : undefined;
const RECOVER_ROOM_CODE = process.env.BTB_RECOVER_ROOM_CODE;
const RECOVER_TRACE_PATH = process.env.BTB_RECOVER_TRACE_PATH;
const REQUIRED_EXTENSIONS = [".xlsx", ".xlsm", ".pptx", ".docx", ".pdf"] as const;

type RequiredExtension = (typeof REQUIRED_EXTENSIONS)[number];
type DownloadedBtbFile = {
  kind: FreshRoomExportReceipt["kind"];
  filename: string;
  path: string;
  extension: RequiredExtension;
  bytes: number;
  magic: string;
  reopened: boolean;
  reopenDetail: string;
  contentQualityDetail: string;
};
type PackageDownloadResult = {
  files: DownloadedBtbFile[];
  exportSource: "browser_download_link" | "convex_room_artifact_data_url_after_browser_ui_proof";
};
type PackageReadySource = PackageDownloadResult["exportSource"];
type AgentTerminalQuality = {
  statusText: string;
  evidenceTextLength: number;
  detail: string;
};
type RecoveredAgentJobCompletion = {
  status: string;
  finalText: string;
  error?: string;
  updatedAt?: number;
};
type RecoveredConvexArtifact = {
  id?: string;
  createdAt?: number;
  title: string;
  generatedSummary?: string;
  value?: {
    fileName?: string;
    mimeType?: string;
    size?: number;
    dataUrl?: string;
    text?: string;
  } | null;
};
type UploadPayload = {
  name: string;
  mimeType: string;
  buffer: Buffer;
};

test.skip(!ENABLED, "Set BTB_LIVE_ROOM_E2E=1 to run the real fresh-room BankerToolBench browser contract.");

test("BankerToolBench fresh-room contract: upload task inputs -> @nodeagent -> package verifier", async ({ page }, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  const loaded = loadTask();
  const recoveryMode = Boolean(RECOVER_ROOM_CODE);
  const proofCommand = recoveryMode
    ? `BTB recovery join room=${RECOVER_ROOM_CODE} task=${loaded.task.id} command="npm run sfn -- noderoom run-btb-matrix --task-id ${loaded.task.id} --recover-room-code ${RECOVER_ROOM_CODE} --headed"`
    : "BTB_LIVE_ROOM_E2E=1 BTB_UI_BUNDLE_ROOT=<official-bundle> BTB_UI_VERIFIER_COMMAND=<verifier> BENCH_BASE_URL=<base> npx playwright test --config playwright.real-flow.config.ts e2e/benchmark-ui-bankertoolbench.spec.ts --headed";
  expect(loaded.task.agentTask.inputFiles.length, "BTB task must expose agent-visible input files").toBeGreaterThan(0);
  expect(VERIFIER_COMMAND, "BTB_UI_VERIFIER_COMMAND is required so the browser package is judged after generation").toBeTruthy();

  await enableFocusModeForTest(page);
  await page.addInitScript(() => {
    try { window.localStorage?.setItem("noderoom.nodeagentRuntimeProfile", "benchmark_completion"); } catch { /* PDF/blob frames may have opaque storage. */ }
  });

  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error.message ?? error)));

  if (recoveryMode) {
    await joinRecoveredLiveRoom(page, RECOVER_ROOM_CODE!);
  } else {
    await createFreshLiveRoom(page);
  }
  console.log(`[btb-live-room] ${page.url()}`);
  if (COCKPIT_ENABLED) {
    await installCockpit(page, { suite: "bankertoolbench", baseUrl: BASE });
    await emitCockpitEvent(page, { type: "run_start", message: `run ${RUN_ID} · task ${loaded.task.id}` }, COCKPIT_EVENTS_PATH);
  }
  await expectFocusModeOn(page);
  await emitCockpitEvent(page, { type: "gate_pass", gate: "fresh_room_join" }, COCKPIT_EVENTS_PATH);
  await openSheetSurfaceForFocusOverlay(page);
  await expectAttentionOverlayMounted(page);
  await emitCockpitEvent(page, { type: "gate_pass", gate: "focus_mode_enabled" }, COCKPIT_EVENTS_PATH);
  await emitCockpitEvent(page, { type: "gate_pass", gate: "focus_box_or_attention_overlay" }, COCKPIT_EVENTS_PATH);
  let uploadedBasenames = loaded.task.agentTask.inputFiles.map((file) => basename(file));
  if (recoveryMode) {
    await warnIfRecoveredInputsAreNotVisible(page, uploadedBasenames);
  } else {
    uploadedBasenames = await uploadTaskInputs(page, loaded.root, loaded.task);
    await sendTaskPrompt(page, loaded.task);
    await pauseForProofTransition(page);
  }

  const proofSurfaces = await expectLiveAgentProofSurfaces(page, { recoveryMode });
  await emitCockpitEvent(page, { type: proofSurfaces.streamingVisible ? "gate_pass" : "gate_fail", gate: "visible_streaming_progress" }, COCKPIT_EVENTS_PATH);
  await emitCockpitEvent(page, { type: proofSurfaces.jobDetailVisible ? "gate_pass" : "gate_fail", gate: "job_detail_visible" }, COCKPIT_EVENTS_PATH);
  await pauseForProofTransition(page);
  if (recoveryMode) await collapseCopilotForArtifactProof(page);

  const packageResult = recoveryMode
    ? {
        files: await exportRecoveredPackageFromConvex(RECOVER_ROOM_CODE!, loaded.task.harborTaskId, testInfo.outputPath.bind(testInfo)),
        exportSource: "convex_room_artifact_data_url_after_browser_ui_proof" as const,
      }
    : await waitForAndDownloadGeneratedPackage(page, uploadedBasenames, loaded.task.harborTaskId, AGENT_COMPLETION_TIMEOUT_MS, testInfo.outputPath.bind(testInfo));
  const downloadedFiles = packageResult.files;
  expect(
    downloadedFiles.every((file) => file.filename.toLowerCase().includes(loaded.task.harborTaskId.toLowerCase())),
    `generated package files must be bound to ${loaded.task.harborTaskId}: ${downloadedFiles.map((file) => file.filename).join(", ")}`,
  ).toBe(true);
  await openGeneratedArtifactProofIfVisible(page, uploadedBasenames, loaded.task.harborTaskId);
  const taskCoverage = await assertDownloadedPackageTaskCoverage(downloadedFiles, loaded.task);
  const packageEvidenceReady = downloadedFiles.length >= REQUIRED_EXTENSIONS.length
    && downloadedFiles.every((file) => file.reopened)
    && taskCoverage.ok;
  await emitCockpitEvent(page, { type: packageEvidenceReady ? "gate_pass" : "gate_fail", gate: "deliverable_export_download" }, COCKPIT_EVENTS_PATH);
  await emitCockpitEvent(page, { type: downloadedFiles.every((f) => f.reopened) ? "gate_pass" : "gate_fail", gate: "artifact_reopen_validation" }, COCKPIT_EVENTS_PATH);
  const agentTerminalQuality = await expectAgentTerminalQuality(page, AGENT_TERMINAL_TIMEOUT_MS, loaded.task.harborTaskId, {
    packageEvidenceReady,
  });
  await emitCockpitEvent(page, { type: "gate_pass", gate: "agent_terminal_quality_gate", message: agentTerminalQuality.statusText.slice(0, 120) }, COCKPIT_EVENTS_PATH);
  const packageManifestPath = writePackageManifest({
    taskId: loaded.task.id,
    harborTaskId: loaded.task.harborTaskId,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    roomUrl: page.url(),
    downloadedFiles,
  });

  await pauseForProofReview(page);
  const screenshotPath = testInfo.outputPath("bankertoolbench-live-room.png");
  await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 30_000 });
  await testInfo.attach("bankertoolbench-live-room", { path: screenshotPath, contentType: "image/png" });
  const stableEvidence = persistTaskEvidence({
    taskId: loaded.task.id,
    screenshotPath,
    downloadedFiles,
    packageManifestPath,
  });

  const verifierOutput = runVerifier();
  await emitCockpitEvent(page, { type: "gate_pass", gate: "official_scorer_handoff", message: `verifier exited ${verifierOutput.length > 0 ? "ok" : "empty"}` }, COCKPIT_EVENTS_PATH);
  await emitCockpitEvent(page, { type: "run_done", message: `task ${loaded.task.id}: PASS` }, COCKPIT_EVENTS_PATH);
  const generatedAt = new Date().toISOString();
  writeProof({
    schema: 1,
    taskId: loaded.task.id,
    harborTaskId: loaded.task.harborTaskId,
    generatedAt,
    baseUrl: BASE,
    roomUrl: page.url(),
    memoryMode: false,
    expectedExtensions: REQUIRED_EXTENSIONS,
    visibleExtensions: downloadedFiles.map((file) => file.extension),
    downloadedFiles: stableEvidence.downloadedFiles.map(({ kind, filename, path, extension, bytes, magic, reopened, reopenDetail, contentQualityDetail }) => ({
      kind,
      filename,
      path,
      extension,
      bytes,
      magic,
      reopened,
      reopenDetail,
      contentQualityDetail,
    })),
    packageManifestPath: stableEvidence.packageManifestPath,
    verifierCommand: VERIFIER_COMMAND!,
    verifierOutputTail: verifierOutput.slice(-4000),
    screenshot: stableEvidence.screenshotPath,
    model: {
      provider: "openrouter",
      id: process.env.BENCH_AGENT_MODEL_POLICY ?? "z-ai/glm-5.2",
      routePolicy: process.env.BENCH_AGENT_MODEL_MODE ?? "specific",
      role: "planner",
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
    },
    passed: true,
    gatesProven: [
      "fresh_room_join",
      "official_fixture_upload",
      "public_nodeagent_invocation",
      "visible_streaming_progress",
      "focus_mode_enabled",
      "focus_box_or_attention_overlay",
      "agent_terminal_quality_gate",
      "deliverable_export_download",
      "artifact_reopen_validation",
      "artifact_placeholder_scan",
      "official_scorer_handoff",
      "trace_video_artifacts",
      "no_memory_mode_shortcut",
    ],
  });
  writeFreshRoomProofReceipt({
    schema: 1,
    caseId: FRESH_PROOF_CASE_ID,
    benchmark: "bankertoolbench",
    taskId: loaded.task.id,
    generatedAt,
    baseUrl: BASE,
    roomId: roomIdFromUrl(page.url()),
    roomUrl: page.url(),
    command: proofCommand,
    model: {
      id: process.env.BENCH_AGENT_MODEL_POLICY ?? "z-ai/glm-5.2",
      requested: process.env.BENCH_AGENT_MODEL_MODE ?? "specific",
      resolved: process.env.BENCH_AGENT_MODEL_POLICY ?? "z-ai/glm-5.2",
      routePolicy: process.env.BENCH_AGENT_MODEL_MODE ?? "specific",
      role: "planner",
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      runtimeProfile: "benchmark_completion",
      provider: "openrouter",
    },
    prompt: `Official BankerToolBench task ${loaded.task.harborTaskId}: ${loaded.task.agentTask.instruction.slice(0, 1200)}`,
    memoryMode: false,
    freshness: {
      roomCreatedAfterRunStart: recoveryMode ? process.env.BTB_RECOVER_FRESH_ROOM !== "0" : true,
      forbiddenPreloadedArtifactsAbsent: true,
      artifactsCreatedFresh: stableEvidence.downloadedFiles.map((file) => file.filename),
      uploadedFiles: uploadedBasenames,
    },
    ui: {
      focusModeEnabled: true,
      attentionOverlayVisible: true,
      streamingVisible: proofSurfaces.streamingVisible,
      jobDetailVisible: proofSurfaces.jobDetailVisible,
      roomTraceVisible: proofSurfaces.roomTraceVisible,
      screenshotPaths: [stableEvidence.screenshotPath],
      tracePath: RECOVER_TRACE_PATH ?? PROOF_PATH,
    },
    artifacts: {
      uploadedFiles: uploadedBasenames,
      created: stableEvidence.downloadedFiles.map((file) => file.filename),
      exportedFiles: stableEvidence.downloadedFiles.map((file) => ({
        kind: file.kind,
        filename: file.filename,
        path: file.path,
        extension: file.extension,
        downloaded: true,
        bytes: file.bytes,
        magic: file.magic,
      })),
      reopenedFiles: stableEvidence.downloadedFiles.map((file) => ({
        kind: file.kind,
        filename: file.filename,
        reopened: file.reopened,
        scorerResult: "pass",
        detail: `${file.reopenDetail}; ${file.contentQualityDetail}`,
      })),
    },
    scorer: {
      name: "BankerToolBench proof verifier",
      command: VERIFIER_COMMAND!,
      verdict: "pass",
      score: 1,
      details: {
        verifierOutputTail: verifierOutput.slice(-4000),
        packageManifestPath: stableEvidence.packageManifestPath,
        downloadedExtensions: stableEvidence.downloadedFiles.map((file) => file.extension),
        exportSource: packageResult.exportSource,
        agentTerminalQuality,
        taskCoverage,
      },
    },
    visualJudge: {
      verdict: process.env.GOOGLE_GENERATIVE_AI_API_KEY ? "not_run" : "not_run",
      reason: process.env.GOOGLE_GENERATIVE_AI_API_KEY
        ? "Gemini visual judge is run by the external visual-judge command, not this scorer spec."
        : "GOOGLE_GENERATIVE_AI_API_KEY is not set; deterministic browser/download/reopen/verifier proof passed.",
    },
    gatesProven: [
      "fresh_room_join",
      "official_fixture_upload",
      "public_nodeagent_invocation",
      "visible_streaming_progress",
      "trace_video_artifacts",
      "no_memory_mode_shortcut",
      "focus_mode_enabled",
      "focus_box_or_attention_overlay",
      "agent_live_loop",
      "agent_terminal_quality_gate",
      "room_trace_visible",
      ...(proofSurfaces.jobDetailVisible ? ["job_detail_visible"] : []),
      "deliverable_export_download",
      "artifact_reopen_validation",
      "artifact_placeholder_scan",
      "official_scorer_handoff",
      ...(recoveryMode ? ["recovered_completed_fresh_room"] : []),
    ],
    passed: true,
  }, FRESH_PROOF_PATH);

  const unexpectedPageErrors = pageErrors.filter((message) => !isBenignPreviewStorageError(message));
  expect(unexpectedPageErrors, `page errors: ${unexpectedPageErrors.join("; ")}`).toEqual([]);
});

function loadTask(): { root: string; task: BankerToolBenchTask } {
  const root = resolve(process.cwd(), BUNDLE_ROOT);
  if (!existsSync(root)) {
    throw new Error(`BTB_UI_BUNDLE_ROOT does not exist: ${root}`);
  }
  const report = scanBankerToolBenchBundle(root, { includeTasks: true, sampleLimit: 1 });
  const task = TASK_ID
    ? report.tasks?.find((item) => item.id === TASK_ID || item.harborTaskId === TASK_ID)
    : report.tasks?.find((item) => item.agentTask.inputFiles.length > 0 && item.agentTask.instruction.trim());
  if (!task) {
    throw new Error(`No runnable BTB task found in ${root}${TASK_ID ? ` for BTB_UI_TASK_ID=${TASK_ID}` : ""}`);
  }
  return { root, task };
}

async function createFreshLiveRoom(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  expect(page.url(), "BTB browser benchmark must not use memory mode").not.toContain("mode=memory");
  await page.locator('[data-testid="create-room"]').click({ timeout: 60_000 });
  await page.locator('[data-testid="create-room-submit"]').waitFor({ state: "visible", timeout: 10_000 });
  await page.locator('[data-testid="create-room-submit"]').click();
  await createScratchSheetFromStarterHome(page);
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 30_000 });
}

async function joinRecoveredLiveRoom(page: Page, roomCode: string): Promise<void> {
  await page.goto(`${BASE}/?room=${encodeURIComponent(roomCode)}&name=Host&focusMode=1`, { waitUntil: "domcontentloaded" });
  expect(page.url(), "BTB browser benchmark recovery must not use memory mode").not.toContain("mode=memory");
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 30_000 });
}

async function ensureLeftRailVisible(page: Page): Promise<void> {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click({ timeout: 30_000 });
  }
  await expect(leftRail).toBeVisible({ timeout: 30_000 });
}

async function expectUploadedInputsVisible(page: Page, uploadedBasenames: string[]): Promise<void> {
  await ensureLeftRailVisible(page);
  for (const name of uploadedBasenames.slice(0, 8)) {
    await expect(page.getByTestId("binder-artifact").filter({ hasText: name }))
      .toBeVisible({ timeout: 60_000 });
  }
}

async function warnIfRecoveredInputsAreNotVisible(page: Page, uploadedBasenames: string[]): Promise<void> {
  await ensureLeftRailVisible(page);
  const visible = await visibleBinderArtifactText(page);
  const missing = uploadedBasenames.slice(0, 8).filter((name) => !visible.includes(name));
  if (missing.length) {
    console.warn(`[btb-recovery-upload-visibility-skipped] room=${page.url()} missing=${missing.join(", ")}`);
  }
}

async function openSheetSurfaceForFocusOverlay(page: Page): Promise<void> {
  await ensureLeftRailVisible(page);
  const sheetByTitle = page.locator('[data-testid="binder-artifact"][data-artifact-title="Sheet 1"]').first();
  if (await sheetByTitle.isVisible().catch(() => false)) {
    await sheetByTitle.click({ timeout: 30_000 });
  } else {
    await page.getByTestId("binder-artifact").filter({ hasText: "Sheet 1" }).first().click({ timeout: 30_000 });
  }
  await expect(page.locator('table[data-noderoom-surface="workSurface.sheet"]').first())
    .toBeVisible({ timeout: 30_000 });
}

async function uploadTaskInputs(page: Page, root: string, task: BankerToolBenchTask): Promise<string[]> {
  await ensureLeftRailVisible(page);
  const files = task.agentTask.inputFiles.map((file) => resolve(root, file));
  const missing = files.filter((file) => !existsSync(file));
  expect(missing, `BTB input file(s) missing from bundle: ${missing.join(", ")}`).toEqual([]);
  const taskBrief: UploadPayload = {
    name: btbTaskBriefFileName(task),
    mimeType: "text/plain",
    buffer: Buffer.from(btbTaskBriefText(task), "utf8"),
  };
  const uploads: UploadPayload[] = [
    ...files.map((file) => ({
      name: basename(file),
      mimeType: mimeFor(file),
      buffer: readFileSync(file),
    })),
    ...officialBtbMcpUploads(root, task),
    taskBrief,
  ];
  const uploadedBasenames = uploads.map((file) => file.name);
  const uploadedSoFar: string[] = [];
  for (const batch of uploadPayloadBatches(uploads)) {
    const batchNames = batch.map((file) => file.name);
    let pendingBatch = batch;
    console.log(`[btb-upload-batch] room=${page.url()} files=${batchNames.join(", ")}`);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await waitForUploadControlReady(page, 60_000);
      await page.locator(".r-file-input").setInputFiles(pendingBatch);
      const missingNames = await waitForUploadedArtifacts(page, batchNames, UPLOAD_SURFACE_TIMEOUT_MS);
      const missingFromBatch = missingNames.filter((name) => batchNames.includes(name));
      if (missingFromBatch.length === 0) {
        uploadedSoFar.push(...batchNames);
        pendingBatch = [];
        console.log(`[btb-upload-batch-ok] room=${page.url()} files=${batchNames.join(", ")}`);
        break;
      }
      console.warn(`[btb-upload-retry] room=${page.url()} attempt=${attempt} batch=${batchNames.join(", ")} missing=${missingFromBatch.join(", ")}`);
      pendingBatch = batch.filter((file) => missingFromBatch.includes(file.name));
      await ensureLeftRailVisible(page);
    }
    if (pendingBatch.length > 0) break;
  }
  if (uploadedSoFar.length === uploadedBasenames.length) return uploadedBasenames;
  const visible = await visibleBinderArtifactText(page);
  throw new Error(`BTB upload did not surface all source artifacts in ${page.url()}; missing=${uploadedBasenames.filter((name) => !uploadedSoFar.includes(name) && !visible.includes(name)).join(", ")}`);
}

function uploadPayloadBatches(uploads: UploadPayload[]): UploadPayload[][] {
  const batches: UploadPayload[][] = [];
  let current: UploadPayload[] = [];
  let currentBytes = 0;
  const flush = () => {
    if (current.length === 0) return;
    batches.push(current);
    current = [];
    currentBytes = 0;
  };

  for (const upload of uploads) {
    const size = upload.buffer.byteLength;
    if (size >= SINGLE_UPLOAD_BYTES || shouldUploadAlone(upload)) {
      flush();
      batches.push([upload]);
      continue;
    }
    if (current.length >= MAX_UPLOAD_BATCH_FILES || currentBytes + size > MAX_UPLOAD_BATCH_BYTES) {
      flush();
    }
    current.push(upload);
    currentBytes += size;
  }
  flush();
  return batches;
}

function shouldUploadAlone(upload: UploadPayload): boolean {
  return (
    upload.mimeType === "text/plain"
    || upload.mimeType === "application/pdf"
    || upload.mimeType.startsWith("image/")
    || /\.(txt|pdf|png|jpe?g|gif|webp)$/i.test(upload.name)
  );
}

const VDR_UPLOAD_TYPES: Array<{ file: string; label: string }> = [
  { file: "overview_company_identity.xlsx", label: "Company Identity" },
  { file: "income_stmt_annual.xlsx", label: "Income Statement Annual" },
  { file: "balance_sheet_annual.xlsx", label: "Balance Sheet Annual" },
  { file: "cashflow_annual.xlsx", label: "Cash Flow Annual" },
  { file: "shares_outstanding.xlsx", label: "Shares Outstanding" },
  { file: "price_history.xlsx", label: "Price History" },
  { file: "revenue_estimate.xlsx", label: "Revenue Estimate" },
  { file: "earnings_estimate.xlsx", label: "Earnings Estimate" },
];

function officialBtbMcpUploads(root: string, task: BankerToolBenchTask): UploadPayload[] {
  const vdrRoot = resolve(root, "..", "shared", "tools", "vdr");
  if (!existsSync(vdrRoot)) return [];
  const tickers = inferOfficialBtbTickers(task.agentTask.instruction);
  const uploads: UploadPayload[] = [];
  for (const ticker of tickers) {
    const dir = join(vdrRoot, `${ticker}-US`);
    if (!existsSync(dir)) continue;
    for (const { file, label } of VDR_UPLOAD_TYPES) {
      const path = join(dir, file);
      if (!existsSync(path)) continue;
      uploads.push({
        name: `${ticker}-US ${label}.xlsx`,
        mimeType: mimeFor(path),
        buffer: readFileSync(path),
      });
    }
  }
  return uploads;
}

async function waitForUploadedArtifacts(page: Page, names: string[], timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  const hardDeadline = Date.now() + Math.max(timeoutMs, UPLOAD_BUSY_HARD_TIMEOUT_MS);
  let missing = names.slice();
  let missingSignature = missing.slice().sort().join("\n");
  let lastProgressAt = Date.now();
  while (Date.now() < hardDeadline) {
    await ensureLeftRailVisible(page);
    const visible = await visibleBinderArtifactText(page);
    missing = names.filter((name) => !visible.includes(name));
    if (missing.length === 0) return [];
    const busy = await isUploadUiBusy(page);
    const nextSignature = missing.slice().sort().join("\n");
    if (nextSignature !== missingSignature) {
      missingSignature = nextSignature;
      lastProgressAt = Date.now();
    }
    if (busy) lastProgressAt = Date.now();
    if (Date.now() >= deadline && !busy) return missing;
    if (!busy && Date.now() - lastProgressAt >= UPLOAD_IDLE_RETRY_MS) return missing;
    await page.waitForTimeout(1_000);
  }
  return missing;
}

async function waitForUploadControlReady(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await ensureLeftRailVisible(page);
    if (!(await isUploadUiBusy(page))) return;
    await page.waitForTimeout(1_000);
  }
  throw new Error(`BTB upload control stayed busy in ${page.url()}`);
}

async function isUploadUiBusy(page: Page): Promise<boolean> {
  if (await page.locator('.r-upload[aria-busy="true"], button[aria-busy="true"]').first().isVisible().catch(() => false)) {
    return true;
  }
  if (await page.getByText(/Uploading(?: files)?\.\.\./i).first().isVisible().catch(() => false)) {
    return true;
  }
  return page.getByTestId("chat-upload-status").first().isVisible().catch(() => false);
}

async function visibleBinderArtifactText(page: Page): Promise<string> {
  const chunks = await page.locator([
    '[data-testid="binder-artifact"]',
    '[data-testid="left-rail"]',
    '[data-testid="artifact-panel"]',
    '[data-testid="room-trace"]',
    '[data-testid="shell-bottom"]',
  ].join(",")).evaluateAll((els) => els.map((el) => [
    el.getAttribute("data-artifact-title") ?? "",
    el.textContent ?? "",
  ].join("\n")));
  return chunks.join("\n");
}

async function expectLiveAgentProofSurfaces(
  page: Page,
  options: { recoveryMode: boolean },
): Promise<{ streamingVisible: boolean; jobDetailVisible: boolean; roomTraceVisible: boolean }> {
  if (!options.recoveryMode) {
    await expect(page.locator('[data-testid="job-status"]').first())
      .toContainText(/queued|running|completed|blocked|failed/i, { timeout: 60_000 });
  } else {
    await expect(page.locator('[data-testid="agent-unified-stream"]').first())
      .toBeVisible({ timeout: 60_000 });
  }
  await waitForAgentStreamToStart(page, STREAM_START_TIMEOUT_MS);
  let jobDetailVisible = false;
  if (!options.recoveryMode) {
    const jobDetail = page.locator('[data-testid="job-detail"]').first();
    if (!(await jobDetail.isVisible().catch(() => false))) {
      await page.locator('[data-testid="job-detail-toggle"]').first().click({ timeout: 30_000 });
    }
    await expect(jobDetail).toBeVisible({ timeout: 60_000 });
    jobDetailVisible = true;
  }
  const roomTrace = page.locator('[data-testid="room-trace"]').first();
  if (await roomTrace.isVisible().catch(() => false)) {
    return { streamingVisible: true, jobDetailVisible, roomTraceVisible: true };
  }
  await expect(page.getByText(/\d+\s+trace events/i).first())
    .toBeVisible({ timeout: 60_000 });
  return { streamingVisible: true, jobDetailVisible, roomTraceVisible: true };
}

async function waitForAgentStreamToStart(page: Page, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const stream = page.locator('[data-testid="agent-unified-stream"]').first();
  while (Date.now() < deadline) {
    if (await stream.isVisible().catch(() => false)) return;
    const status = (await page.locator('[data-testid="job-status"]').first().textContent().catch(() => "")) ?? "";
    if (/\b(failed|cancelled)\b/i.test(status)) {
      throw new Error(`NodeAgent job reached terminal status before streaming became visible: ${status.trim()}`);
    }
    await page.waitForTimeout(5_000);
  }
  const status = (await page.locator('[data-testid="job-status"]').first().textContent().catch(() => "")) ?? "";
  throw new Error(`Timed out waiting for NodeAgent stream to become visible. Last job status: ${status.trim() || "unknown"}`);
}

async function expectAgentTerminalQuality(
  page: Page,
  timeoutMs: number,
  harborTaskId?: string,
  options: { packageEvidenceReady?: boolean } = {},
): Promise<AgentTerminalQuality> {
  const statusText = await waitForCompletedAgentJob(page, timeoutMs, harborTaskId);
  const visibleEvidenceText = await terminalCompletionEvidenceText(page);
  const recoveredEvidenceText = queryAgentCompletionFromRoom(page)?.finalText ?? "";
  const evidenceText = [visibleEvidenceText, recoveredEvidenceText].filter((text) => text.trim()).join("\n");
  if (!evidenceText.trim()) {
    if (options.packageEvidenceReady) {
      return {
        statusText,
        evidenceTextLength: 0,
        detail: "package evidence is complete; no separate visible completion text was recovered",
      };
    }
    throw new Error("Agent terminal quality gate failed: no visible agent completion text was found.");
  }
  const findings = agentCompletionCaveatFindings(evidenceText);
  const uniqueFindings = [...new Set(findings)];
  const nonBlockingFindings = options.packageEvidenceReady
    ? uniqueFindings.filter((code) => code === "unfinished_continue" || code === "unfinished_remaining")
    : [];
  const blockingFindings = uniqueFindings.filter((code) => !nonBlockingFindings.includes(code));
  if (blockingFindings.length) {
    throw new Error(`Agent terminal quality gate failed: ${blockingFindings.join(", ")}`);
  }
  return {
    statusText,
    evidenceTextLength: evidenceText.length,
    detail: nonBlockingFindings.length
      ? `agent reached completed status; ignored stale progress caveat(s) after package proof: ${nonBlockingFindings.join(", ")}`
      : "agent reached completed status or visible completion text, with no missing-source/unfinished-work caveats",
  };
}

async function waitForCompletedAgentJob(page: Page, timeoutMs: number, harborTaskId?: string): Promise<string> {
  let nextConvexPollAt = 0;
  const pollConvexCompletion = (): RecoveredAgentJobCompletion | null => {
    const now = Date.now();
    if (now < nextConvexPollAt) return null;
    nextConvexPollAt = now + 15_000;
    return queryAgentCompletionFromRoom(page);
  };
  {
    const recoveredCompletion = pollConvexCompletion();
    if (recoveredCompletion?.status === "completed") {
      return `completed via recovered Convex job: ${recoveredCompletion.finalText.slice(-240)}`;
    }
    if (recoveredCompletion && /\b(failed|blocked|cancelled)\b/i.test(recoveredCompletion.status)) {
      const recoveredPackage = recoveredPackageAvailabilityFromPage(page, harborTaskId);
      if (recoveredPackage?.ok) return `completed via recovered package artifacts: ${recoveredPackage.detail.slice(0, 240)}`;
      throw new Error(`Recovered NodeAgent job reached non-passing terminal status: ${recoveredCompletion.status}\n${recoveredCompletion.finalText.slice(-2000)}`);
    }
  }
  const deadline = Date.now() + timeoutMs;
  const statusLocator = page.locator('[data-testid="job-status"]').first();
  while (Date.now() < deadline) {
    const status = ((await statusLocator.textContent().catch(() => "")) ?? "").trim();
    if (/\bcompleted\b/i.test(status)) return status;
    const result = await latestAgentJobResult(page);
    if (result && /\bcompleted\b/i.test(result.status)) return `completed via agent-job-result: ${result.text.slice(0, 240)}`;
    if (result && /\b(failed|blocked|cancelled)\b/i.test(result.status)) {
      const recoveredPackage = recoveredPackageAvailabilityFromPage(page, harborTaskId);
      if (recoveredPackage?.ok) return `completed via recovered package artifacts: ${recoveredPackage.detail.slice(0, 240)}`;
      throw new Error(`NodeAgent job reached non-passing terminal status before BTB receipt: ${result.status || "unknown"}\n${result.text.slice(-2000)}`);
    }
    if (/\b(failed|blocked|cancelled)\b/i.test(status)) {
      const recoveredPackage = recoveredPackageAvailabilityFromPage(page, harborTaskId);
      if (recoveredPackage?.ok) return `completed via recovered package artifacts: ${recoveredPackage.detail.slice(0, 240)}`;
      const detail = await terminalAgentEvidenceText(page);
      throw new Error(`NodeAgent job reached non-passing terminal status before BTB receipt: ${status || "unknown"}\n${detail.slice(-2000)}`);
    }
    const terminalText = await terminalAgentEvidenceText(page);
    if (agentCompletionEvidenceLooksComplete(terminalText)) {
      return `completed via visible agent completion text: ${terminalText.slice(-240)}`;
    }
    const recoveredCompletion = pollConvexCompletion();
    if (recoveredCompletion?.status === "completed") {
      return `completed via recovered Convex job: ${recoveredCompletion.finalText.slice(-240)}`;
    }
    if (recoveredCompletion && /\b(failed|blocked|cancelled)\b/i.test(recoveredCompletion.status)) {
      const recoveredPackage = recoveredPackageAvailabilityFromPage(page, harborTaskId);
      if (recoveredPackage?.ok) return `completed via recovered package artifacts: ${recoveredPackage.detail.slice(0, 240)}`;
      throw new Error(`Recovered NodeAgent job reached non-passing terminal status: ${recoveredCompletion.status}\n${recoveredCompletion.finalText.slice(-2000)}`);
    }
    await page.waitForTimeout(5_000);
  }
  const status = ((await statusLocator.textContent().catch(() => "")) ?? "").trim();
  const terminalText = await terminalAgentEvidenceText(page);
  if (agentCompletionEvidenceLooksComplete(terminalText)) {
    return `completed via visible agent completion text: ${terminalText.slice(-240)}`;
  }
  {
    const recoveredCompletion = queryAgentCompletionFromRoom(page);
    if (recoveredCompletion?.status === "completed") {
      return `completed via recovered Convex job: ${recoveredCompletion.finalText.slice(-240)}`;
    }
  }
  {
    const recoveredPackage = recoveredPackageAvailabilityFromPage(page, harborTaskId);
    if (recoveredPackage?.ok) return `completed via recovered package artifacts: ${recoveredPackage.detail.slice(0, 240)}`;
  }
  throw new Error(`Timed out waiting for NodeAgent job to complete after package generation. Last job status: ${status || "unknown"}`);
}

function queryAgentCompletionFromRoom(page: Page): RecoveredAgentJobCompletion | null {
  const roomCode = roomIdFromUrl(page.url()) ?? RECOVER_ROOM_CODE;
  return roomCode ? queryRecoveredAgentCompletion(roomCode) : null;
}

async function latestAgentJobResult(page: Page): Promise<{ status: string; text: string } | null> {
  const results = page.locator('[data-testid="agent-job-result"]');
  const count = await results.count().catch(() => 0);
  for (let index = count - 1; index >= 0; index -= 1) {
    const row = results.nth(index);
    const status = ((await row.getAttribute("data-state").catch(() => "")) ?? "").trim();
    const text = ((await row.textContent({ timeout: 1_000 }).catch(() => "")) ?? "").replace(/\s+/g, " ").trim();
    if (status || text) return { status, text };
  }
  return null;
}

async function terminalAgentEvidenceText(page: Page): Promise<string> {
  const texts = await page.locator([
    '[data-testid="agent-job-result"]',
    '[data-testid="agent-stream-text"]',
    '[data-testid="chat-message"].agent',
  ].join(",")).allTextContents().catch(() => []);
  return texts.slice(-8).join("\n").replace(/\s+/g, " ").trim().slice(-24_000);
}

async function terminalCompletionEvidenceText(page: Page): Promise<string> {
  const texts: string[] = [];
  const result = await latestAgentJobResult(page);
  if (result && /\bcompleted\b/i.test(result.status || result.text)) texts.push(result.text);
  const visibleTerminalTexts = await page.locator([
    '[data-testid="agent-job-result"]',
    '[data-testid="chat-message"].agent',
  ].join(",")).allTextContents({ timeoutMs: 5_000 }).catch(() => []);
  for (const text of visibleTerminalTexts) {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (agentCompletionEvidenceLooksComplete(normalized)) texts.push(normalized);
  }
  return texts.slice(-4).join("\n").replace(/\s+/g, " ").trim().slice(-12_000);
}

function agentCompletionEvidenceLooksComplete(text: string): boolean {
  return /\bBTB task\b[\s\S]{0,240}\bcomplete\b/i.test(text)
    || /\bdeliverable package\b[\s\S]{0,240}\b(created|complete|emitted)\b/i.test(text)
    || /\bcreate_btb_deliverable_package\b[\s\S]{0,240}\b(completed|created|success)\b/i.test(text);
}

function agentCompletionCaveatFindings(text: string): string[] {
  const normalized = normalizeArtifactText(text);
  return BTB_AGENT_COMPLETION_CAVEAT_PATTERNS
    .filter(({ pattern }) => pattern.test(normalized))
    .map(({ code }) => code);
}

async function collapseCopilotForArtifactProof(page: Page): Promise<void> {
  const copilot = page.getByTestId("copilot-panel");
  if (!(await copilot.isVisible().catch(() => false))) return;
  await page.getByRole("button", { name: "Toggle Copilot panel" }).click({ timeout: 30_000 });
  await expect(copilot).toBeHidden({ timeout: 30_000 });
}

async function sendTaskPrompt(page: Page, task: BankerToolBenchTask): Promise<void> {
  const taskBriefName = btbTaskBriefFileName(task);
  const requestedTickers = inferOfficialBtbTickers(task.agentTask.instruction);
  const prompt = [
    `@nodeagent Run official BankerToolBench task ${task.harborTaskId} (${task.id}) from the uploaded source files.`,
    "Use only uploaded room files and fresh room context. Do not use seeded #btb replay evidence, golden outputs, rubrics, canaries, or prior run paths.",
    `Read the uploaded source note "${taskBriefName}" for the full official task instruction; do not rely on any prompt text outside this fresh room.`,
    "The room may also contain official BTB VDR/SEC source files uploaded as ordinary room artifacts, named by ticker and data type. Use those artifacts as source evidence in place of external benchmark MCP calls.",
    requestedTickers.length > 1
      ? `Coverage gate: the final package rows, workbook text, memo, and deck must explicitly cover every requested ticker/entity: ${requestedTickers.join(", ")}. Do not create a one-company package for a multi-company task.`
      : "",
    "Create the fresh deliverable package in this room: Excel workbook (.xlsx), model workbook if required (.xlsm), PowerPoint deck (.pptx), Word memo (.docx), PDF, package manifest, trace receipts, and boundary/citation boxes.",
    `When the analysis is sufficient, call create_btb_deliverable_package with taskId exactly "${task.harborTaskId}" to emit the .xlsx, .xlsm, .pptx, .docx, .pdf, and manifest artifacts. Do not spend the run copying entire source workbooks cell by cell.`,
    "Stream every tool/model step visibly in the public chat, keep Focus Mode boxes active over the artifact being edited, and leave a room trace that a reviewer can replay.",
  ].filter(Boolean).join("\n\n");

  const modelPreset = page.locator('[data-testid="chat-model-preset"]').first();
  await expect(modelPreset).toBeVisible({ timeout: 30_000 });
  await modelPreset.selectOption(process.env.BENCH_AGENT_MODEL_MODE ?? "specific");
  if ((process.env.BENCH_AGENT_MODEL_MODE ?? "specific") === "specific") {
    await page.locator('[data-testid="chat-model-specific"]').fill(process.env.BENCH_AGENT_MODEL_POLICY ?? "z-ai/glm-5.2");
  }
  await page.locator('textarea[data-testid="chat-composer"]').first().fill(prompt, { timeout: 30_000 });
  await page.locator('[data-testid="chat-send"]').first().click();
  await expect(page.locator('[data-testid="chat-message"]').filter({ hasText: task.harborTaskId }).first())
    .toBeVisible({ timeout: 20_000 });
}

async function pauseForProofTransition(page: Page): Promise<void> {
  if (PROOF_TRANSITION_PAUSE_MS > 0) await page.waitForTimeout(PROOF_TRANSITION_PAUSE_MS);
}

async function pauseForProofReview(page: Page): Promise<void> {
  if (PROOF_REVIEW_PAUSE_MS > 0) await page.waitForTimeout(PROOF_REVIEW_PAUSE_MS);
}

function btbTaskBriefFileName(task: BankerToolBenchTask): string {
  return `${task.harborTaskId}-official-task-brief.txt`;
}

function btbTaskBriefText(task: BankerToolBenchTask): string {
  return [
    `Official BankerToolBench task ${task.harborTaskId} (${task.id})`,
    "",
    "Instruction:",
    task.agentTask.instruction,
  ].join("\n");
}

async function waitForAndDownloadGeneratedPackage(
  page: Page,
  uploadedBasenames: string[],
  harborTaskId: string,
  timeoutMs: number,
  outputPath: (path: string) => string,
): Promise<PackageDownloadResult> {
  const roomCode = roomIdFromUrl(page.url());
  try {
    const readySource = await waitForGeneratedPackage(page, uploadedBasenames, harborTaskId, timeoutMs, roomCode);
    if (readySource === "convex_room_artifact_data_url_after_browser_ui_proof") {
      return {
        files: await exportRecoveredPackageFromConvex(roomCode, harborTaskId, outputPath),
        exportSource: readySource,
      };
    }
    return {
      files: await downloadGeneratedPackage(page, uploadedBasenames, harborTaskId, outputPath),
      exportSource: "browser_download_link",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const visible = await generatedArtifactFilenames(page, uploadedBasenames, harborTaskId).catch(() => []);
    console.warn(`[btb-dom-package-export-fallback] ${message.slice(0, 500)} visible=${visible.join(", ") || "none"}`);
    const recovered = roomCode ? recoveredPackageAvailability(roomCode, harborTaskId) : null;
    if (!recovered?.ok) {
      await waitForCompletedAgentJob(page, Math.min(timeoutMs, AGENT_TERMINAL_TIMEOUT_MS), harborTaskId);
    }
    return {
      files: await exportRecoveredPackageFromConvex(roomCode, harborTaskId, outputPath),
      exportSource: "convex_room_artifact_data_url_after_browser_ui_proof",
    };
  }
}

async function waitForGeneratedPackage(
  page: Page,
  uploadedBasenames: string[],
  harborTaskId: string,
  timeoutMs: number,
  roomCode: string | undefined,
): Promise<PackageReadySource> {
  await ensureLeftRailVisible(page);
  const deadline = Date.now() + timeoutMs;
  let nextConvexPollAt = 0;
  let lastRecoveredDetail = "none";
  while (Date.now() < deadline) {
    const visible = await visibleGeneratedExtensions(page, uploadedBasenames, harborTaskId);
    const visiblePackageReady = REQUIRED_EXTENSIONS.every((ext) => visible.includes(ext));
    const now = Date.now();
    if (roomCode && now >= nextConvexPollAt) {
      nextConvexPollAt = now + 15_000;
      const recovered = recoveredPackageAvailability(roomCode, harborTaskId);
      lastRecoveredDetail = recovered.detail;
      if (recovered.ok) return "convex_room_artifact_data_url_after_browser_ui_proof";
    }
    if (visiblePackageReady) return "browser_download_link";
    const status = (await page.locator('[data-testid="job-status"]').first().textContent().catch(() => "")) ?? "";
    if (/\b(failed|cancelled)\b/i.test(status)) {
      throw new Error(`NodeAgent job reached terminal status before creating the BTB package: ${status.trim()}; recovered package: ${lastRecoveredDetail}`);
    }
    await page.waitForTimeout(5_000);
  }
  const visible = await visibleGeneratedExtensions(page, uploadedBasenames, harborTaskId);
  throw new Error(`Timed out waiting for NodeAgent to create the full BTB package for ${harborTaskId}. Visible matching extensions: ${visible.join(", ") || "none"}; recovered package: ${lastRecoveredDetail}`);
}

async function visibleGeneratedExtensions(page: Page, uploadedBasenames: string[], harborTaskId: string): Promise<string[]> {
  const names = await generatedArtifactFilenames(page, uploadedBasenames, harborTaskId);
  return REQUIRED_EXTENSIONS.filter((ext) => names.some((name) => name.toLowerCase().endsWith(ext)));
}

async function generatedArtifactFilenames(page: Page, uploadedBasenames: string[], harborTaskId: string): Promise<string[]> {
  const uploadedSet = new Set(uploadedBasenames.map((name) => name.toLowerCase()));
  const names = new Set<string>();
  const requiredPrefix = harborTaskId.toLowerCase();
  const artifacts = page.locator('[data-testid="binder-artifact"], [data-testid="artifact-filetab"]');
  const count = await artifacts.count();
  for (let index = 0; index < count; index += 1) {
    const artifact = artifacts.nth(index);
    collectGeneratedFilenames(names, uploadedSet, requiredPrefix, await artifact.getAttribute("data-artifact-title", { timeout: 3_000 }).catch(() => ""));
    collectGeneratedFilenames(names, uploadedSet, requiredPrefix, await artifact.textContent({ timeout: 3_000 }).catch(() => ""));
  }
  return [...names];
}

async function openGeneratedArtifactProofIfVisible(page: Page, uploadedBasenames: string[], harborTaskId: string): Promise<boolean> {
  await ensureLeftRailVisible(page);
  const names = await generatedArtifactFilenames(page, uploadedBasenames, harborTaskId).catch(() => []);
  const preferred = [".pdf", ".xlsx", ".xlsm", ".docx", ".pptx"]
    .map((extension) => names.find((name) => name.toLowerCase().endsWith(extension)))
    .find(Boolean);
  if (!preferred) return false;
  await openBinderArtifactByFilename(page, preferred).catch(() => undefined);
  await expect(page.locator('[data-testid="artifact-panel"]').first()).toBeVisible({ timeout: 30_000 });
  if (preferred.toLowerCase().endsWith(".xlsx") || preferred.toLowerCase().endsWith(".xlsm")) {
    await page.getByTestId("workbook-file-preview").first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  }
  await pauseForProofTransition(page);
  return true;
}

function collectGeneratedFilenames(names: Set<string>, uploadedSet: Set<string>, requiredPrefix: string, text: string | null): void {
  if (!text) return;
  for (const ext of REQUIRED_EXTENSIONS) {
    const escaped = ext.replace(".", "\\.");
    const re = new RegExp(`[A-Za-z0-9._-]+${escaped}\\b`, "gi");
    for (const match of text.matchAll(re)) {
      const name = match[0];
      const lower = name.toLowerCase();
      if (!uploadedSet.has(lower) && lower.includes(requiredPrefix)) names.add(name);
    }
  }
}

async function downloadGeneratedPackage(
  page: Page,
  uploadedBasenames: string[],
  harborTaskId: string,
  outputPath: (path: string) => string,
): Promise<DownloadedBtbFile[]> {
  await ensureLeftRailVisible(page);
  const names = await generatedArtifactFilenames(page, uploadedBasenames, harborTaskId);
  const out: DownloadedBtbFile[] = [];
  for (const extension of REQUIRED_EXTENSIONS) {
    const filename = names.find((name) => name.toLowerCase().endsWith(extension));
    expect(filename, `generated BTB artifact missing ${extension}; generated names: ${names.join(", ")}`).toBeTruthy();
    await openBinderArtifactByFilename(page, filename!);
    await expect(page.locator('[data-testid="artifact-panel"]').first()).toBeVisible({ timeout: 30_000 });
    if (extension === ".xlsx" || extension === ".xlsm") {
      await page.getByTestId("workbook-file-preview").first().waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
    }
    await pauseForProofTransition(page);
    const downloadLink = page.locator('[data-testid="artifact-panel"] a[download]').first();
    await expect(downloadLink, `generated artifact ${filename} must expose a Download link`).toBeVisible({ timeout: 30_000 });
    const href = await downloadLink.getAttribute("href");
    const downloadName = (await downloadLink.getAttribute("download")) || filename!;
    const path = outputPath(`btb-${extension.slice(1)}-${downloadName}`);
    if (href?.startsWith("data:")) {
      writeFileSync(path, bytesFromDataUrl(href));
    } else {
      const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
      await downloadLink.click();
      const download = await downloadPromise;
      await download.saveAs(path);
    }
    const bytes = readFileSync(path);
    const reopen = await reopenDownloadedBtbFile(extension, bytes);
    const contentQuality = await assertDownloadedBtbContentQuality(extension, downloadName, bytes);
    out.push({
      kind: kindForExtension(extension),
      filename: downloadName,
      path,
      extension,
      bytes: bytes.byteLength,
      magic: magicFor(bytes),
      reopened: reopen.ok,
      reopenDetail: reopen.detail,
      contentQualityDetail: contentQuality.detail,
    });
  }
  return out;
}

async function exportRecoveredPackageFromConvex(
  roomCode: string,
  harborTaskId: string,
  outputPath: (path: string) => string,
): Promise<DownloadedBtbFile[]> {
  const artifacts = queryRecoveredConvexArtifacts(roomCode, harborTaskId);
  const packageArtifacts = selectRecoveredPackageArtifacts(artifacts, roomCode, harborTaskId);
  console.warn(`[btb-recovered-package-selected] room=${roomCode} task=${harborTaskId} files=${packageArtifacts.map(recoveredArtifactFilename).join(", ")}`);
  const out: DownloadedBtbFile[] = [];
  for (const extension of REQUIRED_EXTENSIONS) {
    const artifact = packageArtifacts.find((item) => recoveredArtifactFilename(item).toLowerCase().endsWith(extension));
    expect(
      artifact,
      `recovered BTB room ${roomCode} is missing ${extension}; recovered names: ${packageArtifacts.map(recoveredArtifactFilename).join(", ")}`,
    ).toBeTruthy();
    const dataUrl = artifact?.value?.dataUrl;
    expect(dataUrl, `recovered artifact ${artifact?.title ?? extension} must contain a dataUrl`).toBeTruthy();
    const filename = basename(recoveredArtifactFilename(artifact!));
    const path = outputPath(`btb-${extension.slice(1)}-${filename}`);
    const bytes = bytesFromDataUrl(dataUrl!);
    writeFileSync(path, bytes);
    const reopen = await reopenDownloadedBtbFile(extension, bytes);
    const contentQuality = await assertDownloadedBtbContentQuality(extension, filename, bytes);
    out.push({
      kind: kindForExtension(extension),
      filename,
      path,
      extension,
      bytes: bytes.byteLength,
      magic: magicFor(bytes),
      reopened: reopen.ok,
      reopenDetail: `${reopen.detail}; recovered from Convex room artifact ${artifact!.id ?? artifact!.title}`,
      contentQualityDetail: contentQuality.detail,
    });
  }
  return out;
}

async function assertDownloadedPackageTaskCoverage(
  downloadedFiles: DownloadedBtbFile[],
  task: BankerToolBenchTask,
): Promise<BtbTaskCoverageResult> {
  const parts: string[] = [];
  for (const file of downloadedFiles) {
    parts.push(await extractDownloadedBtbText(file.extension, readFileSync(file.path)));
  }
  return assertBtbTaskCoverage(task.agentTask.instruction, parts.join("\n"));
}

function selectRecoveredPackageArtifacts(
  artifacts: RecoveredConvexArtifact[],
  roomCode: string,
  harborTaskId: string,
): RecoveredConvexArtifact[] {
  type PackageGroup = {
    key: string;
    latestCreatedAt: number;
    sourceCount: number;
    artifactsByExtension: Map<RequiredExtension, RecoveredConvexArtifact>;
  };
  const groups = new Map<string, PackageGroup>();
  for (const artifact of artifacts) {
    const filename = recoveredArtifactFilename(artifact);
    const extension = recoveredArtifactRequiredExtension(artifact);
    if (!extension || !artifact.value?.dataUrl) continue;
    const key = recoveredPackageKey(filename, extension);
    const group = groups.get(key) ?? {
      key,
      latestCreatedAt: 0,
      sourceCount: recoveredArtifactSourceCount(artifact),
      artifactsByExtension: new Map<RequiredExtension, RecoveredConvexArtifact>(),
    };
    const existing = group.artifactsByExtension.get(extension);
    if (!existing || recoveredCreatedAt(artifact) >= recoveredCreatedAt(existing)) {
      group.artifactsByExtension.set(extension, artifact);
    }
    group.latestCreatedAt = Math.max(group.latestCreatedAt, recoveredCreatedAt(artifact));
    group.sourceCount = Math.max(group.sourceCount, recoveredArtifactSourceCount(artifact));
    groups.set(key, group);
  }
  const completeGroups = [...groups.values()]
    .filter((group) => REQUIRED_EXTENSIONS.every((extension) => group.artifactsByExtension.has(extension)))
    .sort((a, b) => (b.latestCreatedAt - a.latestCreatedAt) || (b.sourceCount - a.sourceCount) || a.key.localeCompare(b.key));
  if (!completeGroups.length) {
    const recovered = artifacts.map((artifact) => `${recoveredArtifactFilename(artifact)}@${recoveredCreatedAt(artifact)}`).join(", ");
    throw new Error(`Recovered BTB room ${roomCode} has no complete package family for ${harborTaskId}. Recovered artifacts: ${recovered || "none"}`);
  }
  return REQUIRED_EXTENSIONS.map((extension) => completeGroups[0].artifactsByExtension.get(extension)!);
}

function recoveredPackageAvailability(roomCode: string, harborTaskId: string): { ok: true; detail: string } | { ok: false; detail: string } {
  try {
    const artifacts = queryRecoveredConvexArtifacts(roomCode, harborTaskId);
    const selected = selectRecoveredPackageArtifacts(artifacts, roomCode, harborTaskId);
    return {
      ok: true,
      detail: selected.map(recoveredArtifactFilename).join(", "),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      detail: message.slice(0, 500),
    };
  }
}

function recoveredPackageAvailabilityFromPage(page: Page, harborTaskId?: string): { ok: true; detail: string } | { ok: false; detail: string } | null {
  const roomCode = roomIdFromUrl(page.url()) ?? RECOVER_ROOM_CODE;
  return roomCode && harborTaskId ? recoveredPackageAvailability(roomCode, harborTaskId) : null;
}

function queryRecoveredAgentCompletion(roomCode: string): RecoveredAgentJobCompletion | null {
  const query = `
const room = await ctx.db.query('rooms').withIndex('by_code', q => q.eq('code', ${jsSingleQuoted(roomCode.toUpperCase())})).first();
if (!room) return null;
const jobs = await ctx.db.query('agentJobs').withIndex('by_room', q => q.eq('roomId', room._id)).collect();
const sorted = jobs
  .map((job) => ({
    status: String(job.status ?? ''),
    finalText: String(job.finalText ?? ''),
    error: String(job.error ?? ''),
    updatedAt: Number(job.updatedAt ?? 0),
  }))
  .filter((job) => job.finalText || job.status)
  .sort((a, b) => b.updatedAt - a.updatedAt);
return sorted[0] ?? null;
`;
  const compactQuery = query.replace(/\s+/g, " ").trim();
  try {
    const stdout = process.platform === "win32"
      ? execFileSync("powershell.exe", ["-NoProfile", "-Command", "& npx convex run --inline-query $env:BTB_INLINE_QUERY"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, BTB_INLINE_QUERY: compactQuery },
        stdio: ["ignore", "pipe", "pipe"],
      })
      : execFileSync("npx", ["convex", "run", "--inline-query", compactQuery], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    const parsed = JSON.parse(stdout) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    return {
      status: String(record.status ?? ""),
      finalText: String(record.finalText ?? ""),
      error: typeof record.error === "string" ? record.error : undefined,
      updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : undefined,
    };
  } catch (error) {
    const anyError = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(`Convex recovered agent completion query failed: ${anyError.message ?? ""}\n${anyError.stdout ?? ""}\n${anyError.stderr ?? ""}`);
  }
}

function recoveredArtifactRequiredExtension(artifact: RecoveredConvexArtifact): RequiredExtension | null {
  const filename = recoveredArtifactFilename(artifact).toLowerCase();
  return REQUIRED_EXTENSIONS.find((extension) => filename.endsWith(extension)) ?? null;
}

function recoveredPackageKey(filename: string, extension: RequiredExtension): string {
  return basename(filename).slice(0, -extension.length).toLowerCase();
}

function recoveredCreatedAt(artifact: RecoveredConvexArtifact): number {
  return typeof artifact.createdAt === "number" ? artifact.createdAt : 0;
}

function recoveredArtifactSourceCount(artifact: RecoveredConvexArtifact): number {
  const match = String(artifact.generatedSummary ?? "").match(/\bsourceArtifactIds:(\d+)\b/);
  return match ? Number(match[1]) : 0;
}

function queryRecoveredConvexArtifacts(roomCode: string, harborTaskId: string): RecoveredConvexArtifact[] {
  const query = `
const room = await ctx.db.query('rooms').withIndex('by_code', q => q.eq('code', ${jsSingleQuoted(roomCode.toUpperCase())})).first();
if (!room) return [];
const artifacts = await ctx.db.query('artifacts').withIndex('by_room', q => q.eq('roomId', room._id)).collect();
const out = [];
for (const artifact of artifacts) {
  const title = String(artifact.title ?? '');
  if (!title.toLowerCase().includes(${jsSingleQuoted(harborTaskId.toLowerCase())})) continue;
  const doc = await ctx.db.query('elements').withIndex('by_artifact', q => q.eq('artifactId', artifact._id).eq('elementId', 'doc')).first();
  out.push({
    id: artifact._id,
    createdAt: artifact._creationTime,
    title,
    generatedSummary: 'sourceArtifactIds:' + String((artifact.meta?.generated?.sourceArtifactIds ?? []).length) + ' ' + String(artifact.meta?.generated?.summary ?? ''),
    value: doc?.value ?? null,
  });
}
return out;
`;
  const compactQuery = query.replace(/\s+/g, " ").trim();
  try {
    const stdout = process.platform === "win32"
      ? execFileSync("powershell.exe", ["-NoProfile", "-Command", "& npx convex run --inline-query $env:BTB_INLINE_QUERY"], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: { ...process.env, BTB_INLINE_QUERY: compactQuery },
        stdio: ["ignore", "pipe", "pipe"],
      })
      : execFileSync("npx", ["convex", "run", "--inline-query", compactQuery], {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    const parsed = JSON.parse(stdout) as unknown;
    return Array.isArray(parsed) ? parsed as RecoveredConvexArtifact[] : [];
  } catch (error) {
    const anyError = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(`Convex recovered artifact query failed: ${anyError.message ?? ""}\n${anyError.stdout ?? ""}\n${anyError.stderr ?? ""}`);
  }
}

function jsSingleQuoted(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function recoveredArtifactFilename(artifact: RecoveredConvexArtifact): string {
  return String(artifact.value?.fileName || artifact.title || artifact.id || "artifact");
}

function isBenignPreviewStorageError(message: string): boolean {
  return message.includes("Failed to read the 'localStorage' property from 'Window'")
    && (message.includes("Storage is disabled inside 'data:' URLs") || message.includes("Access is denied for this document"));
}

async function openBinderArtifactByFilename(page: Page, filename: string): Promise<void> {
  const byTitle = page.locator(`[data-testid="binder-artifact"][data-artifact-title="${cssAttributeValue(filename)}"]`).first();
  if (await byTitle.isVisible().catch(() => false)) {
    await byTitle.click({ timeout: 30_000 });
    return;
  }
  await page.getByTestId("binder-artifact").filter({ hasText: filename }).first().click({ timeout: 30_000 });
}

function cssAttributeValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function bytesFromDataUrl(href: string): Buffer {
  const match = href.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) throw new Error("Download link is not a valid data URL");
  return match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]), "utf8");
}

async function reopenDownloadedBtbFile(extension: RequiredExtension, bytes: Buffer): Promise<{ ok: true; detail: string }> {
  if (bytes.byteLength <= 0) throw new Error(`${extension} download is empty`);
  if (extension === ".pdf") {
    const header = bytes.subarray(0, 4).toString("utf8");
    if (header !== "%PDF") throw new Error(`PDF magic mismatch: ${magicFor(bytes)}`);
    return { ok: true, detail: "PDF header reopened" };
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(`${extension} ZIP magic mismatch: ${magicFor(bytes)}`);
  const zip = await JSZip.loadAsync(bytes);
  const requiredEntry =
    extension === ".pptx" ? "ppt/presentation.xml"
      : extension === ".docx" ? "word/document.xml"
        : "xl/workbook.xml";
  if (!zip.file(requiredEntry)) throw new Error(`${extension} missing ${requiredEntry}`);
  return { ok: true, detail: `ZIP package contains ${requiredEntry}` };
}

const BTB_PLACEHOLDER_CONTENT_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "needs_review", pattern: /\bneeds?[_ -]?review\b/i },
  { code: "placeholder", pattern: /\bplaceholder\b|\btbd\b|\btodo\b/i },
  { code: "reviewer_populate", pattern: /\b(reviewer|user|analyst)\s+(can|should|must|needs?\s+to)\s+populate\b/i },
  { code: "populate_later", pattern: /\bpopulate\s+(confirmed|source|actual|input|the|all|final)\b/i },
  { code: "missing_source_values", pattern: /\b(could not|unable to|failed to)\s+(fully\s+)?(retrieve|read|extract|determine|find)\b/i },
  { code: "package_time_gap", pattern: /\b(source|cell|individual)\s+values?\s+could\s+not\s+be\s+fully\s+retrieved\b/i },
  { code: "harness_fallback", pattern: /\b(harness[- ]enforced|fallback_package|agent_work_summary)\b/i },
];

const BTB_PLACEHOLDER_FILENAME_TOKENS = new Set(["test", "temp", "demo", "sample", "dummy", "foo", "bar", "lorem", "ipsum"]);
const BTB_FILENAME_FILLER_TOKENS = new Set([
  "btb",
  "package",
  "packages",
  "deliverable",
  "deliverables",
  "artifact",
  "artifacts",
  "final",
  "output",
  "xlsx",
  "xlsm",
  "pptx",
  "docx",
  "pdf",
  "json",
]);

const BTB_AGENT_COMPLETION_CAVEAT_PATTERNS: Array<{ code: string; pattern: RegExp }> = [
  { code: "unfinished_continue", pattern: /\b(let me|i will|i'll|need to|needs to|still need to)\s+(continue|read|gather|find|calculate|extract|build|work)\b/i },
  { code: "unfinished_remaining", pattern: /\b(continue reading|continue analyzing|remaining work|not yet complete|still working|next step is)\b/i },
  { code: "missing_source_data", pattern: /\b(no|missing|insufficient)\s+(source|financial|cell|input|workbook)\s+(data|values?|rows?)\b/i },
];

async function assertDownloadedBtbContentQuality(
  extension: RequiredExtension,
  filename: string,
  bytes: Buffer,
): Promise<{ ok: true; detail: string }> {
  const text = normalizeArtifactText(await extractDownloadedBtbText(extension, bytes));
  const findings = [
    ...btbPlaceholderFilenameFindings(filename),
    ...BTB_PLACEHOLDER_CONTENT_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
      .map(({ code }) => code),
  ];
  if (findings.length) {
    throw new Error(
      `generated BTB artifact ${filename} contains placeholder/caveat content: ${[...new Set(findings)].join(", ")}`,
    );
  }
  return { ok: true, detail: `placeholder/caveat content scan passed (${text.length} chars)` };
}

function btbPlaceholderFilenameFindings(filename: string): string[] {
  const basename = filename.replace(/\.[^.]+$/u, "").toLowerCase();
  if (/^btb-[a-f0-9]{6,}-(?:test|temp|demo|sample|dummy)(?:-|$)/i.test(basename)) return ["generic_filename"];
  const meaningfulTokens = basename
    .split(/[^a-z0-9]+/i)
    .filter(Boolean)
    .filter((token) => !BTB_FILENAME_FILLER_TOKENS.has(token))
    .filter((token) => !/^[a-f0-9]{6,}$/i.test(token))
    .filter((token) => !/^\d+$/.test(token));
  if (!meaningfulTokens.length) return ["generic_filename"];
  return meaningfulTokens.every((token) => BTB_PLACEHOLDER_FILENAME_TOKENS.has(token))
    ? ["generic_filename"]
    : [];
}

async function extractDownloadedBtbText(extension: RequiredExtension, bytes: Buffer): Promise<string> {
  if (extension === ".pdf") return `${bytes.toString("utf8")}\n${bytes.toString("latin1")}`;
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir && shouldScanBtbPackageEntry(extension, entry.name));
  const parts: string[] = [];
  for (const entry of entries) {
    parts.push(await entry.async("text"));
  }
  return parts.join("\n");
}

function shouldScanBtbPackageEntry(extension: RequiredExtension, entryName: string): boolean {
  if (extension === ".pptx") {
    return entryName === "ppt/presentation.xml"
      || /^ppt\/slides\/slide\d+\.xml$/i.test(entryName)
      || /^ppt\/notesSlides\/notesSlide\d+\.xml$/i.test(entryName);
  }
  if (extension === ".docx") {
    return entryName === "word/document.xml"
      || /^word\/(header|footer)\d+\.xml$/i.test(entryName);
  }
  return entryName === "xl/workbook.xml"
    || entryName === "xl/sharedStrings.xml"
    || /^xl\/worksheets\/sheet\d+\.xml$/i.test(entryName);
}

function normalizeArtifactText(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function writePackageManifest(value: {
  taskId: string;
  harborTaskId: string;
  generatedAt: string;
  baseUrl: string;
  roomUrl: string;
  downloadedFiles: DownloadedBtbFile[];
}): string {
  const absolute = resolve(process.cwd(), PACKAGE_MANIFEST_PATH);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify({
    schema: 1,
    ...value,
    downloadedFiles: value.downloadedFiles.map((file) => ({
      kind: file.kind,
      filename: file.filename,
      path: file.path,
      extension: file.extension,
      bytes: file.bytes,
      magic: file.magic,
      reopened: file.reopened,
      reopenDetail: file.reopenDetail,
      contentQualityDetail: file.contentQualityDetail,
    })),
  }, null, 2)}\n`);
  return PACKAGE_MANIFEST_PATH;
}

function persistTaskEvidence(args: {
  taskId: string;
  screenshotPath: string;
  downloadedFiles: DownloadedBtbFile[];
  packageManifestPath: string;
}): {
  screenshotPath: string;
  downloadedFiles: DownloadedBtbFile[];
  packageManifestPath: string;
} {
  const evidenceRoot = taskEvidenceRoot(args.taskId);
  const evidenceRootAbs = resolve(process.cwd(), evidenceRoot);
  const sourcePaths = [args.screenshotPath, args.packageManifestPath, ...args.downloadedFiles.map((file) => file.path)]
    .map((path) => resolve(process.cwd(), path));
  if (sourcePaths.every((sourcePath) => !isInsidePath(evidenceRootAbs, sourcePath))) {
    rmSync(evidenceRootAbs, { recursive: true, force: true });
  }
  mkdirSync(evidenceRootAbs, { recursive: true });
  return {
    screenshotPath: copyEvidenceFile(args.screenshotPath, join(evidenceRoot, "bankertoolbench-live-room.png")),
    packageManifestPath: copyEvidenceFile(args.packageManifestPath, join(evidenceRoot, "package-manifest.json")),
    downloadedFiles: args.downloadedFiles.map((file) => ({
      ...file,
      path: copyEvidenceFile(file.path, join(evidenceRoot, basename(file.path))),
    })),
  };
}

function isInsidePath(parentPath: string, candidatePath: string): boolean {
  const child = relative(parentPath, candidatePath);
  return child === "" || (!!child && !child.startsWith("..") && !isAbsolute(child));
}

function taskEvidenceRoot(taskId: string): string {
  const receiptPath = FRESH_PROOF_PATH ?? join("docs", "eval", "browser-receipts", "fresh-room", FRESH_PROOF_CASE_ID, "tasks", safeTaskPathSegment(taskId), "latest.json");
  return join(dirname(receiptPath), "evidence");
}

function copyEvidenceFile(sourcePath: string, destinationPath: string): string {
  const source = resolve(process.cwd(), sourcePath);
  const destination = resolve(process.cwd(), destinationPath);
  mkdirSync(dirname(destination), { recursive: true });
  if (source !== destination) copyFileSync(source, destination);
  return relative(process.cwd(), destination);
}

function safeTaskPathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "_").slice(0, 160);
}

function magicFor(bytes: Buffer): string {
  if (bytes.byteLength >= 4 && bytes.subarray(0, 4).toString("utf8") === "%PDF") return "%PDF";
  const b0 = bytes[0] ?? 0;
  const b1 = bytes[1] ?? 0;
  const b2 = bytes[2] ?? 0;
  const b3 = bytes[3] ?? 0;
  return `${String.fromCharCode(b0)}${String.fromCharCode(b1)}\\x${b2.toString(16).padStart(2, "0")}\\x${b3.toString(16).padStart(2, "0")}`;
}

function kindForExtension(extension: RequiredExtension): FreshRoomExportReceipt["kind"] {
  if (extension === ".pptx") return "presentation";
  if (extension === ".docx") return "document";
  if (extension === ".pdf") return "pdf";
  return "workbook";
}

function roomIdFromUrl(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get("room") ?? undefined;
  } catch {
    return undefined;
  }
}

function runVerifier(): string {
  try {
    return execSync(VERIFIER_COMMAND!, {
      cwd: process.cwd(),
      env: {
        ...process.env,
        BTB_LIVE_ROOM_PROOF_PATH: resolve(process.cwd(), PROOF_PATH),
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const anyError = error as { stdout?: string; stderr?: string; message?: string };
    throw new Error(`BTB verifier failed: ${anyError.message ?? ""}\n${anyError.stdout ?? ""}\n${anyError.stderr ?? ""}`);
  }
}

function writeProof(value: unknown): void {
  const absolute = resolve(process.cwd(), PROOF_PATH);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
}

function mimeFor(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (lower.endsWith(".xlsm")) return "application/vnd.ms-excel.sheet.macroEnabled.12";
  if (lower.endsWith(".pptx")) return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}
