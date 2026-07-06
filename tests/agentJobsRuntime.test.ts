// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { internalAction } from "../convex/_generated/server";
import { v } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";
import workflowSchema from "../node_modules/@convex-dev/workflow/dist/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/dist/component/schema.js";

const modules = import.meta.glob("../convex/**/*.ts");
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/dist/component/**/*.js");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/dist/component/**/*.js");
delete (modules as Record<string, unknown>)["../convex/agent.ts"];
// agentJobRunner + embeddingRunner are "use node" actions convex-test (edge runtime) cannot bundle.
// Stub their scheduled entrypoints so scheduler.runAfter(internal.<runner>.*, ...) resolves to a
// no-op instead of throwing "Could not find module" as an unhandled rejection after assertions pass.
(modules as Record<string, unknown>)["../convex/agentJobRunner.ts"] = async () => ({
  runFreeAutoJobSlice: internalAction({ args: { jobId: v.id("agentJobs") }, handler: async () => null }),
});
(modules as Record<string, unknown>)["../convex/embeddingRunner.ts"] = async () => ({
  runOne: internalAction({ args: {}, handler: async () => null }),
});

const token = "0123456789abcdefghijklmnopqrstuvwxyzTOKEN";

describe("agentJobs runtime contract", () => {
  it("dedupes createOrReuse by idempotency key and records one creation operation", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const args = jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-dedupe" });

    const first = await t.mutation(api.agentJobs.createOrReuse, args);
    const second = await t.mutation(api.agentJobs.createOrReuse, args);

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(String(second.jobId)).toBe(String(first.jobId));

    const detail = await t.query(api.agentJobs.detail, { jobId: first.jobId, requester: proof });
    expect(detail?.operations.filter((event) => event.name === "agentJobs.createOrReuse")).toHaveLength(1);
    expect(detail?.job.mutationCount).toBe(1);
  });

  it("central durable start helper preserves workflow and inline job contracts", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom({ seedElement: true });

    const blockedStart = await t.mutation(api.agentJobs.start, {
      roomId,
      artifactId,
      requester: proof,
      goal: "Wait for human approval before changing anything.",
      entrypoint: "public_ask" as const,
      scope: "public_room" as const,
      routePolicy: "explicit" as const,
      runtimePolicy: "workflow_sliced" as const,
      modelPolicy: "test-model",
      idempotencyKey: "job-runtime-central-start",
      approvalPolicy: "auto_commit_safe" as const,
      evidencePolicy: "public_only" as const,
      traceLevel: "full_operation_ledger" as const,
      autoAllow: true,
      mode: "variance" as const,
    });

    expect(blockedStart).toMatchObject({
      reused: false,
      status: "blocked",
      modelPolicy: "test-model",
      routePolicy: "explicit",
      runtimePolicy: "workflow_sliced",
    });

    const blockedDetail = await t.query(api.agentJobs.detail, { jobId: blockedStart.jobId, requester: proof });
    expect(blockedDetail?.job).toMatchObject({
      entrypoint: "public_ask",
      scope: "public_room",
      routePolicy: "explicit",
      runtimePolicy: "workflow_sliced",
      modelPolicy: "test-model",
      runtime: "workflow",
    });
    expect(blockedDetail?.job.workflowId).toBeUndefined();
    expect(blockedDetail?.operations.map((event) => event.name)).toContain("agentJobs.start");

    const inline = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-central-inline" }));
    const claimed = await t.mutation(internal.agentJobs.claimSlice, { jobId: inline.jobId, leaseId: "lease-central-start", leaseMs: 60_000 });
    expect(claimed).toMatchObject({
      entrypoint: "public_ask",
      scope: "public_room",
      routePolicy: "explicit",
      runtimePolicy: "workflow_sliced",
      modelPolicy: "test-model",
      traceLevel: "standard",
    });
  });

  it("derives public job policy server-side instead of trusting client mutation fields", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom({ seedElement: true, autoAllow: false });

    const started = await t.mutation(api.agentJobs.start, {
      roomId,
      artifactId,
      requester: proof,
      goal: "Wait for the host before changing any cells.",
      entrypoint: "private_agent" as const,
      scope: "private_user" as const,
      routePolicy: "top_paid" as const,
      runtimePolicy: "workflow_sliced" as const,
      modelPolicy: "client-forced-model",
      idempotencyKey: "job-runtime-server-derived-policy",
      approvalPolicy: "auto_commit_safe" as const,
      evidencePolicy: "private_allowed" as const,
      traceLevel: "summary" as const,
      autoAllow: true,
      request: { forged: true, scope: "private_user", autoAllow: true },
      mode: "variance" as const,
    });

    const detail = await t.query(api.agentJobs.detail, { jobId: started.jobId, requester: proof });
    expect(detail?.job).toMatchObject({
      entrypoint: "public_ask",
      scope: "public_room",
      routePolicy: "top_paid",
      runtimePolicy: "workflow_sliced",
      approvalPolicy: "host_review",
      evidencePolicy: "public_only",
      traceLevel: "full_operation_ledger",
      autoAllow: false,
    });
    expect(detail?.job.modelPolicy).not.toBe("client-forced-model");
    expect(detail?.job.request).toMatchObject({
      entrypoint: "public_ask",
      scope: "public_room",
      routePolicy: "top_paid",
      approvalPolicy: "host_review",
      evidencePolicy: "public_only",
      traceLevel: "full_operation_ledger",
    });
    expect(detail?.job.request).not.toMatchObject({ forged: true });
  });

  it("starts public chat asks server-side against the active work-surface artifact", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom({ seedElement: true });

    const started = await t.mutation(api.agentJobs.startPublicAsk, {
      roomId,
      requester: proof,
      goal: "compute these 5 metrics and write the visible cells",
      contextArtifactId: String(artifactId),
      routePolicy: "fast_default" as const,
    });

    const detail = await t.query(api.agentJobs.detail, { jobId: started.jobId, requester: proof });
    expect(detail?.job.entrypoint).toBe("public_ask");
    expect(String(detail?.job.artifactId)).toBe(String(artifactId));
    expect(detail?.operations.map((event) => event.name)).toContain("agentJobs.start");
  });

  it("lets long official BTB asks infer benchmark mode while normal long chat stays capped", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom({ seedElement: true });
    const longGoal = `Run the uploaded official BankerToolBench task.\n${"Build the full DCF package from the room source files. ".repeat(80)}`;
    const longNormalGoal = `Summarize this room.\n${"Use the visible room context and write a concise note. ".repeat(80)}`;
    expect(longGoal.length).toBeGreaterThan(2_000);
    expect(longGoal.length).toBeLessThan(20_000);
    expect(longNormalGoal.length).toBeGreaterThan(2_000);

    await expect(t.mutation(api.agentJobs.startPublicAsk, {
      roomId,
      requester: proof,
      goal: longNormalGoal,
      contextArtifactId: String(artifactId),
      routePolicy: "explicit" as const,
      modelPolicy: "z-ai/glm-5.2",
    })).rejects.toThrow(/goal_too_long/);

    const started = await t.mutation(api.agentJobs.startPublicAsk, {
      roomId,
      requester: proof,
      goal: longGoal,
      contextArtifactId: String(artifactId),
      routePolicy: "explicit" as const,
      modelPolicy: "z-ai/glm-5.2",
    });

    const detail = await t.query(api.agentJobs.detail, { jobId: started.jobId, requester: proof });
    expect(detail?.job.goal).toBe(longGoal);
    expect(detail?.job.runtimeProfile).toBe("benchmark_completion");
    expect(detail?.job.modelPolicy).toBe("z-ai/glm-5.2");
  });

  it("blocks free public asks with uploaded file context unless paid file-egress promotion is explicit", async () => {
    const previous = process.env.FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION;
    delete process.env.FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION;
    try {
      const { t, proof, roomId, artifactId, actor } = await setupRoom({ seedElement: true });
      const now = Date.now();
      await t.run((ctx) =>
        ctx.db.insert("artifacts", {
          roomId,
          kind: "note" as const,
          title: "source_financials.csv",
          version: 1,
          order: ["source"],
          updatedAt: now,
          createdBy: actor,
          visibility: "room" as const,
          meta: { upload: { fileName: "source_financials.csv", mimeType: "text/csv", size: 96 } },
        }),
      );

      const started = await t.mutation(api.agentJobs.startPublicAsk, {
        roomId,
        requester: proof,
        goal: "compute the uploaded financial metrics and write the answers into Sheet 1",
        contextArtifactId: String(artifactId),
        routePolicy: "free_auto" as const,
      });

      const detail = await t.query(api.agentJobs.detail, { jobId: started.jobId, requester: proof });
      expect(started).toMatchObject({
        reused: false,
        status: "blocked",
        modelPolicy: "openrouter/free-auto",
        routePolicy: "free_auto",
      });
      expect(detail?.job).toMatchObject({
        entrypoint: "free",
        routePolicy: "free_auto",
        modelPolicy: "openrouter/free-auto",
        approvalPolicy: "draft_first",
        autoAllow: false,
        status: "blocked",
        error: "provider_egress_blocked:free_file_egress_requires_OPENROUTER_FREE_ALLOW_FILE_EGRESS",
      });
      expect(detail?.job.request).toMatchObject({ freeFileEgressPromotionBlocked: true });
      expect(detail?.streamEvents[0]?.metadata).toMatchObject({ freeFileEgressPromotionBlocked: true });
    } finally {
      if (previous === undefined) delete process.env.FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION;
      else process.env.FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION = previous;
    }
  });

  it("promotes uploaded-file free public asks only when paid file-egress promotion is explicit", async () => {
    const previous = process.env.AGENT_FILE_EGRESS_MODEL;
    const previousPromotion = process.env.FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION;
    process.env.AGENT_FILE_EGRESS_MODEL = "z-ai/glm-4.7-flash";
    process.env.FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION = "1";
    try {
      const { t, proof, roomId, artifactId, actor } = await setupRoom({ seedElement: true });
      const now = Date.now();
      await t.run((ctx) =>
        ctx.db.insert("artifacts", {
          roomId,
          kind: "note" as const,
          title: "source_financials.csv",
          version: 1,
          order: ["source"],
          updatedAt: now,
          createdBy: actor,
          visibility: "room" as const,
          meta: { upload: { fileName: "source_financials.csv", mimeType: "text/csv", size: 96 } },
        }),
      );

      const started = await t.mutation(api.agentJobs.startPublicAsk, {
        roomId,
        requester: proof,
        goal: "compute the uploaded financial metrics and write the answers into Sheet 1",
        contextArtifactId: String(artifactId),
        routePolicy: "free_auto" as const,
      });

      const detail = await t.query(api.agentJobs.detail, { jobId: started.jobId, requester: proof });
      expect(started).toMatchObject({
        reused: false,
        modelPolicy: "z-ai/glm-4.7-flash",
        routePolicy: "explicit",
      });
      expect(detail?.job).toMatchObject({
        entrypoint: "public_ask",
        routePolicy: "explicit",
        modelPolicy: "z-ai/glm-4.7-flash",
        approvalPolicy: "auto_commit_safe",
        autoAllow: true,
      });
      expect(detail?.job.request).toMatchObject({ fileEgressPromoted: true });
      expect(detail?.streamEvents[0]?.metadata).toMatchObject({ fileEgressPromoted: true });
    } finally {
      if (previous === undefined) delete process.env.AGENT_FILE_EGRESS_MODEL;
      else process.env.AGENT_FILE_EGRESS_MODEL = previous;
      if (previousPromotion === undefined) delete process.env.FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION;
      else process.env.FREE_AUTO_ALLOW_FILE_EGRESS_PROMOTION = previousPromotion;
    }
  });

  it("keeps benchmark-completion public asks distinct from standard asks and records the profile", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom({ seedElement: true });
    const goal = "compute these 5 metrics and write the visible cells";

    const benchmark = await t.mutation(api.agentJobs.startPublicAsk, {
      roomId,
      requester: proof,
      goal,
      contextArtifactId: String(artifactId),
      routePolicy: "fast_default" as const,
      runtimeProfile: "benchmark_completion" as const,
      maxAttempts: 100,
    });
    const standard = await t.mutation(api.agentJobs.startPublicAsk, {
      roomId,
      requester: proof,
      goal,
      contextArtifactId: String(artifactId),
      routePolicy: "fast_default" as const,
    });

    expect(standard.reused).toBe(false);
    expect(String(standard.jobId)).not.toBe(String(benchmark.jobId));
    const detail = await t.query(api.agentJobs.detail, { jobId: benchmark.jobId, requester: proof });
    expect(detail?.job).toMatchObject({
      runtimeProfile: "benchmark_completion",
      maxAttempts: 100,
    });
    expect(detail?.job.request).toMatchObject({
      runtimeProfile: "benchmark_completion",
      source: "public_chat",
    });
    const claimed = await t.mutation(internal.agentJobs.claimSlice, { jobId: benchmark.jobId, leaseId: "lease-benchmark-profile", leaseMs: 60_000 });
    expect(claimed).toMatchObject({
      runtimeProfile: "benchmark_completion",
      maxAttempts: 100,
    });
  });

  it("infers benchmark-completion for official BTB public asks without a client flag", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom({ seedElement: true });

    const started = await t.mutation(api.agentJobs.startPublicAsk, {
      roomId,
      requester: proof,
      goal: "Run official BankerToolBench task btb-a31173e3 in a fresh room and create the deliverable package",
      contextArtifactId: String(artifactId),
      routePolicy: "fast_default" as const,
    });

    const detail = await t.query(api.agentJobs.detail, { jobId: started.jobId, requester: proof });
    expect(detail?.job).toMatchObject({
      runtimeProfile: "benchmark_completion",
      maxAttempts: 1000,
    });
    expect(detail?.job.request).toMatchObject({
      runtimeProfile: "benchmark_completion",
      source: "public_chat",
    });
    const claimed = await t.mutation(internal.agentJobs.claimSlice, { jobId: started.jobId, leaseId: "lease-benchmark-inferred", leaseMs: 60_000 });
    expect(claimed).toMatchObject({
      runtimeProfile: "benchmark_completion",
      maxAttempts: 1000,
    });
  });

  it("materializes a scratch sheet before starting public asks in blank rooms", async () => {
    const { t, proof, roomId } = await setupBlankRoom();

    const started = await t.mutation(api.agentJobs.startPublicAsk, {
      roomId,
      requester: proof,
      goal: "create me a sheet and research liveflow",
      routePolicy: "fast_default" as const,
    });

    const detail = await t.query(api.agentJobs.detail, { jobId: started.jobId, requester: proof });
    const artifacts = await t.run((ctx) => ctx.db.query("artifacts").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect());
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ kind: "sheet", title: "Sheet 1", visibility: "room" });
    expect(String(detail?.job.artifactId)).toBe(String(artifacts[0]._id));
    expect(detail?.job.entrypoint).toBe("public_ask");
    expect(detail?.job.request).toMatchObject({
      targetArtifactId: String(artifacts[0]._id),
      commandText: "create me a sheet and research liveflow",
    });

    const elements = await t.run((ctx) => ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifacts[0]._id)).collect());
    const indexedCells = await t.run((ctx) => ctx.db.query("spreadsheetCells").withIndex("by_artifact_element", (q) => q.eq("artifactId", artifacts[0]._id)).collect());
    const traces = await t.run((ctx) => ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect());
    expect(elements).toHaveLength(96);
    expect(indexedCells).toHaveLength(96);
    expect(traces.map((trace) => trace.detail ?? "")).toContainEqual(expect.stringContaining("blank_public_ask_fallback"));
  });

  it("routes diligence asks to the company research sheet before active-note context", async () => {
    const { t, proof, roomId, actor } = await setupRoom({ seedElement: true });
    const now = Date.now();
    const noteId = await t.run((ctx) =>
      ctx.db.insert("artifacts", {
        roomId,
        kind: "note" as const,
        title: "Diligence memo",
        version: 1,
        order: ["doc"],
        updatedAt: now,
      }),
    );
    await t.run((ctx) => ctx.db.insert("elements", {
      artifactId: noteId,
      elementId: "doc",
      value: "<p>Memo draft</p>",
      version: 1,
      updatedAt: now,
      updatedBy: actor,
    }));
    const researchId = await t.run((ctx) =>
      ctx.db.insert("artifacts", {
        roomId,
        kind: "sheet" as const,
        title: "Company research",
        version: 1,
        order: ["rc_cardionova__company", "rc_cardionova__status"],
        updatedAt: now,
      }),
    );
    await t.run((ctx) => Promise.all([
      ctx.db.insert("elements", {
        artifactId: researchId,
        elementId: "rc_cardionova__company",
        value: "CardioNova",
        version: 1,
        updatedAt: now,
        updatedBy: actor,
      }),
      ctx.db.insert("elements", {
        artifactId: researchId,
        elementId: "rc_cardionova__status",
        value: "pending",
        version: 1,
        updatedAt: now,
        updatedBy: actor,
      }),
    ]));

    const started = await t.mutation(api.agentJobs.startPublicAsk, {
      roomId,
      requester: proof,
      goal: "diligence CardioNova with source-backed product, buyer, funding, hiring, and HIPAA/security gaps",
      contextArtifactId: String(noteId),
      routePolicy: "fast_default" as const,
    });

    const detail = await t.query(api.agentJobs.detail, { jobId: started.jobId, requester: proof });
    expect(String(detail?.job.artifactId)).toBe(String(researchId));
    expect(detail?.job.mode).toBe("research");
  });

  it("does not reuse terminal public ask jobs for later reruns with the same idempotency key", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const args = jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-terminal-rerun" });
    const first = await t.mutation(api.agentJobs.createOrReuse, args);

    await t.mutation(internal.agentJobs.finishInteractive, {
      jobId: first.jobId,
      status: "completed",
      finalText: "first run done",
      resolvedModel: "test-model",
      stopReason: "done",
      ms: 100,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
      modelCalls: 1,
      toolCalls: 1,
    });
    const second = await t.mutation(api.agentJobs.createOrReuse, args);

    expect(second.reused).toBe(false);
    expect(String(second.jobId)).not.toBe(String(first.jobId));
    const firstDetail = await t.query(api.agentJobs.detail, { jobId: first.jobId, requester: proof });
    const secondDetail = await t.query(api.agentJobs.detail, { jobId: second.jobId, requester: proof });
    expect(firstDetail?.job.status).toBe("completed");
    expect(secondDetail?.job.status).toBe("running");
  });

  it("requeues failed embedding jobs so backoff retries can claim them again", async () => {
    const { t, proof, actor, roomId } = await setupRoom();
    const now = Date.now();
    const notebookId = await t.run((ctx) =>
      ctx.db.insert("notebooks", {
        roomId,
        title: "Retry notebook",
        visibility: "room" as const,
        version: 1,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const nodeId = await t.run((ctx) =>
      ctx.db.insert("nodes", {
        roomId,
        notebookId,
        authorId: actor.id,
        kind: "note" as const,
        title: "Retry source",
        content: "Backoff retry source content",
        contentFormat: "plain" as const,
        visibility: "room" as const,
        version: 1,
        isDeleted: false,
        createdAt: now,
        updatedAt: now,
      }),
    );
    const content = "Retry source\nBackoff retry source content";
    const jobId = await t.mutation(api.embeddings.enqueueForSource, {
      roomId,
      sourceKind: "node" as const,
      sourceId: String(nodeId),
      content,
      requester: proof,
    });

    const firstClaim = await t.mutation(internal.embeddings.claimNext, {});
    expect(String(firstClaim?.jobId)).toBe(String(jobId));
    await t.mutation(internal.embeddings.markFailed, { jobId, error: "provider_rate_limited" });
    const notDue = await t.mutation(internal.embeddings.claimNext, {});
    expect(notDue).toBeNull();

    await t.run((ctx) => ctx.db.patch(jobId, { nextRunAt: Date.now() - 1 }));
    const retryClaim = await t.mutation(internal.embeddings.claimNext, {});
    expect(String(retryClaim?.jobId)).toBe(String(jobId));
    expect(retryClaim?.content).toBe(content);
  });

  it("persists PlanPreview-blocked public asks without starting a run", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const blocked = await t.mutation(api.agentJobs.createOrReuse, {
      ...jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-plan-blocked" }),
      initialStatus: "blocked" as const,
      planPreview: { scheduling: "wait_for_human", conflicts: [{ kind: "intent_wait", detail: "User asked to wait." }] },
      error: "PlanPreview blocked this run (wait_for_human): User asked to wait.",
    });

    const detail = await t.query(api.agentJobs.detail, { jobId: blocked.jobId, requester: proof });
    const traces = await t.run(async (ctx) => (await ctx.db.query("traces").collect()).filter((trace) => String(trace.roomId) === String(roomId)));

    expect(blocked.status).toBe("blocked");
    expect(detail?.job.status).toBe("blocked");
    expect(detail?.job.latestRunId).toBeUndefined();
    expect(detail?.job.planPreview?.scheduling).toBe("wait_for_human");
    expect(detail?.job.error).toContain("PlanPreview blocked");
    expect(traces.some((trace) => trace.type === "plan_blocked")).toBe(true);
  });

  it("keeps PlanPreview-blocked jobs fail-closed on retry", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const blocked = await t.mutation(api.agentJobs.createOrReuse, {
      ...jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-plan-blocked-retry" }),
      initialStatus: "blocked" as const,
      planPreview: { scheduling: "needs_human_approval", conflicts: [{ kind: "pending_proposal_overlap", detail: "C2 already has a pending proposal." }] },
      error: "PlanPreview blocked this run (needs_human_approval): C2 already has a pending proposal.",
    });

    const retried = await t.mutation(api.agentJobs.retry, { jobId: blocked.jobId, requester: proof });
    const detail = await t.query(api.agentJobs.detail, { jobId: blocked.jobId, requester: proof });

    expect(retried).toEqual({ ok: false, reason: "blocked_requires_fresh_plan" });
    expect(detail?.job.status).toBe("blocked");
    expect(detail?.job.workflowId).toBeUndefined();
    expect(detail?.operations.map((event) => event.name)).not.toContain("agentWorkflows.freeAutoWorkflow");
  });

  it("finishInteractive writes attempts, operation events, and materialized counters", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-finish" }));

    await t.mutation(internal.agentJobs.finishInteractive, {
      jobId,
      status: "completed",
      finalText: "done",
      resolvedModel: "test-model",
      stopReason: "done",
      ms: 1200,
      inputTokens: 100,
      outputTokens: 25,
      costUsd: 0.001,
      modelCalls: 1,
      toolCalls: 2,
      queryCount: 3,
      mutationCount: 4,
      receiptCount: 1,
    });

    const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(detail?.attempts).toHaveLength(1);
    expect(detail?.job.status).toBe("completed");
    expect(detail?.job.finalText).toBe("done");
    expect(detail?.operations.map((event) => event.kind)).toEqual(expect.arrayContaining(["action", "model_call", "tool_call", "checkpoint"]));
    expect(detail?.job.queryCount).toBe(3);
    expect(detail?.job.mutationCount).toBe(5);
    expect(detail?.job.receiptCount).toBe(1);
  });

  it("records live operation events before an interactive run reaches a terminal state", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-live-ops" }));
    const runId = await t.mutation(internal.agentRuns.claim, {
      jobId,
      roomId,
      agentId: "agent_room",
      model: "deepseek/deepseek-v4-flash",
      goal: "stream progress",
    });

    const started = await t.mutation(internal.agentJobs.recordLiveOperation, {
      jobId,
      runId,
      sequence: 1_000,
      kind: "model_call",
      name: "deepseek/deepseek-v4-flash",
      status: "started",
      countDelta: 1,
    });
    const read = await t.mutation(internal.agentJobs.recordLiveOperation, {
      jobId,
      runId,
      sequence: 1_001,
      kind: "query",
      name: "read_range",
      status: "completed",
      countDelta: 1,
      affectedIds: ["row1__variance"],
    });

    const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(started).toEqual({ ok: true });
    expect(read).toEqual({ ok: true });
    expect(detail?.job.status).toBe("running");
    expect(detail?.operations.map((event) => event.name)).toEqual(expect.arrayContaining(["deepseek/deepseek-v4-flash", "read_range"]));
    expect(detail?.operations.find((event) => event.name === "read_range")?.affectedIds).toEqual(["row1__variance"]);
  });

  it("records unified stream events on the job detail timeline", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-stream-events" }));

    const text = await t.mutation(internal.agentJobs.recordStreamEvent, {
      jobId,
      sequence: 1_000,
      kind: "text_delta" as const,
      status: "streaming" as const,
      text: "Streaming answer",
    });
    const tool = await t.mutation(internal.agentJobs.recordStreamEvent, {
      jobId,
      sequence: 1_001,
      kind: "tool_call_result" as const,
      step: 0,
      toolCallId: "call-1",
      toolName: "read_range",
      status: "completed" as const,
      output: { rows: 1 },
    });
    const duplicate = await t.mutation(internal.agentJobs.recordStreamEvent, {
      jobId,
      sequence: 1_001,
      kind: "tool_call_result" as const,
      toolCallId: "call-1",
      toolName: "read_range",
      status: "completed" as const,
    });

    const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });

    expect(text).toMatchObject({ ok: true });
    expect(tool).toMatchObject({ ok: true });
    expect(duplicate).toMatchObject({ ok: true, reused: true });
    expect(detail?.streamEvents.map((event) => event.kind)).toEqual(["message_start", "text_delta", "tool_call_result"]);
    expect(detail?.streamEvents.find((event) => event.kind === "tool_call_result")?.output).toEqual({ rows: 1 });
  });

  it("records durable model-step journal rows and replays without overwriting", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-journal" }));
    const result = {
      text: "",
      toolCalls: [{ id: "call-1", tool: "read_range", args: { elementIds: ["row1__variance"] } }],
      done: false,
      usage: { inputTokens: 12, outputTokens: 3 },
    };

    const first = await t.mutation(internal.agentStepJournal.record, {
      jobId,
      sliceKey: "slice-a",
      step: 0,
      model: "gemini-3.5-flash",
      inputHash: "slice-a",
      outputHash: "out-a",
      result,
    });
    const replay = await t.query(internal.agentStepJournal.get, { jobId, sliceKey: "slice-a", step: 0 });
    const second = await t.mutation(internal.agentStepJournal.record, {
      jobId,
      sliceKey: "slice-a",
      step: 0,
      model: "gemini-3.5-flash",
      inputHash: "slice-a",
      outputHash: "out-b",
      result: { text: "overwritten", toolCalls: [], done: true },
    });
    const replayAfterDuplicate = await t.query(internal.agentStepJournal.get, { jobId, sliceKey: "slice-a", step: 0 });
    const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(replay).toEqual(result);
    expect(replayAfterDuplicate).toEqual(result);
    expect(detail?.modelJournal).toHaveLength(1);
    expect(detail?.modelJournal[0].outputHash).toBe("out-a");
  });

  it("claimSlice creates an active lease and finishSlice releases it only for the matching lease", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-lease" }));
    await seedRuntimeReasoningFrames(t, { roomId, artifactId, jobId });

    const claimed = await t.mutation(internal.agentJobs.claimSlice, { jobId, leaseId: "lease-ok", leaseMs: 60_000 });
    expect(claimed?.attempt).toBe(1);
    expect(claimed?.activeReasoningFrame).toMatchObject({ frameId: "rf_child", status: "running", frameKind: "child" });
    let detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(detail?.job.activeFrameId).toBe("rf_child");
    expect(detail?.reasoningFrames.find((frame) => frame.frameId === "rf_execute")?.status).toBe("pending");
    expect(detail?.reasoningFrames.find((frame) => frame.frameId === "rf_child")?.status).toBe("running");

    const mismatch = await t.mutation(internal.agentJobs.finishSlice, finishSliceArgs({ jobId, leaseId: "lease-wrong", attempt: 1 }));
    expect(mismatch).toEqual({ ok: false, reason: "lease_mismatch" });

    const finished = await t.mutation(internal.agentJobs.finishSlice, finishSliceArgs({ jobId, leaseId: "lease-ok", attempt: 1 }));
    expect(finished).toEqual({ ok: true });

    detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(detail?.leases.map((lease) => lease.status)).toContain("released");
    expect(detail?.job.leaseId).toBe("");
    expect(detail?.job.status).toBe("paused");
    expect(detail?.job.nextRunAt).toEqual(expect.any(Number));
    expect(detail?.job.activeFrameId).toBe("");
    expect(detail?.attempts[0]).toMatchObject({ attempt: 1, frameId: "rf_child", status: "completed" });
    expect(detail?.reasoningFrames.map((frame) => [frame.frameId, frame.status])).toEqual([
      ["rf_intake", "completed"],
      ["rf_execute", "pending"],
      ["rf_child", "completed"],
    ]);
    expect(detail?.operations.find((event) => event.name === "agentJobs.claimSlice")?.affectedIds).toEqual(expect.arrayContaining(["rf_child"]));
    expect(detail?.operations.find((event) => event.name === "agentJobs.finishSlice")?.affectedIds).toEqual(expect.arrayContaining(["rf_child"]));

    const claimedSecond = await t.mutation(internal.agentJobs.claimSlice, { jobId, leaseId: "lease-ok-2", leaseMs: 60_000 });
    expect(claimedSecond?.attempt).toBe(2);
    expect(claimedSecond?.activeReasoningFrame).toMatchObject({ frameId: "rf_execute", status: "running", frameKind: "phase" });
    const finishedSecond = await t.mutation(internal.agentJobs.finishSlice, finishSliceArgs({ jobId, leaseId: "lease-ok-2", attempt: 2 }));
    expect(finishedSecond).toEqual({ ok: true });

    detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(detail?.job.status).toBe("completed");
    expect(detail?.job.completedAt).toEqual(expect.any(Number));
    expect(detail?.job.nextRunAt ?? 0).toBe(0);
    expect(detail?.attempts.map((attempt) => attempt.frameId)).toEqual(["rf_child", "rf_execute"]);
    expect(detail?.reasoningFrames.map((frame) => frame.status)).toEqual(["completed", "completed", "completed"]);
  });

  it("finishSlice compacts oversized handoff and cursor payloads before patching the job row", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-compact-continuation" }));
    const claimed = await t.mutation(internal.agentJobs.claimSlice, { jobId, leaseId: "lease-compact", leaseMs: 60_000 });
    expect(claimed?.attempt).toBe(1);

    const huge = "x".repeat(1_200_000);
    const finished = await t.mutation(internal.agentJobs.finishSlice, {
      ...finishSliceArgs({ jobId, leaseId: "lease-compact", attempt: 1 }),
      status: "handoff" as const,
      stopReason: "time_budget",
      handoff: {
        summary: huge,
        latestAssistantText: huge,
        nextGoal: huge,
        remainingToolCalls: [{ id: "call-1", tool: "read_range", args: { elementIds: huge } }],
      },
      cursor: {
        messages: [
          { role: "user", content: "start" },
          ...Array.from({ length: 40 }, (_, idx) => ({ role: "tool", toolName: "read_range", toolCallId: `c${idx}`, content: huge })),
        ],
        remainingToolCalls: [{ id: "call-2", tool: "read_range", args: { elementIds: huge } }],
      },
      scheduledNextAt: Date.now() + 1_000,
    });

    expect(finished).toEqual({ ok: true });
    const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(JSON.stringify(detail?.job.handoff).length).toBeLessThan(300_000);
    expect(JSON.stringify(detail?.job.cursor).length).toBeLessThan(300_000);
    expect(detail?.job.status).toBe("paused");
  });

  it("finishSlice clears a stale slice error after a later clean completion", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-clear-stale-error" }));

    const firstClaim = await t.mutation(internal.agentJobs.claimSlice, { jobId, leaseId: "lease-error", leaseMs: 60_000 });
    expect(firstClaim?.attempt).toBe(1);
    const retried = await t.mutation(internal.agentJobs.finishSlice, {
      ...finishSliceArgs({ jobId, leaseId: "lease-error", attempt: 1 }),
      status: "retrying" as const,
      stopReason: "slice_timeout",
      error: "slice_timeout",
      scheduledNextAt: Date.now() + 1_000,
    });
    expect(retried).toEqual({ ok: true });
    let detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(detail?.job.status).toBe("retrying");
    expect(detail?.job.error).toBe("slice_timeout");

    const secondClaim = await t.mutation(internal.agentJobs.claimSlice, { jobId, leaseId: "lease-clean", leaseMs: 60_000 });
    expect(secondClaim?.attempt).toBe(2);
    const completed = await t.mutation(internal.agentJobs.finishSlice, {
      ...finishSliceArgs({ jobId, leaseId: "lease-clean", attempt: 2 }),
      finalText: "completed cleanly",
    });
    expect(completed).toEqual({ ok: true });
    detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(detail?.job.status).toBe("completed");
    expect(detail?.job.error).toBe("");
    expect(detail?.job.finalText).toBe("completed cleanly");
  });

  it("cancel finalizes the job, releases active leases, and records a checkpoint", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-cancel-lease" }));
    const claimed = await t.mutation(internal.agentJobs.claimSlice, { jobId, leaseId: "lease-cancel", leaseMs: 60_000 });
    expect(claimed?.attempt).toBe(1);

    const cancelled = await t.mutation(api.agentJobs.cancel, { jobId, requester: proof });
    const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });

    expect(cancelled).toEqual({ ok: true });
    expect(detail?.job.status).toBe("cancelled");
    expect(detail?.job.completedAt).toEqual(expect.any(Number));
    expect(detail?.job.leaseId).toBe("");
    expect(detail?.leases.some((lease) => lease.status === "active")).toBe(false);
    expect(detail?.leases.map((lease) => lease.status)).toContain("released");
    expect(detail?.operations.map((event) => event.name)).toContain("agentJobs.cancel");
  });

  it("retry requeues a cancelled job with a fresh workflow and fences the old lease", async () => {
    vi.useFakeTimers();
    try {
      const { t, proof, roomId, artifactId } = await setupRoom();
      const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-retry-after-cancel" }));
      const claimed = await t.mutation(internal.agentJobs.claimSlice, { jobId, leaseId: "lease-before-retry", leaseMs: 60_000 });
      expect(claimed?.attempt).toBe(1);
      await t.mutation(api.agentJobs.cancel, { jobId, requester: proof });

      const retried = await t.mutation(api.agentJobs.retry, { jobId, requester: proof, additionalAttempts: 3 });
      const staleFinish = await t.mutation(internal.agentJobs.finishSlice, finishSliceArgs({ jobId, leaseId: "lease-before-retry", attempt: 1 }));
      const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });

      expect(retried).toMatchObject({ ok: true, maxAttempts: 4 });
      expect(staleFinish).toEqual({ ok: false, reason: "lease_mismatch" });
      expect(detail?.job.status).toBe("queued");
      expect(detail?.job.runtime).toBe("workflow");
      expect(detail?.job.workflowId).toBeTruthy();
      expect(detail?.job.leaseId).toBe("");
      expect(detail?.job.error).toBeUndefined();
      expect(detail?.leases.some((lease) => lease.status === "active")).toBe(false);
      expect(detail?.operations.map((event) => event.name)).toEqual(expect.arrayContaining(["agentJobs.cancel", "agentJobs.retry"]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("sweeps expired running-job leases into a fenced failed state", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom();
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-stale-lease" }));

    const claimed = await t.mutation(internal.agentJobs.claimSlice, { jobId, leaseId: "lease-stale", leaseMs: 1_000 });
    expect(claimed?.attempt).toBe(1);

    const swept = await t.mutation(internal.agentJobs.sweepExpiredJobLeases, { now: Date.now() + 2_000, limit: 10 });
    expect(swept.expired).toBe(1);

    const staleFinish = await t.mutation(internal.agentJobs.finishSlice, finishSliceArgs({ jobId, leaseId: "lease-stale", attempt: 1 }));
    expect(staleFinish).toEqual({ ok: false, reason: "lease_mismatch" });

    const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(detail?.job.status).toBe("failed");
    expect(detail?.job.error).toBe("job_lease_expired");
    expect(detail?.job.leaseId).toBe("");
    expect(detail?.leases.map((lease) => lease.status)).toContain("expired");
    expect(detail?.attempts[0]).toMatchObject({ attempt: 1, status: "failed", stopReason: "lease_expired" });
    expect(detail?.operations.map((event) => event.name)).toContain("agentJobs.sweepExpiredJobLeases");
  });

  it("agent cell edits write mutation receipts and stale CAS conflicts do not", async () => {
    const { t, proof, actor, roomId, artifactId } = await setupRoom({ seedElement: true });
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-receipt" }));

    const applied = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId,
      artifactId,
      elementId: "row1__variance",
      value: "8%",
      baseVersion: 1,
      actor,
      jobId,
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error("expected applyAgentCellEdit to succeed");
    expect(applied.mutationReceiptId).toBeTruthy();

    const conflict = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId,
      artifactId,
      elementId: "row1__variance",
      value: "9%",
      baseVersion: 1,
      actor,
      jobId,
    });
    expect(conflict).toMatchObject({ ok: false, reason: "conflict", expected: 1, actual: 2 });

    const detail = await t.query(api.agentJobs.detail, { jobId, requester: proof });
    expect(detail?.receipts).toHaveLength(1);
    expect(detail?.job.receiptCount).toBe(1);
  });

  it("requires evidence for agent enrichment columns and protects CRM columns", async () => {
    const { t, proof, roomId, artifactId } = await setupRoom({ researchPolicy: true });
    const agent = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };
    await t.run((ctx) => ctx.db.insert("agentSessions", {
      roomId,
      agentId: agent.id,
      agentName: agent.name,
      scope: "public" as const,
      status: "idle" as const,
      lastAction: "started",
      updatedAt: Date.now(),
    }));
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-evidence-policy" }));

    const missingEvidence = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId,
      artifactId,
      elementId: "row1__summary",
      value: "CardioNova sells AI triage software.",
      baseVersion: 1,
      actor: agent,
      jobId,
    });
    expect(missingEvidence).toMatchObject({ ok: false, reason: "evidence_required" });

    const evidenced = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId,
      artifactId,
      elementId: "row1__summary",
      value: {
        value: "CardioNova sells AI triage software.",
        status: "complete",
        evidence: [{ id: "source-1", kind: "source", label: "Company homepage", url: "https://cardionova.example" }],
      },
      baseVersion: 1,
      actor: agent,
      jobId,
    });
    expect(evidenced).toMatchObject({ ok: true });

    const protectedColumn = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId,
      artifactId,
      elementId: "row1__crm_status",
      value: {
        value: "Target",
        status: "complete",
        evidence: [{ id: "source-2", kind: "source", label: "CRM export" }],
      },
      baseVersion: 1,
      actor: agent,
      jobId,
    });
    expect(protectedColumn).toMatchObject({ ok: false, reason: "agent_write_forbidden_column" });
  });

  it("restricts cancel and retry controls to the requester or room host", async () => {
    const { t, proof, memberProof, roomId, artifactId } = await setupRoom({ extraMember: true });
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, jobArgs({ roomId, artifactId, proof, idempotencyKey: "job-runtime-rbac" }));

    const deniedCancel = await t.mutation(api.agentJobs.cancel, { jobId, requester: memberProof });
    const deniedRetry = await t.mutation(api.agentJobs.retry, { jobId, requester: memberProof });
    const allowedCancel = await t.mutation(api.agentJobs.cancel, { jobId, requester: proof });

    expect(deniedCancel).toEqual({ ok: false, reason: "forbidden" });
    expect(deniedRetry).toEqual({ ok: false, reason: "forbidden" });
    expect(allowedCancel).toEqual({ ok: true });
  });

  it("redacts private user jobs from other room members and host-level job detail queries", async () => {
    const { t, proof: hostProof, memberProof, roomId, artifactId } = await setupRoom({ extraMember: true });
    const { jobId } = await t.mutation(api.agentJobs.createOrReuse, {
      ...jobArgs({ roomId, artifactId, proof: memberProof, idempotencyKey: "job-runtime-private-user" }),
      entrypoint: "private_agent" as const,
      scope: "private_user" as const,
      evidencePolicy: "private_allowed" as const,
    });

    await t.mutation(internal.agentJobs.finishInteractive, {
      jobId,
      status: "completed",
      finalText: "private diligence notes",
      resolvedModel: "test-model",
      stopReason: "done",
      ms: 50,
      inputTokens: 10,
      outputTokens: 5,
      costUsd: 0.001,
      modelCalls: 1,
      toolCalls: 1,
    });

    const ownerList = await t.query(api.agentJobs.list, { roomId, requester: memberProof });
    const hostList = await t.query(api.agentJobs.list, { roomId, requester: hostProof });
    const ownerDetail = await t.query(api.agentJobs.detail, { jobId, requester: memberProof });
    const hostDetail = await t.query(api.agentJobs.detail, { jobId, requester: hostProof });
    const hostAttempts = await t.query(api.agentJobs.attempts, { jobId, requester: hostProof });

    expect(ownerList.map((job) => String(job._id))).toContain(String(jobId));
    expect(hostList.map((job) => String(job._id))).not.toContain(String(jobId));
    expect(ownerDetail?.job.finalText).toBe("private diligence notes");
    expect(hostDetail).toBeNull();
    expect(hostAttempts).toEqual([]);
  });
});

