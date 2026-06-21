// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST_TOKEN = "host-token-presence-claims-0123456789";
const MEMBER_TOKEN = "member-token-presence-claims-012345";

async function seedRoom(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: `PC${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Presence room",
      hostId: "pending",
      autoAllow: true,
      status: "live" as const,
      createdAt: now,
    });
    const hostId = await ctx.db.insert("members", {
      roomId,
      name: "Maya",
      role: "host" as const,
      anon: false,
      color: "#2E9E6B",
      authTokenHash: await hashToken(HOST_TOKEN),
      lastSeenAt: now,
    });
    const memberId = await ctx.db.insert("members", {
      roomId,
      name: "Sam",
      role: "member" as const,
      anon: false,
      color: "#5E6AD2",
      authTokenHash: await hashToken(MEMBER_TOKEN),
      lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: String(hostId) });
    const hostActor = { kind: "user" as const, id: String(hostId), name: "Maya" };
    const memberActor = { kind: "user" as const, id: String(memberId), name: "Sam" };
    const artifactId = await ctx.db.insert("artifacts", {
      roomId,
      kind: "sheet" as const,
      title: "Q3 variance",
      version: 1,
      order: ["C2", "D2"],
      updatedAt: now,
    });
    await ctx.db.insert("elements", { artifactId, elementId: "C2", value: "base", version: 1, updatedAt: now, updatedBy: hostActor });
    await ctx.db.insert("elements", { artifactId, elementId: "D2", value: "other", version: 1, updatedAt: now, updatedBy: hostActor });
    return {
      roomId,
      artifactId,
      hostProof: { actor: hostActor, token: HOST_TOKEN },
      memberProof: { actor: memberActor, token: MEMBER_TOKEN },
    };
  });
}

describe("presence claims", () => {
  it("records advisory focus/edit state without blocking human CAS writes", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);

    const focus = await t.mutation(api.presence.heartbeat, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      targetKind: "cell",
      targetId: "C2",
      mode: "focus",
      label: "Sam",
      color: "#5E6AD2",
      requester: s.memberProof,
    });
    expect(focus.ok).toBe(true);

    const seen = await t.query(api.presence.listForArtifact, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ targetKind: "cell", targetId: "C2", mode: "focus", label: "Sam" });

    const edit = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: "C2",
      value: "Maya can still type",
      baseVersion: 1,
      proof: s.hostProof,
    });
    expect(edit).toMatchObject({ ok: true, version: 2 });
  });

  it("keeps one focus cursor per actor per artifact", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);

    await t.mutation(api.presence.heartbeat, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      targetKind: "cell",
      targetId: "C2",
      mode: "focus",
      requester: s.memberProof,
    });
    await t.mutation(api.presence.heartbeat, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      targetKind: "cell",
      targetId: "D2",
      mode: "focus",
      requester: s.memberProof,
    });

    const seen = await t.query(api.presence.listForArtifact, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
    });
    expect(seen.map((row) => row.targetId)).toEqual(["D2"]);
  });

  it("clears all matching actor presence rows when mode is omitted", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);

    await t.mutation(api.presence.heartbeat, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      targetKind: "cell",
      targetId: "C2",
      mode: "focus",
      requester: s.memberProof,
    });
    await t.mutation(api.presence.heartbeat, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      targetKind: "cell",
      targetId: "D2",
      mode: "edit",
      requester: s.memberProof,
    });

    const cleared = await t.mutation(api.presence.clear, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      targetKind: "cell",
      requester: s.memberProof,
    });
    expect(cleared).toMatchObject({ ok: true, cleared: 2 });

    const seen = await t.query(api.presence.listForArtifact, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
    });
    expect(seen).toHaveLength(0);
  });

  it("lets server-side agents publish advisory intent without blocking human CAS writes", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const agent = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };
    await t.run((ctx) => ctx.db.insert("agentSessions", {
      roomId: s.roomId,
      agentId: agent.id,
      agentName: agent.name,
      scope: "public" as const,
      status: "idle" as const,
      lastAction: "planning C2",
      updatedAt: Date.now(),
    }));

    const intent = await t.mutation(internal.presence.heartbeatForAgent, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      targetKind: "cell",
      targetId: "C2",
      mode: "agent_intent",
      actor: agent,
      label: "NodeAgent planning",
      color: "#5E6AD2",
    });
    expect(intent.ok).toBe(true);

    const seen = await t.query(api.presence.listForArtifact, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ targetKind: "cell", targetId: "C2", mode: "agent_intent", label: "NodeAgent planning" });

    const edit = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: "C2",
      value: "Maya still wins through CAS",
      baseVersion: 1,
      proof: s.hostProof,
    });
    expect(edit).toMatchObject({ ok: true, version: 2 });
  });
});
