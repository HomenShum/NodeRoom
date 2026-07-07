// @vitest-environment edge-runtime
/**
 * RUNTIME proof for B2 — the reactive history feeds (collab.traces, messages.list) are bounded to a
 * recent window so a new row does NOT re-ship the whole O(H) history to every subscriber. Real Convex
 * queries against an in-memory deployment (convex-test), no deploy.
 *
 * Invariants proven: (1) the window is a CEILING — a big room returns only the most-recent N;
 * (2) the window is NOT a floor — a small room returns whole; (3) results stay ASCENDING (oldest→newest)
 * so the UI's tail-slicing (Signal Tape, TraceStrip) is unaffected; (4) the durable history is intact —
 * the window only bounds the reactive READ, not the stored data.
 */
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"]; // "use node" action — not needed here

// Strong auth token (>=32 chars, >=12 distinct, no whitespace) per requireStrongAuthToken.
const TOK = "feed-token-abcdefghij0123456789-XYZ";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

async function seed(t: ReturnType<typeof convexTest>, traceCount: number, msgCount: number) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", { code: "FEED01", title: "Feed", hostId: "pending", autoAllow: true, status: "live" as const, createdAt: now });
    const memberId = await ctx.db.insert("members", { roomId, name: "Homen", role: "host" as const, anon: false, color: "#d97757", authTokenHash: await hashToken(TOK), lastSeenAt: now });
    await ctx.db.patch(roomId, { hostId: String(memberId) });
    for (let i = 1; i <= traceCount; i++) {
      await ctx.db.insert("traces", { roomId, ts: i, actor: AGENT, type: "edit_applied", summary: `t${i}` });
    }
    for (let i = 1; i <= msgCount; i++) {
      await ctx.db.insert("messages", { roomId, channel: "public", author: AGENT, text: `m${i}`, clientMsgId: `c${i}`, kind: "chat" as const, createdAt: i });
    }
    return { roomId, memberId };
  });
}

const proof = (memberId: string) => ({ actor: { kind: "user" as const, id: String(memberId), name: "Homen" }, token: TOK });

test("B2: collab.traces returns ONLY the most-recent 400, ascending — not the whole 450-row history", async () => {
  const t = convexTest(schema, modules);
  const { roomId, memberId } = await seed(t, 450, 0);

  const traces = await t.query(api.collab.traces, { roomId, requester: proof(memberId) });
  expect(traces.length).toBe(400); // bounded ceiling, not 450
  expect(traces[0].summary).toBe("t51"); // oldest IN the window = 450 - 400 + 1
  expect(traces[traces.length - 1].summary).toBe("t450"); // newest
  for (let i = 1; i < traces.length; i++) expect(traces[i].ts).toBeGreaterThan(traces[i - 1].ts); // ascending

  // The window bounds only the reactive READ — the durable history is fully intact.
  const stored = await t.run((ctx) => ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect());
  expect(stored.length).toBe(450);
});

test("B2: a small room is returned whole — the window is a ceiling, not a floor", async () => {
  const t = convexTest(schema, modules);
  const { roomId, memberId } = await seed(t, 12, 0);

  const traces = await t.query(api.collab.traces, { roomId, requester: proof(memberId) });
  expect(traces.length).toBe(12);
  expect(traces[0].summary).toBe("t1");
  expect(traces[11].summary).toBe("t12");
});

test("B2: messages.list returns ONLY the most-recent 500, ascending — not the whole 520-message channel", async () => {
  const t = convexTest(schema, modules);
  const { roomId, memberId } = await seed(t, 0, 520);

  const msgs = await t.query(api.messages.list, { roomId, channel: "public", requester: proof(memberId) });
  expect(msgs.length).toBe(500); // bounded ceiling
  expect(msgs[0].text).toBe("m21"); // 520 - 500 + 1
  expect(msgs[msgs.length - 1].text).toBe("m520");
  for (let i = 1; i < msgs.length; i++) expect(msgs[i].createdAt).toBeGreaterThan(msgs[i - 1].createdAt); // ascending
});
