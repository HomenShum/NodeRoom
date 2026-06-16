// @vitest-environment edge-runtime
/**
 * BULK DILIGENCE FAN-OUT (deep-review Workflow 1) — one command over a company list enqueues ONE
 * agentJobs row PER company, each with a per-company-key idempotency key (independent dedupe, not
 * run-level) and the same server-side PlanPreview gate. Previously bulk was a single agent iterating
 * companies sequentially inside one job.
 *
 * Tested via the BLOCKED path (seed a pending proposal so every child plan-blocks) so the fan-out +
 * per-company keys are observable without starting N workflows (the run path shares the same
 * workflow-backed `agentJobs.start` contract).
 */
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const C2 = "r_rev__variance";
const HOST_TOKEN = "host-token-bulk-diligence-0123456789";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };

async function seedRoom(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    const roomId = await ctx.db.insert("rooms", { code: `BD${Math.random().toString(36).slice(2, 8).toUpperCase()}`, title: "Q3", hostId: "pending", autoAllow: false, status: "live" as const, createdAt: now });
    const hostMemberId = await ctx.db.insert("members", { roomId, name: "Maya", role: "host" as const, anon: false, color: "#111111", authTokenHash: await hashToken(HOST_TOKEN), lastSeenAt: now });
    await ctx.db.patch(roomId, { hostId: String(hostMemberId) });
    const hostActor = { kind: "user" as const, id: String(hostMemberId), name: "Maya" };
    const artifactId = await ctx.db.insert("artifacts", { roomId, kind: "sheet" as const, title: "Company Research", version: 1, order: [C2], updatedAt: now });
    await ctx.db.insert("elements", { artifactId, elementId: C2, value: "base", version: 1, updatedAt: now, updatedBy: hostActor });
    // a pending proposal makes every child plan-block (so no workflows start — observable fan-out)
    await ctx.db.insert("proposals", { roomId, artifactId, op: { opId: "p1", artifactId: String(artifactId), elementId: C2, kind: "set", value: "x", baseVersion: 1 }, author: AGENT, status: "pending", createdAt: now });
    return { roomId, artifactId, hostProof: { actor: hostActor, token: HOST_TOKEN } };
  });
}

describe("startBulkDiligence fan-out", () => {
  it("enqueues one job per company with a distinct per-company idempotency key", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const res = await t.mutation(api.agentJobs.startBulkDiligence, { roomId: s.roomId, artifactId: s.artifactId, requester: s.hostProof, companies: "Mercury\nRamp\nBrex" });
    expect(res.count).toBe(3);
    expect(res.jobs.every((j) => j.status === "blocked")).toBe(true);          // gate applied per child
    expect(new Set(res.jobs.map((j) => j.companyKey)).size).toBe(3);            // distinct per-company keys
    const allJobs = await t.run(async (ctx) => (await ctx.db.query("agentJobs").collect()).filter((j) => String(j.roomId) === String(s.roomId)));
    expect(allJobs).toHaveLength(3);
    expect(allJobs.every((j) => (j.idempotencyKey ?? "").startsWith("bulk:"))).toBe(true);
    expect(allJobs.every((j) => j.workflowId === undefined)).toBe(true);        // blocked → no tool loop
  });

  it("de-dupes a repeated company within one submission", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const res = await t.mutation(api.agentJobs.startBulkDiligence, { roomId: s.roomId, artifactId: s.artifactId, requester: s.hostProof, companies: "Acme\nAcme Inc.\nAcme\nBeta" });
    // "Acme" and "Acme" collapse to one key; "Acme Inc." and "Beta" are distinct → 3 companies
    expect(res.count).toBe(3);
    expect(new Set(res.jobs.map((j) => j.companyKey)).size).toBe(3);
  });

  it("bounds the fan-out (rejects more than MAX_BULK_COMPANIES)", async () => {
    const t = convexTest(schema, modules);
    const s = await seedRoom(t);
    const tooMany = Array.from({ length: 60 }, (_, i) => `Company${i}`).join("\n");
    await expect(t.mutation(api.agentJobs.startBulkDiligence, { roomId: s.roomId, artifactId: s.artifactId, requester: s.hostProof, companies: tooMany })).rejects.toThrow(/too_many_companies/);
  });
});
