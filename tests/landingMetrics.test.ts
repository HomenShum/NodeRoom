// @vitest-environment edge-runtime
/**
 * Landing live-proof metrics — convex/metrics.landingMetrics.
 *
 * Persona: a first-time visitor loads the public landing page; the hero pill
 * claims "N rooms live · M cells committed today". Those numbers must be REAL
 * (from the ledger), BOUNDED (no full scan even when agent loops write traces
 * at machine rate), and HONEST (a `capped` flag instead of a fabricated exact
 * count when the scan window cannot prove completeness).
 *
 * Angles covered:
 *   - cold start (fresh deployment): zeros, uncapped — no fake floor numbers
 *   - active day (happy path): status/type/time-window filtering is exact,
 *     including the ts == UTC-midnight boundary
 *   - agent-burst overflow (adversarial / sustained accumulation): >1000
 *     today-traces and >200 fresh rooms → values clamp at the scan caps and
 *     capped=true (the UI renders "1,000+", never an invented exact count)
 *   - honest boundary: a FULL scan whose horizon reaches past the time window
 *     is still EXACT → capped=false with the true count (full ≠ capped)
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { ROOMS_SCAN_CAP, TRACES_SCAN_CAP, utcMidnight } from "../convex/metrics";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

// convex/_generated lags until the next codegen — which must NOT be run
// casually here: `npx convex codegen` against a configured cloud deployment
// DEPLOYS schema+functions (documented gotcha). Same cast precedent as
// tests/notebookAgentOutline.test.ts; convex-test resolves by name at runtime.
type LandingMetric = { value: number; capped: boolean };
type LandingMetricsResult = { roomsLive: LandingMetric; cellsCommittedToday: LandingMetric };
const metricsApi = (api as unknown as {
  metrics: { landingMetrics: import("convex/server").FunctionReference<"query", "public", Record<string, never>, LandingMetricsResult> };
}).metrics;

const AGENT = { kind: "agent" as const, id: "nodeagent", name: "NodeAgent" };
const HOUR_MS = 60 * 60 * 1000;

function newT() {
  return convexTest(schema, modules);
}

type T = ReturnType<typeof newT>;

/** Direct schema-validated insert — insertion order IS `_creationTime` order in
 *  convex-test (strictly monotonic), matching production where createdAt/ts are
 *  written as Date.now() inside the inserting transaction. Insert oldest first. */
