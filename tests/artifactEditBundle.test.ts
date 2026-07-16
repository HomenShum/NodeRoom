// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { hashToken } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
for (const modulePath of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[modulePath];
}

const HOST_TOKEN = "artifact-edit-bundle-host-token-0123456789";
const createHarness = () => convexTest(schema, modules);
type Harness = ReturnType<typeof createHarness>;

async function seedBundleArtifact(t: Harness) {
  const seeded = await t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: `AB${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Atomic artifact edit bundle",
      hostId: "pending",
      autoAllow: true,
      status: "live" as const,
      createdAt: now,
    });
    const memberId = await ctx.db.insert("members", {
      roomId,
      name: "Maya",
      role: "host" as const,
      anon: false,
      color: "#2E9E6B",
      authTokenHash: await hashToken(HOST_TOKEN),
      lastSeenAt: now,
    });
    await ctx.db.patch(roomId, { hostId: String(memberId) });
    return {
      roomId,
      requester: {
        actor: { kind: "user" as const, id: String(memberId), name: "Maya" },
        token: HOST_TOKEN,
      },
    };
  });
  const artifactId = await t.mutation(api.artifacts.createArtifact, {
    roomId: seeded.roomId,
    kind: "wall",
    title: "Atomic board",
    seed: [
      { id: "alpha", value: { text: "Alpha" } },
      { id: "beta", value: { text: "Beta" } },
    ],
    proof: seeded.requester,
  });
  return { ...seeded, artifactId };
}

async function bundleState(t: Harness, artifactId: Id<"artifacts">) {
  return t.run(async (ctx) => {
    const artifact = await ctx.db.get(artifactId);
    const elements = (await ctx.db.query("elements").collect())
      .filter((row) => String(row.artifactId) === String(artifactId));
    const versions = (await ctx.db.query("elementVersions").collect())
      .filter((row) => String(row.artifactId) === String(artifactId));
    const traces = await ctx.db.query("traces").collect();
    return { artifact, elements, versions, traces };
  });
}

describe("artifacts.applyArtifactEdits", () => {
  it("rolls back an earlier valid edit when a later CAS is stale", async () => {
    const t = createHarness();
    const seeded = await seedBundleArtifact(t);
    const before = await bundleState(t, seeded.artifactId);

    await expect(t.mutation(api.artifacts.applyArtifactEdits, {
      roomId: seeded.roomId,
      artifactId: seeded.artifactId,
      requester: seeded.requester,
      edits: [
        { opId: "set-alpha", elementId: "alpha", kind: "set", value: { text: "Changed" }, baseVersion: 1 },
        { opId: "stale-beta", elementId: "beta", kind: "set", value: { text: "Stale" }, baseVersion: 0 },
      ],
    })).rejects.toThrow(/artifact_edit_bundle_rejected|stale-beta|conflict/);

    const after = await bundleState(t, seeded.artifactId);
    expect(after.artifact?.version).toBe(before.artifact?.version);
    expect(after.artifact?.order).toEqual(before.artifact?.order);
    expect(after.elements.map(({ elementId, value, version }) => ({ elementId, value, version })))
      .toEqual(before.elements.map(({ elementId, value, version }) => ({ elementId, value, version })));
    expect(after.versions).toHaveLength(before.versions.length);
    expect(after.traces).toHaveLength(before.traces.length);
  });

  it("commits set, create, and delete edits as one ordered bundle", async () => {
    const t = createHarness();
    const seeded = await seedBundleArtifact(t);
    const before = await bundleState(t, seeded.artifactId);

    const result = await t.mutation(api.artifacts.applyArtifactEdits, {
      roomId: seeded.roomId,
      artifactId: seeded.artifactId,
      requester: seeded.requester,
      edits: [
        { opId: "set-alpha", elementId: "alpha", kind: "set", value: { text: "Alpha revised" }, baseVersion: 1 },
        { opId: "create-gamma", elementId: "gamma", kind: "create", value: { text: "Gamma" }, baseVersion: 0 },
        { opId: "delete-beta", elementId: "beta", kind: "delete", value: null, baseVersion: 1 },
      ],
    });

    expect(result).toEqual({
      ok: true,
      artifactVersion: 4,
      results: [
        { opId: "set-alpha", elementId: "alpha", version: 2 },
        { opId: "create-gamma", elementId: "gamma", version: 1 },
        { opId: "delete-beta", elementId: "beta", version: 1 },
      ],
    });
    const after = await bundleState(t, seeded.artifactId);
    expect(after.artifact?.order).toEqual(["alpha", "gamma"]);
    expect(after.elements.map(({ elementId, value, version }) => ({ elementId, value, version }))).toEqual([
      { elementId: "alpha", value: { text: "Alpha revised" }, version: 2 },
      { elementId: "gamma", value: { text: "Gamma" }, version: 1 },
    ]);
    expect(after.versions).toHaveLength(3);
    expect(after.traces.filter((trace) => trace.type === "edit_applied")).toHaveLength(
      before.traces.filter((trace) => trace.type === "edit_applied").length + 3,
    );
  });

  it("rejects duplicate identifiers and out-of-bounds bundles before writing", async () => {
    const t = createHarness();
    const seeded = await seedBundleArtifact(t);
    const before = await bundleState(t, seeded.artifactId);
    const duplicateOpId = [
      { opId: "duplicate", elementId: "alpha", kind: "set" as const, value: "A", baseVersion: 1 },
      { opId: "duplicate", elementId: "beta", kind: "set" as const, value: "B", baseVersion: 1 },
    ];
    await expect(t.mutation(api.artifacts.applyArtifactEdits, {
      roomId: seeded.roomId, artifactId: seeded.artifactId, requester: seeded.requester, edits: duplicateOpId,
    })).rejects.toThrow(/invalid_artifact_edit_bundle|duplicate_op_id|duplicate/);
    const duplicateElementId = [
      { opId: "first", elementId: "alpha", kind: "set" as const, value: "A", baseVersion: 1 },
      { opId: "second", elementId: "alpha", kind: "set" as const, value: "B", baseVersion: 1 },
    ];
    await expect(t.mutation(api.artifacts.applyArtifactEdits, {
      roomId: seeded.roomId, artifactId: seeded.artifactId, requester: seeded.requester, edits: duplicateElementId,
    })).rejects.toThrow(/invalid_artifact_edit_bundle|duplicate_element_id|duplicate/);
    await expect(t.mutation(api.artifacts.applyArtifactEdits, {
      roomId: seeded.roomId, artifactId: seeded.artifactId, requester: seeded.requester, edits: [],
    })).rejects.toThrow(/invalid_artifact_edit_bundle|edit_count_out_of_bounds/);
    const tooMany = Array.from({ length: 65 }, (_, index) => ({
      opId: `op-${index}`,
      elementId: `element-${index}`,
      kind: "create" as const,
      value: index,
      baseVersion: 0,
    }));
    await expect(t.mutation(api.artifacts.applyArtifactEdits, {
      roomId: seeded.roomId, artifactId: seeded.artifactId, requester: seeded.requester, edits: tooMany,
    })).rejects.toThrow(/invalid_artifact_edit_bundle|edit_count_out_of_bounds/);

    const after = await bundleState(t, seeded.artifactId);
    expect(after.artifact?.version).toBe(before.artifact?.version);
    expect(after.elements.map(({ elementId, value, version }) => ({ elementId, value, version })))
      .toEqual(before.elements.map(({ elementId, value, version }) => ({ elementId, value, version })));
    expect(after.versions).toHaveLength(before.versions.length);
    expect(after.traces).toHaveLength(before.traces.length);
  });
});
