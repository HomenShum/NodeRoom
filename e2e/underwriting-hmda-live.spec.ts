import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { enableFocusModeForTest, expectAttentionOverlayMounted, expectFocusModeOn } from "./focusMode";
import { createScratchSheetFromStarterHome } from "./liveStarter";

const BASE = process.env.BENCH_BASE_URL ?? "https://noderoom.live";
const PACKET_ROOT = resolve(process.env.UNDERWRITING_PACKET_ROOT ?? ".tmp/underwriting-hmda-dc-2025/live-packet");
const PROOF_PATH = resolve(process.env.UNDERWRITING_LIVE_PROOF_PATH ?? "docs/eval/underwriting-hmda-live-browser-proof.json");
const AGENT_COMPLETION_TIMEOUT_MS = Number(process.env.UNDERWRITING_AGENT_COMPLETION_TIMEOUT_MS ?? 15 * 60_000);
const TEST_TIMEOUT_MS = Number(
  process.env.UNDERWRITING_TEST_TIMEOUT_MS ?? Math.max(8 * 60_000, AGENT_COMPLETION_TIMEOUT_MS + 4 * 60_000),
);
const PASS_ACCURACY = Number(process.env.UNDERWRITING_PASS_ACCURACY ?? 0.6);

const FEATURE_CSV = resolve(PACKET_ROOT, "hmda_dc_2025_purchase_features.csv");
const TASK_MD = resolve(PACKET_ROOT, "hmda_dc_2025_underwriting_task.md");
const SOURCE_MANIFEST_MD = resolve(PACKET_ROOT, "hmda_dc_2025_source_manifest.md");
const PACKET_MANIFEST = resolve(PACKET_ROOT, "packet-manifest.json");
const ANSWER_KEY = resolve(PACKET_ROOT, "hmda_dc_2025_purchase_answer_key.local.json");

type AnswerLabel = {
  application_id: string;
  action_taken: 1 | 3;
  label: "originated" | "denied";
  source_row_number: number;
};

type SheetRow = {
  row: number;
  application_id: string;
  predicted_action_taken: string;
  predicted_label: string;
  confidence: string;
  brief_reason: string;
};

