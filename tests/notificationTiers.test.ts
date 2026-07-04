/**
 * Notification tiers — scenario tests for the PURE policy module
 * (src/notifications/tiers.ts) behind the watch + notifications design:
 *   "instant (mentions, watched rows) / hourly (run digests) / daily (rest)".
 *
 * Persona: Dana, a credit analyst in a live deal room. She watches 3 pipeline
 * rows (W key), gets @-mentioned by teammates, and her room hosts agent runs
 * that write in bursts. Angles covered: happy path, mislabeled/adversarial
 * inputs, delimiter injection, DST/UTC bucket edges, short burst (500 writes)
 * AND sustained 48h accumulation with repeated cap eviction.
 */
import { describe, expect, it } from "vitest";
import {
  NOTIFICATIONS_MAX_PER_ROOM,
  capNotifications,
  dedupeKeyFor,
  digestWindows,
  tierFor,
  type NotificationTier,
} from "../src/notifications/tiers";

const HOUR = 3_600_000;

describe("scenario: Dana watches 3 rows through an agent burst of 500 writes", () => {
  const roomId = "room-deal-7";
  const watchedRows = new Set(["r-004", "r-017", "r-042"]);
  // Agent run-42 writes 5 times to each of 100 rows = 500 writes.
  const writes: Array<{ row: string; n: number }> = [];
  for (let pass = 0; pass < 5; pass++) {
    for (let i = 0; i < 100; i++) {
      writes.push({ row: `r-${String(i).padStart(3, "0")}`, n: pass });
    }
  }

  it("routes instant ONLY for the watched rows; the rest of the burst is daily", () => {
    const tally: Record<NotificationTier, number> = { instant: 0, hourly: 0, daily: 0 };
    for (const w of writes) {
      tally[tierFor("watched_write", watchedRows.has(w.row), false)]++;
    }
    expect(writes.length).toBe(500);
    expect(tally.instant).toBe(15); // 3 watched rows x 5 writes
    expect(tally.daily).toBe(485); // unwatched writes are "rest"
    expect(tally.hourly).toBe(0); // no digests in this burst
  });

  it("dedupe collapses per-run spam: 500 writes -> 100 keys, watched slice -> 3", () => {
    const keys = new Set<string>();
    const watchedKeys = new Set<string>();
    for (const w of writes) {
      const key = dedupeKeyFor({ roomId, kind: "watched_write", run: "run-42", target: w.row });
      keys.add(key);
      if (watchedRows.has(w.row)) watchedKeys.add(key);
    }
    expect(keys.size).toBe(100); // 5 repeat writes per row collapse
    expect(watchedKeys.size).toBe(3); // Dana sees 3 instant rows, not 15 pings
  });

  it("a different run does NOT collapse into the previous run's keys", () => {
    const a = dedupeKeyFor({ roomId, kind: "watched_write", run: "run-42", target: "r-004" });
    const b = dedupeKeyFor({ roomId, kind: "watched_write", run: "run-43", target: "r-004" });
    expect(a).not.toBe(b);
  });
});

describe("scenario: mentions and run digests during the same burst", () => {
  it("mentions are instant — via kind or via flag, and the flag wins over any kind", () => {
    expect(tierFor("mention", false, false)).toBe("instant");
    expect(tierFor("mention", false, true)).toBe("instant");
    expect(tierFor("watched_write", false, true)).toBe("instant"); // named directly in a write
    expect(tierFor("run_digest", false, true)).toBe("instant"); // named inside a digest
  });

  it("run digests are hourly even when the run touched watched rows", () => {
    // The watched WRITE already fired instant; the digest stays a digest.
    expect(tierFor("run_digest", true, false)).toBe("hourly");
    expect(tierFor("run_digest", false, false)).toBe("hourly");
  });

  it("adversarial: unknown kinds and mislabeled events demote to daily, never promote", () => {
    expect(tierFor("watched_write", false, false)).toBe("daily"); // target not actually watched
    expect(tierFor("totally_new_kind", true, false)).toBe("daily"); // forward-compat kind
    expect(tierFor("", false, false)).toBe("daily");
  });
});

