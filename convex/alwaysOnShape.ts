/**
 * Always-On Rooms — pure bound/shape/decision helpers (no convex imports).
 *
 * Everything a mutation or query decides that does NOT need the database is
 * factored here so tests can hammer it directly: bounds + eviction (BOUND),
 * public shapes with a PII guard (no email/token/hash may ever leave a public
 * query), subscription caps, outbox enqueue planning, the scan diff, and the
 * deterministic credit estimate. convex/alwaysOn.ts is a thin I/O shell over
 * this module + alwaysOnCore.
 */

import { buildIdempotencyKey } from "./alwaysOnCore";

// ─── Bounds (every collection read/write has a MAX) ────────────────────────

export const MAX_TRACKED_PAPERS = 500;
export const MAX_RUNLOG_ENTRIES = 60;
export const LANDING_CARDS_TAKE = 24;
export const BUNDLE_RUNS_TAKE = 10;
export const MAX_SUBSCRIPTIONS_PER_ROOM = 5000;
export const MAX_PENDING_PER_EMAIL = 3;
/** Per-room subscribe rate window — mirrors MAX_JOINS_PER_MINUTE in rooms.ts. */
export const MAX_SUBSCRIBES_PER_ROOM_PER_MINUTE = 10;
export const MAX_SOURCES_PER_ROOM = 8;
export const MAX_ROOMS_PER_SCAN = 24;
export const MONTH_RUNS_SAMPLE = 400;
export const FETCH_TIMEOUT_MS = 15_000;
export const MAX_FETCH_BYTES = 1_000_000;

// ─── Row shapes shared with the schema ─────────────────────────────────────

export type PaperStatus = "new" | "updated" | "tracked";

export type PaperRecord = {
  title: string;
  discipline: string;
  topic: string;
  difficulty: string;
  status: PaperStatus;
  firstSeen: string;
  evidenceRef: string;
  href?: string;
};

export type RunlogEntry = {
  at: string;
  event: string;
  meta: string;
  status: "changed" | "ok" | "skipped" | "failed";
  cost: string;
};

// ─── Email + subscription decisions ────────────────────────────────────────

export function isValidEmail(email: string): boolean {
  if (typeof email !== "string") return false;
  const e = email.trim();
  if (e.length < 6 || e.length > 320) return false;
  return /^[^\s@]{1,64}@[^\s@.]{1,63}(\.[^\s@.]{1,63})+$/.test(e);
}

export function normalizeEmail(email: string): string {
  return String(email ?? "").trim().toLowerCase();
}

export type SubscriptionDecision =
  | { ok: true; noop: false; email: string }
  | { ok: true; noop: true }
  | { ok: false; reason: string };

/**
 * Pure decision for subscribeToRoom. HONEST_STATUS: every rejection has a
 * machine-readable reason; nothing throws generic.
 *
 * ANTI-ENUMERATION: already-subscribed and pending-capped addresses resolve to
 * { ok:true, noop:true } — the mutation inserts nothing and answers exactly
 * like a fresh success, so this decision can never be used as an oracle for
 * whether a specific email is subscribed. Honest { ok:false, reason } is
 * reserved for conditions that leak nothing about a specific email: bad input,
 * missing/paused room, the room-wide cap, and the per-room rate limit.
 * The rate limit is checked BEFORE the noop cases so responses stay uniform
 * under load and probing bursts cannot mint confirmation emails.
 *
 * `subscriptionCount` is the count of NON-unsubscribed rows only — unsubscribed
 * rows never consume the room cap (the caller filters before passing it in).
 */
