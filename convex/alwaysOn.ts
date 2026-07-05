/**
 * Always-On Rooms — Convex backend (public read-only rooms + double-opt-in
 * digests + deterministic scheduled scan).
 *
 * Boundary discipline (matches notebookAgent.ts / watches.ts):
 *   - public queries: card/bundle shapes ONLY, guarded fail-closed by
 *     findForbiddenPublicKeys — no subscriber emails, no token hashes, no
 *     source lastContentHash ever leave this module via a public function.
 *   - public mutations: honest { ok:false, reason } failures, bounded reads.
 *   - the scan is an internal ACTION (network) that persists exclusively via
 *     internal mutations; v1 makes ZERO model calls.
 *
 * Reliability checklist: BOUND (every read behind .take with a shape-module
 * MAX; papers/runlog sliced on write), HONEST_STATUS (capped/failed/skipped
 * run rows; no fake success), TIMEOUT (AbortController, 15s), SSRF
 * (validateSourceUrl against the hardcoded allowlist BEFORE any fetch,
 * redirects refused), BOUND_READ (1MB reader-loop cap), ERROR_BOUNDARY
 * (per-room + per-source try/catch → failed run rows), DETERMINISTIC
 * (contentHash + idempotency keys from alwaysOnCore).
 *
 * NOTE on function references: this module is not in convex/_generated yet
 * (codegen deploys to prod — forbidden from this branch), so self-references
 * use makeFunctionReference exactly like convex/agent.ts / crons.ts do.
 */
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib";
import {
  ALLOWED_SOURCE_HOSTS,
  PAPER_EXTRACTOR_CACHE_VERSION,
  canTransition,
  contentHash,
  extractPapersFromHtml,
  isGenericPaperActionTitle,
  isPaperDetailHref,
  renderDailyBriefMarkdown,
  validateSourceUrl,
} from "./alwaysOnCore";
import {
  BUNDLE_RUNS_TAKE,
  FETCH_TIMEOUT_MS,
  LANDING_CARDS_TAKE,
  MAX_FETCH_BYTES,
  MAX_PENDING_PER_EMAIL,
  MAX_ROOMS_PER_SCAN,
  MAX_RUNLOG_ENTRIES,
  MAX_SOURCES_PER_ROOM,
  MAX_SUBSCRIBES_PER_ROOM_PER_MINUTE,
  MAX_SUBSCRIPTIONS_PER_ROOM,
  MAX_TRACKED_PAPERS,
  MONTH_RUNS_SAMPLE,
  applyScanDiff,
  boundRunlog,
  estimateScanCredits,
  evaluateSubscriptionRequest,
  findForbiddenPublicKeys,
  isRoomDue,
  lastMetricFor,
  monthStartMs,
  normalizeEmail,
  planOutboxEnqueue,
  retryDecision,
  runStatusToRoomStatus,
  toPublicRoomBundle,
  toPublicRoomCard,
  utcClock,
  utcDateKey,
  type PaperRecord,
  type RunlogEntry,
} from "./alwaysOnShape";
import { AO_CARDS, AO_PAPERS, AO_ROOM_META, AO_RUNLOG } from "../src/alwayson/demoData";

// ─── Validators shared inside this module ──────────────────────────────────

const paperV = v.object({
  title: v.string(),
  discipline: v.string(),
  topic: v.string(),
  difficulty: v.string(),
  status: v.union(v.literal("new"), v.literal("updated"), v.literal("tracked")),
  firstSeen: v.string(),
  evidenceRef: v.string(),
  href: v.optional(v.string()),
});

const runlogEntryV = v.object({
  at: v.string(),
  event: v.string(),
  meta: v.string(),
  status: v.union(v.literal("changed"), v.literal("ok"), v.literal("skipped"), v.literal("failed")),
  cost: v.string(),
});

const briefMetaV = v.object({ title: v.string(), dateLine: v.string(), runNumber: v.number() });

const runStatusV = v.union(
  v.literal("completed"),
  v.literal("failed"),
  v.literal("capped"),
  v.literal("skipped"),
);

