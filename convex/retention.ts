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
import { ALWAYS_ON_RETENTION_DAYS, selectPrunableAlwaysOnRow } from "./alwaysOnShape";

// notebookDirtyEvents/notebookProcessingJobs: high-volume processing telemetry —
// every notebook edit (human idle/blur AND agent outline writes) appends rows
// that only ever get state-patched, never deleted. 30-day-old events are
// terminal (processed/failed) or dead-pending; the read model they produced
// lives in notebookBlocks/Claims/Mentions, which are replace-per-doc, not pruned.
// elementVersions: per-cell version-log before-images (history / Restore / diff) —
// one row per applied cell write, so it grows like traces. Bounded history by
// design: 30d matches the telemetry policy; the CURRENT value lives on `elements`
// (product data, never pruned), so pruning old log rows only shortens deep history.
const PRUNABLE = ["traces", "agentSteps", "agentOperationEvents", "notebookDirtyEvents", "notebookProcessingJobs", "elementVersions"] as const;
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

/**
 * Always-On rooms retention (same bounded-batch `by_creation_time` idiom as
 * pruneOldTelemetry above). The always-on tables are append-only — run
 * receipts every scan, an outbox row per (digest, subscriber), a subscription
 * row per opt-in attempt — with no natural ceiling. Policy (windows +
 * per-row predicate live in alwaysOnShape.selectPrunableAlwaysOnRow):
 *   - publicRoomRuns:            older than 30d (any status).
 *   - publicRoomOutbox:          TERMINAL states only (sent/skipped/failed —
 *     sent/skipped have no forward edge in alwaysOnCore.canTransition; a 30d
 *     failed row is past any live retry lane), older than 30d.
 *   - publicRoomSubscriptions:   "pending" (never confirmed) older than 7d,
 *     "unsubscribed" older than 30d. "active" is product data — NEVER pruned.
 * Status/state ride a query .filter over the index scan so old rows that must
 * survive forever (active subscriptions, stuck non-terminal outbox rows)
 * cannot permanently occupy the bounded batch and stall pruning behind them;
 * the pure predicate re-checks every row before delete (fail closed).
 * `now` is an internal-only test seam (mirrors pruneOldTelemetry's
 * retentionDays override) — the cron passes {}.
 */
export const pruneAlwaysOnRows = internalMutation({
  args: { batchPerTable: v.optional(v.number()), now: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const now = a.now ?? Date.now();
    const batch = a.batchPerTable ?? BATCH_PER_TABLE;
    const dayMs = 24 * 60 * 60 * 1000;
    const deleted = {
      publicRoomRuns: 0,
      publicRoomOutbox: 0,
      publicRoomSubscriptionsPending: 0,
      publicRoomSubscriptionsUnsubscribed: 0,
    };

    const oldRuns = await ctx.db
      .query("publicRoomRuns")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", now - ALWAYS_ON_RETENTION_DAYS.runs * dayMs))
      .take(batch);
    for (const row of oldRuns) {
      if (!selectPrunableAlwaysOnRow({ table: "publicRoomRuns", creationTime: row._creationTime }, now)) continue;
      await ctx.db.delete(row._id);
      deleted.publicRoomRuns += 1;
    }

    const oldOutbox = await ctx.db
      .query("publicRoomOutbox")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", now - ALWAYS_ON_RETENTION_DAYS.outboxTerminal * dayMs))
      .filter((q) =>
        // Literal mirror of OUTBOX_TERMINAL_STATES (the predicate re-checks
        // against the set before every delete, so drift fails closed).
        q.or(
          q.eq(q.field("state"), "sent"),
          q.eq(q.field("state"), "skipped"),
          q.eq(q.field("state"), "failed"),
        ),
      )
      .take(batch);
    for (const row of oldOutbox) {
      if (!selectPrunableAlwaysOnRow({ table: "publicRoomOutbox", creationTime: row._creationTime, state: row.state }, now)) continue;
      await ctx.db.delete(row._id);
      deleted.publicRoomOutbox += 1;
    }

    const stalePending = await ctx.db
      .query("publicRoomSubscriptions")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", now - ALWAYS_ON_RETENTION_DAYS.subscriptionPending * dayMs))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .take(batch);
    for (const row of stalePending) {
      if (!selectPrunableAlwaysOnRow({ table: "publicRoomSubscriptions", creationTime: row._creationTime, status: row.status }, now)) continue;
      await ctx.db.delete(row._id);
      deleted.publicRoomSubscriptionsPending += 1;
    }

    const staleUnsubscribed = await ctx.db
      .query("publicRoomSubscriptions")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", now - ALWAYS_ON_RETENTION_DAYS.subscriptionUnsubscribed * dayMs))
      .filter((q) => q.eq(q.field("status"), "unsubscribed"))
      .take(batch);
    for (const row of staleUnsubscribed) {
      if (!selectPrunableAlwaysOnRow({ table: "publicRoomSubscriptions", creationTime: row._creationTime, status: row.status }, now)) continue;
      await ctx.db.delete(row._id);
      deleted.publicRoomSubscriptionsUnsubscribed += 1;
    }

    return { now, deleted };
  },
});
