// @vitest-environment edge-runtime
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { hashToken } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const auditRecordRef = makeFunctionReference<"mutation">("auditLog:record") as any;
const auditListRef = makeFunctionReference<"query">("auditLog:list") as any;
const securityRecordRef = makeFunctionReference<"mutation">("securityEvents:record") as any;
const securityListRef = makeFunctionReference<"query">("securityEvents:list") as any;
const usageSnapshotRef = makeFunctionReference<"query">("usageLimits:roomUsageSnapshot") as any;
const assertBudgetRef = makeFunctionReference<"query">("usageLimits:assertRoomBudget") as any;
const exportManifestRef = makeFunctionReference<"query">("exportDelete:roomExportManifest") as any;
const deletionRequestRef = makeFunctionReference<"mutation">("exportDelete:requestRoomDeletion") as any;
const retentionPolicyRef = makeFunctionReference<"query">("retention:telemetryRetentionPolicy") as any;

const HOST_TOKEN = "host-security-token-0123456789abcdef";

describe("Convex production-readiness surfaces", () => {
  it("records auditable security events on room-scoped append-only traces", async () => {
    const { t, roomId, hostActor, hostProof } = await setupRoom();

    const first = await t.mutation(auditRecordRef, {
      roomId,
      actor: hostActor,
      event: "agent_work_plan_approved",
      subject: "plan:abc",
      payload: { planHash: "abc" },
    });
    const second = await t.mutation(auditRecordRef, {
      roomId,
      actor: hostActor,
      event: "agent_job_started",
      subject: "job:1",
      payload: { planHash: "abc" },
      previousHash: first.recordHash,
    });
    expect(second.recordHash).not.toBe(first.recordHash);

    await t.mutation(securityRecordRef, {
      roomId,
      actor: hostActor,
      category: "prompt_injection",
      severity: "warn",
      event: "fence_signal_detected",
      reason: "ignore_previous",
    });

    const auditRows = await t.query(auditListRef, { roomId, requester: hostProof });
    expect(auditRows.map((row: { type: string }) => row.type)).toContain("audit:agent_job_started");
    const securityRows = await t.query(securityListRef, { roomId, requester: hostProof });
    expect(securityRows[0].summary).toContain("warn:prompt_injection:fence_signal_detected");
  });

  it("summarizes usage, retention policy, and privacy export/delete boundaries honestly", async () => {
    const { t, roomId, hostActor, hostProof } = await setupRoom();
    const now = Date.now();
    await t.run(async (ctx) => {
      const artifactId = await ctx.db.insert("artifacts", { roomId, kind: "sheet" as const, title: "Work", version: 1, order: [], updatedAt: now });
      await ctx.db.insert("messages", {
        roomId,
        channel: "public",
        author: hostActor,
        text: "hello",
        kind: "chat" as const,
        clientMsgId: "m1",
        createdAt: now,
      });
      await ctx.db.insert("agentRuns", {
        roomId,
        agentId: "agent_room",
        model: "m",
        goal: "g",
        steps: 1,
        toolCalls: 1,
        conflictsSurvived: 0,
        inputTokens: 1,
        outputTokens: 1,
        costUsd: 1.25,
        ms: 1,
        exhausted: false,
        createdAt: now,
      });
      await ctx.db.insert("agentJobs", {
        roomId,
        artifactId,
        requester: hostActor,
        goal: "g",
        status: "running" as const,
        modelPolicy: "test",
        attempts: 1,
        maxAttempts: 1,
        createdAt: now,
        updatedAt: now,
      });
    });

    const usage = await t.query(usageSnapshotRef, { roomId, requester: hostProof, now });
    expect(usage.dailyCostUsd).toBe(1.25);
    expect(usage.activeJobCount).toBe(1);
    const budget = await t.query(assertBudgetRef, { roomId, projectedUsd: 1, roomDailyLimitUsd: 2, since: now - 1_000 });
    expect(budget.ok).toBe(false);

    const policy = await t.query(retentionPolicyRef, {});
    expect(policy.prunableTables).toContain("traces");
    expect(policy.productDataNotPruned).toContain("messages");

    const manifest = await t.query(exportManifestRef, { roomId, requester: hostProof });
    expect(manifest.counts.messages).toBe(1);
    expect(manifest.note).toMatch(/Binary storage export/);

    const deletion = await t.mutation(deletionRequestRef, { roomId, requester: hostProof, reason: "test request" });
    expect(deletion.status).toBe("operator_runbook_required");
    const ended = await t.run((ctx) => ctx.db.get(roomId));
    expect(ended?.status).toBe("ended");
  });
});

async function setupRoom() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      code: "SEC001",
      title: "Security room",
      hostId: "",
      autoAllow: true,
      status: "live" as const,
      createdAt: now,
    }),
  );
  const hostId = await t.run(async (ctx) =>
    ctx.db.insert("members", {
      roomId,
      name: "Host",
      role: "host" as const,
      anon: false,
      color: "#111111",
      authTokenHash: await hashToken(HOST_TOKEN),
      lastSeenAt: now,
    }),
  );
  await t.run((ctx) => ctx.db.patch(roomId, { hostId }));
  const hostActor = { kind: "user" as const, id: String(hostId), name: "Host" };
  const hostProof = { actor: hostActor, token: HOST_TOKEN };
  return { t, roomId, hostActor, hostProof };
}
