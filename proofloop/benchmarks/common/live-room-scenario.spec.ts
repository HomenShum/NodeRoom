import { expect, test, type Locator, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { enableFocusModeForTest, expectAttentionOverlayMounted, expectFocusModeOn } from "../../../e2e/focusMode";
import { providerForAgentModelPolicy, withNodeAgentMention } from "../../../src/eval/proofloopLiveBrowserPrompt";
import { noderoomSelectors } from "../../adapters/noderoom/selectors";
import {
  externalBenchmarkLocalTaskIds,
  loadExternalBenchmarkLocalTasks,
  type ExternalBenchmarkAdapterId,
  type ExternalBenchmarkLocalTask,
} from "./local-tasks";

type BrowserProblem = {
  type: string;
  text?: string;
  url?: string;
  status?: number;
};

type LiveRoomTaskProof = {
  taskId: string;
  title: string;
  prompt: string;
  uploadedFiles: string[];
  userMessageVisible: boolean;
  streamingVisible: boolean;
  jobStatusVisible: boolean;
  jobDetailVisible: boolean;
  roomTraceVisible: boolean;
  completionVisible: boolean;
  finalTextSample: string;
  durationMs: number;
  gatesProven: string[];
  gatesNotProven: Record<string, string>;
};

const adapterId = parseAdapterId(process.env.PROOFLOOP_EXTERNAL_ADAPTER_ID);
const tasks = loadExternalBenchmarkLocalTasks(adapterId);
const BASE = process.env.BENCH_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5173";
const RUN_ID = process.env.PROOFLOOP_RUN_ID ?? `external-live-${Date.now()}`;
const AGENT_TIMEOUT_MS = Number(process.env.PROOFLOOP_EXTERNAL_AGENT_TIMEOUT_MS ?? 10 * 60_000);
const STREAM_TIMEOUT_MS = Number(process.env.PROOFLOOP_EXTERNAL_STREAM_TIMEOUT_MS ?? 120_000);
const AGENT_MODEL_MODE = process.env.BENCH_AGENT_MODEL_MODE ?? process.env.PROOFLOOP_AGENT_MODEL_MODE ?? "specific";
const AGENT_MODEL_POLICY = process.env.BENCH_AGENT_MODEL_POLICY ?? process.env.PROOFLOOP_AGENT_MODEL_POLICY ?? "deepseek/deepseek-v4-pro";
const REQUIRE_FINAL_PHRASE = process.env.PROOFLOOP_EXTERNAL_REQUIRE_FINAL_PHRASE !== "0";

test.describe(`${adapterId} Proof Loop live-room adapter`, () => {
  test("runs a fresh live room proxy task through public @nodeagent without claiming official score", async ({ page }, testInfo) => {
    test.setTimeout(Math.max(15 * 60_000, tasks.length * AGENT_TIMEOUT_MS + 3 * 60_000));
    expect(tasks.length, `${adapterId} must expose at least one local task`).toBeGreaterThan(0);
    for (const task of tasks) {
      expect(task.adapterId).toBe(adapterId);
      expect(task.officialScoreClaim).toBe(false);
      for (const inputRef of task.inputRefs) {
        expect(existsSync(inputRef), `${adapterId} input ref exists: ${inputRef}`).toBe(true);
      }
    }

    const pageErrors: BrowserProblem[] = [];
    const consoleProblems: BrowserProblem[] = [];
    const ignoredConsoleProblems: BrowserProblem[] = [];
    const requestFailures: BrowserProblem[] = [];
    const badResponses: BrowserProblem[] = [];
    page.on("pageerror", (error) => pageErrors.push({ type: "pageerror", text: error.message }));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) {
        const problem = { type: message.type(), text: message.text() };
        if (isIgnoredConsoleProblem(problem.text)) ignoredConsoleProblems.push(problem);
        else consoleProblems.push(problem);
      }
    });
    page.on("requestfailed", (request) => {
      requestFailures.push({ type: "requestfailed", url: request.url(), text: request.failure()?.errorText ?? "unknown" });
    });
    page.on("response", (response) => {
      if (response.status() >= 400 && !isIgnoredBadResponse(response.url())) {
        badResponses.push({ type: "response", url: response.url(), status: response.status() });
      }
    });

    await enableFocusModeForTest(page);
    await page.addInitScript(() => {
      try {
        window.localStorage?.setItem("noderoom.nodeagentRuntimeProfile", "benchmark_completion");
      } catch {
        // Browser storage is unavailable in a few sandboxed preview frames.
      }
    });

    const roomStartedAt = new Date().toISOString();
    await createFreshLiveRoom(page);
    await expectFocusModeOn(page);
    await ensureBinderOpen(page);
    await openBlankSheet(page);
    await expectAttentionOverlayMounted(page);
    await selectAgentRoute(page);

    const taskProofs: LiveRoomTaskProof[] = [];
    for (const task of tasks) {
      const taskStarted = Date.now();
      const uploadedFiles = await uploadTaskInputs(page, task);
      await openBlankSheet(page);
      const expectedPhrase = `${task.taskId} live-room proxy complete`;
      const prompt = withNodeAgentMention([
        `Proof Loop external-adapter live-room proxy for ${adapterId}.`,
        `Use the uploaded input artifacts and the current live room sheet.`,
        task.userPrompt,
        `Ground the answer in visible room evidence and uploaded files.`,
        `Make the smallest necessary sheet edits; avoid bulk updates unless the task truly requires them.`,
        `When finished, include this exact completion phrase: "${expectedPhrase}".`,
      ].join(" "));
      const proof = await invokePublicNodeAgent(page, prompt, expectedPhrase, taskStarted);
      taskProofs.push({ ...proof, taskId: task.taskId, title: task.title, prompt, uploadedFiles });
    }

    const outputDir = proofOutputDir(adapterId);
    const visualProofPath = join(outputDir, "visual-proof.png");
    await page.screenshot({ path: visualProofPath, fullPage: false });
    await testInfo.attach(`${adapterId}-live-room-visual-proof`, { path: visualProofPath, contentType: "image/png" });

    const roomUrl = page.url();
    const roomId = roomIdFromUrl(roomUrl);
    const problemCounts = {
      pageErrors: pageErrors.length,
      consoleProblems: consoleProblems.length,
      requestFailures: requestFailures.length,
      badResponses: badResponses.length,
    };
    const failedGates = [
      ...taskProofs.flatMap((task) => Object.entries(task.gatesNotProven).map(([gate, reason]) => `${task.taskId}: ${gate}: ${reason}`)),
      ...Object.entries(problemCounts).filter(([, count]) => count > 0).map(([gate, count]) => `${gate}: ${count}`),
    ];
    const status = failedGates.length === 0 ? "passed" : "failed";

    const taskManifestPath = join(outputDir, "local-task-manifest.json");
    const browserProofPath = join(outputDir, "browser-proof.json");
    const nodeEvalPath = join(outputDir, "node-eval.json");
    const liveUserContractPath = join(outputDir, "live-user-contract.json");
    const nodeTracePath = join(outputDir, "node-trace-v2.json");
    const costLedgerPath = join(outputDir, "cost-ledger.json");
    const verifierReceiptPath = join(outputDir, "verifier-receipt.json");
    const officialScorerReceiptPath = join(outputDir, "official-scorer-receipt.json");
    const scorecardPath = join(outputDir, "scorecard.md");

    const model = {
      provider: providerForAgentModelPolicy(AGENT_MODEL_POLICY),
      mode: AGENT_MODEL_MODE,
      policy: AGENT_MODEL_POLICY,
      measuredCostUsd: null,
      measuredTokensIn: null,
      measuredTokensOut: null,
    };
    const common = {
      adapterId,
      runId: RUN_ID,
      generatedAt: new Date().toISOString(),
      baseUrl: BASE,
      roomStartedAt,
      roomUrl,
      roomId,
      localAdapterOnly: true,
      officialScoreClaim: false,
      model,
      tasks,
      taskProofs,
      problemCounts,
      pageErrors,
      consoleProblems,
      requestFailures,
      badResponses,
      ignoredConsoleProblems,
      screenshotPaths: [visualProofPath],
    };

    writeJson(taskManifestPath, { schema: "proofloop-external-local-task-manifest-v1", adapterId, tasks });
    writeJson(liveUserContractPath, {
      schema: "proofloop-external-live-user-contract-v1",
      adapterId,
      contract: [
        "fresh live room created from the production entry path",
        "benchmark proxy inputs uploaded through the browser UI",
        "public @nodeagent message sent by the emulated user",
        "visible stream/status evidence captured",
        "official score remains blocked unless upstream scorer accepts the artifacts",
      ],
      expectedArtifacts: ["browser-proof.json", "node-eval.json", "visual-proof.png"],
      officialScoreClaim: false,
      tasks,
    });
    writeJson(nodeTracePath, {
      schema: "node-trace-v2",
      source: "browser-visible-public-nodeagent-stream",
      adapterId,
      runId: RUN_ID,
      roomUrl,
      taskProofs: taskProofs.map((task) => ({
        taskId: task.taskId,
        gatesProven: task.gatesProven,
        finalTextSample: task.finalTextSample,
        durationMs: task.durationMs,
      })),
    });
    writeJson(nodeEvalPath, {
      schema: "proofloop-external-node-eval-v1",
      adapterId,
      status,
      failedGates,
      taskProofs,
      problemCounts,
    });
    writeJson(costLedgerPath, {
      schema: "proofloop-cost-ledger-v1",
      adapterId,
      model,
      note: "The browser proof records the requested route; production provider token/cost telemetry is not exposed to this local Playwright runner.",
    });
    writeJson(verifierReceiptPath, {
      schema: "proofloop-external-live-room-verifier-v1",
      adapterId,
      status,
      deterministicChecks: {
        freshRoom: true,
        publicNodeAgent: taskProofs.every((task) => task.userMessageVisible),
        streamingVisible: taskProofs.every((task) => task.streamingVisible),
        completionVisible: taskProofs.every((task) => task.completionVisible),
        browserProblemFree: Object.values(problemCounts).every((count) => count === 0),
      },
      ignoredConsoleProblems,
      failedGates,
    });
    writeJson(officialScorerReceiptPath, {
      schema: "proofloop-official-scorer-receipt-v1",
      adapterId,
      status: "blocked_external",
      officialScoreClaim: false,
      reason: "This is a NodeRoom live-room proxy proof, not an upstream official scorer or judge receipt.",
    });
    writeFile(scorecardPath, renderScorecard(adapterId, status, roomUrl, taskProofs, problemCounts));
    writeJson(browserProofPath, {
      schema: "proofloop-external-live-room-browser-proof-v1",
      status,
      ...common,
      evidence: {
        visualProofPath,
        taskManifestPath,
        liveUserContractPath,
        nodeTracePath,
        nodeEvalPath,
        costLedgerPath,
        verifierReceiptPath,
        officialScorerReceiptPath,
        scorecardPath,
      },
    });

    expect(status, failedGates.join("\n")).toBe("passed");
  });
});

