// @vitest-environment edge-runtime
import {
  nodeSlideComponentPatchDigest,
  type NodeSlideComponentGrant,
} from "@nodeslide/convex/component";
import componentSchema from "@nodeslide/convex/component-schema";
import { convexTest } from "convex-test";
import { componentsGeneric, makeFunctionReference } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import prosemirrorSchema from "../node_modules/@convex-dev/prosemirror-sync/src/component/schema";
import type { Actor, Artifact } from "../src/engine/types";
import {
  nodeSlideClaimElementId,
  type NodeRoomNodeSlidePatchCommand,
  type NodeRoomNodeSlideSnapshot,
} from "../src/integrations/nodeslide/storyboardTranslation";
import {
  buildDeckStoryboardFromRoom,
  collaborativeDeckArtifactInput,
} from "../src/ui/workArtifacts";

vi.setConfig({ testTimeout: 30_000 });

const modules = import.meta.glob("../convex/**/*.ts");
const prosemirrorModules = import.meta.glob(
  "../node_modules/@convex-dev/prosemirror-sync/src/component/**/*.ts",
);
const packagedNodeSlideModules = import.meta.glob(
  "../node_modules/@nodeslide/convex/dist/component/**/*.js",
);
for (const modulePath of [
  "../convex/agent.ts",
  "../convex/agentJobRunner.ts",
  "../convex/agentWorkflows.ts",
  "../convex/embeddingRunner.ts",
]) {
  delete (modules as Record<string, unknown>)[modulePath];
}

const nodeSlideComponentModules = Object.fromEntries(
  Object.entries(packagedNodeSlideModules).map(([path, loader]) => [
    path.replace("../node_modules/@nodeslide/convex/dist/component/", "./"),
    loader,
  ]),
);

type Proof = { actor: Actor; token?: string };
type MountedArgs = {
  roomId: Id<"rooms">;
  artifactId: Id<"artifacts">;
  requester: Proof;
};

const initializeMountedComponent = makeFunctionReference<"mutation", MountedArgs, {
  snapshot: NodeRoomNodeSlideSnapshot;
}>("nodeslideHost:initializeMountedComponent");
const issueMountedComponentPatchGrant = makeFunctionReference<"query", MountedArgs & {
  patch: NodeRoomNodeSlidePatchCommand;
}, NodeSlideComponentGrant>("nodeslideHost:issueMountedComponentPatchGrant");
const getMountedComponentDeck = makeFunctionReference<"query", MountedArgs, NodeRoomNodeSlideSnapshot | null>(
  "nodeslideHost:getMountedComponentDeck",
);
const getMountedDeck = makeFunctionReference<"query", MountedArgs, { snapshot: NodeRoomNodeSlideSnapshot }>(
  "nodeslideHost:getMountedDeck",
);
const applyMountedPatch = makeFunctionReference<"mutation", MountedArgs & {
  patch: NodeRoomNodeSlidePatchCommand;
}, { snapshot: NodeRoomNodeSlideSnapshot; receipt: unknown }>("nodeslideHost:applyMountedPatch");
const mountedComponentApi = componentsGeneric().nodeslide.repository;

const HOST_TOKEN = "nodeslide-component-host-token-0123456789abcdef";
const MEMBER_TOKEN = "nodeslide-component-member-token-0123456789abcdef";

function sourceArtifact(roomId: string, actor: Actor): Artifact {
  return {
    id: "source:component-research",
    roomId,
    kind: "sheet",
    title: "Component research",
    version: 1,
    elements: {
      A1: {
        id: "A1",
        version: 1,
        value: "CardioNova",
        updatedAt: 1,
        updatedBy: actor,
      },
    },
    order: ["A1"],
    updatedAt: 1,
  };
}

function replaceCommand(
  snapshot: NodeRoomNodeSlideSnapshot,
  elementId: string,
  text: string,
): NodeRoomNodeSlidePatchCommand {
  const slide = snapshot.slides[0];
  const element = snapshot.elements.find((candidate) => candidate.id === elementId);
  if (!element) throw new Error("mounted component element missing");
  return {
    id: "patch:isolated-component-bound",
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersions: { [slide.id]: slide.version },
    baseElementVersions: { [element.id]: element.version },
    scope: {
      kind: "elements",
      deckId: snapshot.deck.id,
      slideIds: [slide.id],
      elementIds: [element.id],
      operationMode: "copy",
    },
    operations: [{
      op: "replace_text",
      slideId: slide.id,
      elementId: element.id,
      text,
    }],
    source: "human",
    summary: text,
    traceId: "trace:isolated-component-bound",
  };
}

