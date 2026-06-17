// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";
import { register as registerDebouncer } from "@ikhrustalev/convex-debouncer/test";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts", "../convex/embeddingRunner.ts"]) {
  delete (modules as Record<string, unknown>)[m];
}

const token = "roomactivityTOKEN0123456789abcdefXYZ";

async function seedRoom() {
  const t = convexTest(schema, modules);
  registerDebouncer(t);
  const now = Date.now();
  const roomId = await t.run((ctx) =>
    ctx.db.insert("rooms", {
      code: "ACT001",
      title: "Activity room",
      hostId: "",
      autoAllow: true,
      status: "live" as const,
      createdAt: now,
    }),
  );
  const memberId = await t.run(async (ctx) =>
    ctx.db.insert("members", {
      roomId,
      name: "Host",
      role: "host" as const,
      anon: false,
      color: "#111111",
      authTokenHash: await hashToken(token),
      lastSeenAt: now,
    }),
  );
  const actor = { kind: "user" as const, id: String(memberId), name: "Host" };
  return { t, roomId, proof: { actor, token }, actor };
}

describe("passive room activity and evidence adapters", () => {
  it("dedupes passive activity and scans it after the quiet window", async () => {
    const s = await seedRoom();
    const first = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId,
      requester: s.proof,
      sourceKind: "element",
      sourceId: "artifact:row1__notes",
      sourceVersion: 1,
      sourceHash: "hash-a",
      eventKind: "cell_committed",
      quietMs: 1_000,
    });
    const second = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId,
      requester: s.proof,
      sourceKind: "element",
      sourceId: "artifact:row1__notes",
      sourceVersion: 2,
      sourceHash: "hash-b",
      eventKind: "cell_committed",
      quietMs: 1_000,
    });
    expect(String(second.outboxId)).toBe(String(first.outboxId));

    await s.t.run(async (ctx) => ctx.db.patch(first.outboxId, { quietUntil: Date.now() - 1 }));
    const scan = await s.t.mutation(internal.roomActivity.scanDueActivity, { roomId: s.roomId, limit: 5 });
    expect(scan.scanned).toBe(1);
    const row = await s.t.run((ctx) => ctx.db.get(first.outboxId));
    expect(row?.status).toBe("completed");
    expect(row?.decision).toMatchObject({ action: "consider_room_work", next: "cache_first_noteworthiness" });
    expect(row?.sourceHash).toBe("hash-b");
  });

  it("keeps Convex storage ids canonical while tracking external processing ids separately", async () => {
    const s = await seedRoom();
    const storageId = "kg0000000000000000000000000002" as Id<"_storage">;
    const fileId = await s.t.run((ctx) =>
      ctx.db.insert("uploadedFiles", {
        roomId: s.roomId,
        storageId,
        fileName: "demo.pdf",
        mimeType: "application/pdf",
        size: 1234,
        sha256: "file-hash",
        createdBy: s.actor,
        visibility: "room" as const,
        status: "uploaded" as const,
        createdAt: Date.now(),
      }),
    );

    const queued = await s.t.mutation(api.fileProcessing.queueUploadedFileProcessing, {
      roomId: s.roomId,
      requester: s.proof,
      uploadedFileId: fileId,
      provider: "transloadit",
      purpose: "ocr",
      externalId: "assembly-123",
      inputMeta: { template: "pdf-ocr" },
    });
    await s.t.mutation(internal.fileProcessing.recordTransloaditAssembly, {
      roomId: s.roomId,
      uploadedFileId: fileId,
      storageId: String(storageId),
      assemblyId: "assembly-123",
      status: "completed",
      purpose: "ocr",
      resultUrls: ["https://example.invalid/result.txt"],
      actor: s.actor,
      visibility: "room",
    });
    const jobs = await s.t.query(api.fileProcessing.listForFile, {
      roomId: s.roomId,
      requester: s.proof,
      uploadedFileId: fileId,
    });
    expect(jobs).toHaveLength(1);
    expect(String(jobs[0]._id)).toBe(String(queued.jobId));
    expect(jobs[0]).toMatchObject({
      storageId: String(storageId),
      provider: "transloadit",
      externalId: "assembly-123",
      status: "completed",
      purpose: "ocr",
    });
  });

  it("records source captures and evidence facts for agent CellPayload provenance", async () => {
    const s = await seedRoom();
    const captureId = await s.t.mutation(internal.evidence.recordSourceCapture, {
      roomId: s.roomId,
      sourceUrl: "https://example.com",
      sourceTitle: "Example Domain",
      sourceKind: "web",
      contentHash: "capture-hash",
      provider: "firecrawl",
      visibility: "room",
    });
    await s.t.mutation(internal.evidence.recordEvidenceFact, {
      roomId: s.roomId,
      captureId,
      factId: "example-heading",
      label: "page_heading",
      value: "Example Domain",
      confidence: "high",
      checks: { sourceUrl: "https://example.com" },
      usedBy: [{ kind: "cell", id: "r1__source" }],
    });
    const facts = await s.t.query(api.evidence.listEvidenceForRoom, { roomId: s.roomId, requester: s.proof });
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ factId: "example-heading", label: "page_heading", value: "Example Domain" });
    expect(String(facts[0].captureId)).toBe(String(captureId));
  });
});
