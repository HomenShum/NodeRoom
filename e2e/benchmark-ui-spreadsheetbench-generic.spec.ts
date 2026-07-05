import { expect, test, type Page } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import ExcelJS from "exceljs";
import { scoreSpreadsheetBenchWorkbook } from "../src/eval/spreadsheetBenchScorer";
import type { SpreadsheetBenchTrack } from "../src/eval/spreadsheetBenchAdapter";

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
  score: Awaited<ReturnType<typeof scoreSpreadsheetBenchWorkbook>>;
  passed: boolean;
};

const BASE = process.env.BENCH_BASE_URL ?? process.env.PLAYWRIGHT_BASE_URL ?? "https://noderoom.live";
const TRACK = parseTrack(process.env.SPREADSHEETBENCH_TRACK);
const STAGE_ROOT = process.env.SPREADSHEETBENCH_STAGE_ROOT
  ?? (TRACK === "spreadsheetbench-v1" ? ".tmp/official-benchmarks/staged-v1-912" : ".tmp/official-benchmarks/staged-v2-full");
const TASK_ID = process.env.SPREADSHEETBENCH_TASK_ID;
const RUN_ID = process.env.PROOFLOOP_RUN_ID ?? `spreadsheetbench-live-${Date.now()}`;
const AGENT_MODEL_MODE = process.env.BENCH_AGENT_MODEL_MODE ?? "specific";
const AGENT_MODEL_POLICY = process.env.BENCH_AGENT_MODEL_POLICY ?? "openrouter/free";
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
    test.setTimeout(Math.max(20 * 60_000, (CASE_LIMIT ?? 1) * (AGENT_TIMEOUT_MS + 3 * 60_000)));

    const staged = loadStagedTask(STAGE_ROOT, TASK_ID);
    expect(staged.agent.track).toBe(TRACK);
    expect(staged.evaluator.track).toBe(TRACK);
    expect(staged.agent.inputFiles.length, "staged task must include input workbooks").toBeGreaterThan(0);
    expect(staged.evaluator.goldFiles.length, "staged task must include evaluator-only gold workbooks").toBeGreaterThan(0);

    const caseCount = Math.min(staged.agent.inputFiles.length, staged.evaluator.goldFiles.length, CASE_LIMIT ?? Number.POSITIVE_INFINITY);
    const pageErrors: string[] = [];
    const consoleProblems: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type()) && !isIgnoredConsoleProblem(message.text())) {
        consoleProblems.push(`${message.type()}: ${message.text()}`);
      }
    });

    const caseResults: CaseResult[] = [];
    let runtimeFailure: string | undefined;
    try {
      for (let index = 0; index < caseCount; index += 1) {
        const inputFile = staged.agent.inputFiles[index];
        const goldFile = staged.evaluator.goldFiles[index];
        if (!inputFile || !goldFile) throw new Error(`Missing case pair ${index} for ${TASK_ID}`);
        const result = await runWorkbookCase(page, testInfo, staged, inputFile, goldFile, index);
        caseResults.push(result);
      }
    } catch (error) {
      runtimeFailure = error instanceof Error ? error.message : String(error);
    }

    const failedCases = caseResults.filter((result) => !result.passed);
    const passed = !runtimeFailure && failedCases.length === 0 && pageErrors.length === 0 && consoleProblems.length === 0;
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
          "official_scorer_handoff",
        ] : []),
        "no_memory_mode_shortcut",
      ],
      gatesNotProven: passed ? {} : { full_task_pass: "At least one case, page error, or console problem failed." },
    });

    if (runtimeFailure) throw new Error(runtimeFailure);
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
): Promise<CaseResult> {
  await createFreshRoom(page);
  await selectAgentRoute(page);
  const inputPath = resolveManifestPath(dirname(staged.agentManifestPath), inputFile);
  const goldPath = resolveManifestPath(dirname(staged.evaluatorManifestPath), goldFile);
  await uploadWorkbook(page, inputPath);
  await openUploadedWorkbook(page, basename(inputPath));

  const expectedPhrase = `${staged.agent.taskId} spreadsheetbench case ${caseIndex + 1} complete`;
  await invokeNodeAgent(page, [
    `@nodeagent You are completing ${TRACK} task ${staged.agent.taskId}, case ${caseIndex + 1}.`,
    "Use the uploaded workbook currently open in the room.",
    staged.agent.instruction,
    "Edit the workbook itself. Do not only explain the answer in chat.",
    "Preserve the workbook structure unless the task explicitly asks for a new layout.",
    `When the workbook is ready, include this exact phrase in your final answer: "${expectedPhrase}".`,
  ].join("\n"), expectedPhrase);

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
    score,
    passed: score.pass,
  };
}

