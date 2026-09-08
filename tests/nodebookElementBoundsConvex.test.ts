// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import { MAX_ELEMENT_VALUE_BYTES } from "../src/engine/elementValueLimits";

const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"];

const agent = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

async function seed(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", { code: "BOUND1", title: "Bounded visuals", hostId: "host", autoAllow: true, status: "live" as const, createdAt: now });
    const artifactId = await ctx.db.insert("artifacts", { roomId, kind: "note" as const, title: "Visual", version: 1, order: [], updatedAt: now });
    await ctx.db.insert("agentSessions", { roomId, agentId: agent.id, agentName: agent.name, scope: "public" as const, status: "working" as const, lastAction: "bounded visual proof", updatedAt: now });
    return { roomId, artifactId };
  });
}

describe("real Convex NodeBook element bounds", () => {
  it("rejects an oversized NodeAgent direct edit as result data without mutation", async () => {
    const t = convexTest(schema, modules);
    const { roomId, artifactId } = await seed(t);
    const result = await t.mutation(internal.artifacts.applyAgentCellEdit, {
      roomId,
      artifactId,
      elementId: "nodebook:artifact",
      kind: "create",
      value: "x".repeat(MAX_ELEMENT_VALUE_BYTES),
      baseVersion: 0,
      actor: agent,
    });

    expect(result).toEqual({ ok: false, reason: "value_too_large" });
    const element = await t.run((ctx) => ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", artifactId).eq("elementId", "nodebook:artifact")).unique());
    expect(element).toBeNull();
  });

  it("rejects an aggregate oversized NodeAgent draft before storing pending state", async () => {
    const t = convexTest(schema, modules);
    const { roomId, artifactId } = await seed(t);
    const value = "x".repeat(400_000);

    await expect(t.mutation(internal.drafts.createDraft, {
      roomId,
      artifactId,
      author: agent,
      note: "oversized visual batch",
      ops: [
        { opId: "a", artifactId: String(artifactId), elementId: "visual:a", kind: "create", value, baseVersion: 0 },
        { opId: "b", artifactId: String(artifactId), elementId: "visual:b", kind: "create", value, baseVersion: 0 },
      ],
    })).rejects.toThrow("draft_document_too_large");
    const drafts = await t.run((ctx) => ctx.db.query("drafts").withIndex("by_room_status", (q) => q.eq("roomId", roomId).eq("status", "pending")).take(1));
    expect(drafts).toHaveLength(0);
  });
});
