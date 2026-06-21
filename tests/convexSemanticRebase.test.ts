// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"];
delete (modules as Record<string, unknown>)["../convex/agentJobRunner.ts"];
delete (modules as Record<string, unknown>)["../convex/agentWorkflows.ts"];
delete (modules as Record<string, unknown>)["../convex/embeddingRunner.ts"];

const CELL = "r_ni__variance";
const HOST_TOKEN = "host-token-semantic-rebase-0123456789";
const MEMBER_TOKEN = "member-token-semantic-rebase-0123456789";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

describe("Convex semantic rebase write path", () => {
  it("keeps a stale approved proposal pending when final CAS rejects it", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t, { autoAllow: false });

    const proposed = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: CELL,
      value: "+22.4%",
      baseVersion: 1,
      actor: AGENT,
    });
    expect(proposed).toMatchObject({ ok: false, reason: "pending_approval" });
    if (proposed.ok || proposed.reason !== "pending_approval" || !proposed.proposalId) throw new Error("expected pending proposal");

    const human = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: CELL,
      value: "+19.0%",
      baseVersion: 1,
      proof: s.hostProof,
    });
    expect(human).toMatchObject({ ok: true, version: 2 });

    const approved = await t.mutation(api.artifacts.resolveProposal, {
      proposalId: proposed.proposalId,
      approve: true,
      requester: s.hostProof,
    });
    expect(approved).toMatchObject({ ok: false, reason: "conflict", expected: 1, actual: 2 });

    const pending = await t.query(api.artifacts.listProposals, { roomId: s.roomId, requester: s.hostProof });
    expect(pending.map((proposal) => proposal.id)).toContain(String(proposed.proposalId));
    const el = await readElement(t, s.artifactId);
    expect(el?.value).toBe("+19.0%");
  });

  it("blocks an agent formula-to-scalar overwrite before proposal creation", async () => {
    const formulaValue = { value: 42, formula: "=SUM(D2:D4)", status: "complete" };
    const t = convexTest(schema, modules);
    const s = await seedRoom(t, { seedValue: formulaValue });

    const scalar = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: CELL,
      value: 99,
      baseVersion: 1,
      actor: AGENT,
    });
    expect(scalar).toMatchObject({ ok: false, reason: "formula_protected" });
    const el = await readElement(t, s.artifactId);
    expect(el?.value).toEqual(formulaValue);
  });

  it("turns a public draft conflict into a semantic review proposal on the current version", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);

    const lock = await t.mutation(internal.locks.proposeLock, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementIds: [CELL],
      holder: s.hostActor,
      sessionId: "host-session",
      reason: "human review",
    });
    expect(lock.ok).toBe(true);
    if (!lock.ok) throw new Error("expected lock");

    await t.mutation(internal.drafts.createDraft, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      author: AGENT,
      blockedByLockId: String(lock.lockId),
      note: "agent blocked draft",
      ops: [{ opId: "agent-draft", artifactId: String(s.artifactId), elementId: CELL, kind: "set", value: "+22.4%", baseVersion: 1 }],
    });
    const human = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: CELL,
      value: "+19.0%",
      baseVersion: 1,
      proof: s.hostProof,
    });
    expect(human).toMatchObject({ ok: true, version: 2 });

    const released = await t.mutation(internal.locks.releaseLock, { lockId: lock.lockId, actor: s.hostActor });
    expect(released.ok).toBe(true);
    expect(released.merged[0]).toMatchObject({ verdict: "needs_review", conflicts: 1 });

    const [proposal] = await t.query(api.artifacts.listProposals, { roomId: s.roomId, requester: s.hostProof });
    expect(proposal.review).toMatchObject({ kind: "semantic_rebase", status: "needs_review" });
    expect(proposal.op).toMatchObject({ elementId: CELL, value: "+22.4%", baseVersion: 2 });
    const el = await readElement(t, s.artifactId);
    expect(el?.value).toBe("+19.0%");
  });

  it("runs the host-only live semantic conflict drill and approves the rebase proposal", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);

    const drilled = await t.mutation(api.drafts.runSemanticConflictDrill, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
      elementId: CELL,
      currentValue: "+24%",
      proposedValue: "+19%",
    });
    expect(drilled.ok).toBe(true);
    if (!drilled.ok) throw new Error("expected drill to create semantic review proposal");
    expect(drilled.merged[0]).toMatchObject({ verdict: "needs_review", applied: 0, conflicts: 1 });
    expect(drilled.proposalIds).toHaveLength(1);

    const [proposal] = await t.query(api.artifacts.listProposals, { roomId: s.roomId, requester: s.hostProof });
    expect(proposal.review).toMatchObject({ kind: "semantic_rebase", status: "needs_review", currentVersion: 2 });
    expect(proposal.op).toMatchObject({ elementId: CELL, value: "+19%", baseVersion: 2 });
    expect((await readElement(t, s.artifactId))?.value).toBe("+24%");

    const approved = await t.mutation(api.artifacts.resolveProposal, {
      proposalId: proposal.id as never,
      approve: true,
      requester: s.hostProof,
    });
    expect(approved).toMatchObject({ ok: true });
    expect((await readElement(t, s.artifactId))?.value).toBe("+19%");
    const pending = await t.query(api.artifacts.listProposals, { roomId: s.roomId, requester: s.hostProof });
    expect(pending).toHaveLength(0);
  });

  it("launches server-owned agent intent, then routes the stale final patch to review", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t, { autoAllow: false });

    const launched = await t.mutation(api.artifacts.startAgentIntentConflictProof, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
      elementId: CELL,
      proposedValue: "+19% agent",
    });
    expect(launched).toMatchObject({ ok: true, elementId: CELL, baseVersion: 1 });

    const presence = await t.query(api.presence.listForArtifact, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
    });
    expect(presence).toContainEqual(expect.objectContaining({
      targetKind: "cell",
      targetId: CELL,
      mode: "agent_intent",
      label: "NodeAgent planning",
    }));

    const human = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: CELL,
      value: "+24% human",
      baseVersion: 1,
      proof: s.hostProof,
    });
    expect(human).toMatchObject({ ok: true, version: 2 });

    const committed = await t.mutation(internal.artifacts.commitAgentIntentConflictProof, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: CELL,
      value: "+19% agent",
      baseVersion: launched.baseVersion,
      actor: AGENT,
    });
    expect(committed).toMatchObject({ ok: false, reason: "conflict", expected: 1, actual: 2 });

    const retried = await t.mutation(internal.artifacts.commitAgentIntentConflictProof, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: CELL,
      value: "+19% agent",
      baseVersion: launched.baseVersion,
      actor: AGENT,
    });
    expect(retried).toMatchObject({ ok: false, reason: "conflict", expected: 1, actual: 2 });

    const proposals = await t.query(api.artifacts.listProposals, { roomId: s.roomId, requester: s.hostProof });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      review: expect.objectContaining({ kind: "semantic_rebase", currentVersion: 2 }),
      op: expect.objectContaining({ elementId: CELL, value: "+19% agent", baseVersion: 2 }),
    });
    expect((await readElement(t, s.artifactId))?.value).toBe("+24% human");

    const afterPresence = await t.query(api.presence.listForArtifact, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
    });
    expect(afterPresence).toContainEqual(expect.objectContaining({
      targetKind: "cell",
      targetId: CELL,
      mode: "commit_lease",
      label: "NodeAgent checking CAS",
    }));
  });

  it("rejects non-host callers for the live semantic conflict drill", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const memberProof = await addMember(t, s.roomId);

    await expect(t.mutation(api.drafts.runSemanticConflictDrill, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: memberProof,
      elementId: CELL,
      currentValue: "+24%",
      proposedValue: "+19%",
    })).rejects.toThrow("host_required");

    expect((await t.query(api.artifacts.listProposals, { roomId: s.roomId, requester: s.hostProof }))).toHaveLength(0);
    expect((await readElement(t, s.artifactId))?.value).toBe("base");
  });

  it("rejects non-host callers for the server-owned agent intent proof", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const memberProof = await addMember(t, s.roomId);

    await expect(t.mutation(api.artifacts.startAgentIntentConflictProof, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: memberProof,
      elementId: CELL,
      proposedValue: "+19%",
    })).rejects.toThrow("host_required");

    const presence = await t.query(api.presence.listForArtifact, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
    });
    expect(presence).toHaveLength(0);
  });

  it("applies approved create and delete proposals with artifact order intact", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t, { autoAllow: false });
    const createdId = "r_new__variance";

    const createProposal = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: createdId,
      kind: "create",
      value: "+5.0%",
      baseVersion: 0,
      actor: AGENT,
    });
    expect(createProposal).toMatchObject({ ok: false, reason: "pending_approval" });
    if (createProposal.ok || createProposal.reason !== "pending_approval" || !createProposal.proposalId) throw new Error("expected create proposal");

    const approvedCreate = await t.mutation(api.artifacts.resolveProposal, {
      proposalId: createProposal.proposalId,
      approve: true,
      requester: s.hostProof,
    });
    expect(approvedCreate).toMatchObject({ ok: true, version: 1 });
    expect((await readArtifact(t, s.artifactId))?.order).toContain(createdId);
    expect((await readElement(t, s.artifactId, createdId))?.value).toBe("+5.0%");

    const deleteProposal = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: CELL,
      kind: "delete",
      value: null,
      baseVersion: 1,
      actor: AGENT,
    });
    expect(deleteProposal).toMatchObject({ ok: false, reason: "pending_approval" });
    if (deleteProposal.ok || deleteProposal.reason !== "pending_approval" || !deleteProposal.proposalId) throw new Error("expected delete proposal");

    const approvedDelete = await t.mutation(api.artifacts.resolveProposal, {
      proposalId: deleteProposal.proposalId,
      approve: true,
      requester: s.hostProof,
    });
    expect(approvedDelete).toMatchObject({ ok: true, version: 1 });
    expect(await readElement(t, s.artifactId)).toBeNull();
    expect((await readArtifact(t, s.artifactId))?.order).not.toContain(CELL);
  });

  it("clean-merges draft create and delete ops with artifact order intact", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const createdId = "r_new__variance";

    const lock = await t.mutation(internal.locks.proposeLock, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementIds: [CELL, createdId],
      holder: s.hostActor,
      sessionId: "host-session",
      reason: "draft clean merge",
    });
    expect(lock.ok).toBe(true);
    if (!lock.ok) throw new Error("expected lock");

    await t.mutation(internal.drafts.createDraft, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      author: AGENT,
      blockedByLockId: String(lock.lockId),
      note: "clean create/delete draft",
      ops: [
        { opId: "draft-create", artifactId: String(s.artifactId), elementId: createdId, kind: "create", value: "+5.0%", baseVersion: 0 },
        { opId: "draft-delete", artifactId: String(s.artifactId), elementId: CELL, kind: "delete", value: null, baseVersion: 1 },
      ],
    });

    const released = await t.mutation(internal.locks.releaseLock, { lockId: lock.lockId, actor: s.hostActor });
    expect(released.ok).toBe(true);
    expect(released.merged[0]).toMatchObject({ verdict: "clean", applied: 2, conflicts: 0 });
    expect(await readElement(t, s.artifactId)).toBeNull();
    expect((await readElement(t, s.artifactId, createdId))?.value).toBe("+5.0%");
    expect((await readArtifact(t, s.artifactId))?.order).toEqual([createdId]);
  });
});

