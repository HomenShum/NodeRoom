// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { ConvexRoomTools } from "../convex/convexRoomTools";
import { hashToken } from "../convex/lib";
import type { RoomTools } from "../src/nodeagent/core/types";
import { workbookSessionTool } from "../src/nodeagent/skills/spreadsheet/workbookSessionTool";

const modules = import.meta.glob("../convex/**/*.ts");
for (const modulePath of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts", "../convex/capturesNode.ts"]) {
  delete (modules as Record<string, unknown>)[modulePath];
}

const stateRef = makeFunctionReference<"query">("workbookSessions:state") as any;
const stageRef = makeFunctionReference<"mutation">("workbookSessions:stage") as any;
const discardRef = makeFunctionReference<"mutation">("workbookSessions:discard") as any;
const beginPublishRef = makeFunctionReference<"mutation">("workbookSessions:beginPublish") as any;
const progressRef = makeFunctionReference<"mutation">("workbookSessions:recordPublishProgress") as any;
const finishPublishRef = makeFunctionReference<"mutation">("workbookSessions:finishPublish") as any;

const agent = { kind: "agent" as const, id: "nodeagent:test", name: "NodeAgent", scope: "public" as const };
const HOST_TOKEN = "workbook-session-host-token-0123456789";

async function seedWorkbook(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: `WB${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Workbook session",
      hostId: "pending",
      autoAllow: false,
      status: "live",
      createdAt: now,
    });
    const memberId = await ctx.db.insert("members", {
      roomId,
      name: "Host",
      role: "host",
      anon: false,
      color: "#9f4f2a",
      authTokenHash: await hashToken(HOST_TOKEN),
      lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: String(memberId) });
    const artifactId = await ctx.db.insert("artifacts", {
      roomId,
      kind: "sheet",
      title: "Model",
      version: 1,
      order: ["A1", "B1"],
      meta: { excelGrid: { rows: 1, columns: 2 } },
      updatedAt: now,
    });
    await ctx.db.insert("elements", { artifactId, elementId: "A1", value: 10, version: 1, updatedAt: now, updatedBy: agent });
    await ctx.db.insert("elements", { artifactId, elementId: "B1", value: 20, version: 1, updatedAt: now, updatedBy: agent });
    const jobId = await ctx.db.insert("agentJobs", {
      roomId,
      artifactId,
      requester: { kind: "user", id: String(memberId), name: "Host" },
      goal: "Update the governed model",
      status: "running",
      modelPolicy: "test",
      attempts: 1,
      maxAttempts: 2,
      createdAt: now,
      updatedAt: now,
    });
    const sessionId = await ctx.db.insert("agentSessions", {
      roomId,
      jobId,
      agentId: agent.id,
      agentName: agent.name,
      scope: "public",
      status: "idle",
      lastAction: "test",
      updatedAt: now,
    });
    return {
      roomId,
      artifactId,
      jobId,
      sessionId,
      hostProof: { actor: { kind: "user" as const, id: String(memberId), name: "Host" }, token: HOST_TOKEN },
    };
  });
}

async function seedUnrelatedDraftRows(
  t: ReturnType<typeof convexTest>,
  scope: Awaited<ReturnType<typeof seedWorkbook>>,
  status: "pending" | "proposed",
  count = 70,
) {
  await t.run(async (ctx) => {
    const now = Date.now();
    for (let index = 0; index < count; index += 1) {
      await ctx.db.insert("agentDraftOperations", {
        jobId: scope.jobId,
        roomId: scope.roomId,
        artifactId: scope.artifactId,
        commandId: `unrelated-${status}-${index}`,
        proposedBy: agent,
        operationName: "unrelated.operation",
        input: {},
        affectedIds: [],
        status,
        createdAt: now + index,
      });
    }
  });
}

describe("workbook_session tool contract", () => {
  it("rejects unbounded reads and unsupported formulas before reaching RoomTools", async () => {
    const workbookSession = vi.fn();
    const rt = { workbookSession } as unknown as RoomTools;
    const oversized = await workbookSessionTool.execute({
      action: "read",
      commandId: "read-too-much",
      range: { start: "A1", end: "Z20" },
    }, rt) as any;
    const formula = await workbookSessionTool.execute({
      action: "stage",
      commandId: "stage-bad-formula",
      expectedRevision: 0,
      operations: [{ elementId: "A1", value: "=IMPORTXML(\"https://example.com\")" }],
    }, rt) as any;
    expect(oversized).toMatchObject({ ok: false, reason: "workbook_read_limit:256" });
    expect(formula).toMatchObject({ ok: false, reason: "unsupported_workbook_formula:#NAME?" });
    expect(workbookSession).not.toHaveBeenCalled();
  });

  it("normalizes bounded A1 edits and reports unsupported runtimes honestly", async () => {
    const workbookSession = vi.fn(async (request) => ({ ok: true, action: request.action, revision: 1, pendingCount: 1 }));
    const result = await workbookSessionTool.execute({
      action: "stage",
      commandId: "stage-1",
      expectedRevision: 0,
      operations: [{ elementId: "$a$1", value: "=SUM(B1:B2)" }],
    }, { workbookSession } as unknown as RoomTools);
    expect(result).toMatchObject({ ok: true, action: "stage", revision: 1 });
    expect(workbookSession).toHaveBeenCalledWith(expect.objectContaining({ operations: [{ elementId: "A1", value: "=SUM(B1:B2)" }] }));

    const unavailable = await workbookSessionTool.execute({ action: "preview", commandId: "preview-1" }, {} as RoomTools);
    expect(unavailable).toMatchObject({ ok: false, reason: "workbook_session_unavailable" });
  });
});

describe("workbook session persistence", () => {
  it("counts workbook stages independently of unrelated bounded draft rows", async () => {
    const t = convexTest(schema, modules);
    const scope = await seedWorkbook(t);
    await seedUnrelatedDraftRows(t, scope, "pending");
    const args = { roomId: scope.roomId, artifactId: scope.artifactId, jobId: scope.jobId, actor: agent };

    expect(await t.mutation(stageRef, {
      ...args,
      commandId: "stage-a",
      expectedRevision: 0,
      reason: "first cell",
      operations: [{ elementId: "A1", value: 11, baseVersion: 1, beforeValue: 10 }],
    })).toMatchObject({ ok: true, revision: 1, pendingCount: 1 });
    expect(await t.mutation(stageRef, {
      ...args,
      commandId: "stage-b",
      expectedRevision: 1,
      reason: "second cell",
      operations: [{ elementId: "B1", value: 21, baseVersion: 1, beforeValue: 20 }],
    })).toMatchObject({ ok: true, revision: 2, pendingCount: 2 });
    expect(await t.query(stateRef, args)).toMatchObject({ revision: 2, pendingCount: 2 });
  });

  it("rejects workbook mutations after a durable job is blocked", async () => {
    const t = convexTest(schema, modules);
    const scope = await seedWorkbook(t);
    await t.run((ctx) => ctx.db.patch(scope.jobId, { status: "blocked", error: "launch_admission:global_pause" }));
    await expect(t.mutation(stageRef, {
      roomId: scope.roomId,
      artifactId: scope.artifactId,
      jobId: scope.jobId,
      actor: agent,
      commandId: "blocked-stage",
      expectedRevision: 0,
      reason: "must not write",
      operations: [{ elementId: "A1", value: 11, baseVersion: 1, beforeValue: 10 }],
    })).rejects.toThrow("workbook_job_terminal");
  });

  it("uses revision CAS, enforces command idempotency, and discards pending patches", async () => {
    const t = convexTest(schema, modules);
    const scope = await seedWorkbook(t);
    const args = { roomId: scope.roomId, artifactId: scope.artifactId, jobId: scope.jobId, actor: agent };
    const first = await t.mutation(stageRef, {
      ...args,
      commandId: "stage-1",
      expectedRevision: 0,
      reason: "update assumptions",
      operations: [{ elementId: "A1", value: 11, baseVersion: 1, beforeValue: 10 }],
    });
    const duplicate = await t.mutation(stageRef, {
      ...args,
      commandId: "stage-1",
      expectedRevision: 0,
      reason: "update assumptions",
      operations: [{ elementId: "A1", value: 11, baseVersion: 1, beforeValue: 10 }],
    });
    const stale = await t.mutation(stageRef, {
      ...args,
      commandId: "stage-stale",
      expectedRevision: 0,
      reason: "stale command",
      operations: [{ elementId: "B1", value: 21, baseVersion: 1, beforeValue: 20 }],
    });
    expect(first).toMatchObject({ ok: true, revision: 1, pendingCount: 1 });
    expect(duplicate).toMatchObject({ ok: true, revision: 1, idempotent: true });
    expect(stale).toMatchObject({ ok: false, revision: 1, reason: "workbook_revision_conflict" });

    const state = await t.query(stateRef, args);
    expect(state).toMatchObject({ revision: 1, status: "active", pendingCount: 1 });
    expect(state.operations[0]).toMatchObject({ elementId: "A1", value: 11, baseVersion: 1 });

    const discarded = await t.mutation(discardRef, { ...args, commandId: "discard-1", expectedRevision: 1, reason: "changed plan" });
    const duplicateDiscard = await t.mutation(discardRef, { ...args, commandId: "discard-1", expectedRevision: 1, reason: "changed plan" });
    expect(discarded).toMatchObject({ ok: true, revision: 2, pendingCount: 0 });
    expect(duplicateDiscard).toMatchObject({ ok: true, revision: 2, idempotent: true });
    expect(await t.query(stateRef, args)).toMatchObject({ revision: 2, pendingCount: 0 });

    const rows = await t.run(async (ctx) => ctx.db.query("agentDraftOperations").withIndex("by_job_status", (q) => q.eq("jobId", scope.jobId).eq("status", "rejected")).collect());
    expect(rows).toHaveLength(1);
  });

  it("persists publish progress and closes the session without claiming atomicity", async () => {
    const t = convexTest(schema, modules);
    const scope = await seedWorkbook(t);
    const args = { roomId: scope.roomId, artifactId: scope.artifactId, jobId: scope.jobId, actor: agent };
    const executorToken = "executor-publish-1";
    await t.mutation(stageRef, {
      ...args,
      commandId: "stage-batch",
      expectedRevision: 0,
      reason: "two-cell patch",
      operations: [
        { elementId: "A1", value: 11, baseVersion: 1, beforeValue: 10 },
        { elementId: "B1", value: 22, baseVersion: 1, beforeValue: 20 },
      ],
    });
    const prepared = await t.mutation(beginPublishRef, { ...args, commandId: "publish-1", expectedRevision: 1, executorToken, reason: "submit for review" });
    expect(prepared).toMatchObject({ ok: true, phase: "prepared", revision: 1, pendingCount: 2 });
    const publishOperationId = (prepared as any).publishOperationId;
    const outcomes = [
      { elementId: "A1", status: "proposed", proposalId: "proposal-a" },
      { elementId: "B1", status: "applied", version: 2 },
    ];
    await t.mutation(progressRef, { jobId: scope.jobId, artifactId: scope.artifactId, commandId: "publish-1", publishOperationId, executorToken, outcomes: outcomes.slice(0, 1) });
    const finished = await t.mutation(finishPublishRef, {
      ...args,
      commandId: "publish-1",
      publishOperationId,
      executorToken,
      resolution: "proposed",
      outcomes,
    });
    expect(finished).toMatchObject({ ok: true, action: "publish", revision: 2, pendingCount: 0, outcomes });
    expect(await t.query(stateRef, args)).toMatchObject({ revision: 2, status: "awaiting_approval", pendingCount: 0 });

    const duplicate = await t.mutation(beginPublishRef, { ...args, commandId: "publish-1", expectedRevision: 1, executorToken: "executor-retry", reason: "submit for review" });
    expect(duplicate).toMatchObject({ ok: true, revision: 2, idempotent: true, outcomes });
  });

  it("publishes through real locks and proposals, then follows host reject and approve", async () => {
    const t = convexTest(schema, modules);
    const scope = await seedWorkbook(t);
    await seedUnrelatedDraftRows(t, scope, "proposed");
    const actionCtx = {
      runQuery: (reference: any, args: any) => t.query(reference, args),
      runMutation: (reference: any, args: any) => t.mutation(reference, args),
      runAction: (reference: any, args: any) => t.action(reference, args),
    } as any;
    const rt = new ConvexRoomTools(actionCtx, scope.roomId, scope.artifactId, agent, String(scope.sessionId), scope.jobId);
    const stateArgs = { roomId: scope.roomId, artifactId: scope.artifactId, jobId: scope.jobId, actor: agent };

    expect(await rt.workbookSession({
      action: "stage",
      commandId: "stage-reject",
      expectedRevision: 0,
      operations: [{ elementId: "A1", value: 11 }],
    })).toMatchObject({ ok: true, revision: 1 });
    const proposed = await rt.workbookSession({ action: "publish", commandId: "publish-reject", expectedRevision: 1 });
    expect(proposed).toMatchObject({ ok: true, revision: 2, outcomes: [{ elementId: "A1", status: "proposed" }] });
    expect((await t.query(stateRef, stateArgs)).status).toBe("awaiting_approval");
    const firstProposal = await t.run(async (ctx) => ctx.db.query("proposals").withIndex("by_room_status", (q) => q.eq("roomId", scope.roomId).eq("status", "pending")).first());
    if (!firstProposal) throw new Error("expected workbook proposal");
    await t.mutation(api.artifacts.resolveProposal, { proposalId: firstProposal._id, approve: false, requester: scope.hostProof });
    expect((await t.query(stateRef, stateArgs)).status).toBe("active");
    expect((await t.run(async (ctx) => ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", scope.artifactId).eq("elementId", "A1")).first()))?.value).toBe(10);

    const afterReject = await t.query(stateRef, stateArgs);
    expect(await rt.workbookSession({
      action: "stage",
      commandId: "stage-approve",
      expectedRevision: afterReject.revision,
      operations: [{ elementId: "B1", value: 22 }],
    })).toMatchObject({ ok: true });
    const beforeApprovePublish = await t.query(stateRef, stateArgs);
    const secondPublish = await rt.workbookSession({ action: "publish", commandId: "publish-approve", expectedRevision: beforeApprovePublish.revision });
    expect(secondPublish).toMatchObject({ ok: true, outcomes: [{ elementId: "B1", status: "proposed" }] });
    const secondProposal = await t.run(async (ctx) => ctx.db.query("proposals").withIndex("by_room_status", (q) => q.eq("roomId", scope.roomId).eq("status", "pending")).first());
    if (!secondProposal) throw new Error("expected second workbook proposal");
    await t.mutation(api.artifacts.resolveProposal, { proposalId: secondProposal._id, approve: true, requester: scope.hostProof });
    const b1 = await t.run(async (ctx) => ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", scope.artifactId).eq("elementId", "B1")).first());
    expect(b1).toMatchObject({ value: 22, version: 2 });
    expect((await t.query(stateRef, stateArgs)).status).toBe("active");
    const activeLocks = await t.run(async (ctx) => ctx.db.query("locks").withIndex("by_room_status", (q) => q.eq("roomId", scope.roomId).eq("status", "active")).collect());
    expect(activeLocks).toHaveLength(0);
  });
});
