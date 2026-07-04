/**
 * offlineQueue — scenario tests for the pure offline edit-hold module.
 *
 * Persona: Priya, a banker on hotel wifi, keeps editing the Company research
 * sheet while the connection flaps. Every CAS edit that fails on TRANSPORT is
 * held (bounded, oldest-dropped-with-a-visible-count) and replayed on
 * reconnect through the same applyEdit path — so a replayed op that lost its
 * compare-and-swap race surfaces as an honest conflict, never a clobber.
 *
 * Coverage angles:
 *  - happy: enqueue → FIFO replay → drained, order preserved
 *  - sad: quota-throwing storage, storage unavailable, empty replay
 *  - adversarial: corrupt/foreign/wrong-version storage, poison ops, re-entrant replay
 *  - scale/burst: 60 edits in one offline burst → 50 held + 10 honestly dropped
 *  - sustained: 200 flap cycles — bound holds, counters stay coherent, storage stays parseable
 */
import { describe, expect, it } from "vitest";
import {
  OFFLINE_QUEUE_MAX,
  OFFLINE_QUEUE_STORAGE_VERSION,
  OfflineEditQueue,
  isNetworkError,
  type QueuedEdit,
  type StorageLike,
} from "../src/notifications/offlineQueue";
import type { ChangeOp } from "../src/engine/types";

const ROOM = "room-priya";
const KEY = "noderoom:offlineEdits:v1:room-priya";

function op(n: number): ChangeOp {
  return { opId: `op-${n}`, artifactId: "art-research", elementId: `sr_${String(n).padStart(4, "0")}__summary`, kind: "set", value: `edit ${n}`, baseVersion: n };
}

/** In-memory StorageLike — behaves like localStorage for round-trip tests. */
function memoryStorage(seed?: Record<string, string>): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k)! : null),
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

const okApply = async (): Promise<{ ok: boolean; reason?: string }> => ({ ok: true });

describe("offline queue — hold, bound, and visible loss", () => {
  it("holds ops FIFO and reports them in the snapshot (happy path)", () => {
    const q = new OfflineEditQueue({ storageKey: KEY, storage: memoryStorage() });
    for (let i = 1; i <= 5; i++) q.enqueue(ROOM, op(i));
    expect(q.size()).toBe(5);
    expect(q.list().map((e) => e.op.opId)).toEqual(["op-1", "op-2", "op-3", "op-4", "op-5"]);
    expect(q.snapshot()).toEqual({ held: 5, dropped: 0, conflicts: 0, replaying: false });
  });

  it("SCENARIO: Priya fires 60 edits into a dead connection — 50 held, 10 oldest dropped with an honest count", () => {
    const storage = memoryStorage();
    const q = new OfflineEditQueue({ storageKey: KEY, storage });
    for (let i = 1; i <= 60; i++) q.enqueue(ROOM, op(i));
    const snap = q.snapshot();
    expect(snap.held).toBe(OFFLINE_QUEUE_MAX); // 50
    expect(snap.dropped).toBe(10); // loss is counted, never silent
    // The OLDEST edits are the ones dropped — the newest intent survives.
    expect(q.list()[0].op.opId).toBe("op-11");
    expect(q.list()[q.size() - 1].op.opId).toBe("op-60");
    // The persisted copy agrees with memory (a refresh must not resurrect dropped ops).
    const persisted = JSON.parse(storage.data.get(KEY)!) as { dropped: number; entries: QueuedEdit[] };
    expect(persisted.entries).toHaveLength(OFFLINE_QUEUE_MAX);
    expect(persisted.dropped).toBe(10);
  });
});