async function createFreshLiveRoom(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  expect(page.url(), "external adapter live proof must not use memory mode").not.toContain("mode=memory");
  await page.getByTestId("create-room").click({ timeout: 60_000 });
  const displayName = page.getByTestId("create-display-name");
  if (await displayName.isVisible().catch(() => false)) {
    await displayName.fill("Proof Loop");
  }
  await page.getByTestId("create-room-submit").click({ timeout: 30_000 });
  const blankSheet = page.getByTestId("blank-cta-sheet");
  const addBlankSheet = page.getByRole("button", { name: /Add a blank sheet/i });
  const clicked = await clickWhenVisible(blankSheet, 60_000) || await clickWhenVisible(addBlankSheet, 60_000);
  expect(clicked, "fresh room must expose a blank sheet CTA").toBe(true);
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 45_000 });
}

async function ensureBinderOpen(page: Page): Promise<void> {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click({ timeout: 30_000 });
  }
  await expect(leftRail).toBeVisible({ timeout: 30_000 });
}

async function openBlankSheet(page: Page): Promise<void> {
  await ensureBinderOpen(page);
  const sheet = page.getByTestId("binder-artifact").filter({ hasText: /Sheet 1|Sheet/i }).first();
  if (await sheet.isVisible().catch(() => false)) {
    await sheet.click({ timeout: 30_000 });
  }
  await expect(page.getByTestId("sheet-grid").or(page.locator(noderoomSelectors.sheetSurface)).first()).toBeVisible({ timeout: 45_000 });
}

