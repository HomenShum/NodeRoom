// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, describe, expect, it } from "vitest";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");
const readPosture = makeFunctionReference<"query">("launchPosture:read");
const ENV_KEYS = [
  "NODEROOM_REQUIRE_CONVEX_IDENTITY",
  "NODEAGENT_LAUNCH_MODE",
  "CREDITS_ENFORCED",
  "NODEAGENT_NEW_ROOM_GRANT_CREDITS",
  "NODEAGENT_MAINTENANCE_MODE",
  "NODEAGENT_GLOBAL_PAUSED",
  "NODEAGENT_PROVIDER_PAUSED",
] as const;
const original = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("public launch posture receipt", () => {
  it("reports the non-secret server controls required by deployed proof", async () => {
    process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY = "1";
    process.env.NODEAGENT_LAUNCH_MODE = "private_pilot";
    process.env.CREDITS_ENFORCED = "true";
    process.env.NODEAGENT_NEW_ROOM_GRANT_CREDITS = "7.5";
    process.env.NODEAGENT_MAINTENANCE_MODE = "false";
    process.env.NODEAGENT_GLOBAL_PAUSED = "false";
    process.env.NODEAGENT_PROVIDER_PAUSED = "false";

    const posture = await convexTest(schema, modules).query(readPosture, {});
    expect(posture).toEqual({
      schema: "noderoom-launch-posture-v1",
      identityRequired: true,
      launchMode: "private_pilot",
      creditsEnforced: true,
      freshRoomGrantCredits: 7.5,
      maintenanceMode: false,
      globalPaused: false,
      providerPaused: false,
    });
  });
});
