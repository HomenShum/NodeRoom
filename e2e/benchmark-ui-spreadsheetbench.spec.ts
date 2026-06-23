/**
 * SpreadsheetBench live-browser fresh-room contract — the fullest HONEST version of the 7-step
 * benchmark UI contract that NodeRoom's CURRENT live affordances can support end-to-end today.
 *
 * The 7-step contract is: fresh room -> import held-out task -> ask @nodeagent the literal prompt ->
 * wait on a DOM signal + a durable Convex job (no sleep) -> export/download the deliverable bytes ->
 * grade with the official/golden scorer on those bytes -> write a ledger row whose `passed` is
 * DERIVED from the receipts. NodeRoom honestly supports 6 of the 7 today; this spec runs every one
 * it can and is explicit about the one it cannot:
 *
 *   1. FRESH ROOM      — real. create-room (live Convex) -> blank-cta-sheet. A new room every run.
 *   2. IMPORT          — real. The actual nb-01 SOURCE FILES (source_financials.csv,
 *                        source_shares.txt) are uploaded through the live LeftRail `.r-file-input`
 *                        (the same affordance e2e/excel-grid.spec.ts proves end-to-end). The figures
 *                        are NOT inlined in the prompt — the agent must read them from the imported
 *                        artifacts.
 *   3. ASK             — real. A leading "@nodeagent ..." through the public composer routes to
 *                        store.askAgent -> startPublicAskJob, the cheap adaptive/free OpenRouter route
 *                        (the Convex proxy holds the key; AGENT_MODEL=z-ai/glm-5.2). The preset is
 *                        asserted to be the cheap route — the test fails loudly if a flagship is pinned.
 *   4. WAIT            — real. We poll the rendered grid by stable r<row>__<col> data-element-ids AND
 *                        assert a durable job-status chip appears (the server-side admission receipt).
 *                        No sleep; every wait is on a real signal.
 *   5. EXPORT          — HONEST SUBSTITUTE (documented). The live desktop room has NO sheet->.xlsx
 *                        download (docs/eval/OFFICIAL_BENCHMARK_UI_COVERAGE.md confirms every
 *                        deliverable_export_download gate is 'missing'; the mobile button is a fake
 *                        toast). So instead of downloading a file, we read the deliverable the agent
 *                        ACTUALLY produced — the cells it wrote into the live grid — and grade THOSE.
 *                        This is cell-read grading, not file-export grading; both are honest because
 *                        the scorer runs on the agent's real output, not a hardcoded seed.
 *   6. OFFICIAL SCORER — real. The cells the agent wrote are fed to the deterministic, self-tested
 *                        gradeGolden() (src/benchmarks/golden/grader.ts — a faithful TS port of
 *                        docs/eval/nonbtb/grade.py with correctness + fabrication anti-cheat
 *                        dimensions). The grade is asserted >= pass. In the SAME run we also assert
 *                        gradeGolden accepts the golden-good fixture (1.0) and REJECTS a golden-bad
 *                        fixture, so the scorer's anti-cheat dimensions are exercised, not just trusted.
 *   7. LEDGER          — real. On a genuine pass the spec writes a proof receipt to
 *                        docs/eval/spreadsheetbench-live-room-proof.json. The coverage ledger
 *                        (src/eval/officialBenchmarkUiCoverage.ts) reads THAT receipt; it only flips
 *                        the gates the receipt proves. No receipt -> the row stays 'missing'.
 *
 * Anti-cheat substrate (this is the product, not the build):
 *   - assertNotCheating(): the expected values must NOT equal the scripted demoRoom variance seed.
 *   - The grade is computed from the cells the agent wrote LIVE through the cheap OpenRouter route
 *     (a real model call, real tokens, real $ in the room trace) — never a memory-mode scripted plan.
 *     The spec hard-fails if it detects ?mode=memory.
 *   - The ledger `passed` is DERIVED from the on-disk receipt this run wrote, not hardcoded.
 *
 * Run (requires the live Convex-connected dev server; the proxy holds the OpenRouter key):
 *   1) npm run dev                       # dev server at :5273, VITE_CONVEX_URL set
 *   2) BENCH_BASE_URL=http://localhost:5273 \
 *        npx playwright test --config playwright.real-flow.config.ts \
 *        e2e/benchmark-ui-spreadsheetbench.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gradeGolden, type GoldenRubric, type GoldenOutputs } from "../src/benchmarks/golden/grader";
import {
  SPREADSHEETBENCH_LIVE_ROOM_PROOF_PATH,
  type SpreadsheetBenchLiveRoomProof,
} from "../src/eval/officialBenchmarkUiCoverage";

const BASE = process.env.BENCH_BASE_URL ?? "http://localhost:5273";

// ── nb-01 golden rubric (mirrored from src/benchmarks/nonbtb/nb-01-company-profile/rubric.json;
//    kept honest by tests/goldenDataset.test.ts). Inlined because Playwright's ESM loader rejects a
//    bare JSON import, and src/benchmarks/golden/dataset.ts uses import.meta.glob (Vite-only). ──────
const NB01_TASK = "nb-01-company-profile";
const ALLOWED_KEYS = ["revenue_growth_pct", "gross_margin_2024", "gross_margin_2025", "eps_2024", "eps_2025"];
const EXPECTED: Record<string, { value: number; tol?: number }> = {
  revenue_growth_pct: { value: 25.0, tol: 0.1 },
  gross_margin_2024: { value: 40.0, tol: 0.1 },
  gross_margin_2025: { value: 44.0, tol: 0.1 },
  eps_2024: { value: 2.4, tol: 0.01 },
  eps_2025: { value: 3.5, tol: 0.01 },
};
const KEYS = Object.keys(EXPECTED);

// The official 4-dimension nb-01 rubric (value + formula + citation) — used for the IN-RUN scorer
// self-test against the bundled good/bad fixtures, so the anti-cheat dimensions are exercised live.
const NB01_RUBRIC_FULL: GoldenRubric = {
  task: NB01_TASK,
  deliverable: "company_profile.xlsx",
  allowed_keys: ALLOWED_KEYS,
  expected: EXPECTED,
  formula_required: true,
  citations_required: true,
  sources: ["source_financials.csv", "source_shares.txt"],
};
// Known-good and known-bad fixtures (mirrored from src/benchmarks/nonbtb/_selftest_{good,bad}/nb-01).
const NB01_GOOD: GoldenOutputs = {
  revenue_growth_pct: { value: 25.0, formula: "=(B3-B2)/B2*100", cite: { file: "source_financials.csv", locator: "revenue 2024,2025" } },
  gross_margin_2024: { value: 40.0, formula: "=(B2-C2)/B2*100", cite: { file: "source_financials.csv", locator: "row 2024" } },
  gross_margin_2025: { value: 44.0, formula: "=(B3-C3)/B3*100", cite: { file: "source_financials.csv", locator: "row 2025" } },
  eps_2024: { value: 2.4, formula: "=D2/E2", cite: { file: "source_shares.txt", locator: "shares" } },
  eps_2025: { value: 3.5, formula: "=D3/E2", cite: { file: "source_shares.txt", locator: "shares" } },
};
const NB01_BAD: GoldenOutputs = {
  // hardcoded literals (no formula), one wrong value, and a fabricated key + bad citation
  revenue_growth_pct: { value: 25.0, cite: { file: "source_financials.csv" } },
  gross_margin_2024: { value: 99.0, formula: "=(B2-C2)/B2*100", cite: { file: "source_financials.csv" } },
  gross_margin_2025: { value: 44.0, cite: { file: "made_up.csv" } },
  eps_2024: { value: 2.4, cite: { file: "source_shares.txt" } },
  eps_2025: { value: 3.5, cite: { file: "source_shares.txt" } },
  net_margin_2025: { value: 14.0, cite: { file: "source_financials.csv" } },
};

// The DOM/cell-read rubric the live blank-sheet path CAN honestly verify: VALUE only. The generic
// room grid is not the Excel-paper renderer, so the agent writes computed VALUES (not live "=..."
// formulas with cite metadata) into r<row>__B. We grade exactly what that surface can prove —
// correctness + fabrication — and DOCUMENT that formula/citation dimensions are not exercised here
// (they ARE exercised by the in-run fixture self-test above, against the full 4-dim rubric).
const NB01_RUBRIC_DOM: GoldenRubric = {
  task: NB01_TASK,
  allowed_keys: ALLOWED_KEYS,
  expected: EXPECTED,
  formula_required: false,
  citations_required: false,
  sources: NB01_RUBRIC_FULL.sources,
};

// Scripted demoRoom variance seed (mirrored from tests/playwright.benchmark.config.ts). The expected
// map for THIS task must never equal it — that would mean the test read pre-seeded demo data.
const SCRIPTED_VARIANCE_SEED: Readonly<Record<string, string>> = Object.freeze({
  r_rev__variance: "+24%",
  r_cogs__variance: "+27.5%",
  r_gp__variance: "+21.7%",
  r_ni__variance: "+22.4%",
});

function assertNotCheating(expected: Record<string, { value: number; tol?: number }>): void {
  const norm = (m: Record<string, unknown>) =>
    Object.fromEntries(Object.keys(m).sort().map((k) => [k, String((m as Record<string, { value?: unknown }>)[k]?.value ?? (m as Record<string, unknown>)[k])]));
  const a = norm(expected);
  const b = norm(SCRIPTED_VARIANCE_SEED as unknown as Record<string, unknown>);
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (same) {
    throw new Error(
      "[anti-cheat] expected values exactly match the scripted variance seed from src/engine/demoRoom.ts — " +
        "the test would have appeared to pass by reading pre-seeded demo data. Refusing to run.",
    );
  }
}

// The actual nb-01 source files (verbatim from src/benchmarks/nonbtb/nb-01-company-profile/). These
// figures compute to the golden values — and are uploaded as FILES, so import is genuinely exercised.
const SOURCE_FINANCIALS_CSV = "year,revenue,cogs,net_income\n2024,1200,720,144\n2025,1500,840,210\n";
const SOURCE_SHARES_TXT = "shares_outstanding_millions: 60\n";

// The literal task instruction. Explicit about the deliverable target (the blank sheet's r<row>
// cells) and the batch write tool — the cheap model narrates instead of writing when the target is
// ambiguous (observed with the inline-prompt variant). The figures are NOT inlined: the agent must
// read them from the uploaded source_financials.csv / source_shares.txt.
const PROMPT =
  "@nodeagent You have two uploaded source files in this room: source_financials.csv " +
  "(columns year,revenue,cogs,net_income in $M) and source_shares.txt (shares_outstanding_millions). " +
  "Read them, then WRITE the answers into the blank 'Sheet 1' grid using the cell-write tool " +
  "(write_locked_cells). Put each metric NAME in column A and its numeric VALUE (number only) in " +
  "column B, one metric per row: " +
  "r1__A=revenue_growth_pct, r1__B=(latest revenue vs prior year, percent); " +
  "r2__A=gross_margin_2024, r2__B=((revenue-cogs)/revenue*100 for 2024); " +
  "r3__A=gross_margin_2025, r3__B=(same for 2025); " +
  "r4__A=eps_2024, r4__B=(net_income/shares for 2024); " +
  "r5__A=eps_2025, r5__B=(net_income/shares for 2025). " +
  "Do not just explain in chat — actually write the five rows into Sheet 1.";

/** Read the rendered sheet as {metricName -> valueText}, keyed off the visible r<row>__A/__B cells. */
async function readSheet(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    document.querySelectorAll<HTMLElement>('[data-element-id$="__A"]').forEach((a) => {
      const rowId = (a.getAttribute("data-element-id") || "").replace(/__A$/, "");
      const b = document.querySelector<HTMLElement>(`[data-element-id="${rowId}__B"]`);
      const metric = (a.textContent || "").trim().toLowerCase();
      const val = (b?.textContent || "").trim();
      if (metric) out[metric] = val;
    });
    return out;
  });
}

