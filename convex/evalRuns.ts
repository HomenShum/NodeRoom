import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, mutation, query } from "./_generated/server";
import { actorProofV, requireActorProof, refutationVerdictV, REFUTATIONS_MAX_PER_TASK } from "./lib";

// ---- Honest-lane eval ledger (Solo Founder Agent Builder) ----
// Append-only: each iteration is one immutable `evalRuns` row; its `taskResults` are the (~100) children.
// The eval harness (NodeAgent adapter / sweep) writes via these INTERNAL mutations; the UI reads via the
// paginated public queries so iterations can be flipped like pages while Trace Lens inspects each snapshot.

const taskResultFields = {
  taskId: v.string(),
  family: v.optional(v.string()),
  reward: v.number(),
  raw: v.optional(v.string()),
  exceptions: v.number(),
  // which materializer produced the deliverable: "generic-quartet" | "general_teaser" | "replay:<family>" | ...
  firedWriter: v.string(),
  // generic-only writer fired AND the model was genuinely in the loop
  cleanGeneralProbe: v.boolean(),
  modelCalls: v.number(),
  tokensUsed: v.optional(v.number()),
  plannerTransport: v.optional(v.string()),
  trialId: v.optional(v.string()),
  verdict: v.optional(v.string()),
};

export const startRun = internalMutation({
  args: {
    roomId: v.id("rooms"),
    iterationLabel: v.string(),
    benchmark: v.string(),
    model: v.optional(v.string()),
    materializerMode: v.string(),
    taskCount: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    // Idempotent: one run per (room, iterationLabel).
    const existing = await ctx.db
      .query("evalRuns")
      .withIndex("by_room", (q) => q.eq("roomId", a.roomId))
      .filter((q) => q.eq(q.field("iterationLabel"), a.iterationLabel))
      .first();
    if (existing) return existing._id;
    return ctx.db.insert("evalRuns", {
      roomId: a.roomId,
      iterationLabel: a.iterationLabel,
      benchmark: a.benchmark,
      model: a.model,
      materializerMode: a.materializerMode,
      status: "running",
      taskCount: a.taskCount,
      notes: a.notes,
      startedAt: Date.now(),
    });
  },
});

export const recordTaskResult = internalMutation({
  args: { roomId: v.id("rooms"), evalRunId: v.id("evalRuns"), ...taskResultFields },
  handler: async (ctx, a) => {
    // Provisional clean-probe gate: known family-writer / model-off rows are excluded, but the inputs
    // still arrive from the harness payload. S9-S16 receipts must derive those inputs before this is a
    // substrate-secure benchmark headline.
    const countsTowardHeadline = a.cleanGeneralProbe && a.modelCalls > 0;
    const doc = {
      roomId: a.roomId,
      evalRunId: a.evalRunId,
      taskId: a.taskId,
      family: a.family,
      reward: a.reward,
      raw: a.raw,
      exceptions: a.exceptions,
      firedWriter: a.firedWriter,
      cleanGeneralProbe: a.cleanGeneralProbe,
      modelCalls: a.modelCalls,
      tokensUsed: a.tokensUsed,
      plannerTransport: a.plannerTransport,
      countsTowardHeadline,
      trialId: a.trialId,
      verdict: a.verdict,
      createdAt: Date.now(),
    };
    // Idempotent per (run, task): re-recording a task overwrites its prior row.
    const prior = await ctx.db
      .query("taskResults")
      .withIndex("by_run_task", (q) => q.eq("evalRunId", a.evalRunId).eq("taskId", a.taskId))
      .unique();
    if (prior) {
      await ctx.db.patch(prior._id, doc);
      return prior._id;
    }
    return ctx.db.insert("taskResults", doc);
  },
});

export const finishRun = internalMutation({
  args: {
    evalRunId: v.id("evalRuns"),
    status: v.union(v.literal("completed"), v.literal("failed")),
  },
  handler: async (ctx, a) => {
    // Recompute the provisional clean-probe mean over rows that count. Bounded by run size (~100 BTB
    // tasks); a single run's children only. S9-S16 requires stronger derived inputs before this can be
    // a published clean headline.
    const rows = await ctx.db
      .query("taskResults")
      .withIndex("by_run", (q) => q.eq("evalRunId", a.evalRunId))
      .collect();
    const counted = rows.filter((r) => r.countsTowardHeadline);
    const mean = counted.length
      ? counted.reduce((s, r) => s + r.reward, 0) / counted.length
      : undefined;
    await ctx.db.patch(a.evalRunId, {
      status: a.status,
      completedAt: Date.now(),
      headlineCleanProbeMean: mean,
      headlineN: counted.length,
    });
    return { headlineCleanProbeMean: mean, headlineN: counted.length };
  },
});

