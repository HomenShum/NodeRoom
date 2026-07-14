// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import prosemirrorSchema from "../node_modules/@convex-dev/prosemirror-sync/src/component/schema";
import { buildDeckStoryboardFromRoom, collaborativeDeckArtifactInput, createDeckComment, deckClaimElementId, deckCommentElementId, deckSlideElementId, resolveDeckComment } from "../src/ui/workArtifacts";
import type { Actor, Artifact } from "../src/engine/types";

vi.setConfig({ testTimeout: 30_000 });

const modules = import.meta.glob("../convex/**/*.ts");
const prosemirrorModules = import.meta.glob("../node_modules/@convex-dev/prosemirror-sync/src/component/**/*.ts");
for (const modulePath of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[modulePath];
}

type ActorProof = { actor: Actor; token?: string };
type VersionRow = { version: number; value: unknown; truncated: boolean; updatedBy: Actor; ts: number };
type RestoreOutcome = { ok: true; version?: number } | { ok: false; reason: string };
const listVersions = makeFunctionReference<"query", { roomId: Id<"rooms">; artifactId: Id<"artifacts">; elementId: string; requester: ActorProof; limit?: number }, VersionRow[]>("elementHistory:listElementVersions");
const restoreVersion = makeFunctionReference<"mutation", { roomId: Id<"rooms">; artifactId: Id<"artifacts">; elementId: string; requester: ActorProof; version: number }, RestoreOutcome>("elementHistory:restoreElementVersion");

const sourceArtifact: Artifact = {
  id: "source-sheet",
  roomId: "room-object-cas",
  kind: "sheet",
  title: "Company research",
  version: 1,
  elements: {
    A1: { id: "A1", version: 1, value: "CardioNova", updatedAt: 1, updatedBy: { kind: "user", id: "seed", name: "Seed" } },
  },
  order: ["A1"],
  updatedAt: 1,
};

