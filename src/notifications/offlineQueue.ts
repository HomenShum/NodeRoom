/**
 * offlineQueue — pure offline edit-hold for live-mode CAS edits.
 *
 * Design contract (Latency: "offline edits held, visible, never lost"):
 * when a live-mode edit fails on a TRANSPORT error (fetch/WebSocket down),
 * the op is held here — in memory AND in localStorage — and replayed on
 * reconnect through the SAME applyEdit path, so a replayed op that lost its
 * compare-and-swap race surfaces as an honest conflict, never a clobber.
 *
 * Server ANSWERS (version conflict, locked, permission denied) are NOT
 * network errors: they arrive as `{ ok:false, reason }` results and must
 * never be queued — retrying a server "no" is dishonest.
 *
 * Bounds (agentic-reliability BOUND rule): the queue holds at most
 * OFFLINE_QUEUE_MAX ops; beyond that the OLDEST op is dropped and the drop
 * is counted so the UI can show it — data loss is visible, never silent.
 *
 * Pure module: no React, no Convex, no globals. Storage is injected
 * (StorageLike) so tests can run it against fake/corrupt/quota-throwing
 * stores.
 */

import type { ChangeOp } from "../engine/types";

export const OFFLINE_QUEUE_MAX = 50;
export const OFFLINE_QUEUE_STORAGE_VERSION = 1;

export type QueuedEdit = { roomId: string; op: ChangeOp; queuedAt: number };

export type OfflineQueueSnapshot = {
  /** Ops currently held for replay. */
  held: number;
  /** Oldest ops dropped because the queue hit its bound — visible loss, reset on a full drain. */
  dropped: number;
  /** Replayed ops the server answered with a non-ok (conflict/locked/…) — cleared via resetConflicts(). */
  conflicts: number;
  /** A replay pass is currently running. */
  replaying: boolean;
};

export type ReplayFeedback = { ok: boolean; reason?: string };
export type ReplayResult = {
  applied: number;
  conflicts: Array<{ entry: QueuedEdit; reason: string }>;
  /** True when a transport error stopped the pass — the failing op stays at the head for the next pass. */
  stoppedByNetwork: boolean;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * TRANSPORT failure classifier. Matches fetch/WebSocket/socket-level failures
 * ("Failed to fetch", "NetworkError…", "Connection lost…", ECONNREFUSED, …).
 * Deliberately does NOT match server answers ("version_conflict", "locked",
 * "not_a_member") — those are decisions, not outages.
 */
const NETWORK_ERROR_PATTERN =
  /failed to fetch|networkerror|network error|network request failed|fetch failed|load failed|connection lost|connection closed|connection refused|disconnected|websocket|socket hang ?up|econnrefused|econnreset|etimedout|enotfound|eai_again|err_internet_disconnected|transport/i;

export function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  const name = typeof err === "object" ? String((err as { name?: unknown }).name ?? "") : "";
  if (name === "NetworkError") return true;
  const message =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "string"
        ? err
        : String((err as { message?: unknown })?.message ?? "");
  return NETWORK_ERROR_PATTERN.test(message);
}

type PersistedShape = { v: number; dropped: number; entries: QueuedEdit[] };

function isValidEntry(entry: unknown): entry is QueuedEdit {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Partial<QueuedEdit>;
  if (typeof e.roomId !== "string" || typeof e.queuedAt !== "number") return false;
  const op = e.op as Partial<ChangeOp> | undefined;
  return (
    !!op &&
    typeof op === "object" &&
    typeof op.opId === "string" &&
    typeof op.artifactId === "string" &&
    typeof op.elementId === "string" &&
    typeof op.kind === "string" &&
    typeof op.baseVersion === "number"
  );
}

export class OfflineEditQueue {
  private entries: QueuedEdit[] = [];
  private droppedCount = 0;
  private conflictCount = 0;
  private replaying = false;
  private readonly max: number;
  private readonly storageKey: string;
  private readonly storage: StorageLike | null;

  constructor(opts: { storageKey: string; storage?: StorageLike | null; max?: number }) {
    this.storageKey = opts.storageKey;
    this.storage = opts.storage ?? null;
    this.max = Math.max(1, opts.max ?? OFFLINE_QUEUE_MAX);
    this.hydrate();
  }