const outboxStateV = v.union(
  v.literal("pending_draft"),
  v.literal("draft_created"),
  v.literal("approved"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("skipped"),
);

// Self-references (this module is not in _generated yet — see module note).
const listRoomsForScanRef = makeFunctionReference<"query">("alwaysOn:listRoomsForScan") as any;
const getScanContextRef = makeFunctionReference<"query">("alwaysOn:getScanContext") as any;
const commitScanRunRef = makeFunctionReference<"mutation">("alwaysOn:commitScanRun") as any;

// ─── Public queries ────────────────────────────────────────────────────────

/** Landing gallery: ACTIVE rooms as card fields ONLY. Bounded take(24). NO PII. */
export const listPublicRooms = query({
  args: {},
  handler: async (ctx) => {
    const rooms = await ctx.db.query("publicRooms").take(LANDING_CARDS_TAKE * 2);
    const active = rooms.filter((r) => r.status === "active").slice(0, LANDING_CARDS_TAKE);
    const cards = [];
    for (const room of active) {
      const state = await ctx.db
        .query("publicRoomStates")
        .withIndex("by_room", (q) => q.eq("publicRoomId", room._id))
        .first();
      cards.push(toPublicRoomCard(room, state?.papers.length ?? 0));
    }
    // Fail closed: leaking nothing beats leaking PII (should be unreachable).
    if (findForbiddenPublicKeys(cards).length > 0) throw new Error("public_shape_violation");
    return cards;
  },
});

/** Public room page payload: room meta + state + last 10 runs + source lines. NO subscriber data, NO hashes. */
export const getPublicRoomBundle = query({
  args: { slug: v.string() },
  handler: async (ctx, a) => {
    const room = await ctx.db
      .query("publicRooms")
      .withIndex("by_slug", (q) => q.eq("slug", a.slug))
      .first();
    if (!room) return null;
    const state = await ctx.db
      .query("publicRoomStates")
      .withIndex("by_room", (q) => q.eq("publicRoomId", room._id))
      .first();
    const runs = await ctx.db
      .query("publicRoomRuns")
      .withIndex("by_room_started", (q) => q.eq("publicRoomId", room._id))
      .order("desc")
      .take(BUNDLE_RUNS_TAKE);
    const sources = await ctx.db
      .query("publicRoomSources")
      .withIndex("by_room", (q) => q.eq("publicRoomId", room._id))
      .take(MAX_SOURCES_PER_ROOM);
    const bundle = toPublicRoomBundle(room, state ?? null, runs, sources);
    if (findForbiddenPublicKeys(bundle).length > 0) throw new Error("public_shape_violation");
    return bundle;
  },
});

// ─── Public mutations (subscription lifecycle) ─────────────────────────────

function randomTokenHex(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Create a PENDING subscription (double opt-in step 1). Stores ONLY sha256
 * hashes of the confirm/unsub tokens.
 *
 * CONFIRM TOKEN CHANNEL: the raw confirm token travels ONLY inside the
 * confirmation email minted by the outbox lane — it is NEVER part of this
 * return value. Returning it would hand the anonymous caller the ability to
 * subscribe a victim's email and confirm it themselves, forging double opt-in.
 *
 * PUBLIC CONTRACT (anti-enumeration): the success shape is uniform —
 * "if this address isn't already subscribed, a confirmation is on its way."
 * An already-subscribed or pending-capped address gets a byte-identical
 * { ok: true } with NO row inserted, so this mutation cannot be used as an
 * oracle for whether a specific email is subscribed. Honest { ok:false,
 * reason } failures are reserved for conditions that leak nothing about a
 * specific email (bad input, missing/paused room, room-wide cap, rate limit).
 *
 * UNSUB TOKEN DECISION (integration lane, v1): the raw unsubToken is hashed
 * here and deliberately NEVER returned — not to the browser, not in this
 * return value. v1 digests are human-reviewed Gmail drafts whose footer links
 * point at the public room page (see scripts/digest/enqueue-digest.mjs
 * buildLinks — a documented placeholder). When the automated production
 * sender ships, it must mint a fresh per-digest unsub token at draft time via
 * an internal mutation (store the hash on the outbox row, embed the raw token
 * only in that email's List-Unsubscribe link) rather than widening this
 * mutation's return surface. Do NOT add unsubToken to this return value.
 */
export const subscribeToRoom = mutation({
  args: {
    slug: v.string(),
    email: v.string(),
    cadence: v.union(v.literal("daily"), v.literal("weekly"), v.literal("act_now")),
  },
  handler: async (ctx, a) => {
    const now = Date.now();
    const room = await ctx.db
      .query("publicRooms")
      .withIndex("by_slug", (q) => q.eq("slug", a.slug))
      .first();
    const email = normalizeEmail(a.email);
    // BOUND: cap probes ride indexes; the 5000-room cap is one bounded take.
    const roomSubs = room
      ? await ctx.db
          .query("publicRoomSubscriptions")
          .withIndex("by_room", (q) => q.eq("publicRoomId", room._id))
          .take(MAX_SUBSCRIPTIONS_PER_ROOM)
      : [];
    const mine = room
      ? await ctx.db
          .query("publicRoomSubscriptions")
          .withIndex("by_room_email", (q) => q.eq("publicRoomId", room._id).eq("email", email))
          .take(MAX_PENDING_PER_EMAIL + 5)
      : [];
    // Abuse gate — join-rate precedent (rooms.ts MAX_JOINS_PER_MINUTE): the
    // newest rows ride the by_room index desc; a full window of <60s-old rows
    // means the room is being hammered. BOUND to the window size itself.
    const recentWindow = room
      ? await ctx.db
          .query("publicRoomSubscriptions")
          .withIndex("by_room", (q) => q.eq("publicRoomId", room._id))
          .order("desc")
          .take(MAX_SUBSCRIBES_PER_ROOM_PER_MINUTE)
      : [];
    const decision = evaluateSubscriptionRequest({
      email: a.email,
      cadence: a.cadence,
      roomStatus: room?.status,
      // Unsubscribed rows never consume the room cap — count live rows only.
      subscriptionCount: roomSubs.filter((s) => s.status !== "unsubscribed").length,
      pendingForEmail: mine.filter((s) => s.status === "pending").length,
      activeForEmail: mine.filter((s) => s.status === "active").length,
      recentWindowCount: recentWindow.filter((s) => s._creationTime > now - 60_000).length,
    });
    if (!decision.ok) return decision; // HONEST_STATUS: { ok:false, reason }
    // Anti-enumeration noop: byte-identical to the created path, nothing stored.
    if (decision.noop) return { ok: true as const };
    const confirmToken = randomTokenHex();
    const unsubToken = randomTokenHex();
    await ctx.db.insert("publicRoomSubscriptions", {
      publicRoomId: room!._id,
      email: decision.email,
      cadence: a.cadence,
      status: "pending",
      confirmTokenHash: await sha256Hex(confirmToken),
      unsubTokenHash: await sha256Hex(unsubToken),
      createdAt: now,
    });
    return { ok: true as const };
  },
});

/** Double opt-in step 2: raw token → hash lookup → activate. Idempotent on re-confirm. */
export const confirmSubscription = mutation({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    if (a.token.length < 16 || a.token.length > 128) return { ok: false as const, reason: "invalid_token" };
    const hash = await sha256Hex(a.token);
    const sub = await ctx.db
      .query("publicRoomSubscriptions")
      .withIndex("by_confirm_token_hash", (q) => q.eq("confirmTokenHash", hash))
      .first();
    if (!sub) return { ok: false as const, reason: "invalid_token" };
    if (sub.status === "active") return { ok: true as const, alreadyConfirmed: true };
    if (sub.status === "unsubscribed") return { ok: false as const, reason: "unsubscribed" };
    await ctx.db.patch(sub._id, { status: "active", confirmedAt: Date.now() });
    return { ok: true as const };
  },
});

/** One-click unsubscribe by raw token → hash lookup. Idempotent. */
export const unsubscribeFromRoom = mutation({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    if (a.token.length < 16 || a.token.length > 128) return { ok: false as const, reason: "invalid_token" };
    const hash = await sha256Hex(a.token);
    const sub = await ctx.db
      .query("publicRoomSubscriptions")
      .withIndex("by_unsub_token_hash", (q) => q.eq("unsubTokenHash", hash))
      .first();
    if (!sub) return { ok: false as const, reason: "invalid_token" };
    if (sub.status === "unsubscribed") return { ok: true as const, alreadyUnsubscribed: true };
    await ctx.db.patch(sub._id, { status: "unsubscribed" });
    return { ok: true as const };
  },
});

// ─── Internal read side for the scan action ────────────────────────────────

export const listRoomsForScan = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rooms = await ctx.db.query("publicRooms").take(MAX_ROOMS_PER_SCAN);
    const out = [];
    for (const room of rooms) {
      if (room.status !== "active") continue;
      const sources = await ctx.db
        .query("publicRoomSources")
        .withIndex("by_room", (q) => q.eq("publicRoomId", room._id))
        .take(MAX_SOURCES_PER_ROOM);
      out.push({ room, sources });
    }
    return out;
  },
});