async function uploadTaskInputs(page: Page, task: ExternalBenchmarkLocalTask): Promise<string[]> {
  await ensureBinderOpen(page);
  const fileInput = page.locator(".r-file-input");
  await fileInput.waitFor({ state: "attached", timeout: 30_000 });
  const payloads = task.inputRefs.map((inputRef) => {
    const absolute = resolve(process.cwd(), inputRef);
    return {
      name: basename(inputRef),
      mimeType: mimeFor(inputRef),
      buffer: Buffer.from(readFileSync(absolute)),
    };
  });
  await fileInput.setInputFiles(payloads);
  const missing = await waitForUploadedLabels(page, payloads.map((payload) => payload.name), 60_000);
  if (missing.length > 0) {
    throw new Error(`Uploaded files did not surface in the live Binder: ${missing.join(", ")}`);
  }
  return payloads.map((payload) => payload.name);
}

async function selectAgentRoute(page: Page): Promise<void> {
  const preset = page.locator(noderoomSelectors.chatModelPreset).first();
  await expect(preset).toBeVisible({ timeout: 30_000 });
  if (AGENT_MODEL_MODE !== "adaptive") await preset.selectOption(AGENT_MODEL_MODE);
  if (AGENT_MODEL_MODE === "specific") {
    await page.locator(noderoomSelectors.chatModelSpecific).first().fill(AGENT_MODEL_POLICY);
  }
  await expect(preset).toHaveValue(AGENT_MODEL_MODE, { timeout: 30_000 });
}

