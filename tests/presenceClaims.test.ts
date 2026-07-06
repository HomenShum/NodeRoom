// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
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

describe("presence release (root-cause fix for lingering agent chips)", () => {
  // releaseForAgent is new and not yet in convex/_generated/api (codegen
  // deploys to prod, forbidden from a working branch) — typed-cast precedent,
  // same as every other un-codegen'd module referenced elsewhere in this repo.
  const releaseForAgentRef = makeFunctionReference<"mutation">("presence:releaseForAgent") as any;

  it("deletes only the targeted cell's claims (both modes), leaving other cells' claims untouched", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const agent = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };
    await t.run((ctx) => ctx.db.insert("agentSessions", { roomId: s.roomId, agentId: agent.id, agentName: agent.name, scope: "public" as const, status: "idle" as const, lastAction: "planning", updatedAt: Date.now() }));

    await t.mutation(internal.presence.heartbeatForAgent, { roomId: s.roomId, artifactId: s.artifactId, targetKind: "cell", targetId: "C2", mode: "agent_intent", actor: agent, label: "planning" });
    await t.mutation(internal.presence.heartbeatForAgent, { roomId: s.roomId, artifactId: s.artifactId, targetKind: "cell", targetId: "C2", mode: "commit_lease", actor: agent, label: "checking CAS" });
    await t.mutation(internal.presence.heartbeatForAgent, { roomId: s.roomId, artifactId: s.artifactId, targetKind: "cell", targetId: "D2", mode: "agent_intent", actor: agent, label: "planning D2" });

    const before = await t.query(api.presence.listForArtifact, { roomId: s.roomId, artifactId: s.artifactId, requester: s.hostProof });
    expect(before).toHaveLength(3);

    // Omit mode -> release BOTH claims on C2 in one call (what editCell's finally does).
    const released = await t.mutation(releaseForAgentRef, { roomId: s.roomId, artifactId: s.artifactId, targetKind: "cell", targetId: "C2", actor: agent });
    expect(released).toMatchObject({ ok: true, released: 2 });

    const after = await t.query(api.presence.listForArtifact, { roomId: s.roomId, artifactId: s.artifactId, requester: s.hostProof });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ targetKind: "cell", targetId: "D2", mode: "agent_intent" });
  });

  it("scopes to one mode when mode is given, leaving the other mode's claim on the same cell alone", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const agent = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };
    await t.run((ctx) => ctx.db.insert("agentSessions", { roomId: s.roomId, agentId: agent.id, agentName: agent.name, scope: "public" as const, status: "idle" as const, lastAction: "planning", updatedAt: Date.now() }));
    await t.mutation(internal.presence.heartbeatForAgent, { roomId: s.roomId, artifactId: s.artifactId, targetKind: "cell", targetId: "C2", mode: "agent_intent", actor: agent, label: "planning" });
    await t.mutation(internal.presence.heartbeatForAgent, { roomId: s.roomId, artifactId: s.artifactId, targetKind: "cell", targetId: "C2", mode: "commit_lease", actor: agent, label: "checking CAS" });

    const released = await t.mutation(releaseForAgentRef, { roomId: s.roomId, artifactId: s.artifactId, targetKind: "cell", targetId: "C2", actor: agent, mode: "agent_intent" });
    expect(released).toMatchObject({ ok: true, released: 1 });

    const after = await t.query(api.presence.listForArtifact, { roomId: s.roomId, artifactId: s.artifactId, requester: s.hostProof });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ mode: "commit_lease" });
  });

  it("is a no-op (not an error) when there is nothing to release — an idempotent finally-block call", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const agent = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

    const released = await t.mutation(releaseForAgentRef, { roomId: s.roomId, artifactId: s.artifactId, targetKind: "cell", targetId: "no-such-cell", actor: agent });
    expect(released).toMatchObject({ ok: true, released: 0 });
  });

  it("rejects a non-agent actor — same trust boundary as heartbeatForAgent", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const human = { kind: "user" as const, id: "member_1", name: "Sam" };

    await expect(
      t.mutation(releaseForAgentRef, { roomId: s.roomId, artifactId: s.artifactId, targetKind: "cell", targetId: "C2", actor: human }),
    ).rejects.toThrow(/agent_actor_required/);
  });
});