// ---- UI reads (paginated; flip iterations like pages) ----

export const listRuns = query({
  args: { roomId: v.id("rooms"), requester: actorProofV, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { roomId, requester, paginationOpts }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db
      .query("evalRuns")
      .withIndex("by_room_started", (q) => q.eq("roomId", roomId))
      .order("desc")
      .paginate(paginationOpts);
  },
});

export const runDetail = query({
  args: { evalRunId: v.id("evalRuns"), requester: actorProofV },
  handler: async (ctx, { evalRunId, requester }) => {
    const run = await ctx.db.get(evalRunId);
    if (!run) return null;
    await requireActorProof(ctx, run.roomId, requester);
    return run;
  },
});

export const taskResultsForRun = query({
  args: { evalRunId: v.id("evalRuns"), requester: actorProofV, paginationOpts: paginationOptsValidator },
  handler: async (ctx, { evalRunId, requester, paginationOpts }) => {
    const run = await ctx.db.get(evalRunId);
    if (!run) throw new Error("eval run not found");
    await requireActorProof(ctx, run.roomId, requester);
    // Room-scope in the query (by_room_run), not just via the upstream run lookup — defense in depth.
    return ctx.db
      .query("taskResults")
      .withIndex("by_room_run", (q) => q.eq("roomId", run.roomId).eq("evalRunId", evalRunId))
      .order("asc")
      .paginate(paginationOpts);
  },
});

