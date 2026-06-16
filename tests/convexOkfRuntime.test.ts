// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"];
delete (modules as Record<string, unknown>)["../convex/agentJobRunner.ts"];
delete (modules as Record<string, unknown>)["../convex/agentWorkflows.ts"];
delete (modules as Record<string, unknown>)["../convex/embeddingRunner.ts"];
delete (modules as Record<string, unknown>)["../convex/okfIndexer.ts"];

const token = "0123456789abcdefghijklmnopqrstuvwxyzOKF";

describe("persistent OKF runtime", () => {
  it("materializes artifacts into durable OKF concepts, outbox rows, chunks, search, and Trace Lens telemetry", async () => {
    const { t, proof, roomId } = await setupOkfRoom();

    const indexed = await t.mutation(api.okf.reindexRoom, { roomId, requester: proof });
    expect(indexed.indexed).toBeGreaterThanOrEqual(1);

    const concepts = await t.query(api.okf.listConcepts, { roomId, type: "Spreadsheet" });
    expect(concepts).toHaveLength(1);
    expect(concepts[0].body).toContain("Acme");

    const claimed = await t.mutation(internal.okf.claimOutbox, { leaseId: "okf-test", leaseMs: 60_000, limit: 5 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].conceptId).toBe(concepts[0].id);

    await t.mutation(internal.okf.completeOutbox, {
      jobId: claimed[0].jobId,
      roomId,
      conceptId: claimed[0].conceptId,
      contentHash: claimed[0].contentHash,
      chunks: [{
        chunkId: `${claimed[0].conceptId}#0`,
        chunkIndex: 0,
        text: claimed[0].text,
        embedding: Array.from({ length: 64 }, (_, i) => i === 0 ? 1 : 0),
        embeddingProvider: "local",
        embeddingModel: "test",
        embeddingDimension: 64,
        visibility: "public" as const,
      }],
    });

    const fullText = await t.query(api.okf.fullTextSearch, { roomId, query: "Acme ARR risk", limit: 3 });
    expect(fullText[0]?.concept.id).toBe(concepts[0].id);

    await t.mutation(api.okf.recordRetrievalEvent, {
      roomId,
      query: "Acme ARR risk",
      tool: "okf.fullTextSearch",
      status: "completed",
      candidateIds: [concepts[0].id],
      hitConceptIds: [concepts[0].id],
      latencyMs: 12,
      provider: "local",
      model: "test",
    });
    const lens = await t.query(api.okf.traceLens, { roomId, requester: proof });
    expect(lens.chunkCount).toBe(1);
    expect(lens.outbox.completed).toBe(1);
    expect(lens.events[0].tool).toBe("okf.fullTextSearch");
    expect(lens.concepts[0].conceptId).toBe(concepts[0].id);
  });

  it("requeues stale OKF leases instead of leaving retrieval indexing stuck", async () => {
    const { t, proof, roomId } = await setupOkfRoom();
    await t.mutation(api.okf.reindexRoom, { roomId, requester: proof });
    const claimed = await t.mutation(internal.okf.claimOutbox, { leaseId: "stale", leaseMs: 1, limit: 1 });
    expect(claimed).toHaveLength(1);

    await t.run((ctx) => ctx.db.patch(claimed[0].jobId, { leaseUntil: Date.now() - 1 }));
    const swept = await t.mutation(internal.okf.sweepOutboxLeases, {});
    expect(swept.swept).toBe(1);

    const reclaimed = await t.mutation(internal.okf.claimOutbox, { leaseId: "fresh", leaseMs: 60_000, limit: 1 });
    expect(reclaimed[0].conceptId).toBe(claimed[0].conceptId);
  });
});

async function setupOkfRoom() {
  const t = convexTest(schema, modules);
  const now = Date.now();
  const authTokenHash = await hashToken(token);
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      code: `O${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
      title: "OKF runtime test",
      hostId: "",
      autoAllow: true,
      status: "live" as const,
      createdAt: now,
    }),
  );
  const memberId = await t.run((ctx) =>
    ctx.db.insert("members", {
      roomId,
      name: "Host",
      role: "host" as const,
      anon: false,
      color: "#111111",
      authTokenHash,
      lastSeenAt: now,
    }),
  );
  const proof = { actor: { kind: "user" as const, id: String(memberId), name: "Host" }, token };
  const artifactId = await t.run((ctx) =>
    ctx.db.insert("artifacts", {
      roomId,
      kind: "sheet" as const,
      title: "GTM diligence",
      version: 1,
      order: ["r1__company", "r1__arr", "r1__risk"],
      updatedAt: now,
      createdBy: proof.actor,
      visibility: "room" as const,
    }),
  );
  await t.run((ctx) => Promise.all([
    insertElement(ctx, artifactId, "r1__company", "Acme"),
    insertElement(ctx, artifactId, "r1__arr", "$12M ARR"),
    insertElement(ctx, artifactId, "r1__risk", "Customer concentration risk"),
  ]));
  return { t, proof, roomId, artifactId };
}

function insertElement(ctx: { db: { insert: (...args: any[]) => Promise<unknown> } }, artifactId: Id<"artifacts">, elementId: string, value: string) {
  const now = Date.now();
  return ctx.db.insert("elements", {
    artifactId,
    elementId,
    value,
    version: 1,
    updatedAt: now,
    updatedBy: { kind: "user" as const, id: "seed", name: "Seed" },
  });
}
