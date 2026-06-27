/**
 * Data-retention pruning (production gate: telemetry does not grow unbounded).
 *
 * The high-volume, append-only telemetry tables (traces, agentSteps, agentOperationEvents) grow
 * every cycle of every run with no natural ceiling — on a live deployment that compounds nightly.
 * This prunes rows older than RETENTION_DAYS using Convex's built-in `by_creation_time` system index
 * (a global, age-ordered scan), in a BOUNDED batch per table per run so a single mutation never
 * exceeds Convex's write limits. The cron fires every 6h; a backlog drains over several runs.
 *
 * Deliberately NOT pruned: product data (artifacts/elements/drafts/proposals), chat `messages`, and
 * `agentRuns` (the spend ledger the daily cap reads). This bounds storage growth without deleting
 * anything a user or a gate still depends on.
 */
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";

const PRUNABLE = ["traces", "agentSteps", "agentOperationEvents"] as const;
const DEFAULT_RETENTION_DAYS = 30;
const BATCH_PER_TABLE = 500;
const PRODUCT_DATA_NOT_PRUNED = [
  "rooms",
  "members",
  "artifacts",
  "elements",
  "messages",
  "agentRuns",
  "sourceCaptures",
  "evidenceFacts",
  // Credit wallet — the spend ledger + grants + balances are financial records, never pruned.
  "roomCredits",
  "creditLedger",
  "creditGrants",
] as const;

export const telemetryRetentionPolicy = internalQuery({
  args: {},
  handler: () => ({
    policy: "telemetry_retention_v1",
    defaultRetentionDays: DEFAULT_RETENTION_DAYS,
    batchPerTable: BATCH_PER_TABLE,
    prunableTables: [...PRUNABLE],
    productDataNotPruned: [...PRODUCT_DATA_NOT_PRUNED],
    note: "This bounds high-volume telemetry only. Privacy export/delete uses a separate audited runbook path.",
  }),
});

export const pruneOldTelemetry = internalMutation({
  args: { retentionDays: v.optional(v.number()), batchPerTable: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const days = a.retentionDays ?? DEFAULT_RETENTION_DAYS;
    const batch = a.batchPerTable ?? BATCH_PER_TABLE;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const deleted: Record<string, number> = {};
    for (const table of PRUNABLE) {
      const old = await ctx.db
        .query(table)
        .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
        .take(batch);
      for (const row of old) await ctx.db.delete(row._id);
      deleted[table] = old.length;
    }
    return { cutoff, deleted };
  },
});