async function invokePublicNodeAgent(
  page: Page,
  prompt: string,
  expectedPhrase: string,
  startedAt: number,
): Promise<Omit<LiveRoomTaskProof, "taskId" | "title" | "prompt" | "uploadedFiles">> {
  const gatesProven: string[] = [];
  const gatesNotProven: Record<string, string> = {};
  const streams = page.locator(noderoomSelectors.agentStream);
  const streamCountBeforeSend = await streams.count().catch(() => 0);
  const composer = page.locator(noderoomSelectors.chatComposer).first();
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.fill(prompt);
  await page.locator(noderoomSelectors.chatSend).first().click();

  const userMessageVisible = await expect(page.getByTestId("chat-message").filter({ hasText: expectedPhrase }).first())
    .toBeVisible({ timeout: 20_000 })
    .then(() => true, () => false);
  if (userMessageVisible) gatesProven.push("public_nodeagent_invocation");
  else gatesNotProven.public_nodeagent_invocation = "User prompt was not visible in public chat.";

  let stream = streams.last();
  const streamingVisible = await waitForNewAgentStream(page, streamCountBeforeSend, STREAM_TIMEOUT_MS)
    .then((newStream) => {
      stream = newStream;
      return true;
    }, () => streams.last().isVisible().catch(() => false));
  if (streamingVisible) gatesProven.push("visible_streaming_progress");
  else gatesNotProven.visible_streaming_progress = "No new visible agent stream appeared after send.";

  const jobStatusVisible = await expect(page.locator(noderoomSelectors.jobStatus).first())
    .toContainText(/queued|running|completed|blocked|failed/i, { timeout: 60_000 })
    .then(() => true, () => false);
  if (jobStatusVisible) gatesProven.push("agent_live_loop");
  else gatesNotProven.agent_live_loop = "No durable job-status signal appeared.";

  const jobDetailVisible = await openJobDetail(page);
  if (jobDetailVisible) gatesProven.push("job_detail_visible");

  const completion = await waitForCompletion(page, stream, expectedPhrase, AGENT_TIMEOUT_MS);
  if (completion.completionVisible) gatesProven.push("agent_terminal_quality_gate");
  else gatesNotProven.agent_terminal_quality_gate = completion.reason ?? "Agent did not reach the completion phrase before timeout.";

  const roomTraceVisible = await page.locator(noderoomSelectors.roomTrace).first().isVisible().catch(() => false);
  if (roomTraceVisible) gatesProven.push("room_trace_visible");

  return {
    userMessageVisible,
    streamingVisible,
    jobStatusVisible,
    jobDetailVisible,
    roomTraceVisible,
    completionVisible: completion.completionVisible,
    finalTextSample: completion.finalTextSample,
    durationMs: Date.now() - startedAt,
    gatesProven,
    gatesNotProven,
  };
}