async function setupRoom(options: { seedElement?: boolean; extraMember?: boolean; researchPolicy?: boolean; autoAllow?: boolean } = {}) {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  const now = Date.now();
  const authTokenHash = await hashToken(token);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      code: `T${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      title: "Agent job runtime test",
      hostId: "",
      autoAllow: options.autoAllow ?? true,
      status: "live" as const,
      createdAt: now,
    }),
  );
  const memberId = await t.run((ctx) =>
    ctx.db.insert("members", {
      roomId,
      name: "Host",
      role: "host" as const,
      anon: false,
      color: "#111111",
      authTokenHash,
      lastSeenAt: now,
    }),
  );
  const actor = { kind: "user" as const, id: String(memberId), name: "Host" };
  const proof = { actor, token };
  const memberToken = "abcdefghijklmnopqrstuvwxyz0123456789MEMBER";
  let memberProof = proof;
  if (options.extraMember) {
    const memberTokenHash = await hashToken(memberToken);
    const memberId = await t.run((ctx) =>
      ctx.db.insert("members", {
        roomId,
        name: "Member",
        role: "member" as const,
        anon: true,
        color: "#222222",
        authTokenHash: memberTokenHash,
        lastSeenAt: now,
      }),
    );
    memberProof = { actor: { kind: "user" as const, id: String(memberId), name: "Member" }, token: memberToken };
  }
  const order = options.researchPolicy ? ["row1__summary", "row1__crm_status"] : options.seedElement ? ["row1__variance"] : [];
  const artifactId = await t.run((ctx) =>
    ctx.db.insert("artifacts", {
      roomId,
      kind: "sheet" as const,
      title: "Runtime sheet",
      version: 1,
      order,
      updatedAt: now,
      ...(options.researchPolicy ? { meta: {
        dataframe: {
          columns: [
            { id: "summary", label: "summary", order: 0, mode: "enrich", type: "text", agentWritable: true },
            { id: "crm_status", label: "crm_status", order: 1, mode: "manual", type: "text", agentWritable: false },
          ],
          rowCount: 1,
          parser: "test",
        },
      } } : {}),
    }),
  );
  if (options.seedElement || options.researchPolicy) {
    const rows = options.researchPolicy
      ? [
        { elementId: "row1__summary", value: "" },
        { elementId: "row1__crm_status", value: "New" },
      ]
      : [{ elementId: "row1__variance", value: "7%" }];
    await t.run((ctx) =>
      Promise.all(rows.map((row) => ctx.db.insert("elements", {
        artifactId,
        elementId: row.elementId,
        value: row.value,
        version: 1,
        updatedAt: now,
        updatedBy: actor,
      }))),
    );
  }
  return { t, proof, memberProof, actor, roomId, artifactId };
}

async function setupBlankRoom() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  const now = Date.now();
  const authTokenHash = await hashToken(token);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      code: `B${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      title: "Blank agent room",
      hostId: "",
      autoAllow: true,
      status: "live" as const,
      createdAt: now,
    }),
  );
  const memberId = await t.run((ctx) =>
    ctx.db.insert("members", {
      roomId,
      name: "Host",
      role: "host" as const,
      anon: false,
      color: "#111111",
      authTokenHash,
      lastSeenAt: now,
    }),
  );
  const actor = { kind: "user" as const, id: String(memberId), name: "Host" };
  await t.run((ctx) => ctx.db.patch(roomId, { hostId: String(memberId) }));
  await t.run((ctx) => ctx.db.insert("agentSessions", {
    roomId,
    agentId: "agent_room",
    agentName: "Room NodeAgent",
    scope: "public" as const,
    status: "idle" as const,
    lastAction: "started",
    updatedAt: now,
  }));
  return { t, proof: { actor, token }, actor, roomId };
}

