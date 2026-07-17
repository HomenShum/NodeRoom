import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import ExcelJS from "exceljs";
import { scoreSpreadsheetBenchWorkbook } from "../src/eval/spreadsheetBenchScorer";
import type { SpreadsheetBenchTrack } from "../src/eval/spreadsheetBenchAdapter";
import { getProviderForModel } from "../src/nodeagent/models/modelCatalog";

type AgentTaskManifest = {
  schema: 1;
  taskId: string;
  track: SpreadsheetBenchTrack;
  category?: string;
  instruction: string;
  inputFiles: string[];
  promptFiles?: string[];
};

type EvaluatorManifest = {
  schema: 1;
  taskId: string;
  track: SpreadsheetBenchTrack;
  answerPosition?: string;
  answerSheet?: string;
  goldFiles: string[];
};

type CaseResult = {
  caseIndex: number;
  inputFile: string;
  goldFile: string;
  roomUrl: string;
  downloadedWorkbook: string;
  bytes: number;
  magic: string;
  agentEvidence: AgentUiEvidence;
  score: Awaited<ReturnType<typeof scoreSpreadsheetBenchWorkbook>>;
  passed: boolean;
};

type AgentUiEvidence = {
  routeText: string;
  resolvedModel: string;
  approvalPolicy: string;
  attemptBudget: 12;
  mutationCount: number;
  receiptCount: number;
  receiptText: string;
  tools: string[];
  postWriteVerification: "passed";
};

const BASE = process.env.BENCH_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "https://noderoom.live";
const TRACK = parseTrack(process.env.SPREADSHEETBENCH_TRACK);
const STAGE_ROOT = process.env.SPREADSHEETBENCH_STAGE_ROOT
  ?? (TRACK === "spreadsheetbench-v1" ? ".tmp/official-benchmarks/staged-v1-912" : ".tmp/official-benchmarks/staged-v2-full");
const TASK_ID = process.env.SPREADSHEETBENCH_TASK_ID;
const RUN_ID = process.env.PROOFLOOP_RUN_ID ?? `spreadsheetbench-live-${Date.now()}`;
const AGENT_MODEL_MODE = process.env.BENCH_AGENT_MODEL_MODE ?? "specific";
const AGENT_MODEL_POLICY = process.env.BENCH_AGENT_MODEL_POLICY ?? "openrouter/free-auto";
const AGENT_TIMEOUT_MS = Number(process.env.PROOFLOOP_SPREADSHEETBENCH_AGENT_TIMEOUT_MS ?? 15 * 60_000);
const CASE_LIMIT = numberEnv("SPREADSHEETBENCH_CASE_LIMIT");
const MAX_MISMATCHES = Number(process.env.SPREADSHEETBENCH_MAX_MISMATCHES ?? 20);
const COMPARE_STYLES = process.env.SPREADSHEETBENCH_COMPARE_STYLES === "1";
const COMPARE_CHARTS = process.env.SPREADSHEETBENCH_COMPARE_CHARTS === "1" || TRACK === "spreadsheetbench-v2";
const PROOF_PATH = process.env.SPREADSHEETBENCH_LIVE_PROOF_PATH
  ?? join(".proofloop", "runs", RUN_ID, "spreadsheetbench", `${sanitize(TASK_ID ?? "task")}.json`);

