import { v } from "convex/values";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

/**
 * Model-frontier ingest (Solo Founder Agent Builder, honest-lane).
 *
 * Replaces the throwaway `tmpModelFrontierIngest.ts` one-off. Writes "model-frontier"
 * `evalRuns` rows (plus their child `taskResults`) under the BTB-EVAL-LEDGER room so the
 * dev/replay frontier probes flip alongside the real BTB sweeps in the public UI.
 *
 * Honest-lane invariants:
 *   - `kind: "model-frontier"` discriminator on the evalRun row (vs. "sweep" / "baseline").
 *   - `benchmark: "model-frontier"` (free-text string; publicLedgerSnapshot tolerates this).
 *   - `materializerMode: "observation"` — these are observed-only probes, NOT clean-probe credit.
 *   - Each child taskResult is forced `cleanGeneralProbe: false`, `modelCalls: 0` →
 *     `countsTowardHeadline: false`. Frontier rows do NOT contribute to the BTB headline.
 *   - Idempotent by (roomId, iterationLabel): re-ingesting the same label returns
 *     `{ skipped: true, existingEvalRunId }` without inserting a duplicate run or rows.
 *
 * Call shape (callable from a script via `npx convex run modelFrontier:recordObservations`):
 *   { iterationLabel, observations: [{ taskId, model, reward, family?, soft?, note? }] }
 */

const observationV = v.object({
  taskId: v.string(),
  model: v.string(),
  reward: v.number(),
  family: v.optional(v.string()),
  /** Soft-grade signal (e.g. partial-credit reward); preserved on the row as `verdict` text. */
  soft: v.optional(v.number()),
  /** Free-text note for the observation; preserved on the row as `raw` text. */
  note: v.optional(v.string()),
});

/**
 * Atomic ingest mutation. Wrapped by the action below so the existence-check + inserts
 * happen in a single Convex transaction (no read/write race when two scripts run).
 */
export const ingestObservationsInternal = internalMutation({
  args: {
    roomId: v.id("rooms"),
    iterationLabel: v.string(),
    observations: v.array(observationV),
  },
  handler: async (ctx, a) => {
    if (a.observations.length === 0) throw new Error("no_observations");
    if (a.observations.length > 500) throw new Error("too_many_observations");

    // Idempotent by (roomId, iterationLabel) — same gate as evalRuns:startRun.
    const existing = await ctx.db
      .query("evalRuns")
      .withIndex("by_room", (q) => q.eq("roomId", a.roomId))
      .filter((q) => q.eq(q.field("iterationLabel"), a.iterationLabel))
      .first();
    if (existing) {
      return { skipped: true as const, existingEvalRunId: existing._id };
    }

    // Run-level model: only set when every observation agrees, otherwise leave undefined
    // (per-row model still round-trips via taskResults.trialId).
    const models = new Set(a.observations.map((o) => o.model));
    const runModel = models.size === 1 ? a.observations[0].model : undefined;

    const now = Date.now();
    const evalRunId: Id<"evalRuns"> = await ctx.db.insert("evalRuns", {
      roomId: a.roomId,
      iterationLabel: a.iterationLabel,
      benchmark: "model-frontier",
      model: runModel,
      materializerMode: "observation",
      kind: "model-frontier",
      status: "running",
      taskCount: a.observations.length,
      notes: undefined,
      startedAt: now,
    });

    for (const o of a.observations) {
      // Per-row verdict captures the soft-grade signal when present; falls back to a stable
      // "observation" marker so consumers can distinguish a graded row from a missing one.
      const verdict = typeof o.soft === "number"
        ? `soft=${o.soft}`
        : "observation";
      await ctx.db.insert("taskResults", {
        roomId: a.roomId,
        evalRunId,
        taskId: o.taskId,
        family: o.family,
        reward: o.reward,
        raw: o.note,
        exceptions: 0,
        firedWriter: "model-frontier:observation",
        // Honest gate: frontier observations are NOT clean-probe credit. modelCalls=0 so
        // countsTowardHeadline=false even if a downstream re-aggregation forgets to filter.
        cleanGeneralProbe: false,
        modelCalls: 0,
        tokensUsed: undefined,
        plannerTransport: "none",
        countsTowardHeadline: false,
        // Stash the per-observation model id in trialId so it round-trips losslessly.
        trialId: o.model,
        verdict,
        createdAt: now,
      });
    }

    // Frontier runs have no clean-probe headline by construction — finish with mean=undefined.
    await ctx.db.patch(evalRunId, {
      status: "completed",
      completedAt: Date.now(),
      headlineCleanProbeMean: undefined,
      headlineN: 0,
    });

    return { skipped: false as const, evalRunId, taskCount: a.observations.length };
  },
});

/**
 * Public entry point for replay scripts. Ensures the BTB-EVAL-LEDGER room exists, then
 * delegates to the atomic `ingestObservationsInternal` mutation above.
 *
 * Idempotent: if an evalRun with the same iterationLabel already lives under the ledger
 * room, returns `{ skipped: true, existingEvalRunId }` and inserts nothing.
 */
export const recordObservations = internalAction({
  args: {
    iterationLabel: v.string(),
    observations: v.array(observationV),
  },
  handler: async (ctx, a): Promise<
    | { skipped: true; existingEvalRunId: Id<"evalRuns">; roomId: Id<"rooms"> }
    | { skipped: false; evalRunId: Id<"evalRuns">; roomId: Id<"rooms">; taskCount: number }
  > => {
    const roomId: Id<"rooms"> = await ctx.runMutation(
      internal.evalRuns.ensureLedgerRoom,
      {},
    );
    const result = await ctx.runMutation(internal.modelFrontier.ingestObservationsInternal, {
      roomId,
      iterationLabel: a.iterationLabel,
      observations: a.observations,
    });
    if (result.skipped) {
      return { skipped: true, existingEvalRunId: result.existingEvalRunId, roomId };
    }
    return {
      skipped: false,
      evalRunId: result.evalRunId,
      roomId,
      taskCount: result.taskCount,
    };
  },
});
