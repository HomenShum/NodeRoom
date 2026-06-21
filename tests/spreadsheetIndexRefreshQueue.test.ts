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

const HOST_TOKEN = "host-token-index-refresh-queue-012345";

async function seedRoom(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", {
      code: `IX${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Index queue room",
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
    const artifactId = await ctx.db.insert("artifacts", {
      roomId,
      kind: "sheet" as const,
      title: "Q3 variance",
      version: 1,
      order: ["C2", "D2"],
      updatedAt: now,
    });
    await ctx.db.insert("elements", { artifactId, elementId: "C2", value: "base", version: 1, updatedAt: now, updatedBy: actor });
    await ctx.db.insert("elements", { artifactId, elementId: "D2", value: "base", version: 1, updatedAt: now, updatedBy: actor });
    return { roomId, artifactId, proof: { actor, token: HOST_TOKEN } };
  });
}

describe("spreadsheet index refresh queue", () => {
  it("coalesces multiple cell commits into one queued refresh row", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);

    await t.mutation(api.artifacts.applyCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: "C2",
      value: "first",
      baseVersion: 1,
      proof: s.proof,
    });
    await t.mutation(api.artifacts.applyCellEdit, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      elementId: "D2",
      value: "second",
      baseVersion: 1,
      proof: s.proof,
    });

    const refreshes = await t.run(async (ctx) =>
      (await ctx.db.query("spreadsheetIndexRefreshes").collect())
        .filter((row) => String(row.artifactId) === String(s.artifactId)),
    );
    expect(refreshes).toHaveLength(1);
    expect(refreshes[0]).toMatchObject({ status: "queued" });
  });
});