const parseNum = (s: string | undefined): number | null => {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const isFilled = (s: string | undefined) => s != null && s !== "" && s !== "—";

function writeProofReceipt(proof: SpreadsheetBenchLiveRoomProof): void {
  const absolute = resolve(process.cwd(), SPREADSHEETBENCH_LIVE_ROOM_PROOF_PATH);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(proof, null, 2)}\n`);
}

test("SpreadsheetBench V1 fresh-room contract: import nb-01 CSV -> cheap @nodeagent -> official gradeGolden on agent cells", async ({ page }, testInfo) => {
  test.setTimeout(320_000);

  // Anti-cheat gate #1: the expected map must not be the scripted demo seed.
  assertNotCheating(EXPECTED);

  // Anti-cheat gate #2 (run BEFORE any network): the official scorer's anti-cheat dimensions are
  // real — gradeGolden accepts the golden-good fixture at 1.0 and REJECTS the golden-bad fixture.
  const goodGrade = gradeGolden(NB01_RUBRIC_FULL, NB01_GOOD, 0.6);
  const badGrade = gradeGolden(NB01_RUBRIC_FULL, NB01_BAD, 0.6);
  expect(goodGrade.score, "gradeGolden must score the golden-good deliverable 1.0").toBe(1);
  expect(goodGrade.ok).toBe(true);
  expect(badGrade.ok, `gradeGolden must REJECT the golden-bad deliverable (got ${badGrade.score}, flags: ${badGrade.flags.join("; ")})`).toBe(false);
  expect(badGrade.fabrication, "the golden-bad deliverable fabricates net_margin_2025").toBeGreaterThanOrEqual(1);

  const pageErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e.message ?? e)));

  // ── Step 1: FRESH ROOM (live Convex; the create-room CTA only renders when live). ──────────────
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  expect(page.url(), "must NOT be memory mode — the live agent only runs server-side").not.toContain("mode=memory");
  await page.locator('[data-testid="create-room"]').click({ timeout: 60_000 });
  await page.locator('[data-testid="blank-cta-sheet"]').click({ timeout: 60_000 });
  // Confirm this is a live Convex room (not a memory fallback): the header shows the live badge.
  await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 30_000 });

  // ── Step 2: IMPORT — upload the ACTUAL nb-01 source files through the live LeftRail file input. ─
  // The Room Binder (which hosts the .r-file-input upload affordance) is collapsed by default in a
  // fresh room — open it first (same affordance e2e/excel-grid.spec.ts exercises via enterDemoRoom).
  const leftRail = page.getByTestId("left-rail");
  if (!(await leftRail.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: "Toggle Room Binder panel" }).click({ timeout: 30_000 });
  }
  await expect(leftRail).toBeVisible({ timeout: 30_000 });
  const fileInput = page.locator(".r-file-input");
  await fileInput.waitFor({ state: "attached", timeout: 30_000 });
  await fileInput.setInputFiles([
    { name: "source_financials.csv", mimeType: "text/csv", buffer: Buffer.from(SOURCE_FINANCIALS_CSV, "utf8") },
    { name: "source_shares.txt", mimeType: "text/plain", buffer: Buffer.from(SOURCE_SHARES_TXT, "utf8") },
  ]);
  // The import is proven by the binder showing the uploaded artifacts.
  await expect(page.getByTestId("binder-artifact").filter({ hasText: "source_financials.csv" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("binder-artifact").filter({ hasText: "source_shares.txt" })).toBeVisible({ timeout: 30_000 });

  // Re-open the blank Sheet 1 as the active artifact so the agent's contextArtifactId targets it and
  // its r<row> cells are the ones rendered for the grade.
  await page.getByTestId("binder-artifact").filter({ hasText: "Sheet 1" }).first().click({ timeout: 30_000 });
  await expect(page.locator('[data-element-id="r1__A"]')).toBeVisible({ timeout: 30_000 });

  // ── Step 3: ASK — the cheap route must be selected, then send the literal prompt. ──────────────
  const preset = page.locator('[data-testid="chat-model-preset"]').first();
  await expect(preset, "must be the cheap adaptive/free route — fail loudly if a flagship is pinned").toHaveValue(/adaptive|free/, { timeout: 30_000 });

  // The composer testid is ON the <textarea> itself (not a wrapper), so target it directly.
  const ta = page.locator('textarea[data-testid="chat-composer"]').first();
  const send = page.locator('[data-testid="chat-send"]').first();
  await ta.fill(PROMPT, { timeout: 30_000 });
  await send.click();

  // The send is admitted: the user's message echoes and no agent-error renders.
  await expect(page.locator('[data-testid="chat-message"]').filter({ hasText: "compute" }).or(page.locator('[data-testid="chat-message"]').filter({ hasText: "source_financials.csv" })).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-testid="agent-error"]')).toHaveCount(0);

  // ── Step 4: WAIT — on a durable Convex job signal AND on the visible cells (no sleep). ─────────
  // The durable server-side admission receipt (the public ask job) surfaces as a job-status chip.
  await expect(page.locator('[data-testid="job-status"]').first(), "the public ask must create a visible durable job (server-side admission receipt)")
    .toContainText(/queued|running|completed|blocked|failed/i, { timeout: 60_000 });

  // Poll the VISIBLE grid until every metric row has a value — the cheap model filling cells live.
  await expect
    .poll(
      async () => {
        const live = await readSheet(page);
        return KEYS.filter((k) => isFilled(live[k])).length;
      },
      { timeout: 240_000, message: "waiting for the cheap adaptive model to write all 5 metric cells into the live grid" },
    )
    .toBe(KEYS.length);

  // ── Step 5 (honest substitute) + Step 6: read the cells the agent wrote, grade with gradeGolden. ─
  const pairs = await readSheet(page);
  const outputs: GoldenOutputs = {};
  for (const key of KEYS) {
    const v = parseNum(pairs[key]);
    if (v != null) outputs[key] = { value: v };
  }
  // OFFICIAL scorer on the agent's ACTUAL output (value-only rubric — what the DOM surface can prove).
  const grade = gradeGolden(NB01_RUBRIC_DOM, outputs, 0.6);

  // Screenshot the graded deliverable for the trace/proof.
  const shotPath = testInfo.outputPath("spreadsheetbench-graded-sheet.png");
  await page.screenshot({ path: shotPath, fullPage: false });
  await testInfo.attach("graded-sheet", { path: shotPath, contentType: "image/png" });

  // ── Step 7: write the proof receipt; the ledger derives `passed` from THIS file. ──────────────
  const passed = grade.ok && grade.correct === KEYS.length && grade.fabrication === 0;
  writeProofReceipt({
    schema: 1,
    task: NB01_TASK,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE,
    memoryMode: false,
    gradingMethod: "cell-read",
    note: "Live desktop room has no sheet->.xlsx download; graded the cells the agent wrote into the live grid via gradeGolden() (value+fabrication dimensions). Formula/citation dimensions exercised in-run against the bundled good/bad fixtures.",
    scorer: { name: "gradeGolden", file: "src/benchmarks/golden/grader.ts" },
    grade: {
      score: grade.score,
      ok: grade.ok,
      correct: grade.correct,
      n: grade.n,
      fabrication: grade.fabrication,
      flags: grade.flags,
    },
    selfTest: { goodScore: goodGrade.score, badScore: badGrade.score, badRejected: !badGrade.ok },
    cells: pairs,
    passed,
    gatesProven: [
      "fresh_room_join",
      "official_fixture_upload",
      "public_nodeagent_invocation",
      "visible_streaming_progress",
      "official_scorer_handoff",
      "no_memory_mode_shortcut",
    ],
    gatesNotProven: {
      deliverable_export_download: "No sheet->.xlsx export exists in the live desktop room; graded cell-read output instead.",
      artifact_reopen_validation: "No exported file to reopen from disk; graded the live rendered cells.",
    },
  });

  // Hard assertions — the run only counts if the agent's real output grades clean.
  expect(grade.fabrication, `agent fabricated keys: ${grade.flags.join("; ")}`).toBe(0);
  for (const key of KEYS) {
    const got = parseNum(pairs[key]);
    expect(got, `${key}: visible cell was "${pairs[key]}"`).not.toBeNull();
    expect(
      Math.abs((got as number) - EXPECTED[key].value),
      `${key}: got ${got}, golden ${EXPECTED[key].value} ± ${EXPECTED[key].tol ?? 0}`,
    ).toBeLessThanOrEqual((EXPECTED[key].tol ?? 0) + 1e-9);
  }
  expect(grade.ok, `gradeGolden rejected the agent output (score ${grade.score}, flags: ${grade.flags.join("; ")})`).toBe(true);
  expect(passed, "the run is only a pass when the official scorer accepts every cell with no fabrication").toBe(true);
  expect(pageErrors, `page errors: ${pageErrors.join("; ")}`).toEqual([]);
});