test.describe(`${TRACK} generic prod-browser adapter`, () => {
  test("uploads staged workbook cases, runs NodeAgent in a fresh live room, exports, and scores", async ({ page }, testInfo) => {
    if (!TASK_ID) throw new Error("SPREADSHEETBENCH_TASK_ID is required.");

    const staged = loadStagedTask(STAGE_ROOT, TASK_ID);
    expect(staged.agent.track).toBe(TRACK);
    expect(staged.evaluator.track).toBe(TRACK);
    expect(staged.agent.inputFiles.length, "staged task must include input workbooks").toBeGreaterThan(0);
    expect(staged.evaluator.goldFiles.length, "staged task must include evaluator-only gold workbooks").toBeGreaterThan(0);

    const caseCount = Math.min(staged.agent.inputFiles.length, staged.evaluator.goldFiles.length, CASE_LIMIT ?? Number.POSITIVE_INFINITY);
    test.setTimeout(Math.max(20 * 60_000, caseCount * (AGENT_TIMEOUT_MS + 3 * 60_000)));
    const pageErrors: string[] = [];
    const consoleProblems: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()) && !isIgnoredConsoleProblem(message.text())) {
        consoleProblems.push(`${message.type()}: ${message.text()}`);
      }
    });

    const caseResults: CaseResult[] = [];
    const cleanupState = { promptSent: false };
    let runtimeFailure: string | undefined;
    let cleanupFailure: string | undefined;
    try {
      for (let index = 0; index < caseCount; index += 1) {
        cleanupState.promptSent = false;
        try {
          const inputFile = staged.agent.inputFiles[index];
          const goldFile = staged.evaluator.goldFiles[index];
          if (!inputFile || !goldFile) throw new Error(`Missing case pair ${index} for ${TASK_ID}`);
          const result = await runWorkbookCase(page, testInfo, staged, inputFile, goldFile, index, cleanupState);
          caseResults.push(result);
        } finally {
          const caseCleanupFailure = await cancelActiveJob(page, cleanupState.promptSent);
          if (caseCleanupFailure && !cleanupFailure) cleanupFailure = `case ${index}: ${caseCleanupFailure}`;
        }
        if (cleanupFailure) break;
      }
    } catch (error) {
      runtimeFailure = error instanceof Error ? error.message : String(error);
    } finally {
      const finalCleanupFailure = await cancelActiveJob(page, cleanupState.promptSent);
      if (finalCleanupFailure && !cleanupFailure) cleanupFailure = finalCleanupFailure;
    }

    const failedCases = caseResults.filter((result) => !result.passed);
    const passed = !runtimeFailure && !cleanupFailure && failedCases.length === 0 && pageErrors.length === 0 && consoleProblems.length === 0;
    writeProof({
      schema: "proofloop-spreadsheetbench-prod-browser-receipt-v1",
      generatedAt: new Date().toISOString(),
      runId: RUN_ID,
      baseUrl: BASE,
      track: TRACK,
      taskId: staged.agent.taskId,
      taskDir: relative(process.cwd(), staged.taskDir).replace(/\\/g, "/"),
      memoryMode: false,
      officialScoreClaim: false,
      model: {
        mode: AGENT_MODEL_MODE,
        policy: AGENT_MODEL_POLICY,
      },
      caseCount,
      passedCaseCount: caseResults.length - failedCases.length,
      passed,
      caseResults: caseResults.map((result) => ({
        caseIndex: result.caseIndex,
        inputFile: result.inputFile,
        goldFile: result.goldFile,
        roomUrl: result.roomUrl,
        downloadedWorkbook: result.downloadedWorkbook,
        bytes: result.bytes,
        magic: result.magic,
        agentEvidence: result.agentEvidence,
        passed: result.passed,
        score: {
          pass: result.score.pass,
          scores: result.score.scores,
          totals: result.score.totals,
          chartPackage: result.score.chartPackage,
        },
      })),
      failures: [
        ...(runtimeFailure ? [`runtime: ${runtimeFailure}`] : []),
        ...(cleanupFailure ? [`cleanup: ${cleanupFailure}`] : []),
        ...failedCases.map((result) => `case ${result.caseIndex}: score did not pass (${result.score.totals.mismatches} mismatch(es))`),
        ...pageErrors.map((error) => `pageerror: ${error}`),
        ...consoleProblems,
      ],
      gatesProven: [
        "fresh_room_join",
        "official_fixture_upload",
        "public_nodeagent_invocation",
        "visible_job_status",
        ...(caseResults.length > 0 ? [
          "deliverable_export_download",
          "artifact_reopen_validation",
          "local_immutable_scorer_handoff",
          "bounded_12_attempt_job",
          "resolved_model_route_visible",
          "inspect_preflight_managed_write_postverify_visible",
          "mutation_receipt_visible",
        ] : []),
        "no_memory_mode_shortcut",
      ],
      gatesNotProven: passed ? {} : { full_task_pass: "At least one case, page error, or console problem failed." },
    });

    if (runtimeFailure) throw new Error(runtimeFailure);
    if (cleanupFailure) throw new Error(cleanupFailure);
    expect(pageErrors, "browser page errors").toEqual([]);
    expect(consoleProblems, "console warnings/errors").toEqual([]);
    expect(failedCases.map((result) => `${result.caseIndex}:${result.score.totals.mismatches}`), "all workbook cases must score cleanly").toEqual([]);
  });
});

