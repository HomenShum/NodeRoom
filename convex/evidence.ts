import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { actorProofV, requireActorProof } from "./lib";

const visibilityV = v.union(v.literal("private"), v.literal("room"), v.literal("public"));

export const recordSourceCapture = internalMutation({
  args: {
    roomId: v.id("rooms"),
    sourceUrl: v.string(),
    sourceTitle: v.optional(v.string()),
    sourceKind: v.union(
      v.literal("web"),
      v.literal("pdf"),
      v.literal("spreadsheet"),
      v.literal("sec"),
      v.literal("market_data"),
      v.literal("dataroom"),
      v.literal("app"),
    ),
    contentHash: v.string(),
    markdownStorageId: v.optional(v.id("_storage")),
    htmlStorageId: v.optional(v.id("_storage")),
    screenshotStorageId: v.optional(v.id("_storage")),
    viewport: v.optional(v.any()),
    provider: v.optional(v.string()),
    capturedByJobId: v.optional(v.id("agentJobs")),
    visibility: v.optional(visibilityV),
    ownerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db.query("sourceCaptures")
      .withIndex("by_room_hash", (q) => q.eq("roomId", args.roomId).eq("contentHash", args.contentHash))
      .first();
    if (existing) return existing._id;
    return ctx.db.insert("sourceCaptures", {
      roomId: args.roomId,
      sourceUrl: args.sourceUrl,
      sourceTitle: args.sourceTitle,
      sourceKind: args.sourceKind,
      contentHash: args.contentHash,
      markdownStorageId: args.markdownStorageId,
      htmlStorageId: args.htmlStorageId,
      screenshotStorageId: args.screenshotStorageId,
      viewport: args.viewport,
      provider: args.provider,
      capturedByJobId: args.capturedByJobId,
      visibility: args.visibility ?? "room",
      ownerId: args.ownerId,
      createdAt: now,
    });
  },
});

export const recordEvidenceFact = internalMutation({
  args: {
    roomId: v.id("rooms"),
    captureId: v.optional(v.id("sourceCaptures")),
    factId: v.string(),
    label: v.string(),
    value: v.any(),
    unit: v.optional(v.string()),
    period: v.optional(v.string()),
    quote: v.optional(v.string()),
    selector: v.optional(v.string()),
    bboxNorm: v.optional(v.any()),
    confidence: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    checks: v.any(),
    usedBy: v.array(v.any()),
    createdByJobId: v.optional(v.id("agentJobs")),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db.query("evidenceFacts")
      .withIndex("by_room_fact", (q) => q.eq("roomId", args.roomId).eq("factId", args.factId))
      .first();
    const doc = {
      roomId: args.roomId,
      captureId: args.captureId,
      factId: args.factId,
      label: args.label,
      value: args.value,
      unit: args.unit,
      period: args.period,
      quote: args.quote,
      selector: args.selector,
      bboxNorm: args.bboxNorm,
      confidence: args.confidence,
      checks: args.checks,
      usedBy: args.usedBy,
      createdByJobId: args.createdByJobId,
      createdAt: now,
    };
    if (existing) {
      await ctx.db.patch(existing._id, doc);
      return existing._id;
    }
    return ctx.db.insert("evidenceFacts", doc);
  },
});

export const listEvidenceForRoom = query({
  args: { roomId: v.id("rooms"), requester: actorProofV, limit: v.optional(v.number()) },
  handler: async (ctx, { roomId, requester, limit }) => {
    await requireActorProof(ctx, roomId, requester);
    return ctx.db.query("evidenceFacts")
      .withIndex("by_room_fact", (q) => q.eq("roomId", roomId))
      .take(Math.max(1, Math.min(limit ?? 50, 100)));
  },
});
