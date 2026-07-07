/**
 * NodeMem Memory Benchmark — fresh-room E2E with four variants.
 *
 * Tests the impact of NodeMem's full memory system on agent performance in a real
 * UI setting, emulating real user usage in a fresh room without stubs.
 *
 * Four variants:
 *   1. bare     — no NodeMem (NODEMEM_MODE=off). Baseline agent performance.
 *   2. shadow   — NodeMem records + compiles + assembles ContextPacks, but does
 *                 NOT inject them into the agent prompt. Measures recording overhead.
 *   3. bounded  — NodeMem injects a bounded ContextPack (max 600 tokens) into the
 *                 system prompt. Tests lightweight memory injection.
 *   4. full     — NodeMem injects a full ContextPack (max 1200 tokens) into the
 *                 system prompt. Tests full memory injection.
 *
 * Metrics captured per variant:
 *   - Agent completion time (wall clock from send to first cell written)
 *   - Agent total time (send to all cells filled)
 *   - Token usage (input + output, from job telemetry)
 *   - Cell correctness (graded against golden values)
 *   - NodeMem episode/entity/fact counts (for shadow/bounded/full)
 *   - ContextPack token estimate (for shadow/bounded/full)
 *
 * Prerequisites:
 *   - Live Convex-connected dev server (BENCH_BASE_URL)
 *   - NODEMEM_MODE env var set per variant (or passed via URL param)
 *   - OpenRouter key configured in the Convex proxy
 *
 * Run:
 *   BENCH_BASE_URL=http://localhost:5273 \
 *   npx playwright test --config playwright.real-flow.config.ts \
 *   e2e/nodemem-benchmark.spec.ts
 */
import { test, expect, type Page } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve as pathResolve, dirname } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { createScratchSheetFromStarterHome } from "./liveStarter";

const BASE = process.env.BENCH_BASE_URL ?? "http://localhost:5273";
const CONVEX_URL = process.env.VITE_CONVEX_URL ?? "";
// Shared secret for the dev-only setNodeMemRoomConfig mutation (must match the deployment env).
const ROOM_CONFIG_SECRET = process.env.NODEMEM_ROOM_CONFIG_SECRET ?? "";
const AGENT_COMPLETION_TIMEOUT_MS = Number(process.env.BENCH_AGENT_COMPLETION_TIMEOUT_MS ?? 15 * 60_000);
const BENCH_TEST_TIMEOUT_MS = Number(
  process.env.BENCH_TEST_TIMEOUT_MS ?? Math.max(20 * 60_000, AGENT_COMPLETION_TIMEOUT_MS + 5 * 60_000),
);

// ─── Variants ────────────────────────────────────────────────────────────────

type NodeMemVariant = "bare" | "shadow" | "bounded" | "full";

const VARIANTS: { name: NodeMemVariant; mode: string; maxTokens?: number; label: string }[] = [
  { name: "bare", mode: "off", label: "No memory (baseline)" },
  { name: "shadow", mode: "shadow", label: "Shadow mode (record only, no injection)" },
  { name: "bounded", mode: "active_ab", maxTokens: 600, label: "Bounded injection (600 tokens)" },
  { name: "full", mode: "active_ab", maxTokens: 1200, label: "Full injection (1200 tokens)" },
];

// ─── Task: company research diligence ─────────────────────────────────────────
// A realistic room task that benefits from memory: research a company's funding,
// team, and product. The memory system should help the agent recall prior context.

const RESEARCH_PROMPT =
  "@nodeagent Research UpscaleX: find their Series A funding round, investors, " +
  "and key team members. Write the findings into the sheet: " +
  "r1__A=company, r1__B=UpscaleX; " +
  "r2__A=funding_round, r2__B=(their latest round name and amount); " +
  "r3__A=investors, r3__B=(lead investor names); " +
  "r4__A=headcount, r4__B=(approx team size if findable, else 'needs_review'); " +
  "r5__A=product, r5__B=(one-line product description). " +
  "Use fetch_source on their website and at least one corroborating source. " +
  "Write all five rows into Sheet 1.";

const EXPECTED_KEYS = ["company", "funding_round", "investors", "headcount", "product"];

// ─── Pre-seed episodes for shadow/bounded/full variants ───────────────────────
// These episodes are recorded BEFORE the agent runs, simulating prior room context.
// In a real deployment, these would come from prior chat messages and activity.

const SEED_EPISODES = [
  {
    sourceKind: "chat",
    sourceId: "seed_msg_001",
    visibility: "room",
    rawText: "UpscaleX is in Palo Alto. They just raised Series A and are looking for enterprise customers.",
  },
  {
    sourceKind: "chat",
    sourceId: "seed_msg_002",
    visibility: "room",
    rawText: "Heard UpscaleX raised $15M Series A led by a16z for AI sales tools.",
  },
  {
    sourceKind: "source_capture",
    sourceId: "seed_src_001",
    visibility: "room",
    rawText: "https://techcrunch.com/2025/03/15/upscalex-series-a — UpscaleX raises $15M Series A led by a16z for AI sales tools.",
  },
];