async function seedRuntimeReasoningFrames(
  t: ReturnType<typeof convexTest>,
  args: { roomId: Id<"rooms">; artifactId: Id<"artifacts">; jobId: Id<"agentJobs"> },
) {
  const now = Date.now();
  await t.run((ctx) => Promise.all([
    ctx.db.insert("agentReasoningFrames", {
      roomId: args.roomId,
      artifactId: args.artifactId,
      jobId: args.jobId,
      framePlanId: "runtime-test-plan",
      frameId: "rf_intake",
      sequence: 1,
      frameKind: "phase" as const,
      phase: "intake" as const,
      status: "completed" as const,
      goal: "Parse the request.",
      contextPack: { globalGoal: "runtime test", currentArtifactDigest: "artifact:test", relevantOkfConceptIds: [], relevantCacheKeys: [], openQuestions: [], constraints: [] },
      toolAllowlist: ["normalize_room_intake"],
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    }),
    ctx.db.insert("agentReasoningFrames", {
      roomId: args.roomId,
      artifactId: args.artifactId,
      jobId: args.jobId,
      framePlanId: "runtime-test-plan",
      frameId: "rf_execute",
      parentFrameId: "rf_intake",
      sequence: 2,
      frameKind: "phase" as const,
      phase: "execute" as const,
      status: "pending" as const,
      goal: "Execute the slice.",
      contextPack: { globalGoal: "runtime test", currentArtifactDigest: "artifact:test", relevantOkfConceptIds: [], relevantCacheKeys: [], openQuestions: ["Run slice"], constraints: [] },
      toolAllowlist: ["read_range"],
      createdAt: now,
      updatedAt: now,
    }),
    ctx.db.insert("agentReasoningFrames", {
      roomId: args.roomId,
      artifactId: args.artifactId,
      jobId: args.jobId,
      framePlanId: "runtime-test-plan",
      frameId: "rf_child",
      parentFrameId: "rf_execute",
      sequence: 3,
      frameKind: "child" as const,
      phase: "execute" as const,
      status: "pending" as const,
      goal: "Resolve one child facet.",
      contextPack: { globalGoal: "runtime test", currentArtifactDigest: "artifact:test", relevantOkfConceptIds: [], relevantCacheKeys: ["cache:test"], openQuestions: ["Resolve child"], constraints: [] },
      toolAllowlist: ["fetch_source"],
      cacheKey: "cache:test",
      entityType: "company" as const,
      entityKey: "cardionova",
      displayName: "CardioNova",
      facet: "company_profile",
      cachePolicy: "missing_research_now",
      expectedOutputSchema: "entity_facet_result_with_evidence_v1",
      createdAt: now,
      updatedAt: now,
    }),
  ]));
}

function jobArgs(args: {
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  proof: { actor: { kind: "user"; id: string; name: string }; token: string };
  idempotencyKey: string;
}) {
  return {
    roomId: args.roomId,
    artifactId: args.artifactId,
    requester: args.proof,
    goal: "Verify the unified agent job runtime",
    entrypoint: "public_ask" as const,
    scope: "public_room" as const,
    modelPolicy: "test-model",
    idempotencyKey: args.idempotencyKey,
    approvalPolicy: "auto_commit_safe" as const,
    evidencePolicy: "public_only" as const,
    autoAllow: true,
  };
}

function finishSliceArgs(args: { jobId: Id<"agentJobs">; leaseId: string; attempt: number }) {
  return {
    jobId: args.jobId,
    leaseId: args.leaseId,
    attempt: args.attempt,
    status: "completed" as const,
    resolvedModel: "test-model",
    stopReason: "done",
    ms: 100,
    inputTokens: 10,
    outputTokens: 5,
    costUsd: 0.0001,
  };
}