describe("offline queue — localStorage round-trip and recovery", () => {
  it("round-trips through storage: a page refresh rebuilds held ops AND the dropped count", () => {
    const storage = memoryStorage();
    const first = new OfflineEditQueue({ storageKey: KEY, storage });
    for (let i = 1; i <= 53; i++) first.enqueue(ROOM, op(i));
    // Priya's laptop sleeps; the tab reloads; a NEW queue hydrates from the same storage.
    const second = new OfflineEditQueue({ storageKey: KEY, storage });
    expect(second.size()).toBe(OFFLINE_QUEUE_MAX);
    expect(second.snapshot().dropped).toBe(3);
    expect(second.list().map((e) => e.op.opId)).toEqual(first.list().map((e) => e.op.opId));
  });

  it("recovers from CORRUPT storage (garbage JSON) to an empty queue without throwing, and resets the key", () => {
    const storage = memoryStorage({ [KEY]: "{not json ⚠" });
    const q = new OfflineEditQueue({ storageKey: KEY, storage });
    expect(q.size()).toBe(0);
    expect(q.snapshot()).toEqual({ held: 0, dropped: 0, conflicts: 0, replaying: false });
    expect(storage.data.has(KEY)).toBe(false); // poisoned payload cleared so it can't re-corrupt
    q.enqueue(ROOM, op(1)); // and the queue still works afterwards
    expect(q.size()).toBe(1);
  });

  it("treats a foreign/wrong-version payload as corrupt (adversarial: another app wrote our key)", () => {
    for (const raw of [
      JSON.stringify({ v: 999, dropped: 0, entries: [] }),
      JSON.stringify({ hello: "world" }),
      JSON.stringify([1, 2, 3]),
      JSON.stringify({ v: OFFLINE_QUEUE_STORAGE_VERSION, dropped: 0, entries: "nope" }),
    ]) {
      const q = new OfflineEditQueue({ storageKey: KEY, storage: memoryStorage({ [KEY]: raw }) });
      expect(q.size()).toBe(0);
    }
  });

  it("drops invalid ROWS inside a valid payload and counts them as dropped (partial corruption)", () => {
    const good = { roomId: ROOM, op: op(1), queuedAt: 123 };
    const raw = JSON.stringify({ v: OFFLINE_QUEUE_STORAGE_VERSION, dropped: 2, entries: [good, { junk: true }, null] });
    const q = new OfflineEditQueue({ storageKey: KEY, storage: memoryStorage({ [KEY]: raw }) });
    expect(q.size()).toBe(1);
    expect(q.list()[0].op.opId).toBe("op-1");
    expect(q.snapshot().dropped).toBe(4); // 2 persisted + 2 invalid rows — loss surfaced, not hidden
  });

  it("keeps working in-memory when storage throws (quota exceeded / privacy mode)", () => {
    const throwing: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new DOMException("QuotaExceededError"); },
      removeItem: () => { throw new DOMException("SecurityError"); },
    };
    const q = new OfflineEditQueue({ storageKey: KEY, storage: throwing });
    for (let i = 1; i <= 3; i++) q.enqueue(ROOM, op(i));
    expect(q.size()).toBe(3); // in-memory queue is the source of truth
  });
});

describe("offline queue — replay through the applyEdit path", () => {
  it("replays FIFO in enqueue order and drains fully when the server accepts everything", async () => {
    const q = new OfflineEditQueue({ storageKey: KEY, storage: memoryStorage() });
    for (let i = 1; i <= 8; i++) q.enqueue(ROOM, op(i));
    const seen: string[] = [];
    const result = await q.replay(async (entry) => { seen.push(entry.op.opId); return { ok: true }; });
    expect(seen).toEqual(["op-1", "op-2", "op-3", "op-4", "op-5", "op-6", "op-7", "op-8"]);
    expect(result).toMatchObject({ applied: 8, stoppedByNetwork: false });
    expect(q.snapshot()).toEqual({ held: 0, dropped: 0, conflicts: 0, replaying: false });
  });

  it("SCENARIO: replay meets a CAS conflict — the conflict surfaces honestly and the queue CONTINUES", async () => {
    // While Priya was offline, Maya edited the same cell. The server answers the replayed op
    // with a conflict — a decision, not an outage — so it must NOT block the rest of the queue.
    const q = new OfflineEditQueue({ storageKey: KEY, storage: memoryStorage() });
    for (let i = 1; i <= 5; i++) q.enqueue(ROOM, op(i));
    const result = await q.replay(async (entry) =>
      entry.op.opId === "op-3" ? { ok: false, reason: "version_conflict" } : { ok: true },
    );
    expect(result.applied).toBe(4);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].entry.op.opId).toBe("op-3");
    expect(result.conflicts[0].reason).toBe("version_conflict");
    expect(result.stoppedByNetwork).toBe(false);
    expect(q.size()).toBe(0); // conflict op is NOT retried — the race is lost, retrying would clobber
    expect(q.snapshot().conflicts).toBe(1); // …and the loss is visible until acknowledged
    q.resetConflicts();
    expect(q.snapshot().conflicts).toBe(0);
  });

  it("SCENARIO: reconnect flaps mid-replay — the failing op stays at the HEAD and the next pass resumes in order", async () => {
    const q = new OfflineEditQueue({ storageKey: KEY, storage: memoryStorage() });
    for (let i = 1; i <= 10; i++) q.enqueue(ROOM, op(i));
    // First pass: 4 ops land, then the wifi drops again mid-replay.
    let appliedCalls = 0;
    const first = await q.replay(async () => {
      appliedCalls += 1;
      if (appliedCalls === 5) throw new TypeError("Failed to fetch");
      return { ok: true };
    });
    expect(first.applied).toBe(4);
    expect(first.stoppedByNetwork).toBe(true);
    expect(q.size()).toBe(6); // op-5 was NOT lost — it is still at the head
    expect(q.list()[0].op.opId).toBe("op-5");
    // Second pass (connection healed): drains the remainder, op-5 applied exactly once, in order.
    const seen: string[] = [];
    const second = await q.replay(async (entry) => { seen.push(entry.op.opId); return { ok: true }; });
    expect(seen).toEqual(["op-5", "op-6", "op-7", "op-8", "op-9", "op-10"]);
    expect(second.applied).toBe(6);
    expect(q.size()).toBe(0);
  });

  it("is re-entrancy safe: a second replay call while one is running is a no-op (adversarial: online event storm)", async () => {
    const q = new OfflineEditQueue({ storageKey: KEY, storage: memoryStorage() });
    for (let i = 1; i <= 3; i++) q.enqueue(ROOM, op(i));
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const applications: string[] = [];
    const slowReplay = q.replay(async (entry) => { applications.push(entry.op.opId); await gate; return { ok: true }; });
    const concurrent = await q.replay(async (entry) => { applications.push(`DUPLICATE-${entry.op.opId}`); return { ok: true }; });
    expect(concurrent).toEqual({ applied: 0, conflicts: [], stoppedByNetwork: false });
    release();
    await slowReplay;
    expect(applications).toEqual(["op-1", "op-2", "op-3"]); // no op applied twice
  });

  it("a poison op (unknown non-network throw) is dequeued and counted as a conflict — it can never wedge the queue", async () => {
    const q = new OfflineEditQueue({ storageKey: KEY, storage: memoryStorage() });
    for (let i = 1; i <= 3; i++) q.enqueue(ROOM, op(i));
    const result = await q.replay(async (entry) => {
      if (entry.op.opId === "op-2") throw new Error("element_schema_rejected");
      return { ok: true };
    });
    expect(result.applied).toBe(2);
    expect(result.conflicts.map((c) => c.reason)).toEqual(["element_schema_rejected"]);
    expect(result.stoppedByNetwork).toBe(false);
    expect(q.size()).toBe(0);
  });

  it("replaying an empty queue is a harmless no-op (sad path)", async () => {
    const q = new OfflineEditQueue({ storageKey: KEY, storage: memoryStorage() });
    const result = await q.replay(okApply);
    expect(result).toEqual({ applied: 0, conflicts: [], stoppedByNetwork: false });
  });
});