async function runWorkbookCase(
  page: Page,
  testInfo: { outputPath: (...segments: string[]) => string; attach: (name: string, body: { path: string; contentType: string }) => Promise<void> },
  staged: ReturnType<typeof loadStagedTask>,
  inputFile: string,
  goldFile: string,
  caseIndex: number,
  cleanupState: { promptSent: boolean },
): Promise<CaseResult> {
  await createFreshRoom(page);
  await selectAgentRoute(page);
  const inputPath = resolveManifestPath(dirname(staged.agentManifestPath), inputFile);
  const goldPath = resolveManifestPath(dirname(staged.evaluatorManifestPath), goldFile);
  await uploadWorkbook(page, inputPath);
  await openUploadedWorkbook(page, basename(inputPath));

  const expectedPhrase = `${staged.agent.taskId} spreadsheetbench case ${caseIndex + 1} complete`;
  const agentEvidence = await invokeNodeAgent(page, [
    `@nodeagent You are completing ${TRACK} task ${staged.agent.taskId}, case ${caseIndex + 1}.`,
    "Use the uploaded workbook currently open in the room.",
    staged.agent.instruction,
    "Edit the workbook itself. Do not only explain the answer in chat.",
    "Preserve the workbook structure unless the task explicitly asks for a new layout.",
    `When the workbook is ready, include this exact phrase in your final answer: "${expectedPhrase}".`,
  ].join("\n"), expectedPhrase, cleanupState);

  const downloadPath = await exportActiveWorkbook(page, testInfo.outputPath(`spreadsheetbench-${sanitize(staged.agent.taskId)}-${caseIndex + 1}.xlsx`));
  await testInfo.attach(`spreadsheetbench-case-${caseIndex + 1}-workbook`, {
    path: downloadPath,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const bytes = readFileSync(downloadPath);
  const magic = magicString(bytes);
  expect(magic.startsWith("PK"), "exported workbook must be an Office ZIP package").toBe(true);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(downloadPath);
  expect(workbook.worksheets.length, "exported workbook must reopen with at least one worksheet").toBeGreaterThan(0);

  const score = await scoreSpreadsheetBenchWorkbook({
    taskId: staged.agent.taskId,
    candidateWorkbookPath: downloadPath,
    goldWorkbookPath: goldPath,
    answerPosition: staged.evaluator.answerPosition,
    answerSheet: staged.evaluator.answerSheet,
    compareStyles: COMPARE_STYLES,
    compareCharts: COMPARE_CHARTS,
    maxMismatches: MAX_MISMATCHES,
    generatedAt: new Date().toISOString(),
  });

  return {
    caseIndex,
    inputFile,
    goldFile,
    roomUrl: page.url(),
    downloadedWorkbook: downloadPath,
    bytes: statSync(downloadPath).size,
    magic,
    agentEvidence,
    score,
    passed: score.pass,
  };
}

async function createFreshRoom(page: Page): Promise<void> {
  const desktopUrl = new URL(BASE);
  desktopUrl.searchParams.set("surface", "desktop");
  await page.goto(desktopUrl.toString(), { waitUntil: "domcontentloaded", timeout: 60_000 });
  expect(page.url(), "SpreadsheetBench prod adapter must not use memory mode").not.toContain("mode=memory");
  await page.getByTestId("create-room").click({ timeout: 60_000 });
  const displayName = page.getByTestId("create-display-name");
  if (await displayName.isVisible().catch(() => false)) await displayName.fill("Proof Loop");
  await page.getByLabel("Auto-approve conflict-free edits").check();
  await page.getByTestId("create-room-submit").click({ timeout: 30_000 });
  await createPasswordAccountIfRequired(page);
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 60_000 });
}

async function createPasswordAccountIfRequired(page: Page): Promise<void> {
  const accountGate = page.getByTestId("account-auth-gate");
  if (!(await accountGate.isVisible({ timeout: 10_000 }).catch(() => false))) return;
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Email").fill(`spreadsheetbench-${nonce}@example.test`);
  await page.getByLabel("Password").fill("NodeRoom-Benchmark-190!");
  await page.getByTestId("sign-in-password").click();
}

async function selectAgentRoute(page: Page): Promise<void> {
  const preset = page.getByTestId("chat-model-preset").first();
  await expect(preset).toBeVisible({ timeout: 30_000 });
  await preset.selectOption(AGENT_MODEL_MODE);
  if (AGENT_MODEL_MODE === "specific") {
    await page.getByTestId("chat-model-specific").fill(AGENT_MODEL_POLICY);
  }
  await expect(preset).toHaveValue(AGENT_MODEL_MODE, { timeout: 30_000 });
}

