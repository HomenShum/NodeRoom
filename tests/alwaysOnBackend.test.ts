// @vitest-environment edge-runtime
/**
 * Always-On Rooms — backend scenario tests (convex/alwaysOn.ts + alwaysOnShape.ts).
 *
 * Runs the REAL Convex functions against convex-test's in-memory backend (no
 * deployment, no codegen — alwaysOn refs resolve via makeFunctionReference,
 * the repo's precedent for not-yet-codegen'd modules; see
 * securityConvexSurfaces.test.ts). The scheduled scan runs with a stubbed
 * global fetch so every network scenario — changed page, unchanged page,
 * upstream outage, SSRF probe — is deterministic.
 *
 * Personas: an anonymous visitor browsing the landing gallery, a researcher
 * double-opting into the digest, a hostile actor probing for PII/SSRF, and
 * the 24h cron doing its rounds under credit caps.
 */
import { makeFunctionReference } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { sha256Hex } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";
import {
  MAX_PENDING_PER_EMAIL,
  MAX_RUNLOG_ENTRIES,
  MAX_SUBSCRIBES_PER_ROOM_PER_MINUTE,
  MAX_SUBSCRIPTIONS_PER_ROOM,
  MAX_TRACKED_PAPERS,
  applyScanDiff,
  boundRunlog,
  estimateScanCredits,
  evaluateSubscriptionRequest,
  findForbiddenPublicKeys,
  isRoomDue,
  planOutboxEnqueue,
  retryDecision,
  runStatusToRoomStatus,
  selectPrunableAlwaysOnRow,
  toPublicRoomBundle,
  toPublicRoomCard,
  RETRY_MARKER,
  type PaperRecord,
  type RunlogEntry,
} from "../convex/alwaysOnShape";
import { AO_PAPERS, AO_ROOM_META } from "../src/alwayson/demoData";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

// alwaysOn is not in _generated (codegen deploys to prod — forbidden here), so
// reference by name exactly like crons.ts / securityConvexSurfaces.test.ts do.
const listPublicRoomsRef = makeFunctionReference<"query">("alwaysOn:listPublicRooms") as any;
const getBundleRef = makeFunctionReference<"query">("alwaysOn:getPublicRoomBundle") as any;
const subscribeRef = makeFunctionReference<"mutation">("alwaysOn:subscribeToRoom") as any;
const confirmRef = makeFunctionReference<"mutation">("alwaysOn:confirmSubscription") as any;
const unsubscribeRef = makeFunctionReference<"mutation">("alwaysOn:unsubscribeFromRoom") as any;
const seedRef = makeFunctionReference<"mutation">("alwaysOn:seedPublicRoom") as any;
const enqueueRef = makeFunctionReference<"mutation">("alwaysOn:enqueueDigestOutbox") as any;
const transitionRef = makeFunctionReference<"mutation">("alwaysOn:transitionOutbox") as any;
const scanRef = makeFunctionReference<"action">("alwaysOn:scanDuePublicRooms") as any;
const pruneAlwaysOnRef = makeFunctionReference<"mutation">("retention:pruneAlwaysOnRows") as any;

const SLUG = AO_ROOM_META.slug;
const DAY_MS = 24 * 60 * 60 * 1000;

function newT() {
  return convexTest(schema, modules);
}

async function seeded() {
  const t = newT();
  const seed = await t.mutation(seedRef, {});
  return { t, roomId: seed.publicRoomId as Id<"publicRooms"> };
}

/** Minimal Response stand-in for fetchSourceBounded's no-reader path. */
function htmlResponse(html: string, status = 200) {
  return { ok: status >= 200 && status < 300, status, body: undefined, text: async () => html } as unknown as Response;
}

const PAGE_V1 = [
  '<a href="/papers/9001" data-discipline="Mathematics" data-topic="category theory">Adjunctions in the wild</a>',
  '<a href="/papers/9002" data-discipline="Physics">Effective field theories, effectively</a>',
].join("\n");

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─── Seed + public queries (visitor persona, PII adversary) ─────────────────

describe("seedPublicRoom + public queries", () => {
  it("seeds Expositio Pulse idempotently (a re-seed never clobbers state)", async () => {
    const { t } = await seeded();
    const again = await t.mutation(seedRef, {});
    expect(again.createdRoom).toBe(false);
    expect(again.createdSource).toBe(false);
    expect(again.createdState).toBe(false);
    await t.run(async (ctx) => {
      const rooms = await ctx.db.query("publicRooms").collect();
      expect(rooms).toHaveLength(1);
      const sources = await ctx.db.query("publicRoomSources").collect();
      expect(sources).toHaveLength(1);
      expect(sources[0].allowedHost).toBe("expositio.org");
    });
  });

  it("re-seed migrates a pre-slash-fix source URL instead of inserting a twin", async () => {
    // expositio.org 301s /papers -> /papers/; the scanner's redirect:"error"
    // fetch refuses to follow, so rows seeded with the slashless URL failed
    // every scan. Re-seeding must patch that row to the canonical URL.
    const { t } = await seeded();
    await t.run(async (ctx) => {
      const source = (await ctx.db.query("publicRoomSources").collect())[0];
      await ctx.db.patch(source._id, { url: "https://expositio.org/papers", status: "failed" });
    });
    await t.mutation(seedRef, {});
    await t.run(async (ctx) => {
      const sources = await ctx.db.query("publicRoomSources").collect();
      expect(sources).toHaveLength(1);
      expect(sources[0].url).toBe("https://expositio.org/papers/");
      expect(sources[0].status).toBe("active");
    });
  });

  it("listPublicRooms returns demo-parity cards with ONLY card fields", async () => {
    const { t } = await seeded();
    const cards = await t.query(listPublicRoomsRef, {});
    expect(cards).toHaveLength(1);
    expect(cards[0].slug).toBe(SLUG);
    expect(cards[0].papersCount).toBe(AO_PAPERS.length);
    expect(Object.keys(cards[0]).sort()).toEqual(
      ["description", "lastMetric", "lastRunAt", "lastRunStatus", "papersCount", "slug", "title"].sort(),
    );
  });

  it("hides paused rooms from the landing gallery", async () => {
    const { t, roomId } = await seeded();
    await t.run(async (ctx) => ctx.db.patch(roomId, { status: "paused" as const }));
    expect(await t.query(listPublicRoomsRef, {})).toEqual([]);
  });

  it("getPublicRoomBundle returns room+state+runs+sources and null for unknown slugs", async () => {
    const { t } = await seeded();
    expect(await t.query(getBundleRef, { slug: "no-such-room" })).toBeNull();
    const bundle = await t.query(getBundleRef, { slug: SLUG });
    expect(bundle.room.slug).toBe(SLUG);
    expect(bundle.state.papers).toHaveLength(AO_PAPERS.length);
    expect(bundle.state.briefMarkdown).toContain("## What changed");
    expect(bundle.sources).toHaveLength(1);
    expect(bundle.sources[0].url).toBe("https://expositio.org/papers/");
    expect(Array.isArray(bundle.runs)).toBe(true);
  });

  it("PII adversary: no email, token hash, or source content hash ever leaves a public query", async () => {
    const { t } = await seeded();
    const email = "pii-probe@example.com";
    const sub = await t.mutation(subscribeRef, { slug: SLUG, email, cadence: "daily" });
    expect(sub.ok).toBe(true);
    // Capture the stored token hashes and give the source an internal lastContentHash too.
    const { confirmTokenHash, unsubTokenHash } = await t.run(async (ctx) => {
      const source = (await ctx.db.query("publicRoomSources").collect())[0];
      await ctx.db.patch(source._id, { lastContentHash: "deadbeef".repeat(8) });
      const [row] = await ctx.db.query("publicRoomSubscriptions").collect();
      return { confirmTokenHash: row.confirmTokenHash, unsubTokenHash: row.unsubTokenHash };
    });
    const cards = await t.query(listPublicRoomsRef, {});
    const bundle = await t.query(getBundleRef, { slug: SLUG });
    for (const payload of [cards, bundle]) {
      expect(findForbiddenPublicKeys(payload)).toEqual([]);
      const json = JSON.stringify(payload);
      expect(json).not.toContain(email);
      expect(json).not.toContain(confirmTokenHash);
      expect(json).not.toContain(unsubTokenHash);
      expect(json).not.toContain("deadbeef");
    }
  });
});

