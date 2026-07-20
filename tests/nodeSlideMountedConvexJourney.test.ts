// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import prosemirrorSchema from "../node_modules/@convex-dev/prosemirror-sync/src/component/schema";
import type { Actor, Artifact } from "../src/engine/types";
import {
  buildDeckStoryboardFromRoom,
  collaborativeDeckArtifactInput,
  deckClaimElementId,
} from "../src/ui/workArtifacts";
import {
  nodeSlideClaimElementId,
  type NodeRoomNodeSlidePatchCommand,
  type NodeRoomNodeSlideSnapshot,
} from "../src/integrations/nodeslide/storyboardTranslation";

vi.setConfig({ testTimeout: 30_000 });

const modules = import.meta.glob("../convex/**/*.ts");
const prosemirrorModules = import.meta.glob("../node_modules/@convex-dev/prosemirror-sync/src/component/**/*.ts");
for (const modulePath of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[modulePath];
}

type Proof = { actor: Actor; token?: string };
type MountedArgs = { roomId: Id<"rooms">; artifactId: Id<"artifacts">; requester: Proof };
type MountedRead = { snapshot: NodeRoomNodeSlideSnapshot; translationReceipt: { fingerprint: string }; authorization: { principalId: string; evidence: Record<string, string> } };
const getMountedDeck = makeFunctionReference<"query", MountedArgs, MountedRead>("nodeslideHost:getMountedDeck");
const applyMountedPatch = makeFunctionReference<"mutation", MountedArgs & { patch: NodeRoomNodeSlidePatchCommand }, any>("nodeslideHost:applyMountedPatch");
const createMountedProposal = makeFunctionReference<"mutation", MountedArgs & { patch: NodeRoomNodeSlidePatchCommand }, any>("nodeslideHost:createMountedProposal");
const resolveMountedProposal = makeFunctionReference<"mutation", MountedArgs & { proposalId: Id<"proposals">; decision: "accept" | "reject" }, any>("nodeslideHost:resolveMountedProposal");
const listMountedVersions = makeFunctionReference<"query", MountedArgs & { limit?: number }, any>("nodeslideHost:listMountedVersions");
const storeMountedReceipt = makeFunctionReference<"mutation", MountedArgs & { receipt: unknown }, any>("nodeslideHost:storeMountedReceipt");

const HOST_TOKEN = "nodeslide-host-token-0123456789abcdef";
const MEMBER_TOKEN = "nodeslide-member-token-0123456789abcdef";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

function sourceArtifact(roomId: string, actor: Actor): Artifact {
  return {
    id: "source:research",
    roomId,
    kind: "sheet",
    title: "Company research",
    version: 1,
    elements: { A1: { id: "A1", version: 1, value: "CardioNova", updatedAt: 1, updatedBy: actor } },
    order: ["A1"],
    updatedAt: 1,
  };
}

function replaceCommand(snapshot: NodeRoomNodeSlideSnapshot, elementId: string, text: string, id: string, source: "human" | "agent" = "human"): NodeRoomNodeSlidePatchCommand {
  const slide = snapshot.slides[0];
  const element = snapshot.elements.find((candidate) => candidate.id === elementId);
  if (!element) throw new Error("element missing");
  return {
    id,
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersions: { [slide.id]: slide.version },
    baseElementVersions: { [element.id]: element.version },
    scope: { kind: "elements", deckId: snapshot.deck.id, slideIds: [slide.id], elementIds: [element.id], operationMode: "copy" },
    operations: [{ op: "replace_text", slideId: slide.id, elementId: element.id, text }],
    source,
    summary: text,
    traceId: `trace:${id}`,
  };
}

