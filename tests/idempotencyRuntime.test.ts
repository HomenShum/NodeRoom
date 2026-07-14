// @vitest-environment edge-runtime
/**
 * RUNTIME proof for idempotency (async_reliability layer 1) — runs the REAL Convex
 * claim/byKey/finish functions against an in-memory deployment (convex-test), no deploy.
 * Proves: a concurrent double-submit attaches to the in-flight run instead of racing a 2nd.
 */
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { runIdempotencyKey, findReusableRun } from "../src/nodeagent/core/idempotency";

// In-memory modules, EXCLUDING the "use node" action (AI SDK; not needed for the dedup data layer, won't load in edge-runtime).
const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"];

const mapRows = (rows: Array<{ _id: unknown; idempotencyKey?: string; stopReason?: string; createdAt: number }>) =>
  rows.map((r) => ({ runId: String(r._id), idempotencyKey: r.idempotencyKey, stopReason: r.stopReason, finishedAt: r.createdAt }));

test("RUNTIME: concurrent double-submit dedupes to the in-flight run; exactly one run row exists for the key", async () => {
  const t = convexTest(schema, modules);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", { code: "TEST01", title: "Idem test", hostId: "u1", autoAllow: true, status: "live" as const, createdAt: Date.now() }));

  const key = runIdempotencyKey({ roomId: String(roomId), artifactId: "artifact_x", actorId: "u1", goal: "Enrich pending rows" });

  // Submit #1 claims an in-flight run row (the REAL mutation).
  const runId1 = await t.mutation(internal.agentRuns.claim, { roomId, agentId: "agent_pub", model: "gpt-5.4-mini", goal: "Enrich pending rows", idempotencyKey: key });

  // Submit #2 (the concurrent double-click) runs the SAME guard the action runs: byKey → findReusableRun.
  const prior = await t.query(internal.agentRuns.byKey, { idempotencyKey: key });
  const reuse = findReusableRun(mapRows(prior), key, { now: Date.now() });
  expect(reuse?.runId).toBe(String(runId1));   // ← deduped to run #1, NOT a second run
  expect(reuse?.stopReason).toBeUndefined();    // it is in flight

  // Run #1 finishes by PATCHING the claimed row (not a 2nd insert) → still exactly one run for this key.
  await t.mutation(internal.agentRuns.finish, {
    runId: runId1,
    model: "gpt-5.4-mini",
    steps: 4,
    modelCalls: 2,
    toolCalls: 6,
    conflictsSurvived: 1,
    inputTokens: 200,
    outputTokens: 80,
    cachedInputTokens: 120,
    cacheCreationInputTokens: 15,
    costUsd: 0.0042,
    costKind: "estimated",
    ms: 1800,
    exhausted: false,
    stopReason: "done",
  });
  const after = await t.query(internal.agentRuns.byKey, { idempotencyKey: key });
  expect(after).toHaveLength(1);                 // ONE row total — no concurrent duplicate ran
  expect(after[0].stopReason).toBe("done");
  expect(after[0]).toMatchObject({
    modelCalls: 2,
    cachedInputTokens: 120,
    cacheCreationInputTokens: 15,
    costKind: "estimated",
  });

  // A rapid re-click within the recency window still dedupes (no double-bill); a different goal does NOT.
  expect(findReusableRun(mapRows(after), key, { now: Date.now() })?.runId).toBe(String(runId1));
  const otherKey = runIdempotencyKey({ roomId: String(roomId), artifactId: "artifact_x", actorId: "u1", goal: "a totally different goal" });
  expect(findReusableRun(mapRows(after), otherKey, { now: Date.now() })).toBeUndefined();
});

test("RUNTIME (atomic, race-safe): claimOrReuse — first inserts, second reuses the SAME run; exactly one row (no TOCTOU)", async () => {
  const t = convexTest(schema, modules);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", { code: "TEST02", title: "Atomic", hostId: "u1", autoAllow: true, status: "live" as const, createdAt: Date.now() }));
  const key = runIdempotencyKey({ roomId: String(roomId), artifactId: "art2", actorId: "u1", goal: "Enrich" });
  const base = { roomId, agentId: "agent_pub", model: "gpt-5.4-mini", goal: "Enrich", idempotencyKey: key };

  // Two submits hit the SINGLE serializable claim-or-reuse mutation (Convex serializes mutations,
  // so the 2nd sees the 1st's row — the race the two-step query+insert would lose).
  const first = await t.mutation(internal.agentRuns.claimOrReuse, base);
  expect(first.reused).toBe(false);                                   // first claims a fresh run
  const second = await t.mutation(internal.agentRuns.claimOrReuse, base);
  expect(second.reused).toBe(true);                                   // second reuses — no 2nd run
  expect(String(second.runId)).toBe(String(first.runId));
  expect(await t.query(internal.agentRuns.byKey, { idempotencyKey: key })).toHaveLength(1); // exactly one row
});

test("RUNTIME: agentRuns.record preserves explicit zero calls and cache accounting", async () => {
  const t = convexTest(schema, modules);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", { code: "TEST03", title: "Accounting", hostId: "u1", autoAllow: true, status: "live" as const, createdAt: Date.now() }));

  const runId = await t.mutation(internal.agentRuns.record, {
    roomId,
    agentId: "agent_pub",
    model: "provider-unavailable",
    goal: "Record a preflight failure",
    steps: 0,
    modelCalls: 0,
    toolCalls: 0,
    conflictsSurvived: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUsd: 0,
    costKind: "exact",
    ms: 12,
    exhausted: false,
    stopReason: "provider_unavailable",
  });
  const row = await t.run((ctx) => ctx.db.get(runId));

  expect(row).toMatchObject({
    modelCalls: 0,
    toolCalls: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    costKind: "exact",
  });
});
