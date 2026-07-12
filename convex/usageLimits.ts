import { v } from "convex/values";
import { internalQuery, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";
import { DEFAULT_BUDGET_CAPS } from "../src/nodeagent/core/creditModel";
import type { LaunchUsageSnapshot } from "../src/launch/budgetPolicy";

const MAX_GLOBAL_SPEND_ROWS = 5_000;
const MAX_ROOM_SPEND_ROWS = 2_000;
const MAX_USER_SPEND_ROWS = 2_000;
const MAX_ACTIVE_RESERVATIONS = 2_000;
const ACTIVE_STATUSES = ["queued", "running", "retrying"] as const;

type AdmissionSnapshotArgs = {
  roomId: any;
  requesterId: string;
  now?: number;
  excludeJobId?: any;
};

export async function collectLaunchUsageSnapshot(ctx: { db: any }, args: AdmissionSnapshotArgs): Promise<LaunchUsageSnapshot> {
  const clock = args.now ?? Date.now();
  const daySince = clock - 24 * 60 * 60 * 1000;
  const monthSince = clock - 30 * 24 * 60 * 60 * 1000;
  const roomRuns = await ctx.db.query("agentRuns")
    .withIndex("by_room", (q: any) => q.eq("roomId", args.roomId).gte("createdAt", monthSince))
    .order("desc")
    .take(MAX_ROOM_SPEND_ROWS);
  const userRuns = await ctx.db.query("agentRuns")
    .withIndex("by_requester", (q: any) => q.eq("requesterId", args.requesterId).gte("createdAt", daySince))
    .order("desc")
    .take(MAX_USER_SPEND_ROWS);
  const globalRuns = await ctx.db.query("agentRuns")
    .withIndex("by_creation_time", (q: any) => q.gte("_creationTime", monthSince))
    .order("desc")
    .take(MAX_GLOBAL_SPEND_ROWS);
  const globalReservations = await ctx.db.query("creditReservations")
    .withIndex("by_status_createdAt", (q: any) => q.eq("status", "active"))
    .take(MAX_ACTIVE_RESERVATIONS + 1);
  const roomReservations = await ctx.db.query("creditReservations")
    .withIndex("by_room_status_createdAt", (q: any) => q.eq("roomId", args.roomId).eq("status", "active"))
    .take(MAX_ACTIVE_RESERVATIONS + 1);
  const userReservations = await ctx.db.query("creditReservations")
    .withIndex("by_requester_status_createdAt", (q: any) => q.eq("requesterId", args.requesterId).eq("status", "active"))
    .take(MAX_ACTIVE_RESERVATIONS + 1);
  const exclude = args.excludeJobId ? String(args.excludeJobId) : undefined;

  const activeGlobalJobs: any[] = [];
  let globalConcurrencyTruncated = false;
  for (const status of ACTIVE_STATUSES) {
    const rows = await ctx.db.query("agentJobs")
      .withIndex("by_status_nextRunAt", (q: any) => q.eq("status", status))
      .take(DEFAULT_BUDGET_CAPS.concurrentForegroundJobsGlobal + 1);
    activeGlobalJobs.push(...rows.filter((job: any) => !exclude || String(job._id) !== exclude));
    if (rows.length > DEFAULT_BUDGET_CAPS.concurrentForegroundJobsGlobal) globalConcurrencyTruncated = true;
  }
  const activeRoomJobs = activeGlobalJobs.filter((job: any) => String(job.roomId) === String(args.roomId));
  const includeReservation = (reservation: any) => (!exclude || !reservation.jobId || String(reservation.jobId) !== exclude);
  const pendingGlobal = globalReservations.filter(includeReservation);
  const pendingRoom = roomReservations.filter(includeReservation);
  const pendingUser = userReservations.filter(includeReservation);
  const directGlobal = pendingGlobal.filter((reservation: any) => !reservation.jobId);
  const directRoom = pendingRoom.filter((reservation: any) => !reservation.jobId);

  const truncated = roomRuns.length === MAX_ROOM_SPEND_ROWS
    || userRuns.length === MAX_USER_SPEND_ROWS
    || globalRuns.length === MAX_GLOBAL_SPEND_ROWS
    || globalReservations.length > MAX_ACTIVE_RESERVATIONS
    || roomReservations.length > MAX_ACTIVE_RESERVATIONS
    || userReservations.length > MAX_ACTIVE_RESERVATIONS
    || globalConcurrencyTruncated;
  const sum = (rows: Array<{ costUsd?: number }>) => rows.reduce((total, row) => total + (row.costUsd ?? 0), 0);
  const sumPending = (rows: Array<{ projectedUsd?: number }>) => rows.reduce((total, row) => total + Math.max(0, row.projectedUsd ?? 0), 0);
  return {
    roomDailyUsd: sum(roomRuns.filter((run: any) => run.createdAt >= daySince)) + sumPending(pendingRoom),
    roomMonthlyUsd: sum(roomRuns) + sumPending(pendingRoom),
    userDailyUsd: sum(userRuns) + sumPending(pendingUser),
    globalMonthlyUsd: sum(globalRuns) + sumPending(pendingGlobal),
    activeForegroundJobsGlobal: activeGlobalJobs.length + directGlobal.length,
    activeForegroundJobsRoom: activeRoomJobs.length + directRoom.length,
    activeDeepJobsRoom: activeRoomJobs.filter((job: any) => job.mode === "research" || job.runtimeProfile === "benchmark_completion").length
      + directRoom.filter((reservation: any) => reservation.mode === "deep").length,
    truncated,
  };
}

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
      dailyLimitUsd: DEFAULT_BUDGET_CAPS.perRoomDailyUsd,
      dailyRemainingUsd: Math.max(0, DEFAULT_BUDGET_CAPS.perRoomDailyUsd - dailyCostUsd),
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
    const limit = args.roomDailyLimitUsd ?? DEFAULT_BUDGET_CAPS.perRoomDailyUsd;
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
    const limit = args.monthlyLimitUsd ?? DEFAULT_BUDGET_CAPS.globalMonthlyUsd;
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

export const launchAdmissionSnapshot = internalQuery({
  args: {
    roomId: v.id("rooms"),
    requesterId: v.string(),
    now: v.optional(v.number()),
    excludeJobId: v.optional(v.id("agentJobs")),
  },
  handler: (ctx, args) => collectLaunchUsageSnapshot(ctx, args),
});
