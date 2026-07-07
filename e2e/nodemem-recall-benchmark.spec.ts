/**
 * NodeMem LONG-CONTEXT RECALL benchmark — the test that actually measures NodeMem's value.
 *
 * The original nodemem benchmark seeded 3 facts on a trivially-completable task, so memory could not
 * matter (bounded ≡ full, off ≈ on). This one accumulates a realistic VC memory graph (10 / 50 / 200
 * facts — Mark Liu's UpScaleX portfolio + connections, see e2e/nodemem/portfolioGraph.ts) and asks a
 * RECALL-DEPENDENT task whose answers are MEMORY-ONLY private-diligence notes (not web-researchable,
 * synthetic discriminating tokens so the cheap model cannot hallucinate them correctly).
 *
 * What separates here that was flat before:
 *   - off/shadow (no injection) CANNOT answer the buried questions → needs_review → recall ≈ 0.
 *   - bounded/full (injection) recall the answers from the ContextPack → recall > 0.
 *   - at the 200-fact tier the pack overflows the budget, so bounded (600) must TRIM and may drop the
 *     supporting fact (recall dip) while full (1200) keeps more → bounded vs full finally diverge.
 *
 * Matrix: SIZES × VARIANTS × TRIALS (default 3 × 4 × 3 = 36 runs). Cost is joined post-hoc from an
 * admin agentRuns dump (keyed by the roomId recorded per run) — see scripts in the report consumer.
 *
 * Run (against the isolated LOCAL deployment — never prod):
 *   BENCH_BASE_URL=http://127.0.0.1:5273 VITE_CONVEX_URL=http://127.0.0.1:3210 \
 *   NODEMEM_ROOM_CONFIG_SECRET=<secret> \
 *   npx playwright test --config playwright.real-flow.config.ts e2e/nodemem-recall-benchmark.spec.ts --retries=0
 */

import { test, expect, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve as pathResolve, dirname } from "node:path";
import { factsForSize, RECALL_TARGETS, targetAnswerableAtSize } from "./nodemem/portfolioGraph";
import { createScratchSheetFromStarterHome } from "./liveStarter";

const BASE = process.env.BENCH_BASE_URL ?? "http://127.0.0.1:5273";
const CONVEX_URL = process.env.VITE_CONVEX_URL ?? "";
const SECRET = process.env.NODEMEM_ROOM_CONFIG_SECRET ?? "";
const SIZES = (process.env.BENCH_SIZES ?? "10,50,200").split(",").map((s) => Number(s.trim()));
const TRIALS = Number(process.env.BENCH_TRIALS ?? 3);
const AGENT_COMPLETION_TIMEOUT_MS = Number(process.env.BENCH_AGENT_COMPLETION_TIMEOUT_MS ?? 8 * 60_000);
const TEST_TIMEOUT_MS = Math.max(12 * 60_000, AGENT_COMPLETION_TIMEOUT_MS + 4 * 60_000);

interface Variant {
  name: "bare" | "shadow" | "bounded" | "full";
  mode: "off" | "shadow" | "active_ab";
  maxTokens?: number;
}
const VARIANTS: Variant[] = [
  { name: "bare", mode: "off" },
  { name: "shadow", mode: "shadow" },
  { name: "bounded", mode: "active_ab", maxTokens: 600 },
  { name: "full", mode: "active_ab", maxTokens: 1200 },
];

const RECALL_PROMPT =
  "@nodeagent You are Mark Liu's diligence assistant for the UpScaleX portfolio. Answer ONLY from what " +
  "you already know about this portfolio — do NOT browse the web and do NOT invent. For each question, " +
  "write one row in the sheet: column A = the short label in brackets, column B = your answer. If you " +
  "do not know the answer, write exactly 'needs_review' in column B. Questions:\n" +
  RECALL_TARGETS.map((t, i) => `${i + 1}. [${t.cell}] ${t.prompt}`).join("\n");

interface RunResult {
  size: number;
  variant: Variant["name"];
  mode: string;
  maxTokens: number | null;
  trial: number;
  roomCode: string | null;
  roomId: string | null;
  // memory state (Node-side, post-compile)
  episodes: number;
  entities: number;
  facts: number;
  packTokens: number | null; // tokenEstimate of the pack that WOULD be injected (active_ab only)
  packTrimmed: boolean | null;
  // outcome
  recalled: number;
  answerable: number;
  recall: number; // recalled / answerable (0 when answerable === 0)
  needsReview: number;
  cellsWritten: number;
  latencyMs: number;
  error?: string;
}

const results: RunResult[] = [];

function roomCodeFromUrl(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).searchParams.get("room") ?? undefined;
  } catch {
    return undefined;
  }
}

/** Read the agent's chat transcript — the cheap model answers here (finalText), not always the sheet. */
async function readChatText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const msgs = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="chat-message"]'));
    return msgs.map((m) => (m.textContent || "").trim()).filter(Boolean).join(" │ ");
  });
}