async function seedRoom(
  t: ReturnType<typeof convexTest>,
  options: { autoAllow?: boolean; seedValue?: unknown } = {},
) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: `SR${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Semantic rebase",
      hostId: "pending",
      autoAllow: options.autoAllow ?? true,
      status: "live" as const,
      createdAt: now,
    });
    const hostMemberId = await ctx.db.insert("members", {
      roomId,
      name: "Homen",
      role: "host" as const,
      anon: false,
      color: "#111111",
      authTokenHash: await hashToken(HOST_TOKEN),
      lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: String(hostMemberId) });
    const hostActor = { kind: "user" as const, id: String(hostMemberId), name: "Homen" };
    const artifactId = await ctx.db.insert("artifacts", {
      roomId,
      kind: "sheet" as const,
      title: "Model",
      version: 1,
      order: [CELL],
      updatedAt: now,
    });
    await ctx.db.insert("elements", {
      artifactId,
      elementId: CELL,
      value: options.seedValue ?? "base",
      version: 1,
      updatedAt: now,
      updatedBy: hostActor,
    });
    await ctx.db.insert("agentSessions", {
      roomId,
      agentId: AGENT.id,
      agentName: AGENT.name,
      scope: "public" as const,
      status: "working" as const,
      lastAction: "seeded",
      updatedAt: now,
    });
    return { roomId, artifactId, hostActor, hostProof: { actor: hostActor, token: HOST_TOKEN } };
  });
}

function addMember(t: ReturnType<typeof convexTest>, roomId: Awaited<ReturnType<typeof seedRoom>>["roomId"]) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const memberId = await ctx.db.insert("members", {
      roomId,
      name: "Dev",
      role: "member" as const,
      anon: false,
      color: "#666666",
      authTokenHash: await hashToken(MEMBER_TOKEN),
      lastSeenAt: now,
    });
    return { actor: { kind: "user" as const, id: String(memberId), name: "Dev" }, token: MEMBER_TOKEN };
  });
}

function readElement(t: ReturnType<typeof convexTest>, artifactId: Awaited<ReturnType<typeof seedRoom>>["artifactId"], elementId = CELL) {
  return t.run(async (ctx) => {
    const elements = await ctx.db.query("elements").collect();
    return elements.find((element) => String(element.artifactId) === String(artifactId) && element.elementId === elementId) ?? null;
  });
}

function readArtifact(t: ReturnType<typeof convexTest>, artifactId: Awaited<ReturnType<typeof seedRoom>>["artifactId"]) {
  return t.run((ctx) => {
    return ctx.db.get(artifactId);
  });
}