async function waitForCompletion(
  page: Page,
  stream: Locator,
  expectedPhrase: string,
  timeoutMs: number,
): Promise<{ completionVisible: boolean; finalTextSample: string; reason?: string }> {
  const deadline = Date.now() + timeoutMs;
  let lastText = "";
  while (Date.now() < deadline) {
    const status = await quickText(page.locator(noderoomSelectors.jobStatus).first());
    const streamText = await quickText(stream, 1_000);
    const latestStreamText = await quickText(page.locator(noderoomSelectors.agentStream).last(), 1_000);
    const chatText = await quickText(page.getByTestId("chat-message").last(), 1_000);
    const errorText = await quickText(page.getByTestId("agent-error").first(), 500);
    const combined = [status, streamText, latestStreamText, chatText, errorText].filter(Boolean).join("\n");
    lastText = combined.slice(-2_000);
    const sawPhrase = combined.toLowerCase().includes(expectedPhrase.toLowerCase());
    const terminal = /\b(completed|done)\b/i.test(status) || /\bNodeAgent completed\b/i.test(combined);
    const failed = /\b(failed|blocked|cancelled)\b/i.test(status)
      || /\bNodeAgent needs attention\b/i.test(combined)
      || /\btool_argument_error\b/i.test(combined)
      || Boolean(errorText);
    if (failed) {
      return { completionVisible: false, finalTextSample: lastText, reason: `Agent failed or blocked: ${lastText}` };
    }
    if (sawPhrase || (terminal && !REQUIRE_FINAL_PHRASE)) {
      return { completionVisible: true, finalTextSample: lastText };
    }
    await page.waitForTimeout(2_000);
  }
  return { completionVisible: false, finalTextSample: lastText, reason: `Timed out after ${timeoutMs}ms.` };
}

async function waitForNewAgentStream(page: Page, previousCount: number, timeoutMs: number): Promise<Locator> {
  const streams = page.locator(noderoomSelectors.agentStream);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await streams.count().catch(() => 0);
    if (count > previousCount) {
      const stream = streams.nth(previousCount);
      if (await stream.isVisible().catch(() => false)) return stream;
    }
    await page.waitForTimeout(1_000);
  }
  throw new Error(`Timed out waiting for new agent stream; previous=${previousCount}, current=${await streams.count().catch(() => 0)}`);
}

async function openJobDetail(page: Page): Promise<boolean> {
  const detail = page.locator(noderoomSelectors.jobDetail).first();
  if (await detail.isVisible().catch(() => false)) return true;
  const toggle = page.locator(noderoomSelectors.jobDetailToggle).first();
  if (await toggle.isVisible().catch(() => false)) {
    await toggle.click({ timeout: 10_000 }).catch(() => undefined);
  }
  return detail.isVisible().catch(() => false);
}

