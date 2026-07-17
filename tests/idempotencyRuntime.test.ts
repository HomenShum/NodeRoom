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
import { verifyAgentStepChain } from "../convex/agentStepChain";

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

test("RUNTIME: overlapping journal retries claim each provider step once and preserve unjournaled residual spend", async () => {
  const t = convexTest(schema, modules);
  const { roomId, jobId } = await t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", { code: "TEST04", title: "Replay accounting", hostId: "u1", autoAllow: true, status: "live" as const, createdAt: now });
    const artifactId = await ctx.db.insert("artifacts", { roomId, kind: "sheet" as const, title: "Replay", version: 1, order: [], updatedAt: now });
    const jobId = await ctx.db.insert("agentJobs", {
      roomId,
      artifactId,
      requester: { kind: "user" as const, id: "u1", name: "User" },
      goal: "Finish a journal-backed workbook slice",
      status: "running" as const,
      modelPolicy: "provider/model",
      attempts: 1,
      maxAttempts: 4,
      leaseId: "lease-record",
      leaseUntil: now + 60_000,
      createdAt: now,
      updatedAt: now,
    });
    const entries = [
      { step: 0, outputHash: "hash-a", usage: { inputTokens: 100, outputTokens: 40, cachedInputTokens: 20, cacheCreationInputTokens: 0, modelCalls: 1, costUsd: 0.01, costKind: "exact" as const } },
      { step: 1, outputHash: "hash-b", usage: { inputTokens: 120, outputTokens: 50, cachedInputTokens: 0, cacheCreationInputTokens: 0, modelCalls: 1, costUsd: 0.02, costKind: "exact" as const } },
    ];
    for (const entry of entries) {
      await ctx.db.insert("agentModelStepJournal", {
        jobId,
        sliceKey: "slice-1",
        step: entry.step,
        model: "provider/model",
        inputHash: "slice-1",
        outputHash: entry.outputHash,
        result: { text: `step-${entry.step}`, toolCalls: [], done: false, usage: entry.usage },
        createdAt: now,
        updatedAt: now,
      });
    }
    return { roomId, jobId };
  });
  const base = {
    jobId,
    roomId,
    leaseId: "lease-record",
    attempt: 1,
    journalSliceKey: "slice-1",
    agentId: "agent_pub",
    model: "provider/model",
    goal: "Finish a journal-backed workbook slice",
    steps: 3,
    traceSteps: [{
      idx: 0,
      tool: "model_result",
      args: "{}",
      result: "done",
      status: "ok" as const,
      ms: 50,
    }],
    toolCalls: 4,
    conflictsSurvived: 0,
    costKind: "exact" as const,
    ms: 900,
    exhausted: false,
    stopReason: "done",
  };

  const first = await t.mutation(internal.agentRuns.recordJournaled, {
    ...base,
    recordKey: "durable-run:first",
    traceSteps: [{
      idx: 0,
      tool: "inspect_workbook",
      args: "{}",
      result: "inspected",
      status: "ok" as const,
      ms: 50,
      affectedObjectIds: ["cell:A1"],
    }],
    // Pending + matching durable row models journal commit followed by a lost response.
    journalClaims: [{ step: 0, outputHash: "hash-a", state: "pending" as const }],
    modelCalls: 1,
    inputTokens: 100,
    outputTokens: 40,
    cachedInputTokens: 20,
    cacheCreationInputTokens: 0,
    costUsd: 0.01,
  });
  const secondArgs = {
    ...base,
    recordKey: "durable-run:second",
    journalClaims: [
      { step: 0, outputHash: "hash-a", state: "confirmed" as const },
      { step: 1, outputHash: "hash-b", state: "confirmed" as const },
    ],
    // Logical usage rematerializes A+B, plus one unjournaled failed provider request.
    modelCalls: 3,
    inputTokens: 230,
    outputTokens: 95,
    cachedInputTokens: 20,
    cacheCreationInputTokens: 0,
    costUsd: 0.035,
  };
  const second = await t.mutation(internal.agentRuns.recordJournaled, secondArgs);
  const exactReplay = await t.mutation(internal.agentRuns.recordJournaled, secondArgs);
  const roomSpend = await t.query(internal.agentRuns.roomSpendSince, { roomId, since: 0 });
  const globalSpend = await t.query(internal.agentRuns.globalSpendSince, { since: 0 });
  const journalRows = await t.run((ctx) => ctx.db.query("agentModelStepJournal").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
  const job = await t.run((ctx) => ctx.db.get(jobId));
  const firstRun = await t.run((ctx) => ctx.db.get(first.runId));
  const firstTraceRows = await t.run((ctx) => ctx.db.query("agentSteps").withIndex("by_run", (q) => q.eq("runId", first.runId)).collect());

  expect(first.accounting).toMatchObject({ modelCalls: 1, inputTokens: 100, outputTokens: 40, costUsd: 0.01 });
  // A is replayed and excluded. The second row contains B plus only the real unjournaled failure.
  expect(second.accounting).toMatchObject({ modelCalls: 2, inputTokens: 130, outputTokens: 55 });
  expect(second.accounting.costUsd).toBeCloseTo(0.025);
  expect(String(exactReplay.runId)).toBe(String(second.runId));
  expect(exactReplay.reused).toBe(true);
  expect(second.jobAccounting).toMatchObject({ modelCalls: 3, inputTokens: 230, outputTokens: 95 });
  expect(second.jobAccounting.costUsd).toBeCloseTo(0.035);
  expect(job).toMatchObject({ modelCallCount: 3, toolCallCount: 8, inputTokens: 230, outputTokens: 95, costKind: "exact" });
  expect(job?.costUsd).toBeCloseTo(0.035);
  expect(roomSpend).toBeCloseTo(0.035);
  expect(globalSpend.totalUsd).toBeCloseTo(0.035);
  expect(globalSpend.runCount).toBe(2);
  expect(journalRows.every((row) => row.accountedRunId)).toBe(true);
  expect(firstRun?.traceRecordCount).toBe(1);
  expect(firstTraceRows).toHaveLength(1);
  expect(await verifyAgentStepChain({
    jobId,
    runId: first.runId,
    roomId,
    agentId: "agent_pub",
    expectedCount: firstRun?.traceRecordCount,
    rows: firstTraceRows,
    hashes: firstTraceRows,
  })).toEqual({ valid: true, steps: 1 });
  const tamperedTrace = firstTraceRows.map((row) => ({ ...row, affectedObjectIds: ["cell:B9"] }));
  expect(await verifyAgentStepChain({
    jobId,
    runId: first.runId,
    roomId,
    agentId: "agent_pub",
    expectedCount: firstRun?.traceRecordCount,
    rows: tamperedTrace,
    hashes: firstTraceRows,
  })).toMatchObject({ valid: false, reason: "record hash mismatch - tampered" });
  const wrongJobTrace = firstTraceRows.map((row) => ({ ...row, jobId: undefined }));
  expect(await verifyAgentStepChain({
    jobId,
    runId: first.runId,
    roomId,
    agentId: "agent_pub",
    expectedCount: firstRun?.traceRecordCount,
    rows: wrongJobTrace,
    hashes: firstTraceRows,
  })).toMatchObject({ valid: false, reason: "trace_identity_mismatch" });

  await expect(t.mutation(internal.agentRuns.recordJournaled, {
    ...secondArgs,
    recordKey: "durable-run:mismatch",
    journalClaims: [{ step: 0, outputHash: "wrong", state: "confirmed" as const }],
  })).rejects.toThrow("agent_run_journal_claim_mismatch");

  await t.run((ctx) => ctx.db.patch(jobId, {
    leaseId: "lease-record-2",
    leaseUntil: Date.now() + 60_000,
  }));
  await expect(t.mutation(internal.agentRuns.recordJournaled, {
    ...secondArgs,
    recordKey: "durable-run:stale-lease",
  })).rejects.toThrow("agent_run_lease_invalid");

  await t.run((ctx) => ctx.db.patch(jobId, { attempts: 2 }));
  await expect(t.mutation(internal.agentRuns.recordJournaled, {
    ...secondArgs,
    leaseId: "lease-record-2",
    recordKey: "durable-run:stale-attempt",
  })).rejects.toThrow("agent_run_attempt_mismatch");
  await expect(t.mutation(internal.agentRuns.recordJournaled, {
    ...secondArgs,
    leaseId: "lease-record-2",
    attempt: 2,
    recordKey: "durable-run:empty-trace",
    traceSteps: [],
  })).rejects.toThrow("agent_run_trace_empty");
});

