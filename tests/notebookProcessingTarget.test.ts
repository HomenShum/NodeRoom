// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import prosemirrorSchema from "../node_modules/@convex-dev/prosemirror-sync/src/component/schema";
import type { Id } from "../convex/_generated/dataModel";

vi.setConfig({ testTimeout: 30_000 });

const modules = import.meta.glob("../convex/**/*.ts");
const prosemirrorModules = import.meta.glob("../node_modules/@convex-dev/prosemirror-sync/src/component/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST_TOKEN = "notebook-target-host-token-0123456789";
const GUEST_TOKEN = "notebook-target-guest-token-0123456789";

function diligenceSnapshot(company = "CardioNova Health") {
  return JSON.stringify({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: `${company} diligence` }] },
      {
        type: "paragraph",
        content: [{
          type: "text",
          text: `${company} founder call: Series B funding, burn, runway, hospital pilot, and product launch all need source verification.`,
        }],
      },
      { type: "paragraph", content: [{ type: "text", text: "Ask Priya Shah for customer pilot references and confirm revenue impact." }] },
    ],
  });
}

async function seedNotebookRoom() {
  const t = convexTest(schema, modules);
  t.registerComponent("prosemirrorSync", prosemirrorSchema, prosemirrorModules);
  const code = `NB${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  const created = await t.mutation(api.rooms.createStarterRoom, {
    code,
    title: "Notebook target slice",
    hostName: "Maya",
    authToken: HOST_TOKEN,
  });
  const proof = { actor: { kind: "user" as const, id: String(created.memberId), name: "Maya" }, token: HOST_TOKEN };
  const meta = await t.query(api.rooms.meta, { roomId: created.roomId, requester: proof });
  const notebook = meta?.artifacts.find((a) => a.kind === "note" && a.title === "Diligence memo");
  if (!notebook) throw new Error("starter notebook not found");
  return { t, code, roomId: created.roomId, artifactId: notebook.id as Id<"artifacts">, proof };
}

async function makeDirtyDue(t: any, dirtyEventId: Id<"notebookDirtyEvents">) {
  await t.run((ctx: any) => ctx.db.patch(dirtyEventId, { quietUntil: Date.now() - 1 }));
}

describe("notebook target processing slice", () => {
  it("dedupes notebookDirtyEvents, processes the latest snapshot into read-model rows, and reuses the passive classifier", async () => {
    const { t, roomId, artifactId, proof } = await seedNotebookRoom();
    const ensured = await t.mutation(api.prosemirror.ensureNotebookDoc, { roomId, artifactId, requester: proof });
    await t.mutation(api.prosemirror.submitSnapshot, {
      id: ensured.prosemirrorDocId,
      version: 2,
      content: diligenceSnapshot(),
    });

    const first = await t.mutation(api.notebookProcessing.markNotebookDirty, {
      roomId,
      artifactId,
      requester: proof,
      observedSnapshotVersion: 2,
      changedRangeHint: "doc:all",
      quietMs: 1_000,
    });
    const second = await t.mutation(api.notebookProcessing.markNotebookDirty, {
      roomId,
      artifactId,
      requester: proof,
      observedSnapshotVersion: 2,
      changedRangeHint: "doc:paragraph-2",
      quietMs: 1_000,
    });

    expect(second.reused).toBe(true);
    expect(String(second.dirtyEventId)).toBe(String(first.dirtyEventId));

    const early = await t.action(internal.notebookProcessing.processNotebookDirtyEvent, {
      dirtyEventId: first.dirtyEventId,
    });
    expect(early).toMatchObject({ ok: false, reason: "not_claimed" });
    const pending = await t.run((ctx) => ctx.db.get(first.dirtyEventId));
    expect(pending?.state).toBe("pending");

    await makeDirtyDue(t, first.dirtyEventId);
    const processed = await t.action(internal.notebookProcessing.processNotebookDirtyEvent, {
      dirtyEventId: first.dirtyEventId,
    });
    expect(processed).toMatchObject({
      ok: true,
      passiveStatus: "noteworthy",
    });

    const state = await t.run(async (ctx) => {
      const dirtyEvents = await ctx.db.query("notebookDirtyEvents").withIndex("by_room_state", (q) => q.eq("roomId", roomId).eq("state", "processed")).collect();
      const jobs = await ctx.db.query("notebookProcessingJobs").withIndex("by_dirty_event", (q) => q.eq("dirtyEventId", first.dirtyEventId)).collect();
      const blocks = await ctx.db.query("notebookBlocks").withIndex("by_dirty_event", (q) => q.eq("dirtyEventId", first.dirtyEventId)).collect();
      const claims = await ctx.db.query("notebookClaims").withIndex("by_dirty_event", (q) => q.eq("dirtyEventId", first.dirtyEventId)).collect();
      const mentions = await ctx.db.query("notebookMentions").withIndex("by_dirty_event", (q) => q.eq("dirtyEventId", first.dirtyEventId)).collect();
      const outbox = await ctx.db
        .query("roomActivityOutbox")
        .withIndex("by_room_source", (q) => q.eq("roomId", roomId).eq("sourceKind", "artifact_element").eq("sourceId", `${String(artifactId)}:doc`))
        .unique();
      return { dirtyEvents, jobs, blocks, claims, mentions, outbox };
    });

    expect(state.dirtyEvents).toHaveLength(1);
    expect(state.jobs).toHaveLength(1);
    expect(state.jobs[0]?.status).toBe("completed");
    expect(state.blocks.map((block) => block.text).join("\n")).toContain("CardioNova Health founder call");
    expect(state.claims.length).toBeGreaterThan(0);
    expect(state.mentions.map((mention) => mention.entityKey)).toContain("cardionova-health");
    expect(state.outbox).toMatchObject({
      sourceKind: "artifact_element",
      eventKind: "content_committed",
      status: "noteworthy",
      visibility: "room",
    });
    expect(state.outbox?.decision?.source).toBe("notebook_read_model");
    expect(state.outbox?.finding?.classifierVersion).toBeDefined();
    const traces = await t.run((ctx) => ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect());
    expect(traces.some((trace) => trace.type === "notebook_read_model" && trace.summary.includes("Notebook read model updated"))).toBe(true);

    await t.mutation(api.prosemirror.submitSnapshot, {
      id: ensured.prosemirrorDocId,
      version: 3,
      content: JSON.stringify({
        type: "doc",
        content: [{
          type: "paragraph",
          content: [{ type: "text", text: "CardioNova Health updated board prep: confirm runway and customer references." }],
        }],
      }),
    });
    const replacement = await t.mutation(api.notebookProcessing.markNotebookDirty, {
      roomId,
      artifactId,
      requester: proof,
      observedSnapshotVersion: 3,
      quietMs: 1_000,
    });
    await makeDirtyDue(t, replacement.dirtyEventId);
    const replacementProcessed = await t.action(internal.notebookProcessing.processNotebookDirtyEvent, {
      dirtyEventId: replacement.dirtyEventId,
    });
    const currentBlocks = await t.query(api.notebookProcessing.listNotebookBlocks, { roomId, artifactId, requester: proof });

    expect(replacement.reused).toBe(false);
    expect(replacementProcessed).toMatchObject({ ok: true, passiveStatus: "noteworthy" });
    expect(currentBlocks.every((block) => block.sourceSnapshotVersion === 3)).toBe(true);
    expect(currentBlocks.map((block) => block.text).join("\n")).not.toContain("founder call");
  }, 30_000);

  it("rechecks active membership before processing a queued dirty event", async () => {
    const { t, roomId, artifactId, proof } = await seedNotebookRoom();
    const ensured = await t.mutation(api.prosemirror.ensureNotebookDoc, { roomId, artifactId, requester: proof });
    await t.mutation(api.prosemirror.submitSnapshot, {
      id: ensured.prosemirrorDocId,
      version: 2,
      content: diligenceSnapshot("RevokedCo"),
    });
    const dirty = await t.mutation(api.notebookProcessing.markNotebookDirty, {
      roomId,
      artifactId,
      requester: proof,
      observedSnapshotVersion: 2,
      quietMs: 1_000,
    });

    await t.mutation(api.rooms.leave, { roomId, requester: proof });
    await makeDirtyDue(t, dirty.dirtyEventId);
    const processed = await t.action(internal.notebookProcessing.processNotebookDirtyEvent, {
      dirtyEventId: dirty.dirtyEventId,
    });

    expect(processed).toMatchObject({ ok: false, reason: "not_claimed" });
    const state = await t.run(async (ctx) => ({
      dirty: await ctx.db.get(dirty.dirtyEventId),
      jobs: await ctx.db.query("notebookProcessingJobs").withIndex("by_dirty_event", (q) => q.eq("dirtyEventId", dirty.dirtyEventId)).collect(),
      blocks: await ctx.db.query("notebookBlocks").withIndex("by_dirty_event", (q) => q.eq("dirtyEventId", dirty.dirtyEventId)).collect(),
    }));

    expect(state.dirty?.state).toBe("failed");
    expect(state.dirty?.error).toContain("actor_revoked");
    expect(state.jobs).toHaveLength(0);
    expect(state.blocks).toHaveLength(0);
  });

  it("keeps private notebook read models and passive activity owner-only", async () => {
    const seeded = await seedNotebookRoom();
    const { t, code, roomId, proof } = seeded;
    const joined = await t.mutation(api.rooms.joinAnonymous, { code, name: "Guest", authToken: GUEST_TOKEN });
    if (!joined || "error" in joined) throw new Error("guest join failed");
    const guestProof = { actor: { kind: "user" as const, id: String(joined.memberId), name: "Guest" }, token: GUEST_TOKEN };
    const privateArtifactId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("artifacts", {
        roomId,
        kind: "note" as const,
        title: "Private diligence notes",
        version: 1,
        order: ["doc"],
        updatedAt: now,
        createdBy: proof.actor,
        visibility: "private" as const,
      });
      await ctx.db.insert("elements", { artifactId: id, elementId: "doc", value: "", version: 1, updatedAt: now, updatedBy: proof.actor });
      return id;
    });

    await expect(t.mutation(api.notebookProcessing.markNotebookDirty, {
      roomId,
      artifactId: privateArtifactId,
      requester: guestProof,
      quietMs: 1_000,
    })).rejects.toThrow(/artifact_not_visible/);

    const ensured = await t.mutation(api.prosemirror.ensureNotebookDoc, { roomId, artifactId: privateArtifactId, requester: proof });
    await t.mutation(api.prosemirror.submitSnapshot, {
      id: ensured.prosemirrorDocId,
      version: 2,
      content: diligenceSnapshot("PrivateCardio"),
    });
    const dirty = await t.mutation(api.notebookProcessing.markNotebookDirty, {
      roomId,
      artifactId: privateArtifactId,
      requester: proof,
      observedSnapshotVersion: 2,
      quietMs: 1_000,
    });
    await makeDirtyDue(t, dirty.dirtyEventId);
    await t.action(internal.notebookProcessing.processNotebookDirtyEvent, { dirtyEventId: dirty.dirtyEventId });

    const hostBlocks = await t.query(api.notebookProcessing.listNotebookBlocks, { roomId, artifactId: privateArtifactId, requester: proof });
    const guestBlocks = await t.query(api.notebookProcessing.listNotebookBlocks, { roomId, artifactId: privateArtifactId, requester: guestProof });
    const hostFeed = await t.query(api.roomActivity.feed, { roomId, requester: proof });
    const guestFeed = await t.query(api.roomActivity.feed, { roomId, requester: guestProof });
    const sourceId = `${String(privateArtifactId)}:doc`;

    expect(hostBlocks.length).toBeGreaterThan(0);
    expect(guestBlocks).toEqual([]);
    expect(hostFeed.map((item) => item.sourceId)).toContain(sourceId);
    expect(guestFeed.map((item) => item.sourceId)).not.toContain(sourceId);
  });

  it("cascades visibility pullback into notebook sidecars and future dirty processing", async () => {
    const { t, code, roomId, artifactId, proof } = await seedNotebookRoom();
    const joined = await t.mutation(api.rooms.joinAnonymous, { code, name: "Guest", authToken: GUEST_TOKEN });
    if (!joined || "error" in joined) throw new Error("guest join failed");
    const guestProof = { actor: { kind: "user" as const, id: String(joined.memberId), name: "Guest" }, token: GUEST_TOKEN };
    const ensured = await t.mutation(api.prosemirror.ensureNotebookDoc, { roomId, artifactId, requester: proof });
    await t.mutation(api.prosemirror.submitSnapshot, {
      id: ensured.prosemirrorDocId,
      version: 2,
      content: diligenceSnapshot("PullbackCo"),
    });
    const dirty = await t.mutation(api.notebookProcessing.markNotebookDirty, {
      roomId,
      artifactId,
      requester: proof,
      observedSnapshotVersion: 2,
      quietMs: 1_000,
    });
    await makeDirtyDue(t, dirty.dirtyEventId);
    await t.action(internal.notebookProcessing.processNotebookDirtyEvent, { dirtyEventId: dirty.dirtyEventId });

    await t.mutation(api.artifacts.setArtifactVisibility, {
      roomId,
      artifactId,
      visibility: "private",
      requester: proof,
    });

    const state = await t.run(async (ctx) => {
      const doc = await ctx.db
        .query("notebookDocuments")
        .withIndex("by_room_artifact_element", (q) =>
          q.eq("roomId", roomId).eq("artifactId", artifactId).eq("elementId", "doc"))
        .unique();
      const blocks = await ctx.db.query("notebookBlocks").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId)).collect();
      const outbox = await ctx.db
        .query("roomActivityOutbox")
        .withIndex("by_room_source", (q) => q.eq("roomId", roomId).eq("sourceKind", "artifact_element").eq("sourceId", `${String(artifactId)}:doc`))
        .unique();
      return { doc, blocks, outbox };
    });

    expect(state.doc).toMatchObject({ visibility: "private", ownerId: proof.actor.id });
    expect(state.blocks.length).toBeGreaterThan(0);
    expect(state.blocks.every((block) => block.visibility === "private" && block.ownerId === proof.actor.id)).toBe(true);
    expect(state.outbox).toMatchObject({ visibility: "private", ownerId: proof.actor.id });
    expect(await t.query(api.notebookProcessing.listNotebookBlocks, { roomId, artifactId, requester: guestProof })).toEqual([]);
    await expect(t.query(api.prosemirror.getNotebookDoc, { roomId, artifactId, requester: guestProof }))
      .rejects.toThrow(/artifact_not_visible/);

    await t.mutation(api.prosemirror.submitSnapshot, {
      id: ensured.prosemirrorDocId,
      version: 3,
      content: diligenceSnapshot("PullbackCo Private"),
    });
    const nextDirty = await t.mutation(api.notebookProcessing.markNotebookDirty, {
      roomId,
      artifactId,
      requester: proof,
      observedSnapshotVersion: 3,
      quietMs: 1_000,
    });
    await makeDirtyDue(t, nextDirty.dirtyEventId);
    await t.action(internal.notebookProcessing.processNotebookDirtyEvent, { dirtyEventId: nextDirty.dirtyEventId });
    const nextOutbox = await t.run((ctx) =>
      ctx.db
        .query("roomActivityOutbox")
        .withIndex("by_room_source", (q) => q.eq("roomId", roomId).eq("sourceKind", "artifact_element").eq("sourceId", `${String(artifactId)}:doc`))
        .unique()
    );
    expect(nextOutbox).toMatchObject({ visibility: "private", ownerId: proof.actor.id });

    await t.mutation(api.artifacts.setArtifactVisibility, {
      roomId,
      artifactId,
      visibility: "room",
      requester: proof,
    });
    const restored = await t.run(async (ctx) => {
      const doc = await ctx.db
        .query("notebookDocuments")
        .withIndex("by_room_artifact_element", (q) =>
          q.eq("roomId", roomId).eq("artifactId", artifactId).eq("elementId", "doc"))
        .unique();
      const blocks = await ctx.db.query("notebookBlocks").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId)).collect();
      const outbox = await ctx.db
        .query("roomActivityOutbox")
        .withIndex("by_room_source", (q) => q.eq("roomId", roomId).eq("sourceKind", "artifact_element").eq("sourceId", `${String(artifactId)}:doc`))
        .unique();
      return { doc, blocks, outbox };
    });
    expect(restored.doc?.visibility).toBe("room");
    expect(restored.doc?.ownerId).toBeUndefined();
    expect(restored.blocks.every((block) => block.visibility === "room" && block.ownerId === undefined)).toBe(true);
    expect(restored.outbox).toMatchObject({ visibility: "room" });
    expect(restored.outbox?.ownerId).toBeUndefined();
    expect((await t.query(api.notebookProcessing.listNotebookBlocks, { roomId, artifactId, requester: guestProof })).length)
      .toBeGreaterThan(0);
  });

  it("requires an exact planHash before approving the first agent_work_plan artifact into a queued job", async () => {
    const { t, roomId, artifactId, proof } = await seedNotebookRoom();
    const payload = {
      goal: "Research CardioNova Health before writing to the room.",
      plannedReads: [{ artifactId: String(artifactId), range: "doc" }],
      plannedWrites: [{ artifactId: String(artifactId), mode: "draft_first" }],
      evidenceRequirements: ["source every funding and runway claim"],
    };
    const created = await t.mutation(api.agentArtifacts.createAgentWorkPlan, {
      roomId,
      artifactId,
      requester: proof,
      payload,
    });

    expect(created.agentArtifactId).toBeDefined();
    expect(created.planHash).toMatch(/^[a-f0-9]{64}$/);
    await expect(t.mutation(api.agentArtifacts.approveAgentWorkPlan, {
      agentArtifactId: created.agentArtifactId,
      requester: proof,
      planHash: "bad-plan-hash",
    })).rejects.toThrow(/plan_hash_mismatch/);

    const approved = await t.mutation(api.agentArtifacts.approveAgentWorkPlan, {
      agentArtifactId: created.agentArtifactId,
      requester: proof,
      planHash: created.planHash,
    });
    const secondApproval = await t.mutation(api.agentArtifacts.approveAgentWorkPlan, {
      agentArtifactId: created.agentArtifactId,
      requester: proof,
      planHash: created.planHash,
    });
    if (!approved.jobId) throw new Error("approved plan did not create a job");
    const detail = await t.query(api.agentJobs.detail, { jobId: approved.jobId, requester: proof });
    const artifacts = await t.query(api.agentArtifacts.listAgentArtifacts, { roomId, requester: proof, kind: "agent_work_plan" });

    expect(approved).toMatchObject({ ok: true, status: "approved", planHash: created.planHash });
    expect(String(secondApproval.jobId)).toBe(String(approved.jobId));
    expect(detail?.job).toMatchObject({
      status: "queued",
      entrypoint: "public_ask",
      scope: "public_room",
      approvalPolicy: "host_review",
      routePolicy: "explicit",
      runtimePolicy: "workflow_sliced",
    });
    expect(detail?.job.request?.approvedPlanHash).toBe(created.planHash);
    expect(detail?.operations.map((event) => event.name)).toContain("agentArtifacts.approveAgentWorkPlan");
    expect(artifacts.map((artifact) => String(artifact._id))).toContain(String(created.agentArtifactId));
    expect(artifacts.find((artifact) => String(artifact._id) === String(created.agentArtifactId))?.status).toBe("approved");
  });

  it("derives an Agent Work Plan from the notebook read model and records plan trace receipts", async () => {
    const { t, roomId, artifactId, proof } = await seedNotebookRoom();
    const ensured = await t.mutation(api.prosemirror.ensureNotebookDoc, { roomId, artifactId, requester: proof });
    await t.mutation(api.prosemirror.submitSnapshot, {
      id: ensured.prosemirrorDocId,
      version: 2,
      content: diligenceSnapshot("CardioNova Health"),
    });
    const dirty = await t.mutation(api.notebookProcessing.markNotebookDirty, {
      roomId,
      artifactId,
      requester: proof,
      observedSnapshotVersion: 2,
      quietMs: 1_000,
    });
    await makeDirtyDue(t, dirty.dirtyEventId);
    await t.action(internal.notebookProcessing.processNotebookDirtyEvent, { dirtyEventId: dirty.dirtyEventId });

    const created = await t.mutation(api.agentArtifacts.createAgentWorkPlanFromNotebook, {
      roomId,
      artifactId,
      requester: proof,
      goal: "Research CardioNova with evidence before updating the room.",
    });
    const artifacts = await t.query(api.agentArtifacts.listAgentArtifacts, { roomId, requester: proof, kind: "agent_work_plan" });
    const plan = artifacts.find((artifact) => String(artifact._id) === String(created.agentArtifactId));
    expect(plan).toBeDefined();
    expect(plan?.planHash).toBe(created.planHash);
    expect(plan?.payload).toMatchObject({
      source: "notebook_read_model",
      sourceArtifactId: String(artifactId),
      goal: "Research CardioNova with evidence before updating the room.",
    });
    expect(JSON.stringify(plan?.payload)).toContain("CardioNova Health");

    const approved = await t.mutation(api.agentArtifacts.approveAgentWorkPlan, {
      agentArtifactId: created.agentArtifactId,
      requester: proof,
      planHash: created.planHash,
    });
    const detail = approved.jobId ? await t.query(api.agentJobs.detail, { jobId: approved.jobId, requester: proof }) : null;
    const traces = await t.run((ctx) => ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect());

    expect(approved).toMatchObject({ ok: true, status: "approved", planHash: created.planHash });
    expect(detail?.job.request?.approvedPlanHash).toBe(created.planHash);
    expect(detail?.operations.map((event) => event.name)).toContain("agentArtifacts.approveAgentWorkPlan");
    expect(traces.some((trace) => trace.type === "agent_work_plan_proposed" && trace.detail?.includes(created.planHash))).toBe(true);
    expect(traces.some((trace) => trace.type === "agent_work_plan_approved" && trace.detail?.includes(created.planHash))).toBe(true);
  });
});