/** Read ALL cell text in the active sheet (layout-agnostic) for grading. */
async function readAllCellText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll<HTMLElement>("[data-element-id]"));
    return cells
      .map((c) => {
        const clone = c.cloneNode(true) as HTMLElement;
        clone.querySelectorAll(".r-srcchip,.lockbadge,.presencebadge").forEach((n) => n.remove());
        return (clone.textContent || "").trim();
      })
      .filter(Boolean)
      .join(" │ ");
  });
}

function grade(allText: string, size: number): { recalled: number; answerable: number; needsReview: number } {
  const lower = allText.toLowerCase();
  const answerableTargets = RECALL_TARGETS.filter((t) => targetAnswerableAtSize(t, size));
  let recalled = 0;
  for (const t of answerableTargets) {
    if (t.mustContain.some((tok) => lower.includes(tok.toLowerCase()))) recalled++;
  }
  const needsReview = (lower.match(/needs_review/g) ?? []).length;
  return { recalled, answerable: answerableTargets.length, needsReview };
}

function writeReport(): void {
  const reportPath = pathResolve(process.cwd(), "docs/eval/nodemem-recall-benchmark.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  // Aggregate by size × variant.
  const agg: Record<string, { recall: number[]; needsReview: number[]; packTokens: number[] }> = {};
  for (const r of results) {
    const key = `${r.size}|${r.variant}`;
    (agg[key] ||= { recall: [], needsReview: [], packTokens: [] });
    agg[key].recall.push(r.recall);
    agg[key].needsReview.push(r.needsReview);
    if (r.packTokens != null) agg[key].packTokens.push(r.packTokens);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const stdev = (xs: number[]) => {
    if (xs.length < 2) return 0;
    const m = mean(xs)!;
    return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
  };
  const summary = Object.entries(agg).map(([key, v]) => {
    const [size, variant] = key.split("|");
    return {
      size: Number(size),
      variant,
      trials: v.recall.length,
      recallMean: mean(v.recall),
      recallStdev: stdev(v.recall),
      needsReviewMean: mean(v.needsReview),
      packTokensMean: mean(v.packTokens),
    };
  });
  writeFileSync(
    reportPath,
    `${JSON.stringify(
      { benchmarkType: "long_context_recall", generatedSizes: SIZES, trials: TRIALS, runs: results, summary },
      null,
      2,
    )}\n`,
  );
}

test.describe.configure({ mode: "serial" });

for (const size of SIZES) {
  for (const variant of VARIANTS) {
    for (let trial = 1; trial <= TRIALS; trial++) {
      test(`recall — size=${size} ${variant.name} trial ${trial}`, async ({ page }) => {
        test.setTimeout(TEST_TIMEOUT_MS);
        const result: RunResult = {
          size,
          variant: variant.name,
          mode: variant.mode,
          maxTokens: variant.maxTokens ?? null,
          trial,
          roomCode: null,
          roomId: null,
          episodes: 0,
          entities: 0,
          facts: 0,
          packTokens: null,
          packTrimmed: null,
          recalled: 0,
          answerable: 0,
          recall: 0,
          needsReview: 0,
          cellsWritten: 0,
          latencyMs: 0,
        };
        try {
          // ── Create a fresh room ──
          await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
          expect(page.url()).not.toContain("mode=memory");
          await page.locator('[data-testid="create-room"]').click({ timeout: 60_000 });
          await page.locator('[data-testid="create-room-submit"]').waitFor({ state: "visible", timeout: 10_000 });
          await page.locator('[data-testid="create-room-submit"]').click();
          await createScratchSheetFromStarterHome(page);
          await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 30_000 });
          result.roomCode = roomCodeFromUrl(page.url()) ?? null;

          const convex = new ConvexHttpClient(CONVEX_URL);
          const roomInfo = await convex.query(api.rooms.byCode, { code: result.roomCode ?? "" });
          const roomId = roomInfo?.roomId;
          result.roomId = roomId ? String(roomId) : null;
          if (!roomId) throw new Error("room_not_resolved");

          // ── Apply this variant's mode + budget, then seed the size-appropriate memory graph ──
          await convex.mutation(api.nodemem.setNodeMemRoomConfig, {
            roomId,
            mode: variant.mode as "off" | "shadow" | "active_ab",
            maxTokens: variant.maxTokens,
            secret: SECRET,
          });
          if (variant.mode !== "off") {
            const seedFacts = factsForSize(size);
            for (const f of seedFacts) {
              await convex.mutation(api.nodemem.recordEpisode, {
                roomId,
                sourceKind: f.sourceKind,
                sourceId: `${roomId}_${f.id}`, // room-scope to dodge the global content-hash dedup
                visibility: "room",
                rawText: f.text,
              });
            }
            // Compile in bounded batches (200 facts > default batch size).
            for (let b = 0; b < Math.ceil(seedFacts.length / 50); b++) {
              await convex.action(api.nodememCompile.compileBatchManual, { batchSize: 50 });
            }
            await page.waitForTimeout(1500);
            const stats = await convex.query(api.nodemem.nodeMemStats, { roomId });
            if (stats) {
              result.episodes = stats.episodes ?? 0;
              result.entities = stats.entities ?? 0;
              result.facts = stats.facts ?? 0;
            }
            // Capture the pack that WOULD inject (active_ab only returns non-null).
            if (variant.mode === "active_ab") {
              const pack = await convex.query(api.nodemem.assembleContextPackForJob, {
                roomId,
                goal: RECALL_PROMPT,
                userId: "bench",
                maxFacts: 60,
                ...(variant.maxTokens ? { maxTokens: variant.maxTokens } : {}),
              });
              if (pack) {
                result.packTokens = (pack as { tokenEstimate?: number }).tokenEstimate ?? null;
                result.packTrimmed = (() => {
                  try {
                    return JSON.parse((pack as { packJson?: string }).packJson ?? "{}")._trimmed === true;
                  } catch {
                    return null;
                  }
                })();
              }
            }
          }

          // ── ASK the recall task ──
          const ta = page.locator('textarea[data-testid="chat-composer"]').first();
          const send = page.locator('[data-testid="chat-send"]').first();
          const t0 = Date.now();
          await ta.fill(RECALL_PROMPT, { timeout: 30_000 });
          await send.click();
          await expect(page.locator('[data-testid="agent-error"]')).toHaveCount(0);

          // Completion + answer via the DB (AUTHORITATIVE). The agent writes its answer to
          // agentJobs.finalText AND to virtualized sheet rows — neither is reliably in the DOM, so
          // scraping silently missed a WORKING recall (verified: finalText contained "$310"/"ChainPlay"
          // while the scraped DOM did not). Poll benchRoomAnswer until the job is done, grade finalText.
          let answerText = "";
          const deadline = Date.now() + AGENT_COMPLETION_TIMEOUT_MS;
          while (Date.now() < deadline) {
            await page.waitForTimeout(4000);
            try {
              const a = await convex.query(api.nodemem.benchRoomAnswer, { roomId, secret: SECRET });
              if (a) {
                answerText = a.text;
                if (a.done && a.text.trim().length > 0) break;
              }
            } catch {
              // ignore transient query errors while the job spins up
            }
          }
          result.latencyMs = Date.now() - t0;

          // ── Grade the authoritative finalText ∪ any DOM the agent rendered ──
          const chatText = await readChatText(page);
          const cellText = await readAllCellText(page);
          // Strip the echoed prompt (whitespace-insensitive) so question text can never score as an answer.
          const promptFlat = RECALL_PROMPT.replace(/\s+/g, " ").trim();
          const allText = `${answerText} ║ ${chatText} ║ ${cellText}`.replace(/\s+/g, " ").split(promptFlat).join(" ");
          result.cellsWritten = (cellText.match(/│/g) ?? []).length + (cellText.trim() ? 1 : 0);
          const g = grade(allText, size);
          result.recalled = g.recalled;
          result.answerable = g.answerable;
          result.needsReview = g.needsReview;
          result.recall = g.answerable > 0 ? g.recalled / g.answerable : 0;
        } catch (err) {
          result.error = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          results.push(result);
        }
      });
    }
  }
}

