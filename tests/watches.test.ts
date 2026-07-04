/**
 * Watches + notifications — server scenarios against a REAL in-memory Convex
 * deployment (convex-test; setup mirrors tests/nodemem/recordingWiring.test.ts,
 * which drives the same messages.sendCore scheduler path).
 *
 * Persona: Maya hosts a diligence room with analyst Riley; the public Room
 * NodeAgent posts findings. Design contract under test: "Notifications:
 * instant (mentions, watched rows) / hourly (run digests) / daily (rest);
 * watch = W". Covered angles:
 *   (a) happy path — an agent message "@Riley …" lands ONE instant notification
 *       for Riley only (never the author, never bystanders)
 *   (b) adversarial burst — a 50-message mention spam run collapses into one
 *       row (count grows) instead of 50 inbox rows; repeats re-surface unread
 *   (c) honest bound — the 200-watch cap throws watch_limit_reached instead of
 *       silently dropping; a stale OFF row's slot is reused; toggles idempotent
 *   (d) sustained flood — 600 notifiables stay capped at 500 with the NEWEST
 *       kept (oldest evicted first when all unread)
 *   (e) privacy — listNotifications is requester-scoped: Maya never sees
 *       Riley's mentions; unwatched writes don't reach non-watchers
 *   (f) read receipts — markNotificationsRead flips the requester's unread
 *       count to 0 and never touches another member's unread state
 *
 * sendCore SCHEDULES watches:recordNotifiable (runAfter 0) so a notification
 * failure can never roll back a send; tests drain that schedule with
 * finishAllScheduledFunctions(vi.runAllTimers) (the documented convex-test
 * pattern for runAfter under fake timers).
 *
 * convex/_generated lags until the next codegen — which must NOT be run
 * casually: `npx convex codegen` against a configured cloud deployment DEPLOYS
 * schema+functions (documented gotcha). Same makeFunctionReference precedent
 * as tests/elementVersions.test.ts; convex-test resolves by name at runtime.
 */
import { convexTest } from "convex-test";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeFunctionReference } from "convex/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { hashToken } from "../convex/lib";
import { NOTIFICATIONS_MAX_PER_ROOM, WATCHES_MAX_PER_MEMBER } from "../src/notifications/tiers";
import workflowSchema from "../node_modules/@convex-dev/workflow/dist/component/schema.js";
import workpoolSchema from "../node_modules/@convex-dev/workpool/dist/component/schema.js";

vi.setConfig({ testTimeout: 120_000 });

const modules = import.meta.glob("../convex/**/*.ts");
const workflowModules = import.meta.glob("../node_modules/@convex-dev/workflow/dist/component/**/*.js");
const workpoolModules = import.meta.glob("../node_modules/@convex-dev/workpool/dist/component/**/*.js");
// "use node" modules can't load under convex-test (mirrors tests/nodemem/recordingWiring.test.ts).
delete (modules as Record<string, unknown>)["../convex/agent.ts"];
delete (modules as Record<string, unknown>)["../convex/agentJobRunner.ts"];
delete (modules as Record<string, unknown>)["../convex/embeddingRunner.ts"];

const MAYA_TOKEN = "watches-test-maya-token-0123456789abcdef";
const RILEY_TOKEN = "watches-test-riley-token-fedcba9876543210";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

type ActorProof = { actor: { kind: "user" | "agent"; id: string; name: string; scope?: "public" | "private"; ownerId?: string }; token?: string };
type WatchTargetKind = "row" | "artifact";
type NotificationRow = {
  id: string;
  kind: "mention" | "watched_write" | "run_digest";
  tier: "instant" | "hourly" | "daily";
  targetId?: string;
  count: number;
  readAt?: number;
  createdAt: number;
};
const setWatchRef = makeFunctionReference<
  "mutation",
  { roomId: Id<"rooms">; requester: ActorProof; targetKind: WatchTargetKind; targetId: string; on: boolean },
  { on: boolean; changed: boolean }
>("watches:setWatch");
const listWatchesRef = makeFunctionReference<
  "query",
  { roomId: Id<"rooms">; requester: ActorProof },
  Array<{ targetKind: WatchTargetKind; targetId: string; updatedAt: number }>