export const publicLedgerSnapshot = query({
  args: {
    roomCode: v.optional(v.string()),
    selectedEvalRunId: v.optional(v.id("evalRuns")),
    selectedKind: v.optional(
      v.union(v.literal("sweep"), v.literal("model-frontier"), v.literal("baseline")),
    ),
    runLimit: v.optional(v.number()),
    taskLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const code = (args.roomCode ?? "BTBLEDGER").toUpperCase();
    if (code !== "BTBLEDGER" && code !== "BTB-EVAL-LEDGER") {
      throw new Error("unsupported_public_eval_ledger");
    }
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).first();
    if (!room) return null;

    const runLimit = Math.min(Math.max(Math.floor(args.runLimit ?? 12), 1), 25);
    const taskLimit = Math.min(Math.max(Math.floor(args.taskLimit ?? 120), 1), 250);
    const runs = await ctx.db
      .query("evalRuns")
      .withIndex("by_room_started", (q) => q.eq("roomId", room._id))
      .order("desc")
      .take(runLimit);

    // Selection precedence (first match wins):
    //   1. selectedEvalRunId — explicit pin (fast path; also wins when selectedKind is set).
    //   2. selectedKind — latest run in the room matching the requested kind. We query the
    //      full kind-filtered history (not just the recent-runs slice) so a caller asking for
    //      e.g. the latest "model-frontier" run still resolves it when more than `runLimit`
    //      sweep rows are newer than the most recent frontier row.
    //   3. default heuristic — first "full run" (taskCount >= 100) in the recent slice, else runs[0].
    let selectedRun: typeof runs[number] | null | undefined;
    if (args.selectedEvalRunId) {
      selectedRun =
        runs.find((run) => run._id === args.selectedEvalRunId) ??
        (await ctx.db.get(args.selectedEvalRunId)) ??
        undefined;
    } else if (args.selectedKind) {
      const kind = args.selectedKind;
      selectedRun =
        runs.find((run) => run.kind === kind) ??
        (await ctx.db
          .query("evalRuns")
          .withIndex("by_room_started", (q) => q.eq("roomId", room._id))
          .order("desc")
          .filter((q) => q.eq(q.field("kind"), kind))
          .first()) ??
        undefined;
    } else {
      selectedRun = runs.find((run) => run.taskCount >= 100) ?? runs[0];
    }
    if (selectedRun && selectedRun.roomId !== room._id) {
      throw new Error("eval_run_not_in_public_ledger_room");
    }

    const tasks = selectedRun
      ? await ctx.db
        .query("taskResults")
        .withIndex("by_room_run", (q) => q.eq("roomId", room._id).eq("evalRunId", selectedRun._id))
        .order("asc")
        .take(taskLimit)
      : [];

    const cleanTasks = tasks.filter((task) => task.countsTowardHeadline);
    const acceptedTasks = tasks.filter((task) => task.cleanGeneralProbe && task.modelCalls > 0);
    const taskRewards = tasks.filter((task) => Number.isFinite(task.reward));
    const taskMeanReward = taskRewards.length
      ? taskRewards.reduce((sum, task) => sum + task.reward, 0) / taskRewards.length
      : undefined;

    return {
      room: { id: room._id, code: room.code, title: room.title },
      runs: runs.map((run) => ({
        id: run._id,
        iterationLabel: run.iterationLabel,
        benchmark: run.benchmark,
        model: run.model,
        materializerMode: run.materializerMode,
        status: run.status,
        taskCount: run.taskCount,
        headlineCleanProbeMean: run.headlineCleanProbeMean,
        headlineN: run.headlineN,
        startedAt: run.startedAt,
        completedAt: run.completedAt,
        notes: run.notes,
      })),
      selectedRun: selectedRun
        ? {
          id: selectedRun._id,
          iterationLabel: selectedRun.iterationLabel,
          benchmark: selectedRun.benchmark,
          model: selectedRun.model,
          materializerMode: selectedRun.materializerMode,
          status: selectedRun.status,
          taskCount: selectedRun.taskCount,
          headlineCleanProbeMean: selectedRun.headlineCleanProbeMean,
          headlineN: selectedRun.headlineN,
          startedAt: selectedRun.startedAt,
          completedAt: selectedRun.completedAt,
          notes: selectedRun.notes,
        }
        : null,
      tasks: tasks.map((task) => ({
        id: task._id,
        taskId: task.taskId,
        family: task.family,
        reward: task.reward,
        raw: task.raw,
        exceptions: task.exceptions,
        firedWriter: task.firedWriter,
        cleanGeneralProbe: task.cleanGeneralProbe,
        modelCalls: task.modelCalls,
        plannerTransport: task.plannerTransport,
        countsTowardHeadline: task.countsTowardHeadline,
        trialId: task.trialId,
        verdict: task.verdict,
        createdAt: task.createdAt,
      })),
      totals: {
        visibleRuns: runs.length,
        visibleTasks: tasks.length,
        selectedTaskCount: selectedRun?.taskCount ?? 0,
        cleanHeadlineRows: cleanTasks.length,
        cleanAcceptedRows: acceptedTasks.length,
        taskMeanReward,
      },
    };
  },
});

// Cascade-delete an iteration and all its task results (admin/agent only).
export const deleteRun = internalMutation({
  args: { evalRunId: v.id("evalRuns") },
  handler: async (ctx, { evalRunId }) => {
    const run = await ctx.db.get(evalRunId);
    if (!run) return { deleted: 0 };
    const rows = await ctx.db
      .query("taskResults")
      .withIndex("by_run", (q) => q.eq("evalRunId", evalRunId))
      .collect();
    for (const r of rows) await ctx.db.delete(r._id);
    await ctx.db.delete(evalRunId);
    return { deleted: rows.length + 1 };
  },
});

// Idempotent dedicated room for the eval ledger (keeps eval data out of user/demo rooms).
export const ensureLedgerRoom = internalMutation({
  args: {},
  handler: async (ctx) => {
    const code = "BTB-EVAL-LEDGER";
    const existing = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .first();
    if (existing) return existing._id;
    return ctx.db.insert("rooms", {
      code,
      title: "BankerToolBench — Eval Ledger",
      hostId: "system-eval-ledger",
      autoAllow: false,
      status: "live",
      createdAt: Date.now(),
    });
  },
});