export function evaluateSubscriptionRequest(input: {
  email: string;
  cadence: string;
  roomStatus: string | undefined;
  subscriptionCount: number;
  pendingForEmail: number;
  activeForEmail: number;
  recentWindowCount: number;
}): SubscriptionDecision {
  if (input.roomStatus === undefined) return { ok: false, reason: "room_not_found" };
  if (input.roomStatus !== "active") return { ok: false, reason: "room_not_active" };
  if (!isValidEmail(input.email)) return { ok: false, reason: "invalid_email" };
  if (input.cadence !== "daily" && input.cadence !== "weekly" && input.cadence !== "act_now") {
    return { ok: false, reason: "invalid_cadence" };
  }
  if (input.recentWindowCount >= MAX_SUBSCRIBES_PER_ROOM_PER_MINUTE) {
    return { ok: false, reason: "rate_limited" };
  }
  if (input.activeForEmail > 0) return { ok: true, noop: true };
  if (input.pendingForEmail >= MAX_PENDING_PER_EMAIL) return { ok: true, noop: true };
  if (input.subscriptionCount >= MAX_SUBSCRIPTIONS_PER_ROOM) {
    return { ok: false, reason: "room_subscription_limit" };
  }
  return { ok: true, noop: false, email: normalizeEmail(input.email) };
}

// ─── Public shapes + PII guard ─────────────────────────────────────────────

/** Keys that must NEVER appear in anything a PUBLIC query returns. */
export const FORBIDDEN_PUBLIC_KEY_PATTERN = /email|token|secret|subscriber|contenthash/i;

/**
 * Deep-walk a public payload and return the path of every forbidden key.
 * Public queries call this as a fail-closed guard (throw rather than leak);
 * tests use it to prove card/bundle shapes are PII-free.
 */
export function findForbiddenPublicKeys(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) hits.push(...findForbiddenPublicKeys(value[i], `${path}[${i}]`));
    return hits;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = `${path}.${key}`;
      if (FORBIDDEN_PUBLIC_KEY_PATTERN.test(key)) hits.push(childPath);
      hits.push(...findForbiddenPublicKeys(child, childPath));
    }
  }
  return hits;
}

type PublicRoomFields = {
  slug: string;
  title: string;
  description: string;
  status: "active" | "paused";
  mode: "monitor" | "digest";
  timezone: string;
  scanCadence: "daily" | "weekly";
  monthlyCreditCap: number;
  perRunCreditCap: number;
  lastRunAt?: number;
  lastRunStatus?: "ok" | "failed" | "capped" | "skipped";
  lastMetric?: string;
  createdAt: number;
  updatedAt: number;
};

export type PublicRoomCard = {
  slug: string;
  title: string;
  description: string;
  lastRunAt: number | null;
  lastRunStatus: string | null;
  lastMetric: string | null;
  papersCount: number;
};

/** Card fields ONLY — explicit picks, nothing spread from the doc. */
export function toPublicRoomCard(room: PublicRoomFields, papersCount: number): PublicRoomCard {
  return {
    slug: room.slug,
    title: room.title,
    description: room.description,
    lastRunAt: room.lastRunAt ?? null,
    lastRunStatus: room.lastRunStatus ?? null,
    lastMetric: room.lastMetric ?? null,
    papersCount,
  };
}

type StateFields = {
  papers: PaperRecord[];
  briefMarkdown: string;
  briefMeta: { title: string; dateLine: string; runNumber: number };
  runlog: RunlogEntry[];
  updatedAt: number;
};

type RunFields = {
  status: "running" | "completed" | "failed" | "capped" | "skipped";
  startedAt: number;
  completedAt?: number;
  sourcesChecked: number;
  changedSources: number;
  itemsCreated: number;
  itemsUpdated: number;
  creditsUsed: number;
  error?: string;
};

type SourceFields = {
  url: string;
  label?: string;
  status: "active" | "paused" | "failed";
  lastCheckedAt?: number;
};

export type PublicRoomBundle = {
  room: {
    slug: string;
    title: string;
    description: string;
    status: string;
    mode: string;
    timezone: string;
    scanCadence: string;
    monthlyCreditCap: number;
    perRunCreditCap: number;
    lastRunAt: number | null;
    lastRunStatus: string | null;
    lastMetric: string | null;
    createdAt: number;
    updatedAt: number;
  };
  state: {
    papers: PaperRecord[];
    briefMarkdown: string;
    briefMeta: { title: string; dateLine: string; runNumber: number };
    runlog: RunlogEntry[];
    updatedAt: number;
  } | null;
  runs: Array<{
    status: string;
    startedAt: number;
    completedAt: number | null;
    sourcesChecked: number;
    changedSources: number;
    itemsCreated: number;
    itemsUpdated: number;
    creditsUsed: number;
    error: string | null;
  }>;
  sources: Array<{ url: string; label: string | null; status: string; lastCheckedAt: number | null }>;
};