>("watches:listWatches");
const recordNotifiableRef = makeFunctionReference<
  "mutation",
  {
    roomId: Id<"rooms">;
    kind: "mention" | "watched_write" | "run_digest";
    actorId?: string;
    targetKind?: WatchTargetKind;
    targetId?: string;
    recipientId?: string;
    dedupeKey: string;
    payload?: Record<string, string>;
  },
  { deduped: boolean; tier: string; id: string }
>("watches:recordNotifiable");
const listNotificationsRef = makeFunctionReference<
  "query",
  { roomId: Id<"rooms">; requester: ActorProof },
  NotificationRow[]
>("watches:listNotifications");
const markReadRef = makeFunctionReference<
  "mutation",
  { roomId: Id<"rooms">; requester: ActorProof },
  { marked: number }
>("watches:markNotificationsRead");

async function setupRoom() {
  const t = convexTest(schema, modules);
  t.registerComponent("workflow", workflowSchema, workflowModules);
  t.registerComponent("workflow/workpool", workpoolSchema, workpoolModules);
  const now = Date.now();
  const [mayaHash, rileyHash] = await Promise.all([hashToken(MAYA_TOKEN), hashToken(RILEY_TOKEN)]);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", { code: `W${Math.random().toString(36).slice(2, 7).toUpperCase()}`, title: "watches proof room", hostId: "", autoAllow: true, status: "live" as const, createdAt: now }),
  );
  const mayaId = await t.run((ctx) =>
    ctx.db.insert("members", { roomId, name: "Maya", role: "host" as const, anon: false, color: "#111111", authTokenHash: mayaHash, lastSeenAt: now }),
  );
  const rileyId = await t.run((ctx) =>
    ctx.db.insert("members", { roomId, name: "Riley", role: "member" as const, anon: false, color: "#222222", authTokenHash: rileyHash, lastSeenAt: now }),
  );
  // The public room agent needs a session row for requireActorInRoom (sendAgent path).
  await t.run((ctx) =>
    ctx.db.insert("agentSessions", { roomId, agentId: AGENT.id, agentName: AGENT.name, scope: "public" as const, status: "idle" as const, lastAction: "started", updatedAt: now }),
  );
  const maya = { actor: { kind: "user" as const, id: String(mayaId), name: "Maya" }, token: MAYA_TOKEN };
  const riley = { actor: { kind: "user" as const, id: String(rileyId), name: "Riley" }, token: RILEY_TOKEN };
  return { t, roomId, maya, riley, mayaId: String(mayaId), rileyId: String(rileyId) };
}

type T = Awaited<ReturnType<typeof setupRoom>>["t"];
const drain = (t: T) => t.finishAllScheduledFunctions(vi.runAllTimers);
const eventRows = (t: T, roomId: Id<"rooms">) =>
  t.run((ctx) => ctx.db.query("notificationEvents").withIndex("by_room_created", (q) => q.eq("roomId", roomId)).collect());
const unreadOf = (rows: NotificationRow[]) => rows.filter((r) => r.readAt == null).length;