describe("mounted immutable NodeSlide component under NodeRoom authorization", () => {
  it("binds a one-time component grant to exact patch bytes and preserves Memory/Convex parity", async () => {
    expect(Object.keys(nodeSlideComponentModules)).toContain("./repository.js");
    const t = convexTest(schema, modules);
    t.registerComponent("prosemirrorSync", prosemirrorSchema, prosemirrorModules);
    t.registerComponent("nodeslide", componentSchema, nodeSlideComponentModules);

    const created = await t.mutation(api.rooms.createStarterRoom, {
      code: "NSCOMP22",
      title: "Mounted isolated NodeSlide",
      hostName: "Maya",
      authToken: HOST_TOKEN,
      autoAllow: false,
    });
    const hostActor: Actor = {
      kind: "user",
      id: String(created.memberId),
      name: "Maya",
    };
    const hostProof = { actor: hostActor, token: HOST_TOKEN };
    const joined = await t.mutation(api.rooms.joinAnonymous, {
      code: "NSCOMP22",
      name: "Riley",
      authToken: MEMBER_TOKEN,
      anon: false,
    });
    if (!joined || "error" in joined) throw new Error("member join failed");
    const memberProof = {
      actor: { kind: "user" as const, id: String(joined.memberId), name: "Riley" },
      token: MEMBER_TOKEN,
    };

    const storyboard = buildDeckStoryboardFromRoom({
      roomId: String(created.roomId),
      roomTitle: "Mounted isolated NodeSlide",
      artifacts: [sourceArtifact(String(created.roomId), hostActor)],
    });
    const input = collaborativeDeckArtifactInput(storyboard);
    const artifactId = await t.mutation(api.artifacts.createArtifact, {
      roomId: created.roomId,
      kind: input.kind,
      title: input.title,
      seed: input.seed,
      meta: input.meta,
      proof: hostProof,
    });
    const mountedArgs = { roomId: created.roomId, artifactId, requester: hostProof };
    const initial = await t.query(getMountedDeck, mountedArgs);
    const initialized = await t.mutation(initializeMountedComponent, mountedArgs);
    expect(initialized.snapshot).toEqual(initial.snapshot);

    const claimId = nodeSlideClaimElementId(storyboard.slides[0].claims[0].claimId);
    const patch = replaceCommand(initial.snapshot, claimId, "Exact request-bound component edit");
    const grant = await t.query(issueMountedComponentPatchGrant, { ...mountedArgs, patch });
    expect(grant).toMatchObject({
      schemaVersion: "nodeslide.component-grant/v1",
      principalId: String(created.memberId),
      deckId: String(artifactId),
      action: "patch.apply",
      resource: { kind: "patch", id: patch.id },
    });
    expect(grant.requestDigest).toBe(await nodeSlideComponentPatchDigest(patch));

    const substituted = { ...patch, summary: "Substituted after NodeRoom authorization" };
    await expect(t.mutation(mountedComponentApi.applyPatch, {
      deckId: String(artifactId),
      patch: substituted,
      grant,
    })).rejects.toThrow(/not bound/);

    const componentApplied = await t.mutation(mountedComponentApi.applyPatch, {
      deckId: String(artifactId),
      patch,
      grant,
    }) as { snapshot: NodeRoomNodeSlideSnapshot; receipt: unknown };
    await expect(t.mutation(mountedComponentApi.applyPatch, {
      deckId: String(artifactId),
      patch,
      grant,
    })).rejects.toThrow(/already consumed/);
    expect(JSON.stringify(componentApplied.receipt)).not.toMatch(/requestDigest|requester|token|actorProof/i);

    // The component namespace is genuinely isolated: its accepted patch does
    // not silently mutate NodeRoom's authoritative room artifact.
    expect((await t.query(getMountedDeck, mountedArgs)).snapshot.deck.version).toBe(
      initial.snapshot.deck.version,
    );
    const nodeRoomApplied = await t.mutation(applyMountedPatch, { ...mountedArgs, patch });
    const componentReloaded = await t.query(getMountedComponentDeck, mountedArgs);
    const nodeRoomReloaded = await t.query(getMountedDeck, mountedArgs);
    expect(componentReloaded).toEqual(componentApplied.snapshot);
    expect(nodeRoomReloaded.snapshot).toEqual(nodeRoomApplied.snapshot);
    // NodeRoom's loss-aware translation re-derives brief/source timestamps and
    // maintains its own slide-object clock. Parity is therefore asserted on
    // the shared authoritative state rather than on incidental serialization.
    expect(nodeRoomReloaded.snapshot.deck.version).toBe(componentApplied.snapshot.deck.version);
    expect(nodeRoomReloaded.snapshot.elements.find((element) => element.id === claimId)).toMatchObject({
      version: componentApplied.snapshot.elements.find((element) => element.id === claimId)?.version,
      content: "Exact request-bound component edit",
    });

    await expect(t.query(issueMountedComponentPatchGrant, {
      ...mountedArgs,
      requester: memberProof,
      patch,
    })).rejects.toThrow(/nodeslide_host_required/);
    await expect(t.query(issueMountedComponentPatchGrant, {
      ...mountedArgs,
      requester: { actor: hostActor, token: "wrong-token-value-that-is-long-enough-1234" },
      patch,
    })).rejects.toThrow(/invalid_actor_token/);

    const durable = await t.run(async (ctx) => ({
      traces: await ctx.db
        .query("traces")
        .withIndex("by_room", (q) => q.eq("roomId", created.roomId))
        .collect(),
      activity: await ctx.db
        .query("roomActivityOutbox")
        .withIndex("by_room", (q) => q.eq("roomId", created.roomId))
        .collect(),
    }));
    const nodeRoomReceipts = durable.traces.filter((trace) => trace.type === "nodeslide_receipt");
    expect(nodeRoomReceipts.length).toBeGreaterThanOrEqual(1);
    expect(nodeRoomReceipts.map((trace) => trace.detail).join("\n")).not.toMatch(
      /requestDigest|requester|token|actorProof/i,
    );
    expect(durable.activity.length).toBeGreaterThanOrEqual(1);
  });
});