async function uploadWorkbook(page: Page, path: string): Promise<void> {
  await ensureBinderOpen(page);
  const fileInput = page.getByTestId("chat-file-input");
  await fileInput.waitFor({ state: "attached", timeout: 30_000 });
  await fileInput.setInputFiles(path);
  await expect(page.getByTestId("binder-artifact").filter({ hasText: binderTitlePattern(basename(path)) }).first())
    .toBeVisible({ timeout: 90_000 });
}

async function openUploadedWorkbook(page: Page, filename: string): Promise<void> {
  await ensureBinderOpen(page);
  await page.getByTestId("binder-artifact").filter({ hasText: binderTitlePattern(filename) }).first().click({ timeout: 30_000 });
  await expect(page.getByTestId("sheet-grid").or(page.locator(".r-grid")).first()).toBeVisible({ timeout: 90_000 });
}

async function invokeNodeAgent(
  page: Page,
  prompt: string,
  expectedPhrase: string,
  cleanupState: { promptSent: boolean },
): Promise<AgentUiEvidence> {
  const composer = page.locator('textarea[data-testid="chat-composer"]').first();
  await expect(composer).toBeVisible({ timeout: 30_000 });
  const agentMessages = page.locator('[data-testid="chat-message"].agent');
  const agentMessageCountBefore = await agentMessages.count().catch(() => 0);
  const streams = page.locator('[data-testid="agent-unified-stream"]');
  const streamCountBefore = await streams.count().catch(() => 0);
  await composer.fill(prompt);
  await page.getByTestId("chat-send").click({ timeout: 30_000 });
  cleanupState.promptSent = true;
  await expect(page.getByTestId("chat-message").filter({ hasText: prompt.slice(0, 80) }).last())
    .toBeVisible({ timeout: 30_000 });

  await expect.poll(async () => {
    const status = await reachableJobStatus(page, 500);
    return status && hasKnownJobStatus(status) ? 1 : 0;
  }, {
    message: "a fresh durable NodeAgent job status must remain reachable after the prompt is sent",
    timeout: 90_000,
    intervals: [1000, 2000, 5000],
  }).toBe(1);

  const detailToggle = page.getByTestId("job-detail-toggle").first();
  await expect(detailToggle).toBeVisible({ timeout: 30_000 });
  if ((await detailToggle.getAttribute("aria-expanded")) !== "true") await detailToggle.click();
  await expect(page.getByTestId("job-detail").first()).toBeVisible({ timeout: 30_000 });

  const deadline = Date.now() + AGENT_TIMEOUT_MS;
  let lastText = "";
  let lastDetailText = "";
  let routeText = "";
  let resolvedModel = "";
  let sawFreshAgentOutput = false;
  let sawBoundedAttemptBudget = false;
  while (Date.now() < deadline) {
    const status = await reachableJobStatus(page, 1000);
    if (!status) throw new Error("NodeAgent status became unreachable after the prompt was sent.");
    const latestAgentMessage = await quickText(agentMessages.last(), 1000);
    const latestStream = await quickText(streams.last(), 1000);
    const agentMessageCount = await agentMessages.count().catch(() => 0);
    const streamCount = await streams.count().catch(() => 0);
    sawFreshAgentOutput = sawFreshAgentOutput
      || agentMessageCount > agentMessageCountBefore
      || streamCount > streamCountBefore
      || latestStream.length > 0;
    lastText = `${status}\n${latestAgentMessage}\n${latestStream}`.slice(-2000);
    sawBoundedAttemptBudget = sawBoundedAttemptBudget || /\b\d+\s*\/\s*12\b/.test(status);
    const detailText = await quickText(page.getByTestId("job-detail").first(), 500);
    if (detailText) lastDetailText = detailText;
    const currentRoute = await readAgentRoute(page);
    if (currentRoute.routeText) routeText = currentRoute.routeText;
    if (currentRoute.resolvedModel) resolvedModel = currentRoute.resolvedModel;
    if (/\b(failed|blocked|cancelled)\b/i.test(status)) throw new Error(`NodeAgent failed: ${lastText}`);
    if (new RegExp(escapeRegex(expectedPhrase), "i").test(`${latestAgentMessage}\n${latestStream}`) || (sawFreshAgentOutput && /\b(completed|done)\b/i.test(status))) {
      expect(sawBoundedAttemptBudget, "the live durable job must expose the 12-attempt production ceiling").toBe(true);
      await expect.poll(async () => {
        const acceptedRoute = await readAgentRoute(page, 1000);
        if (acceptedRoute.routeText) routeText = acceptedRoute.routeText;
        if (acceptedRoute.resolvedModel) resolvedModel = acceptedRoute.resolvedModel;
        return resolvedModel.length > 0;
      }, {
        message: "the completed job must expose its accepted/resolved model route",
        timeout: 60_000,
        intervals: [500, 1000, 2000],
      }).toBe(true);
      await expect.poll(async () => page.locator(".r-cell.locked").count(), { timeout: 60_000 }).toBe(0);
      return collectAgentEvidence(page, { detailText: lastDetailText, routeText, resolvedModel });
    }
    await page.waitForTimeout(2000);
  }
  throw new Error(`Timed out waiting for NodeAgent completion. Last text: ${lastText}`);
}