// ─── Subscription lifecycle (researcher persona + hostile inputs) ───────────

describe("subscription lifecycle (double opt-in)", () => {
  it("subscribe stores ONLY sha256 hashes; a planted confirm token drives the confirm flow", async () => {
    const { t } = await seeded();
    const res = await t.mutation(subscribeRef, { slug: SLUG, email: "Researcher@Stanford.EDU", cadence: "weekly" });
    expect(res).toEqual({ ok: true });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("publicRoomSubscriptions").collect();
      expect(rows).toHaveLength(1);
      expect(rows[0].email).toBe("researcher@stanford.edu"); // normalized
      expect(rows[0].status).toBe("pending");
      expect(rows[0].confirmTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].unsubTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(rows[0].confirmTokenHash).not.toBe(rows[0].unsubTokenHash);
    });

    // The raw confirm token travels ONLY inside the confirmation email — the
    // caller never sees it. Plant a known token hash (same technique as the
    // unsubscribe test) to exercise double opt-in step 2.
    const rawConfirm = "known-confirm-token-0123456789abcdefghij";
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("publicRoomSubscriptions").collect();
      await ctx.db.patch(row._id, { confirmTokenHash: await sha256Hex(rawConfirm) });
    });
    const confirmed = await t.mutation(confirmRef, { token: rawConfirm });
    expect(confirmed).toEqual({ ok: true });
    const again = await t.mutation(confirmRef, { token: rawConfirm });
    expect(again).toEqual({ ok: true, alreadyConfirmed: true });
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("publicRoomSubscriptions").collect();
      expect(row.status).toBe("active");
      expect(row.confirmedAt).toBeGreaterThan(0);
    });
  });

  it("REGRESSION: subscribe's success return carries NO key matching /token/i (double opt-in is not forgeable)", async () => {
    const { t } = await seeded();
    const res = await t.mutation(subscribeRef, { slug: SLUG, email: "victim@lab.org", cadence: "daily" });
    expect(res).toEqual({ ok: true });
    expect(Object.keys(res)).toEqual(["ok"]);
    // findForbiddenPublicKeys' pattern covers /token/i (and email/secret) —
    // reuse it as the deep-walk guard over the whole return value.
    expect(findForbiddenPublicKeys(res)).toEqual([]);
    expect(JSON.stringify(res)).not.toMatch(/token/i);
  });

  it.each([
    ["not-an-email", "daily", "invalid_email"],
    ["a@b", "daily", "invalid_email"],
    ["x@y.com", "daily", "room_not_found"],
  ] as const)("honest failure: %s / %s → %s", async (email, cadence, reason) => {
    const { t } = await seeded();
    const slug = reason === "room_not_found" ? "ghost-room" : SLUG;
    expect(await t.mutation(subscribeRef, { slug, email, cadence })).toEqual({ ok: false, reason });
  });

  it("rejects subscriptions to a paused room honestly", async () => {
    const { t, roomId } = await seeded();
    await t.run(async (ctx) => ctx.db.patch(roomId, { status: "paused" as const }));
    expect(await t.mutation(subscribeRef, { slug: SLUG, email: "x@y.com", cadence: "daily" })).toEqual({
      ok: false,
      reason: "room_not_active",
    });
  });

  it("anti-enumeration: pending-capped and already-subscribed probes are byte-identical to a fresh success and insert NOTHING", async () => {
    const { t } = await seeded();
    const fresh = await t.mutation(subscribeRef, { slug: SLUG, email: "eager@lab.org", cadence: "daily" });
    expect(fresh).toEqual({ ok: true });
    for (let i = 1; i < MAX_PENDING_PER_EMAIL; i++) {
      expect(await t.mutation(subscribeRef, { slug: SLUG, email: "eager@lab.org", cadence: "daily" })).toEqual(fresh);
    }
    // Pending cap reached — the probe reads exactly like a fresh success…
    const cappedProbe = await t.mutation(subscribeRef, { slug: SLUG, email: "eager@lab.org", cadence: "daily" });
    expect(JSON.stringify(cappedProbe)).toBe(JSON.stringify(fresh));
    // …and no 4th row was inserted (BOUND still holds).
    await t.run(async (ctx) => {
      const rows = (await ctx.db.query("publicRoomSubscriptions").collect()).filter((r) => r.email === "eager@lab.org");
      expect(rows).toHaveLength(MAX_PENDING_PER_EMAIL);
      expect(rows.every((r) => r.status === "pending")).toBe(true);
    });
    // Activate a different email (token stays email-side; flip status directly)…
    expect(await t.mutation(subscribeRef, { slug: SLUG, email: "calm@lab.org", cadence: "act_now" })).toEqual(fresh);
    await t.run(async (ctx) => {
      const row = (await ctx.db.query("publicRoomSubscriptions").collect()).find((r) => r.email === "calm@lab.org")!;
      await ctx.db.patch(row._id, { status: "active" as const, confirmedAt: Date.now() });
    });
    // …then probe it: byte-identical success, still exactly one row.
    const subscribedProbe = await t.mutation(subscribeRef, { slug: SLUG, email: "calm@lab.org", cadence: "daily" });
    expect(JSON.stringify(subscribedProbe)).toBe(JSON.stringify(fresh));
    await t.run(async (ctx) => {
      const rows = (await ctx.db.query("publicRoomSubscriptions").collect()).filter((r) => r.email === "calm@lab.org");
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("active");
    });
  });

  it("DoS gate: the 11th subscribe inside a minute is rejected honestly (rate_limited), nothing inserted", async () => {
    const { t } = await seeded();
    for (let i = 0; i < MAX_SUBSCRIBES_PER_ROOM_PER_MINUTE; i++) {
      expect(await t.mutation(subscribeRef, { slug: SLUG, email: `burst${i}@lab.org`, cadence: "daily" })).toEqual({ ok: true });
    }
    expect(await t.mutation(subscribeRef, { slug: SLUG, email: "straggler@lab.org", cadence: "daily" })).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("publicRoomSubscriptions").collect();
      expect(rows).toHaveLength(MAX_SUBSCRIBES_PER_ROOM_PER_MINUTE);
      expect(rows.some((r) => r.email === "straggler@lab.org")).toBe(false);
    });
  });

  it("room cap counts ONLY live rows: 5000 unsubscribed rows don't consume it; 5000 live rows reject honestly", async () => {
    // Plant a full room of unsubscribed rows AGED past the rate window —
    // convex-test derives _creationTime from Date.now() but keeps it
    // MONOTONIC, so the fake clock must start before the seed insert too.
    vi.useFakeTimers({ now: Date.now() - 10 * 60_000, toFake: ["Date"] });
    let t: ReturnType<typeof newT>;
    let roomId: Id<"publicRooms">;
    try {
      ({ t, roomId } = await seeded());
      await t.run(async (ctx) => {
        for (let i = 0; i < MAX_SUBSCRIPTIONS_PER_ROOM; i++) {
          await ctx.db.insert("publicRoomSubscriptions", {
            publicRoomId: roomId,
            email: `former${i}@lab.org`,
            cadence: "daily" as const,
            status: "unsubscribed" as const,
            confirmTokenHash: "c".repeat(64),
            unsubTokenHash: "u".repeat(64),
            createdAt: Date.now(),
          });
        }
      });
    } finally {
      vi.useRealTimers();
    }
    // Unsubscribed rows never consume the cap: a fresh subscribe still lands.
    expect(await t.mutation(subscribeRef, { slug: SLUG, email: "fresh@lab.org", cadence: "daily" })).toEqual({ ok: true });
    // Flip the planted rows live: the cap is reached and rejected honestly
    // (a room-wide condition — it leaks nothing about a specific email).
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("publicRoomSubscriptions").collect();
      for (const row of rows) {
        if (row.status === "unsubscribed") await ctx.db.patch(row._id, { status: "pending" as const });
      }
    });
    expect(await t.mutation(subscribeRef, { slug: SLUG, email: "late@lab.org", cadence: "daily" })).toEqual({
      ok: false,
      reason: "room_subscription_limit",
    });
  });

  it("confirm/unsubscribe reject garbage and unknown tokens without leaking which", async () => {
    const { t } = await seeded();
    expect(await t.mutation(confirmRef, { token: "short" })).toEqual({ ok: false, reason: "invalid_token" });
    expect(await t.mutation(confirmRef, { token: "f".repeat(64) })).toEqual({ ok: false, reason: "invalid_token" });
    expect(await t.mutation(unsubscribeRef, { token: "f".repeat(64) })).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("unsubscribe by raw token is idempotent and blocks later confirmation", async () => {
    const { t } = await seeded();
    expect(await t.mutation(subscribeRef, { slug: SLUG, email: "leaver@lab.org", cadence: "daily" })).toEqual({ ok: true });
    // Raw tokens normally travel only inside emails; plant known ones so the
    // test can exercise both token → hash lookup paths.
    const rawUnsub = "known-unsub-token-0123456789abcdefghij";
    const rawConfirm = "known-confirm-token-0123456789abcdefghij";
    await t.run(async (ctx) => {
      const [row] = await ctx.db.query("publicRoomSubscriptions").collect();
      await ctx.db.patch(row._id, {
        unsubTokenHash: await sha256Hex(rawUnsub),
        confirmTokenHash: await sha256Hex(rawConfirm),
      });
    });
    expect(await t.mutation(unsubscribeRef, { token: rawUnsub })).toEqual({ ok: true });
    expect(await t.mutation(unsubscribeRef, { token: rawUnsub })).toEqual({ ok: true, alreadyUnsubscribed: true });
    expect(await t.mutation(confirmRef, { token: rawConfirm })).toEqual({ ok: false, reason: "unsubscribed" });
  });
});

