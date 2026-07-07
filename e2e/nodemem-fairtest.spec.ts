/**
 * NodeMem FAIR VALUE TEST — does NodeMem beat what the agent ALREADY has?
 *
 * The recall benchmark proved NodeMem retrieves facts that live ONLY in episodes — i.e. "NodeMem vs
 * nothing". This test is the honest comparison: "NodeMem vs the existing context". The agent already
 * sees `awareness()` = the last SIX `traces` (collab.ts) plus the sheet snapshot + OKF/web tools.
 *
 * So we seed the SAME facts into BOTH channels: the bounded awareness channel (room `traces`) AND
 * NodeMem episodes. Then we scale:
 *   - SMALL: the 5 fact-traces are the most recent → they fit in awareness's last-6 → the BARE agent
 *     can already see them. NodeMem should add ~nothing here.
 *   - LARGE: the 5 fact-traces are OLD, buried under noise traces → they fall OUT of awareness's
 *     last-6, and the facts are chat/notes (not sheet cells / OKF concepts) so the bare agent's other
 *     tools can't reach them either. Only NodeMem (unbounded, relevance-ranked) still retrieves them.
 *
 * The marginal value of NodeMem = the recall GAP that opens at LARGE scale. If bare keeps up at large
 * scale, NodeMem is redundant for this use case.
 *
 * Arms: {bare (mode off), memory (active_ab)} × scale {small, large} × trials. Grades the authoritative
 * agentJobs.finalText via benchRoomAnswer. Run against the isolated LOCAL backend.
 */

import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve as pathResolve, dirname } from "node:path";
import { createScratchSheetFromStarterHome } from "./liveStarter";

const BASE = process.env.BENCH_BASE_URL ?? "http://127.0.0.1:5273";
const CONVEX_URL = process.env.VITE_CONVEX_URL ?? "";
const SECRET = process.env.NODEMEM_ROOM_CONFIG_SECRET ?? "";
const TRIALS = Number(process.env.BENCH_TRIALS ?? 2);
const AGENT_TIMEOUT_MS = Number(process.env.BENCH_AGENT_COMPLETION_TIMEOUT_MS ?? 8 * 60_000);
const TEST_TIMEOUT_MS = Math.max(12 * 60_000, AGENT_TIMEOUT_MS + 4 * 60_000);

// ts sort-keys: awareness orders traces by ts DESC and takes 6. Use a value above the agent's own
// runtime traces (~Date.now()≈1.78e12) so our seeded ordering survives the agent's own activity.
const TS_NEW = 5_000_000_000_000; // "most recent" — fills the last-6 window
const TS_OLD = 1_000_000; // "ancient" — falls out of the last-6 window

// 5 memory-only private-diligence facts. Tokens are specific/synthetic (a bare agent with no access
// to the fact cannot produce them); the QUESTIONS contain none of the tokens.
const TARGETS = [
  { note: "Mark flagged MAI's blended CAC creeping to $310 in the March 2026 partner meeting; gated the follow-on on a payback proof.",
    question: "What exact blended-CAC dollar figure did Mark flag for the MAI follow-on?", token: ["$310", "310"] },
  { note: "Mark's note: Make the Dot's real moat is the proprietary fit dataset from Emilie Ho's prior Shein team, not the generator.",
    question: "What proprietary data asset is the real moat behind the AI-fashion company?", token: ["fit dataset"] },
  { note: "Mark's diligence: Hanger's tendon actuator yield was only 40% in the Feb 2026 factory visit — the risk Alan monitors monthly.",
    question: "What component-yield risk did the robotic-hands diligence surface for Alan to monitor monthly?", token: ["tendon actuator"] },
  { note: "Mark's note: Alan reused his Alibaba-era MetaForge co-investor relationship to fill the one round he personally led.",
    question: "Which prior Alibaba-era portfolio name's co-investor did Alan reuse for the round he personally led?", token: ["MetaForge"] },
  { note: "Mark's diligence: the retention cohort Mark trusted for BeFreed was the internal 'Lighthouse' cohort Leo Zhang opened.",
    question: "What named retention cohort did Mark trust for the AI-audio company's user base?", token: ["Lighthouse"] },
];

const NOISE = Array.from({ length: 50 }, (_, i) =>
  `Mark reviewed the day-${i + 1} portfolio pipeline and headcount; no material change beyond the logged risks; next check-in scheduled.`,
);
// noise per scale: small fits any window; mid (12) exceeds a 6-window but fits a 30-window; big (50)
// exceeds even a 30-window → only relevance retrieval (NodeMem) still finds the old targets.
const NOISE_BY_SCALE: Record<string, number> = { small: 0, mid: 12, big: 50 };

const PROMPT =
  "@nodeagent You are Mark Liu's diligence assistant. Answer ONLY from what you already know about this " +
  "room's prior activity — do NOT browse and do NOT invent. Write one sheet row per answer (col A = a short " +
  "label, col B = the answer); if you do not know, write 'needs_review'. Questions:\n" +
  TARGETS.map((t, i) => `${i + 1}. ${t.question}`).join("\n");

interface Run {
  arm: "bare" | "memory";
  scale: "small" | "mid" | "big";
  trial: number;
  roomId: string | null;
  recalled: number;
  total: number;
  recall: number;
  latencyMs: number;
  error?: string;
}
const results: Run[] = [];

function codeFromUrl(u: string): string | undefined {
  try { return new URL(u).searchParams.get("room") ?? undefined; } catch { return undefined; }
}

test.describe.configure({ mode: "serial" });