async function collectAgentEvidence(
  page: Page,
  observed: { detailText: string; routeText: string; resolvedModel: string },
): Promise<AgentUiEvidence> {
  const stream = page.getByTestId("agent-unified-stream").last();
  await expect(stream).toBeVisible({ timeout: 30_000 });
  const progressToggle = stream.getByTestId("agent-progress-details-toggle");
  if (await progressToggle.isVisible().catch(() => false)) {
    if ((await progressToggle.getAttribute("aria-expanded")) !== "true") await progressToggle.click();
    await expect(stream.getByTestId("agent-progress-details")).toBeVisible({ timeout: 30_000 });
  }

  const inspect = stream.locator('[data-part="tool-inspect_workbook"][data-status="done"]');
  const writes = stream.locator([
    '[data-part="tool-write_locked_cell"][data-status="done"]',
    '[data-part="tool-write_locked_cells"][data-status="done"]',
  ].join(", "));
  const verifications = stream.locator('[data-part="tool-verify_workbook"][data-status="done"]');
  await expect(inspect.first(), "the production run must visibly inspect the workbook").toBeVisible({ timeout: 30_000 });
  await expect(writes.first(), "the production run must visibly use a managed write tool").toBeVisible({ timeout: 30_000 });
  expect(await stream.locator('[data-part="tool-execute_verified_workbook_plan"]').count(), "the benchmark-only compound executor must not be exposed in production").toBe(0);
  expect(await verifications.count(), "preflight and post-write verification must both be visible").toBeGreaterThanOrEqual(2);

  const verificationPayloads = await verifications.locator(".r-agent-part-payload").allTextContents();
  expect(verificationPayloads.some(hasPassedPostWriteVerificationReceipt), "a verify_workbook result must prove a passed post-write phase").toBe(true);

  expect(observed.resolvedModel, "the accepted/resolved model route must remain reachable").not.toBe("");
  expect(observed.routeText, "the requested and resolved model route must remain visible").toContain(observed.resolvedModel);
  expect(getProviderForModel(observed.resolvedModel), `the accepted/resolved model route must be valid (${observed.resolvedModel || "missing"})`)
    .not.toBeNull();
  const detailToggle = page.getByTestId("job-detail-toggle").first();
  const detail = page.getByTestId("job-detail").first();
  const approvalPolicy = detail.getByTestId("job-approval-policy");
  const mutationTelemetry = detail.getByTestId("job-mutation-count");
  const receiptTelemetry = detail.getByTestId("job-receipt-count");
  const receipts = detail.getByTestId("job-mutation-receipt");
  await expect.poll(async () => {
    if (!(await detailToggle.isVisible().catch(() => false))) return false;
    if ((await detailToggle.getAttribute("aria-expanded")) !== "true") {
      await detailToggle.click().catch(() => undefined);
    }
    return detail.isVisible().catch(() => false);
  }, {
    message: "the completed job must keep its proof detail reachable",
    timeout: 60_000,
    intervals: [500, 1000, 2000],
  }).toBe(true);
  await expect(approvalPolicy, "job detail must identify the conflict-safe direct-edit policy")
    .toHaveText("auto_commit_safe", { timeout: 60_000 });
  await expect.poll(() => telemetryValue(mutationTelemetry), {
    message: "a completed workbook edit must record a durable mutation",
    timeout: 60_000,
    intervals: [500, 1000, 2000],
  }).toBeGreaterThan(0);
  await expect.poll(() => telemetryValue(receiptTelemetry), {
    message: "a completed workbook edit must record a durable receipt",
    timeout: 60_000,
    intervals: [500, 1000, 2000],
  }).toBeGreaterThan(0);
  await expect(receipts.first(), "job detail must expose the mutation receipt and affected target")
    .toBeVisible({ timeout: 60_000 });
  const mutationCount = await telemetryValue(mutationTelemetry);
  const receiptCount = await telemetryValue(receiptTelemetry);
  const receiptText = (await quickText(receipts.first(), 1000)).trim();

  return {
    routeText: observed.routeText,
    resolvedModel: observed.resolvedModel,
    approvalPolicy: "auto_commit_safe",
    attemptBudget: 12,
    mutationCount,
    receiptCount,
    receiptText,
    tools: ["inspect_workbook", "verify_workbook", "write_locked_cell(s)", "verify_workbook"],
    postWriteVerification: "passed",
  };
}