export const getScanContext = internalQuery({
  args: { publicRoomId: v.id("publicRooms"), monthStart: v.number() },
  handler: async (ctx, a) => {
    const runs = await ctx.db
      .query("publicRoomRuns")
      .withIndex("by_room_started", (q) => q.eq("publicRoomId", a.publicRoomId).gte("startedAt", a.monthStart))
      .take(MONTH_RUNS_SAMPLE);
    const state = await ctx.db
      .query("publicRoomStates")
      .withIndex("by_room", (q) => q.eq("publicRoomId", a.publicRoomId))
      .first();
    return {
      monthCreditsUsed: runs.reduce((sum, r) => sum + (r.creditsUsed ?? 0), 0),
      papers: (state?.papers ?? []) as PaperRecord[],
      briefMeta: state?.briefMeta ?? null,
    };
  },
});

/**
 * Persist one scan outcome atomically: run receipt + room status + source
 * bookkeeping + (when changed) the new public state. BOUND on every write.
 */
export const commitScanRun = internalMutation({
  args: {
    publicRoomId: v.id("publicRooms"),
    status: runStatusV,
    startedAt: v.number(),
    completedAt: v.number(),
    sourcesChecked: v.number(),
    changedSources: v.number(),
    itemsCreated: v.number(),
    itemsUpdated: v.number(),
    creditsUsed: v.number(),
    error: v.optional(v.string()),
    lastMetric: v.optional(v.string()),
    runlogAppend: v.array(runlogEntryV),
    statePatch: v.optional(
      v.object({ papers: v.array(paperV), briefMarkdown: v.string(), briefMeta: briefMetaV }),
    ),
    sourceUpdates: v.array(
      v.object({
        sourceId: v.id("publicRoomSources"),
        lastContentHash: v.optional(v.string()),
        lastCheckedAt: v.optional(v.number()),
        status: v.optional(v.union(v.literal("active"), v.literal("paused"), v.literal("failed"))),
      }),
    ),
  },
  handler: async (ctx, a) => {
    const now = Date.now();
    await ctx.db.insert("publicRoomRuns", {
      publicRoomId: a.publicRoomId,
      status: a.status,
      startedAt: a.startedAt,
      completedAt: a.completedAt,
      sourcesChecked: a.sourcesChecked,
      changedSources: a.changedSources,
      itemsCreated: a.itemsCreated,
      itemsUpdated: a.itemsUpdated,
      creditsUsed: a.creditsUsed,
      ...(a.error !== undefined ? { error: a.error.slice(0, 500) } : {}),
    });
    const room = await ctx.db.get(a.publicRoomId);
    if (room) {
      await ctx.db.patch(a.publicRoomId, {
        lastRunAt: a.startedAt,
        lastRunStatus: runStatusToRoomStatus(a.status),
        ...(a.lastMetric !== undefined ? { lastMetric: a.lastMetric } : {}),
        updatedAt: now,
      });
    }
    for (const update of a.sourceUpdates) {
      const source = await ctx.db.get(update.sourceId);
      if (!source || String(source.publicRoomId) !== String(a.publicRoomId)) continue; // never cross rooms
      await ctx.db.patch(update.sourceId, {
        ...(update.lastContentHash !== undefined ? { lastContentHash: update.lastContentHash } : {}),
        ...(update.lastCheckedAt !== undefined ? { lastCheckedAt: update.lastCheckedAt } : {}),
        ...(update.status !== undefined ? { status: update.status } : {}),
      });
    }
    if (a.runlogAppend.length > 0 || a.statePatch) {
      const existing = await ctx.db
        .query("publicRoomStates")
        .withIndex("by_room", (q) => q.eq("publicRoomId", a.publicRoomId))
        .first();
      const runlog = boundRunlog(
        (existing?.runlog ?? []) as RunlogEntry[],
        a.runlogAppend as RunlogEntry[],
      );
      if (existing) {
        await ctx.db.patch(existing._id, {
          runlog,
          ...(a.statePatch
            ? {
                papers: a.statePatch.papers.slice(0, MAX_TRACKED_PAPERS),
                briefMarkdown: a.statePatch.briefMarkdown,
                briefMeta: a.statePatch.briefMeta,
              }
            : {}),
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("publicRoomStates", {
          publicRoomId: a.publicRoomId,
          papers: (a.statePatch?.papers ?? []).slice(0, MAX_TRACKED_PAPERS),
          briefMarkdown: a.statePatch?.briefMarkdown ?? "",
          briefMeta: a.statePatch?.briefMeta ?? { title: "Daily brief", dateLine: utcDateKey(now), runNumber: 0 },
          runlog: runlog.slice(0, MAX_RUNLOG_ENTRIES),
          updatedAt: now,
        });
      }
    }
    return { ok: true as const };
  },
});

// ─── The deterministic scheduled scan ──────────────────────────────────────

type FetchOutcome = { ok: true; text: string } | { ok: false; error: string };

/** TIMEOUT (15s AbortController) + BOUND_READ (1MB reader loop) + no redirects (SSRF). */
async function fetchSourceBounded(url: string): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "error", // an off-host redirect can never bypass the allowlist
      headers: { accept: "text/html,application/xhtml+xml" },
    });
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const reader = res.body?.getReader?.();
    if (!reader) {
      const text = await res.text();
      return text.length > MAX_FETCH_BYTES
        ? { ok: false, error: "response_too_large" }
        : { ok: true, text };
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        if (received > MAX_FETCH_BYTES) {
          await reader.cancel().catch(() => undefined);
          controller.abort();
          return { ok: false, error: "response_too_large" };
        }
        chunks.push(value);
      }
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, text: new TextDecoder("utf-8").decode(merged) };
  } catch (error) {
    if (controller.signal.aborted) return { ok: false, error: "fetch_timeout" };
    return { ok: false, error: `fetch_failed:${error instanceof Error ? error.message : String(error)}`.slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

type RoomForScan = {
  room: Doc<"publicRooms">;
  sources: Doc<"publicRoomSources">[];
};

function scrubSourceExtractedPapers(papers: PaperRecord[]): PaperRecord[] {
  return papers.filter((paper) => {
    // Seed/demo papers have no source href and are still valid room context.
    if (!paper.href) return true;
    return isPaperDetailHref(paper.href) && !isGenericPaperActionTitle(paper.title);
  });
}

/**
 * Cron entry point. For each ACTIVE room due per its cadence:
 * monthly-cap check FIRST (honest "capped" run when exhausted), then for each
 * active source: allowlist-validate → bounded fetch → contentHash; unchanged
 * → "skipped" run with zero credits and no fetch-derived writes; changed →
 * deterministic extract + diff + template brief. ZERO model calls.
 */
export const scanDuePublicRooms = internalAction({
  // force: operator affordance ("run one scan now" — e.g. after fixing a
  // source URL whose failed run consumed the day's slot). The cron always
  // passes {}; force never bypasses the credit caps, only the due window.
  // slug scopes operator re-scans so a one-room repair does not spend across
  // every active room once more flagship rooms exist.
  args: { force: v.optional(v.boolean()), slug: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const now = Date.now();
    const roomsWithSources = (await ctx.runQuery(listRoomsForScanRef, {})) as RoomForScan[];
    const summary = { scanned: 0, completed: 0, skipped: 0, capped: 0, failed: 0, notDue: 0 };
    for (const { room, sources } of roomsWithSources) {
      if (a.slug && room.slug !== a.slug) continue;
      if (!a.force && !isRoomDue(room.lastRunAt, room.scanCadence, now)) {
        summary.notDue += 1;
        continue;
      }
      summary.scanned += 1;
      const startedAt = Date.now();
      try {
        const scanCtx = (await ctx.runQuery(getScanContextRef, {
          publicRoomId: room._id,
          monthStart: monthStartMs(now),
        })) as {
          monthCreditsUsed: number;
          papers: PaperRecord[];
          briefMeta: { title: string; dateLine: string; runNumber: number } | null;
        };

        // Monthly cap check FIRST — an exhausted room records an honest "capped" run.
        if (scanCtx.monthCreditsUsed >= room.monthlyCreditCap) {
          summary.capped += 1;
          await ctx.runMutation(commitScanRunRef, {
            publicRoomId: room._id,
            status: "capped",
            startedAt,
            completedAt: Date.now(),
            sourcesChecked: 0,
            changedSources: 0,
            itemsCreated: 0,
            itemsUpdated: 0,
            creditsUsed: 0,
            error: "monthly_credit_cap_reached",
            runlogAppend: [
              {
                at: utcClock(Date.now()),
                event: "scan skipped",
                meta: `monthly credit cap reached (${scanCtx.monthCreditsUsed}/${room.monthlyCreditCap} cr)`,
                status: "skipped",
                cost: "0.0 cr",
              },
            ],
            sourceUpdates: [],
          });
          continue;
        }

        let sourcesChecked = 0;
        let changedSources = 0;
        let itemsCreated = 0;
        let itemsUpdated = 0;
        let itemsExtracted = 0;
        let firstError: string | undefined;
        const runlogAppend: RunlogEntry[] = [];
        const sourceUpdates: Array<{
          sourceId: Id<"publicRoomSources">;
          lastContentHash?: string;
          lastCheckedAt?: number;
          status?: "active" | "paused" | "failed";
        }> = [];
        let statePatch:
          | { papers: PaperRecord[]; briefMarkdown: string; briefMeta: { title: string; dateLine: string; runNumber: number } }
          | undefined;

        for (const source of sources) {
          if (source.status !== "active") continue;
          sourcesChecked += 1;
          try {
            // SSRF gate: hardcoded allowlist, exact host match, https-only — BEFORE any fetch.
            const check = validateSourceUrl(source.url, source.allowedHost);
            if (!check.ok) {
              firstError = firstError ?? `source_blocked:${check.reason}`;
              sourceUpdates.push({ sourceId: source._id, status: "failed", lastCheckedAt: Date.now() });
              runlogAppend.unshift({
                at: utcClock(Date.now()),
                event: `source blocked ${source.allowedHost}`,
                meta: `${check.reason} · allowlist: ${ALLOWED_SOURCE_HOSTS.join(", ")} · no fetch attempted`,
                status: "failed",
                cost: "0.0 cr",
              });
              continue;
            }
            const fetched = await fetchSourceBounded(check.href);
            if (!fetched.ok) {
              firstError = firstError ?? fetched.error;
              sourceUpdates.push({ sourceId: source._id, status: "failed", lastCheckedAt: Date.now() });
              runlogAppend.unshift({
                at: utcClock(Date.now()),
                event: `fetch ${check.host}`,
                meta: fetched.error,
                status: "failed",
                cost: "0.0 cr",
              });
              continue;
            }
            const hash = await contentHash(`${PAPER_EXTRACTOR_CACHE_VERSION}\n${fetched.text}`);
            if (hash === source.lastContentHash) {
              sourceUpdates.push({ sourceId: source._id, lastCheckedAt: Date.now(), status: "active" });
              runlogAppend.unshift({
                at: utcClock(Date.now()),
                event: `fetch ${check.host}`,
                meta: "hash unchanged · no fetch-derived writes",
                status: "skipped",
                cost: "0.0 cr",
              });
              continue;
            }
            // Changed content → deterministic extract + diff + template brief.
            changedSources += 1;
            const extracted = extractPapersFromHtml(fetched.text);
            itemsExtracted += extracted.length;
            const priorPapers = scrubSourceExtractedPapers(statePatch?.papers ?? scanCtx.papers);
            const diff = applyScanDiff(priorPapers, extracted, utcDateKey(now));
            itemsCreated += diff.newCount;
            itemsUpdated += diff.updatedCount;
            const runNumber = (statePatch?.briefMeta.runNumber ?? scanCtx.briefMeta?.runNumber ?? 0) + (statePatch ? 0 : 1);
            const briefMeta = {
              title: scanCtx.briefMeta?.title ?? `${room.title} — daily brief`,
              dateLine: `${utcDateKey(now)} · run #${runNumber} · completed ${utcClock(Date.now())} UTC`,
              runNumber,
            };
            statePatch = {
              papers: diff.papers,
              briefMarkdown: renderDailyBriefMarkdown(briefMeta, diff.papers),
              briefMeta,
            };
            sourceUpdates.push({
              sourceId: source._id,
              lastContentHash: hash,
              lastCheckedAt: Date.now(),
              status: "active",
            });
            runlogAppend.unshift({
              at: utcClock(Date.now()),
              event: `fetch ${check.host}`,
              meta: `hash ${hash.slice(0, 8)}… · changed`,
              status: "changed",
              cost: "0.2 cr",
            });
            runlogAppend.unshift({
              at: utcClock(Date.now()),
              event: "extract new items",
              meta: `${diff.newCount} new · ${diff.updatedCount} updated · deterministic parse (no model calls)`,
              status: "ok",
              cost: "0.1 cr",
            });
            runlogAppend.unshift({
              at: utcClock(Date.now()),
              event: "append daily brief",
              meta: "template-rendered · deterministic · agent-authored",
              status: "ok",
              cost: "0.1 cr",
            });
          } catch (error) {
            // ERROR_BOUNDARY per source — never let one source kill the room scan silently.
            firstError = firstError ?? `source_error:${error instanceof Error ? error.message : String(error)}`.slice(0, 200);
            sourceUpdates.push({ sourceId: source._id, status: "failed", lastCheckedAt: Date.now() });
            runlogAppend.unshift({
              at: utcClock(Date.now()),
              event: "source scan error",
              meta: (error instanceof Error ? error.message : String(error)).slice(0, 160),
              status: "failed",
              cost: "0.0 cr",
            });
          }
        }

        const creditsUsed = estimateScanCredits({ changedSources, itemsExtracted });
        // Per-run cap: HONEST "capped" — fetch-derived state writes are withheld.
        const perRunCapped = creditsUsed > room.perRunCreditCap;
        const status: "completed" | "failed" | "capped" | "skipped" = perRunCapped
          ? "capped"
          : firstError !== undefined
            ? "failed"
            : changedSources > 0
              ? "completed"
              : "skipped";
        const papersCount = perRunCapped
          ? scanCtx.papers.length
          : (statePatch?.papers.length ?? scanCtx.papers.length);
        await ctx.runMutation(commitScanRunRef, {
          publicRoomId: room._id,
          status,
          startedAt,
          completedAt: Date.now(),
          sourcesChecked,
          changedSources,
          itemsCreated: perRunCapped ? 0 : itemsCreated,
          itemsUpdated: perRunCapped ? 0 : itemsUpdated,
          creditsUsed: perRunCapped ? 0 : creditsUsed,
          ...(perRunCapped
            ? { error: `per_run_credit_cap:${creditsUsed}>${room.perRunCreditCap}` }
            : firstError !== undefined
              ? { error: firstError }
              : {}),
          lastMetric: lastMetricFor(papersCount, perRunCapped ? 0 : itemsCreated),
          runlogAppend: perRunCapped
            ? [
                {
                  at: utcClock(Date.now()),
                  event: "scan capped",
                  meta: `per-run credit cap: estimate ${creditsUsed} cr > cap ${room.perRunCreditCap} cr · state writes withheld`,
                  status: "skipped",
                  cost: "0.0 cr",
                },
              ]
            : runlogAppend,
          ...(perRunCapped || !statePatch ? {} : { statePatch }),
          sourceUpdates: perRunCapped ? [] : sourceUpdates,
        });
        // Count AFTER the commit lands: if commitScanRun throws, the per-room
        // catch below records the SINGLE honest outcome (failed) — the summary
        // can never double-count one room (e.g. completed+failed).
        summary[status] += 1;
      } catch (error) {
        // ERROR_BOUNDARY per room: record an honest failed run; never swallow.
        summary.failed += 1;
        try {
          await ctx.runMutation(commitScanRunRef, {
            publicRoomId: room._id,
            status: "failed",
            startedAt,
            completedAt: Date.now(),
            sourcesChecked: 0,
            changedSources: 0,
            itemsCreated: 0,
            itemsUpdated: 0,
            creditsUsed: 0,
            error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
            runlogAppend: [
              {
                at: utcClock(Date.now()),
                event: "scan failed",
                meta: (error instanceof Error ? error.message : String(error)).slice(0, 160),
                status: "failed",
                cost: "0.0 cr",
              },
            ],
            sourceUpdates: [],
          });
        } catch {
          // Recording itself failed — surface in the action result rather than pretending success.
          summary.failed += 0;
        }
      }
    }
    return summary;
  },
});

// ─── Seed + digest outbox (internal) ───────────────────────────────────────

/**
 * Upsert the Expositio Pulse flagship room + its one allowlisted source + an
 * initial demo-parity state (same values as src/alwayson/demoData.ts) so the
 * public page is non-empty before the first scheduled scan. Idempotent: never
 * clobbers an existing state (a real scan's output wins over demo data).
 */
export const seedPublicRoom = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const card = AO_CARDS.find((c) => c.slug === AO_ROOM_META.slug);
    let room = await ctx.db
      .query("publicRooms")
      .withIndex("by_slug", (q) => q.eq("slug", AO_ROOM_META.slug))
      .first();
    let createdRoom = false;
    if (!room) {
      const roomId = await ctx.db.insert("publicRooms", {
        slug: AO_ROOM_META.slug,
        title: AO_ROOM_META.title,
        description: card?.desc ?? "New expository papers, topics, authors, and a weekly reading digest.",
        status: "active",
        mode: "digest",
        timezone: "America/Los_Angeles",
        scanCadence: "daily",
        monthlyCreditCap: 90,
        perRunCreditCap: 3,
        lastMetric: card?.metric ?? lastMetricFor(AO_ROOM_META.papersCount, 4),
        createdAt: now,
        updatedAt: now,
      });
      room = (await ctx.db.get(roomId))!;
      createdRoom = true;
    }
    const sources = await ctx.db
      .query("publicRoomSources")
      .withIndex("by_room", (q) => q.eq("publicRoomId", room._id))
      .take(MAX_SOURCES_PER_ROOM);
    // Trailing slash is load-bearing: expositio.org 301s /papers -> /papers/,
    // and the scanner's SSRF-contained fetch (redirect:"error") refuses to
    // follow — the canonical URL must be the post-redirect form.
    const sourceUrl = "https://expositio.org/papers/";
    let createdSource = false;
    const canonical = sources.find((s) => s.url === sourceUrl);
    const staleSeed = sources.find((s) => s.url === sourceUrl.replace(/\/$/, ""));
    if (!canonical && staleSeed) {
      // Migrate a row seeded before the slash fix instead of inserting a twin.
      await ctx.db.patch(staleSeed._id, { url: sourceUrl, status: "active" });
    } else if (!canonical) {
      await ctx.db.insert("publicRoomSources", {
        publicRoomId: room._id,
        url: sourceUrl,
        allowedHost: "expositio.org",
        label: "expositio.org/papers",
        status: "active",
      });
      createdSource = true;
    }
    const state = await ctx.db
      .query("publicRoomStates")
      .withIndex("by_room", (q) => q.eq("publicRoomId", room._id))
      .first();
    let createdState = false;
    if (!state) {
      const papers: PaperRecord[] = AO_PAPERS.slice(0, MAX_TRACKED_PAPERS).map((p) => ({
        title: p.title,
        discipline: p.discipline,
        topic: p.topic,
        difficulty: p.difficulty,
        status: p.status,
        firstSeen: p.firstSeen,
        evidenceRef: p.evidenceRef,
      }));
      const briefMeta = {
        title: AO_ROOM_META.briefTitle,
        dateLine: AO_ROOM_META.briefDate,
        runNumber: 26,
      };
      await ctx.db.insert("publicRoomStates", {
        publicRoomId: room._id,
        papers,
        briefMarkdown: renderDailyBriefMarkdown(briefMeta, papers),
        briefMeta,
        runlog: AO_RUNLOG.slice(0, MAX_RUNLOG_ENTRIES).map((r) => ({
          at: r.at,
          event: r.event,
          meta: r.meta,
          status: r.status,
          cost: r.cost,
        })),
        updatedAt: now,
      });
      createdState = true;
    }
    return { ok: true as const, createdRoom, createdSource, createdState, publicRoomId: room._id };
  },
});