test("recall benchmark — summary report", () => {
  expect(results.length, "should have at least one run").toBeGreaterThanOrEqual(1);
  writeReport();
  console.log("\n=== NodeMem Recall Benchmark Summary (recall = answered-from-memory / answerable) ===\n");
  console.log("size  variant   trials  recallMean  recallStdev  needsRevMean  packTokensMean");
  console.log("-".repeat(82));
  const agg: Record<string, RunResult[]> = {};
  for (const r of results) (agg[`${String(r.size).padStart(4)}|${r.variant}`] ||= []).push(r);
  for (const key of Object.keys(agg).sort()) {
    const rs = agg[key];
    const [size, variant] = key.split("|");
    const m = (f: (r: RunResult) => number) => rs.reduce((a, r) => a + f(r), 0) / rs.length;
    console.log(
      size.trim().padEnd(6) +
        variant.padEnd(10) +
        String(rs.length).padEnd(8) +
        m((r) => r.recall).toFixed(2).padEnd(12) +
        (rs.length > 1 ? Math.sqrt(rs.reduce((a, r) => a + (r.recall - m((x) => x.recall)) ** 2, 0) / (rs.length - 1)) : 0)
          .toFixed(2)
          .padEnd(13) +
        m((r) => r.needsReview).toFixed(1).padEnd(14) +
        (rs.some((r) => r.packTokens != null)
          ? Math.round(m((r) => r.packTokens ?? 0)).toString()
          : "N/A"),
    );
  }
  console.log("");
});
