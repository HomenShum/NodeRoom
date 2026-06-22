/**
 * ui-benchmark-drive.spec.ts — drive a real benchmark task through the live NodeRoom UI.
 *
 * This Playwright spec is parameterized by env vars so the same harness can be reused for
 * multiple models / tasks / rubrics:
 *
 *   MODEL_ID          : the OpenRouter model id (informational only — the in-app memory-mode
 *                       agent is a deterministic scripted harness; the field is used solely
 *                       for the screenshot filename + the PASS/FAIL diagnostic line).
 *   TASK_PROMPT       : the literal text typed into chat-composer. MUST start with
 *                       "@nodeagent " or the public lane will route to chat-only (no agent).
 *                       Default: "@nodeagent recompute the Q3 variance row".
 *   EXPECTED_VALUES   : JSON, e.g. {"r_rev__variance":{"value":"+24%","tol":0},
 *                                   "r_cogs__variance":{"value":"+27.5%","tol":0}}.
 *                       Values are strings (the variance cells render textual percentages).
 *                       Numeric expected values are also supported via a numeric parse + tol.
 *   PLAYWRIGHT_BASE_URL : where to drive (defaults to the running preview).
 *
 * Per the investigation, the simplest in-app exercise of the live runAgent runtime in
 * memory mode is the Q3 variance recompute — store.askAgent() at src/app/store.tsx:668
 * gates on isVarianceSheet() and ONLY produces real cell mutations for that seeded sheet.
 * The spec is structured so NB-01-style benchmarks can re-use the same harness once that
 * wiring lands — just change TASK_PROMPT + EXPECTED_VALUES and point artifactCellSelector
 * at the new sheet's cell keys.
 *
 * The spec drives the REAL UI. It does not mock store.askAgent — the click path:
 *
 *   textarea[data-testid="chat-composer"]  -> button[data-testid="chat-send"]
 *     -> Chat.tsx:645 send() -> parsePublicNodeAgentRequest -> store.askAgent
 *     -> runHarness({ rt: InMemoryRoomTools, model: scriptedModel(recomputeVariancePlan...) })
 *     -> CAS writes to td[data-testid="sheet-cell"][data-cell-key="r_rev__variance"] (etc.)
 *
 * which is the same orchestrator surface (scripted-model variant) that the out-of-app
 * nonbtb runner exercises through src/nodeagent/index. The Convex lane uses the same
 * Chat.tsx:671 entry, so wiring this spec to a Convex-backed test deployment is a
 * one-flag change once provider keys are available in CI.
 */
import { test, expect, type Page, type Locator } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// --- Parameterisation (env-driven so the harness is reusable) ---------------------------------

const MODEL_ID = process.env.MODEL_ID || "z-ai/glm-5.2";
const DEFAULT_TASK_PROMPT = "@nodeagent recompute the Q3 variance row";
const TASK_PROMPT = process.env.TASK_PROMPT || DEFAULT_TASK_PROMPT;

type ExpectedSpec = { value: string | number; tol?: number };
type ExpectedMap = Record<string, ExpectedSpec>;

const DEFAULT_EXPECTED: ExpectedMap = {
  r_rev__variance: { value: "+24%", tol: 0 },
  r_cogs__variance: { value: "+27.5%", tol: 0 },
  r_gp__variance: { value: "+21.7%", tol: 0 },
  r_ni__variance: { value: "+22.4%", tol: 0 },
};

function parseExpected(): ExpectedMap {
  const raw = process.env.EXPECTED_VALUES;
  if (!raw) return DEFAULT_EXPECTED;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as ExpectedMap;
  } catch (err) {
    console.warn(`[ui-benchmark-drive] EXPECTED_VALUES is not valid JSON, falling back to defaults: ${(err as Error).message}`);
  }
  return DEFAULT_EXPECTED;
}
const EXPECTED_VALUES: ExpectedMap = parseExpected();

const SCREENSHOT_DIR = resolve(__dirname, ".artifacts");
const screenshotSlug = MODEL_ID.replace(/[^a-z0-9._-]+/gi, "_");
const SCREENSHOT_PATH = resolve(SCREENSHOT_DIR, `ui-benchmark-drive-${screenshotSlug}.png`);

mkdirSync(SCREENSHOT_DIR, { recursive: true });

// --- Helpers ----------------------------------------------------------------------------------

