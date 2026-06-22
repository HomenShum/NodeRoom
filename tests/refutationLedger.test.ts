// @vitest-environment edge-runtime
/**
 * Adversarial-refutation ledger tests — Tekton verdict pattern persisted on Convex.
 *
 * Doctrine under test: ALL outcomes persist (stands + refuted + uncertain). Failures are evidence,
 * not blemishes. Mutation is idempotent by claimId. BOUND cap evicts oldest entries.
 *
 * Agentic-reliability checklist this exercises: BOUND, HONEST_STATUS, AUTH gate, idempotency.
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hashToken, REFUTATIONS_MAX_PER_TASK } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST_TOKEN = "host-token-refutation-ledger-0123456789";
const OUTSIDER_TOKEN = "outsider-token-refutation-ledger-012345";

/** Seed: room + host member + one evalRuns row + one taskResults row. */
async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: `RR${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Refutation ledger room",
      hostId: "pending",
      autoAllow: true,
      status: "live" as const,
      createdAt: now,
    });
    const hostId = await ctx.db.insert("members", {
      roomId,
      name: "Host",
      role: "host" as const,
      anon: false,
      color: "#2E9E6B",
      authTokenHash: await hashToken(HOST_TOKEN),
      lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: String(hostId) });
    const hostActor = { kind: "user" as const, id: String(hostId), name: "Host" };
    const outsiderActor = { kind: "user" as const, id: "outsider", name: "Outsider" };
    const evalRunId = await ctx.db.insert("evalRuns", {
      roomId,
      iterationLabel: "incr-test-1",
      benchmark: "BankerToolBench",
      model: "test-model",
      materializerMode: "general-only",
      status: "running" as const,
      taskCount: 1,
      startedAt: now,
    });
    const taskResultId = await ctx.db.insert("taskResults", {
      roomId,
      evalRunId,
      taskId: "task-A",
      reward: 1,
      exceptions: 0,
      firedWriter: "generic-quartet",
      cleanGeneralProbe: true,
      modelCalls: 1,
      countsTowardHeadline: true,
      createdAt: now,
    });
    return {
      roomId,
      evalRunId,
      taskResultId,
      hostProof: { actor: hostActor, token: HOST_TOKEN },
      outsiderProof: { actor: outsiderActor, token: OUTSIDER_TOKEN },
    };
  });
}

type Outcome = "stands" | "refuted" | "uncertain";
function verdict(claimId: string, o: Outcome, confidence = 0.8, correctedValue?: string) {
  return {
    claimId,
    claim: `claim-${claimId}`,
    verdict: o,
    confidence,
    correctedValue,
    reasoning: `because ${claimId}`,
    refutedBy: "test verifier · fresh context",
  };
}

describe("recordRefutationVerdict + listRefutationsForRun", () => {
  it("records one verdict and lists it back, ordered by refutedAt", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const before = Date.now();
    const result = await t.mutation(api.evalRuns.recordRefutationVerdict, {
      roomId: s.roomId,
      evalRunId: s.evalRunId,
      taskId: "task-A",
      requester: s.hostProof,
      verdict: verdict("ship-bar", "stands", 0.95),
    });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);

    const listed = await t.query(api.evalRuns.listRefutationsForRun, {
      evalRunId: s.evalRunId,
      requester: s.hostProof,
    });
    expect(listed.verdicts).toHaveLength(1);
    const v = listed.verdicts[0];
    expect(v.taskId).toBe("task-A");
    expect(v.claimId).toBe("ship-bar");
    expect(v.verdict).toBe("stands");
    expect(v.refutedAt).toBeGreaterThanOrEqual(before);
  });

  it("persists ALL three outcomes (stands + refuted + uncertain) — failures are evidence", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    for (const v of [
      verdict("c1", "stands", 0.9),
      verdict("c2", "refuted", 0.92, "the verifier proposes 2 of 3"),
      verdict("c3", "uncertain", 0.55),
    ]) {
      await t.mutation(api.evalRuns.recordRefutationVerdict, {
        roomId: s.roomId, evalRunId: s.evalRunId, taskId: "task-A", requester: s.hostProof, verdict: v,
      });
    }
    const listed = await t.query(api.evalRuns.listRefutationsForRun, {
      evalRunId: s.evalRunId, requester: s.hostProof,
    });
    expect(listed.verdicts).toHaveLength(3);
    const outcomes = listed.verdicts.map((v) => v.verdict).sort();
    expect(outcomes).toEqual(["refuted", "stands", "uncertain"]);
    const refuted = listed.verdicts.find((v) => v.verdict === "refuted");
    expect(refuted?.correctedValue).toMatch(/2 of 3/);
  });

  it("is idempotent by claimId — re-record with same id replaces, never duplicates", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.mutation(api.evalRuns.recordRefutationVerdict, {
      roomId: s.roomId, evalRunId: s.evalRunId, taskId: "task-A", requester: s.hostProof,
      verdict: verdict("c1", "uncertain", 0.4),
    });
    // Re-record same claimId with a NEW verdict (e.g., a follow-up pass got more confident).
    await t.mutation(api.evalRuns.recordRefutationVerdict, {
      roomId: s.roomId, evalRunId: s.evalRunId, taskId: "task-A", requester: s.hostProof,
      verdict: verdict("c1", "refuted", 0.93, "corrected"),
    });
    const listed = await t.query(api.evalRuns.listRefutationsForRun, {
      evalRunId: s.evalRunId, requester: s.hostProof,
    });
    expect(listed.verdicts).toHaveLength(1);
    expect(listed.verdicts[0].verdict).toBe("refuted");
    expect(listed.verdicts[0].correctedValue).toBe("corrected");
  });

  it("clamps confidence outside [0,1] at the server boundary (HONEST_STATUS)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await t.mutation(api.evalRuns.recordRefutationVerdict, {
      roomId: s.roomId, evalRunId: s.evalRunId, taskId: "task-A", requester: s.hostProof,
      verdict: verdict("c-high", "stands", 1.7),
    });
    await t.mutation(api.evalRuns.recordRefutationVerdict, {
      roomId: s.roomId, evalRunId: s.evalRunId, taskId: "task-A", requester: s.hostProof,
      verdict: verdict("c-low", "refuted", -0.5),
    });
    const listed = await t.query(api.evalRuns.listRefutationsForRun, {
      evalRunId: s.evalRunId, requester: s.hostProof,
    });
    const byId = Object.fromEntries(listed.verdicts.map((v) => [v.claimId, v]));
    expect(byId["c-high"].confidence).toBe(1);
    expect(byId["c-low"].confidence).toBe(0);
  });

  it("enforces BOUND cap — newer verdicts evict the oldest above REFUTATIONS_MAX_PER_TASK", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    const N = REFUTATIONS_MAX_PER_TASK + 5;
    for (let i = 0; i < N; i++) {
      await t.mutation(api.evalRuns.recordRefutationVerdict, {
        roomId: s.roomId, evalRunId: s.evalRunId, taskId: "task-A", requester: s.hostProof,
        verdict: verdict(`c${i.toString().padStart(4, "0")}`, "stands", 0.7),
      });
    }
    const listed = await t.query(api.evalRuns.listRefutationsForRun, {
      evalRunId: s.evalRunId, requester: s.hostProof,
    });
    expect(listed.verdicts).toHaveLength(REFUTATIONS_MAX_PER_TASK);
    const oldest = listed.verdicts[0].claimId;
    const newest = listed.verdicts[listed.verdicts.length - 1].claimId;
    // The first 5 were evicted; the surviving range starts at c0005 and ends at the final insert.
    expect(oldest).toBe("c0005");
    expect(newest).toBe(`c${(N - 1).toString().padStart(4, "0")}`);
  });

  it("throws when the taskResult does not exist — no silent success", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await expect(
      t.mutation(api.evalRuns.recordRefutationVerdict, {
        roomId: s.roomId, evalRunId: s.evalRunId, taskId: "does-not-exist", requester: s.hostProof,
        verdict: verdict("c1", "stands"),
      }),
    ).rejects.toThrow(/taskResult not found/);
  });

  it("rejects non-member writers (AUTH gate)", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    await expect(
      t.mutation(api.evalRuns.recordRefutationVerdict, {
        roomId: s.roomId, evalRunId: s.evalRunId, taskId: "task-A", requester: s.outsiderProof,
        verdict: verdict("c1", "stands"),
      }),
    ).rejects.toThrow();
  });

  it("refutationSummaryForRun rolls up outcomes and average confidence", async () => {
    const t = convexTest(schema, modules);
    const s = await seed(t);
    for (const v of [
      verdict("c1", "stands", 0.9),
      verdict("c2", "stands", 0.8),
      verdict("c3", "refuted", 0.92),
      verdict("c4", "uncertain", 0.5),
    ]) {
      await t.mutation(api.evalRuns.recordRefutationVerdict, {
        roomId: s.roomId, evalRunId: s.evalRunId, taskId: "task-A", requester: s.hostProof, verdict: v,
      });
    }
    const summary = await t.query(api.evalRuns.refutationSummaryForRun, {
      evalRunId: s.evalRunId, requester: s.hostProof,
    });
    expect(summary).not.toBeNull();
    expect(summary!.total).toBe(4);
    expect(summary!.byOutcome).toEqual({ stands: 2, refuted: 1, uncertain: 1 });
    expect(summary!.avgConfidence).toBeCloseTo((0.9 + 0.8 + 0.92 + 0.5) / 4);
  });
});
