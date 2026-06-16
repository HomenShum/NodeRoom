// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const HOST_TOKEN = "host-token-room-work-cache-0123456789";
const MEMBER_TOKEN = "member-token-room-work-cache-0123456789";
const AGENT = { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const };
const CELL_ID = "rc_cardionova__summary";

async function seedRoom(opts: { pendingProposal?: boolean; extraMember?: boolean } = {}) {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      code: `RW${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      title: "Room work cache",
      hostId: "",
      autoAllow: false,
      status: "live" as const,
      createdAt: now,
    }),
  );
  const hostMemberId = await t.run(async (ctx) =>
    ctx.db.insert("members", {
      roomId,
      name: "Maya",
      role: "host" as const,
      anon: false,
      color: "#111111",
      authTokenHash: await hashToken(HOST_TOKEN),
      lastSeenAt: now,
    }),
  );
  await t.run((ctx) => ctx.db.patch(roomId, { hostId: String(hostMemberId) }));
  const hostActor = { kind: "user" as const, id: String(hostMemberId), name: "Maya" };
  let memberProof = { actor: hostActor, token: HOST_TOKEN };
  if (opts.extraMember) {
    const memberId = await t.run(async (ctx) =>
      ctx.db.insert("members", {
        roomId,
        name: "Jordan",
        role: "member" as const,
        anon: false,
        color: "#222222",
        authTokenHash: await hashToken(MEMBER_TOKEN),
        lastSeenAt: now,
      }),
    );
    memberProof = { actor: { kind: "user" as const, id: String(memberId), name: "Jordan" }, token: MEMBER_TOKEN };
  }
  const artifactId = await t.run((ctx) =>
    ctx.db.insert("artifacts", {
      roomId,
      kind: "sheet" as const,
      title: "Company Research",
      version: 1,
      order: [CELL_ID],
      updatedAt: now,
    }),
  );
  await t.run((ctx) =>
    ctx.db.insert("elements", {
      artifactId,
      elementId: CELL_ID,
      value: "",
      version: 1,
      updatedAt: now,
      updatedBy: hostActor,
    }),
  );
  if (opts.pendingProposal) {
    await t.run((ctx) =>
      ctx.db.insert("proposals", {
        roomId,
        artifactId,
        op: { opId: "p1", artifactId: String(artifactId), elementId: CELL_ID, kind: "set", value: "pending", baseVersion: 1 },
        author: AGENT,
        status: "pending" as const,
        createdAt: now,
      }),
    );
  }
  return { t, roomId, artifactId, hostProof: { actor: hostActor, token: HOST_TOKEN }, memberProof };
}

function roomWorkKey(args: { roomId: Id<"rooms">; artifactId: Id<"artifacts">; actorId: string }) {
  return `roomwork:${String(args.roomId)}:${String(args.artifactId)}:${args.actorId}:agent_fill:company:cardionova:company_profile`;
}

describe("room-work entity/facet cache", () => {
  it("records a completed room-work job from fresh facet cache without starting a workflow", async () => {
    const s = await seedRoom();
    await s.t.mutation(api.agentJobs.upsertEntityResearchCache, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
      entityType: "company",
      entityName: "CardioNova",
      facet: "company_profile",
      result: { summary: "AI triage workflow for hospital intake." },
      evidenceRefs: [{ id: "okf:cardionova-profile", label: "Founder deck" }],
      validUntil: Date.now() + 60_000,
    });

    const res = await s.t.mutation(api.agentJobs.startOrReuseRoomWork, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
      mode: "agent_fill",
      input: {
        kind: "agent_request",
        text: "Fill CardioNova company profile from known room evidence.",
        entityHints: [{ entityType: "company", name: "CardioNova" }],
        facets: ["company_profile"],
      },
    });

    expect(res.cacheOnly).toBe(true);
    expect(res.status).toBe("completed");
    expect(res.jobId).toBeDefined();
    expect(res.cacheHits).toHaveLength(1);
    expect(res.cacheHits[0].fresh).toBe(true);
    expect(res.staleFacets).toEqual([]);
    expect(res.cacheSummary).toMatchObject({ fresh: 1, cached: 1, missing: 0 });
    const jobId = res.jobId;
    if (!jobId) throw new Error("expected cache-only room work to create a job record");
    const detail = await s.t.query(api.agentJobs.detail, { jobId, requester: s.hostProof });
    const job = detail?.job;
    const workItems = await s.t.run((ctx) => ctx.db.query("entityWorkItems").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
    expect(job?.entrypoint).toBe("room_work");
    expect(job?.status).toBe("completed");
    expect(job?.workflowId).toBeUndefined();
    expect(job?.modelCallCount).toBe(0);
    expect(workItems).toHaveLength(1);
    expect(workItems[0]).toMatchObject({ entityKey: "cardionova", facet: "company_profile", status: "cached", cachePolicy: "fresh_use_cache" });
  });

  it("creates a blocked durable room-work record for stale or missing facets without starting a workflow", async () => {
    const s = await seedRoom({ pendingProposal: true });

    const res = await s.t.mutation(api.agentJobs.startOrReuseRoomWork, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
      mode: "agent_fill",
      input: {
        kind: "agent_request",
        text: "Fill CardioNova diligence fields before the IC prep.",
        entityHints: [{ entityType: "company", name: "CardioNova" }],
        facets: ["company_profile", "funding"],
      },
    });

    expect(res.cacheOnly).toBe(false);
    expect(res.status).toBe("blocked");
    expect(res.staleFacets.map((facet) => facet.facet).sort()).toEqual(["company_profile", "funding"]);
    const jobId = res.jobId;
    if (!jobId) throw new Error("expected blocked room work to create a job record");
    const detail = await s.t.query(api.agentJobs.detail, { jobId, requester: s.hostProof });
    const job = detail?.job;
    expect(job?.workflowId).toBeUndefined();
    expect(job?.schedulerHandoffCount).toBe(0);
    expect(job?.entrypoint).toBe("room_work");
    expect(job?.request?.roomWork?.staleFacets).toHaveLength(2);
    const workItems = await s.t.run((ctx) => ctx.db.query("entityWorkItems").withIndex("by_job", (q) => q.eq("jobId", jobId)).collect());
    expect(workItems).toHaveLength(2);
    expect(workItems.map((item) => item.cachePolicy)).toEqual(["missing_research_now", "missing_research_now"]);
  });

  it("reuses an existing live room-work job for the same entity/facet signature", async () => {
    const s = await seedRoom();
    const key = roomWorkKey({ roomId: s.roomId, artifactId: s.artifactId, actorId: s.hostProof.actor.id });
    const existing = await s.t.mutation(api.agentJobs.createOrReuse, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
      goal: "Room work agent_fill: Fill company_profile for CardioNova.",
      entrypoint: "room_work",
      scope: "public_room",
      modelPolicy: "test-model",
      idempotencyKey: key,
      mode: "research",
    });

    const res = await s.t.mutation(api.agentJobs.startOrReuseRoomWork, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
      mode: "agent_fill",
      input: {
        kind: "agent_request",
        entityHints: [{ entityType: "company", name: "CardioNova" }],
        facets: ["company_profile"],
      },
    });

    expect(res.reused).toBe(true);
    expect(String(res.jobId)).toBe(String(existing.jobId));
  });

  it("keeps private cache rows invisible to other room members", async () => {
    const s = await seedRoom({ extraMember: true });
    await s.t.mutation(api.agentJobs.upsertEntityResearchCache, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.hostProof,
      visibility: "private",
      entityType: "company",
      entityName: "CardioNova",
      facet: "company_profile",
      result: { summary: "Host-only founder call note." },
      evidenceRefs: [{ id: "private:call", label: "Founder call" }],
      validUntil: Date.now() + 60_000,
    });

    const ownerHits = await s.t.query(api.agentJobs.lookupEntityResearchCache, {
      roomId: s.roomId,
      requester: s.hostProof,
      entityType: "company",
      entityName: "CardioNova",
      facets: ["company_profile"],
      includeStale: true,
    });
    const memberHits = await s.t.query(api.agentJobs.lookupEntityResearchCache, {
      roomId: s.roomId,
      requester: s.memberProof,
      entityType: "company",
      entityName: "CardioNova",
      facets: ["company_profile"],
      includeStale: true,
    });

    expect(ownerHits).toHaveLength(1);
    expect(ownerHits[0].result).toEqual({ summary: "Host-only founder call note." });
    expect(memberHits).toEqual([]);
  });
});
