// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"];
delete (modules as Record<string, unknown>)["../convex/agentJobRunner.ts"];
delete (modules as Record<string, unknown>)["../convex/agentWorkflows.ts"];
delete (modules as Record<string, unknown>)["../convex/embeddingRunner.ts"];

const token = "0123456789abcdefghijklmnopqrstuvwxyzTOKEN";

describe("uploaded file storage contract", () => {
  it("links a parsed artifact back to the canonical Convex storage file", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const authTokenHash = await hashToken(token);
    const roomId = await t.run((ctx) =>
      ctx.db.insert("rooms", {
        code: "FILE01",
        title: "File room",
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
    const actor = { kind: "user" as const, id: String(memberId), name: "Host" };
    const proof = { actor, token };
    const storageId = "kg0000000000000000000000000000" as Id<"_storage">;
    const sourceFileId = await t.run((ctx) =>
      ctx.db.insert("uploadedFiles", {
        roomId,
        storageId,
        fileName: "companies.csv",
        mimeType: "text/csv",
        size: 128,
        sha256: "abc123",
        createdBy: actor,
        visibility: "room" as const,
        status: "uploaded" as const,
        createdAt: now,
      }),
    );

    const artifactId = await t.mutation(api.artifacts.createArtifact, {
      roomId,
      kind: "sheet",
      title: "companies.csv",
      seed: [{ id: "u1__company", value: "Acme" }],
      meta: { upload: { fileName: "companies.csv", mimeType: "text/csv", size: 128, parsedAt: now } },
      sourceFileId,
      proof,
    });

    const { artifact, sourceFile } = await t.run(async (ctx) => ({
      artifact: await ctx.db.get(artifactId),
      sourceFile: await ctx.db.get(sourceFileId),
    }));

    expect(artifact?.meta?.upload).toMatchObject({
      fileName: "companies.csv",
      mimeType: "text/csv",
      size: 128,
      sourceStorageId: String(storageId),
      uploadedFileId: String(sourceFileId),
      sha256: "abc123",
    });
    expect(String(sourceFile?.artifactId)).toBe(String(artifactId));
    expect(sourceFile?.status).toBe("linked");
  });
});
