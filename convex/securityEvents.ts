import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { actorProofV, actorV, requireActorProof } from "./lib";

const severityV = v.union(v.literal("info"), v.literal("warn"), v.literal("high"), v.literal("critical"));
const categoryV = v.union(
  v.literal("auth"),
  v.literal("authz"),
  v.literal("privacy"),
  v.literal("provider_egress"),
  v.literal("prompt_injection"),
  v.literal("rate_limit"),
  v.literal("retention"),
  v.literal("audit"),
);

export const record = internalMutation({
  args: {
    roomId: v.id("rooms"),
    actor: actorV,
    category: categoryV,
    severity: severityV,
    event: v.string(),
    reason: v.optional(v.string()),
    metadata: v.optional(v.any()),
    ts: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const ts = args.ts ?? Date.now();
    const summary = `${args.severity}:${args.category}:${args.event}`;
    return ctx.db.insert("traces", {
      roomId: args.roomId,
      ts,
      actor: args.actor,
      type: `security:${args.category}`,
      summary,
      detail: JSON.stringify({
        category: args.category,
        severity: args.severity,
        event: args.event,
        reason: args.reason,
        metadata: args.metadata,
      }),
    });
  },
});

export const list = query({
  args: { roomId: v.id("rooms"), requester: actorProofV, limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, requester, limit }) => {
    await requireActorProof(ctx, roomId, requester);
    const take = Math.min(Math.max(1, Math.floor(limit ?? 50)), 100);
    const rows = await ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(take * 3);
    return rows
      .filter((row) => row.type.startsWith("security:"))
      .slice(0, take)
      .map((row) => ({
        id: row._id,
        ts: row.ts,
        actor: row.actor,
        type: row.type,
        summary: row.summary,
        detail: row.detail,
      }));
  },
});
