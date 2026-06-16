// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";
import { createOkfConcept } from "../src/nodeagent/okf/concept";

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

    const concepts = await t.query(api.okf.listConcepts, { roomId, requester: proof, type: "Spreadsheet" });
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

    const fullText = await t.query(api.okf.fullTextSearch, { roomId, requester: proof, query: "Acme ARR risk", limit: 3 });
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
      visibility: "public",
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

  it("opens literal source rows and exact cells from artifacts", async () => {
    const { t, proof, roomId, artifactId } = await setupOkfRoom();

    const exactCell = await t.query(api.okf.openLiteral, { roomId, requester: proof, sourceArtifactId: String(artifactId), row: 1, column: "arr" });
    expect(exactCell.ok).toBe(true);
    expect(exactCell.snippet).toContain("r1__arr: $12M ARR");
    expect(exactCell.snippet).not.toBe("{}");

    const fullRow = await t.query(api.okf.openLiteral, { roomId, requester: proof, sourceArtifactId: String(artifactId), row: 1 });
    expect(fullRow.snippet).toContain("r1__company: Acme");
    expect(fullRow.snippet).toContain("r1__risk: Customer concentration risk");

    const parsedSource = await t.run(async (ctx) => {
      const now = Date.now();
      const sourceId = await ctx.db.insert("artifacts", {
        roomId,
        kind: "sheet" as const,
        title: "Source workbook",
        version: 1,
        order: ["ARR7"],
        updatedAt: now,
        createdBy: proof.actor,
        visibility: "room" as const,
      });
      await insertElement(ctx, sourceId, "ARR7", "ARR source says $15M ARR");
      const id = await ctx.db.insert("artifacts", {
        roomId,
        kind: "sheet" as const,
        title: "Uploaded operating model",
        version: 1,
        order: ["u1__company", "u1__arr"],
        updatedAt: now,
        createdBy: proof.actor,
        visibility: "room" as const,
        meta: { dataframe: { columns: [{ id: "company", label: "Company" }, { id: "arr", label: "ARR" }] } },
      });
      await insertElement(ctx, id, "u1__company", { value: "CardioNova", status: "complete", evidence: [{ id: "ev-company", kind: "upload", label: "model.xlsx Sheet1!Company7", row: 7, column: "Company" }] });
      await insertElement(ctx, id, "u1__arr", { value: "$15M ARR", status: "complete", evidence: [{ id: "ev-arr", kind: "upload", label: "model.xlsx Sheet1!ARR7", sourceArtifactId: String(sourceId), row: 7, column: "ARR" }] });
      return { parsedArtifactId: id, sourceId };
    });

    const sourceCell = await t.query(api.okf.openLiteral, { roomId, requester: proof, sourceArtifactId: String(parsedSource.parsedArtifactId), row: 7, column: "ARR" });
    expect(sourceCell.ok).toBe(true);
    expect(sourceCell.snippet).toContain("u1__arr: $15M ARR");

    const resolvedEvidence = await t.query(api.okf.resolveCitation, { roomId, requester: proof, evidenceId: "ev-arr" });
    expect(resolvedEvidence.ok).toBe(true);
    expect(resolvedEvidence.resource).toBe(String(parsedSource.sourceId));
    expect(resolvedEvidence.snippet).toContain("ARR7: ARR source says $15M ARR");
  });

  it("partitions public OKF from owner-private overlays", async () => {
    const { t, proof, roomId } = await setupOkfRoom();
    const otherProof = await addMember(t, roomId, "Reviewer");

    await t.mutation(api.okf.upsertConcept, {
      roomId,
      requester: proof,
      concept: createOkfConcept({
        path: "private/homen/thesis.md",
        frontmatter: {
          type: "Coach Cue",
          title: "Private founder risk thesis",
          visibility: "private",
          tags: ["private", "thesis"],
        },
        body: "Private thesis: founder reference call raised a confidential concentration concern.",
      }),
    });

    await t.mutation(api.okf.upsertConcept, {
      roomId,
      requester: proof,
      concept: createOkfConcept({
        path: "public/cardionova/runway.md",
        frontmatter: {
          type: "Metric",
          title: "Public runway summary",
          visibility: "public",
          tags: ["runway"],
        },
        body: "Public runway summary: CardioNova has 11 months of runway pending updated burn evidence.",
      }),
    });

    await expect(t.query(api.okf.fullTextSearch, { roomId, query: "confidential concentration concern", limit: 5 } as never)).rejects.toThrow();
    await expect(t.query(api.okf.listConcepts, { roomId, type: "Metric" } as never)).rejects.toThrow();
    await expect(t.query(api.okf.readConcept, { roomId, conceptId: "private/homen/thesis" } as never)).rejects.toThrow();

    await expect(t.mutation(api.okf.upsertConcept, {
      roomId,
      requester: proof,
      concept: createOkfConcept({
        path: "private/spoofed.md",
        frontmatter: {
          type: "Coach Cue",
          title: "Spoofed private owner",
          visibility: "private",
          noderoom: { ownerId: otherProof.actor.id },
        },
        body: "This should not enter another member private overlay.",
      }),
    })).rejects.toThrow(/private_concept_owner_mismatch/);

    const ownerSearch = await t.query(api.okf.fullTextSearch, { roomId, requester: proof, query: "confidential concentration concern", limit: 5 });
    expect(ownerSearch[0]?.concept.id).toBe("private/homen/thesis");

    const otherSearch = await t.query(api.okf.fullTextSearch, { roomId, requester: otherProof, query: "confidential concentration concern", limit: 5 });
    expect(otherSearch.some((hit) => hit.concept.id === "private/homen/thesis")).toBe(false);

    const otherRead = await t.query(api.okf.readConcept, { roomId, requester: otherProof, conceptId: "private/homen/thesis" });
    expect(otherRead).toBeNull();

    const ownerRead = await t.query(api.okf.readConcept, { roomId, requester: proof, conceptId: "private/homen/thesis" });
    expect(ownerRead?.frontmatter.noderoom?.ownerId).toBe(proof.actor.id);

    await t.mutation(api.okf.upsertConcept, {
      roomId,
      requester: proof,
      concept: createOkfConcept({
        path: "public/linked-review.md",
        frontmatter: {
          type: "Review Round",
          title: "Room review with hidden source",
          visibility: "public",
        },
        body: "Public review links to [hidden thesis](private/homen/thesis.md) for the owner only.",
      }),
    });
    await t.mutation(api.okf.recordRetrievalEvent, {
      roomId,
      query: "confidential concentration concern",
      tool: "okf.fullTextSearch",
      status: "completed",
      candidateIds: ["private/homen/thesis"],
      hitConceptIds: ["private/homen/thesis"],
      latencyMs: 5,
      visibility: "private",
      ownerId: proof.actor.id,
    });
    await t.mutation(api.okf.recordRetrievalEvent, {
      roomId,
      query: "malicious public event should not expose hidden ids",
      tool: "okf.fullTextSearch",
      status: "completed",
      candidateIds: ["private/homen/thesis"],
      hitConceptIds: ["private/homen/thesis"],
      latencyMs: 5,
      visibility: "public",
    });

    const lens = await t.query(api.okf.traceLens, { roomId, requester: otherProof });
    expect(lens.concepts.some((concept: { conceptId: string }) => concept.conceptId === "private/homen/thesis")).toBe(false);
    expect(lens.events.some((event: { query: string }) => event.query.includes("confidential concentration concern"))).toBe(false);
    expect(lens.events.flatMap((event: { hitConceptIds: string[] }) => event.hitConceptIds)).not.toContain("private/homen/thesis");
    expect(lens.edges.some((edge: { fromConceptId: string; toConceptId: string }) => edge.fromConceptId === "public/linked-review" && edge.toConceptId === "private/homen/thesis")).toBe(false);

    const ownerLens = await t.query(api.okf.traceLens, { roomId, requester: proof });
    expect(ownerLens.events.some((event: { query: string }) => event.query.includes("confidential concentration concern"))).toBe(true);

    await expect(t.mutation(api.okf.promoteConcept, {
      roomId,
      requester: otherProof,
      conceptId: "private/homen/thesis",
      targetVisibility: "redacted",
      redactedBody: "Public-safe founder risk cue: request updated concentration evidence before IC.",
    })).rejects.toThrow(/private_concept_owner_required/);

    const promoted = await t.mutation(api.okf.promoteConcept, {
      roomId,
      requester: proof,
      conceptId: "private/homen/thesis",
      targetVisibility: "redacted",
      redactedTitle: "Founder risk cue for room review",
      redactedBody: "Public-safe founder risk cue: request updated concentration evidence before IC.",
      tags: ["review"],
    });
    expect(promoted.conceptId).toContain("promoted/private/homen/thesis-redacted");

    const promotedRead = await t.query(api.okf.readConcept, { roomId, requester: otherProof, conceptId: promoted.conceptId });
    expect(promotedRead?.frontmatter.visibility).toBe("redacted");
    expect(promotedRead?.frontmatter.noderoom?.promotedFromConceptId).toBe("private/homen/thesis");
    expect(promotedRead?.body).not.toContain("confidential concentration concern");

    const publicPromotedSearch = await t.query(api.okf.fullTextSearch, { roomId, requester: otherProof, query: "updated concentration evidence", limit: 5 });
    expect(publicPromotedSearch.some((hit) => hit.concept.id === promoted.conceptId)).toBe(true);

    const publicPrivatePhraseSearch = await t.query(api.okf.fullTextSearch, { roomId, requester: otherProof, query: "confidential concentration concern", limit: 5 });
    expect(publicPrivatePhraseSearch.some((hit) => hit.concept.id === "private/homen/thesis")).toBe(false);
    for (const hit of publicPrivatePhraseSearch) expect(hit.concept.body).not.toContain("confidential concentration concern");
  });

  it("keeps private artifact literals owner-only", async () => {
    const { t, proof, roomId } = await setupOkfRoom();
    const otherProof = await addMember(t, roomId, "Reviewer");
    const privateArtifactId = await t.run(async (ctx) => {
      const now = Date.now();
      const artifactId = await ctx.db.insert("artifacts", {
        roomId,
        kind: "sheet" as const,
        title: "Owner-only thesis scratch",
        version: 1,
        order: ["r1__note"],
        updatedAt: now,
        createdBy: proof.actor,
        visibility: "private" as const,
      });
      await insertElement(ctx, artifactId, "r1__note", "Private M&A concern");
      return artifactId;
    });

    const ownerLiteral = await t.query(api.okf.openLiteral, { roomId, requester: proof, sourceArtifactId: String(privateArtifactId), row: 1, column: "note" });
    expect(ownerLiteral.snippet).toContain("Private M&A concern");

    const otherLiteral = await t.query(api.okf.openLiteral, { roomId, requester: otherProof, sourceArtifactId: String(privateArtifactId), row: 1, column: "note" });
    expect(otherLiteral).toMatchObject({ ok: false, error: "artifact_not_found" });
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

async function addMember(t: Awaited<ReturnType<typeof setupOkfRoom>>["t"], roomId: Id<"rooms">, name: string) {
  const tokenValue = `${name}-0123456789abcdefghijklmnopqrstuvwxyzOKF`;
  const authTokenHash = await hashToken(tokenValue);
  const now = Date.now();
  const memberId = await t.run((ctx) =>
    ctx.db.insert("members", {
      roomId,
      name,
      role: "member" as const,
      anon: false,
      color: "#555555",
      authTokenHash,
      lastSeenAt: now,
    }),
  );
  return { actor: { kind: "user" as const, id: String(memberId), name }, token: tokenValue };
}

function insertElement(ctx: { db: { insert: (...args: any[]) => Promise<unknown> } }, artifactId: Id<"artifacts">, elementId: string, value: unknown) {
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