const PROMPT =
  "@nodeagent In this fresh live Noderoom room, use the uploaded file hmda_dc_2025_purchase_features.csv " +
  "and the uploaded task note. The hidden local answer key is NOT uploaded. This is a retrospective HMDA " +
  "benchmark, not a real lending decision. Predict each application's HMDA action_taken using only " +
  "allowed values 1=loan originated and 3=application denied. Write Sheet 1 with exactly these columns: " +
  "application_id, predicted_action_taken, predicted_label, confidence, brief_reason. Use one row per " +
  "application_id from the uploaded CSV. The uploaded task note gives the risk-signal rule: low DTI, low LTV, " +
  "and strong income lean originated; very high DTI, very high LTV, or low income lean denied. The packet has only " +
  "10 rows, so use compact reads and write the output table; do not burn the run on broad background research. " +
  "Do not just explain in chat; actually write the table into Sheet 1.";

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function ensurePacketReady() {
  const required = [FEATURE_CSV, TASK_MD, SOURCE_MANIFEST_MD, PACKET_MANIFEST, ANSWER_KEY];
  if (required.every((path) => existsSync(path))) return;
  if (process.env.UNDERWRITING_PACKET_ROOT) {
    throw new Error(`Missing underwriting packet files under custom UNDERWRITING_PACKET_ROOT=${PACKET_ROOT}`);
  }
  const script = resolve("scripts/underwriting-hmda-live-packet.mjs");
  const result = spawnSync(process.execPath, [script], { cwd: resolve("."), encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`Failed to generate HMDA underwriting packet.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
}

function publicChat(page: Page) {
  return page.getByTestId("public-chat-panel");
}

async function ensureBinderOpen(page: Page): Promise<void> {
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click({ timeout: 30_000 });
  }
  await expect(leftRail).toBeVisible({ timeout: 30_000 });
}

async function openFreshLiveSheet(page: Page): Promise<void> {
  await enableFocusModeForTest(page);
  await page.addInitScript(() => {
    window.localStorage.setItem("noderoom.nodeagentRuntimeProfile", "benchmark_completion");
  });
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  expect(page.url(), "underwriting proof must start from live landing, not memory mode").not.toContain("mode=memory");
  await page.getByTestId("create-room").click({ timeout: 60_000 });
  await page.getByTestId("create-room-submit").waitFor({ state: "visible", timeout: 10_000 });
  await page.getByTestId("create-room-submit").click();
  await createScratchSheetFromStarterHome(page);
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 30_000 });
  await expectFocusModeOn(page);
  await expectAttentionOverlayMounted(page);
}

async function readPredictions(page: Page): Promise<SheetRow[]> {
  return page.evaluate(() => {
    const text = (cell: Element | null): string => {
      if (!cell) return "";
      const clone = cell.cloneNode(true) as HTMLElement;
      clone
        .querySelectorAll(".r-srcchip,.lockbadge,.presencebadge,[class*='presence'],[aria-label*='version history'],button")
        .forEach((node) => node.remove());
      return (clone.textContent ?? "")
        .replace(/\bRoom NodeAgent\b/g, "")
        .replace(/\bCell version history\b/g, "")
        .replace(/\s+/g, " ")
        .replace(/^[-–]\s*/, "")
        .trim();
    };
    const visibleSheet = [...document.querySelectorAll<HTMLElement>('[data-testid="sheet-grid"]')]
      .find((grid) => grid.offsetParent !== null);
    const rows: SheetRow[] = [];
    if (visibleSheet) {
      const tableRows = [...visibleSheet.querySelectorAll("tbody tr")];
      for (const [index, tr] of tableRows.entries()) {
        const cells = [...tr.querySelectorAll("td")].slice(1, 6);
        const [id, action, label, confidence, reason] = cells.map((cell) => text(cell));
        if (id || action || label || confidence || reason) {
          rows.push({
            row: index + 1,
            application_id: id,
            predicted_action_taken: action,
            predicted_label: label,
            confidence,
            brief_reason: reason,
          });
        }
      }
      return rows;
    }
    for (let i = 1; i <= 80; i += 1) {
      const id = text(document.querySelector(`[data-element-id="r${i}__A"]`));
      const action = text(document.querySelector(`[data-element-id="r${i}__B"]`));
      const label = text(document.querySelector(`[data-element-id="r${i}__C"]`));
      const confidence = text(document.querySelector(`[data-element-id="r${i}__D"]`));
      const reason = text(document.querySelector(`[data-element-id="r${i}__E"]`));
      if (id || action || label || confidence || reason) {
        rows.push({
          row: i,
          application_id: id,
          predicted_action_taken: action,
          predicted_label: label,
          confidence,
          brief_reason: reason,
        });
      }
    }
    return rows;
  });
}

async function activateSheet1(page: Page) {
  await page.getByTestId("binder-artifact").filter({ hasText: "Sheet 1" }).first().click({ timeout: 30_000 });
  const sheetTab = page.getByRole("button", { name: /^Sheet 1\b.*Close Sheet 1$/ }).first();
  if (await sheetTab.isVisible().catch(() => false)) {
    await sheetTab.click();
  }
  await expect(page.getByTestId("sheet-grid").first()).toBeVisible({ timeout: 30_000 });
}

function parsePrediction(row: SheetRow): 1 | 3 | null {
  const combined = `${row.predicted_action_taken} ${row.predicted_label}`.toLowerCase();
  if (/\b3\b/.test(combined) || /denied|declin|reject|not approved/.test(combined)) return 3;
  if (/\b1\b/.test(combined) || /originated|approve|approved|accepted/.test(combined)) return 1;
  return null;
}

function scoreRows(rows: SheetRow[], labels: AnswerLabel[]) {
  const key = new Map(labels.map((label) => [label.application_id, label]));
  const predictions = [];
  const seen = new Set<string>();
  let correct = 0;
  let incorrect = 0;
  let unparseable = 0;
  const confusion = {
    originated_as_originated: 0,
    originated_as_denied: 0,
    denied_as_originated: 0,
    denied_as_denied: 0,
  };

  for (const row of rows) {
    const id = row.application_id.trim();
    if (!key.has(id) || seen.has(id)) continue;
    seen.add(id);
    const actual = key.get(id)!;
    const predicted = parsePrediction(row);
    if (predicted == null) {
      unparseable += 1;
    } else if (predicted === actual.action_taken) {
      correct += 1;
    } else {
      incorrect += 1;
    }
    if (predicted === 1 && actual.action_taken === 1) confusion.originated_as_originated += 1;
    if (predicted === 3 && actual.action_taken === 1) confusion.originated_as_denied += 1;
    if (predicted === 1 && actual.action_taken === 3) confusion.denied_as_originated += 1;
    if (predicted === 3 && actual.action_taken === 3) confusion.denied_as_denied += 1;
    predictions.push({ ...row, predicted, actual: actual.action_taken, actual_label: actual.label });
  }

  const missing = labels.filter((label) => !seen.has(label.application_id)).map((label) => label.application_id);
  const attempted = correct + incorrect + unparseable;
  const accuracy = labels.length === 0 ? 0 : correct / labels.length;
  const attemptedAccuracy = attempted === 0 ? 0 : correct / attempted;
  return {
    n: labels.length,
    matchedRows: seen.size,
    attempted,
    correct,
    incorrect,
    unparseable,
    missing,
    accuracy,
    attemptedAccuracy,
    confusion,
    predictions,
  };
}

function outputRowsComplete(score: ReturnType<typeof scoreRows>): boolean {
  return score.matchedRows === score.n
    && score.unparseable === 0
    && score.predictions.length === score.n
    && score.predictions.every((row) =>
      row.predicted_label.trim().length > 0
      && /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(row.confidence.trim())
      && row.brief_reason.trim().length > 0);
}

function writeProof(path: string, proof: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(proof, null, 2)}\n`);
}

function artifactTitlePattern(file: string): RegExp {
  const stem = basename(file).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
  return new RegExp(stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const shotPath = testInfo.outputPath(name);
  await page.screenshot({ path: shotPath, fullPage: false });
  await testInfo.attach(name, { path: shotPath, contentType: "image/png" });
  return shotPath;
}

test("fresh live room: upload withheld-label HMDA packet -> @nodeagent -> score underwriting decisions", async ({ page }, testInfo) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  ensurePacketReady();
  const answerKey = readJson<{ labels: AnswerLabel[] }>(ANSWER_KEY);
  const packetManifest = readJson<Record<string, unknown>>(PACKET_MANIFEST);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (err) => pageErrors.push(String(err.message ?? err)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await openFreshLiveSheet(page);
  await ensureBinderOpen(page);

  const fileInput = page.locator(".r-file-input");
  await fileInput.waitFor({ state: "attached", timeout: 30_000 });
  await fileInput.setInputFiles([FEATURE_CSV, TASK_MD, SOURCE_MANIFEST_MD]);
  for (const file of [FEATURE_CSV, TASK_MD, SOURCE_MANIFEST_MD]) {
    await expect(page.getByTestId("binder-artifact").filter({ hasText: artifactTitlePattern(file) }).first()).toBeVisible({ timeout: 45_000 });
  }

  await activateSheet1(page);

  const preset = page.locator('[data-testid="chat-model-preset"]').first();
  if (await preset.isVisible().catch(() => false)) {
    await preset.selectOption(process.env.BENCH_AGENT_MODEL_MODE ?? "adaptive");
  }

  const chat = publicChat(page);
  await chat.getByTestId("chat-composer").fill(PROMPT, { timeout: 30_000 });
  await chat.getByTestId("chat-send").click();
  const chatMessageVisible = await chat
    .getByTestId("chat-message")
    .filter({ hasText: "hmda_dc_2025_purchase_features.csv" })
    .first()
    .waitFor({ state: "visible", timeout: 20_000 })
    .then(() => true)
    .catch(() => false);

  let jobStatus = "";
  const jobStatusVisible = await chat
    .getByTestId("job-status")
    .first()
    .waitFor({ state: "visible", timeout: 60_000 })
    .then(() => true)
    .catch(() => false);

  const start = Date.now();
  let rows = await readPredictions(page);
  let score = scoreRows(rows, answerKey.labels);
  let jobStatusTexts: string[] = [];
  let terminalObservedAt: number | undefined;
  let completeOutputObservedAt: number | undefined;
  while (Date.now() - start < AGENT_COMPLETION_TIMEOUT_MS) {
    rows = await readPredictions(page);
    score = scoreRows(rows, answerKey.labels);
    jobStatusTexts = (await chat.getByTestId("job-status").allInnerTexts().catch(() => []))
      .map((text) => text.trim())
      .filter(Boolean);
    jobStatus = jobStatusTexts.join(" | ");
    if (outputRowsComplete(score)) completeOutputObservedAt ??= Date.now();
    if (completeOutputObservedAt && (Date.now() - completeOutputObservedAt > 5_000 || /completed/i.test(jobStatus))) break;
    if (/completed|failed|blocked|cancelled/i.test(jobStatus)) {
      terminalObservedAt ??= Date.now();
      if (Date.now() - terminalObservedAt > 30_000) break;
    }
    await page.waitForTimeout(5_000);
  }

  const screenshotPath = await screenshot(page, testInfo, "underwriting-hmda-live-sheet.png");
  const passed =
    jobStatusVisible &&
    pageErrors.length === 0 &&
    outputRowsComplete(score) &&
    score.matchedRows === answerKey.labels.length &&
    score.unparseable === 0 &&
    score.accuracy >= PASS_ACCURACY;
  const proof = {
    schema: 1,
    generatedAt: new Date().toISOString(),
    task: "hmda-dc-2025-action-taken-underwriting-decision",
    baseUrl: BASE,
    roomUrl: page.url(),
    memoryMode: page.url().includes("mode=memory"),
    prompt: PROMPT,
    uploadedFiles: [FEATURE_CSV, TASK_MD, SOURCE_MANIFEST_MD],
    localOnlyAnswerKey: ANSWER_KEY,
    packetManifest,
    model: {
      requested: process.env.BENCH_AGENT_MODEL_MODE ?? "adaptive",
      runtimeProfile: "benchmark_completion",
    },
    liveSignals: {
      chatMessageVisible,
      jobStatusVisible,
      jobStatus,
      jobStatusTexts,
      outputRowsComplete: outputRowsComplete(score),
      pageErrors,
      consoleErrors: consoleErrors.slice(0, 20),
      screenshotPath,
    },
    scoring: {
      method: "withheld local answer key against live Sheet 1 cells",
      passAccuracy: PASS_ACCURACY,
      ...score,
    },
    passed,
  };
  writeProof(PROOF_PATH, proof);
  const runProofPath = testInfo.outputPath("underwriting-hmda-live-proof.json");
  writeProof(runProofPath, proof);
  await testInfo.attach("underwriting-hmda-live-proof", { path: runProofPath, contentType: "application/json" });

  expect(page.url(), "must not route into memory mode").not.toContain("mode=memory");
  expect(passed, `HMDA underwriting live proof failed; receipt: ${PROOF_PATH}`).toBe(true);
});
