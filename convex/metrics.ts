/**
 * Landing-page live-proof metrics — public, unauthenticated, AGGREGATE-ONLY.
 *
 * Serves the `.r-land2-proof` pill on the landing hero ("N rooms live ·
 * M cells committed today"). Returns bare counts only: no codes, titles,
 * actors, or cell contents ever leave this query (it renders pre-auth).
 *
 * BOUND (agentic-reliability rule 1): a full table scan is FORBIDDEN here —
 * agent loops write traces at machine rate and rooms grow monotonically, so
 * both reads are hard-capped `.take()` scans over the newest rows:
 *
 *   - roomsLive: newest ROOMS_SCAN_CAP (200) rooms by `_creationTime` desc,
 *     counting `status === "live"` created in the last 24h. The `rooms` table
 *     has no `updatedAt` column (schema: code/title/hostId/autoAllow/status/
 *     createdAt), so `createdAt` is the honest recency proxy — "rooms live"
 *     here means "live rooms opened in the last 24h", not "rooms with recent
 *     activity". Revisit if rooms ever grow an updatedAt.
 *   - cellsCommittedToday: newest TRACES_SCAN_CAP (1000) traces by
 *     `_creationTime` desc, counting `type === "edit_applied"` with
 *     `ts >= UTC midnight`. The traces `by_room` index is roomId-prefixed and
 *     cannot serve a cross-room aggregate, so the built-in by_creation_time
 *     ordering is the suitable bounded index (`ts` is written as Date.now()
 *     at insert, so creation order tracks `ts` order).
 *
 * HONEST capped semantics (per metric): `capped` is true only when the scan
 * window came back FULL and its oldest row is still inside the time window —
 * i.e. there may be more matching rows beyond the horizon we did not count.
 * If the scan reached past the window boundary (or wasn't full), the count is
 * exact and `capped` is false. The UI renders "1,000+"-style suffixes only
 * when capped — it never inflates an exact number.
 *
 * Velocity sparkline: OMITTED this pass. The spike-threshold logic needs a
 * commit-rate history series we do not store anywhere (no metrics-history
 * table); shipping it from a single snapshot would be fabricated motion.
 * Add only once a bounded history table exists.
 */
import { query } from "./_generated/server";

export const ROOMS_SCAN_CAP = 200;
export const TRACES_SCAN_CAP = 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight for the day containing `now` — "today" is a UTC day, matching trace `ts` (epoch ms). */
export function utcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export const landingMetrics = query({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    // rooms live (last 24h) — bounded newest-first scan, never a full collect.
    const liveCutoff = now - DAY_MS;
    const rooms = await ctx.db.query("rooms").order("desc").take(ROOMS_SCAN_CAP);
    const roomsLiveValue = rooms.filter((r) => r.status === "live" && r.createdAt >= liveCutoff).length;
    const oldestRoom = rooms[rooms.length - 1];
    const roomsCapped = rooms.length === ROOMS_SCAN_CAP && oldestRoom !== undefined && oldestRoom.createdAt >= liveCutoff;

    // cells committed today (UTC) — bounded newest-first scan of the trace ledger.
    const midnight = utcMidnight(now);
    const traces = await ctx.db.query("traces").order("desc").take(TRACES_SCAN_CAP);
    const cellsValue = traces.filter((t) => t.type === "edit_applied" && t.ts >= midnight).length;
    const oldestTrace = traces[traces.length - 1];
    const cellsCapped = traces.length === TRACES_SCAN_CAP && oldestTrace !== undefined && oldestTrace.ts >= midnight;

    return {
      roomsLive: { value: roomsLiveValue, capped: roomsCapped },
      cellsCommittedToday: { value: cellsValue, capped: cellsCapped },
    };
  },
});
