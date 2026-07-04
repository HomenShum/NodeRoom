/**
 * Notification tiers — PURE policy helpers behind watch + notifications.
 *
 * Design contract (parity queue, notifications item):
 *   "Notifications: instant (mentions, watched rows) / hourly (run digests) /
 *    daily (rest); watch = W/swipe"
 *
 * This module is deliberately dependency-free and deterministic so BOTH sides
 * share one policy:
 *   - convex/watches.ts (full code staged in docs/design/WATCHES_SCHEMA_SNIPPET.md,
 *     tables in convex/watchesTables.ts) imports it server-side for tier
 *     computation, dedupe keys, and BOUND eviction.
 *   - the wave-2 notifications UI imports it client-side to group by tier.
 *
 * Reliability checklist mapping:
 *   - DETERMINISTIC — dedupeKeyFor sorts + escapes parts: same parts in any
 *     insertion order → byte-identical key; delimiter injection cannot collide.
 *   - BOUND — NOTIFICATIONS_MAX_PER_ROOM / WATCHES_MAX_PER_MEMBER caps plus
 *     capNotifications (oldest-read-first eviction) keep collections finite.
 *   - DST-safe — digest bucket keys are UTC-derived; wall-clock DST
 *     transitions can never skip or duplicate a bucket.
 */

export type NotificationKind = "mention" | "watched_write" | "run_digest";
export type NotificationTier = "instant" | "hourly" | "daily";

export const NOTIFICATION_TIERS: readonly NotificationTier[] = ["instant", "hourly", "daily"];

/** BOUND: max notification events retained per room (oldest-read-first eviction above this). */
export const NOTIFICATIONS_MAX_PER_ROOM = 500;
/** BOUND: extra rows read past the cap when scanning for eviction (steady state never exceeds it). */
export const NOTIFICATIONS_EVICT_BATCH = 64;
/** listNotifications page size — newest first. */
export const NOTIFICATIONS_PAGE = 50;
/** BOUND: max watch rows per member per room; setWatch throws watch_limit_reached above this. */
export const WATCHES_MAX_PER_MEMBER = 200;

/**
 * Tier routing. Precedence (first match wins):
 *   1. mention (flag or kind)          → instant — a person was named directly.
 *   2. run_digest                      → hourly — digests stay digests even when the
 *      run touched watched rows; the watched WRITE itself already fired instant.
 *   3. watched_write on a watched target → instant.
 *   4. everything else ("rest", including watched_write whose target is NOT
 *      actually watched — mislabeled events demote, never promote) → daily.
 *
 * `kind` accepts unknown strings on purpose: forward-compat events fall to daily.
 */
export function tierFor(
  kind: NotificationKind | (string & {}),
  isWatchedTarget: boolean,
  isMention: boolean,
): NotificationTier {
  if (isMention || kind === "mention") return "instant";
  if (kind === "run_digest") return "hourly";
  if (kind === "watched_write" && isWatchedTarget) return "instant";
  return "daily";
}

export type DigestWindows = {
  /** e.g. "hourly:2026-07-04T18Z" — UTC hour bucket. */
  hourlyKey: string;
  /** e.g. "daily:2026-07-04" — UTC day bucket. */
  dailyKey: string;
  /** ms epoch — start of the next UTC hour (when the hourly digest flushes). */
  hourlyEndsAt: number;
  /** ms epoch — start of the next UTC day (when the daily digest flushes). */
  dailyEndsAt: number;
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Bucket keys for digest tiers. UTC-only on purpose: DST wall-clock jumps
 * (spring-forward skips an hour, fall-back repeats one) can never skip or
 * duplicate a bucket because UTC has no transitions. Non-finite input clamps
 * to epoch 0 rather than producing "hourly:NaN-NaN..." keys.
 */
export function digestWindows(now: number): DigestWindows {
  const t = Number.isFinite(now) ? Math.floor(now) : 0;
  // Floor division (not %) so pre-1970 timestamps still bucket correctly.
  const hourStart = Math.floor(t / HOUR_MS) * HOUR_MS;
  const dayStart = Math.floor(t / DAY_MS) * DAY_MS;
  const d = new Date(hourStart);
  const pad = (n: number) => String(n).padStart(2, "0");
  const dayLabel = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return {
    hourlyKey: `hourly:${dayLabel}T${pad(d.getUTCHours())}Z`,
    dailyKey: `daily:${dayLabel}`,
    hourlyEndsAt: hourStart + HOUR_MS,
    dailyEndsAt: dayStart + DAY_MS,
  };
}

export type DedupeParts = Record<string, string | number | boolean | null | undefined>;

/** Escape the join delimiters (and the escape char itself) so values cannot forge structure. */
function escapePart(s: string): string {
  return s.replace(/[%|=]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/**
 * Deterministic sorted-key dedupe key. Properties are sorted by key name, so
 * insertion order never changes the output; undefined/null entries are skipped
 * (an absent field and an explicit undefined hash identically); values are
 * string-coerced then delimiter-escaped, so `{a:"b|c=d"}` can never collide
 * with `{a:"b", c:"d"}`.
 */
export function dedupeKeyFor(parts: DedupeParts): string {
  return Object.keys(parts)
    .filter((k) => parts[k] !== undefined && parts[k] !== null)
    .sort()
    .map((k) => `${escapePart(k)}=${escapePart(String(parts[k]))}`)
    .join("|");
}

export type CappableNotification = {
  createdAt: number;
  /** ms epoch when the recipient read it; null/undefined = unread. */
  readAt?: number | null;
};

export type CapResult<T> = {
  /** Survivors, newest-first (createdAt desc, stable on ties). Length <= max. */
  kept: T[];
  /** Evicted rows in eviction order: read-oldest first, then unread-oldest. */
  evicted: T[];
};

/**
 * BOUND eviction: keep at most `max` notifications, evicting oldest-READ-first —
 * read items are spent; unread items are only sacrificed once no read items
 * remain. Deterministic: ties on createdAt break by original list position.
 * Idempotent: capNotifications(kept, max).kept === kept (same order, no evictions).
 * Non-finite createdAt sorts as epoch 0 (oldest); max < 0 or non-finite → 0.
 */
export function capNotifications<T extends CappableNotification>(
  list: readonly T[],
  max: number,
): CapResult<T> {
  const cap = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : 0;
  const indexed = list.map((n, i) => ({
    n,
    i,
    at: Number.isFinite(n.createdAt) ? n.createdAt : 0,
    read: n.readAt !== null && n.readAt !== undefined,
  }));
  const newestFirst = (rows: typeof indexed) =>
    [...rows].sort((a, b) => b.at - a.at || a.i - b.i).map((x) => x.n);
  if (indexed.length <= cap) return { kept: newestFirst(indexed), evicted: [] };
  const overflow = indexed.length - cap;
  const evictOrder = [...indexed].sort((a, b) => {
    if (a.read !== b.read) return a.read ? -1 : 1; // read evicts before unread
    return a.at - b.at || a.i - b.i; // then oldest first, stable
  });
  const evicted = evictOrder.slice(0, overflow);
  const evictedSet = new Set(evicted);
  return {
    kept: newestFirst(indexed.filter((x) => !evictedSet.has(x))),
    evicted: evicted.map((x) => x.n),
  };
}