/** Compare a rendered cell value against an expected entry, with tolerance for numeric values. */
function matchesExpected(rendered: string, spec: ExpectedSpec): { ok: boolean; reason: string } {
  const expected = spec.value;
  const tol = spec.tol ?? 0;
  const trimmed = (rendered ?? "").trim();
  if (typeof expected === "string") {
    const e = expected.trim();
    if (tol === 0) {
      return trimmed === e
        ? { ok: true, reason: `match: "${trimmed}" === "${e}"` }
        : { ok: false, reason: `mismatch: rendered "${trimmed}" !== expected "${e}"` };
    }
    // String with tolerance: parse percent / number and compare numerically.
    const renderedNum = Number(trimmed.replace(/[+%\s]/g, ""));
    const expectedNum = Number(e.replace(/[+%\s]/g, ""));
    if (Number.isFinite(renderedNum) && Number.isFinite(expectedNum)) {
      const diff = Math.abs(renderedNum - expectedNum);
      return diff <= tol
        ? { ok: true, reason: `numeric-string match: |${renderedNum}-${expectedNum}|=${diff.toFixed(3)} <= tol ${tol}` }
        : { ok: false, reason: `numeric-string mismatch: |${renderedNum}-${expectedNum}|=${diff.toFixed(3)} > tol ${tol}` };
    }
    return { ok: false, reason: `cannot compare with tolerance (non-numeric): rendered "${trimmed}" vs expected "${e}"` };
  }
  // numeric expected
  const renderedNum = Number(trimmed.replace(/[+%\s]/g, ""));
  if (!Number.isFinite(renderedNum)) return { ok: false, reason: `rendered "${trimmed}" is not numeric` };
  const diff = Math.abs(renderedNum - Number(expected));
  return diff <= tol
    ? { ok: true, reason: `numeric match: |${renderedNum}-${expected}|=${diff.toFixed(3)} <= tol ${tol}` }
    : { ok: false, reason: `numeric mismatch: |${renderedNum}-${expected}|=${diff.toFixed(3)} > tol ${tol}` };
}

async function readCellText(page: Page, key: string): Promise<string> {
  const cell = page.locator(`[data-cell-key="${key}"]`).first();
  if (!(await cell.count())) return "";
  // Prefer inner cell-edit-control's data-cell-value when present (the canonical truth),
  // fall back to textContent for cells without an edit control.
  const controlVal = await cell.locator("[data-cell-value]").first().getAttribute("data-cell-value").catch(() => null);
  if (controlVal !== null && controlVal !== undefined) return controlVal;
  return (await cell.textContent())?.trim() ?? "";
}

/** Wait for a cell to satisfy the expected spec, with a generous polling timeout. */
async function waitForCell(page: Page, key: string, spec: ExpectedSpec, timeoutMs: number): Promise<{ ok: boolean; rendered: string; reason: string }> {
  let last = "";
  let lastReason = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    last = await readCellText(page, key);
    const m = matchesExpected(last, spec);
    if (m.ok) return { ok: true, rendered: last, reason: m.reason };
    lastReason = m.reason;
    await page.waitForTimeout(500);
  }
  return { ok: false, rendered: last, reason: `timeout after ${timeoutMs}ms — last rendered "${last}" (${lastReason})` };
}

/** Memory-mode landing flow: set display name, click start-demo-room. */
async function enterDemoRoomMemoryMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* noop */ }
  });
  await page.goto("/?mode=memory", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.setItem("noderoom:tour:v1", "done"); } catch { /* noop */ } });
  const artifactPanel = page.getByTestId("artifact-panel");
  const alreadyIn = await artifactPanel.waitFor({ state: "visible", timeout: 1_500 }).then(() => true, () => false);
  if (!alreadyIn) {
    const nameInput = page.getByTestId("display-name");
    if (await nameInput.count()) {
      await nameInput.fill("Bench");
    }
    const startBtn = page.getByTestId("start-demo-room");
    await expect(startBtn).toBeVisible({ timeout: 15_000 });
    await startBtn.click();
  }
  await expect(artifactPanel).toBeVisible({ timeout: 20_000 });
}

/** Open the Q3 variance sheet — the only artifact that exercises live recompute in memory mode. */
async function openVarianceSheet(page: Page): Promise<Locator> {
  const panel = page.getByTestId("artifact-panel");

  // Cheapest path: the work-surface tab bar already exposes a file-tab per open artifact.
  // The demo room opens Capture Notebook by default; we just click the Q3 variance tab.
  const fileTab = panel.getByTestId("artifact-filetab").filter({ hasText: /Q3 variance/i }).first();
  if (await fileTab.count()) {
    await fileTab.click();
  } else {
    // Fallback: open the Binder rail and click the artifact entry from there.
    const toggleBinder = page.getByRole("button", { name: "Toggle Room Binder panel" });
    if (await toggleBinder.count()) {
      await toggleBinder.click();
    }
    const leftRail = page.getByTestId("left-rail");
    await expect(leftRail).toBeVisible({ timeout: 5_000 });
    const link = leftRail.getByRole("button", { name: /Q3 variance/i }).first();
    await expect(link).toBeVisible({ timeout: 5_000 });
    await link.click();
  }

  await expect(panel.locator('[data-cell-key="r_rev__variance"]').first()).toBeVisible({ timeout: 20_000 });
  return panel;
}