describe("collaborative deck object CAS", () => {
  it("keeps human, agent, presence, comment, history, and restore work isolated by object", async () => {
    const t = convexTest(schema, modules);
    t.registerComponent("prosemirrorSync", prosemirrorSchema, prosemirrorModules);
    const hostToken = "deck-object-host-token-0123456789";
    const guestToken = "deck-object-guest-token-9876543210";
    const created = await t.mutation(api.rooms.createStarterRoom, { code: "DECKOBJ", title: "Deck object proof", hostName: "Maya", authToken: hostToken });
    const host: Actor = { kind: "user", id: String(created.memberId), name: "Maya" };
    const hostProof = { actor: host, token: hostToken };
    const joined = await t.mutation(api.rooms.joinAnonymous, { code: "DECKOBJ", name: "Riley", authToken: guestToken });
    if (!joined || "error" in joined) throw new Error("guest join failed");
    const guest: Actor = { kind: "user", id: String(joined.memberId), name: "Riley" };
    const guestProof = { actor: guest, token: guestToken };

    const storyboard = buildDeckStoryboardFromRoom({ roomId: String(created.roomId), roomTitle: "Deck object proof", artifacts: [{ ...sourceArtifact, roomId: String(created.roomId) }] });
    const input = collaborativeDeckArtifactInput(storyboard);
    const artifactId = await t.mutation(api.artifacts.createArtifact, { roomId: created.roomId, kind: input.kind, title: input.title, seed: input.seed, meta: input.meta, proof: hostProof });
    const slideId = storyboard.slides[0].slideId;
    const slideElementId = deckSlideElementId(slideId);
    const claimId = storyboard.slides[0].claims[0].claimId;
    const claimElementId = deckClaimElementId(claimId);
    const slideSeed = input.seed.find((item) => item.id === slideElementId)!.value as Record<string, unknown>;
    const claimSeed = input.seed.find((item) => item.id === claimElementId)!.value as Record<string, unknown>;

    const hostSlide = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: created.roomId, artifactId, elementId: slideElementId, kind: "set",
      value: { ...slideSeed, purpose: "Maya decision narrative" }, baseVersion: 1, proof: hostProof,
    });
    expect(hostSlide).toMatchObject({ ok: true, version: 2 });
    const staleGuest = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: created.roomId, artifactId, elementId: slideElementId, kind: "set",
      value: { ...slideSeed, purpose: "Riley stale overwrite" }, baseVersion: 1, proof: guestProof,
    });
    expect(staleGuest).toMatchObject({ ok: false, reason: "conflict", expected: 1, actual: 2 });

    const guestClaimValue = { ...claimSeed, claim: { ...(claimSeed.claim as Record<string, unknown>), text: "Riley verified claim" } };
    const guestClaim = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: created.roomId, artifactId, elementId: claimElementId, kind: "set", value: guestClaimValue, baseVersion: 1, proof: guestProof,
    });
    expect(guestClaim).toMatchObject({ ok: true, version: 2 });
    const currentSlide = await t.run(async (ctx) => ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId).eq("elementId", slideElementId)).unique());
    expect((currentSlide?.value as Record<string, unknown>).purpose).toBe("Maya decision narrative");

    await t.mutation(api.presence.heartbeat, { roomId: created.roomId, artifactId, targetKind: "deck_component", targetId: claimElementId, mode: "edit", requester: guestProof, ttlMs: 30_000 });
    const presence = await t.query(api.presence.listForArtifact, { roomId: created.roomId, artifactId, requester: hostProof });
    expect(presence).toContainEqual(expect.objectContaining({ targetKind: "deck_component", targetId: claimElementId, actor: expect.objectContaining({ name: "Riley" }) }));

    const agent: Actor = { kind: "agent", id: "room-agent", name: "Room NodeAgent", scope: "public" };
    await t.run(async (ctx) => {
      await ctx.db.insert("agentSessions", {
        roomId: created.roomId,
        agentId: agent.id,
        agentName: agent.name,
        scope: "public",
        status: "working",
        lastAction: "proposing deck claim",
        updatedAt: Date.now(),
      });
    });
    const wrappedSlideProposal = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: created.roomId,
      artifactId,
      elementId: slideElementId,
      value: {
        value: JSON.stringify({ ...slideSeed, purpose: "NodeAgent canonical slide purpose" }),
        status: "complete",
        confidence: 1,
        evidence: [{ kind: "manual", label: "Reviewed deck purpose" }],
      },
      baseVersion: 2,
      actor: agent,
    });
    expect(wrappedSlideProposal).toMatchObject({ ok: false, reason: "pending_approval" });
    if (wrappedSlideProposal.ok || wrappedSlideProposal.reason !== "pending_approval") throw new Error("expected wrapped slide proposal");
    expect(await t.mutation(api.artifacts.resolveProposal, { proposalId: wrappedSlideProposal.proposalId, approve: true, requester: hostProof })).toMatchObject({ ok: true, version: 3 });
    const canonicalSlide = await t.run(async (ctx) => ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId).eq("elementId", slideElementId)).unique());
    expect(canonicalSlide?.value).toMatchObject({ schema: 2, kind: "slide", purpose: "NodeAgent canonical slide purpose" });
    expect(canonicalSlide?.value).not.toHaveProperty("value");

    const minimalSlidePatch = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: created.roomId,
      artifactId,
      elementId: slideElementId,
      value: {
        schema: "2",
        kind: "slide_patch",
        objectId: slideElementId,
        slideId,
        changes: { purpose: "NodeAgent minimal patch purpose" },
      },
      baseVersion: 3,
      actor: agent,
    });
    if (minimalSlidePatch.ok || minimalSlidePatch.reason !== "pending_approval") throw new Error("expected minimal slide patch proposal");
    expect(await t.mutation(api.artifacts.resolveProposal, { proposalId: minimalSlidePatch.proposalId, approve: true, requester: hostProof })).toMatchObject({ ok: true, version: 4 });
    const patchedSlide = await t.run(async (ctx) => ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId).eq("elementId", slideElementId)).unique());
    expect(patchedSlide?.value).toMatchObject({
      schema: 2,
      kind: "slide",
      purpose: "NodeAgent minimal patch purpose",
      claimIds: slideSeed.claimIds,
      sourceArtifactIds: slideSeed.sourceArtifactIds,
    });

    const invalidSlideProposal = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId: created.roomId,
      artifactId,
      elementId: slideElementId,
      value: { value: "not-json", status: "complete", confidence: 1, evidence: [] },
      baseVersion: 4,
      actor: agent,
    });
    if (invalidSlideProposal.ok || invalidSlideProposal.reason !== "pending_approval") throw new Error("expected invalid slide proposal to await review");
    expect(await t.mutation(api.artifacts.resolveProposal, { proposalId: invalidSlideProposal.proposalId, approve: true, requester: hostProof })).toMatchObject({ ok: false, reason: "invalid_deck_object" });
    const unchangedSlide = await t.run(async (ctx) => ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId).eq("elementId", slideElementId)).unique());
    expect(unchangedSlide?.version).toBe(4);
    expect((unchangedSlide?.value as Record<string, unknown>).purpose).toBe("NodeAgent minimal patch purpose");

    const agentClaimValue = { ...guestClaimValue, claim: { ...(guestClaimValue.claim as Record<string, unknown>), text: "NodeAgent sourced claim" } };
    const proposed = await t.mutation(internal.artifacts.applyAgentCellEdit, { roomId: created.roomId, artifactId, elementId: claimElementId, value: agentClaimValue, baseVersion: 2, actor: agent });
    expect(proposed).toMatchObject({ ok: false, reason: "pending_approval" });
    if (proposed.ok || proposed.reason !== "pending_approval") throw new Error("expected agent proposal");
    const approved = await t.mutation(api.artifacts.resolveProposal, { proposalId: proposed.proposalId, approve: true, requester: hostProof });
    expect(approved).toMatchObject({ ok: true, version: 3 });

    const versions = await t.query(listVersions, { roomId: created.roomId, artifactId, elementId: claimElementId, requester: hostProof });
    expect(versions.map((row) => row.version)).toEqual([2, 1]);
    const restored = await t.mutation(restoreVersion, { roomId: created.roomId, artifactId, elementId: claimElementId, requester: hostProof, version: 1 });
    expect(restored).toMatchObject({ ok: true, version: 4 });

    const comment = createDeckComment({ commentId: "comment-1", slideId, body: "Check the source.", author: guest, createdAt: 10 });
    const commentElementId = deckCommentElementId(comment.commentId);
    expect(await t.mutation(api.artifacts.applyCellEdit, { roomId: created.roomId, artifactId, elementId: commentElementId, kind: "create", value: comment, baseVersion: 0, proof: guestProof })).toMatchObject({ ok: true, version: 1 });
    expect(await t.mutation(api.artifacts.applyCellEdit, { roomId: created.roomId, artifactId, elementId: commentElementId, kind: "set", value: resolveDeckComment(comment, host, 20), baseVersion: 1, proof: hostProof })).toMatchObject({ ok: true, version: 2 });
    expect(await t.mutation(api.artifacts.applyCellEdit, { roomId: created.roomId, artifactId, elementId: commentElementId, kind: "set", value: comment, baseVersion: 1, proof: guestProof })).toMatchObject({ ok: false, reason: "conflict", actual: 2 });
  });
});