const ARMS: { name: "bare" | "memory"; mode: "off" | "active_ab"; maxTokens?: number }[] = [
  { name: "bare", mode: "off" },
  { name: "memory", mode: "active_ab", maxTokens: 1200 },
];

for (const scale of ["small", "mid", "big"] as const) {
  for (const arm of ARMS) {
    for (let trial = 1; trial <= TRIALS; trial++) {
      test(`fairtest — ${scale} ${arm.name} trial ${trial}`, async ({ page }) => {
        test.setTimeout(TEST_TIMEOUT_MS);
        const run: Run = { arm: arm.name, scale, trial, roomId: null, recalled: 0, total: TARGETS.length, recall: 0, latencyMs: 0 };
        try {
          await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
          await page.locator('[data-testid="create-room"]').click({ timeout: 60_000 });
          await page.locator('[data-testid="create-room-submit"]').waitFor({ state: "visible", timeout: 10_000 });
          await page.locator('[data-testid="create-room-submit"]').click();
          await createScratchSheetFromStarterHome(page);
          await expect(page.getByText(/live convex/i)).toBeVisible({ timeout: 30_000 });

          const convex = new ConvexHttpClient(CONVEX_URL);
          const info = await convex.query(api.rooms.byCode, { code: codeFromUrl(page.url()) ?? "" });
          const roomId = info?.roomId;
          run.roomId = roomId ? String(roomId) : null;
          if (!roomId) throw new Error("room_not_resolved");

          await convex.mutation(api.nodemem.setNodeMemRoomConfig, { roomId, mode: arm.mode, maxTokens: arm.maxTokens, secret: SECRET });

          // Seed the 5 fact-traces. No noise → most-recent (fit any window). With noise → ancient
          // (buried below the noise). Also record them as NodeMem episodes (the memory channel).
          const noiseCount = NOISE_BY_SCALE[scale] ?? 0;
          const targetTs = noiseCount === 0 ? TS_NEW : TS_OLD;
          for (let i = 0; i < TARGETS.length; i++) {
            await convex.mutation(api.nodemem.benchSeedTrace, { roomId, type: "chat", summary: TARGETS[i].note, ts: targetTs + i, secret: SECRET });
            await convex.mutation(api.nodemem.recordEpisode, { roomId, sourceKind: "chat", sourceId: `${roomId}_tgt${i}`, visibility: "room", rawText: TARGETS[i].note });
          }
          // Bury the targets with newer noise traces so they fall out of the awareness window.
          for (let i = 0; i < noiseCount; i++) {
            await convex.mutation(api.nodemem.benchSeedTrace, { roomId, type: "chat", summary: NOISE[i], ts: TS_NEW + i, secret: SECRET });
            await convex.mutation(api.nodemem.recordEpisode, { roomId, sourceKind: "chat", sourceId: `${roomId}_noise${i}`, visibility: "room", rawText: NOISE[i] });
          }
          if (arm.mode !== "off") {
            for (let b = 0; b < 2; b++) await convex.action(api.nodememCompile.compileBatchManual, { batchSize: 50 });
          }

          // ASK
          const t0 = Date.now();
          await page.locator('textarea[data-testid="chat-composer"]').first().fill(PROMPT, { timeout: 30_000 });
          await page.locator('[data-testid="chat-send"]').first().click();
          await expect(page.locator('[data-testid="agent-error"]')).toHaveCount(0);

          // Grade the authoritative finalText.
          let answer = "";
          const deadline = Date.now() + AGENT_TIMEOUT_MS;
          while (Date.now() < deadline) {
            await page.waitForTimeout(4000);
            try {
              const a = await convex.query(api.nodemem.benchRoomAnswer, { roomId, secret: SECRET });
              if (a) { answer = a.text; if (a.done && a.text.trim().length > 0) break; }
            } catch { /* transient */ }
          }
          run.latencyMs = Date.now() - t0;
          const lower = answer.replace(/\s+/g, " ").toLowerCase();
          run.recalled = TARGETS.filter((t) => t.token.some((tok) => lower.includes(tok.toLowerCase()))).length;
          run.recall = run.recalled / run.total;
        } catch (err) {
          run.error = err instanceof Error ? err.message : String(err);
          throw err;
        } finally {
          results.push(run);
        }
      });
    }
  }
}

test("fairtest — summary", () => {
  expect(results.length).toBeGreaterThanOrEqual(1);
  const reportPath = pathResolve(process.cwd(), "docs/eval/nodemem-fairtest.json");
  mkdirSync(dirname(reportPath), { recursive: true });
  const agg: Record<string, number[]> = {};
  for (const r of results) (agg[`${r.scale}|${r.arm}`] ||= []).push(r.recall);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const summary = Object.entries(agg).map(([k, v]) => {
    const [scale, arm] = k.split("|");
    return { scale, arm, trials: v.length, recallMean: mean(v) };
  });
  writeFileSync(reportPath, `${JSON.stringify({ benchmarkType: "nodemem_fair_value", awarenessWindow: 6, runs: results, summary }, null, 2)}\n`);
  console.log("\n=== NodeMem FAIR value test (NodeMem vs existing awareness, awareness=last 6 traces) ===\n");
  console.log("scale  arm     trials  recallMean");
  console.log("-".repeat(40));
  for (const key of Object.keys(agg).sort()) {
    const [scale, arm] = key.split("|");
    console.log(scale.padEnd(7) + arm.padEnd(8) + String(agg[key].length).padEnd(8) + mean(agg[key]).toFixed(2));
  }
  console.log("");
});