async function cancelActiveJob(page: Page, promptSent: boolean): Promise<string | undefined> {
  const status = await reachableJobStatus(page, 1000);
  if (!status) {
    return promptSent ? "NodeAgent status was unreachable after the prompt was sent; cleanup cannot prove a terminal state." : undefined;
  }
  if (isTerminalJobStatus(status)) return undefined;
  const cancel = page.getByTestId("job-cancel").first();
  if (!(await cancel.isVisible({ timeout: 2000 }).catch(() => false))) {
    return `NodeAgent remained nonterminal without a reachable cancel control (${status}).`;
  }
  await cancel.click({ timeout: 10_000 }).catch(() => undefined);
  const terminal = await expect.poll(
    async () => {
      const nextStatus = await reachableJobStatus(page, 1000);
      return nextStatus ? isTerminalJobStatus(nextStatus) : false;
    },
    { timeout: 30_000, intervals: [500, 1000, 2000] },
  ).toBe(true).then(() => true).catch(() => false);
  return terminal ? undefined : `Timed out while cancelling the nonterminal NodeAgent job (${status}).`;
}

function hasPassedPostWriteVerificationReceipt(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload) as {
      metadata?: {
        verificationReceipt?: {
          schema?: string;
          afterWrite?: boolean;
          phase?: string;
          status?: string;
          ok?: boolean;
          operationCount?: number;
          checkedCount?: number;
        };
      };
    };
    const receipt = parsed.metadata?.verificationReceipt;
    return receipt?.schema === "nodeagent-workbook-verification-receipt-v1"
      && receipt.afterWrite === true
      && receipt.phase === "post_write"
      && receipt.status === "passed"
      && receipt.ok === true
      && typeof receipt.operationCount === "number"
      && receipt.operationCount > 0
      && receipt.checkedCount === receipt.operationCount;
  } catch {
    return false;
  }
}

async function exportActiveWorkbook(page: Page, outPath: string): Promise<string> {
  const exportButton = page.getByTestId("artifact-export-xlsx").first();
  await expect(exportButton, "active workbook must expose Export XLSX").toBeVisible({ timeout: 30_000 });
  const downloadPromise = page.waitForEvent("download", { timeout: 60_000 });
  await exportButton.click();
  const download = await downloadPromise;
  mkdirSync(dirname(outPath), { recursive: true });
  await download.saveAs(outPath);
  return outPath;
}

async function ensureBinderOpen(page: Page): Promise<void> {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click({ timeout: 30_000 });
  }
  await expect(leftRail).toBeVisible({ timeout: 30_000 });
}

function loadStagedTask(stageRoot: string, taskId: string) {
  const root = resolve(stageRoot);
  const taskDir = findTaskDir(root, taskId);
  if (!taskDir) throw new Error(`No staged SpreadsheetBench task found for ${taskId} under ${stageRoot}`);
  const agentManifestPath = join(taskDir, "agent", "task.json");
  const evaluatorManifestPath = join(taskDir, "evaluator", "evaluator.json");
  const agent = JSON.parse(readFileSync(agentManifestPath, "utf8")) as AgentTaskManifest;
  const evaluator = JSON.parse(readFileSync(evaluatorManifestPath, "utf8")) as EvaluatorManifest;
  return { root, taskDir, agentManifestPath, evaluatorManifestPath, agent, evaluator };
}