/**
 * The public room page payload: room meta + state + last runs + source lines.
 * NO subscriber data, NO token hashes, NO source lastContentHash — the proof
 * footer only needs status/counts/creditsUsed/timestamps. All arrays bounded.
 */
export function toPublicRoomBundle(
  room: PublicRoomFields,
  state: StateFields | null,
  runs: RunFields[],
  sources: SourceFields[],
): PublicRoomBundle {
  return {
    room: {
      slug: room.slug,
      title: room.title,
      description: room.description,
      status: room.status,
      mode: room.mode,
      timezone: room.timezone,
      scanCadence: room.scanCadence,
      monthlyCreditCap: room.monthlyCreditCap,
      perRunCreditCap: room.perRunCreditCap,
      lastRunAt: room.lastRunAt ?? null,
      lastRunStatus: room.lastRunStatus ?? null,
      lastMetric: room.lastMetric ?? null,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    },
    state: state
      ? {
          papers: state.papers.slice(0, MAX_TRACKED_PAPERS).map((p) => {
            const paper: PaperRecord = {
              title: p.title,
              discipline: p.discipline,
              topic: p.topic,
              difficulty: p.difficulty,
              status: p.status,
              firstSeen: p.firstSeen,
              evidenceRef: p.evidenceRef,
            };
            if (p.href !== undefined) paper.href = p.href;
            return paper;
          }),
          briefMarkdown: state.briefMarkdown,
          briefMeta: {
            title: state.briefMeta.title,
            dateLine: state.briefMeta.dateLine,
            runNumber: state.briefMeta.runNumber,
          },
          runlog: state.runlog.slice(0, MAX_RUNLOG_ENTRIES).map((r) => ({
            at: r.at,
            event: r.event,
            meta: r.meta,
            status: r.status,
            cost: r.cost,
          })),
          updatedAt: state.updatedAt,
        }
      : null,
    runs: runs.slice(0, BUNDLE_RUNS_TAKE).map((r) => ({
      status: r.status,
      startedAt: r.startedAt,
      completedAt: r.completedAt ?? null,
      sourcesChecked: r.sourcesChecked,
      changedSources: r.changedSources,
      itemsCreated: r.itemsCreated,
      itemsUpdated: r.itemsUpdated,
      creditsUsed: r.creditsUsed,
      error: r.error ?? null,
    })),
    sources: sources.slice(0, MAX_SOURCES_PER_ROOM).map((s) => ({
      url: s.url,
      label: s.label ?? null,
      status: s.status,
      lastCheckedAt: s.lastCheckedAt ?? null,
    })),
  };
}

// ─── Scan diff (deterministic, bounded) ────────────────────────────────────

export type ExtractedItem = { title: string; href: string; discipline?: string; topic?: string };

/**
 * Merge freshly extracted items into the tracked paper list.
 * Match primarily by href, then by title. New extractions become status
 * "new"; a matched paper whose title changed becomes "updated"; papers that
 * carried "new"/"updated" from a PREVIOUS scan demote to "tracked".
 * Papers no longer on the page are KEPT as "tracked" (source pages paginate).
 * Output bounded to MAX_TRACKED_PAPERS, new items first.
 */