describe("offline queue — sustained flapping connection (long-running state accumulation)", () => {
  it("200 burst/replay cycles: the bound holds, counters stay coherent, and storage stays parseable", async () => {
    const storage = memoryStorage();
    const q = new OfflineEditQueue({ storageKey: KEY, storage });
    let opCounter = 0;
    let expectedConflicts = 0;
    for (let cycle = 0; cycle < 200; cycle++) {
      // Burst: 1-7 edits while offline (deterministic pseudo-random).
      const burst = (cycle % 7) + 1;
      for (let b = 0; b < burst; b++) q.enqueue(ROOM, op(++opCounter));
      expect(q.size()).toBeLessThanOrEqual(OFFLINE_QUEUE_MAX); // BOUND invariant on every cycle
      // Every third cycle the connection comes back; every ninth, one replayed op hits a conflict.
      if (cycle % 3 === 2) {
        let first = true;
        const result = await q.replay(async () => {
          if (cycle % 9 === 8 && first) { first = false; expectedConflicts += 1; return { ok: false, reason: "version_conflict" }; }
          return { ok: true };
        });
        expect(result.stoppedByNetwork).toBe(false);
        expect(q.size()).toBe(0); // full drain
        expect(q.snapshot().dropped).toBe(0); // dropped tally resets with a full drain
      }
      // The persisted payload must remain valid JSON in the current schema at ALL times.
      const raw = storage.data.get(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { v: number; entries: unknown[] };
        expect(parsed.v).toBe(OFFLINE_QUEUE_STORAGE_VERSION);
        expect(parsed.entries.length).toBeLessThanOrEqual(OFFLINE_QUEUE_MAX);
      }
    }
    expect(q.snapshot().conflicts).toBe(expectedConflicts); // conflicts accumulate until acknowledged
    expect(q.isReplaying()).toBe(false); // no latched replay flag after sustained use
  });
});

describe("isNetworkError — transport failures vs server answers", () => {
  it("classifies fetch/socket transport failures as network errors", () => {
    for (const err of [
      new TypeError("Failed to fetch"),
      new TypeError("NetworkError when attempting to fetch resource."),
      new TypeError("Load failed"), // Safari
      new Error("fetch failed"),
      new Error("WebSocket closed with code 1006"),
      new Error("Connection lost while action was in flight"),
      new Error("connect ECONNREFUSED 127.0.0.1:3210"),
      new Error("socket hang up"),
      Object.assign(new Error("boom"), { name: "NetworkError" }),
      "net::ERR_INTERNET_DISCONNECTED",
    ]) {
      expect(isNetworkError(err), String(err)).toBe(true);
    }
  });

  it("NEVER classifies server answers or app errors as network errors (they must not be queued)", () => {
    for (const err of [
      new Error("version_conflict"),
      new Error("locked_by_agent"),
      new Error("not_a_member"),
      new Error("Uncaught ConvexError: cell is locked by Room NodeAgent"),
      new Error("permission_denied"),
      new Error("element_schema_rejected"),
      null,
      undefined,
      42,
    ]) {
      expect(isNetworkError(err), String(err)).toBe(false);
    }
  });
});