// ─── The deterministic scheduled scan (cron persona, degraded modes) ────────

describe("scanDuePublicRooms (deterministic scan)", () => {
  it("changed page → completed run, new papers, template brief, source hash bookkeeping", async () => {
    const { t, roomId } = await seeded();
    const fetchMock = vi.fn(async (_url: string) => htmlResponse(PAGE_V1));
    vi.stubGlobal("fetch", fetchMock);

    const summary = await t.action(scanRef, {});
    expect(summary).toMatchObject({ scanned: 1, completed: 1, failed: 0, capped: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://expositio.org/papers/");

    await t.run(async (ctx) => {
      const runs = await ctx.db.query("publicRoomRuns").collect();
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ status: "completed", sourcesChecked: 1, changedSources: 1, itemsCreated: 2, itemsUpdated: 0 });
      expect(runs[0].creditsUsed).toBeGreaterThan(0);
      const room = (await ctx.db.get(roomId))!;
      expect(room.lastRunStatus).toBe("ok");
      expect(room.lastMetric).toContain("2 new today");
      const [source] = await ctx.db.query("publicRoomSources").collect();
      expect(source.lastContentHash).toMatch(/^[0-9a-f]{64}$/);
      const [state] = await ctx.db.query("publicRoomStates").collect();
      const fresh = state.papers.filter((p) => p.status === "new");
      expect(fresh.map((p) => p.title)).toEqual(["Adjunctions in the wild", "Effective field theories, effectively"]);
      expect(fresh[0].discipline).toBe("Mathematics");
      // Demo papers demote to tracked — never silently dropped.
      expect(state.papers).toHaveLength(2 + AO_PAPERS.length);
      expect(state.briefMarkdown).toContain("## Top new papers");
      expect(state.briefMeta.runNumber).toBe(27); // seeded at 26
    });
  });

  it("unchanged page → honest 'skipped' run with zero credits and no fetch-derived writes", async () => {
    const { t, roomId } = await seeded();
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(PAGE_V1)));
    await t.action(scanRef, {});
    // Make the room due again; content identical.
    await t.run(async (ctx) => ctx.db.patch(roomId, { lastRunAt: Date.now() - 2 * DAY_MS }));
    const summary = await t.action(scanRef, {});
    expect(summary).toMatchObject({ scanned: 1, skipped: 1, completed: 0 });
    await t.run(async (ctx) => {
      const runs = await ctx.db.query("publicRoomRuns").collect();
      expect(runs).toHaveLength(2);
      const skipped = runs.find((r) => r.status === "skipped")!;
      expect(skipped.creditsUsed).toBe(0);
      expect(skipped.changedSources).toBe(0);
      const [state] = await ctx.db.query("publicRoomStates").collect();
      expect(state.runlog.some((e) => e.meta.includes("hash unchanged · no fetch-derived writes"))).toBe(true);
      expect(state.briefMeta.runNumber).toBe(27); // brief NOT re-rendered on an unchanged scan
      const room = (await ctx.db.get(roomId))!;
      expect(room.lastRunStatus).toBe("skipped");
    });
  });

  it("a room that is not due is left alone entirely", async () => {
    const { t, roomId } = await seeded();
    await t.run(async (ctx) => ctx.db.patch(roomId, { lastRunAt: Date.now() - 60_000 }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const summary = await t.action(scanRef, {});
    expect(summary).toMatchObject({ notDue: 1, scanned: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("operator force can re-scan one room by slug without waiting for cadence", async () => {
    const { t, roomId } = await seeded();
    await t.run(async (ctx) => ctx.db.patch(roomId, { lastRunAt: Date.now() - 60_000 }));
    const fetchMock = vi.fn(async (_url: string) => htmlResponse(PAGE_V1));
    vi.stubGlobal("fetch", fetchMock);

    const summary = await t.action(scanRef, { force: true, slug: SLUG });

    expect(summary).toMatchObject({ scanned: 1, completed: 1, notDue: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("operator force scoped to another slug does not scan this room", async () => {
    const { t } = await seeded();
    const fetchMock = vi.fn(async (_url: string) => htmlResponse(PAGE_V1));
    vi.stubGlobal("fetch", fetchMock);

    const summary = await t.action(scanRef, { force: true, slug: "missing-room" });

    expect(summary).toMatchObject({ scanned: 0, completed: 0, failed: 0, capped: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upstream outage → honest 'failed' run + failed source, never a fake success", async () => {
    const { t, roomId } = await seeded();
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse("service unavailable", 503)));
    const summary = await t.action(scanRef, {});
    expect(summary).toMatchObject({ failed: 1, completed: 0 });
    await t.run(async (ctx) => {
      const [run] = await ctx.db.query("publicRoomRuns").collect();
      expect(run.status).toBe("failed");
      expect(run.error).toBe("http_503");
      expect(run.creditsUsed).toBe(0);
      expect((await ctx.db.get(roomId))!.lastRunStatus).toBe("failed");
      const [source] = await ctx.db.query("publicRoomSources").collect();
      expect(source.status).toBe("failed");
      expect(source.lastContentHash).toBeUndefined(); // no fetch-derived writes on failure
    });
  });

  it("network exception → failed run with the error recorded (ERROR_BOUNDARY)", async () => {
    const { t } = await seeded();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNRESET"); }));
    const summary = await t.action(scanRef, {});
    expect(summary).toMatchObject({ failed: 1 });
    await t.run(async (ctx) => {
      const [run] = await ctx.db.query("publicRoomRuns").collect();
      expect(run.status).toBe("failed");
      expect(run.error).toContain("ECONNRESET");
    });
  });

  it("SSRF probe: a smuggled non-allowlisted source is blocked BEFORE any fetch", async () => {
    const { t } = await seeded();
    const now = Date.now();
    // Hostile actor smuggles a second room whose source points at internal infra.
    const evilRoomId = await t.run(async (ctx) =>
      ctx.db.insert("publicRooms", {
        slug: "evil-room",
        title: "Evil",
        description: "probe",
        status: "active" as const,
        mode: "monitor" as const,
        timezone: "UTC",
        scanCadence: "daily" as const,
        monthlyCreditCap: 100,
        perRunCreditCap: 10,
        createdAt: now,
        updatedAt: now,
      }),
    );
    await t.run(async (ctx) => {
      await ctx.db.insert("publicRoomSources", {
        publicRoomId: evilRoomId,
        url: "https://169.254.169.254/latest/meta-data",
        allowedHost: "169.254.169.254",
        status: "active" as const,
      });
    });
    const fetchMock = vi.fn(async (_url: string) => htmlResponse(PAGE_V1));
    vi.stubGlobal("fetch", fetchMock);
    await t.action(scanRef, {});
    // Only the legitimate expositio source was ever fetched.
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(["https://expositio.org/papers/"]);
    await t.run(async (ctx) => {
      const runs = await ctx.db.query("publicRoomRuns").collect();
      const evilRun = runs.find((r) => String(r.publicRoomId) === String(evilRoomId))!;
      expect(evilRun.status).toBe("failed");
      // IP-literal check fires before the allowlist check — either way, blocked pre-fetch.
      expect(evilRun.error).toBe("source_blocked:ip_literal_not_allowed");
    });
  });

  it("monthly credit cap exhausted → honest 'capped' run, zero fetches", async () => {
    const { t, roomId } = await seeded();
    await t.run(async (ctx) => ctx.db.patch(roomId, { monthlyCreditCap: 0 }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const summary = await t.action(scanRef, {});
    expect(summary).toMatchObject({ capped: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
    await t.run(async (ctx) => {
      const [run] = await ctx.db.query("publicRoomRuns").collect();
      expect(run.status).toBe("capped");
      expect(run.error).toBe("monthly_credit_cap_reached");
      expect((await ctx.db.get(roomId))!.lastRunStatus).toBe("capped");
    });
  });

  it("operator force still fails closed when the monthly cap is exhausted", async () => {
    const { t, roomId } = await seeded();
    await t.run(async (ctx) => ctx.db.patch(roomId, { lastRunAt: Date.now() - 60_000, monthlyCreditCap: 0 }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const summary = await t.action(scanRef, { force: true, slug: SLUG });

    expect(summary).toMatchObject({ scanned: 1, capped: 1, completed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("per-run credit cap → 'capped' run and fetch-derived state writes withheld", async () => {
    const { t, roomId } = await seeded();
    await t.run(async (ctx) => ctx.db.patch(roomId, { perRunCreditCap: 0 }));
    vi.stubGlobal("fetch", vi.fn(async () => htmlResponse(PAGE_V1)));
    const summary = await t.action(scanRef, {});
    expect(summary).toMatchObject({ capped: 1 });
    await t.run(async (ctx) => {
      const [run] = await ctx.db.query("publicRoomRuns").collect();
      expect(run.status).toBe("capped");
      expect(run.error).toContain("per_run_credit_cap");
      const [state] = await ctx.db.query("publicRoomStates").collect();
      expect(state.papers).toHaveLength(AO_PAPERS.length); // seeded state untouched
      const [source] = await ctx.db.query("publicRoomSources").collect();
      expect(source.lastContentHash).toBeUndefined();
    });
  });
});

// ─── Digest outbox (draft-first, idempotent) ────────────────────────────────

describe("enqueueDigestOutbox + transitionOutbox", () => {
  async function seedSubscribers(t: ReturnType<typeof newT>, roomId: Id<"publicRooms">) {
    return t.run(async (ctx) => {
      const now = Date.now();
      const mk = (email: string, status: "pending" | "active" | "unsubscribed") =>
        ctx.db.insert("publicRoomSubscriptions", {
          publicRoomId: roomId,
          email,
          cadence: "daily" as const,
          status,
          confirmTokenHash: "c".repeat(64),
          unsubTokenHash: "u".repeat(64),
          createdAt: now,
          ...(status === "active" ? { confirmedAt: now } : {}),
        });
      return { active: await mk("active@lab.org", "active"), pending: await mk("pending@lab.org", "pending"), gone: await mk("gone@lab.org", "unsubscribed") };
    });
  }

  it("drafts for active subscribers, honestly skips inactive ones, dedupes on re-run", async () => {
    const { t, roomId } = await seeded();
    await seedSubscribers(t, roomId);
    const first = await t.mutation(enqueueRef, { publicRoomId: roomId, briefKey: "2026-07-04", subject: "Expositio daily brief — 2026-07-04", markdownBody: "# brief" });
    expect(first).toEqual({ ok: true, created: 1, skippedInactive: 2, deduped: 0 });
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("publicRoomOutbox").collect();
      expect(rows).toHaveLength(3);
      const drafted = rows.filter((r) => r.state === "pending_draft");
      expect(drafted).toHaveLength(1);
      const skipped = rows.filter((r) => r.state === "skipped");
      expect(skipped.every((r) => r.error === "subscriber_not_active")).toBe(true);
      // Idempotency keys follow the contract format roomSlug:briefKey:subId:cadence.
      expect(rows.every((r) => r.idempotencyKey.startsWith(`${SLUG}:2026-07-04:`) && r.idempotencyKey.endsWith(":daily"))).toBe(true);
    });
    const rerun = await t.mutation(enqueueRef, { publicRoomId: roomId, briefKey: "2026-07-04", subject: "same brief", markdownBody: "# brief" });
    expect(rerun).toEqual({ ok: true, created: 0, skippedInactive: 0, deduped: 3 });
    // A new briefKey drafts again (new day, new digest).
    const nextDay = await t.mutation(enqueueRef, { publicRoomId: roomId, briefKey: "2026-07-05", subject: "next brief", markdownBody: "# brief2" });
    expect(nextDay).toMatchObject({ ok: true, created: 1, deduped: 0 });
  });

  it("walks the draft-first machine and rejects invalid transitions honestly", async () => {
    const { t, roomId } = await seeded();
    await seedSubscribers(t, roomId);
    await t.mutation(enqueueRef, { publicRoomId: roomId, briefKey: "2026-07-04", subject: "s", markdownBody: "b" });
    const outboxId = await t.run(async (ctx) => {
      const rows = await ctx.db.query("publicRoomOutbox").collect();
      return rows.find((r) => r.state === "pending_draft")!._id;
    });
    expect(await t.mutation(transitionRef, { outboxId, to: "draft_created", providerRef: "gmail_draft r-1" })).toEqual({ ok: true, from: "pending_draft", to: "draft_created" });
    expect(await t.mutation(transitionRef, { outboxId, to: "approved" })).toMatchObject({ ok: true });
    expect(await t.mutation(transitionRef, { outboxId, to: "sent", providerRef: "gmail_msg 18c4" })).toMatchObject({ ok: true });
    // sent is terminal — anything further is an honest rejection.
    expect(await t.mutation(transitionRef, { outboxId, to: "approved" })).toEqual({ ok: false, reason: "invalid_transition:sent->approved" });
    expect(await t.mutation(transitionRef, { outboxId, to: "pending_draft" })).toEqual({ ok: false, reason: "invalid_transition:sent->pending_draft" });
  });

  it("failed → pending_draft is bounded to ONE retry", async () => {
    const { t, roomId } = await seeded();
    await seedSubscribers(t, roomId);
    await t.mutation(enqueueRef, { publicRoomId: roomId, briefKey: "2026-07-04", subject: "s", markdownBody: "b" });
    const outboxId = await t.run(async (ctx) => {
      const rows = await ctx.db.query("publicRoomOutbox").collect();
      const row = rows.find((r) => r.state === "pending_draft")!;
      await ctx.db.patch(row._id, { state: "failed" as const, error: "smtp_500" });
      return row._id;
    });
    const retry = await t.mutation(transitionRef, { outboxId, to: "pending_draft" });
    expect(retry).toMatchObject({ ok: true, from: "failed", to: "pending_draft" });
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(outboxId))!;
      expect(row.error!.startsWith(RETRY_MARKER)).toBe(true);
      await ctx.db.patch(outboxId, { state: "failed" as const }); // second failure, error keeps the marker
    });
    expect(await t.mutation(transitionRef, { outboxId, to: "pending_draft" })).toEqual({ ok: false, reason: "retry_exhausted" });
  });

  it("rejects an unknown outbox row and an unknown room honestly", async () => {
    const { t, roomId } = await seeded();
    const ghost = await t.run(async (ctx) => {
      const id = await ctx.db.insert("publicRoomOutbox", {
        publicRoomId: roomId,
        subscriptionId: (await ctx.db.insert("publicRoomSubscriptions", {
          publicRoomId: roomId,
          email: "x@y.com",
          cadence: "daily" as const,
          status: "active" as const,
          confirmTokenHash: "c".repeat(64),
          unsubTokenHash: "u".repeat(64),
          createdAt: Date.now(),
        })) as Id<"publicRoomSubscriptions">,
        briefKey: "k",
        subject: "s",
        markdownBody: "b",
        idempotencyKey: "ghost:k:s:daily",
        state: "pending_draft" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    expect(await t.mutation(transitionRef, { outboxId: ghost, to: "draft_created" })).toEqual({ ok: false, reason: "outbox_row_not_found" });
  });
});

// ─── Pure decision/shape helpers (bounds + PII shapes, no DB) ───────────────

describe("alwaysOnShape pure helpers", () => {
  const baseReq = { email: "a@b.co", cadence: "daily", roomStatus: "active", subscriptionCount: 0, pendingForEmail: 0, activeForEmail: 0, recentWindowCount: 0 };
  const freshOk = { ok: true, noop: false, email: "a@b.co" };

  it("evaluateSubscriptionRequest covers the full decision matrix (honest failures, anti-enumeration noops, rate window)", () => {
    expect(evaluateSubscriptionRequest({ ...baseReq })).toEqual(freshOk);
    expect(evaluateSubscriptionRequest({ ...baseReq, roomStatus: undefined })).toEqual({ ok: false, reason: "room_not_found" });
    expect(evaluateSubscriptionRequest({ ...baseReq, roomStatus: "paused" })).toEqual({ ok: false, reason: "room_not_active" });
    expect(evaluateSubscriptionRequest({ ...baseReq, email: "nope" })).toEqual({ ok: false, reason: "invalid_email" });
    expect(evaluateSubscriptionRequest({ ...baseReq, cadence: "hourly" })).toEqual({ ok: false, reason: "invalid_cadence" });
    // Anti-enumeration: membership-revealing cases are noop successes, not reasons.
    expect(evaluateSubscriptionRequest({ ...baseReq, activeForEmail: 1 })).toEqual({ ok: true, noop: true });
    expect(evaluateSubscriptionRequest({ ...baseReq, pendingForEmail: MAX_PENDING_PER_EMAIL })).toEqual({ ok: true, noop: true });
    // Room-wide cap stays honest — under the cap by one still creates.
    expect(evaluateSubscriptionRequest({ ...baseReq, subscriptionCount: MAX_SUBSCRIPTIONS_PER_ROOM })).toEqual({ ok: false, reason: "room_subscription_limit" });
    expect(evaluateSubscriptionRequest({ ...baseReq, subscriptionCount: MAX_SUBSCRIPTIONS_PER_ROOM - 1 })).toEqual(freshOk);
    // Rate window: at-limit rejected, under-limit accepted.
    expect(evaluateSubscriptionRequest({ ...baseReq, recentWindowCount: MAX_SUBSCRIBES_PER_ROOM_PER_MINUTE })).toEqual({ ok: false, reason: "rate_limited" });
    expect(evaluateSubscriptionRequest({ ...baseReq, recentWindowCount: MAX_SUBSCRIBES_PER_ROOM_PER_MINUTE - 1 })).toEqual(freshOk);
    // The rate limit outranks the noop cases — probes under load stay uniform.
    expect(
      evaluateSubscriptionRequest({ ...baseReq, recentWindowCount: MAX_SUBSCRIBES_PER_ROOM_PER_MINUTE, activeForEmail: 1 }),
    ).toEqual({ ok: false, reason: "rate_limited" });
  });

  it("toPublicRoomCard/toPublicRoomBundle drop planted PII fields (explicit picks, no spreads)", () => {
    const now = Date.now();
    const hostileRoom = {
      slug: "s", title: "t", description: "d", status: "active", mode: "digest", timezone: "UTC",
      scanCadence: "daily", monthlyCreditCap: 1, perRunCreditCap: 1, createdAt: now, updatedAt: now,
      subscriberEmails: ["leak@x.com"], confirmTokenHash: "leak",
    } as never;
    const card = toPublicRoomCard(hostileRoom, 3);
    expect(findForbiddenPublicKeys(card)).toEqual([]);
    expect(JSON.stringify(card)).not.toContain("leak");
    const hostileSource = { url: "https://expositio.org/papers/", status: "active", lastContentHash: "leakhash" } as never;
    const bundle = toPublicRoomBundle(hostileRoom, null, [], [hostileSource]);
    expect(findForbiddenPublicKeys(bundle)).toEqual([]);
    expect(JSON.stringify(bundle)).not.toContain("leakhash");
  });

  it("findForbiddenPublicKeys catches nested leaks with their paths", () => {
    const leaky = { rooms: [{ ok: 1, email: "x@y.com" }], meta: { inner: { confirmTokenHash: "h", lastContentHash: "c" } } };
    const hits = findForbiddenPublicKeys(leaky);
    expect(hits).toContain("$.rooms[0].email");
    expect(hits).toContain("$.meta.inner.confirmTokenHash");
    expect(hits).toContain("$.meta.inner.lastContentHash");
    expect(findForbiddenPublicKeys({ safe: { counts: [1, 2, 3] } })).toEqual([]);
  });

  it("applyScanDiff: new/updated/demote/keep semantics", () => {
    const existing: PaperRecord[] = [
      { title: "Old paper", discipline: "Math", topic: "x", difficulty: "grad", status: "new", firstSeen: "Jul 1", evidenceRef: "e1", href: "/p/1" },
      { title: "Vanished paper", discipline: "Bio", topic: "y", difficulty: "grad", status: "tracked", firstSeen: "Jun 1", evidenceRef: "e2", href: "/p/2" },
    ];
    const { papers, newCount, updatedCount } = applyScanDiff(
      existing,
      [
        { title: "Old paper — revised", href: "/p/1" }, // same href, new title → updated
        { title: "Brand new paper", href: "/p/3" },
      ],
      "2026-07-05",
    );
    expect(newCount).toBe(1);
    expect(updatedCount).toBe(1);
    expect(papers[0]).toMatchObject({ title: "Brand new paper", status: "new", firstSeen: "2026-07-05", href: "/p/3" });
    expect(papers.find((p) => p.href === "/p/1")).toMatchObject({ title: "Old paper — revised", status: "updated" });
    // Papers that fell off the page are kept as tracked (pagination-safe), and old "new" flags demote.
    expect(papers.find((p) => p.href === "/p/2")).toMatchObject({ status: "tracked" });
  });

  it("applyScanDiff BOUND: never exceeds 500 tracked papers, new items first", () => {
    const existing: PaperRecord[] = Array.from({ length: MAX_TRACKED_PAPERS }, (_, i) => ({
      title: `Existing ${i}`, discipline: "d", topic: "t", difficulty: "x", status: "tracked" as const, firstSeen: "Jun", evidenceRef: "e", href: `/old/${i}`,
    }));
    const { papers, newCount } = applyScanDiff(existing, [{ title: "Newest arrival", href: "/new/0" }], "today");
    expect(papers).toHaveLength(MAX_TRACKED_PAPERS);
    expect(newCount).toBe(1);
    expect(papers[0].title).toBe("Newest arrival");
  });

  it("boundRunlog keeps the 60 newest entries, newest first", () => {
    const mk = (i: number): RunlogEntry => ({ at: `t${i}`, event: `e${i}`, meta: "", status: "ok", cost: "0.0 cr" });
    const existing = Array.from({ length: 59 }, (_, i) => mk(i));
    const bounded = boundRunlog(existing, [mk(100), mk(101)]);
    expect(bounded).toHaveLength(MAX_RUNLOG_ENTRIES);
    expect(bounded[0].at).toBe("t100");
    expect(bounded[1].at).toBe("t101");
    expect(bounded[2].at).toBe("t0");
  });

  it("planOutboxEnqueue dedupes and skips inactive subscribers honestly", () => {
    const rows = planOutboxEnqueue({
      roomSlug: "exp",
      briefKey: "b0704",
      subscribers: [
        { id: "s1", status: "active", cadence: "daily" },
        { id: "s1", status: "active", cadence: "daily" }, // in-batch duplicate
        { id: "s2", status: "pending", cadence: "daily" },
        { id: "s3", status: "active", cadence: "weekly" },
      ],
      existingKeys: new Set(["exp:b0704:s3:weekly"]), // s3 already enqueued by a prior run
    });
    expect(rows).toEqual([
      { subscriptionId: "s1", idempotencyKey: "exp:b0704:s1:daily", state: "pending_draft" },
      { subscriptionId: "s2", idempotencyKey: "exp:b0704:s2:daily", state: "skipped", error: "subscriber_not_active" },
    ]);
  });

  it("retryDecision allows exactly one retry", () => {
    const first = retryDecision("smtp_500");
    expect(first).toEqual({ allowed: true, nextError: `${RETRY_MARKER}smtp_500` });
    expect(retryDecision((first as { nextError: string }).nextError)).toEqual({ allowed: false, reason: "retry_exhausted" });
  });

  it("isRoomDue honors cadence with cron-drift tolerance", () => {
    const now = Date.now();
    expect(isRoomDue(undefined, "daily", now)).toBe(true);
    expect(isRoomDue(now - 60_000, "daily", now)).toBe(false);
    expect(isRoomDue(now - DAY_MS, "daily", now)).toBe(true);
    expect(isRoomDue(now - 6 * DAY_MS, "weekly", now)).toBe(false);
    expect(isRoomDue(now - 7 * DAY_MS, "weekly", now)).toBe(true);
  });

  it("estimateScanCredits is deterministic, zero when nothing changed, small when changed", () => {
    expect(estimateScanCredits({ changedSources: 0, itemsExtracted: 999 })).toBe(0);
    const a = estimateScanCredits({ changedSources: 1, itemsExtracted: 40 });
    expect(a).toBe(estimateScanCredits({ changedSources: 1, itemsExtracted: 40 }));
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(3); // stays under the flagship per-run cap
  });

  it("runStatusToRoomStatus maps completed→ok and passes failure statuses through", () => {
    expect(runStatusToRoomStatus("completed")).toBe("ok");
    expect(runStatusToRoomStatus("failed")).toBe("failed");
    expect(runStatusToRoomStatus("capped")).toBe("capped");
    expect(runStatusToRoomStatus("skipped")).toBe("skipped");
  });

  it("selectPrunableAlwaysOnRow: runs age out at 30d; outbox TERMINAL-only at 30d; subs pending 7d / unsubscribed 30d / active NEVER", () => {
    const now = Date.now();
    const days = (n: number) => n * DAY_MS;
    // Run receipts: age is the only criterion.
    expect(selectPrunableAlwaysOnRow({ table: "publicRoomRuns", creationTime: now - days(31) }, now)).toBe(true);
    expect(selectPrunableAlwaysOnRow({ table: "publicRoomRuns", creationTime: now - days(29) }, now)).toBe(false);
    // Outbox: terminal states prune past 30d; live states never, at any age.
    for (const state of ["sent", "skipped", "failed"]) {
      expect(selectPrunableAlwaysOnRow({ table: "publicRoomOutbox", creationTime: now - days(31), state }, now)).toBe(true);
      expect(selectPrunableAlwaysOnRow({ table: "publicRoomOutbox", creationTime: now - days(29), state }, now)).toBe(false);
    }
    for (const state of ["pending_draft", "draft_created", "approved"]) {
      expect(selectPrunableAlwaysOnRow({ table: "publicRoomOutbox", creationTime: now - days(400), state }, now)).toBe(false);
    }
    // Subscriptions: per-status windows; active is product data, never pruned.
    expect(selectPrunableAlwaysOnRow({ table: "publicRoomSubscriptions", creationTime: now - days(8), status: "pending" }, now)).toBe(true);
    expect(selectPrunableAlwaysOnRow({ table: "publicRoomSubscriptions", creationTime: now - days(6), status: "pending" }, now)).toBe(false);
    expect(selectPrunableAlwaysOnRow({ table: "publicRoomSubscriptions", creationTime: now - days(31), status: "unsubscribed" }, now)).toBe(true);
    expect(selectPrunableAlwaysOnRow({ table: "publicRoomSubscriptions", creationTime: now - days(29), status: "unsubscribed" }, now)).toBe(false);
    expect(selectPrunableAlwaysOnRow({ table: "publicRoomSubscriptions", creationTime: now - days(3650), status: "active" }, now)).toBe(false);
  });
});

// ─── Retention (convex/retention.ts pruneAlwaysOnRows) ─────────────────────
// convex-test forbids setting _creationTime, so aging is driven through the
// mutation's internal-only `now` override (the same seam style as
// pruneOldTelemetry's retentionDays) — rows are inserted fresh and the clock
// is moved forward instead.

describe("pruneAlwaysOnRows (retention)", () => {
  function insertRun(ctx: any, roomId: Id<"publicRooms">, status: "completed" | "failed") {
    const now = Date.now();
    return ctx.db.insert("publicRoomRuns", {
      publicRoomId: roomId,
      status,
      startedAt: now,
      completedAt: now,
      sourcesChecked: 1,
      changedSources: 0,
      itemsCreated: 0,
      itemsUpdated: 0,
      creditsUsed: 0,
    });
  }

  it("windows: 7d takes only stale pending subs; 31d takes runs + TERMINAL outbox + unsubscribed; active subs and live outbox survive", async () => {
    const { t, roomId } = await seeded();
    await t.run(async (ctx) => {
      const now = Date.now();
      const mkSub = (email: string, status: "pending" | "active" | "unsubscribed") =>
        ctx.db.insert("publicRoomSubscriptions", {
          publicRoomId: roomId,
          email,
          cadence: "daily" as const,
          status,
          confirmTokenHash: "c".repeat(64),
          unsubTokenHash: "u".repeat(64),
          createdAt: now,
          ...(status === "active" ? { confirmedAt: now } : {}),
        });
      const anchorSub = (await mkSub("keep-active@lab.org", "active")) as Id<"publicRoomSubscriptions">;
      await mkSub("stale-pending@lab.org", "pending");
      await mkSub("gone@lab.org", "unsubscribed");
      await insertRun(ctx, roomId, "completed");
      await insertRun(ctx, roomId, "failed");
      for (const state of ["sent", "skipped", "failed", "pending_draft", "draft_created", "approved"] as const) {
        await ctx.db.insert("publicRoomOutbox", {
          publicRoomId: roomId,
          subscriptionId: anchorSub,
          briefKey: "2026-07-04",
          subject: "s",
          markdownBody: "b",
          idempotencyKey: `retention:${state}`,
          state,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    // Fresh rows: nothing is prunable today.
    const today = await t.mutation(pruneAlwaysOnRef, {});
    expect(today.deleted).toEqual({
      publicRoomRuns: 0,
      publicRoomOutbox: 0,
      publicRoomSubscriptionsPending: 0,
      publicRoomSubscriptionsUnsubscribed: 0,
    });

    // +8 days: only the 7d never-confirmed-pending window fires.
    const at8d = await t.mutation(pruneAlwaysOnRef, { now: Date.now() + 8 * DAY_MS });
    expect(at8d.deleted).toEqual({
      publicRoomRuns: 0,
      publicRoomOutbox: 0,
      publicRoomSubscriptionsPending: 1,
      publicRoomSubscriptionsUnsubscribed: 0,
    });

    // +31 days: runs, terminal outbox, and unsubscribed go; the rest survive.
    const at31d = await t.mutation(pruneAlwaysOnRef, { now: Date.now() + 31 * DAY_MS });
    expect(at31d.deleted).toEqual({
      publicRoomRuns: 2,
      publicRoomOutbox: 3,
      publicRoomSubscriptionsPending: 0,
      publicRoomSubscriptionsUnsubscribed: 1,
    });
    await t.run(async (ctx) => {
      expect(await ctx.db.query("publicRoomRuns").collect()).toHaveLength(0);
      const outbox = await ctx.db.query("publicRoomOutbox").collect();
      expect(outbox.map((r) => r.state).sort()).toEqual(["approved", "draft_created", "pending_draft"]);
      const subs = await ctx.db.query("publicRoomSubscriptions").collect();
      expect(subs).toHaveLength(1);
      expect(subs[0].status).toBe("active"); // active is NEVER pruned
    });
  });

  it("BOUND: batchPerTable caps deletions per run and a backlog drains across runs", async () => {
    const { t, roomId } = await seeded();
    await t.run(async (ctx) => {
      for (let i = 0; i < 5; i++) await insertRun(ctx, roomId, "completed");
    });
    const later = Date.now() + 31 * DAY_MS;
    expect((await t.mutation(pruneAlwaysOnRef, { now: later, batchPerTable: 2 })).deleted.publicRoomRuns).toBe(2);
    expect((await t.mutation(pruneAlwaysOnRef, { now: later, batchPerTable: 2 })).deleted.publicRoomRuns).toBe(2);
    expect((await t.mutation(pruneAlwaysOnRef, { now: later, batchPerTable: 2 })).deleted.publicRoomRuns).toBe(1);
    await t.run(async (ctx) => {
      expect(await ctx.db.query("publicRoomRuns").collect()).toHaveLength(0);
    });
  });
});
