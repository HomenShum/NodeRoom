// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";
import type { Id } from "../convex/_generated/dataModel";
import { register as registerDebouncer } from "@ikhrustalev/convex-debouncer/test";

const modules = import.meta.glob("../convex/**/*.ts");
for (const m of ["../convex/agent.ts", "../convex/agentJobRunner.ts", "../convex/agentWorkflows.ts"]) {
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
  const artifactId = await t.run((ctx) =>
    ctx.db.insert("artifacts", {
      roomId,
      kind: "sheet" as const,
      title: "Research sheet",
      version: 1,
      order: [],
      updatedAt: now,
      createdBy: actor,
      visibility: "room" as const,
    }),
  );
  return { t, roomId, artifactId, proof: { actor, token }, actor };
}

describe("passive room activity and evidence adapters", () => {
  it("dedupes passive activity and scans it after the quiet window", async () => {
    const s = await seedRoom();
    const elementId = "row1__notes";
    await s.t.run((ctx) =>
      ctx.db.insert("elements", {
        artifactId: s.artifactId,
        elementId,
        version: 2,
        value: { value: "formatting cleanup only" },
        updatedAt: Date.now(),
        updatedBy: s.actor,
      }),
    );
    const sourceId = `${String(s.artifactId)}:${elementId}`;
    const first = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId,
      requester: s.proof,
      sourceKind: "element",
      sourceId,
      sourceVersion: 1,
      sourceHash: "hash-a",
      eventKind: "cell_committed",
      quietMs: 1_000,
    });
    const second = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId,
      requester: s.proof,
      sourceKind: "element",
      sourceId,
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
    expect(row?.status).toBe("not_noteworthy");
    expect(row?.decision).toMatchObject({ action: "ignore", reason: "low_score" });
    expect(row?.sourceHash).toBe("hash-b");
  });

  it("promotes high-signal passive cells into durable agent jobs and work items", async () => {
    const s = await seedRoom();
    const elementId = "row2__notes";
    await s.t.run((ctx) =>
      ctx.db.insert("elements", {
        artifactId: s.artifactId,
        elementId,
        version: 1,
        value: {
          value: "Acme Health Inc announced Series A funding, revenue growth, product launch, hospital customer pilot, verify source https://example.com",
        },
        updatedAt: Date.now(),
        updatedBy: s.actor,
      }),
    );
    const queued = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId,
      requester: s.proof,
      sourceKind: "element",
      sourceId: `${String(s.artifactId)}:${elementId}`,
      sourceVersion: 1,
      sourceHash: "hash-high",
      eventKind: "cell_committed",
      quietMs: 1_000,
    });

    await s.t.run(async (ctx) => ctx.db.patch(queued.outboxId, { quietUntil: Date.now() - 1 }));
    await s.t.mutation(internal.roomActivity.scanDueActivity, { roomId: s.roomId, limit: 5 });

    const { row, job, workItems, operations } = await s.t.run(async (ctx) => {
      const row = await ctx.db.get(queued.outboxId);
      const job = row?.latestJobId ? await ctx.db.get(row.latestJobId) : null;
      const workItems = row?.latestJobId ? await ctx.db.query("entityWorkItems").withIndex("by_job", (q) => q.eq("jobId", row.latestJobId!)).collect() : [];
      const operations = row?.latestJobId ? await ctx.db.query("agentOperationEvents").withIndex("by_job_sequence", (q) => q.eq("jobId", row.latestJobId!)).collect() : [];
      return { row, job, workItems, operations };
    });

    expect(row?.status).toBe("failed");
    expect(row?.error).toContain("workflow_start_failed");
    expect(job).toMatchObject({
      entrypoint: "room_work",
      routePolicy: "free_auto",
      runtimePolicy: "workflow_sliced",
      modelPolicy: "openrouter/free-auto",
      status: "failed",
    });
    expect(job?.request?.passiveActivity?.finding?.action).toBe("start_research_job");
    expect(workItems.length).toBeGreaterThan(0);
    expect(workItems.every((item) => item.cachePolicy === "missing_research_now")).toBe(true);
    expect(operations.map((event) => event.name)).toEqual(expect.arrayContaining(["roomActivity.scanDueActivity", "agentWorkflows.freeAutoWorkflow start failed"]));
  });

  it("routes notebook edits through the same passive activity outbox", async () => {
    const s = await seedRoom();
    const notebook = await s.t.mutation(api.notebookGraph.createNotebook, {
      roomId: s.roomId,
      title: "Deal notes",
      requester: s.proof,
      visibility: "room",
    });
    const child = await s.t.mutation(api.notebookGraph.createChildNode, {
      notebookId: notebook.notebookId,
      parentId: notebook.rootNodeId,
      requester: s.proof,
      title: "Acme diligence",
      content: "Acme Health Inc announced Series A funding. Verify product launch and hospital customer pilot.",
      kind: "note",
      expectedParentVersion: 1,
    });

    const row = await s.t.run(async (ctx) =>
      ctx.db
        .query("roomActivityOutbox")
        .withIndex("by_room_source", (q) => q.eq("roomId", s.roomId).eq("sourceKind", "node").eq("sourceId", String(child.nodeId)))
        .unique(),
    );

    expect(row).toMatchObject({
      sourceKind: "node",
      sourceId: String(child.nodeId),
      sourceVersion: 1,
      eventKind: "content_committed",
      status: "queued",
    });
  });

  it("keeps noteworthy API as a wrapper over the unified scanner", async () => {
    const s = await seedRoom();
    const elementId = "row3__notes";
    await s.t.run((ctx) =>
      ctx.db.insert("elements", {
        artifactId: s.artifactId,
        elementId,
        version: 1,
        value: { value: "note is short" },
        updatedAt: Date.now(),
        updatedBy: s.actor,
      }),
    );
    const sourceId = `${String(s.artifactId)}:${elementId}`;
    const queued = await s.t.mutation(api.noteworthy.debounceActivityScan, {
      roomId: s.roomId,
      requester: s.proof,
      sourceKind: "element",
      sourceId,
      sourceVersion: 1,
      sourceHash: "legacy-hash",
      visibility: "room",
      eventKind: "cell_committed",
      debounceMs: 1_000,
    });
    const scanned = await s.t.mutation(internal.noteworthy.scanActivity, {
      roomId: s.roomId,
      sourceKind: "element",
      sourceId,
      expectedVersion: 1,
      expectedHash: "legacy-hash",
    });
    const row = await s.t.run((ctx) => ctx.db.get(queued.outboxId));

    expect(scanned).toMatchObject({ status: "not_noteworthy", action: "ignore" });
    expect(row?.status).toBe("not_noteworthy");
    expect(row?.dedupeKey).toContain("activity:");
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