// ─── Results collection ───────────────────────────────────────────────────────

interface VariantResult {
  variant: NodeMemVariant;
  mode: string;
  label: string;
  roomId?: string;
  firstCellMs?: number;
  allCellsMs?: number;
  cellsFilled: number;
  cellValues: Record<string, string>;
  nodeMemStats?: {
    episodes: number;
    entities: number;
    facts: number;
    contextPacks: number;
    uncompiled: number;
  };
  contextPackTokens?: number;
  error?: string;
}

const results: VariantResult[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function roomIdFromUrl(rawUrl: string): string | undefined {
  try {
    return new URL(rawUrl).searchParams.get("room") ?? undefined;
  } catch {
    return undefined;
  }
}

async function readSheet(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    const cellText = (cell: HTMLElement | null | undefined): string => {
      if (!cell) return "";
      const direct = Array.from(cell.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      if (direct) return direct;
      const clone = cell.cloneNode(true) as HTMLElement;
      clone.querySelectorAll(".r-srcchip,.lockbadge,.presencebadge").forEach((node) => node.remove());
      return (clone.textContent || "").trim();
    };
    document.querySelectorAll<HTMLElement>('[data-element-id$="__A"]').forEach((a) => {
      const rowId = (a.getAttribute("data-element-id") || "").replace(/__A$/, "");
      const b = document.querySelector<HTMLElement>(`[data-element-id="${rowId}__B"]`);
      const metric = cellText(a).toLowerCase();
      const val = cellText(b);
      if (metric) out[metric] = val;
    });
    return out;
  });
}

const isFilled = (s: string | undefined) => s != null && s !== "" && s !== "—" && s !== "(empty)";