/**
 * Enqueue digest outbox rows for one (room, briefKey). Idempotency-key dedup:
 * existing keys are skipped so re-running a digest never double-drafts.
 * Non-active subscribers get an HONEST "skipped" row (reason in error).
 */
export const enqueueDigestOutbox = internalMutation({
  args: {
    publicRoomId: v.id("publicRooms"),
    briefKey: v.string(),
    subject: v.string(),
    markdownBody: v.string(),
  },
  handler: async (ctx, a) => {
    const room = await ctx.db.get(a.publicRoomId);
    if (!room) return { ok: false as const, reason: "room_not_found" };
    const subs = await ctx.db
      .query("publicRoomSubscriptions")
      .withIndex("by_room", (q) => q.eq("publicRoomId", a.publicRoomId))
      .take(MAX_SUBSCRIPTIONS_PER_ROOM);
    const byId = new Map(subs.map((s) => [String(s._id), s]));
    const plan = planOutboxEnqueue({
      roomSlug: room.slug,
      briefKey: a.briefKey,
      subscribers: subs.map((s) => ({ id: String(s._id), status: s.status, cadence: s.cadence })),
      existingKeys: new Set(),
    });
    const now = Date.now();
    let created = 0;
    let skippedInactive = 0;
    let deduped = 0;
    for (const row of plan) {
      const existing = await ctx.db
        .query("publicRoomOutbox")
        .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", row.idempotencyKey))
        .take(1);
      if (existing.length > 0) {
        deduped += 1;
        continue;
      }
      const sub = byId.get(row.subscriptionId);
      if (!sub) continue;
      await ctx.db.insert("publicRoomOutbox", {
        publicRoomId: a.publicRoomId,
        subscriptionId: sub._id,
        briefKey: a.briefKey,
        subject: a.subject,
        markdownBody: a.markdownBody,
        idempotencyKey: row.idempotencyKey,
        state: row.state,
        ...(row.error !== undefined ? { error: row.error } : {}),
        createdAt: now,
        updatedAt: now,
      });
      if (row.state === "skipped") skippedInactive += 1;
      else created += 1;
    }
    return { ok: true as const, created, skippedInactive, deduped };
  },
});

/**
 * Move one outbox row through the state machine. Invalid transitions are
 * rejected honestly via alwaysOnCore.canTransition; failed→pending_draft is
 * bounded to ONE retry (RETRY_MARKER stamp).
 */
export const transitionOutbox = internalMutation({
  args: {
    outboxId: v.id("publicRoomOutbox"),
    to: outboxStateV,
    providerRef: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.outboxId);
    if (!row) return { ok: false as const, reason: "outbox_row_not_found" };
    if (!canTransition(row.state, a.to)) {
      return { ok: false as const, reason: `invalid_transition:${row.state}->${a.to}` };
    }
    let nextError = a.error ?? row.error;
    if (row.state === "failed" && a.to === "pending_draft") {
      const retry = retryDecision(row.error);
      if (!retry.allowed) return { ok: false as const, reason: retry.reason };
      nextError = retry.nextError;
    }
    await ctx.db.patch(a.outboxId, {
      state: a.to,
      ...(a.providerRef !== undefined ? { providerRef: a.providerRef } : {}),
      ...(nextError !== undefined ? { error: nextError.slice(0, 500) } : {}),
      updatedAt: Date.now(),
    });
    return { ok: true as const, from: row.state, to: a.to };
  },
});