test("RUNTIME: agent step trace replay is idempotent and rejects divergent chains", async () => {
  const t = convexTest(schema, modules);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", { code: "TEST05", title: "Trace replay", hostId: "u1", autoAllow: true, status: "live" as const, createdAt: Date.now() }));
  const runId = await t.mutation(internal.agentRuns.record, {
    roomId,
    agentId: "agent_pub",
    model: "provider/model",
    goal: "Trace once",
    steps: 1,
    modelCalls: 1,
    toolCalls: 1,
    conflictsSurvived: 0,
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.001,
    costKind: "estimated",
    ms: 100,
    exhausted: false,
    stopReason: "done",
  });
  const args = {
    runId,
    roomId,
    agentId: "agent_pub",
    steps: [{ idx: 0, tool: "inspect_workbook", args: "{}", result: "ok", status: "ok" as const, ms: 50 }],
  };
  const incompleteRun = await t.run((ctx) => ctx.db.get(runId));
  expect(await verifyAgentStepChain({
    runId,
    roomId,
    agentId: "agent_pub",
    expectedCount: incompleteRun?.traceRecordCount,
    rows: [],
    hashes: [],
  })).toMatchObject({ valid: false, reason: "trace_count_unavailable" });
  expect(await verifyAgentStepChain({
    runId,
    roomId,
    agentId: "agent_pub",
    expectedCount: 0,
    rows: [],
    hashes: [],
  })).toMatchObject({ valid: false, reason: "trace_empty" });
  expect(await t.mutation(internal.agentSteps.record, args)).toEqual({ reused: false, inserted: 1 });
  expect(await t.mutation(internal.agentSteps.record, args)).toEqual({ reused: true, inserted: 0 });
  const rows = await t.run((ctx) => ctx.db.query("agentSteps").withIndex("by_run", (q) => q.eq("runId", runId)).collect());
  expect(rows).toHaveLength(1);
  await expect(t.mutation(internal.agentSteps.record, {
    ...args,
    steps: [{ ...args.steps[0], result: "different" }],
  })).rejects.toThrow("agent_steps_replay_mismatch");
});