async function waitForUploadedLabels(page: Page, names: string[], timeoutMs: number): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  let missing = names.slice();
  while (Date.now() < deadline) {
    await ensureBinderOpen(page);
    const visibleText = await visibleRoomEvidenceText(page);
    missing = names.filter((name) => !uploadedLabelVisible(visibleText, name));
    if (missing.length === 0) return [];
    if (!(await isUploadUiBusy(page)) && Date.now() + 2_000 >= deadline) return missing;
    await page.waitForTimeout(1_000);
  }
  return missing;
}

async function visibleRoomEvidenceText(page: Page): Promise<string> {
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

async function isUploadUiBusy(page: Page): Promise<boolean> {
  if (await page.locator('.r-upload[aria-busy="true"], button[aria-busy="true"]').first().isVisible().catch(() => false)) {
    return true;
  }
  if (await page.getByText(/Uploading(?: files)?\.\.\./i).first().isVisible().catch(() => false)) {
    return true;
  }
  return page.getByTestId("chat-upload-status").first().isVisible().catch(() => false);
}

async function clickWhenVisible(locator: Locator, timeout: number): Promise<boolean> {
  const visible = await locator.waitFor({ state: "visible", timeout }).then(() => true, () => false);
  if (!visible) return false;
  await locator.click({ timeout });
  return true;
}

async function quickText(locator: Locator, timeout = 250): Promise<string> {
  return ((await locator.textContent({ timeout }).catch(() => "")) ?? "");
}

function proofOutputDir(id: ExternalBenchmarkAdapterId): string {
  const dir = process.env.PROOFLOOP_OUTPUT_DIR ?? join(process.cwd(), ".proofloop", "runs", RUN_ID, "external-adapter-live-room", id);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function parseAdapterId(value: string | undefined): ExternalBenchmarkAdapterId {
  if (value && (externalBenchmarkLocalTaskIds() as string[]).includes(value)) return value as ExternalBenchmarkAdapterId;
  const allowed = externalBenchmarkLocalTaskIds().join(", ");
  throw new Error(`PROOFLOOP_EXTERNAL_ADAPTER_ID must be one of: ${allowed}`);
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeFile(path: string, value: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, value, "utf8");
}

function renderScorecard(
  id: ExternalBenchmarkAdapterId,
  status: string,
  roomUrl: string,
  taskProofs: LiveRoomTaskProof[],
  problemCounts: Record<string, number>,
): string {
  const lines = [
    `# ${id} Live-Room Proxy Proof`,
    "",
    `Status: ${status}`,
    `Room: ${roomUrl}`,
    `Official score claim: false`,
    "",
    "## Tasks",
    ...taskProofs.map((task) => `- ${task.taskId}: ${task.completionVisible ? "pass" : "fail"} (${task.durationMs}ms)`),
    "",
    "## Browser Problems",
    ...Object.entries(problemCounts).map(([name, count]) => `- ${name}: ${count}`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function roomIdFromUrl(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get("room") ?? undefined;
  } catch {
    return undefined;
  }
}

function mimeFor(file: string): string {
  const lower = file.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".md") || lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

function isIgnoredBadResponse(url: string): boolean {
  return /favicon\.ico|\.map(?:\?|$)/i.test(url);
}

function isIgnoredConsoleProblem(text: string | undefined): boolean {
  return Boolean(text)
    && /WebSocket connection to 'wss:\/\/zealous-goshawk-766\.convex\.cloud\/api\/1\.41\.0\/sync' failed: Error in connection establishment: net::ERR_INTERNET_DISCONNECTED/i.test(text);
}

function binderTitlePattern(filename: string): RegExp {
  const extension = filename.match(/\.(json|md|csv|txt|pdf|xlsx)$/i)?.[1]?.toUpperCase() ?? "";
  const stem = filename.replace(/\.(json|md|csv|txt|pdf|xlsx)$/i, "").replace(/[-_]+/g, " ");
  const title = extension ? `${stem} ${extension}` : stem;
  return new RegExp(escapeRegex(title), "i");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uploadedLabelVisible(visibleText: string, filename: string): boolean {
  return visibleText.includes(filename) || binderTitlePattern(filename).test(visibleText);
}