// --- The spec ---------------------------------------------------------------------------------

test.describe(`ui-benchmark-drive [${MODEL_ID}]`, () => {
  test.setTimeout(120_000);

  test("drives the live NodeRoom agent through the public @nodeagent lane and verifies cell outputs", async ({ page }) => {
    const diagnostics: string[] = [];
    const push = (line: string) => { diagnostics.push(line); console.log(`[ui-benchmark-drive] ${line}`); };

    push(`MODEL_ID=${MODEL_ID}`);
    push(`TASK_PROMPT=${TASK_PROMPT}`);
    push(`EXPECTED_VALUES=${JSON.stringify(EXPECTED_VALUES)}`);

    // (a) goto memory-mode landing + (b)/(c) wait for the canonical work surface.
    await enterDemoRoomMemoryMode(page);
    push("entered demo room (memory mode)");

    const panel = await openVarianceSheet(page);
    void panel;
    push("opened Q3 variance sheet");

    // (d) Type the prompt into the public-lane composer.
    const chat = page.getByTestId("public-chat-panel");
    await expect(chat).toBeVisible({ timeout: 10_000 });
    const composer = chat.getByTestId("chat-composer");
    await expect(composer).toBeVisible();
    await composer.fill(TASK_PROMPT);
    push(`filled composer (len=${TASK_PROMPT.length})`);

    // Sanity: the public-lane agent only runs when the message starts with "@nodeagent ".
    if (!TASK_PROMPT.trim().startsWith("@nodeagent")) {
      push(`WARNING: TASK_PROMPT does not start with "@nodeagent " — the public lane will not invoke the agent (Chat.tsx:213 parsePublicNodeAgentRequest)`);
    }

    // (e) Trigger send via the literal send button (Enter would also work; we use the click
    // path because that is the production user gesture).
    const sendBtn = chat.getByTestId("chat-send");
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();
    push("clicked chat-send");

    // (f) Wait for the response surface to populate. We watch for BOTH:
    //   - an agent message bubble in the chat feed (Chat.tsx:1342 — proves the orchestrator returned)
    //   - the expected cell values on the sheet (proves the CAS writes actually flushed)
    // The investigation warns the message can land before the cell flush, so we wait on
    // the cell values as the load-bearing signal.
    const responseSurface = chat.getByTestId("chat-feed");
    await expect(responseSurface).toBeVisible();

    // Wait for any agent reply to settle (informational — failure here is a useful diagnostic
    // but is NOT the gating signal; the cell check is).
    const agentBubble = chat.locator('[data-testid="chat-message"].agent, [data-testid="chat-message"][class*="agent"]').last();
    await agentBubble.waitFor({ state: "visible", timeout: 60_000 }).catch(() => {
      push("note: no agent bubble visible within 60s — falling through to cell check");
    });
    const agentCount = await chat.locator('[data-testid="chat-message"]').count();
    push(`chat-message count after send: ${agentCount}`);

    // (g) Read the cells listed in EXPECTED_VALUES and (h) compare with tolerance.
    const cellResults: Array<{ key: string; ok: boolean; rendered: string; reason: string }> = [];
    for (const [key, spec] of Object.entries(EXPECTED_VALUES)) {
      const out = await waitForCell(page, key, spec, 60_000);
      cellResults.push({ key, ...out });
      push(`cell ${key}: rendered="${out.rendered}" ok=${out.ok} (${out.reason})`);
    }

    // (i) Screenshot the full page state to tests/.artifacts/ui-benchmark-drive-MODEL.png.
    try {
      await page.screenshot({ path: SCREENSHOT_PATH, fullPage: true });
      push(`screenshot saved: ${SCREENSHOT_PATH}`);
    } catch (err) {
      push(`screenshot failed: ${(err as Error).message}`);
    }

    // (j) PASS / FAIL with explicit reason — write a structured summary to stdout so the
    // orchestrating shell can pick it up.
    const failed = cellResults.filter((r) => !r.ok);
    const summary = {
      model: MODEL_ID,
      prompt: TASK_PROMPT,
      expected: EXPECTED_VALUES,
      cells: cellResults,
      screenshot: SCREENSHOT_PATH,
      verdict: failed.length === 0 ? "PASS" : "FAIL",
      reason:
        failed.length === 0
          ? `all ${cellResults.length} expected cells matched within tolerance`
          : `${failed.length}/${cellResults.length} cells did not match: ${failed.map((f) => `${f.key}=${f.rendered}`).join("; ")}`,
    };
    console.log(`UI_BENCHMARK_DRIVE_RESULT ${JSON.stringify(summary)}`);

    // Hard-fail the Playwright run if any expected cell missed — the shell needs an
    // honest exit code, not a swallowed assertion.
    expect(failed, summary.reason).toEqual([]);
  });
});
