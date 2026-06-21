// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST_TOKEN = "host-token-wall-crud-convex-0123456789";

async function seedRoom(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: `WL${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Wall CRUD room",
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
    const actor = { kind: "user" as const, id: String(memberId), name: "Maya" };
    return { roomId, proof: { actor, token: HOST_TOKEN } };
  });
}

describe("Convex wall CRUD", () => {
  it("creates, edits, and deletes post-its through the same versioned element mutation path", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const wallId = await t.mutation(api.artifacts.createArtifact, {
      roomId: s.roomId,
      kind: "wall",
      title: "Risk wall",
      seed: [],
      proof: s.proof,
    });
    const value = { text: "Follow up on churn", x: 20, y: 30, color: "#F2DE9B" };

    const created = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: s.roomId,
      artifactId: wallId,
      elementId: "s_followup",
      kind: "create",
      value,
      baseVersion: 0,
      proof: s.proof,
    });
    expect(created).toMatchObject({ ok: true, version: 1 });

    const moved = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: s.roomId,
      artifactId: wallId,
      elementId: "s_followup",
      kind: "set",
      value: { ...value, x: 72, y: 88 },
      baseVersion: 1,
      proof: s.proof,
    });
    expect(moved).toMatchObject({ ok: true, version: 2 });

    const deleted = await t.mutation(api.artifacts.applyCellEdit, {
      roomId: s.roomId,
      artifactId: wallId,
      elementId: "s_followup",
      kind: "delete",
      value: null,
      baseVersion: 2,
      proof: s.proof,
    });
    expect(deleted).toMatchObject({ ok: true, version: 2 });

    const { wall, elements, traces } = await t.run(async (ctx) => ({
      wall: await ctx.db.get(wallId),
      elements: await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", wallId)).collect(),
      traces: await ctx.db.query("traces").collect(),
    }));
    expect(wall?.order).not.toContain("s_followup");
    expect(elements.map((el) => el.elementId)).not.toContain("s_followup");
    expect(traces.some((trace) => trace.type === "edit_applied" && (trace.detail ?? "").includes("s_followup"))).toBe(true);
  });
});
