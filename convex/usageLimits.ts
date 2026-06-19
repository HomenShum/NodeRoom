import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";

const DEFAULT_ROOM_DAILY_USD_LIMIT = 3;
const DEFAULT_GLOBAL_MONTHLY_USD_LIMIT = 75;
const MAX_GLOBAL_SPEND_ROWS = 5_000;

export const roomUsageSnapshot = query({
  args: { roomId: v.id("rooms"), requester: actorProofV, now: v.optional(v.number()) },
  handler: async (ctx, { roomId, requester, now }) => {
    await requireActorProof(ctx, roomId, requester);
    const clock = now ?? Date.now();
    const daySince = clock - 24 * 60 * 60 * 1000;
    const runs = await ctx.db.query("agentRuns").withIndex("by_room", (q) => q.eq("roomId", roomId).gte("createdAt", daySince)).collect();
    const recentJobs = await ctx.db.query("agentJobs").withIndex("by_room", (q) => q.eq("roomId", roomId)).order("desc").take(100);
    const dailyCostUsd = runs.reduce((sum, run) => sum + (run.costUsd ?? 0), 0);
    return {
      policy: "usage_limits_v1",
      dailyCostUsd,
      dailyLimitUsd: DEFAULT_ROOM_DAILY_USD_LIMIT,
      dailyRemainingUsd: Math.max(0, DEFAULT_ROOM_DAILY_USD_LIMIT - dailyCostUsd),
      recentRunCount: runs.length,
      activeJobCount: recentJobs.filter((job) => ["queued", "running", "retrying"].includes(job.status)).length,
      clock,
    };
  },
});

export const assertRoomBudget = internalQuery({
  args: {
    roomId: v.id("rooms"),
    projectedUsd: v.number(),
    roomDailyLimitUsd: v.optional(v.number()),
    since: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const since = args.since ?? Date.now() - 24 * 60 * 60 * 1000;
    const limit = args.roomDailyLimitUsd ?? DEFAULT_ROOM_DAILY_USD_LIMIT;
    const rows = await ctx.db.query("agentRuns").withIndex("by_room", (q) => q.eq("roomId", args.roomId).gte("createdAt", since)).collect();
    const spent = rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
    return {
      ok: spent + args.projectedUsd <= limit,
      spent,
      projectedUsd: args.projectedUsd,
      limit,
      remaining: Math.max(0, limit - spent),
    };
  },
});

export const globalMonthlySnapshot = internalQuery({
  args: { since: v.optional(v.number()), monthlyLimitUsd: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const since = args.since ?? Date.now() - 30 * 24 * 60 * 60 * 1000;
    const limit = args.monthlyLimitUsd ?? DEFAULT_GLOBAL_MONTHLY_USD_LIMIT;
    const rows = await ctx.db.query("agentRuns")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
      .order("desc")
      .take(MAX_GLOBAL_SPEND_ROWS);
    const totalUsd = rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
    return {
      totalUsd,
      limit,
      ok: totalUsd <= limit && rows.length < MAX_GLOBAL_SPEND_ROWS,
      runCount: rows.length,
      distinctRooms: new Set(rows.map((row) => String(row.roomId))).size,
      truncated: rows.length === MAX_GLOBAL_SPEND_ROWS,
    };
  },
});