async function createFreshRoom(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  expect(page.url(), "SpreadsheetBench prod adapter must not use memory mode").not.toContain("mode=memory");
  await page.getByTestId("create-room").click({ timeout: 60_000 });
  const displayName = page.getByTestId("create-display-name");
  if (await displayName.isVisible().catch(() => false)) await displayName.fill("Proof Loop");
  await page.getByTestId("create-room-submit").click({ timeout: 30_000 });
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 60_000 });
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
  const fileInput = page.locator(".r-file-input");
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

async function invokeNodeAgent(page: Page, prompt: string, expectedPhrase: string): Promise<void> {
  const composer = page.locator('textarea[data-testid="chat-composer"]').first();
  await expect(composer).toBeVisible({ timeout: 30_000 });
  const agentMessages = page.locator('[data-testid="chat-message"].agent');
  const agentMessageCountBefore = await agentMessages.count().catch(() => 0);
  const streams = page.locator('[data-testid="agent-unified-stream"]');
  const streamCountBefore = await streams.count().catch(() => 0);
  await composer.fill(prompt);
  await page.getByTestId("chat-send").click({ timeout: 30_000 });
  await expect(page.getByTestId("chat-message").filter({ hasText: prompt.slice(0, 80) }).last())
    .toBeVisible({ timeout: 30_000 });

  await expect.poll(async () => {
    const status = await quickText(page.getByTestId("job-status").first(), 500);
    const agentMessageCount = await agentMessages.count().catch(() => 0);
    const streamCount = await streams.count().catch(() => 0);
    return /queued|running/i.test(status) || agentMessageCount > agentMessageCountBefore || streamCount > streamCountBefore ? 1 : 0;
  }, {
    message: "a fresh NodeAgent job or stream must appear after the prompt is sent",
    timeout: 90_000,
    intervals: [1000, 2000, 5000],
  }).toBe(1);

  const deadline = Date.now() + AGENT_TIMEOUT_MS;
  let lastText = "";
  let sawFreshAgentOutput = false;
  while (Date.now() < deadline) {
    const status = await quickText(page.getByTestId("job-status").first(), 1000);
    const latestAgentMessage = await quickText(agentMessages.last(), 1000);
    const latestStream = await quickText(streams.last(), 1000);
    const agentMessageCount = await agentMessages.count().catch(() => 0);
    const streamCount = await streams.count().catch(() => 0);
    sawFreshAgentOutput = sawFreshAgentOutput
      || agentMessageCount > agentMessageCountBefore
      || streamCount > streamCountBefore
      || latestStream.length > 0;
    lastText = `${status}\n${latestAgentMessage}\n${latestStream}`.slice(-2000);
    if (sawFreshAgentOutput && /\b(failed|blocked|cancelled)\b/i.test(status)) throw new Error(`NodeAgent failed: ${lastText}`);
    if (new RegExp(escapeRegex(expectedPhrase), "i").test(`${latestAgentMessage}\n${latestStream}`) || (sawFreshAgentOutput && /\b(completed|done)\b/i.test(status))) {
      await expect.poll(async () => page.locator(".r-cell.locked").count(), { timeout: 60_000 }).toBe(0);
      return;
    }
    await page.waitForTimeout(2000);
  }
  throw new Error(`Timed out waiting for NodeAgent completion. Last text: ${lastText}`);
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

async function quickText(locator: ReturnType<Page["locator"]>, timeout = 250): Promise<string> {
  return ((await locator.textContent({ timeout }).catch(() => "")) ?? "");
}

function isIgnoredConsoleProblem(text: string | undefined): boolean {
  return Boolean(text) && /favicon|Download the React DevTools/i.test(text);
}