async function insertRoom(t: T, opts: { status: "live" | "ended"; createdAt: number; code?: string }) {
  return await t.run(async (ctx) =>
    ctx.db.insert("rooms", {
      code: opts.code ?? `RM${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Metrics scenario room",
      hostId: "host-1",
      autoAllow: true,
      status: opts.status,
      createdAt: opts.createdAt,
    }));
}

async function insertTraces(t: T, roomId: unknown, rows: Array<{ ts: number; type: string }>) {
  await t.run(async (ctx) => {
    for (const row of rows) {
      await ctx.db.insert("traces", {
        roomId: roomId as never,
        ts: row.ts,
        actor: AGENT,
        type: row.type,
        summary: `${row.type} @ ${row.ts}`,
      });
    }
  });
}

describe("metrics.landingMetrics — bounded, honest landing counts", () => {
  it("cold start: a fresh deployment reports zeros, uncapped (no fake floor)", async () => {
    const t = newT();
    const result = await t.query(metricsApi.landingMetrics, {});
    expect(result.roomsLive).toEqual({ value: 0, capped: false });
    expect(result.cellsCommittedToday).toEqual({ value: 0, capped: false });
  });

  it("active day: counts only live rooms from the last 24h and only today's edit_applied traces (midnight inclusive)", async () => {
    const t = newT();
    const now = Date.now();
    const midnight = utcMidnight(now);
    const yesterday = midnight - 60_000;
    const stale = now - 25 * HOUR_MS;

    // Oldest first, mirroring production creation order.
    await insertRoom(t, { status: "live", createdAt: stale }); // live but >24h old — excluded
    await insertRoom(t, { status: "live", createdAt: stale });
    const roomId = await insertRoom(t, { status: "live", createdAt: now - 2 * HOUR_MS });
    await insertRoom(t, { status: "live", createdAt: now - HOUR_MS });
    await insertRoom(t, { status: "live", createdAt: now - 1000 });
    await insertRoom(t, { status: "ended", createdAt: now - 1000 }); // recent but ended — excluded
    await insertRoom(t, { status: "ended", createdAt: now - 1000 });

    // Today-side timestamps are clamped to >= midnight: when the suite runs
    // shortly after UTC midnight, `now - HOUR_MS` would otherwise be yesterday
    // (a real time-of-day flake, caught live at 00:53 UTC).
    const today = (offsetMs: number) => Math.max(midnight, now - offsetMs);
    await insertTraces(t, roomId, [
      { ts: yesterday, type: "edit_applied" }, // yesterday — excluded
      { ts: yesterday, type: "edit_applied" },
      { ts: yesterday, type: "edit_applied" },
      { ts: midnight, type: "edit_applied" }, // exactly UTC midnight — INCLUDED (>=)
      { ts: today(HOUR_MS), type: "edit_applied" },
      { ts: today(60_000), type: "edit_applied" },
      { ts: today(1000), type: "edit_applied" },
      { ts: today(500), type: "message_posted" }, // today but not a cell commit — excluded
      { ts: today(400), type: "lock_acquired" },
    ]);

    const result = await t.query(metricsApi.landingMetrics, {});
    expect(result.roomsLive).toEqual({ value: 3, capped: false });
    expect(result.cellsCommittedToday).toEqual({ value: 4, capped: false });
  });

  it("agent-burst overflow: >1000 today-commits and >200 fresh live rooms clamp at the caps with capped=true", async () => {
    const t = newT();
    const now = Date.now();
    const midnight = utcMidnight(now);
    const todayTs = Math.max(midnight, now - HOUR_MS);

    // 220 live rooms opened today — an onboarding spike.
    let roomId: unknown;
    for (let i = 0; i < ROOMS_SCAN_CAP + 20; i++) {
      roomId = await insertRoom(t, { status: "live", createdAt: now - 1000 });
    }
    // An agent loop committing cells at machine rate: 1100 edit_applied today.
    const burst = Array.from({ length: TRACES_SCAN_CAP + 100 }, (_, i) => ({ ts: todayTs + i, type: "edit_applied" }));
    await insertTraces(t, roomId, burst);

    const result = await t.query(metricsApi.landingMetrics, {});
    // BOUND: values never exceed the scan caps regardless of table size.
    expect(result.roomsLive.value).toBe(ROOMS_SCAN_CAP);
    expect(result.roomsLive.capped).toBe(true);
    expect(result.cellsCommittedToday.value).toBe(TRACES_SCAN_CAP);
    expect(result.cellsCommittedToday.capped).toBe(true);
    // The UI contract: capped renders as "1,000+" — value + suffix, never inflated.
    expect(`${result.cellsCommittedToday.value.toLocaleString("en-US")}+`).toBe("1,000+");
  });

  it("honest boundary: a FULL scan that reaches past the time window is exact — capped stays false", async () => {
    const t = newT();
    const now = Date.now();
    const midnight = utcMidnight(now);
    const yesterday = midnight - 60_000;
    const stale = now - 25 * HOUR_MS;
    const todayTs = Math.max(midnight, now - HOUR_MS);

    // Rooms: 30 stale first, then 190 fresh live → 220 total. The 200-row scan
    // includes some stale rows, proving the whole 24h window was covered.
    for (let i = 0; i < 30; i++) await insertRoom(t, { status: "live", createdAt: stale });
    let roomId: unknown;
    for (let i = 0; i < 190; i++) {
      roomId = await insertRoom(t, { status: "live", createdAt: now - 1000 });
    }

    // Traces: 400 yesterday commits first, then 800 today → 1200 total. The
    // 1000-row scan reads 800 today + 200 yesterday: the today-count is EXACT.
    const oldRows = Array.from({ length: 400 }, () => ({ ts: yesterday, type: "edit_applied" }));
    const todayRows = Array.from({ length: 800 }, (_, i) => ({ ts: todayTs + i, type: "edit_applied" }));
    await insertTraces(t, roomId, oldRows);
    await insertTraces(t, roomId, todayRows);

    const result = await t.query(metricsApi.landingMetrics, {});
    expect(result.roomsLive).toEqual({ value: 190, capped: false });
    expect(result.cellsCommittedToday).toEqual({ value: 800, capped: false });
  });
});