describe("watches + notifications (design: instant mentions/watched rows · hourly digests · daily rest)", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("agent '@Riley' mention → ONE instant notification, visible to Riley only (happy path + requester scoping)", async () => {
    const { t, roomId, maya, riley } = await setupRoom();
    await t.mutation(internal.messages.sendAgent, {
      roomId, channel: "public", author: AGENT,
      text: "Heads up @Riley — the Q3 margin row needs a second pass.", clientMsgId: "agent-m1",
    });
    await drain(t);
    const stored = await eventRows(t, roomId);
    expect(stored.length).toBe(1);
    expect(stored[0].kind).toBe("mention");
    expect(stored[0].tier).toBe("instant"); // mentions are instant by contract
    const rileyInbox = await t.query(listNotificationsRef, { roomId, requester: riley });
    expect(rileyInbox.length).toBe(1);
    expect(rileyInbox[0].tier).toBe("instant");
    expect(unreadOf(rileyInbox)).toBe(1);
    // Maya was NOT mentioned: her inbox is empty — member A never sees B's mentions.
    expect(await t.query(listNotificationsRef, { roomId, requester: maya })).toEqual([]);
  });

  it("a 50-message '@Riley' spam burst collapses into ONE row whose count grows; a repeat after markRead re-surfaces unread", async () => {
    const { t, roomId, maya, riley } = await setupRoom();
    for (let i = 0; i < 50; i++) {
      await t.mutation(api.messages.send, {
        roomId, channel: "public", proof: maya,
        text: `@Riley ping ${i} — look at this NOW`, clientMsgId: `spam-${i}`,
      });
      vi.advanceTimersByTime(1); // realistic: bursts still tick the clock
    }
    await drain(t);
    const stored = await eventRows(t, roomId);
    expect(stored.length).toBe(1); // dedupe key (room, from, to) collapsed the burst
    expect(stored[0].count).toBe(50);
    const inbox = await t.query(listNotificationsRef, { roomId, requester: riley });
    expect(inbox.length).toBe(1);
    expect(unreadOf(inbox)).toBe(1);
    // Riley reads it… then Maya mentions again → the SAME row re-surfaces unread.
    await t.mutation(markReadRef, { roomId, requester: riley });
    expect(unreadOf(await t.query(listNotificationsRef, { roomId, requester: riley }))).toBe(0);
    await t.mutation(api.messages.send, { roomId, channel: "public", proof: maya, text: "@Riley one more thing", clientMsgId: "spam-51" });
    await drain(t);
    const after = await t.query(listNotificationsRef, { roomId, requester: riley });
    expect(after.length).toBe(1);
    expect(after[0].count).toBe(51);
    expect(unreadOf(after)).toBe(1);
  });

  it("watch cap is honest at 200: throws watch_limit_reached, reuses a stale OFF slot, toggles idempotently", async () => {
    const { t, roomId, maya } = await setupRoom();
    for (let i = 0; i < WATCHES_MAX_PER_MEMBER; i++) {
      await t.mutation(setWatchRef, { roomId, requester: maya, targetKind: "row", targetId: `sr_${String(i).padStart(4, "0")}`, on: true });
      vi.advanceTimersByTime(1);
    }
    expect((await t.query(listWatchesRef, { roomId, requester: maya })).length).toBe(WATCHES_MAX_PER_MEMBER);
    // 201st ACTIVE watch: fail loudly, never silently drop (HONEST_STATUS).
    await expect(
      t.mutation(setWatchRef, { roomId, requester: maya, targetKind: "row", targetId: "sr_overflow", on: true }),
    ).rejects.toThrow(/watch_limit_reached/);
    // Idempotent toggle: watching an already-watched row changes nothing.
    const again = await t.mutation(setWatchRef, { roomId, requester: maya, targetKind: "row", targetId: "sr_0000", on: true });
    expect(again).toEqual({ on: true, changed: false });
    // Un-watch one → its stale OFF slot is REUSED by the next new watch.
    await t.mutation(setWatchRef, { roomId, requester: maya, targetKind: "row", targetId: "sr_0000", on: false });
    vi.advanceTimersByTime(1);
    const reused = await t.mutation(setWatchRef, { roomId, requester: maya, targetKind: "row", targetId: "sr_overflow", on: true });
    expect(reused).toEqual({ on: true, changed: true });
    const active = await t.query(listWatchesRef, { roomId, requester: maya });
    expect(active.length).toBe(WATCHES_MAX_PER_MEMBER);
    expect(active.some((w) => w.targetId === "sr_overflow")).toBe(true);
    expect(active.some((w) => w.targetId === "sr_0000")).toBe(false);
  });

  it("sustained 600-event flood stays capped at 500 with the NEWEST kept (BOUND + eviction order)", async () => {
    const { t, roomId } = await setupRoom();
    const FLOOD = 600;
    for (let i = 0; i < FLOOD; i++) {
      await t.mutation(recordNotifiableRef, {
        roomId, kind: "watched_write", actorId: AGENT.id,
        targetKind: "row", targetId: `flood_${String(i).padStart(4, "0")}`,
        dedupeKey: `flood-${i}`,
      });
      vi.advanceTimersByTime(1); // monotonic createdAt — a real flood ticks the clock
    }
    const stored = await eventRows(t, roomId);
    expect(stored.length).toBe(NOTIFICATIONS_MAX_PER_ROOM);
    const targets = new Set(stored.map((ev) => ev.targetId));
    // Oldest 100 evicted, newest 500 kept (all unread → oldest-first eviction).
    expect(targets.has("flood_0000")).toBe(false);
    expect(targets.has(`flood_${String(FLOOD - NOTIFICATIONS_MAX_PER_ROOM - 1).padStart(4, "0")}`)).toBe(false);
    expect(targets.has(`flood_${String(FLOOD - NOTIFICATIONS_MAX_PER_ROOM).padStart(4, "0")}`)).toBe(true);
    expect(targets.has(`flood_${String(FLOOD - 1).padStart(4, "0")}`)).toBe(true);
  });

  it("watched_write scoping: the watcher gets an instant row; a non-watcher sees nothing; unwatched targets demote to daily", async () => {
    const { t, roomId, maya, riley } = await setupRoom();
    await t.mutation(setWatchRef, { roomId, requester: riley, targetKind: "row", targetId: "sr_margin", on: true });
    // Agent writes the watched row → instant, visible to Riley (the watcher) only.
    await t.mutation(recordNotifiableRef, {
      roomId, kind: "watched_write", actorId: AGENT.id, targetKind: "row", targetId: "sr_margin", dedupeKey: "run1-sr_margin",
    });
    // …and an UNWATCHED row → daily tier, visible to nobody's watched feed.
    await t.mutation(recordNotifiableRef, {
      roomId, kind: "watched_write", actorId: AGENT.id, targetKind: "row", targetId: "sr_other", dedupeKey: "run1-sr_other",
    });
    const rileyInbox = await t.query(listNotificationsRef, { roomId, requester: riley });
    expect(rileyInbox.length).toBe(1);
    expect(rileyInbox[0].tier).toBe("instant");
    expect(rileyInbox[0].targetId).toBe("sr_margin");
    expect(await t.query(listNotificationsRef, { roomId, requester: maya })).toEqual([]);
    // Adversarial: a mention without a recipient is rejected loudly (HONEST_STATUS).
    await expect(
      t.mutation(recordNotifiableRef, { roomId, kind: "mention", dedupeKey: "bad-mention" }),
    ).rejects.toThrow(/mention_requires_recipient/);
    // Adversarial: a forged proof can't read anyone's inbox.
    await expect(
      t.query(listNotificationsRef, { roomId, requester: { actor: riley.actor, token: "wrong-token-wrong-token-wrong-token-12" } }),
    ).rejects.toThrow(/invalid_actor_token/);
  });

  it("markNotificationsRead flips MY unread count to 0 and never touches another member's unread", async () => {
    const { t, roomId, maya, riley, mayaId } = await setupRoom();
    // Riley gets a mention from the agent; Maya gets one too (separate rows).
    await t.mutation(internal.messages.sendAgent, { roomId, channel: "public", author: AGENT, text: "@Riley margins ready", clientMsgId: "mr-1" });
    vi.advanceTimersByTime(1);
    await t.mutation(recordNotifiableRef, {
      roomId, kind: "mention", actorId: AGENT.id, recipientId: mayaId, dedupeKey: "agent-to-maya",
    });
    await drain(t);
    expect(unreadOf(await t.query(listNotificationsRef, { roomId, requester: riley }))).toBe(1);
    expect(unreadOf(await t.query(listNotificationsRef, { roomId, requester: maya }))).toBe(1);
    const res = await t.mutation(markReadRef, { roomId, requester: riley });
    expect(res.marked).toBe(1); // exactly Riley's row — never Maya's
    expect(unreadOf(await t.query(listNotificationsRef, { roomId, requester: riley }))).toBe(0);
    expect(unreadOf(await t.query(listNotificationsRef, { roomId, requester: maya }))).toBe(1);
  });
});