describe("scenario: digest buckets stay stable across DST edges (UTC bucketing)", () => {
  it("returns exact UTC keys and window ends", () => {
    const w = digestWindows(Date.UTC(2026, 6, 4, 18, 30, 15));
    expect(w.hourlyKey).toBe("hourly:2026-07-04T18Z");
    expect(w.dailyKey).toBe("daily:2026-07-04");
    expect(w.hourlyEndsAt).toBe(Date.UTC(2026, 6, 4, 19));
    expect(w.dailyEndsAt).toBe(Date.UTC(2026, 6, 5));
  });

  it("spring-forward (US 2026-03-08): 30 consecutive hours -> 30 unique, ordered buckets", () => {
    // America/New_York skips 02:00->03:00 local at 07:00 UTC; UTC buckets must not care.
    const start = Date.UTC(2026, 2, 7, 20); // 2026-03-07T20:00Z
    const keys: string[] = [];
    for (let h = 0; h < 30; h++) keys.push(digestWindows(start + h * HOUR).hourlyKey);
    expect(new Set(keys).size).toBe(30); // no duplicated bucket
    expect([...keys].sort()).toEqual(keys); // no skipped/reordered bucket
  });

  it("fall-back (US 2026-11-01): the repeated local hour still yields unique buckets", () => {
    const start = Date.UTC(2026, 9, 31, 20); // 2026-10-31T20:00Z, crosses 06:00Z fall-back
    const keys: string[] = [];
    for (let h = 0; h < 30; h++) keys.push(digestWindows(start + h * HOUR).hourlyKey);
    expect(new Set(keys).size).toBe(30);
    expect([...keys].sort()).toEqual(keys);
  });

  it("daily bucket rolls exactly at UTC midnight, hourly exactly on the hour", () => {
    const midnight = Date.UTC(2026, 2, 8);
    expect(digestWindows(midnight - 1).dailyKey).toBe("daily:2026-03-07");
    expect(digestWindows(midnight).dailyKey).toBe("daily:2026-03-08");
    const hour = Date.UTC(2026, 2, 8, 7);
    expect(digestWindows(hour - 1).hourlyKey).toBe("hourly:2026-03-08T06Z");
    expect(digestWindows(hour).hourlyKey).toBe("hourly:2026-03-08T07Z");
  });

  it("adversarial timestamps never produce NaN keys", () => {
    expect(digestWindows(Number.NaN).hourlyKey).toBe("hourly:1970-01-01T00Z");
    expect(digestWindows(Number.POSITIVE_INFINITY).dailyKey).toBe("daily:1970-01-01");
    const preEpoch = digestWindows(-1); // clock skew before epoch: still a real bucket
    expect(preEpoch.hourlyKey).toBe("hourly:1969-12-31T23Z");
    expect(preEpoch.dailyEndsAt).toBe(0);
  });
});

describe("dedupeKeyFor is deterministic and injection-proof", () => {
  it("is insensitive to property insertion order", () => {
    expect(dedupeKeyFor({ roomId: "r1", kind: "mention", to: "m9" })).toBe(
      dedupeKeyFor({ to: "m9", roomId: "r1", kind: "mention" }),
    );
  });

  it("skips undefined/null so absent and explicit-undefined hash identically", () => {
    expect(dedupeKeyFor({ a: "x", b: undefined, c: null })).toBe(dedupeKeyFor({ a: "x" }));
  });

  it("adversarial: delimiter injection in values cannot forge a different structure", () => {
    expect(dedupeKeyFor({ a: "b|c=d" })).not.toBe(dedupeKeyFor({ a: "b", c: "d" }));
    // escape char itself is escaped: a literal "%7c" is not a literal "|"
    expect(dedupeKeyFor({ a: "%7c" })).not.toBe(dedupeKeyFor({ a: "|" }));
  });

  it("coerces scalars to strings (documented) and handles empty parts", () => {
    expect(dedupeKeyFor({ n: 5 })).toBe(dedupeKeyFor({ n: "5" }));
    expect(dedupeKeyFor({})).toBe("");
  });
});

type Note = { id: string; createdAt: number; readAt?: number | null };
const mkNote = (id: string, createdAt: number, read: boolean): Note => ({
  id,
  createdAt,
  readAt: read ? createdAt + 1 : undefined,
});

