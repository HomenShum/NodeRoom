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

  it("does not fall back to a room token after production identity enforcement is enabled", async () => {
    process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY = "1";
    const t = convexTest(schema, modules);
    const host = t.withIdentity({ subject: "account-host" });
    const created = await host.mutation(api.rooms.create, {
      code: "AUTH03",
      title: "Identity-bound room",
      hostName: "Maya",
      authToken: HOST_TOKEN,
    });
    const proof = { actor: { kind: "user" as const, id: String(created.memberId), name: "Maya" }, token: HOST_TOKEN };

    await expect(t.query(api.rooms.get, { roomId: created.roomId, requester: proof })).rejects.toThrow(/production_identity_required/);
    await expect(t.withIdentity({ subject: "different-account" }).query(api.rooms.get, { roomId: created.roomId, requester: proof })).rejects.toThrow(/identity_mismatch/);
    await expect(host.query(api.rooms.get, { roomId: created.roomId, requester: proof })).resolves.toBeTruthy();
  });

  it("resumes the same authenticated member across browsers without consuming another seat", async () => {
    process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY = "1";
    const t = convexTest(schema, modules);
    const host = t.withIdentity({ subject: "account-host" });
    const member = t.withIdentity({ subject: "account-member" });
    const created = await host.mutation(api.rooms.create, {
      code: "AUTH04",
      title: "Cross-browser room",
      hostName: "Maya",
      authToken: HOST_TOKEN,
    });
    const first = await member.mutation(api.rooms.joinAnonymous, {
      code: "AUTH04",
      name: "Sam",
      authToken: MEMBER_TOKEN,
    });
    if (!first || "error" in first) throw new Error("first join failed");
    const second = await member.mutation(api.rooms.joinAnonymous, {
      code: "AUTH04",
      name: "Different browser name",
      authToken: "second-browser-session-token-0123456789",
    });
    if (!second || "error" in second) throw new Error("second join failed");

    expect(second).toMatchObject({ memberId: first.memberId, name: "Sam", resumed: true });
    const hostProof = { actor: { kind: "user" as const, id: String(created.memberId), name: "Maya" }, token: HOST_TOKEN };
    const members = await host.query(api.rooms.members, { roomId: created.roomId, requester: hostProof });
    expect(members.map((entry) => entry.name)).toEqual(["Maya", "Sam"]);
  });

  it("binds a legacy token-authenticated member to the first signed-in account that resumes it", async () => {
    const t = convexTest(schema, modules);
    const created = await t.mutation(api.rooms.create, {
      code: "AUTH05",
      title: "Legacy migration room",
      hostName: "Maya",
      authToken: HOST_TOKEN,
    });

    process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY = "1";
    const account = t.withIdentity({ subject: "account-migrated-host" });
    const resumed = await account.mutation(api.rooms.joinAnonymous, {
      code: "AUTH05",
      name: "Different browser name",
      authToken: HOST_TOKEN,
      anon: false,
    });
    if (!resumed || "error" in resumed) throw new Error("legacy resume failed");

    expect(resumed).toMatchObject({ memberId: created.memberId, name: "Maya", resumed: true });
    const proof = { actor: { kind: "user" as const, id: String(created.memberId), name: "Maya" }, token: HOST_TOKEN };
    await expect(account.query(api.rooms.get, { roomId: created.roomId, requester: proof })).resolves.toBeTruthy();
    await expect(t.query(api.rooms.get, { roomId: created.roomId, requester: proof })).rejects.toThrow(/production_identity_required/);
  });

  it("refuses to resume an identity-bound member with the same room token from another account", async () => {
    process.env.NODEROOM_REQUIRE_CONVEX_IDENTITY = "1";
    const t = convexTest(schema, modules);
    const owner = t.withIdentity({ subject: "account-owner" });
    await owner.mutation(api.rooms.create, {
      code: "AUTH06",
      title: "Identity ownership room",
      hostName: "Maya",
      authToken: HOST_TOKEN,
    });

    await expect(t.withIdentity({ subject: "account-attacker" }).mutation(api.rooms.joinAnonymous, {
      code: "AUTH06",
      name: "Maya",
      authToken: HOST_TOKEN,
      anon: false,
    })).rejects.toThrow(/identity_mismatch/);
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