// Batch-ingest one iteration + all its task rows in a single transaction (idempotent re-ingest by label).
// Used to backfill the ledger from existing sweep data. countsTowardHeadline + the headline mean are
// recomputed server-side from sweep fields. Those fields are still harness-reported, so this is useful
// telemetry rather than a fully substrate-derived anti-cheat gate.
export const ingestRun = internalMutation({
  args: {
    roomId: v.id("rooms"),
    iterationLabel: v.string(),
    benchmark: v.string(),
    model: v.optional(v.string()),
    materializerMode: v.string(),
    notes: v.optional(v.string()),
    startedAt: v.optional(v.number()),
    results: v.array(
      v.object({
        taskId: v.string(),
        family: v.optional(v.string()),
        reward: v.number(),
        raw: v.optional(v.string()),
        exceptions: v.optional(v.number()),
        firedWriter: v.string(),
        cleanGeneralProbe: v.boolean(),
        modelCalls: v.number(),
        tokensUsed: v.optional(v.number()),
        plannerTransport: v.optional(v.string()),
        trialId: v.optional(v.string()),
        verdict: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, a) => {
    // Re-ingest cleanly: drop a prior run with this label + its rows.
    const prior = await ctx.db
      .query("evalRuns")
      .withIndex("by_room", (q) => q.eq("roomId", a.roomId))
      .filter((q) => q.eq(q.field("iterationLabel"), a.iterationLabel))
      .first();
    if (prior) {
      const old = await ctx.db
        .query("taskResults")
        .withIndex("by_run", (q) => q.eq("evalRunId", prior._id))
        .collect();
      for (const r of old) await ctx.db.delete(r._id);
      await ctx.db.delete(prior._id);
    }
    const now = a.startedAt ?? Date.now();
    const evalRunId = await ctx.db.insert("evalRuns", {
      roomId: a.roomId,
      iterationLabel: a.iterationLabel,
      benchmark: a.benchmark,
      model: a.model,
      materializerMode: a.materializerMode,
      status: "running",
      taskCount: a.results.length,
      notes: a.notes,
      startedAt: now,
    });
    let countedSum = 0;
    let countedN = 0;
    for (const r of a.results) {
      const countsTowardHeadline = r.cleanGeneralProbe && r.modelCalls > 0;
      if (countsTowardHeadline) {
        countedSum += r.reward;
        countedN += 1;
      }
      await ctx.db.insert("taskResults", {
        roomId: a.roomId,
        evalRunId,
        taskId: r.taskId,
        family: r.family,
        reward: r.reward,
        raw: r.raw,
        exceptions: r.exceptions ?? 0,
        firedWriter: r.firedWriter,
        cleanGeneralProbe: r.cleanGeneralProbe,
        modelCalls: r.modelCalls,
        tokensUsed: r.tokensUsed,
        plannerTransport: r.plannerTransport,
        countsTowardHeadline,
        trialId: r.trialId,
        verdict: r.verdict,
        createdAt: now,
      });
    }
    const headlineCleanProbeMean = countedN ? countedSum / countedN : undefined;
    await ctx.db.patch(evalRunId, {
      status: "completed",
      completedAt: Date.now(),
      headlineCleanProbeMean,
      headlineN: countedN,
    });
    return { evalRunId, headlineCleanProbeMean, headlineN: countedN, taskCount: a.results.length };
  },
});

/* ────────── Adversarial-refutation verdicts (Tekton pattern) ──────────
 * recordRefutationVerdict — append a verdict to the taskResults row's refutations[],
 *   deduped by claimId (last-write-wins). BOUND at REFUTATIONS_MAX_PER_TASK.
 *   Honest doctrine: ALL outcomes persist (stands + refuted + uncertain).
 *
 * listRefutationsForRun — flat list of every verdict across the run's taskResults.
 *   Ordered by refutedAt ascending so the Trace UI can render a chronological audit.
 */

/** Server-trusted variant of recordRefutationVerdict. The ingester action and any other
 *  internal harness code calls this — no actorProof is required because there is no
 *  untrusted caller. Same upsert-by-claimId + BOUND + confidence clamp logic. */
export const recordRefutationVerdictInternal = internalMutation({
  args: {
    evalRunId: v.id("evalRuns"),
    taskId: v.string(),
    verdict: refutationVerdictV,
  },
  handler: async (ctx, a) => {
    const incoming = {
      ...a.verdict,
      confidence: Math.max(0, Math.min(1, a.verdict.confidence)),
      refutedAt: a.verdict.refutedAt ?? Date.now(),
    };
    const row = await ctx.db
      .query("taskResults")
      .withIndex("by_run_task", (q) => q.eq("evalRunId", a.evalRunId).eq("taskId", a.taskId))
      .unique();
    if (!row) throw new Error("taskResult not found for this run/task — record the result first");
    const prior = (row.refutations ?? []).filter((r) => r.claimId !== incoming.claimId);
    const next = [...prior, incoming];
    const capped = next.length > REFUTATIONS_MAX_PER_TASK ? next.slice(next.length - REFUTATIONS_MAX_PER_TASK) : next;
    await ctx.db.patch(row._id, { refutations: capped });
    return { ok: true, count: capped.length, evicted: next.length - capped.length };
  },
});

export const recordRefutationVerdict = mutation({
  args: {
    roomId: v.id("rooms"),
    evalRunId: v.id("evalRuns"),
    taskId: v.string(),
    requester: actorProofV,
    verdict: refutationVerdictV,
  },
  handler: async (ctx, a) => {
    // Auth: only members of the room may write to its ledger.
    await requireActorProof(ctx, a.roomId, a.requester);
    // Honest input gate: clamp confidence + ensure refutedAt is present (server time wins).
    const incoming = {
      ...a.verdict,
      confidence: Math.max(0, Math.min(1, a.verdict.confidence)),
      refutedAt: a.verdict.refutedAt ?? Date.now(),
    };
    // Locate the task row in this run.
    const row = await ctx.db
      .query("taskResults")
      .withIndex("by_run_task", (q) => q.eq("evalRunId", a.evalRunId).eq("taskId", a.taskId))
      .unique();
    if (!row) throw new Error("taskResult not found for this run/task — record the result first");
    // Idempotent upsert by claimId; preserve order, BOUND cap by evicting oldest entries.
    const prior = (row.refutations ?? []).filter((r) => r.claimId !== incoming.claimId);
    const next = [...prior, incoming];
    const capped = next.length > REFUTATIONS_MAX_PER_TASK ? next.slice(next.length - REFUTATIONS_MAX_PER_TASK) : next;
    await ctx.db.patch(row._id, { refutations: capped });
    return { ok: true, taskResultId: row._id, count: capped.length, evicted: next.length - capped.length };
  },
});

export const listRefutationsForRun = query({
  args: { evalRunId: v.id("evalRuns"), requester: actorProofV },
  handler: async (ctx, { evalRunId, requester }) => {
    const run = await ctx.db.get(evalRunId);
    if (!run) return { runId: evalRunId, verdicts: [] };
    await requireActorProof(ctx, run.roomId, requester);
    const rows = await ctx.db
      .query("taskResults")
      .withIndex("by_run", (q) => q.eq("evalRunId", evalRunId))
      .collect();
    const out = rows.flatMap((r) =>
      (r.refutations ?? []).map((vd) => ({ taskId: r.taskId, ...vd })),
    );
    out.sort((a, b) => (a.refutedAt ?? 0) - (b.refutedAt ?? 0));
    return { runId: evalRunId, verdicts: out };
  },
});

/** Server-side summary mirror of summarizeRefutations(client). Useful for batch reports. */
export const refutationSummaryForRun = query({
  args: { evalRunId: v.id("evalRuns"), requester: actorProofV },
  handler: async (ctx, { evalRunId, requester }) => {
    const run = await ctx.db.get(evalRunId);
    if (!run) return null;
    await requireActorProof(ctx, run.roomId, requester);
    const rows = await ctx.db
      .query("taskResults")
      .withIndex("by_run", (q) => q.eq("evalRunId", evalRunId))
      .collect();
    let total = 0, confSum = 0;
    const byOutcome: Record<"stands" | "refuted" | "uncertain", number> = { stands: 0, refuted: 0, uncertain: 0 };
    for (const r of rows) {
      for (const vd of r.refutations ?? []) {
        total++;
        byOutcome[vd.verdict]++;
        confSum += Math.max(0, Math.min(1, vd.confidence ?? 0));
      }
    }
    return { total, byOutcome, avgConfidence: total === 0 ? null : confSum / total };
  },
});