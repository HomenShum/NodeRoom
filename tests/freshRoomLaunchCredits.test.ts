// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import {
  NEW_ROOM_GRANT_CREDITS_ENV,
  freshRoomLaunchCreditGrantFromEnv,
} from "../convex/freshRoomLaunchCredits";
import { DEMO_CREDIT_CONFIG } from "../src/nodeagent/core/creditModel";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST_TOKEN = "fresh-room-credit-host-token-0123456789";
const ENV_KEYS = ["NODEAGENT_LAUNCH_MODE", "CREDITS_ENFORCED", NEW_ROOM_GRANT_CREDITS_ENV] as const;
const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

type T = ReturnType<typeof convexTest>;

function configureLaunch(mode: "development" | "private_pilot" | "public_launch", credits: string, enforced = "true") {
  process.env.NODEAGENT_LAUNCH_MODE = mode;
  process.env.CREDITS_ENFORCED = enforced;
  process.env[NEW_ROOM_GRANT_CREDITS_ENV] = credits;
}

function readEnrollment(t: T, roomId: Id<"rooms">) {
  return t.run(async (ctx) => {
    const wallets = await ctx.db.query("roomCredits").collect();
    const grants = await ctx.db.query("creditGrants").collect();
    const ledger = await ctx.db.query("creditLedger").collect();
    return {
      wallet: wallets.find((row) => String(row.roomId) === String(roomId)) ?? null,
      grants: grants.filter((row) => String(row.roomId) === String(roomId)),
      ledger: ledger.filter((row) => String(row.roomId) === String(roomId)),
    };
  });
}

describe.sequential("fresh-room launch credit enrollment", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("stays disabled without every explicit launch gate and never grants in development", async () => {
    expect(freshRoomLaunchCreditGrantFromEnv({
      NODEAGENT_LAUNCH_MODE: "public_launch",
      CREDITS_ENFORCED: "false",
      [NEW_ROOM_GRANT_CREDITS_ENV]: "8",
    })).toBeNull();
    expect(freshRoomLaunchCreditGrantFromEnv({
      NODEAGENT_LAUNCH_MODE: "public_launch",
      CREDITS_ENFORCED: "true",
    })).toBeNull();

    configureLaunch("development", "8");
    const t = convexTest(schema, modules);
    const created = await t.mutation(api.rooms.create, {
      code: "CRDEV1", title: "Development room", hostName: "Maya", authToken: HOST_TOKEN,
    });

    const enrollment = await readEnrollment(t, created.roomId);
    expect(enrollment.wallet).toBeNull();
    expect(enrollment.grants).toHaveLength(0);
    expect(enrollment.ledger).toHaveLength(0);
  });

  it.each(["not-a-number", "-4", "0", "Infinity", "0x10"])(
    "treats malformed or non-positive configured credits (%s) as zero",
    (credits) => {
      configureLaunch("public_launch", credits);
      expect(freshRoomLaunchCreditGrantFromEnv(process.env)?.credits ?? 0).toBe(0);
    },
  );

  it("grants an explicitly configured amount to the empty live-room path with an audit trail", async () => {
    configureLaunch("public_launch", "7.5");
    const expectedGrant = freshRoomLaunchCreditGrantFromEnv(process.env);
    expect(expectedGrant).not.toBeNull();

    const t = convexTest(schema, modules);
    const created = await t.mutation(api.rooms.create, {
      code: "CREMPT", title: "Empty launch room", hostName: "Maya", authToken: HOST_TOKEN,
    });
    const enrollment = await readEnrollment(t, created.roomId);

    expect(enrollment.wallet?.availableCredits).toBe(7.5);
    expect(enrollment.grants).toHaveLength(1);
    expect(enrollment.grants[0]).toMatchObject(expectedGrant!);
    expect(enrollment.ledger).toContainEqual(expect.objectContaining({
      kind: "refund",
      credits: 7.5,
      reason: "grant:promo",
      note: expectedGrant?.note,
    }));
  });

  it("caps and grants the starter live-room path at the shared demo allowance", async () => {
    configureLaunch("private_pilot", "200");
    const expectedGrant = freshRoomLaunchCreditGrantFromEnv(process.env);
    expect(expectedGrant?.credits).toBe(DEMO_CREDIT_CONFIG.startingCredits);
    expect(expectedGrant?.note).toContain("launch_mode=private_pilot");
    expect(expectedGrant?.note).toContain("requested_credits=200");
    expect(expectedGrant?.note).toContain(`cap_credits=${DEMO_CREDIT_CONFIG.startingCredits}`);

    const t = convexTest(schema, modules);
    const created = await t.mutation(api.rooms.createStarterRoom, {
      code: "CRSTRT", title: "Starter launch room", hostName: "Maya", authToken: HOST_TOKEN, deferHeavySeed: true,
    });
    const enrollment = await readEnrollment(t, created.roomId);

    expect(enrollment.wallet?.availableCredits).toBe(DEMO_CREDIT_CONFIG.startingCredits);
    expect(enrollment.grants).toHaveLength(1);
    expect(enrollment.grants[0]).toMatchObject(expectedGrant!);
  });
});
