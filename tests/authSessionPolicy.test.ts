// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST_TOKEN = "host-session-token-0123456789abcdef";
const MEMBER_TOKEN = "member-session-token-0123456789abc";

describe("auth/session production policy", () => {
  const previousIdentityRequired = process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY;

  afterEach(() => {
    if (previousIdentityRequired === undefined) delete process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY;
    else process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY = previousIdentityRequired;
  });

  it("can require a Convex auth identity for production room creation", async () => {
    process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY = "1";
    const t = convexTest(schema, modules);

    await expect(t.mutation(api.rooms.createStarterRoom, {
      code: "AUTH01",
      title: "Production identity room",
      hostName: "Maya",
      authToken: HOST_TOKEN,
    })).rejects.toThrow(/production_identity_required/);
  });

  it("blocks host leave and revokes ordinary member proofs after leave", async () => {
    const t = convexTest(schema, modules);
    const created = await t.mutation(api.rooms.createStarterRoom, {
      code: "AUTH02",
      title: "Revocation room",
      hostName: "Maya",
      authToken: HOST_TOKEN,
    });
    const hostProof = { actor: { kind: "user" as const, id: String(created.memberId), name: "Maya" }, token: HOST_TOKEN };
    const joined = await t.mutation(api.rooms.joinAnonymous, {
      code: "AUTH02",
      name: "Sam",
      authToken: MEMBER_TOKEN,
    });
    if (!joined || "error" in joined) throw new Error("join failed");
    const memberProof = { actor: { kind: "user" as const, id: String(joined.memberId), name: "Sam" }, token: MEMBER_TOKEN };

    await expect(t.query(api.rooms.get, { roomId: created.roomId, requester: hostProof })).resolves.toBeTruthy();
    await expect(t.mutation(api.rooms.leave, { roomId: created.roomId, requester: hostProof })).resolves.toEqual({
      ok: false,
      reason: "host_transfer_required",
    });
    await expect(t.query(api.rooms.get, { roomId: created.roomId, requester: hostProof })).resolves.toBeTruthy();

    await expect(t.mutation(api.rooms.leave, { roomId: created.roomId, requester: memberProof })).resolves.toEqual({ ok: true });
    await expect(t.query(api.rooms.get, { roomId: created.roomId, requester: memberProof })).rejects.toThrow(/actor_revoked/);
    const activeMembers = await t.query(api.rooms.members, { roomId: created.roomId, requester: hostProof });
    expect(activeMembers.map((m) => m.name)).toEqual(["Maya"]);
  });
});