describe("scenario: inbox cap evicts oldest-READ-first", () => {
  it("read items are spent: they evict before ANY unread item, oldest first", () => {
    // 60 old read + 60 new unread, cap 50 -> all 60 read out, 10 oldest unread out.
    const list: Note[] = [];
    for (let i = 0; i < 120; i++) list.push(mkNote(`n${i}`, 1000 + i, i < 60));
    const { kept, evicted } = capNotifications(list, 50);
    expect(kept).toHaveLength(50);
    expect(evicted).toHaveLength(70);
    expect(kept.every((n) => n.readAt == null)).toBe(true); // survivors all unread
    expect(kept[0].id).toBe("n119"); // newest-first ordering
    expect(kept[49].id).toBe("n70");
    expect(evicted.slice(0, 60).map((n) => n.id)).toEqual(
      Array.from({ length: 60 }, (_, i) => `n${i}`), // read evict first, oldest first
    );
    expect(evicted[60].id).toBe("n60"); // then oldest unread
  });

  it("an ancient unread item outlives brand-new read items", () => {
    const list: Note[] = [
      mkNote("ancient-unread", 1, false),
      mkNote("read-a", 100, true),
      mkNote("read-b", 200, true),
      mkNote("read-c", 300, true),
      mkNote("fresh-unread", 400, false),
    ];
    const { kept } = capNotifications(list, 2);
    expect(kept.map((n) => n.id)).toEqual(["fresh-unread", "ancient-unread"]);
  });

  it("all-unread burst falls back to oldest-unread eviction", () => {
    const list = Array.from({ length: 600 }, (_, i) => mkNote(`u${i}`, i, false));
    const { kept, evicted } = capNotifications(list, 500);
    expect(kept).toHaveLength(500);
    expect(evicted.map((n) => n.id)).toEqual(Array.from({ length: 100 }, (_, i) => `u${i}`));
  });

  it("is idempotent: capping the kept list again changes nothing", () => {
    const list = Array.from({ length: 80 }, (_, i) => mkNote(`n${i}`, i, i % 2 === 0));
    const first = capNotifications(list, 50);
    const second = capNotifications(first.kept, 50);
    expect(second.evicted).toHaveLength(0);
    expect(second.kept).toEqual(first.kept);
  });

  it("adversarial: hostile caps and timestamps degrade safely", () => {
    const list = [mkNote("a", 10, false), mkNote("b", Number.NaN, true)];
    expect(capNotifications(list, 0).kept).toHaveLength(0);
    expect(capNotifications(list, -5).kept).toHaveLength(0);
    expect(capNotifications(list, Number.NaN).kept).toHaveLength(0);
    expect(capNotifications([], 50)).toEqual({ kept: [], evicted: [] });
    expect(capNotifications(list, 10).kept).toHaveLength(2); // cap above length keeps all
    // NaN createdAt sorts as oldest -> evicted first when over cap
    expect(capNotifications(list, 1).evicted[0].id).toBe("b");
    // equal createdAt: stable tie-break by original position
    const ties = [mkNote("x", 5, false), mkNote("y", 5, false), mkNote("z", 5, false)];
    expect(capNotifications(ties, 2).evicted[0].id).toBe("x");
    expect(capNotifications(ties, 2).kept.map((n) => n.id)).toEqual(["y", "z"]);
  });
});

describe("scenario: sustained 48h room — 10k events, repeated cap, stable buckets", () => {
  it("10,000 events over 48h land in exactly 48 hourly and 2 daily buckets", () => {
    const start = Date.UTC(2026, 0, 1);
    const hourly = new Set<string>();
    const daily = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const w = digestWindows(start + i * 17_280); // 10k * 17.28s = exactly 48h
      hourly.add(w.hourlyKey);
      daily.add(w.dailyKey);
    }
    expect(hourly.size).toBe(48);
    expect(daily.size).toBe(2);
  });

  it("inbox stays bounded under sustained accumulation with periodic eviction", () => {
    const start = Date.UTC(2026, 0, 1);
    let inbox: Note[] = [];
    for (let i = 0; i < 10_000; i++) {
      inbox.push(mkNote(`e${i}`, start + i * 17_280, i % 3 === 0)); // Dana reads 1 in 3
      if (inbox.length > NOTIFICATIONS_MAX_PER_ROOM) {
        inbox = capNotifications(inbox, NOTIFICATIONS_MAX_PER_ROOM).kept;
        expect(inbox.length).toBeLessThanOrEqual(NOTIFICATIONS_MAX_PER_ROOM);
      }
    }
    expect(inbox.length).toBeLessThanOrEqual(NOTIFICATIONS_MAX_PER_ROOM);
    // Newest-first invariant holds after thousands of eviction rounds.
    for (let i = 1; i < inbox.length; i++) {
      expect(inbox[i - 1].createdAt).toBeGreaterThanOrEqual(inbox[i].createdAt);
    }
    // Policy invariant on a final over-cap call: if ANY unread was evicted,
    // then NO read item survived (read always spends first).
    const final = capNotifications(
      [...inbox, ...Array.from({ length: 200 }, (_, i) => mkNote(`x${i}`, start, false))],
      NOTIFICATIONS_MAX_PER_ROOM,
    );
    const unreadEvicted = final.evicted.some((n) => n.readAt == null);
    const readKept = final.kept.some((n) => n.readAt != null);
    expect(unreadEvicted && readKept).toBe(false);
  });
});
