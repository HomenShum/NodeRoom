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

const hostToken = "0123456789abcdefghijklmnopqrstuvwxyzHOST";
const guestToken = "0123456789abcdefghijklmnopqrstuvwxyzGUEST";

describe("private artifact visibility", () => {
  it("keeps private uploaded-source artifacts owner-only and out of shared agent tools", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const roomId = await t.run((ctx) =>
      ctx.db.insert("rooms", {
        code: "PRIV01",
        title: "Private room",
        hostId: "",
        autoAllow: true,
        status: "live" as const,
        createdAt: now,
      }),
    );
    const hostId = await t.run(async (ctx) =>
      ctx.db.insert("members", {
        roomId,
        name: "Host",
        role: "host" as const,
        anon: false,
        color: "#111111",
        authTokenHash: await hashToken(hostToken),
        lastSeenAt: now,
      }),
    );
    const guestId = await t.run(async (ctx) =>
      ctx.db.insert("members", {
        roomId,
        name: "Guest",
        role: "member" as const,
        anon: true,
        color: "#222222",
        authTokenHash: await hashToken(guestToken),
        lastSeenAt: now,
      }),
    );
    await t.run((ctx) => ctx.db.patch(roomId, { hostId }));
    const hostActor = { kind: "user" as const, id: String(hostId), name: "Host" };
    const guestActor = { kind: "user" as const, id: String(guestId), name: "Guest" };
    const storageId = "kg0000000000000000000000000001" as Id<"_storage">;
    const sourceFileId = await t.run((ctx) =>
      ctx.db.insert("uploadedFiles", {
        roomId,
        storageId,
        fileName: "founder-call.pdf",
        mimeType: "application/pdf",
        size: 512,
        sha256: "privatehash",
        createdBy: hostActor,
        visibility: "private" as const,
        status: "uploaded" as const,
        createdAt: now,
      }),
    );

    const artifactId = await t.mutation(api.artifacts.createArtifact, {
      roomId,
      kind: "sheet",
      title: "founder-call.pdf",
      seed: [{ id: "u1__company", value: "CardioNova" }],
      meta: { upload: { fileName: "founder-call.pdf", mimeType: "application/pdf", size: 512, parsedAt: now } },
      sourceFileId,
      proof: { actor: hostActor, token: hostToken },
    });

    const { artifact, sourceFile } = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(artifactId),
      sourceFile: await ctx.db.get(sourceFileId),
    }));
    expect(artifact?.visibility).toBe("private");
    expect(artifact?.createdBy?.id).toBe(String(hostId));
    expect(sourceFile?.status).toBe("linked");

    const hostMeta = await t.query(api.rooms.meta, { roomId, requester: { actor: hostActor, token: hostToken } });
    const guestMeta = await t.query(api.rooms.meta, { roomId, requester: { actor: guestActor, token: guestToken } });
    const hostFull = await t.query(api.rooms.full, { roomId, requester: { actor: hostActor, token: hostToken } });
    const guestFull = await t.query(api.rooms.full, { roomId, requester: { actor: guestActor, token: guestToken } });

    expect(hostMeta?.artifacts.map((a) => a.title)).toContain("founder-call.pdf");
    expect(hostFull?.artifacts.map((a) => a.title)).toContain("founder-call.pdf");
    expect(guestMeta?.artifacts.map((a) => a.title)).not.toContain("founder-call.pdf");
    expect(guestFull?.artifacts.map((a) => a.title)).not.toContain("founder-call.pdf");

    const hostElements = await t.query(api.artifacts.elements, {
      roomId,
      artifactId,
      requester: { actor: hostActor, token: hostToken },
    });
    expect(hostElements["u1__company"]?.value).toBe("CardioNova");
    await expect(t.query(api.artifacts.elements, {
      roomId,
      artifactId,
      requester: { actor: guestActor, token: guestToken },
    })).rejects.toThrow(/artifact_not_visible/);

    await expect(t.mutation(api.artifacts.applyCellEdit, {
      roomId,
      artifactId,
      elementId: "u1__company",
      value: "LeakedCo",
      baseVersion: 1,
      proof: { actor: guestActor, token: guestToken },
    })).rejects.toThrow(/artifact_not_visible/);

    await t.run((ctx) => ctx.db.insert("proposals", {
      roomId,
      artifactId,
      op: { opId: "private-proposal", artifactId: String(artifactId), elementId: "u1__company", kind: "set" as const, value: "Private proposed value", baseVersion: 1 },
      author: { kind: "agent" as const, id: "agent_room", name: "Room NodeAgent", scope: "public" as const },
      status: "pending" as const,
      createdAt: now,
    }));
    expect((await t.query(api.artifacts.listProposals, {
      roomId,
      requester: { actor: hostActor, token: hostToken },
    })).map((p) => p.op.value)).toContain("Private proposed value");
    expect(await t.query(api.artifacts.listProposals, {
      roomId,
      requester: { actor: guestActor, token: guestToken },
    })).toEqual([]);

    await expect(t.mutation(api.agentJobs.createOrReuse, {
      roomId,
      artifactId,
      requester: { actor: guestActor, token: guestToken },
      goal: "Research this private upload",
      entrypoint: "public_ask" as const,
      scope: "public_room" as const,
      modelPolicy: "test-model",
      idempotencyKey: "private-artifact-guest-job",
    })).rejects.toThrow(/artifact_not_visible/);
    await expect(t.mutation(api.agentJobs.startFreeAuto, {
      roomId,
      artifactId,
      requester: { actor: guestActor, token: guestToken },
      goal: "Research this private upload",
    })).rejects.toThrow(/artifact_not_visible/);
    await expect(t.mutation(api.agentJobs.startFreeAuto, {
      roomId,
      artifactId,
      requester: { actor: hostActor, token: hostToken },
      goal: "Research this private upload",
    })).rejects.toThrow(/private_artifact_requires_private_job/);

    const agentList = await t.query(internal.artifacts.listForRoom, { roomId });
    expect(agentList.map((a) => a.title)).not.toContain("founder-call.pdf");
    await expect(t.query(internal.artifacts.readRange, {
      roomId,
      artifactId,
      elementIds: ["u1__company"],
    })).rejects.toThrow(/artifact_not_visible/);
  });
});
