// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const modules = import.meta.glob("../convex/**/*.ts");
delete (modules as Record<string, unknown>)["../convex/agent.ts"];
delete (modules as Record<string, unknown>)["../convex/agentJobRunner.ts"];
delete (modules as Record<string, unknown>)["../convex/agentWorkflows.ts"];
delete (modules as Record<string, unknown>)["../convex/embeddingRunner.ts"];

describe("citation PDF resolver", () => {
  it("resolves source-file-backed PDFs with normalized filename matching", async () => {
    const t = convexTest(schema, modules);
    const now = Date.now();
    const roomId = await t.run((ctx) =>
      ctx.db.insert("rooms", {
        code: "PDFCITE",
        title: "PDF cite room",
        hostId: "",
        autoAllow: true,
        status: "live" as const,
        createdAt: now,
      }),
    );
    const actor = { kind: "user" as const, id: "host", name: "Host" };
    const storageId = "kg0000000000000000000000000000" as Id<"_storage">;
    await t.run((ctx) =>
      ctx.db.insert("uploadedFiles", {
        roomId,
        storageId,
        fileName: "CAPRICOR THERAPEUTICS,\u00a0INC._December 31, 2024 10K.pdf",
        mimeType: "application/pdf",
        size: 3_800_000,
        createdBy: actor,
        visibility: "room" as const,
        status: "linked" as const,
        createdAt: now,
      }),
    );

    const resolved = await t.query(internal.citations.roomPdf, {
      roomId,
      fileName: "Capricor Therapeutics Inc December 31 2024 10K",
    });

    expect(resolved).toMatchObject({
      storageId,
      fileName: "CAPRICOR THERAPEUTICS,\u00a0INC._December 31, 2024 10K.pdf",
    });
  });
});