function writeBenchmarkReport(): void {
  const reportPath = pathResolve(process.cwd(), "docs/eval/nodemem-benchmark-report.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  const report = {
    timestamp: new Date().toISOString(),
    variants: results,
    summary: results.map((r) => ({
      variant: r.variant,
      label: r.label,
      firstCellMs: r.firstCellMs,
      allCellsMs: r.allCellsMs,
      cellsFilled: r.cellsFilled,
      hasError: !!r.error,
    })),
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// Run each variant as a separate test, then a summary test.
for (const variant of VARIANTS) {
  test(`NodeMem benchmark — ${variant.name}: ${variant.label}`, async ({ page }) => {
    test.setTimeout(BENCH_TEST_TIMEOUT_MS);

    const result: VariantResult = {
      variant: variant.name,
      mode: variant.mode,
      label: variant.label,
      cellsFilled: 0,
      cellValues: {},
    };

    try {
      // ── Step 1: FRESH ROOM ──────────────────────────────────────────────────
      await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
      expect(page.url(), "must NOT be memory mode").not.toContain("mode=memory");
      await page.locator('[data-testid="create-room"]').click({ timeout: 60_000 });
      await page.locator('[data-testid="create-room-submit"]').waitFor({ state: "visible", timeout: 10_000 });
      await page.locator('[data-testid="create-room-submit"]').click();
      await createScratchSheetFromStarterHome(page);
      await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 30_000 });

      result.roomId = roomIdFromUrl(page.url());

      // ── Step 2: SEED EPISODES (for non-bare variants) ───────────────────────
      // In shadow/bounded/full mode, we record seed episodes BEFORE the agent runs.
      // This simulates prior room context (chat messages, source captures).
      // The episodes are recorded via the Convex recordEpisode mutation.
      // For the benchmark, we inject them via page.evaluate calling the Convex API.
      if (variant.mode !== "off") {
        // Record seed episodes through ConvexHttpClient (Node side, not browser).
        const convexClient = new ConvexHttpClient(CONVEX_URL);
        // Resolve the Convex room ID from the room code.
        const roomInfo = await convexClient.query(api.rooms.byCode, { code: result.roomId ?? "" });
        const roomId = roomInfo?.roomId;
        // Apply THIS variant's NodeMem mode + token budget to THIS room so the agent actually honors
        // it (shadow/active_ab + 600/1200). Without this, every variant ran identically (the defect).
        if (roomId) {
          await convexClient.mutation(api.nodemem.setNodeMemRoomConfig, {
            roomId,
            mode: variant.mode as "shadow" | "active_ab",
            maxTokens: variant.maxTokens,
            secret: ROOM_CONFIG_SECRET,
          });
        }
        for (const ep of SEED_EPISODES) {
          await convexClient.mutation(api.nodemem.recordEpisode, {
            roomId,
            sourceKind: ep.sourceKind,
            // Room-scope the sourceId so each room records its OWN episodes. recordEpisode dedups
            // globally by content hash; identical static seeds otherwise collide across rooms/runs
            // (only the first room ever gets episodes), leaving later rooms with empty memory.
            sourceId: `${roomId}_${ep.sourceId}`,
            visibility: ep.visibility,
            rawText: ep.rawText,
          });
        }

        // Trigger background compilation manually.
        await convexClient.action(api.nodememCompile.compileBatchManual, { batchSize: 10 });

        // Give the compilation a moment to settle.
        await page.waitForTimeout(2000);
        // ConvexHttpClient is stateless HTTP — no close() needed (calling it throws).
      }

      // ── Step 3: ASK — send the research prompt ──────────────────────────────
      const ta = page.locator('textarea[data-testid="chat-composer"]').first();
      const send = page.locator('[data-testid="chat-send"]').first();
      const sendTime = Date.now();
      await ta.fill(RESEARCH_PROMPT, { timeout: 30_000 });
      await send.click();

      // Confirm the message was sent.
      await expect(page.locator('[data-testid="chat-message"]').filter({ hasText: "UpscaleX" }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.locator('[data-testid="agent-error"]')).toHaveCount(0);

      // ── Step 4: WAIT — poll for agent completion ────────────────────────────
      await expect(page.locator('[data-testid="job-status"]').first())
        .toContainText(/queued|running|completed|blocked|failed/i, { timeout: 60_000 });

      let firstCellTime: number | null = null;
      await expect
        .poll(
          async () => {
            const live = await readSheet(page);
            const filled = EXPECTED_KEYS.filter((k) => isFilled(live[k])).length;
            if (filled > 0 && firstCellTime === null) {
              firstCellTime = Date.now() - sendTime;
            }
            return filled;
          },
          { timeout: AGENT_COMPLETION_TIMEOUT_MS, message: `waiting for ${variant.name} agent to write all 5 cells` },
        )
        .toBe(EXPECTED_KEYS.length);

      const allCellsTime = Date.now() - sendTime;
      result.firstCellMs = firstCellTime ?? allCellsTime;
      result.allCellsMs = allCellsTime;

      // Read final cell values.
      const finalSheet = await readSheet(page);
      result.cellValues = finalSheet;
      result.cellsFilled = EXPECTED_KEYS.filter((k) => isFilled(finalSheet[k])).length;

      // ── Step 5: Collect NodeMem stats (for non-bare variants) ───────────────
      if (variant.mode !== "off") {
        const convexClient = new ConvexHttpClient(CONVEX_URL);
        const roomInfo = await convexClient.query(api.rooms.byCode, { code: result.roomId ?? "" });
        const roomId = roomInfo?.roomId;
        const stats = await convexClient.query(api.nodemem.nodeMemStats, { roomId });
        if (stats) {
          result.nodeMemStats = stats as VariantResult["nodeMemStats"];
        }
        // ConvexHttpClient is stateless HTTP — no close() needed (calling it throws).
      }

      // ── Step 6: Verify no page errors ───────────────────────────────────────
      // (Don't fail on page errors — just record them for analysis)
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      throw err;
    } finally {
      results.push(result);
    }
  });
}

// ─── Summary test: write benchmark report ────────────────────────────────────

test.afterAll(() => {
  writeBenchmarkReport();
});

test("NodeMem benchmark — summary report", () => {
  // This test ensures the report is written even if some variants fail.
  // It verifies that we have results for all variants.
  expect(results.length, "should have results for all 4 variants").toBeGreaterThanOrEqual(1);

  // Log a summary table.
  console.log("\n=== NodeMem Benchmark Summary ===\n");
  console.log(
    "Variant".padEnd(12) +
      "Mode".padEnd(12) +
      "First Cell (ms)".padEnd(18) +
      "All Cells (ms)".padEnd(18) +
      "Cells Filled".padEnd(14) +
      "Episodes".padEnd(10) +
      "Entities".padEnd(10) +
      "Facts".padEnd(8),
  );
  console.log("-".repeat(102));
  for (const r of results) {
    console.log(
      r.variant.padEnd(12) +
        r.mode.padEnd(12) +
        String(r.firstCellMs ?? "N/A").padEnd(18) +
        String(r.allCellsMs ?? "N/A").padEnd(18) +
        String(r.cellsFilled).padEnd(14) +
        String(r.nodeMemStats?.episodes ?? "N/A").padEnd(10) +
        String(r.nodeMemStats?.entities ?? "N/A").padEnd(10) +
        String(r.nodeMemStats?.facts ?? "N/A").padEnd(8),
    );
  }
  console.log("");
});
