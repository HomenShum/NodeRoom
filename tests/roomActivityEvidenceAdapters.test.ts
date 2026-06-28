// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it } from "vitest";
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

// Passive auto-execution is OFF by default (doctrine: notice passively, act explicitly —
// see passiveCreateAgentJobsEnabled in convex/roomActivity.ts). A test that opts into
// auto-execution sets PASSIVE_CREATE_AGENT_JOBS; restore the original after every test so
// the flag never leaks into the notice-only default cases.
const ORIGINAL_PASSIVE_FLAG = process.env.PASSIVE_CREATE_AGENT_JOBS;
afterEach(() => {
  if (ORIGINAL_PASSIVE_FLAG === undefined) delete process.env.PASSIVE_CREATE_AGENT_JOBS;
  else process.env.PASSIVE_CREATE_AGENT_JOBS = ORIGINAL_PASSIVE_FLAG;
});

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

  it("scans due activity by room so another room cannot starve it", async () => {
    const s = await seedRoom();
    const now = Date.now();
    const otherRoomId = await s.t.run((ctx) =>
      ctx.db.insert("rooms", {
        code: "ACT002",
        title: "Other room",
        hostId: "",
        autoAllow: true,
        status: "live" as const,
        createdAt: now,
      }),
    );
    const otherMemberId = await s.t.run(async (ctx) =>
      ctx.db.insert("members", {
        roomId: otherRoomId,
        name: "Other Host",
        role: "host" as const,
        anon: false,
        color: "#333333",
        authTokenHash: await hashToken("otherStrongTOKEN0123456789abcdefXYZqqq"),
        lastSeenAt: now,
      }),
    );
    const otherActor = { kind: "user" as const, id: String(otherMemberId), name: "Other Host" };
    const otherArtifactId = await s.t.run((ctx) =>
      ctx.db.insert("artifacts", {
        roomId: otherRoomId,
        kind: "sheet" as const,
        title: "Other sheet",
        version: 1,
        order: ["other__notes"],
        updatedAt: now,
        createdBy: otherActor,
        visibility: "room" as const,
      }),
    );
    await s.t.run((ctx) => ctx.db.insert("elements", {
      artifactId: otherArtifactId,
      elementId: "other__notes",
      version: 1,
      value: { value: "formatting cleanup only" },
      updatedAt: now,
      updatedBy: otherActor,
    }));
    await s.t.run((ctx) => ctx.db.insert("roomActivityOutbox", {
      roomId: otherRoomId,
      sourceKind: "element",
      sourceId: `${String(otherArtifactId)}:other__notes`,
      sourceVersion: 1,
      sourceHash: "other-hash",
      eventKind: "cell_committed",
      status: "queued",
      actor: otherActor,
      visibility: "room",
      dedupeKey: "activity:other:1",
      quietUntil: now - 10_000,
      maxWaitAt: now + 10_000,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }));

    const hostRowId = await s.t.run((ctx) => ctx.db.insert("roomActivityOutbox", {
      roomId: s.roomId,
      sourceKind: "element",
      sourceId: `${String(s.artifactId)}:room__notes`,
      sourceVersion: 1,
      sourceHash: "room-hash",
      eventKind: "cell_committed",
      status: "queued",
      actor: s.actor,
      visibility: "room",
      dedupeKey: "activity:room:1",
      quietUntil: now - 5_000,
      maxWaitAt: now + 10_000,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    }));
    await s.t.run((ctx) => ctx.db.insert("elements", {
      artifactId: s.artifactId,
      elementId: "room__notes",
      version: 1,
      value: { value: "formatting cleanup only" },
      updatedAt: now,
      updatedBy: s.actor,
    }));

    const scan = await s.t.mutation(internal.roomActivity.scanDueActivity, { roomId: s.roomId, limit: 1 });
    expect(scan.scanned).toBe(1);
    const row = await s.t.run((ctx) => ctx.db.get(hostRowId));
    expect(row?.status).toBe("not_noteworthy");
  });

  it("promotes high-signal passive cells into durable agent jobs and work items (auto-execution opt-in)", async () => {
    // The default doctrine is notice-only; the auto-create-job path runs only when
    // PASSIVE_CREATE_AGENT_JOBS is explicitly enabled. This test covers that opt-in path
    // (job/workItems/agentOperationEvents machinery); afterEach restores the default.
    process.env.PASSIVE_CREATE_AGENT_JOBS = "true";
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
    expect(operations.map((event) => event.name)).toEqual(expect.arrayContaining(["roomActivity.scanDueActivity", "agentWorkflows.passiveRoomWorkWorkflow start failed"]));
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

  it("surfaces the passive-intelligence feed as a slim client contract across statuses", async () => {
    const s = await seedRoom();
    // Low-signal cell → not_noteworthy (settled, quiet).
    const lowEl = "feed_low__notes";
    await s.t.run((ctx) =>
      ctx.db.insert("elements", {
        artifactId: s.artifactId,
        elementId: lowEl,
        version: 1,
        value: { value: "formatting cleanup only" },
        updatedAt: Date.now(),
        updatedBy: s.actor,
      }),
    );
    const low = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId, requester: s.proof, sourceKind: "element",
      sourceId: `${String(s.artifactId)}:${lowEl}`, sourceVersion: 1, sourceHash: "feed-low",
      eventKind: "cell_committed", quietMs: 1_000,
    });
    await s.t.run((ctx) => ctx.db.patch(low.outboxId, { quietUntil: Date.now() - 1 }));
    await s.t.mutation(internal.roomActivity.scanDueActivity, { roomId: s.roomId, limit: 5 });

    // High-signal cell → noteworthy suggestion. Default doctrine is notice passively, act
    // explicitly: passive detection surfaces an inbox suggestion but spins up NO agent job.
    const highEl = "feed_high__notes";
    await s.t.run((ctx) =>
      ctx.db.insert("elements", {
        artifactId: s.artifactId,
        elementId: highEl,
        version: 1,
        value: { value: "Acme Health Inc announced Series A funding, product launch, hospital customer pilot, verify source https://example.com" },
        updatedAt: Date.now(),
        updatedBy: s.actor,
      }),
    );
    const high = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId, requester: s.proof, sourceKind: "element",
      sourceId: `${String(s.artifactId)}:${highEl}`, sourceVersion: 1, sourceHash: "feed-high",
      eventKind: "cell_committed", quietMs: 1_000,
    });
    await s.t.run((ctx) => ctx.db.patch(high.outboxId, { quietUntil: Date.now() - 1 }));
    await s.t.mutation(internal.roomActivity.scanDueActivity, { roomId: s.roomId, limit: 5 });

    const feed = await s.t.query(api.roomActivity.feed, { roomId: s.roomId, requester: s.proof });
    expect(feed.length).toBeGreaterThanOrEqual(2);

    const lowRow = feed.find((r) => r.textPreview === "formatting cleanup only");
    const highRow = feed.find((r) => r.entityNames.includes("Acme Health Inc"));

    expect(lowRow).toMatchObject({ status: "not_noteworthy", action: "ignore", entityNames: [] });
    expect(lowRow?.score).toBeLessThan(0.35); // below the research threshold
    // The slim contract must NOT leak raw finding/decision blobs.
    expect(lowRow).not.toHaveProperty("finding");
    expect(lowRow).not.toHaveProperty("decision");

    expect(highRow).toMatchObject({ status: "noteworthy", action: "start_research_job", sourceKind: "element" });
    expect(highRow?.entityNames).toContain("Acme Health Inc");
    expect(highRow?.score).toBeGreaterThanOrEqual(0.75);
    expect(highRow?.latestJobId).toBeUndefined(); // notice-only default spins up no agent job
    expect(highRow?.textPreview).toContain("Acme Health Inc");
  });

  it("rejects the passive feed for a requester without room proof", async () => {
    const s = await seedRoom();
    await expect(
      s.t.query(api.roomActivity.feed, { roomId: s.roomId, requester: { actor: s.actor, token: "wrong-token" } }),
    ).rejects.toThrow();
  });

  it("hides another member's private passive activity from the room feed", async () => {
    const s = await seedRoom();
    // Seed a second room member (the "owner" of the private note).
    const guestToken = "guestTokenTOKEN0123456789abcdefXYZ";
    const guestId = await s.t.run(async (ctx) =>
      ctx.db.insert("members", {
        roomId: s.roomId,
        name: "Guest",
        role: "member" as const,
        anon: false,
        color: "#222222",
        authTokenHash: await hashToken(guestToken),
        lastSeenAt: Date.now(),
      }),
    );
    const guestActor = { kind: "user" as const, id: String(guestId), name: "Guest" };
    const guestProof = { actor: guestActor, token: guestToken };

    // Guest enqueues a PRIVATE noteworthy cell directly into the outbox (bypass the scanner so
    // the row stays visible with full content to test the feed's visibility filter).
    const now = Date.now();
    const privateRowId = await s.t.run((ctx) =>
      ctx.db.insert("roomActivityOutbox", {
        roomId: s.roomId,
        sourceKind: "element",
        sourceId: `${String(s.artifactId)}:private_cell`,
        sourceVersion: 1,
        sourceHash: "private-hash",
        eventKind: "cell_committed",
        status: "noteworthy",
        actor: guestActor,
        visibility: "private",
        ownerId: String(guestId),
        dedupeKey: "activity:private:1",
        quietUntil: now,
        attempts: 0,
        decision: { action: "create_coach_cue", text: "Top secret guest diligence note about CardioNova." },
        finding: { score: 0.6, action: "create_coach_cue", reasons: ["organization_candidate"], facets: [], entities: [{ displayName: "CardioNova" }] },
        createdAt: now,
        updatedAt: now,
      }),
    );
    // A room-visible row the host SHOULD see.
    await s.t.run((ctx) =>
      ctx.db.insert("roomActivityOutbox", {
        roomId: s.roomId,
        sourceKind: "element",
        sourceId: `${String(s.artifactId)}:public_cell`,
        sourceVersion: 1,
        sourceHash: "public-hash",
        eventKind: "cell_committed",
        status: "noteworthy",
        actor: s.actor,
        visibility: "room",
        dedupeKey: "activity:room:1",
        quietUntil: now,
        attempts: 0,
        decision: { action: "create_coach_cue", text: "Room-visible CardioNova note." },
        finding: { score: 0.6, action: "create_coach_cue", reasons: ["organization_candidate"], facets: [], entities: [{ displayName: "CardioNova" }] },
        createdAt: now,
        updatedAt: now,
      }),
    );

    // Host's feed: sees the room row, must NOT see the guest's private row or its content.
    const hostFeed = await s.t.query(api.roomActivity.feed, { roomId: s.roomId, requester: s.proof });
    expect(hostFeed.some((r) => r.id === String(privateRowId))).toBe(false);
    expect(hostFeed.some((r) => r.textPreview.includes("Top secret guest"))).toBe(false);
    expect(hostFeed.some((r) => r.visibility === "room")).toBe(true);

    // Guest's own feed: sees their private row WITH content.
    const guestFeed = await s.t.query(api.roomActivity.feed, { roomId: s.roomId, requester: guestProof });
    const ownPrivate = guestFeed.find((r) => r.id === String(privateRowId));
    expect(ownPrivate).toBeTruthy();
    expect(ownPrivate?.textPreview).toContain("Top secret guest");
    expect(ownPrivate?.visibility).toBe("private");
  });

  it("excludes outbox rows older than the 2-day staleness cutoff from the feed", async () => {
    const s = await seedRoom();
    const now = Date.now();
    const stale = now - 3 * 24 * 60 * 60 * 1000; // 3 days ago — outside the window
    await s.t.run((ctx) =>
      ctx.db.insert("roomActivityOutbox", {
        roomId: s.roomId,
        sourceKind: "element",
        sourceId: `${String(s.artifactId)}:stale_cell`,
        sourceVersion: 1,
        sourceHash: "stale-hash",
        eventKind: "cell_committed",
        status: "failed",
        actor: s.actor,
        visibility: "room",
        dedupeKey: "activity:stale:1",
        quietUntil: stale,
        attempts: 1,
        error: "old_failure",
        decision: { action: "start_research_job", text: "Old stale failure that should not resurface." },
        finding: { score: 0.8, action: "start_research_job", reasons: ["organization_candidate"], facets: [], entities: [{ displayName: "OldCo" }] },
        createdAt: stale,
        updatedAt: stale,
      }),
    );
    const fresh = now - 60_000; // 1 minute ago — inside the window
    await s.t.run((ctx) =>
      ctx.db.insert("roomActivityOutbox", {
        roomId: s.roomId,
        sourceKind: "element",
        sourceId: `${String(s.artifactId)}:fresh_cell`,
        sourceVersion: 1,
        sourceHash: "fresh-hash",
        eventKind: "cell_committed",
        status: "noteworthy",
        actor: s.actor,
        visibility: "room",
        dedupeKey: "activity:fresh:1",
        quietUntil: fresh,
        attempts: 0,
        decision: { action: "create_coach_cue", text: "Fresh noteworthy activity." },
        finding: { score: 0.6, action: "create_coach_cue", reasons: ["organization_candidate"], facets: [], entities: [{ displayName: "FreshCo" }] },
        createdAt: fresh,
        updatedAt: fresh,
      }),
    );

    const feed = await s.t.query(api.roomActivity.feed, { roomId: s.roomId, requester: s.proof });
    expect(feed.some((r) => r.entityNames.includes("OldCo"))).toBe(false); // stale dropped
    expect(feed.some((r) => r.entityNames.includes("FreshCo"))).toBe(true); // fresh kept
  });

  it("does not let other members' private rows crowd out shared rows in the feed", async () => {
    const s = await seedRoom();
    const guestToken = "guestTokenTOKEN0123456789abcdefXYZ";
    const guestId = await s.t.run(async (ctx) =>
      ctx.db.insert("members", {
        roomId: s.roomId,
        name: "Guest",
        role: "member" as const,
        anon: false,
        color: "#222222",
        authTokenHash: await hashToken(guestToken),
        lastSeenAt: Date.now(),
      }),
    );
    const guestActor = { kind: "user" as const, id: String(guestId), name: "Guest" };
    const now = Date.now();

    // Guest creates 10 private rows (newer than the shared row so they'd crowd take slots
    // if the query fetched all visibilities before filtering).
    for (let i = 0; i < 10; i++) {
      await s.t.run((ctx) =>
        ctx.db.insert("roomActivityOutbox", {
          roomId: s.roomId, sourceKind: "element", sourceId: `art:priv${i}`, sourceVersion: 1,
          sourceHash: `priv-hash-${i}`, eventKind: "cell_committed", status: "noteworthy",
          actor: guestActor, visibility: "private", ownerId: String(guestId),
          dedupeKey: `activity:priv:${i}`, quietUntil: now, attempts: 0,
          decision: { action: "create_coach_cue", text: `Guest private ${i}` },
          finding: { score: 0.6, action: "create_coach_cue", reasons: ["organization_candidate"], facets: [], entities: [{ displayName: "GuestPrivate" }] },
          createdAt: now - i * 1000, updatedAt: now - i * 1000,
        }),
      );
    }
    // Host's shared row — older than the guest's private rows but must still appear.
    await s.t.run((ctx) =>
      ctx.db.insert("roomActivityOutbox", {
        roomId: s.roomId, sourceKind: "element", sourceId: "art:shared", sourceVersion: 1,
        sourceHash: "shared-hash", eventKind: "cell_committed", status: "noteworthy",
        actor: s.actor, visibility: "room",
        dedupeKey: "activity:shared:1", quietUntil: now, attempts: 0,
        decision: { action: "create_coach_cue", text: "Host shared note." },
        finding: { score: 0.6, action: "create_coach_cue", reasons: ["organization_candidate"], facets: [], entities: [{ displayName: "HostShared" }] },
        createdAt: now - 20_000, updatedAt: now - 20_000,
      }),
    );

    const hostFeed = await s.t.query(api.roomActivity.feed, { roomId: s.roomId, requester: s.proof });
    // The shared row must still be present despite 10 newer private rows from another member.
    expect(hostFeed.some((r) => r.entityNames.includes("HostShared"))).toBe(true);
    // No private content from the guest leaks.
    expect(hostFeed.some((r) => r.textPreview.includes("Guest private"))).toBe(false);
    expect(hostFeed.every((r) => r.visibility !== "private")).toBe(true);
  });

  it("gives each actor an independent quiet window (per-actor dedupe key)", async () => {
    // Two users writing to the same element must each get their own outbox row
    // so no single slow typist starves the others' debounce timers.
    const s = await seedRoom();
    const elementId = "actor-test-row__notes";
    const sourceId = `${String(s.artifactId)}:${elementId}`;
    await s.t.run((ctx) =>
      ctx.db.insert("elements", {
        artifactId: s.artifactId, elementId, version: 1,
        value: { value: "shared element content" },
        updatedAt: Date.now(), updatedBy: s.actor,
      }),
    );

    const guestToken = "guestACTOR0000TOKEN0123456789abcdefXYZQQQ";
    const guestId = await s.t.run(async (ctx) =>
      ctx.db.insert("members", {
        roomId: s.roomId, name: "Guest", role: "member" as const, anon: false, color: "#222222",
        authTokenHash: await hashToken(guestToken), lastSeenAt: Date.now(),
      }),
    );
    const guestActor = { kind: "user" as const, id: String(guestId), name: "Guest" };
    const guestProof = { actor: guestActor, token: guestToken };

    // Both actors enqueue for the SAME source element.
    const hostEnqueue = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId, requester: s.proof, sourceKind: "element", sourceId,
      sourceVersion: 1, sourceHash: "hash-host", eventKind: "cell_committed", quietMs: 1_000,
    });
    const guestEnqueue = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId, requester: guestProof, sourceKind: "element", sourceId,
      sourceVersion: 1, sourceHash: "hash-guest", eventKind: "cell_committed", quietMs: 1_000,
    });

    // Independent rows — host's edit did NOT collide into the guest's debounce bucket.
    expect(String(hostEnqueue.outboxId)).not.toBe(String(guestEnqueue.outboxId));
    // Dedupe keys are actor-scoped (contain the actor's member ID).
    expect(hostEnqueue.dedupeKey).toContain(String(s.actor.id));
    expect(guestEnqueue.dedupeKey).toContain(String(guestId));
    // A second host enqueue dedupes into the SAME host row (not a new one).
    const hostEnqueue2 = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId, requester: s.proof, sourceKind: "element", sourceId,
      sourceVersion: 2, sourceHash: "hash-host-2", eventKind: "cell_committed", quietMs: 1_000,
    });
    expect(String(hostEnqueue2.outboxId)).toBe(String(hostEnqueue.outboxId));
  });

  it("caps the debounce delay at maxWaitAt so a slow typist still fires exactly one scan", async () => {
    const s = await seedRoom();
    const now = Date.now();
    const elementId = "maxwait-test-row__notes";
    const sourceId = `${String(s.artifactId)}:${elementId}`;
    await s.t.run((ctx) =>
      ctx.db.insert("elements", {
        artifactId: s.artifactId, elementId, version: 1,
        value: { value: "long typing session" },
        updatedAt: now, updatedBy: s.actor,
      }),
    );

    const first = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId, requester: s.proof, sourceKind: "element", sourceId,
      sourceVersion: 1, sourceHash: "hash-1", eventKind: "cell_committed", quietMs: 12_000,
    });
    const row1 = await s.t.run((ctx) => ctx.db.get(first.outboxId));
    expect(row1?.maxWaitAt).toBeDefined();
    const hardDeadline = row1!.maxWaitAt!;

    // Simulate maxWaitAt already elapsed by patching it to the past.
    await s.t.run((ctx) => ctx.db.patch(first.outboxId, { maxWaitAt: now - 1_000 }));

    // The second enqueue should still use this outbox row (same dedupe key = same actor + source).
    const second = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId, requester: s.proof, sourceKind: "element", sourceId,
      sourceVersion: 2, sourceHash: "hash-2", eventKind: "cell_committed", quietMs: 12_000,
    });
    expect(String(second.outboxId)).toBe(String(first.outboxId));

    // Because maxWaitAt is in the past, the effective delay collapses to 1ms (Math.max(1, ...)).
    // quietUntil should be very close to now (not pushed out 12 more seconds).
    const row2 = await s.t.run((ctx) => ctx.db.get(second.outboxId));
    expect(row2?.quietUntil).toBeLessThanOrEqual(Date.now() + 100);

    // Hard deadline must be preserved from the first insert (not bumped by the second enqueue).
    expect(row2?.maxWaitAt).toBeDefined();
    expect(row2!.maxWaitAt!).toBeLessThan(hardDeadline + 2_000);
    void hardDeadline;
  });

  it("dismiss action sets status to ignored and the chip stops counting it", async () => {
    const s = await seedRoom();
    const rowId = await s.t.run((ctx) =>
      ctx.db.insert("roomActivityOutbox", {
        roomId: s.roomId, sourceKind: "element", sourceId: "art:el1", sourceVersion: 1,
        sourceHash: "hash-dismiss", eventKind: "cell_committed", status: "noteworthy",
        actor: s.actor, visibility: "room",
        dedupeKey: "activity:dismiss:test:1", quietUntil: Date.now(), attempts: 0,
        decision: { action: "create_coach_cue", text: "CardioNova funding signal." },
        finding: { score: 0.6, action: "create_coach_cue", reasons: ["organization_candidate"], facets: [], entities: [] },
        createdAt: Date.now(), updatedAt: Date.now(),
      }),
    );

    const result = await s.t.mutation(api.roomActivity.dismissActivity, {
      activityId: rowId,
      roomId: s.roomId,
      requester: s.proof,
    });
    expect(result.ok).toBe(true);

    const row = await s.t.run((ctx) => ctx.db.get(rowId));
    expect(row?.status).toBe("ignored");
  });

  it("rejects dismiss and research on ownerless private rows", async () => {
    const s = await seedRoom();
    const now = Date.now();
    const rowId = await s.t.run((ctx) =>
      ctx.db.insert("roomActivityOutbox", {
        roomId: s.roomId,
        sourceKind: "element",
        sourceId: `${String(s.artifactId)}:private_ownerless`,
        sourceVersion: 1,
        sourceHash: "ownerless-hash",
        eventKind: "cell_committed",
        status: "noteworthy",
        actor: s.actor,
        visibility: "private",
        dedupeKey: "activity:ownerless:1",
        quietUntil: now,
        attempts: 0,
        decision: { action: "start_research_job", text: "Private CardioNova note." },
        finding: { score: 0.8, action: "start_research_job", reasons: ["organization_candidate"], facets: ["funding"], entities: [{ type: "company", displayName: "CardioNova", entityKey: "cardionova", confidence: 0.9 }] },
        createdAt: now,
        updatedAt: now,
      }),
    );

    const dismiss = await s.t.mutation(api.roomActivity.dismissActivity, {
      activityId: rowId,
      roomId: s.roomId,
      requester: s.proof,
    });
    expect(dismiss).toMatchObject({ ok: false, reason: "not_owner" });

    const research = await s.t.mutation(api.roomActivity.researchActivity, {
      activityId: rowId,
      roomId: s.roomId,
      requester: s.proof,
    });
    expect(research).toMatchObject({ ok: false, reason: "not_owner" });
  });

  it("manual research action reuses passive room-work admission and links latestJobId", async () => {
    const s = await seedRoom();
    const now = Date.now();
    const rowId = await s.t.run((ctx) =>
      ctx.db.insert("roomActivityOutbox", {
        roomId: s.roomId,
        sourceKind: "element",
        sourceId: `${String(s.artifactId)}:manual_research`,
        sourceVersion: 1,
        sourceHash: "manual-research-hash",
        eventKind: "cell_committed",
        status: "noteworthy",
        actor: s.actor,
        visibility: "room",
        dedupeKey: "activity:manual_research:1",
        quietUntil: now,
        attempts: 0,
        decision: { status: "noteworthy", action: "start_research_job", text: "CardioNova raised funding and needs runway diligence." },
        finding: { score: 0.82, action: "start_research_job", reasons: ["organization_candidate", "finance_signal"], facets: ["funding", "runway_inputs"], entities: [{ type: "company", displayName: "CardioNova", entityKey: "cardionova", confidence: 0.92 }] },
        createdAt: now,
        updatedAt: now,
      }),
    );

    const result = await s.t.mutation(api.roomActivity.researchActivity, {
      activityId: rowId,
      roomId: s.roomId,
      requester: s.proof,
    });
    expect(result.ok).toBe(true);

    const { row, job, workItems } = await s.t.run(async (ctx) => {
      const row = await ctx.db.get(rowId);
      const job = row?.latestJobId ? await ctx.db.get(row.latestJobId) : null;
      const workItems = row?.latestJobId ? await ctx.db.query("entityWorkItems").withIndex("by_job", (q) => q.eq("jobId", row.latestJobId!)).collect() : [];
      return { row, job, workItems };
    });

    expect(row?.latestJobId).toBeTruthy();
    expect(row?.decision?.job?.jobId).toBe(row?.latestJobId);
    expect(row?.status).toBe("failed");
    expect(job?.entrypoint).toBe("room_work");
    expect(job?.request?.passiveActivity?.finding?.action).toBe("start_research_job");
    expect(workItems.length).toBeGreaterThan(0);
  });

  it("adds passive sheet rows without clobbering an existing research row", async () => {
    const s = await seedRoom();
    const now = Date.now();
    await s.t.run(async (ctx) => {
      const insert = async (elementId: string, value: string) => {
        await ctx.db.insert("elements", { artifactId: s.artifactId, elementId, value, version: 1, updatedAt: now, updatedBy: s.actor });
      };
      await insert("rc_cardionova__company", "CardioNova");
      await insert("rc_cardionova__website", "https://cardionova.example");
      await insert("rc_cardionova__tier", "A");
      await insert("rc_cardionova__summary", "Existing sourced summary.");
      await ctx.db.patch(s.artifactId, {
        order: ["rc_cardionova__company", "rc_cardionova__website", "rc_cardionova__tier", "rc_cardionova__summary"],
        updatedAt: now,
      });
    });

    const existing = await s.t.mutation(api.artifacts.ensurePassiveResearchRow, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.proof,
      company: "CardioNova",
    });
    expect(existing).toEqual({ rowId: "rc_cardionova", created: false });

    const created = await s.t.mutation(api.artifacts.ensurePassiveResearchRow, {
      roomId: s.roomId,
      artifactId: s.artifactId,
      requester: s.proof,
      company: "NewCo",
    });
    expect(created.created).toBe(true);
    expect(created.rowId).toMatch(/^rc_newco/);

    const values = await s.t.run(async (ctx) => {
      const summary = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", s.artifactId).eq("elementId", "rc_cardionova__summary")).unique();
      const tier = await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", s.artifactId).eq("elementId", "rc_cardionova__tier")).unique();
      const newCompany = created.rowId
        ? await ctx.db.query("elements").withIndex("by_artifact", (q) => q.eq("artifactId", s.artifactId).eq("elementId", `${created.rowId}__company`)).unique()
        : null;
      return { summary, tier, newCompany };
    });
    expect(values.summary?.value).toBe("Existing sourced summary.");
    expect(values.tier?.value).toBe("A");
    expect(values.newCompany?.value).toBe("NewCo");
  });

  it("strips HTML from a note's doc value so the noteworthiness classifier sees clean text", async () => {
    const s = await seedRoom();
    // A note artifact with an HTML "doc" element (how the legacy + synced editors persist).
    const noteArtifactId = await s.t.run((ctx) =>
      ctx.db.insert("artifacts", {
        roomId: s.roomId,
        kind: "note" as const,
        title: "Capture Notebook",
        version: 1,
        order: ["doc"],
        updatedAt: Date.now(),
        createdBy: s.actor,
        visibility: "room" as const,
      }),
    );
    await s.t.run((ctx) =>
      ctx.db.insert("elements", {
        artifactId: noteArtifactId,
        elementId: "doc",
        version: 1,
        // HTML with company + funding/runway signals wrapped in tags. Without
        // stripping, the classifier would still see the words, but this locks in
        // that HTML never breaks classification and the plain-text path is used.
        value: "<h1>CardioNova notes</h1><p>Met Maya. Possible Series B. Need to verify burn and runway.</p>",
        updatedAt: Date.now(),
        updatedBy: s.actor,
      }),
    );
    const sourceId = `${String(noteArtifactId)}:doc`;
    const enqueued = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId,
      requester: s.proof,
      sourceKind: "artifact_element",
      sourceId,
      sourceVersion: 1,
      sourceHash: "html-doc-a",
      eventKind: "content_committed",
      quietMs: 1_000,
    });
    await s.t.run(async (ctx) => ctx.db.patch(enqueued.outboxId, { quietUntil: Date.now() - 1 }));
    await s.t.mutation(internal.roomActivity.scanDueActivity, { roomId: s.roomId, limit: 5 });
    const row = await s.t.run((ctx) => ctx.db.get(enqueued.outboxId));
    // Finance signals (Series B, burn, runway) survived HTML stripping and cleared
    // the not_noteworthy threshold — proving the HTML was stripped to readable text.
    expect(row?.status).not.toBe("not_noteworthy");
    expect(row?.finding?.reasons).toEqual(expect.arrayContaining(["finance_signal"]));
    // The classifier text should NOT contain raw HTML tags.
    expect(row?.decision?.text).not.toContain("<");
  });

  it("detects an organization_candidate without a company suffix (CardioNova/Stripe/Ramp)", async () => {
    const s = await seedRoom();
    const noteArtifactId = await s.t.run((ctx) =>
      ctx.db.insert("artifacts", { roomId: s.roomId, kind: "note" as const, title: "Capture Notebook", version: 1, order: ["doc"], updatedAt: Date.now(), createdBy: s.actor, visibility: "room" as const }),
    );
    await s.t.run((ctx) => ctx.db.insert("elements", { artifactId: noteArtifactId, elementId: "doc", version: 1, value: "<p>Met Maya from CardioNova.</p>", updatedAt: Date.now(), updatedBy: s.actor }));
    const sourceId = `${String(noteArtifactId)}:doc`;
    const enqueued = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId, requester: s.proof, sourceKind: "artifact_element", sourceId,
      sourceVersion: 1, sourceHash: "org-candidate-a", eventKind: "content_committed", quietMs: 1_000,
    });
    await s.t.run(async (ctx) => ctx.db.patch(enqueued.outboxId, { quietUntil: Date.now() - 1 }));
    await s.t.mutation(internal.roomActivity.scanDueActivity, { roomId: s.roomId, limit: 5 });
    const row = await s.t.run((ctx) => ctx.db.get(enqueued.outboxId));
    // Gap 1 fix: the old suffix-bound `company_mention` never fired for "CardioNova".
    // The broader `organization_candidate` signal now does.
    expect(row?.finding?.signals).toEqual(expect.arrayContaining(["organization_candidate"]));
    expect(row?.finding?.signals).not.toContain("company_mention");
    // Gap 2: stable, sorted, versioned, evidenced output.
    expect(row?.finding?.classifierVersion).toBe("noteworthy-v1");
    expect(row?.finding?.evidenceSpans?.some((e: { signal: string }) => e.signal === "organization_candidate")).toBe(true);
    // Deterministic ordering: organization_candidate sorts before person_or_interaction.
    const signals = row?.finding?.signals as string[] | undefined;
    expect(signals?.indexOf("organization_candidate")).toBeLessThan(signals?.indexOf("person_or_interaction") ?? Infinity);
  });

  it("does not double-count a candidate: candidate+finance routes to create_coach_cue, not start_research_job", async () => {
    const s = await seedRoom();
    const noteArtifactId = await s.t.run((ctx) =>
      ctx.db.insert("artifacts", { roomId: s.roomId, kind: "note" as const, title: "Capture Notebook", version: 1, order: ["doc"], updatedAt: Date.now(), createdBy: s.actor, visibility: "room" as const }),
    );
    // "CardioNova" (candidate) + "Series B" (finance) = 2 signals = 0.54.
    // With the old double-count that was 0.72 (start_research_job); rebaselined
    // thresholds (0.35/0.50/0.70) route 0.54 to create_coach_cue.
    await s.t.run((ctx) => ctx.db.insert("elements", { artifactId: noteArtifactId, elementId: "doc", version: 1, value: "<p>CardioNova Series B</p>", updatedAt: Date.now(), updatedBy: s.actor }));
    const sourceId = `${String(noteArtifactId)}:doc`;
    const enqueued = await s.t.mutation(api.roomActivity.enqueueManual, {
      roomId: s.roomId, requester: s.proof, sourceKind: "artifact_element", sourceId,
      sourceVersion: 1, sourceHash: "score-baseline-a", eventKind: "content_committed", quietMs: 1_000,
    });
    await s.t.run(async (ctx) => ctx.db.patch(enqueued.outboxId, { quietUntil: Date.now() - 1 }));
    await s.t.mutation(internal.roomActivity.scanDueActivity, { roomId: s.roomId, limit: 5 });
    const row = await s.t.run((ctx) => ctx.db.get(enqueued.outboxId));
    expect(row?.finding?.signals).toEqual(expect.arrayContaining(["organization_candidate", "finance_signal"]));
    // Candidate counts once: 2 signals -> 0.18 + 0.36 = 0.54 (not 0.72).
    expect(row?.finding?.score).toBeCloseTo(0.54, 2);
    // 0.54 is below the 0.70 research threshold and at/above the 0.50 coach threshold.
    expect(row?.finding?.action).toBe("create_coach_cue");
  });

  it("drops ungrounded coach-eval evidence refs at the persistence boundary (Gap 3)", async () => {
    const s = await seedRoom();
    // A real evidence fact the evaluator could legitimately cite.
    const factId = "fact-burn-2024q3";
    await s.t.run((ctx) =>
      ctx.db.insert("evidenceFacts", {
        roomId: s.roomId, factId, label: "Burn Q3", value: 1_200_000, unit: "USD",
        confidence: "high" as const, checks: [], usedBy: [], createdAt: Date.now(),
      }),
    );
    // A roomActivityOutbox row with a pending coachEval (as practiceActivity would create).
    const outboxId = await s.t.run((ctx) =>
      ctx.db.insert("roomActivityOutbox", {
        roomId: s.roomId, sourceKind: "artifact_element" as const, sourceId: `${String(s.artifactId)}:doc`,
        sourceVersion: 1, sourceHash: "coach-eval-source-a", eventKind: "content_committed" as const,
        status: "job_created" as const, visibility: "room" as const, dedupeKey: "coach-eval-dedupe-a",
        quietUntil: Date.now(), attempts: 0, createdAt: Date.now(), updatedAt: Date.now(),
        finding: { coachEval: { status: "pending" as const, artifactRef: `${String(s.artifactId)}:doc`, userAnswer: "answer", expectedOutline: "" } },
      }),
    );
    // Evaluator proposes one grounded ref (real factId) + one ungrounded (bogus).
    const result = await s.t.mutation(internal.roomActivity.recordCoachEvalOutcome, {
      activityId: outboxId, score: 0.62, masteryTags: ["weak_on_burn"],
      missedEvidenceRefs: [factId, "totally-bogus-ref-that-resolves-to-nothing"],
      reviewReadinessDelta: -0.15, feedback: "Cite the burn source.",
    });
    expect(result.ok).toBe(true);
    expect(result.droppedUngroundedCount).toBe(1);
    const row = await s.t.run((ctx) => ctx.db.get(outboxId));
    // Only the grounded ref is persisted; the bogus one was deterministically dropped.
    expect(row?.finding?.coachEval?.missedEvidenceRefs).toEqual([factId]);
    expect(row?.finding?.coachEval?.droppedUngroundedCount).toBe(1);
    expect(row?.finding?.coachEval?.groundingWarning).toContain("1 ungrounded");
  });
});
