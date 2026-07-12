// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
for (const moduleName of [
  "../convex/agent.ts",
  "../convex/agentJobRunner.ts",
  "../convex/agentWorkflows.ts",
  "../convex/embeddingRunner.ts",
  "../convex/capturesNode.ts",
]) delete (modules as Record<string, unknown>)[moduleName];

describe("launch usage commitments", () => {
  it("counts unresolved reservations in spend caps without double-counting job concurrency", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const seeded = await t.run(async (ctx) => {
      const roomId = await ctx.db.insert("rooms", {
        code: "USAGE1",
        title: "Usage room",
        hostId: "host-1",
        autoAllow: true,
        status: "live",
        createdAt: now,
      });
      const otherRoomId = await ctx.db.insert("rooms", {
        code: "USAGE2",
        title: "Other usage room",
        hostId: "host-2",
        autoAllow: true,
        status: "live",
        createdAt: now,
      });
      const artifactId = await ctx.db.insert("artifacts", {
        roomId,
        kind: "sheet",
        title: "Usage sheet",
        version: 1,
        order: [],
        updatedAt: now,
      });
      const jobId = await ctx.db.insert("agentJobs", {
        roomId,
        artifactId,
        requester: { kind: "user", id: "user-1", name: "Pilot" },
        goal: "Queued work",
        status: "queued",
        modelPolicy: "test-model",
        attempts: 0,
        maxAttempts: 2,
        nextRunAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const insertReservation = (value: Record<string, unknown>) => ctx.db.insert("creditReservations", {
        mode: "quick",
        heldCredits: 1,
        status: "active",
        createdAt: now,
        expiresAt: now + 60_000,
        ...value,
      } as any);
      await insertReservation({ roomId, requesterId: "user-1", reservationKey: "direct-1", projectedUsd: 3 });
      await insertReservation({ roomId, requesterId: "user-1", reservationKey: "job-1", projectedUsd: 0.75, jobId });
      await insertReservation({ roomId: otherRoomId, requesterId: "user-2", reservationKey: "direct-2", projectedUsd: 0.75 });
      await ctx.db.insert("creditReservations", {
        roomId,
        requesterId: "user-1",
        reservationKey: "resolved",
        mode: "quick",
        projectedUsd: 50,
        heldCredits: 1,
        status: "resolved",
        resolution: "settled",
        actualUsd: 0.1,
        createdAt: now,
        expiresAt: now + 60_000,
        resolvedAt: now,
      });
      return { roomId, jobId };
    });

    const snapshot = await t.query(internal.usageLimits.launchAdmissionSnapshot, {
      roomId: seeded.roomId,
      requesterId: "user-1",
    });
    expect(snapshot).toMatchObject({
      roomDailyUsd: 3.75,
      roomMonthlyUsd: 3.75,
      userDailyUsd: 3.75,
      globalMonthlyUsd: 4.5,
      activeForegroundJobsGlobal: 3,
      activeForegroundJobsRoom: 2,
      activeDeepJobsRoom: 0,
      truncated: false,
    });

    const excludingJob = await t.query(internal.usageLimits.launchAdmissionSnapshot, {
      roomId: seeded.roomId,
      requesterId: "user-1",
      excludeJobId: seeded.jobId,
    });
    expect(excludingJob.roomDailyUsd).toBe(3);
    expect(excludingJob.activeForegroundJobsRoom).toBe(1);
  });
});