function findTaskDir(stageRoot: string, taskId: string): string | undefined {
  const tasksRoot = join(stageRoot, "tasks");
  const normalized = normalizeTaskId(taskId);
  const direct = join(tasksRoot, normalized);
  if (existsSync(join(direct, "agent", "task.json"))) return direct;
  return walkDirs(tasksRoot).find((dir) => {
    if (!existsSync(join(dir, "agent", "task.json"))) return false;
    const manifest = JSON.parse(readFileSync(join(dir, "agent", "task.json"), "utf8")) as { taskId?: string };
    return manifest.taskId === taskId || normalizeTaskId(manifest.taskId ?? "") === normalized;
  });
}

function walkDirs(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = join(root, entry.name);
    out.push(full, ...walkDirs(full));
  }
  return out;
}

function resolveManifestPath(base: string, value: string): string {
  const resolved = resolve(base, value.replace(/\\/g, "/"));
  if (!existsSync(resolved)) throw new Error(`Manifest file is missing: ${resolved}`);
  return resolved;
}

function writeProof(value: unknown): void {
  const out = resolve(PROOF_PATH);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function parseTrack(value: string | undefined): SpreadsheetBenchTrack {
  if (value === "spreadsheetbench-v1" || value === "spreadsheetbench-v2") return value;
  return "spreadsheetbench-v1";
}

function numberEnv(name: string): number | undefined {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function normalizeTaskId(value: string): string {
  return value.replace(/[\\/]/g, "_");
}

function sanitize(value: string): string {
  return normalizeTaskId(value).replace(/[^A-Za-z0-9_.-]+/g, "_");
}

function magicString(bytes: Buffer): string {
  return Array.from(bytes.subarray(0, 4)).map((byte) => {
    if (byte >= 32 && byte <= 126) return String.fromCharCode(byte);
    return `\\x${byte.toString(16).padStart(2, "0")}`;
  }).join("");
}

function binderTitlePattern(filename: string): RegExp {
  const stem = filename.replace(/\.(xlsx|xlsm|xls|csv|txt|json|pdf)$/i, "").replace(/[-_]+/g, " ");
  return new RegExp(escapeRegex(stem), "i");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolvedModelFromRoute(visibleText: string, title: string): string | undefined {
  const titleMatch = title.match(/\battempt\s+\d+\s*:\s*([^\u00b7|]+)/i);
  const titleModel = titleMatch?.[1]?.trim();
  if (titleModel) return titleModel;
  const visibleModel = visibleText.split(/\s+\u00b7\s+/)[1]?.trim();
  return visibleModel && getProviderForModel(visibleModel) ? visibleModel : undefined;
}

function hasKnownJobStatus(status: string): boolean {
  return /\b(completed|failed|blocked|cancelled|queued|running|retrying|handoff|paused)\b/i.test(status);
}

function isTerminalJobStatus(status: string): boolean {
  return /\b(completed|failed|blocked|cancelled)\b/i.test(status);
}

async function reachableJobStatus(page: Page, timeout: number): Promise<string | undefined> {
  const status = page.getByTestId("job-status").first();
  if (!(await status.isVisible({ timeout }).catch(() => false))) return undefined;
  return (await quickText(status, timeout)).trim() || undefined;
}

async function readAgentRoute(page: Page, timeout = 500): Promise<{ routeText: string; resolvedModel?: string }> {
  const route = page.locator(".r-job-route").first();
  const title = await route.getAttribute("title", { timeout }).catch(() => "");
  const visibleText = (await quickText(route, timeout)).trim();
  return {
    routeText: [visibleText, title].filter(Boolean).join(" | "),
    resolvedModel: resolvedModelFromRoute(visibleText, title ?? ""),
  };
}

async function quickText(locator: ReturnType<Page["locator"]>, timeout = 250): Promise<string> {
  return ((await locator.textContent({ timeout }).catch(() => "")) ?? "");
}

async function telemetryValue(locator: ReturnType<Page["locator"]>): Promise<number> {
  const value = Number.parseInt((await quickText(locator, 1000)).trim(), 10);
  return Number.isFinite(value) ? value : 0;
}

function isIgnoredConsoleProblem(text: string | undefined): boolean {
  return Boolean(text) && /favicon|Download the React DevTools/i.test(text);
}