  /** Rebuild from storage. Corrupt/foreign payloads recover to an empty queue (and reset the key)
   *  instead of throwing — a poisoned localStorage must never take the room shell down. */
  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as PersistedShape;
      if (!parsed || typeof parsed !== "object" || parsed.v !== OFFLINE_QUEUE_STORAGE_VERSION || !Array.isArray(parsed.entries)) {
        throw new Error("offline_queue_storage_corrupt");
      }
      const valid = parsed.entries.filter(isValidEntry);
      this.entries = valid.slice(-this.max);
      const persistedDropped = typeof parsed.dropped === "number" && Number.isFinite(parsed.dropped) && parsed.dropped >= 0 ? Math.floor(parsed.dropped) : 0;
      // Invalid rows and over-bound rows count as dropped — hydration never hides loss.
      this.droppedCount = persistedDropped + (parsed.entries.length - valid.length) + Math.max(0, valid.length - this.entries.length);
    } catch {
      this.entries = [];
      this.droppedCount = 0;
      try {
        this.storage.removeItem(this.storageKey);
      } catch {
        /* storage unavailable — in-memory state is the source of truth */
      }
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      const payload: PersistedShape = { v: OFFLINE_QUEUE_STORAGE_VERSION, dropped: this.droppedCount, entries: this.entries };
      this.storage.setItem(this.storageKey, JSON.stringify(payload));
    } catch {
      /* quota exceeded / storage unavailable — the in-memory queue still holds the ops */
    }
  }

  size(): number {
    return this.entries.length;
  }

  list(): readonly QueuedEdit[] {
    return this.entries;
  }

  isReplaying(): boolean {
    return this.replaying;
  }

  snapshot(): OfflineQueueSnapshot {
    return { held: this.entries.length, dropped: this.droppedCount, conflicts: this.conflictCount, replaying: this.replaying };
  }

  /** Hold an op. When the bound is hit the OLDEST op is dropped and counted (visible loss). */
  enqueue(roomId: string, op: ChangeOp, queuedAt = Date.now()): { dropped: QueuedEdit | null } {
    this.entries.push({ roomId, op, queuedAt });
    let dropped: QueuedEdit | null = null;
    if (this.entries.length > this.max) {
      dropped = this.entries.shift() ?? null;
      if (dropped) this.droppedCount += 1;
    }
    this.persist();
    return { dropped };
  }

  /** Clear the replay-conflict tally once the UI has surfaced it. */
  resetConflicts(): void {
    this.conflictCount = 0;
  }

  clear(): void {
    this.entries = [];
    this.droppedCount = 0;
    this.conflictCount = 0;
    if (this.storage) {
      try {
        this.storage.removeItem(this.storageKey);
      } catch {
        /* storage unavailable */
      }
    }
  }

  /**
   * Replay held ops FIFO through `apply` (the caller passes the SAME applyEdit
   * path a hand edit uses, so CAS conflicts surface honestly).
   *
   * - `{ ok:true }`   → op applied, dequeued.
   * - `{ ok:false }`  → server answered (conflict/locked/…): dequeued and counted
   *                     as a conflict; replay CONTINUES — one lost race must not
   *                     block the rest of the queue.
   * - throws network  → still offline: the op stays at the HEAD and the pass stops
   *                     (stoppedByNetwork) so the next reconnect resumes in order.
   * - throws other    → treated like a server answer (dequeued + counted) so one
   *                     poison op can never wedge the queue forever.
   *
   * Re-entrant calls are a no-op while a pass is running.
   */
  async replay(apply: (entry: QueuedEdit) => Promise<ReplayFeedback>): Promise<ReplayResult> {
    if (this.replaying) return { applied: 0, conflicts: [], stoppedByNetwork: false };
    this.replaying = true;
    const conflicts: Array<{ entry: QueuedEdit; reason: string }> = [];
    let applied = 0;
    let stoppedByNetwork = false;
    try {
      while (this.entries.length > 0) {
        const entry = this.entries[0];
        let feedback: ReplayFeedback;
        try {
          feedback = await apply(entry);
        } catch (err) {
          if (isNetworkError(err)) {
            stoppedByNetwork = true;
            break;
          }
          feedback = { ok: false, reason: err instanceof Error ? err.message : "replay_failed" };
        }
        this.entries.shift();
        if (feedback.ok) {
          applied += 1;
        } else {
          conflicts.push({ entry, reason: feedback.reason ?? "conflict" });
          this.conflictCount += 1;
        }
        this.persist();
      }
      // Full drain: the drop tally was visible for the whole held period; reset with the queue
      // so a stale "N dropped" doesn't outlive the state it described.
      if (this.entries.length === 0) this.droppedCount = 0;
    } finally {
      this.replaying = false;
      this.persist();
    }
    return { applied, conflicts, stoppedByNetwork };
  }
}
