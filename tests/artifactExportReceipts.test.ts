// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { hashToken } from "../convex/lib";

const modules = import.meta.glob("../convex/**/*.ts");
for (const moduleName of [
  "../convex/agent.ts",
  "../convex/agentJobRunner.ts",
  "../convex/agentWorkflows.ts",
  "../convex/embeddingRunner.ts",
  "../convex/capturesNode.ts",
]) delete (modules as Record<string, unknown>)[moduleName];

const exportApi = (api as any).artifactExportReceipts;
const token = "artifact-export-receipt-token-0123456789";

async function setup() {
  const t = convexTest(schema, modules);
  const seeded = await t.run(async (ctx) => {
    const roomId = await ctx.db.insert("rooms", {
      code: "EXPORT",
      title: "Export room",
      hostId: "pending",
      autoAllow: false,
      status: "live",
      createdAt: Date.now(),
    });
    const memberId = await ctx.db.insert("members", {
      roomId,
      name: "Maya",
      role: "host",
      anon: false,
      color: "#d97757",
      authTokenHash: await hashToken(token),
      lastSeenAt: Date.now(),
    });
    await ctx.db.patch(roomId, { hostId: memberId });
    return { roomId, memberId };
  });
  return {
    t,
    ...seeded,
    proof: { actor: { kind: "user" as const, id: String(seeded.memberId), name: "Maya" }, token },
  };
}

describe("artifact export receipts", () => {
  it("persists an honest browser-delivery status and returns it after reload", async () => {
    const { t, roomId, proof, memberId } = await setup();
    const integrityHash = "a".repeat(64);
    const beforeRecord = Date.now();
    const recorded = await t.mutation(exportApi.recordDeckDownload, {
      roomId,
      requester: proof,
      deckId: "room:deck",
      workArtifactId: "room:work-artifact:deck",
      planHash: "plan-1",
      fileName: `room-deck-${integrityHash}.pptx`,
      byteLength: 4_096,
      slideCount: 4,
      integrityAlgorithm: "sha256",
      integrityHash,
      deliveryStatus: "download_started",
    });
    const afterRecord = Date.now();
    expect(recorded).toMatchObject({ deliveryStatus: "download_started", integrityHash });
    expect(recorded.createdAt).toBeGreaterThanOrEqual(beforeRecord);
    expect(recorded.createdAt).toBeLessThanOrEqual(afterRecord);

    const latest = await t.query(exportApi.latestDeckReceipt, { roomId, requester: proof, deckId: "room:deck" });
    expect(latest).toMatchObject({
      fileName: `room-deck-${integrityHash}.pptx`,
      byteLength: 4_096,
      slideCount: 4,
      integrityAlgorithm: "sha256",
      integrityHash,
      deliveryStatus: "download_started",
      createdAt: recorded.createdAt,
    });
    const traces = await t.run(async (ctx) => ctx.db.query("traces").withIndex("by_room", (q) => q.eq("roomId", roomId)).collect());
    expect(traces).toContainEqual(expect.objectContaining({
      actor: expect.objectContaining({ id: String(memberId) }),
      type: "artifact_export_receipt",
      summary: expect.stringContaining("Started download"),
    }));
  });

  it("rejects non-SHA-256 hashes and unsafe file names", async () => {
    const { t, roomId, proof } = await setup();
    const base = {
      roomId,
      requester: proof,
      deckId: "room:deck",
      workArtifactId: "room:work-artifact:deck",
      planHash: "plan-1",
      fileName: "room-deck.pptx",
      byteLength: 4_096,
      slideCount: 4,
      integrityAlgorithm: "sha256" as const,
      integrityHash: "fnv1a:1234",
      deliveryStatus: "saved" as const,
    };
    await expect(t.mutation(exportApi.recordDeckDownload, base)).rejects.toThrow("invalid_export_integrity_hash");
    await expect(t.mutation(exportApi.recordDeckDownload, {
      ...base,
      integrityHash: "b".repeat(64),
      fileName: "../room-deck.pptx",
    })).rejects.toThrow("invalid_export_file_name");
  });
});