describe("mounted NodeSlide lifecycle on NodeRoom Convex authority", () => {
  it("executes ActorProof/membership/policy, durable CAS/proposals/history/activity, reload, and receipts", async () => {
    expect(Object.keys(modules)).toContain("../convex/nodeslideHost.ts");
    const t = convexTest(schema, modules);
    t.registerComponent("prosemirrorSync", prosemirrorSchema, prosemirrorModules);
    const created = await t.mutation(api.rooms.createStarterRoom, { code: "NSMOUNT", title: "Mounted NodeSlide", hostName: "Maya", authToken: HOST_TOKEN, autoAllow: false });
    const hostActor: Actor = { kind: "user", id: String(created.memberId), name: "Maya" };
    const hostProof = { actor: hostActor, token: HOST_TOKEN };
    const joined = await t.mutation(api.rooms.joinAnonymous, { code: "NSMOUNT", name: "Riley", authToken: MEMBER_TOKEN, anon: false });
    if (!joined || "error" in joined) throw new Error("member join failed");
    const memberProof = { actor: { kind: "user" as const, id: String(joined.memberId), name: "Riley" }, token: MEMBER_TOKEN };

    const storyboard = buildDeckStoryboardFromRoom({ roomId: String(created.roomId), roomTitle: "Mounted NodeSlide", artifacts: [sourceArtifact(String(created.roomId), hostActor)] });
    const input = collaborativeDeckArtifactInput(storyboard);
    const artifactId = await t.mutation(api.artifacts.createArtifact, { roomId: created.roomId, kind: input.kind, title: input.title, seed: input.seed, meta: input.meta, proof: hostProof });
    const mountedArgs = { roomId: created.roomId, artifactId, requester: hostProof };
    const initial = await t.query(getMountedDeck, mountedArgs);
    expect(initial.authorization.principalId).toBe(String(created.memberId));
    expect(initial.translationReceipt.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    const claimId = storyboard.slides[0].claims[0].claimId;
    const nodeSlideElementId = nodeSlideClaimElementId(claimId);
    const manual = await t.mutation(applyMountedPatch, { ...mountedArgs, patch: replaceCommand(initial.snapshot, nodeSlideElementId, "Host manual edit", "patch:manual") });
    expect(manual).toMatchObject({ ok: true, affectedElementIds: [nodeSlideElementId] });
    expect(manual.snapshot.elements.find((element: { id: string }) => element.id === nodeSlideElementId)?.content).toBe("Host manual edit");
    expect(JSON.stringify(manual.receipt)).not.toMatch(/actorProof|requester|token/i);
    expect(manual.receipt.authorization.evidence.evidenceId).toMatch(/^.+$/);

    await expect(t.mutation(applyMountedPatch, { ...mountedArgs, requester: memberProof, patch: replaceCommand(manual.snapshot, nodeSlideElementId, "Member overwrite", "patch:member") })).rejects.toThrow(/nodeslide_host_required/);
    await expect(t.query(getMountedDeck, { ...mountedArgs, requester: { actor: hostActor, token: "wrong-token-value-that-is-long-enough-1234" } })).rejects.toThrow(/invalid_actor_token/);

    const memberProposal = await t.mutation(createMountedProposal, { ...mountedArgs, requester: memberProof, patch: replaceCommand(manual.snapshot, nodeSlideElementId, "Member review proposal", "patch:member-proposal") });
    expect(memberProposal.proposalId).toBeTruthy();
    expect(await t.mutation(resolveMountedProposal, { ...mountedArgs, proposalId: memberProposal.proposalId, decision: "reject" })).toMatchObject({ ok: true, status: "rejected" });

    await t.run(async (ctx) => {
      await ctx.db.insert("agentSessions", { roomId: created.roomId, agentId: AGENT.id, agentName: AGENT.name, scope: "public", status: "working", lastAction: "mounted NodeSlide proposal", updatedAt: Date.now() });
    });
    const afterManual = await t.query(getMountedDeck, mountedArgs);
    const currentClaim = afterManual.snapshot.elements.find((element) => element.id === nodeSlideElementId)!;
    const claimObjectId = deckClaimElementId(claimId);
    const currentObject = await t.run(async (ctx) => ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId).eq("elementId", claimObjectId)).unique());
    if (!currentObject) throw new Error("claim object missing");
    const baseClaim = currentObject.value as Record<string, unknown>;
    const first = await t.mutation(internal.artifacts.applyAgentCellEdit, { roomId: created.roomId, artifactId, elementId: claimObjectId, value: { ...baseClaim, claim: { ...(baseClaim.claim as Record<string, unknown>), text: "NodeAgent accepted proposal" } }, baseVersion: currentClaim.version, actor: AGENT });
    const second = await t.mutation(internal.artifacts.applyAgentCellEdit, { roomId: created.roomId, artifactId, elementId: claimObjectId, value: { ...baseClaim, claim: { ...(baseClaim.claim as Record<string, unknown>), text: "NodeAgent competing stale proposal" } }, baseVersion: currentClaim.version, actor: AGENT });
    expect(first).toMatchObject({ ok: false, reason: "pending_approval" });
    expect(second).toMatchObject({ ok: false, reason: "pending_approval" });
    if (first.ok || second.ok || !first.proposalId || !second.proposalId) throw new Error("agent proposals missing");
    expect(await t.mutation(resolveMountedProposal, { ...mountedArgs, proposalId: first.proposalId, decision: "accept" })).toMatchObject({ ok: true, status: "accepted" });
    expect(await t.mutation(resolveMountedProposal, { ...mountedArgs, proposalId: second.proposalId, decision: "accept" })).toMatchObject({ ok: false, reason: "conflict", status: "stale" });

    const reloaded = await t.query(getMountedDeck, mountedArgs);
    expect(reloaded.snapshot.elements.find((element) => element.id === nodeSlideElementId)?.content).toBe("NodeAgent accepted proposal");
    const versions = await t.query(listMountedVersions, { ...mountedArgs, limit: 50 });
    expect(versions.objectHistory.some((row: { elementId: string }) => row.elementId === claimObjectId)).toBe(true);
    const custom = await t.mutation(storeMountedReceipt, { ...mountedArgs, receipt: { id: "custom-receipt:mounted-journey", operation: "custom", deckId: String(artifactId), deckVersion: reloaded.snapshot.deck.version, recordedAt: 1_800_000_000_000, attributes: { journey: "mounted", reopened: true } } });
    expect(custom.operation).toBe("custom");
    expect(custom.authorization.authorizedAt).toBeGreaterThan(custom.recordedAt);
    await expect(t.mutation(storeMountedReceipt, { ...mountedArgs, receipt: { id: "custom-receipt:nested", operation: "custom", deckId: String(artifactId), deckVersion: reloaded.snapshot.deck.version, recordedAt: Date.now(), attributes: { nested: { token: "hidden" } } } })).rejects.toThrow(/nodeslide_receipt_invalid/);
    await expect(t.mutation(applyMountedPatch, { ...mountedArgs, patch: { ...replaceCommand(reloaded.snapshot, nodeSlideElementId, "invalid", "patch:invalid"), operations: [{ op: "replace_text", slideId: reloaded.snapshot.slides[0].id, elementId: nodeSlideElementId, text: 7 }] } as unknown as NodeRoomNodeSlidePatchCommand })).rejects.toThrow(/nodeslide_patch_invalid/);

    const durable = await t.run(async (ctx) => ({
      traces: await ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", created.roomId)).collect(),
      proposals: await ctx.db.query("proposals").withIndex("by_room_status", (q) => q.eq("roomId", created.roomId)).collect(),
      activity: await ctx.db.query("roomActivityOutbox").withIndex("by_room", (q) => q.eq("roomId", created.roomId)).collect(),
    }));
    expect(durable.traces.filter((trace) => trace.type === "nodeslide_receipt").length).toBeGreaterThanOrEqual(6);
    expect(durable.proposals.length).toBeGreaterThanOrEqual(3);
    expect(durable.activity.some((row) => row.sourceId.includes(claimObjectId))).toBe(true);
    expect(durable.traces.map((trace) => trace.detail).join("\n")).not.toMatch(/actorProof|requester|nodeslide-host-token/i);
  });
});
