/** Awareness + agent sessions + traces — the "what else is happening" the agent
 * (and the UI) reads before acting. awareness() is the query buildContext() pulls. */
import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";

/** Awareness recency window — how many recent traces the agent's existing context surfaces. Default 6
 *  (historical). The "cheap alternative" to NodeMem raises this; it recovers moderate long-tail recall
 *  but does NOT scale — raw recency dumping grows the prompt linearly AND is recency- not relevance-
 *  ordered, so a relevant-but-old fact buried under newer noise still falls out. */
function awarenessWindow(): number {
  const n = Number(process.env.AWARENESS_WINDOW ?? 6);
  return Number.isFinite(n) ? Math.max(1, Math.min(200, Math.floor(n))) : 6;
}

export const awareness = internalQuery({
  args: { roomId: v.id("rooms"), excludeAgentId: v.optional(v.string()) },
  handler: async (ctx, { roomId, excludeAgentId }) => {
    const locks = await ctx.db.query("locks").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "active")).collect();
    const sessions = await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect();
    const traces = await ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(awarenessWindow());
    const room = await ctx.db.get(roomId);
    return {
      activeLocks: locks.filter((l) => l.holder.id !== excludeAgentId).map((l) => ({ lockId: l._id, elementIds: l.elementIds, holder: l.holder.name, reason: l.reason })),
      agents: sessions.filter((s) => s.agentId !== excludeAgentId).map((s) => ({ name: s.agentName, scope: s.scope, status: s.status })),
      recentTrace: traces.reverse().map((t) => `${t.type}: ${t.summary}`),
      // Surfaced so the agent's context can explain REVIEW MODE — without it the model reads
      // pendingApproval tool results as failures (live 0/3 incident: budget-burn or wander-and-quit).
      autoAllow: room?.autoAllow,
    };
  },
});

export const startSession = internalMutation({
  args: { roomId: v.id("rooms"), agentId: v.string(), agentName: v.string(), scope: v.union(v.literal("public"), v.literal("private")), ownerId: v.optional(v.string()) },
  handler: (ctx, a) => ctx.db.insert("agentSessions", { roomId: a.roomId, agentId: a.agentId, agentName: a.agentName, scope: a.scope, ownerId: a.ownerId, status: "idle", lastAction: "started", updatedAt: Date.now() }),
});

/** Ensure (upsert) the PUBLIC-acting personal agent session for a member, so their agent can act in the
 * shared room (edit the sheet, post public chat) attributed to them. Returns the session id. */
export const ensurePersonalPublicSession = internalMutation({
  args: { roomId: v.id("rooms"), ownerId: v.string() },
  handler: async (ctx, a) => {
    const sessions = await ctx.db.query("agentSessions").withIndex("by_room", (q) => q.eq("roomId", a.roomId)).collect();
    const found = sessions.find((s) => s.agentId === "agent_priv" && s.scope === "public" && s.ownerId === a.ownerId);
    if (found) return found._id;
    return ctx.db.insert("agentSessions", { roomId: a.roomId, agentId: "agent_priv", agentName: "Your NodeAgent", scope: "public", ownerId: a.ownerId, status: "idle", lastAction: "started", updatedAt: Date.now() });
  },
});

export const updateSession = internalMutation({
  args: { sessionId: v.id("agentSessions"), status: v.optional(v.union(v.literal("idle"), v.literal("working"), v.literal("blocked"), v.literal("drafting"), v.literal("done"))), heldLockId: v.optional(v.string()), lastAction: v.optional(v.string()) },
  handler: async (ctx, { sessionId, ...patch }) => { await ctx.db.patch(sessionId, { ...patch, updatedAt: Date.now() }); },
});

// Bound the UI trace feed to a recent window (B2). A trace is appended on EVERY edit, so an unbounded
// .collect() re-ships the whole room history to every subscriber on each new row. The UI only renders
// recent traces (Signal Tape <=60, TraceStrip <=40); full history stays durable for audit/export.
// TODO(load-older): cursor pagination (usePaginatedQuery) for scroll-back beyond this window.
const TRACE_FEED_WINDOW = 400;

export const traces = query({
  args: { roomId: v.id("rooms"), requester: actorProofV },
  handler: async (ctx, { roomId, requester }) => {
    await requireActorProof(ctx, roomId, requester);
    const recent = await ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(TRACE_FEED_WINDOW);
    return recent.reverse();
  },
});