export function applyScanDiff(
  existing: PaperRecord[],
  extracted: ExtractedItem[],
  firstSeenLabel: string,
): { papers: PaperRecord[]; newCount: number; updatedCount: number } {
  const bounded = existing.slice(0, MAX_TRACKED_PAPERS);
  const byHref = new Map<string, PaperRecord>();
  const byTitle = new Map<string, PaperRecord>();
  for (const p of bounded) {
    if (p.href !== undefined && !byHref.has(p.href)) byHref.set(p.href, p);
    if (!byTitle.has(p.title)) byTitle.set(p.title, p);
  }
  const replacements = new Map<PaperRecord, PaperRecord>();
  const fresh: PaperRecord[] = [];
  const seenKeys = new Set<string>();
  let newCount = 0;
  let updatedCount = 0;
  for (const item of extracted.slice(0, MAX_TRACKED_PAPERS)) {
    const key = `${item.href} ${item.title}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const prior = byHref.get(item.href) ?? byTitle.get(item.title);
    if (!prior) {
      newCount += 1;
      const paper: PaperRecord = {
        title: item.title,
        discipline: item.discipline ?? "Unclassified",
        topic: item.topic ?? "general",
        difficulty: "unrated",
        status: "new",
        firstSeen: firstSeenLabel,
        evidenceRef: `expositio.org · ${item.href}`.slice(0, 200),
        href: item.href,
      };
      fresh.push(paper);
      continue;
    }
    if (replacements.has(prior)) continue; // two extracted rows matched the same paper — first wins
    if (prior.title !== item.title || prior.href !== item.href) {
      updatedCount += 1;
      replacements.set(prior, { ...prior, title: item.title, href: item.href, status: "updated" });
    } else {
      replacements.set(prior, { ...prior, status: "tracked" });
    }
  }
  const rest = bounded.map((p) => replacements.get(p) ?? { ...p, status: "tracked" as const });
  return { papers: [...fresh, ...rest].slice(0, MAX_TRACKED_PAPERS), newCount, updatedCount };
}

/** Newest-first runlog with eviction — BOUND to MAX_RUNLOG_ENTRIES. */
export function boundRunlog(existing: RunlogEntry[], newestFirstAppend: RunlogEntry[]): RunlogEntry[] {
  return [...newestFirstAppend, ...existing].slice(0, MAX_RUNLOG_ENTRIES);
}

// ─── Deterministic scheduling + credits ────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Due check with cron-drift tolerance: daily fires after ~0.8d, weekly after ~6.5d. */
export function isRoomDue(lastRunAt: number | undefined, scanCadence: string, now: number): boolean {
  if (lastRunAt === undefined) return true;
  const interval = scanCadence === "weekly" ? 6.5 * DAY_MS : 0.8 * DAY_MS;
  return now - lastRunAt >= interval;
}

/** UTC month start — the monthly credit-cap window boundary. */
export function monthStartMs(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

/** Deterministic small credit estimate for a scan — NO model calls in v1. */
export function estimateScanCredits(input: { changedSources: number; itemsExtracted: number }): number {
  if (input.changedSources <= 0) return 0;
  const fetchCost = 0.2 * input.changedSources;
  const extractCost = 0.1 * Math.ceil(Math.max(0, input.itemsExtracted) / 25);
  const briefCost = 0.1;
  return Math.round((fetchCost + extractCost + briefCost) * 10) / 10;
}

/** "2026-07-04" (UTC) — used for firstSeen labels and briefKeys. */
export function utcDateKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** "09:00:04" (UTC) — runlog timestamps. */
export function utcClock(now: number): string {
  return new Date(now).toISOString().slice(11, 19);
}

export function lastMetricFor(papersCount: number, newToday: number): string {
  return `${papersCount} papers tracked · ${newToday} new today`;
}

/** Run-row status → room lastRunStatus (completed reads as "ok" on cards). */
export function runStatusToRoomStatus(
  runStatus: "completed" | "failed" | "capped" | "skipped",
): "ok" | "failed" | "capped" | "skipped" {
  return runStatus === "completed" ? "ok" : runStatus;
}

// ─── Outbox planning + one-retry policy ────────────────────────────────────

export type OutboxPlanRow = {
  subscriptionId: string;
  idempotencyKey: string;
  state: "pending_draft" | "skipped";
  error?: string;
};

/**
 * Plan digest outbox rows for one (room, briefKey). In-batch and
 * existing-key dedupe by idempotencyKey; non-active subscribers get an
 * honest "skipped" row with the reason in error (never silently dropped).
 */
export function planOutboxEnqueue(input: {
  roomSlug: string;
  briefKey: string;
  subscribers: Array<{ id: string; status: string; cadence: string }>;
  existingKeys: ReadonlySet<string>;
}): OutboxPlanRow[] {
  const rows: OutboxPlanRow[] = [];
  const planned = new Set<string>();
  for (const sub of input.subscribers.slice(0, MAX_SUBSCRIPTIONS_PER_ROOM)) {
    const idempotencyKey = buildIdempotencyKey({
      roomSlug: input.roomSlug,
      briefKey: input.briefKey,
      subscriptionId: sub.id,
      cadence: sub.cadence,
    });
    if (planned.has(idempotencyKey) || input.existingKeys.has(idempotencyKey)) continue;
    planned.add(idempotencyKey);
    if (sub.status === "active") {
      rows.push({ subscriptionId: sub.id, idempotencyKey, state: "pending_draft" });
    } else {
      rows.push({
        subscriptionId: sub.id,
        idempotencyKey,
        state: "skipped",
        error: "subscriber_not_active",
      });
    }
  }
  return rows;
}

export const RETRY_MARKER = "[retried] ";

/**
 * One-retry bound for failed→pending_draft: the first retry stamps
 * RETRY_MARKER into error; a second attempt is rejected honestly.
 */
export function retryDecision(
  currentError: string | undefined,
): { allowed: true; nextError: string } | { allowed: false; reason: string } {
  if ((currentError ?? "").startsWith(RETRY_MARKER)) {
    return { allowed: false, reason: "retry_exhausted" };
  }
  return { allowed: true, nextError: `${RETRY_MARKER}${currentError ?? ""}`.trim() };
}

// ─── Retention (pure prunability predicate for convex/retention.ts) ────────

/** Days each append-only always-on row class is kept before the retention cron may prune it. */
export const ALWAYS_ON_RETENTION_DAYS = {
  runs: 30,
  outboxTerminal: 30,
  subscriptionPending: 7,
  subscriptionUnsubscribed: 30,
} as const;

/**
 * Outbox states with no live forward edge worth keeping past retention:
 * sent/skipped are strictly terminal in alwaysOnCore.canTransition; failed has
 * a single retry edge (failed→pending_draft) that no lane exercises after 30
 * days, so an aged failed row is dead weight, not a pending retry.
 */
export const OUTBOX_TERMINAL_STATES: ReadonlySet<string> = new Set(["sent", "skipped", "failed"]);

export type PrunableAlwaysOnRow =
  | { table: "publicRoomRuns"; creationTime: number }
  | { table: "publicRoomOutbox"; creationTime: number; state: string }
  | { table: "publicRoomSubscriptions"; creationTime: number; status: string };

/**
 * Fail-closed prunability decision for pruneAlwaysOnRows: runs age out at 30d;
 * outbox rows only in TERMINAL states at 30d; subscriptions prune "pending"
 * (never confirmed) at 7d and "unsubscribed" at 30d — "active" rows are
 * product data and are NEVER pruned regardless of age.
 */
export function selectPrunableAlwaysOnRow(row: PrunableAlwaysOnRow, now: number): boolean {
  const age = now - row.creationTime;
  switch (row.table) {
    case "publicRoomRuns":
      return age > ALWAYS_ON_RETENTION_DAYS.runs * DAY_MS;
    case "publicRoomOutbox":
      return OUTBOX_TERMINAL_STATES.has(row.state) && age > ALWAYS_ON_RETENTION_DAYS.outboxTerminal * DAY_MS;
    case "publicRoomSubscriptions":
      if (row.status === "pending") return age > ALWAYS_ON_RETENTION_DAYS.subscriptionPending * DAY_MS;
      if (row.status === "unsubscribed") return age > ALWAYS_ON_RETENTION_DAYS.subscriptionUnsubscribed * DAY_MS;
      return false; // active — never pruned
  }
}
