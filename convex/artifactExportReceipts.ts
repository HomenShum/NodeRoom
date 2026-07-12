import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";

const SHA256_RE = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 100 * 1024 * 1024;

function validateReceipt(args: {
  deckId: string;
  workArtifactId: string;
  planHash: string;
  fileName: string;
  byteLength: number;
  slideCount: number;
  integrityHash: string;
}): void {
  if (!args.deckId.trim() || args.deckId.length > 240) throw new Error("invalid_deck_id");
  if (!args.workArtifactId.trim() || args.workArtifactId.length > 320) throw new Error("invalid_work_artifact_id");
  if (!args.planHash.trim() || args.planHash.length > 160) throw new Error("invalid_plan_hash");
  if (!args.fileName.endsWith(".pptx") || args.fileName.length > 220 || /[\\/\0]/.test(args.fileName)) {
    throw new Error("invalid_export_file_name");
  }
  if (!Number.isSafeInteger(args.byteLength) || args.byteLength <= 0 || args.byteLength > MAX_FILE_BYTES) {
    throw new Error("invalid_export_byte_length");
  }
  if (!Number.isSafeInteger(args.slideCount) || args.slideCount <= 0 || args.slideCount > 500) {
    throw new Error("invalid_export_slide_count");
  }
  if (!SHA256_RE.test(args.integrityHash)) throw new Error("invalid_export_integrity_hash");
}

export const recordDeckDownload = mutation({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    deckId: v.string(),
    workArtifactId: v.string(),
    planHash: v.string(),
    fileName: v.string(),
    byteLength: v.number(),
    slideCount: v.number(),
    integrityAlgorithm: v.literal("sha256"),
    integrityHash: v.string(),
    deliveryStatus: v.union(v.literal("saved"), v.literal("download_started")),
  },
  handler: async (ctx, args) => {
    const actor = await requireActorProof(ctx, args.roomId, args.requester);
    validateReceipt(args);
    const createdAt = Date.now();
    const receiptId = await ctx.db.insert("artifactExportReceipts", {
      roomId: args.roomId,
      requesterId: actor.id,
      deckId: args.deckId,
      workArtifactId: args.workArtifactId,
      planHash: args.planHash,
      format: "pptx",
      fileName: args.fileName,
      byteLength: args.byteLength,
      slideCount: args.slideCount,
      integrityAlgorithm: args.integrityAlgorithm,
      integrityHash: args.integrityHash,
      deliveryStatus: args.deliveryStatus,
      createdAt,
    });
    await ctx.db.insert("traces", {
      roomId: args.roomId,
      ts: createdAt,
      actor,
      type: "artifact_export_receipt",
      summary: `${args.deliveryStatus === "saved" ? "Saved" : "Started download for"} ${args.fileName}`,
      detail: JSON.stringify({
        receiptId: String(receiptId),
        deckId: args.deckId,
        workArtifactId: args.workArtifactId,
        planHash: args.planHash,
        format: "pptx",
        byteLength: args.byteLength,
        slideCount: args.slideCount,
        integrityAlgorithm: args.integrityAlgorithm,
        integrityHash: args.integrityHash,
        deliveryStatus: args.deliveryStatus,
      }).slice(0, 4_000),
    });
    return {
      receiptId,
      fileName: args.fileName,
      byteLength: args.byteLength,
      slideCount: args.slideCount,
      integrityAlgorithm: args.integrityAlgorithm,
      integrityHash: args.integrityHash,
      deliveryStatus: args.deliveryStatus,
      createdAt,
    };
  },
});

export const latestDeckReceipt = query({
  args: {
    roomId: v.id("rooms"),
    requester: actorProofV,
    deckId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireActorProof(ctx, args.roomId, args.requester);
    const receipt = await ctx.db.query("artifactExportReceipts")
      .withIndex("by_room_deck", (q) => q.eq("roomId", args.roomId).eq("deckId", args.deckId))
      .order("desc")
      .first();
    if (!receipt) return null;
    return {
      receiptId: receipt._id,
      fileName: receipt.fileName,
      byteLength: receipt.byteLength,
      slideCount: receipt.slideCount,
      integrityAlgorithm: receipt.integrityAlgorithm,
      integrityHash: receipt.integrityHash,
      deliveryStatus: receipt.deliveryStatus,
      createdAt: receipt.createdAt,
    };
  },
});
